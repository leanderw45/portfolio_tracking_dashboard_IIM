from __future__ import annotations

from dataclasses import dataclass, field
from datetime import time

import numpy as np
import pandas as pd

SIGN = {"BUY": 1.0, "COVER": 1.0, "SELL": -1.0, "SHORT": -1.0}
EPS = 1e-9
MARKET_CLOSE = time(16, 0)


@dataclass
class PositionState:
    ticker: str
    quantity: float = 0.0
    avg_cost: float = 0.0
    realized_pnl: float = 0.0
    fees: float = 0.0
    gross_bought: float = 0.0
    gross_sold: float = 0.0
    n_trades: int = 0
    opened_at: pd.Timestamp | None = None

    @property
    def cost_basis(self) -> float:
        return self.quantity * self.avg_cost


@dataclass
class Ledger:
    initial_cash: float
    cash: float
    positions: dict[str, PositionState] = field(default_factory=dict)
    trade_log: pd.DataFrame = field(default_factory=pd.DataFrame)

    @property
    def realized_pnl(self) -> float:
        return float(sum(p.realized_pnl for p in self.positions.values()))

    @property
    def fees(self) -> float:
        return float(sum(p.fees for p in self.positions.values()))

    def open_positions(self) -> dict[str, PositionState]:
        return {t: p for t, p in self.positions.items() if abs(p.quantity) > EPS}


def apply_trade(pos: PositionState, signed_qty: float, price: float, fee: float) -> float:
    realized = 0.0
    q0 = pos.quantity
    if abs(q0) < EPS or np.sign(q0) == np.sign(signed_qty):
        new_qty = q0 + signed_qty
        pos.avg_cost = (abs(q0) * pos.avg_cost + abs(signed_qty) * price) / abs(new_qty)
        pos.quantity = new_qty
    else:
        closing = min(abs(signed_qty), abs(q0))
        realized = closing * (price - pos.avg_cost) * np.sign(q0)
        new_qty = q0 + signed_qty
        if abs(new_qty) < EPS:
            pos.quantity, pos.avg_cost = 0.0, 0.0
        elif np.sign(new_qty) != np.sign(q0):
            pos.quantity, pos.avg_cost = new_qty, price
        else:
            pos.quantity = new_qty
    pos.realized_pnl += realized
    pos.fees += fee
    pos.n_trades += 1
    if signed_qty > 0:
        pos.gross_bought += signed_qty * price
    else:
        pos.gross_sold += -signed_qty * price
    return realized


def build_ledger(trades: pd.DataFrame, initial_cash: float) -> Ledger:
    ledger = Ledger(initial_cash=float(initial_cash), cash=float(initial_cash))
    rows = []
    for tr in trades.itertuples(index=False):
        signed = SIGN[tr.action] * tr.quantity
        pos = ledger.positions.setdefault(tr.ticker, PositionState(tr.ticker))
        if pos.opened_at is None or abs(pos.quantity) < EPS:
            pos.opened_at = tr.timestamp
        realized = apply_trade(pos, signed, tr.price, tr.fee)
        ledger.cash -= signed * tr.price + tr.fee
        rows.append(
            {
                **tr._asdict(),
                "signed_quantity": signed,
                "notional": tr.quantity * tr.price,
                "realized_pnl": realized,
                "position_after": pos.quantity,
                "avg_cost_after": pos.avg_cost,
                "cash_after": ledger.cash,
            }
        )
    ledger.trade_log = pd.DataFrame(rows)
    return ledger


def snapshot(
    ledger: Ledger,
    prices: dict[str, float],
    prev_close: dict[str, float] | None = None,
    prev_close_positions: dict[str, float] | None = None,
    today_flows: dict[str, float] | None = None,
) -> dict:
    prev_close = prev_close or {}
    prev_close_positions = prev_close_positions or {}
    today_flows = today_flows or {}

    rows = []
    for ticker, pos in ledger.positions.items():
        px = float(prices.get(ticker, pos.avg_cost if pos.avg_cost else 0.0))
        mv = pos.quantity * px
        unreal = pos.quantity * (px - pos.avg_cost)
        q_prev = prev_close_positions.get(ticker, 0.0)
        pc = prev_close.get(ticker, px)
        daily = mv - q_prev * pc - today_flows.get(ticker, 0.0)
        rows.append(
            {
                "ticker": ticker,
                "quantity": pos.quantity,
                "avg_cost": pos.avg_cost,
                "price": px,
                "prev_close": pc,
                "market_value": mv,
                "cost_basis": pos.cost_basis,
                "unrealized_pnl": unreal,
                "unrealized_pnl_pct": (px / pos.avg_cost - 1.0) * np.sign(pos.quantity) if pos.avg_cost else 0.0,
                "realized_pnl": pos.realized_pnl,
                "fees": pos.fees,
                "total_pnl": pos.realized_pnl + unreal - pos.fees,
                "daily_pnl": daily,
                "day_change_pct": px / pc - 1.0 if pc else 0.0,
                "n_trades": pos.n_trades,
                "is_open": abs(pos.quantity) > EPS,
                "opened_at": pos.opened_at,
            }
        )
    table = pd.DataFrame(rows)
    mv_total = float(table["market_value"].sum()) if len(table) else 0.0
    unreal_total = float(table["unrealized_pnl"].sum()) if len(table) else 0.0
    nav = ledger.cash + mv_total
    if len(table):
        table["weight"] = table["market_value"] / nav if nav else 0.0
        table["contribution"] = table["total_pnl"] / ledger.initial_cash
    totals = {
        "nav": nav,
        "cash": ledger.cash,
        "market_value": mv_total,
        "long_exposure": float(table.loc[table.market_value > 0, "market_value"].sum()) if len(table) else 0.0,
        "short_exposure": float(-table.loc[table.market_value < 0, "market_value"].sum()) if len(table) else 0.0,
        "realized_pnl": ledger.realized_pnl,
        "unrealized_pnl": unreal_total,
        "fees": ledger.fees,
        "total_pnl": nav - ledger.initial_cash,
        "initial_cash": ledger.initial_cash,
    }
    return {"positions": table, "totals": totals}


def positions_over_time(trades: pd.DataFrame, as_of: pd.DatetimeIndex) -> tuple[pd.DataFrame, pd.Series]:
    signed = trades["action"].map(SIGN) * trades["quantity"]
    flows = -(signed * trades["price"]) - trades["fee"]
    deltas = pd.DataFrame({"timestamp": trades["timestamp"], "ticker": trades["ticker"], "q": signed})
    pivot = deltas.pivot_table(index="timestamp", columns="ticker", values="q", aggfunc="sum").fillna(0.0).cumsum()
    cash = pd.Series(flows.values, index=trades["timestamp"]).groupby(level=0).sum().cumsum()

    pos = pivot.reindex(pivot.index.union(as_of)).ffill().fillna(0.0).reindex(as_of)
    cash_at = cash.reindex(cash.index.union(as_of)).ffill().fillna(0.0).reindex(as_of)
    return pos, cash_at


def nav_series(
    trades: pd.DataFrame,
    prices: pd.DataFrame,
    initial_cash: float,
    valuation_times: pd.DatetimeIndex | None = None,
) -> pd.DataFrame:
    valuation_times = prices.index if valuation_times is None else valuation_times
    tickers = sorted(trades["ticker"].unique())
    px = prices.reindex(columns=tickers).ffill()
    for t in tickers:
        first_px = trades.loc[trades.ticker == t, "price"].iloc[0]
        px[t] = px[t].fillna(first_px)

    pos, cash_flow = positions_over_time(trades, pd.DatetimeIndex(valuation_times))
    pos.index = prices.index
    cash = initial_cash + pd.Series(cash_flow.values, index=prices.index)
    mv = (pos.reindex(columns=tickers).fillna(0.0) * px).sum(axis=1)
    return pd.DataFrame({"nav": cash + mv, "cash": cash, "market_value": mv})


def daily_valuation_times(dates: pd.DatetimeIndex, tz: str = "America/New_York") -> pd.DatetimeIndex:
    naive = pd.DatetimeIndex(dates).tz_localize(None) if dates.tz is not None else pd.DatetimeIndex(dates)
    return (naive.normalize() + pd.Timedelta(hours=16)).tz_localize(tz)
