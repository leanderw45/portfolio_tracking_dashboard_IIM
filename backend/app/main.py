from __future__ import annotations

import logging
import math
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from fastapi import FastAPI, File, HTTPException, Query, UploadFile

from . import metrics as m
from .data_loader import TradeFileError, parse_trades
from .market_data import MARKET_TZ, MarketData
from .portfolio_engine import SIGN, build_ledger, daily_valuation_times, nav_series, positions_over_time, snapshot

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("iim")

ROOT = Path(__file__).resolve().parents[2]
TRADES = ROOT / "data" / "trades.xlsx"
md = MarketData(ROOT / "backend" / ".cache")
BENCHMARKS = {"^GSPC": "S&P 500 Index", "SPY": "SPY · S&P 500 ETF"}
BENCHMARK_FUND = "SPY"
DEFAULT_CASH = 10_000_000.0
INTRADAY, BAR = "30m", pd.Timedelta(minutes=30)
START_DATE = "2026-11-01"
MIN_DAILY_OBS = 20
MAX_UPLOAD_BYTES = 5 * 1024 * 1024

_lock = threading.RLock()
_trades_cache: tuple[float, object] | None = None
_exposure_cache: dict = {}


def jsonable(obj):
    if isinstance(obj, dict):
        return {str(k): jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [jsonable(v) for v in obj]
    if isinstance(obj, pd.DataFrame):
        return jsonable(obj.to_dict(orient="records"))
    if isinstance(obj, (pd.Timestamp, datetime)):
        return None if pd.isna(obj) else obj.isoformat()
    if isinstance(obj, np.bool_):
        return bool(obj)
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, (float, np.floating)):
        return float(obj) if math.isfinite(obj) else None
    return obj


def load_trades():
    global _trades_cache
    if not TRADES.exists():
        raise FileNotFoundError("No trade blotter uploaded yet (data/trades.xlsx is missing).")
    mtime = TRADES.stat().st_mtime
    if not _trades_cache or _trades_cache[0] != mtime:
        _trades_cache = (mtime, parse_trades(TRADES))
    return _trades_cache[1]


def core(bench: str, initial_cash: float) -> dict:
    load = load_trades()
    trades = load.trades
    tickers = sorted(trades["ticker"].unique())
    first_ts: pd.Timestamp = trades["timestamp"].min()
    start_ts = min(first_ts, pd.Timestamp(START_DATE, tz=MARKET_TZ))
    first_day = start_ts.tz_localize(None).normalize()
    now = pd.Timestamp.now(tz=MARKET_TZ)

    daily_close = md.close_frame(tickers + [bench], first_day - pd.Timedelta(days=10), "1d")
    i_start = max(first_day - pd.Timedelta(days=1), pd.Timestamp.now().normalize() - pd.Timedelta(days=58))
    intra_close = md.close_frame(tickers + [bench], i_start, INTRADAY)
    intra_open = md.close_frame([bench], i_start, INTRADAY, "Open")
    if daily_close.empty:
        raise RuntimeError("No market data available (Yahoo Finance unreachable and no local cache).")

    if not intra_close.empty and intra_close.index[-1].tz_localize(None).normalize() == daily_close.index[-1].normalize():
        intra_close.iloc[-1] = daily_close.iloc[-1].reindex(intra_close.columns).fillna(intra_close.iloc[-1])

    last_px = daily_close.ffill().iloc[-1]
    prices = {t: float(last_px[t]) for t in tickers if t in last_px and pd.notna(last_px[t])}
    session_date = daily_close.index[-1].normalize()
    if not intra_close.empty:
        session_date = max(session_date, intra_close.index[-1].tz_localize(None).normalize())
    prior = daily_close.loc[daily_close.index < session_date].ffill()
    prev_close = {t: float(prior[t].iloc[-1]) for t in tickers if len(prior) and t in prior and pd.notna(prior[t].iloc[-1])}

    prev_close_time = daily_valuation_times(pd.DatetimeIndex([prior.index[-1]]))[0] if len(prior) else first_ts - pd.Timedelta(seconds=1)
    pos_prev, _ = positions_over_time(trades, pd.DatetimeIndex([prev_close_time]))
    tt = trades[trades["timestamp"] > prev_close_time]
    today_flows = (tt["action"].map(SIGN) * tt["quantity"] * tt["price"] + tt["fee"]).groupby(tt["ticker"]).sum().to_dict()

    ledger = build_ledger(trades, initial_cash)
    snap = snapshot(ledger, prices, prev_close, pos_prev.iloc[0].to_dict(), today_flows)

    bench_at_inception = None
    if bench in intra_open:
        bars = intra_open[bench].dropna()
        hit = bars[(bars.index <= start_ts) & (bars.index + BAR > start_ts)]
        bench_at_inception = float(hit.iloc[-1]) if len(hit) else None
    if bench_at_inception is None:
        before = daily_close[bench].loc[: first_day - pd.Timedelta(days=1)].dropna()
        bench_at_inception = float(before.iloc[-1]) if len(before) else float(daily_close[bench].dropna().iloc[0])

    inception = pd.DataFrame({"nav": [initial_cash], "cash": [initial_cash], "market_value": [0.0]}, index=pd.DatetimeIndex([start_ts]))

    def build(px: pd.DataFrame, valuation: pd.DatetimeIndex) -> pd.DataFrame:
        keep = valuation > start_ts
        px, valuation = px.loc[keep], valuation[keep]
        ser = inception.copy()
        if not px.empty:
            body = nav_series(trades, px.drop(columns=[bench], errors="ignore"), initial_cash, valuation)
            body.index = valuation
            ser = pd.concat([inception, body])
        bench_vals = px[bench].values if bench in px else []
        ser["bench"] = pd.concat([pd.Series([bench_at_inception], index=[start_ts]), pd.Series(bench_vals, index=valuation)]).ffill().values
        ser["ret"] = ser["nav"] / initial_cash - 1
        ser["bench_ret"] = ser["bench"] / bench_at_inception - 1
        ser["drawdown"] = m.drawdown_series(ser["nav"])
        ser["bench_drawdown"] = m.drawdown_series(ser["bench"])
        return ser

    d_px = daily_close.loc[daily_close.index >= first_day]
    daily = build(d_px, daily_valuation_times(d_px.index))
    if intra_close.empty:
        intraday = daily.copy()
    else:
        intraday = build(intra_close, pd.DatetimeIndex([min(t, now) for t in intra_close.index + BAR]))

    rf = md.risk_free_rate()
    use_daily = len(daily) - 1 >= MIN_DAILY_OBS
    basis = daily if use_daily else intraday
    ppy = m.TRADING_DAYS if use_daily else m.TRADING_DAYS * m.BARS_PER_DAY_30M
    window = 20 if use_daily else m.BARS_PER_DAY_30M
    pos = snap["positions"]
    return {
        "load": load,
        "ledger": ledger,
        "positions": pos,
        "totals": snap["totals"],
        "daily": daily,
        "intraday": intraday,
        "stats": m.performance_summary(basis["nav"], basis["bench"], rf, ppy, daily["nav"], daily["bench"]),
        "rolling": m.rolling_stats(m.simple_returns(basis["nav"]), m.simple_returns(basis["bench"]), window, ppy),
        "concentration": m.concentration(pos.set_index("ticker")["market_value"]) if len(pos) else {},
        "rf": rf,
        "basis": {"frequency": "daily" if use_daily else INTRADAY, "periods_per_year": ppy, "observations": len(basis) - 1, "rolling_window": window},
        "first_ts": first_ts,
        "start_ts": start_ts,
        "now": now,
        "as_of": min(intra_close.index[-1] + BAR, now) if not intra_close.empty else daily_valuation_times(daily_close.index[-1:])[0],
    }


def build_dashboard(bench: str, initial_cash: float) -> dict:
    with _lock:
        c = core(bench, initial_cash)
    t, stats, pos, daily = c["totals"], c["stats"], c["positions"], c["daily"]
    nav = t["nav"]
    open_pos = pos[pos["is_open"]].sort_values("market_value", ascending=False)
    nav_prev = float(daily["nav"].iloc[-2]) if len(daily) >= 2 else initial_cash
    bench_now, bench_prev = float(daily["bench"].iloc[-1]), float(daily["bench"].iloc[-2]) if len(daily) >= 2 else None
    bench_total = float(daily["bench_ret"].iloc[-1])
    daily_pnl = float(open_pos["daily_pnl"].sum()) if len(open_pos) else 0.0
    n_win = int((open_pos["unrealized_pnl"] > 0).sum())

    def series(df: pd.DataFrame) -> list[dict]:
        return [{"t": ts, "nav": r.nav, "cash": r.cash, "ret": r.ret, "bench": r.bench, "bench_ret": r.bench_ret, "dd": r.drawdown, "bench_dd": r.bench_drawdown} for ts, r in df.iterrows()]

    return jsonable({
        "meta": {
            "generated_at": datetime.now(timezone.utc),
            "as_of": c["as_of"],
            "last_price_fetch": datetime.fromtimestamp(md.last_fetch, tz=timezone.utc) if md.last_fetch else None,
            "market_live": bool(c["now"] - c["as_of"] < pd.Timedelta(minutes=45) and c["now"].weekday() < 5),
            "inception": c["start_ts"],
            "first_trade": c["first_ts"],
            "days_live": int(np.busday_count(c["start_ts"].date(), (c["now"] + pd.Timedelta(days=1)).date())),
            "benchmark": bench,
            "benchmark_label": BENCHMARKS[bench],
            "benchmarks": [{"value": k, "label": v} for k, v in BENCHMARKS.items()],
            "initial_cash": initial_cash,
            "risk_free_rate": c["rf"],
            "metrics_basis": c["basis"],
            "warnings": list(dict.fromkeys(c["load"].warnings + md.warnings)),
            "invariant_gap": (t["initial_cash"] + t["realized_pnl"] + t["unrealized_pnl"] - t["fees"]) - nav,
        },
        "kpis": {
            "nav": nav,
            "total_pnl": t["total_pnl"],
            "total_return": t["total_pnl"] / initial_cash,
            "benchmark_return": bench_total,
            "excess_return": t["total_pnl"] / initial_cash - bench_total,
            "daily_pnl": daily_pnl,
            "daily_return": daily_pnl / nav_prev if nav_prev else None,
            "benchmark_daily_return": bench_now / bench_prev - 1 if bench_prev else None,
            "cash": t["cash"],
            "cash_weight": t["cash"] / nav if nav else None,
            "invested_weight": t["market_value"] / nav if nav else None,
            "sharpe": stats["sharpe"],
            "benchmark_sharpe": stats["benchmark_sharpe"],
            "max_drawdown": stats["max_drawdown"],
            "benchmark_max_drawdown": stats["benchmark_max_drawdown"],
            "current_drawdown": stats["current_drawdown"],
            "realized_pnl": t["realized_pnl"],
            "unrealized_pnl": t["unrealized_pnl"],
            "fees": t["fees"],
            "positions_count": len(open_pos),
            "winners": n_win,
            "losers": len(open_pos) - n_win,
        },
        "series": {"intraday": series(c["intraday"]), "daily": series(daily)},
        "positions": pos.drop(columns=["opened_at"]).sort_values("market_value", ascending=False),
        "movers": [{"ticker": r.ticker, "pnl": r.total_pnl, "pnl_pct": r.unrealized_pnl_pct, "daily_pnl": r.daily_pnl, "day_change_pct": r.day_change_pct} for r in open_pos.itertuples()],
        "allocation": [{"name": r.ticker, "weight": r.weight, "market_value": r.market_value} for r in open_pos.itertuples()]
        + [{"name": "Cash", "weight": t["cash"] / nav if nav else 0.0, "market_value": t["cash"]}],
        "risk": {
            **stats,
            **{f"concentration_{k}": v for k, v in c["concentration"].items()},
            "rolling": [{"t": ts, **r._asdict()} for ts, r in zip(c["rolling"].index, c["rolling"].itertuples(index=False))],
        },
        "trades": c["ledger"].trade_log.sort_values("timestamp", ascending=False),
    })


def build_exposures(bench: str, initial_cash: float) -> dict:
    with _lock:
        key = (TRADES.stat().st_mtime, bench, initial_cash)
        hit = _exposure_cache.get(key)
        if hit and time.time() - hit[0] < 900:
            return hit[1]
        c = core(bench, initial_cash)
        nav = c["totals"]["nav"]
        open_pos = c["positions"][c["positions"]["is_open"]]
        infos = md.info_many(list(open_pos["ticker"]))
        holdings = []
        for r in open_pos.itertuples():
            info = infos.get(r.ticker, {})
            holdings.append({
                "ticker": r.ticker,
                "name": info.get("shortName") or info.get("longName") or r.ticker,
                "kind": "ETF" if (info.get("quoteType") or "").upper() in ("ETF", "MUTUALFUND") else "Stock",
                "weight": float(r.weight),
                "market_value": float(r.market_value),
                "sector": info.get("sector") or info.get("category"),
            })
        funds = {h["ticker"]: md.fund(h["ticker"]) for h in holdings if h["kind"] == "ETF"}
        const_infos = md.info_many([th["symbol"] for f in funds.values() for th in f.get("top_holdings", [])])
        lt = m.look_through(holdings, funds)
        bench_sectors = md.fund(BENCHMARK_FUND).get("sector_weightings") or {}
        dist = m.distributions(holdings, infos, funds, const_infos, bench_sectors, c["totals"]["cash"] / nav)

        weights = pd.Series({h["ticker"]: h["weight"] for h in holdings})
        adj = md.close_frame(list(weights.index) + [bench], pd.Timestamp.now().normalize() - pd.Timedelta(days=400), "1d", "Adj Close")
        risk = m.ex_ante_risk(adj, weights, bench, c["rf"], nav)

        etfs = []
        for h in holdings:
            if h["kind"] != "ETF":
                continue
            er = infos.get(h["ticker"], {}).get("netExpenseRatio")
            etfs.append({
                "ticker": h["ticker"],
                "name": h["name"],
                "weight": h["weight"],
                "expense_ratio": er / 100 if er is not None else None,
                "annual_fee_usd": h["market_value"] * er / 100 if er is not None else None,
                "top10_coverage": next((r["coverage"] for r in lt["residuals"] if r["etf"] == h["ticker"]), None),
                "top_holdings": funds[h["ticker"]].get("top_holdings", []),
            })
        etf_w = sum(e["weight"] for e in etfs)
        payload = jsonable({
            "holdings": holdings,
            "look_through": lt,
            "distributions": dist,
            **risk,
            "etfs": etfs,
            "etf_expense_ratio": sum((e["expense_ratio"] or 0) * e["weight"] for e in etfs) / etf_w if etf_w else None,
            "annual_etf_fees_usd": sum(e["annual_fee_usd"] or 0 for e in etfs),
            "benchmark_label": BENCHMARKS[bench],
        })
        _exposure_cache[key] = (time.time(), payload)
        return payload


@asynccontextmanager
async def lifespan(_app: FastAPI):
    def warm():
        try:
            build_exposures("^GSPC", DEFAULT_CASH)
            log.info("exposure cache warmed")
        except Exception:
            log.exception("cache warm-up failed (will retry on demand)")

    threading.Thread(target=warm, daemon=True).start()
    yield


app = FastAPI(title="IIM Portfolio Tracker", lifespan=lifespan)


def _guard(fn, *args):
    try:
        return fn(*args)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except (TradeFileError, ValueError) as exc:
        raise HTTPException(422, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc


Bench = Query("^GSPC", pattern=r"^(\^GSPC|SPY)$")
Cash = Query(DEFAULT_CASH, gt=0)


@app.get("/api/dashboard")
def dashboard(benchmark: str = Bench, initial_cash: float = Cash):
    return _guard(build_dashboard, benchmark, initial_cash)


@app.get("/api/exposures")
def exposures(benchmark: str = Bench, initial_cash: float = Cash):
    return _guard(build_exposures, benchmark, initial_cash)


@app.post("/api/refresh")
def refresh(benchmark: str = Bench, initial_cash: float = Cash):
    md.invalidate_prices()
    md.warnings.clear()
    _exposure_cache.clear()
    return _guard(build_dashboard, benchmark, initial_cash)


@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    if not (file.filename or "").lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(415, "Please upload an .xlsx workbook.")
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File too large (max 5 MB).")
    res = _guard(parse_trades, content)
    if TRADES.exists():
        TRADES.with_name(f"trades.backup-{datetime.now():%Y%m%d-%H%M%S}.xlsx").write_bytes(TRADES.read_bytes())
    TRADES.write_bytes(content)
    _exposure_cache.clear()
    tr = res.trades
    return jsonable({
        "filename": file.filename,
        "rows": len(tr),
        "tickers": sorted(tr["ticker"].unique()),
        "first_trade": tr["timestamp"].min(),
        "last_trade": tr["timestamp"].max(),
        "gross_notional": float((tr["quantity"] * tr["price"]).sum()),
        "warnings": res.warnings,
    })
