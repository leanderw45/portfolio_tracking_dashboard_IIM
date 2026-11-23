from __future__ import annotations

import io
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

import pandas as pd

MARKET_TZ = "America/New_York"

COLUMN_ALIASES: dict[str, tuple[str, ...]] = {
    "timestamp": ("date (et)", "date", "datetime", "time", "trade date", "timestamp", "date/time"),
    "ticker": ("ticker", "symbol", "security"),
    "action": ("buy/sell", "action", "side", "type", "transaction", "order type"),
    "quantity": ("quantity", "qty", "shares", "amount"),
    "price": ("price", "fill price", "execution price", "avg price"),
    "fee": ("fee", "fees", "commission", "commissions"),
}
REQUIRED = ("timestamp", "ticker", "action", "quantity", "price")

ACTION_MAP = {
    "buy": "BUY",
    "b": "BUY",
    "sell": "SELL",
    "s": "SELL",
    "short": "SHORT",
    "sell short": "SHORT",
    "short sell": "SHORT",
    "cover": "COVER",
    "buy to cover": "COVER",
}


class TradeFileError(ValueError):
    pass


@dataclass(frozen=True)
class LoadResult:
    trades: pd.DataFrame
    sheet: str
    header_row: int
    warnings: list[str]


def _normalise(label: object) -> str:
    return str(label).strip().lower() if pd.notna(label) else ""


def _find_header_row(raw: pd.DataFrame, scan_rows: int = 25) -> int:
    ticker_aliases = set(COLUMN_ALIASES["ticker"])
    price_aliases = set(COLUMN_ALIASES["price"])
    for idx in range(min(scan_rows, len(raw))):
        cells = {_normalise(v) for v in raw.iloc[idx].tolist()}
        if cells & ticker_aliases and cells & price_aliases:
            return idx
    raise TradeFileError("Could not find a header row containing 'Ticker' and 'Price' columns.")


def _map_columns(header: list[object]) -> dict[int, str]:
    mapping: dict[int, str] = {}
    for pos, label in enumerate(header):
        norm = _normalise(label)
        for canonical, aliases in COLUMN_ALIASES.items():
            if norm in aliases and canonical not in mapping.values():
                mapping[pos] = canonical
                break
    missing = [c for c in REQUIRED if c not in mapping.values()]
    if missing:
        raise TradeFileError(f"Missing required column(s): {', '.join(missing)}.")
    return mapping


def _to_number(series: pd.Series, name: str) -> pd.Series:
    cleaned = series.astype(str).str.replace(r"[$,\s]", "", regex=True)
    out = pd.to_numeric(cleaned, errors="coerce")
    bad = out.isna() & series.notna()
    if bad.any():
        rows = ", ".join(str(i) for i in series.index[bad][:5])
        raise TradeFileError(f"Non-numeric {name} value(s) in row(s) {rows}.")
    return out


def parse_trades(source: str | Path | bytes | BinaryIO) -> LoadResult:
    if isinstance(source, (bytes, bytearray)):
        source = io.BytesIO(source)
    try:
        book = pd.ExcelFile(source, engine="openpyxl")
    except Exception as exc:
        raise TradeFileError(f"Not a readable .xlsx workbook ({exc.__class__.__name__}).") from exc

    last_error: Exception | None = None
    for sheet in book.sheet_names:
        raw = pd.read_excel(book, sheet_name=sheet, header=None, dtype=object)
        if raw.dropna(how="all").empty:
            continue
        try:
            header_row = _find_header_row(raw)
        except TradeFileError as exc:
            last_error = exc
            continue
        mapping = _map_columns(raw.iloc[header_row].tolist())
        body = raw.iloc[header_row + 1 :, list(mapping)].copy()
        body.columns = [mapping[c] for c in mapping]
        body = body.dropna(how="all")
        trades, warnings = _validate(body)
        return LoadResult(trades=trades, sheet=sheet, header_row=header_row, warnings=warnings)

    raise last_error or TradeFileError("Workbook contains no trade data.")


def _validate(body: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    warnings: list[str] = []
    excel_rows = body.index + 1
    body = body.set_index(excel_rows)

    ts = pd.to_datetime(body["timestamp"], errors="coerce")
    if ts.isna().any():
        raise TradeFileError(f"Unparseable date in row(s) {', '.join(map(str, ts.index[ts.isna()][:5]))}.")
    if ts.dt.tz is None:
        ts = ts.dt.tz_localize(MARKET_TZ, ambiguous="NaT", nonexistent="shift_forward")
    else:
        ts = ts.dt.tz_convert(MARKET_TZ)

    ticker = body["ticker"].astype(str).str.strip().str.upper()
    if (ticker == "") .any() or ticker.eq("NAN").any():
        raise TradeFileError("Blank ticker found.")

    action_raw = body["action"].astype(str).str.strip().str.lower()
    action = action_raw.map(ACTION_MAP)
    if action.isna().any():
        bad = sorted(set(action_raw[action.isna()]))
        raise TradeFileError(f"Unknown action(s): {', '.join(bad)}. Expected Buy, Sell, Short or Cover.")

    qty = _to_number(body["quantity"], "quantity")
    price = _to_number(body["price"], "price")
    if (qty <= 0).any():
        raise TradeFileError("Quantities must be strictly positive (direction comes from Buy/Sell).")
    if (price <= 0).any():
        raise TradeFileError("Prices must be strictly positive.")

    fee = _to_number(body["fee"], "fee").fillna(0.0) if "fee" in body else pd.Series(0.0, index=body.index)
    if (fee < 0).any():
        raise TradeFileError("Fees must be non-negative.")
    if "fee" not in body:
        warnings.append("No fee/commission column found; fees assumed to be $0.")

    trades = pd.DataFrame(
        {
            "timestamp": ts,
            "ticker": ticker,
            "action": action,
            "quantity": qty.astype(float),
            "price": price.astype(float),
            "fee": fee.astype(float),
        }
    )
    trades = trades.sort_values("timestamp", kind="stable").reset_index(drop=True)
    trades.insert(0, "trade_id", range(1, len(trades) + 1))
    return trades, warnings
