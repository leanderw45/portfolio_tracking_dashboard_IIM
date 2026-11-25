# IIM

Portfolio performance, attribution, exposure and risk dashboard for IIM.
The benchmark is the S&P 500, as the index (`^GSPC`, default) or as the SPY ETF.

```
backend/app/
  data_loader.py       Excel blotter → validated trades
  market_data.py       yfinance + on-disk cache
  portfolio_engine.py  accounting (positions, cash, P&L, NAV series)
  metrics.py           performance/risk stats, look-through, ex-ante risk
  main.py              FastAPI endpoints + orchestration
backend/tests/test_engine.py
frontend/src/
  main.tsx             app shell, top bar, KPI strip, upload modal
  lib.ts               API client, types, formatting
  ui.tsx               shared components + bar charts
  views/               Overview · Positions · Exposures · Risk · TradeLog
data/trades.xlsx       the MarketWatch order-history export
start.sh               one-command launcher
```

## Run

```bash
./start.sh            # backend :8000 + frontend http://localhost:5173
```

On first run this creates `backend/.venv` and installs `frontend/node_modules`. To run the pieces separately:

```bash
cd backend  && .venv/bin/uvicorn app.main:app --reload --port 8000
cd frontend && npm run dev
cd backend  && .venv/bin/python -m pytest      # tests
```

## Input file

`data/trades.xlsx` is the MarketWatch "Order history" export, used as-is:
`Date (ET) | Ticker | Buy/Sell | Quantity | Price`, with an optional `Fee` column. Buy, Sell, Short and Cover are
all supported, and fees are $0 when the column is missing. **Upload Excel** in the UI validates a new file
before it replaces the old one, and keeps a `data/trades.backup-*.xlsx` copy.

**Initial cash** (default $10M) and the **benchmark** are set in the top bar. They are stored in the browser
and sent with each request.

## How the numbers are computed

- **Accounting** uses average cost with signed positions. The tests check that
  `Initial Cash + Realized + Unrealized − Fees == NAV == Cash + Σ Market Value` on hand-built cases,
  randomised long/short sequences and the real blotter. The API also reports the live `invariant_gap`, which
  should always be 0.
- **Performance window.** Everything is measured from `START_DATE` in `backend/app/main.py` (Nov 1, 2026), so
  the weeks spent in cash before the first trade count toward return, Sharpe, drawdown and the benchmark
  comparison. The benchmark is rebased to its last close on or before that date.
- **Realised risk** covers Sharpe, Sortino, volatility, beta, alpha, tracking error, capture ratios, VaR,
  drawdown and win rate, using the 13-week T-bill as the risk-free rate. For the first 20 sessions these come
  from 30-minute returns and are flagged as an *early estimate*; after that they use daily returns.
- **Exposures.** ETFs are looked through to their top-10 holdings and combined with the single stocks by
  issuer. The tab shows the top 10 names, sector weights vs the S&P 500, region, market cap and asset class.
- **Ex-ante risk** applies today's weights to one year of daily returns. It shows volatility, beta, tracking
  error, 1-day VaR/CVaR, each position's risk contribution vs its weight, and the correlation matrix.

Market data comes from Yahoo Finance and is cached in `backend/.cache/`: prices for 5 minutes, fundamentals and
ETF holdings for 7 days. **Refresh prices** clears the price cache. If Yahoo is unreachable, the app serves the
last cached data.

**Limitations.** Positions are valued at price only (no dividends), and `^GSPC` is a price index. ETF
look-through only sees each fund's top-10 holdings, about 50–60% of each ETF.
