from __future__ import annotations

import math

import numpy as np
import pandas as pd

TRADING_DAYS = 252
BARS_PER_DAY_30M = 13


def _clean(x: float | None) -> float | None:
    if x is None:
        return None
    try:
        xf = float(x)
    except (TypeError, ValueError):
        return None
    return xf if math.isfinite(xf) else None


def simple_returns(nav: pd.Series) -> pd.Series:
    return nav.pct_change().dropna()


def total_return(nav: pd.Series) -> float | None:
    if len(nav) < 2 or nav.iloc[0] == 0:
        return None
    return _clean(nav.iloc[-1] / nav.iloc[0] - 1.0)


def annualized_volatility(r: pd.Series, periods_per_year: float) -> float | None:
    if len(r) < 2:
        return None
    return _clean(r.std(ddof=1) * np.sqrt(periods_per_year))


def sharpe_ratio(r: pd.Series, rf_annual: float, periods_per_year: float) -> float | None:
    if len(r) < 2:
        return None
    excess = r - rf_annual / periods_per_year
    sd = excess.std(ddof=1)
    if not sd or sd < 1e-12:
        return None
    return _clean(excess.mean() / sd * np.sqrt(periods_per_year))


def sortino_ratio(r: pd.Series, rf_annual: float, periods_per_year: float) -> float | None:
    if len(r) < 2:
        return None
    excess = r - rf_annual / periods_per_year
    downside = np.minimum(excess, 0.0)
    dd = np.sqrt((downside**2).mean())
    if dd < 1e-12:
        return None
    return _clean(excess.mean() / dd * np.sqrt(periods_per_year))


def drawdown_series(nav: pd.Series) -> pd.Series:
    peak = nav.cummax()
    return nav / peak - 1.0


def max_drawdown(nav: pd.Series) -> float | None:
    if len(nav) < 2:
        return 0.0 if len(nav) else None
    return _clean(drawdown_series(nav).min())


def max_drawdown_details(nav: pd.Series) -> dict:
    if len(nav) < 2:
        return {"depth": 0.0, "peak": None, "trough": None, "recovery": None}
    dd = drawdown_series(nav)
    trough = dd.idxmin()
    peak = nav.loc[:trough].idxmax()
    after = nav.loc[trough:]
    rec = after[after >= nav.loc[peak]]
    return {
        "depth": _clean(dd.min()),
        "peak": peak,
        "trough": trough,
        "recovery": rec.index[0] if len(rec) else None,
    }


def beta_alpha(
    r: pd.Series, b: pd.Series, rf_annual: float, periods_per_year: float
) -> tuple[float | None, float | None, float | None]:
    df = pd.concat([r, b], axis=1, join="inner").dropna()
    if len(df) < 3:
        return None, None, None
    rf = rf_annual / periods_per_year
    rp, rb = df.iloc[:, 0] - rf, df.iloc[:, 1] - rf
    var_b = rb.var(ddof=1)
    if var_b < 1e-16:
        return None, None, None
    beta = rp.cov(rb) / var_b
    alpha = (rp.mean() - beta * rb.mean()) * periods_per_year
    corr = rp.corr(rb)
    return _clean(beta), _clean(alpha), _clean(corr)


def tracking_error(r: pd.Series, b: pd.Series, periods_per_year: float) -> float | None:
    active = (r - b).dropna()
    if len(active) < 2:
        return None
    return _clean(active.std(ddof=1) * np.sqrt(periods_per_year))


def information_ratio(r: pd.Series, b: pd.Series, periods_per_year: float) -> float | None:
    active = (r - b).dropna()
    if len(active) < 2:
        return None
    sd = active.std(ddof=1)
    if sd < 1e-12:
        return None
    return _clean(active.mean() / sd * np.sqrt(periods_per_year))


def capture_ratios(r: pd.Series, b: pd.Series) -> tuple[float | None, float | None]:
    df = pd.concat([r, b], axis=1, join="inner").dropna()
    df.columns = ["p", "b"]
    out = []
    for mask in (df.b > 0, df.b < 0):
        sub = df[mask]
        if len(sub) == 0:
            out.append(None)
            continue
        pb = (1 + sub.b).prod() - 1
        pp = (1 + sub.p).prod() - 1
        out.append(_clean(pp / pb) if abs(pb) > 1e-12 else None)
    return out[0], out[1]


def historical_var(r: pd.Series, level: float = 0.95) -> tuple[float | None, float | None]:
    if len(r) < 5:
        return None, None
    q = np.quantile(r, 1 - level)
    tail = r[r <= q]
    return _clean(-q), _clean(-tail.mean()) if len(tail) else None


def win_rate(r: pd.Series) -> float | None:
    r = r[r != 0]
    return _clean((r > 0).mean()) if len(r) else None


def rolling_stats(r: pd.Series, b: pd.Series, window: int, periods_per_year: float) -> pd.DataFrame:
    df = pd.concat([r.rename("p"), b.rename("b")], axis=1, join="inner").dropna()
    vol = df.p.rolling(window).std(ddof=1) * np.sqrt(periods_per_year)
    bvol = df.b.rolling(window).std(ddof=1) * np.sqrt(periods_per_year)
    beta = df.p.rolling(window).cov(df.b) / df.b.rolling(window).var(ddof=1)
    return pd.DataFrame({"vol": vol, "bench_vol": bvol, "beta": beta}).dropna()


def concentration(weights: pd.Series) -> dict:
    w = weights[weights.abs() > 0].abs()
    if w.sum() == 0:
        return {"hhi": None, "effective_n": None, "top5": None, "top1": None}
    w = w / w.sum()
    hhi = float((w**2).sum())
    s = w.sort_values(ascending=False)
    return {"hhi": hhi, "effective_n": 1.0 / hhi, "top5": float(s.head(5).sum()), "top1": float(s.iloc[0])}


def performance_summary(
    nav: pd.Series,
    bench: pd.Series,
    rf_annual: float,
    periods_per_year: float,
    daily_nav: pd.Series | None = None,
    daily_bench: pd.Series | None = None,
) -> dict:
    r = simple_returns(nav)
    rb = simple_returns(bench.reindex(nav.index).ffill())
    beta, alpha, corr = beta_alpha(r, rb, rf_annual, periods_per_year)
    up, down = capture_ratios(r, rb)
    var95, cvar95 = historical_var(r)
    mdd = max_drawdown_details(nav)
    port_tr, bench_tr = total_return(nav), total_return(bench.reindex(nav.index).ffill())

    out = {
        "total_return": port_tr,
        "benchmark_return": bench_tr,
        "excess_return": _clean(port_tr - bench_tr) if port_tr is not None and bench_tr is not None else None,
        "volatility": annualized_volatility(r, periods_per_year),
        "benchmark_volatility": annualized_volatility(rb, periods_per_year),
        "sharpe": sharpe_ratio(r, rf_annual, periods_per_year),
        "benchmark_sharpe": sharpe_ratio(rb, rf_annual, periods_per_year),
        "sortino": sortino_ratio(r, rf_annual, periods_per_year),
        "beta": beta,
        "alpha": alpha,
        "correlation": corr,
        "tracking_error": tracking_error(r, rb, periods_per_year),
        "information_ratio": information_ratio(r, rb, periods_per_year),
        "up_capture": up,
        "down_capture": down,
        "var_95": var95,
        "cvar_95": cvar95,
        "max_drawdown": mdd["depth"],
        "max_drawdown_peak": mdd["peak"],
        "max_drawdown_trough": mdd["trough"],
        "max_drawdown_recovery": mdd["recovery"],
        "current_drawdown": _clean(drawdown_series(nav).iloc[-1]) if len(nav) else None,
        "benchmark_max_drawdown": max_drawdown(bench.reindex(nav.index).ffill()),
        "observations": int(len(r)),
        "periods_per_year": periods_per_year,
    }
    mdd_depth = out["max_drawdown"]
    if out["total_return"] is not None and mdd_depth and mdd_depth < 0:
        out["return_over_max_dd"] = _clean(out["total_return"] / abs(mdd_depth))
    else:
        out["return_over_max_dd"] = None

    if daily_nav is not None and len(daily_nav) >= 2:
        dr = simple_returns(daily_nav)
        dbr = simple_returns(daily_bench.reindex(daily_nav.index).ffill()) if daily_bench is not None else None
        out.update(
            {
                "win_rate_days": win_rate(dr),
                "best_day": _clean(dr.max()),
                "best_day_date": dr.idxmax(),
                "worst_day": _clean(dr.min()),
                "worst_day_date": dr.idxmin(),
                "days_outperformed": _clean(((dr - dbr).dropna() > 0).mean()) if dbr is not None else None,
                "positive_days": int((dr > 0).sum()),
                "negative_days": int((dr < 0).sum()),
            }
        )
    return out


CAP_BUCKETS = [
    ("Mega (>$200B)", 200e9),
    ("Large ($10–200B)", 10e9),
    ("Mid ($2–10B)", 2e9),
    ("Small ($300M–2B)", 300e6),
    ("Micro (<$300M)", 0.0),
]
REGION_OF = {
    "United States": "North America", "Canada": "North America", "Bermuda": "North America",
    "United Kingdom": "Europe", "Ireland": "Europe", "Netherlands": "Europe", "Germany": "Europe",
    "France": "Europe", "Switzerland": "Europe", "Denmark": "Europe", "Sweden": "Europe",
    "Belgium": "Europe", "Spain": "Europe", "Italy": "Europe", "Luxembourg": "Europe", "Jersey": "Europe",
    "Taiwan": "Asia Pacific", "Japan": "Asia Pacific", "China": "Asia Pacific", "Hong Kong": "Asia Pacific",
    "South Korea": "Asia Pacific", "Singapore": "Asia Pacific", "Australia": "Asia Pacific", "India": "Asia Pacific",
    "Israel": "Middle East", "Brazil": "Latin America", "Mexico": "Latin America",
}


def cap_bucket(mcap) -> str:
    if not mcap or mcap <= 0:
        return "Unknown"
    return next(label for label, floor in CAP_BUCKETS if mcap >= floor)


def look_through(holdings: list[dict], funds: dict[str, dict]) -> dict:
    names: dict[str, dict] = {}
    residuals = []

    def add(sym, name, w, source):
        rec = names.setdefault(sym, {"symbol": sym, "name": name, "weight": 0.0, "direct": 0.0, "via_etf": 0.0, "sources": []})
        rec["weight"] += w
        rec["direct" if source == "Direct" else "via_etf"] += w
        rec["sources"].append({"source": source, "weight": w})

    for h in holdings:
        if h["kind"] == "ETF":
            tops = funds.get(h["ticker"], {}).get("top_holdings", [])
            for th in tops:
                add(th["symbol"], th["name"], h["weight"] * th["weight"], h["ticker"])
            covered = sum(th["weight"] for th in tops)
            residuals.append({"etf": h["ticker"], "weight": h["weight"] * max(0.0, 1 - covered), "coverage": covered})
        else:
            add(h["ticker"], h["name"], h["weight"], "Direct")

    ranked = sorted(names.values(), key=lambda r: -abs(r["weight"]))
    return {
        "top": ranked[:10],
        "residuals": residuals,
        "explained_weight": sum(r["weight"] for r in ranked),
        "overlaps": [r for r in ranked if r["direct"] and r["via_etf"]],
    }


def distributions(holdings: list[dict], infos: dict, funds: dict, const_infos: dict, bench_sectors: dict, cash_weight: float) -> dict:
    sector: dict[str, float] = {}
    country: dict[str, float] = {}
    cap: dict[str, float] = {}
    asset = {"Single stocks": 0.0, "ETFs": 0.0, "Cash": cash_weight}

    def bump(d, k, w):
        d[k] = d.get(k, 0.0) + w

    for h in holdings:
        w = h["weight"]
        if h["kind"] == "Stock":
            asset["Single stocks"] += w
            info = infos.get(h["ticker"], {})
            bump(sector, info.get("sector") or "Unclassified", w)
            bump(country, info.get("country") or "Unknown", w)
            bump(cap, cap_bucket(info.get("marketCap")), w)
            continue
        asset["ETFs"] += w
        fund = funds.get(h["ticker"], {})
        sw = {k: v for k, v in (fund.get("sector_weightings") or {}).items() if v > 0}
        tot = sum(sw.values())
        for s, v in sw.items():
            bump(sector, s, w * v / tot)
        if not tot:
            bump(sector, "Unclassified", w)
        tops = [th for th in fund.get("top_holdings", []) if th["symbol"] in const_infos]
        tw = sum(th["weight"] for th in tops)
        if not tw:
            bump(country, "Unknown", w)
            bump(cap, "Unknown", w)
            continue
        for th in tops:
            ci, share = const_infos[th["symbol"]], w * th["weight"] / tw
            bump(country, ci.get("country") or "Unknown", share)
            bump(cap, cap_bucket(ci.get("marketCap")), share)

    region: dict[str, float] = {}
    for c, w in country.items():
        bump(region, "Unknown" if c == "Unknown" else REGION_OF.get(c, "Other"), w)

    bt = sum(bench_sectors.values()) or 1.0
    sector_rows = [
        {"name": s, "portfolio": sector.get(s, 0.0), "benchmark": bench_sectors.get(s, 0.0) / bt,
         "active": sector.get(s, 0.0) - bench_sectors.get(s, 0.0) / bt}
        for s in sorted(set(sector) | set(bench_sectors), key=lambda s: -sector.get(s, 0.0))
    ]
    cash_row = [{"name": "Cash", "weight": cash_weight}] if cash_weight else []
    if cash_weight:
        sector_rows.append({"name": "Cash", "portfolio": cash_weight, "benchmark": 0.0, "active": cash_weight})

    def rows(d):
        return [{"name": k, "weight": v} for k, v in sorted(d.items(), key=lambda kv: -kv[1]) if abs(v) > 1e-9]

    cap_order = [b for b, _ in CAP_BUCKETS] + ["Unknown"]
    return {
        "sector": sector_rows,
        "country": rows(country),
        "region": rows(region) + cash_row,
        "market_cap": sorted(rows(cap), key=lambda r: cap_order.index(r["name"])),
        "asset_class": rows(asset),
    }


def ex_ante_risk(adj: pd.DataFrame, weights: pd.Series, bench: str, rf_annual: float, nav: float, lookback: int = TRADING_DAYS) -> dict:
    rets = adj.pct_change(fill_method=None).iloc[1:].tail(lookback)
    bench_r = rets[bench]
    hold_r = rets.reindex(columns=list(weights.index)).apply(lambda c: c.fillna(bench_r))
    rf_d = rf_annual / TRADING_DAYS
    port_r = hold_r @ weights + (1 - weights.sum()) * rf_d
    w = weights.values
    cov = hold_r.cov().values * TRADING_DAYS
    vol = math.sqrt(max(float(w @ cov @ w), 0.0))
    rc = w * (cov @ w) / vol**2 if vol else np.zeros_like(w)
    q05 = np.quantile(port_r, 0.05)
    var95, cvar95 = float(-q05), float(-port_r[port_r <= q05].mean())
    order = list(weights.abs().sort_values(ascending=False).index)
    corr = hold_r.corr().loc[order, order].round(3)
    n = len(order)
    ann = math.sqrt(TRADING_DAYS)
    return {
        "ex_ante": {
            "volatility": vol,
            "benchmark_volatility": float(bench_r.std() * ann),
            "beta": _clean(port_r.cov(bench_r) / bench_r.var()),
            "tracking_error": float((port_r - bench_r).std() * ann),
            "var_95_1d": var95,
            "cvar_95_1d": cvar95,
            "var_95_1d_usd": var95 * nav,
            "cvar_95_1d_usd": cvar95 * nav,
            "diversification_ratio": _clean((np.abs(w) * np.sqrt(np.diag(cov))).sum() / vol) if vol else None,
            "avg_pairwise_correlation": float(corr.values[np.triu_indices(n, 1)].mean()) if n > 1 else None,
            "backcast_sharpe": _clean((port_r.mean() - rf_d) / port_r.std() * ann),
            "backcast_return_1y": float((1 + port_r).prod() - 1),
            "benchmark_return_1y": float((1 + bench_r).prod() - 1),
        },
        "risk_contribution": sorted(
            [{"ticker": t, "weight": float(wi), "risk_contribution": float(r)} for t, wi, r in zip(weights.index, w, rc)],
            key=lambda r: -r["risk_contribution"],
        ),
        "correlation": {"tickers": order, "matrix": corr.values.tolist()},
    }
