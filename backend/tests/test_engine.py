from __future__ import annotations

import io
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from app import metrics as m
from app.data_loader import TradeFileError, parse_trades
from app.portfolio_engine import build_ledger, nav_series, positions_over_time, snapshot

ROOT = Path(__file__).resolve().parents[2]
TRADES_XLSX = ROOT / "data" / "trades.xlsx"
TZ = "America/New_York"
TOL = 1e-6


def make_trades(rows):
    recs = []
    for i, r in enumerate(rows, 1):
        ts, tk, act, q, p, *fee = r
        recs.append({"trade_id": i, "timestamp": pd.Timestamp(ts, tz=TZ), "ticker": tk, "action": act,
                     "quantity": float(q), "price": float(p), "fee": float(fee[0] if fee else 0.0)})
    return pd.DataFrame(recs)


def assert_invariants(ledger, prices):
    snap = snapshot(ledger, prices)
    t = snap["totals"]
    lhs = t["initial_cash"] + t["realized_pnl"] + t["unrealized_pnl"] - t["fees"]
    assert lhs == pytest.approx(t["nav"], abs=TOL), "Initial + Realized + Unrealized - Fees != NAV"
    assert t["cash"] + t["market_value"] == pytest.approx(t["nav"], abs=TOL)
    assert t["total_pnl"] == pytest.approx(t["realized_pnl"] + t["unrealized_pnl"] - t["fees"], abs=TOL)
    if len(snap["positions"]):
        assert snap["positions"]["total_pnl"].sum() == pytest.approx(t["total_pnl"], abs=TOL)
        assert snap["positions"]["contribution"].sum() == pytest.approx(t["total_pnl"] / t["initial_cash"], abs=1e-12)
    return snap


def test_buy_only_marks_to_market():
    tr = make_trades([("2026-11-18 09:32", "AAA", "BUY", 100, 10.0, 1.0)])
    led = build_ledger(tr, 10_000)
    snap = assert_invariants(led, {"AAA": 12.0})
    t = snap["totals"]
    assert t["cash"] == pytest.approx(10_000 - 1_000 - 1)
    assert t["unrealized_pnl"] == pytest.approx(200)
    assert t["realized_pnl"] == 0
    assert t["nav"] == pytest.approx(10_000 - 1 + 200)


def test_average_cost_and_partial_sell_realises_pnl():
    tr = make_trades([
        ("2026-11-18 09:30", "AAA", "BUY", 100, 10.0, 0.5),
        ("2026-11-18 10:00", "AAA", "BUY", 100, 20.0, 0.5),
        ("2026-11-19 10:00", "AAA", "SELL", 50, 25.0, 0.5),
    ])
    led = build_ledger(tr, 100_000)
    pos = led.positions["AAA"]
    assert pos.avg_cost == pytest.approx(15.0)
    assert pos.quantity == pytest.approx(150)
    assert led.realized_pnl == pytest.approx(500)
    assert led.fees == pytest.approx(1.5)
    snap = assert_invariants(led, {"AAA": 18.0})
    assert snap["totals"]["unrealized_pnl"] == pytest.approx(150 * 3)


def test_full_close_leaves_only_cash():
    tr = make_trades([
        ("2026-11-18 09:30", "AAA", "BUY", 10, 100.0, 2),
        ("2026-11-20 09:30", "AAA", "SELL", 10, 90.0, 2),
    ])
    led = build_ledger(tr, 5_000)
    snap = assert_invariants(led, {"AAA": 500.0})
    t = snap["totals"]
    assert t["market_value"] == 0
    assert t["nav"] == pytest.approx(5_000 - 100 - 4)
    assert led.positions["AAA"].avg_cost == 0


def test_short_and_cover():
    tr = make_trades([
        ("2026-11-18 09:30", "BBB", "SHORT", 100, 50.0, 1),
        ("2026-11-19 09:30", "BBB", "COVER", 40, 40.0, 1),
    ])
    led = build_ledger(tr, 10_000)
    assert led.realized_pnl == pytest.approx(400)
    assert led.positions["BBB"].quantity == pytest.approx(-60)
    snap = assert_invariants(led, {"BBB": 45.0})
    assert snap["totals"]["unrealized_pnl"] == pytest.approx(-60 * (45 - 50))
    assert snap["totals"]["short_exposure"] == pytest.approx(60 * 45)


def test_sell_through_zero_flips_position():
    tr = make_trades([
        ("2026-11-18 09:30", "CCC", "BUY", 100, 10.0),
        ("2026-11-18 11:00", "CCC", "SELL", 150, 12.0),
    ])
    led = build_ledger(tr, 10_000)
    pos = led.positions["CCC"]
    assert led.realized_pnl == pytest.approx(200)
    assert pos.quantity == pytest.approx(-50)
    assert pos.avg_cost == pytest.approx(12.0)
    assert_invariants(led, {"CCC": 11.0})


@pytest.mark.parametrize("seed", range(25))
def test_random_trade_sequences_hold_invariant(seed):
    rng = np.random.default_rng(seed)
    tickers = ["AAA", "BBB", "CCC"]
    rows, ts = [], pd.Timestamp("2026-11-18 09:30")
    for _ in range(60):
        ts += pd.Timedelta(minutes=int(rng.integers(1, 120)))
        rows.append((str(ts), rng.choice(tickers), rng.choice(["BUY", "SELL", "SHORT", "COVER"]),
                     int(rng.integers(1, 500)), float(rng.uniform(5, 500)), float(rng.uniform(0, 10))))
    led = build_ledger(make_trades(rows), 1_000_000)
    for _ in range(5):
        assert_invariants(led, {t: float(rng.uniform(1, 600)) for t in tickers})


def test_real_blotter_invariant_and_cash():
    res = parse_trades(TRADES_XLSX)
    tr = res.trades
    led = build_ledger(tr, 10_000_000)
    gross = float((tr.quantity * tr.price).sum())
    assert led.cash == pytest.approx(10_000_000 - gross)
    rng = np.random.default_rng(0)
    last = tr.groupby("ticker")["price"].last()
    for _ in range(10):
        assert_invariants(led, {t: p * rng.uniform(0.8, 1.2) for t, p in last.items()})
    snap = snapshot(led, last.to_dict())
    assert snap["totals"]["nav"] == pytest.approx(10_000_000 - led.fees)


def test_nav_series_matches_snapshot_and_respects_trade_times():
    tr = make_trades([
        ("2026-11-18 09:35", "AAA", "BUY", 100, 10.0, 1),
        ("2026-11-19 10:15", "BBB", "BUY", 50, 20.0, 1),
        ("2026-11-20 14:00", "AAA", "SELL", 40, 12.0, 1),
    ])
    idx = pd.DatetimeIndex(pd.to_datetime(["2026-11-18 16:00", "2026-11-19 16:00", "2026-11-20 16:00"]).tz_localize(TZ))
    px = pd.DataFrame({"AAA": [11.0, 10.5, 13.0], "BBB": [np.nan, 21.0, 19.0]}, index=idx)
    ser = nav_series(tr, px, 10_000)
    led = build_ledger(tr, 10_000)
    snap = snapshot(led, {"AAA": 13.0, "BBB": 19.0})
    assert ser["nav"].iloc[-1] == pytest.approx(snap["totals"]["nav"])
    assert ser["nav"].iloc[0] == pytest.approx(10_000 - 1000 - 1 + 100 * 11.0)
    pos, _ = positions_over_time(tr, idx)
    assert pos.loc[idx[0], "BBB"] == 0 and pos.loc[idx[1], "BBB"] == 50
    assert pos.loc[idx[2], "AAA"] == 60


def test_loader_reads_marketwatch_export():
    res = parse_trades(TRADES_XLSX)
    tr = res.trades
    assert list(tr.columns) == ["trade_id", "timestamp", "ticker", "action", "quantity", "price", "fee"]
    assert len(tr) == 13
    assert set(tr.action) == {"BUY"}
    assert str(tr.timestamp.dt.tz) == TZ
    assert tr.timestamp.is_monotonic_increasing
    assert tr.loc[tr.ticker == "SOXX", "quantity"].item() == 7000


def _xlsx(df: pd.DataFrame) -> bytes:
    buf = io.BytesIO()
    df.to_excel(buf, index=False)
    return buf.getvalue()


def test_loader_rejects_bad_files():
    with pytest.raises(TradeFileError):
        parse_trades(b"not an excel file")
    with pytest.raises(TradeFileError, match="Unknown action"):
        parse_trades(_xlsx(pd.DataFrame({"Date": ["2026-11-18 09:30"], "Ticker": ["X"], "Buy/Sell": ["Hold"], "Quantity": [1], "Price": [1]})))
    with pytest.raises(TradeFileError, match="positive"):
        parse_trades(_xlsx(pd.DataFrame({"Date": ["2026-11-18 09:30"], "Ticker": ["X"], "Buy/Sell": ["Buy"], "Quantity": [-5], "Price": [1]})))
    with pytest.raises(TradeFileError, match="Missing required"):
        parse_trades(_xlsx(pd.DataFrame({"Ticker": ["X"], "Price": [1]})))


def test_loader_accepts_fee_column_and_aliases():
    df = pd.DataFrame({"Date": ["2026-11-18 09:30", "2026-11-18 09:31"], "Symbol": ["x", "y"],
                       "Side": ["Buy", "Sell Short"], "Shares": ["1,000", 5], "Price": ["$10.50", 3], "Commission": [9.99, None]})
    tr = parse_trades(_xlsx(df)).trades
    assert tr.ticker.tolist() == ["X", "Y"]
    assert tr.action.tolist() == ["BUY", "SHORT"]
    assert tr.quantity.tolist() == [1000, 5]
    assert tr.fee.tolist() == [9.99, 0.0]


def test_drawdown_and_returns():
    nav = pd.Series([100, 110, 99, 120, 90, 95], dtype=float)
    assert m.max_drawdown(nav) == pytest.approx(90 / 120 - 1)
    assert m.total_return(nav) == pytest.approx(-0.05)
    d = m.max_drawdown_details(nav)
    assert d["peak"] == 3 and d["trough"] == 4 and d["recovery"] is None


def test_beta_of_identical_series_is_one_and_alpha_zero():
    r = pd.Series(np.random.default_rng(1).normal(0, 0.01, 300))
    beta, alpha, corr = m.beta_alpha(r, r, 0.04, 252)
    assert beta == pytest.approx(1.0)
    assert alpha == pytest.approx(0.0, abs=1e-12)
    assert corr == pytest.approx(1.0)
    lev_beta, *_ = m.beta_alpha(2 * r, r, 0.0, 252)
    assert lev_beta == pytest.approx(2.0)


def test_sharpe_and_vol_scaling():
    r = pd.Series([0.01, -0.005, 0.007, 0.002, -0.001] * 20)
    vol = m.annualized_volatility(r, 252)
    assert vol == pytest.approx(r.std(ddof=1) * np.sqrt(252))
    assert m.sharpe_ratio(r, 0.0, 252) == pytest.approx(r.mean() / r.std(ddof=1) * np.sqrt(252))
    assert m.sharpe_ratio(pd.Series([0.01, 0.01, 0.01]), 0.0, 252) is None


def test_capture_and_concentration():
    b = pd.Series([0.01, -0.02, 0.03, -0.01])
    up, down = m.capture_ratios(2 * b, b)
    assert up > 1 and down > 1
    c = m.concentration(pd.Series({"A": 50.0, "B": 50.0}))
    assert c["effective_n"] == pytest.approx(2.0)
    assert c["hhi"] == pytest.approx(0.5)


def test_look_through_aggregates_direct_and_etf_exposure():
    holdings = [
        {"ticker": "MU", "name": "Micron", "kind": "Stock", "weight": 0.04},
        {"ticker": "SOXX", "name": "Semis ETF", "kind": "ETF", "weight": 0.10},
    ]
    funds = {"SOXX": {"top_holdings": [{"symbol": "MU", "name": "Micron", "weight": 0.08}, {"symbol": "NVDA", "name": "Nvidia", "weight": 0.09}]}}
    lt = m.look_through(holdings, funds)
    mu = next(r for r in lt["top"] if r["symbol"] == "MU")
    assert mu["weight"] == pytest.approx(0.04 + 0.10 * 0.08)
    assert [o["symbol"] for o in lt["overlaps"]] == ["MU"]
    assert lt["residuals"][0]["weight"] == pytest.approx(0.10 * (1 - 0.17))


def test_buy_and_hold_equals_portfolio_until_later_trades():
    tr = make_trades([
        ("2026-11-18 09:35", "AAA", "BUY", 100, 10.0, 1),
        ("2026-11-18 09:36", "BBB", "BUY", 50, 20.0, 1),
        ("2026-11-20 10:00", "AAA", "SELL", 60, 12.0, 1),
    ])
    initial = tr[tr["timestamp"].dt.date == tr["timestamp"].min().date()]
    idx = pd.DatetimeIndex(pd.to_datetime(["2026-11-18 16:00", "2026-11-19 16:00", "2026-11-20 16:00"]).tz_localize(TZ))
    px = pd.DataFrame({"AAA": [11.0, 10.5, 13.0], "BBB": [21.0, 19.0, 22.0]}, index=idx)
    full = nav_series(tr, px, 10_000)["nav"]
    hold = nav_series(initial, px, 10_000)["nav"]
    assert full.iloc[:2].tolist() == hold.iloc[:2].tolist()
    assert hold.iloc[2] == pytest.approx(10_000 - 1000 - 1 - 1000 - 1 + 100 * 13.0 + 50 * 22.0)
    assert full.iloc[2] != hold.iloc[2]
    assert nav_series(tr.iloc[:2], px, 10_000)["nav"].tolist() == hold.tolist()
