from __future__ import annotations

import json
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pandas as pd
import yfinance as yf

log = logging.getLogger(__name__)
MARKET_TZ = "America/New_York"

INFO_FIELDS = ("shortName", "longName", "quoteType", "sector", "country", "marketCap", "category", "netExpenseRatio")

SECTOR_KEY_TO_NAME = {
    "realestate": "Real Estate",
    "consumer_cyclical": "Consumer Cyclical",
    "basic_materials": "Basic Materials",
    "consumer_defensive": "Consumer Defensive",
    "technology": "Technology",
    "communication_services": "Communication Services",
    "financial_services": "Financial Services",
    "utilities": "Utilities",
    "industrials": "Industrials",
    "energy": "Energy",
    "healthcare": "Healthcare",
}


def _json_safe(v):
    if isinstance(v, float) and (v != v or v in (float("inf"), float("-inf"))):
        return None
    return v


class MarketData:
    def __init__(self, cache_dir: Path, price_ttl: int = 300, meta_ttl: int = 7 * 86400):
        self.cache_dir = Path(cache_dir)
        self.price_ttl = price_ttl
        self.meta_ttl = meta_ttl
        self._lock = threading.RLock()
        self.warnings: list[str] = []
        self.last_fetch: float | None = None
        (self.cache_dir / "meta").mkdir(parents=True, exist_ok=True)

    def _price_paths(self, interval: str, ticker: str) -> tuple[Path, Path]:
        d = self.cache_dir / "prices" / interval
        d.mkdir(parents=True, exist_ok=True)
        safe = ticker.replace("^", "_IDX_").replace("/", "_")
        return d / f"{safe}.pkl", d / f"{safe}.json"

    def _read_cached(self, interval: str, ticker: str):
        pkl, meta = self._price_paths(interval, ticker)
        if not (pkl.exists() and meta.exists()):
            return None, None
        try:
            return pd.read_pickle(pkl), json.loads(meta.read_text())
        except Exception:
            return None, None

    def _write_cached(self, interval: str, ticker: str, df: pd.DataFrame, start: pd.Timestamp) -> None:
        pkl, meta = self._price_paths(interval, ticker)
        df.to_pickle(pkl)
        meta.write_text(json.dumps({"fetched_at": time.time(), "start": start.isoformat()}))

    def invalidate_prices(self) -> None:
        with self._lock:
            for meta in (self.cache_dir / "prices").rglob("*.json"):
                try:
                    m = json.loads(meta.read_text())
                    m["fetched_at"] = 0
                    meta.write_text(json.dumps(m))
                except Exception:
                    meta.unlink(missing_ok=True)

    def _download(self, tickers: list[str], start: pd.Timestamp, interval: str) -> dict[str, pd.DataFrame]:
        data = yf.download(
            tickers,
            start=start.strftime("%Y-%m-%d"),
            interval=interval,
            auto_adjust=False,
            actions=False,
            progress=False,
            group_by="ticker",
            threads=True,
        )
        out: dict[str, pd.DataFrame] = {}
        if data is None or data.empty:
            return out
        if isinstance(data.columns, pd.MultiIndex):
            for t in tickers:
                if t in data.columns.get_level_values(0):
                    df = data[t].dropna(how="all")
                    if not df.empty:
                        out[t] = df
        elif len(tickers) == 1:
            out[tickers[0]] = data.dropna(how="all")
        return out

    def history(self, tickers: list[str], start: pd.Timestamp, interval: str = "1d") -> dict[str, pd.DataFrame]:
        tickers = sorted(set(tickers))
        start = pd.Timestamp(start).tz_localize(None) if pd.Timestamp(start).tzinfo else pd.Timestamp(start)
        start = start.normalize()
        result: dict[str, pd.DataFrame] = {}
        stale: list[str] = []
        with self._lock:
            now = time.time()
            for t in tickers:
                df, meta = self._read_cached(interval, t)
                if df is not None and meta and pd.Timestamp(meta["start"]) <= start and now - meta["fetched_at"] < self.price_ttl:
                    result[t] = df
                else:
                    stale.append(t)
                    if df is not None:
                        result[t] = df
            if stale:
                try:
                    fetched = self._download(stale, start, interval)
                    self.last_fetch = time.time()
                    for t, df in fetched.items():
                        self._write_cached(interval, t, df, start)
                        result[t] = df
                    missing = [t for t in stale if t not in fetched]
                    if missing:
                        self._warn(f"No {interval} data returned for: {', '.join(missing)}")
                except Exception as exc:
                    log.exception("price download failed")
                    self._warn(f"Price refresh failed ({exc.__class__.__name__}); serving cached data.")
        return {t: self._localise(df, interval) for t, df in result.items()}

    @staticmethod
    def _localise(df: pd.DataFrame, interval: str) -> pd.DataFrame:
        df = df.copy()
        idx = pd.DatetimeIndex(df.index)
        if interval == "1d":
            df.index = idx.tz_localize(None) if idx.tz is not None else idx
        else:
            df.index = (idx.tz_localize("UTC") if idx.tz is None else idx).tz_convert(MARKET_TZ)
        return df[~df.index.duplicated(keep="last")].sort_index()

    def close_frame(self, tickers: list[str], start, interval: str = "1d", field: str = "Close") -> pd.DataFrame:
        hist = self.history(tickers, start, interval)
        cols = {t: df[field] for t, df in hist.items() if field in df}
        return pd.DataFrame(cols).sort_index()

    def _warn(self, msg: str) -> None:
        if msg not in self.warnings:
            self.warnings.append(msg)
        self.warnings = self.warnings[-10:]

    def _meta_path(self, kind: str, ticker: str) -> Path:
        return self.cache_dir / "meta" / f"{kind}_{ticker.replace('^', '_IDX_')}.json"

    def _cached_meta(self, kind: str, ticker: str, loader) -> dict:
        path = self._meta_path(kind, ticker)
        if path.exists():
            try:
                blob = json.loads(path.read_text())
                if time.time() - blob.get("_fetched_at", 0) < self.meta_ttl:
                    return blob
            except Exception:
                pass
        try:
            blob = loader(ticker)
            blob["_fetched_at"] = time.time()
            path.write_text(json.dumps(blob, default=str))
            return blob
        except Exception as exc:
            log.warning("metadata fetch failed for %s: %s", ticker, exc)
            if path.exists():
                try:
                    return json.loads(path.read_text())
                except Exception:
                    pass
            return {"_error": str(exc)}

    @staticmethod
    def _load_info(ticker: str) -> dict:
        info = yf.Ticker(ticker).info or {}
        return {k: _json_safe(info.get(k)) for k in INFO_FIELDS}

    @staticmethod
    def _load_fund(ticker: str) -> dict:
        fd = yf.Ticker(ticker).funds_data
        top = fd.top_holdings
        holdings = []
        if top is not None and not top.empty:
            for sym, row in top.iterrows():
                holdings.append({"symbol": str(sym), "name": str(row.get("Name", sym)), "weight": float(row["Holding Percent"])})
        sectors = {SECTOR_KEY_TO_NAME.get(k, k): float(v) for k, v in (fd.sector_weightings or {}).items()}
        return {"top_holdings": holdings, "sector_weightings": sectors}

    def info(self, ticker: str) -> dict:
        return self._cached_meta("info", ticker, self._load_info)

    def fund(self, ticker: str) -> dict:
        return self._cached_meta("fund", ticker, self._load_fund)

    def info_many(self, tickers: list[str], workers: int = 8) -> dict[str, dict]:
        tickers = sorted(set(tickers))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            return dict(zip(tickers, pool.map(self.info, tickers)))

    def risk_free_rate(self) -> float:
        try:
            irx = self.close_frame(["^IRX"], pd.Timestamp.now() - pd.Timedelta(days=14), "1d")
            val = float(irx["^IRX"].dropna().iloc[-1]) / 100.0
            if 0 <= val < 0.25:
                return val
        except Exception:
            pass
        return 0.04
