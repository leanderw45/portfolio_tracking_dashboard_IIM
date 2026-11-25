export type N = number | null

export interface SeriesPoint {
  t: string
  nav: number
  cash: number
  ret: number
  bench: number
  bench_ret: number
  dd: number
  bench_dd: number
}

export interface Position {
  ticker: string
  quantity: number
  avg_cost: number
  price: number
  prev_close: number
  market_value: number
  cost_basis: number
  unrealized_pnl: number
  unrealized_pnl_pct: number
  realized_pnl: number
  fees: number
  total_pnl: number
  daily_pnl: number
  day_change_pct: number
  n_trades: number
  is_open: boolean
  weight: number
  contribution: number
}

export interface Trade {
  trade_id: number
  timestamp: string
  ticker: string
  action: 'BUY' | 'SELL' | 'SHORT' | 'COVER'
  quantity: number
  price: number
  fee: number
  notional: number
  realized_pnl: number
  position_after: number
  avg_cost_after: number
  cash_after: number
}

export interface Dashboard {
  meta: {
    generated_at: string
    as_of: string
    last_price_fetch: string | null
    market_live: boolean
    inception: string
    first_trade: string
    days_live: number
    benchmark: string
    benchmark_label: string
    benchmarks: { value: string; label: string }[]
    initial_cash: number
    risk_free_rate: number
    metrics_basis: { frequency: string; periods_per_year: number; observations: number; rolling_window: number }
    warnings: string[]
    invariant_gap: number
  }
  kpis: {
    nav: number
    total_pnl: number
    total_return: number
    benchmark_return: N
    excess_return: N
    daily_pnl: number
    daily_return: N
    benchmark_daily_return: N
    cash: number
    cash_weight: N
    invested_weight: N
    sharpe: N
    benchmark_sharpe: N
    max_drawdown: N
    benchmark_max_drawdown: N
    current_drawdown: N
    realized_pnl: number
    unrealized_pnl: number
    fees: number
    positions_count: number
    winners: number
    losers: number
  }
  series: { intraday: SeriesPoint[]; daily: SeriesPoint[] }
  positions: Position[]
  movers: { ticker: string; pnl: number; pnl_pct: number; daily_pnl: number; day_change_pct: number }[]
  allocation: { name: string; weight: number; market_value: number }[]
  risk: Record<string, N | string | undefined> & {
    rolling: { t: string; vol: number; bench_vol: number; beta: number }[]
  }
  trades: Trade[]
}

export interface Exposures {
  holdings: { ticker: string; name: string; kind: 'ETF' | 'Stock'; weight: number; market_value: number; sector: string | null }[]
  look_through: {
    top: { symbol: string; name: string; weight: number; direct: number; via_etf: number; sources: { source: string; weight: number }[] }[]
    explained_weight: number
    overlaps: { symbol: string }[]
  }
  distributions: {
    sector: { name: string; portfolio: number; benchmark: number; active: number }[]
    country: { name: string; weight: number }[]
    region: { name: string; weight: number }[]
    market_cap: { name: string; weight: number }[]
    asset_class: { name: string; weight: number }[]
  }
  ex_ante: {
    volatility: number
    benchmark_volatility: number
    beta: N
    tracking_error: number
    var_95_1d: number
    cvar_95_1d: number
    var_95_1d_usd: number
    cvar_95_1d_usd: number
    diversification_ratio: N
    avg_pairwise_correlation: N
    backcast_sharpe: N
    backcast_return_1y: number
    benchmark_return_1y: number
  }
  risk_contribution: { ticker: string; weight: number; risk_contribution: number }[]
  correlation: { tickers: string[]; matrix: number[][] }
  etfs: { ticker: string; name: string; weight: number; expense_ratio: N; annual_fee_usd: N; top10_coverage: N; top_holdings: { symbol: string; name: string; weight: number }[] }[]
  etf_expense_ratio: N
  annual_etf_fees_usd: number
  benchmark_label: string
}

export interface UploadResult {
  filename: string
  rows: number
  tickers: string[]
  first_trade: string
  last_trade: string
  gross_notional: number
  warnings: string[]
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (body?.detail) msg = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
    } catch {
          }
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

export interface Params {
  benchmark: string
  initialCash: number
}
const qs = (p: Params) => `?benchmark=${encodeURIComponent(p.benchmark)}&initial_cash=${p.initialCash}`

export const api = {
  dashboard: (p: Params) => req<Dashboard>(`/api/dashboard${qs(p)}`),
  exposures: (p: Params) => req<Exposures>(`/api/exposures${qs(p)}`),
  refresh: (p: Params) => req<Dashboard>(`/api/refresh${qs(p)}`, { method: 'POST' }),
  upload: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return req<UploadResult>('/api/upload', { method: 'POST', body: fd })
  },
}

const DASH = '—'
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function usd(v: N | undefined, opts: { decimals?: number; sign?: boolean; compact?: boolean } = {}): string {
  if (!isNum(v)) return DASH
  const { decimals = 0, sign = false, compact = false } = opts
  const abs = Math.abs(v)
  let body: string
  if (compact && abs >= 1e3) {
    const units: [number, string][] = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']]
    const [div, suffix] = units.find(([d]) => abs >= d)!
    const val = abs / div
    body = `$${val.toFixed(val >= 100 ? 0 : val >= 10 ? 1 : 2)}${suffix}`
  } else {
    body = '$' + abs.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  }
  const prefix = v < 0 ? '−' : sign && v > 0 ? '+' : ''
  return prefix + body
}

export function pct(v: N | undefined, opts: { decimals?: number; sign?: boolean } = {}): string {
  if (!isNum(v)) return DASH
  const { decimals = 2, sign = false } = opts
  const s = Math.abs(v * 100).toFixed(decimals)
  const prefix = v < 0 && Number(s) !== 0 ? '−' : sign && v > 0 && Number(s) !== 0 ? '+' : ''
  return `${prefix}${s}%`
}

export function num(v: N | undefined, decimals = 2, opts: { sign?: boolean } = {}): string {
  if (!isNum(v)) return DASH
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  return (v < 0 && Number(s.replace(/,/g, '')) !== 0 ? '−' : opts.sign && v > 0 ? '+' : '') + s
}

export function bps(v: N | undefined, sign = true): string {
  if (!isNum(v)) return DASH
  const b = Math.round(v * 10000)
  return `${b < 0 ? '−' : sign && b > 0 ? '+' : ''}${Math.abs(b).toLocaleString('en-US')} bps`
}

export function shares(v: number): string {
  return v.toLocaleString('en-US', { maximumFractionDigits: 4 })
}

export function tone(v: N | undefined, invert = false): string {
  if (!isNum(v) || Math.abs(v) < 1e-12) return 'text-ink-2'
  return (v > 0) !== invert ? 'text-pos' : 'text-neg'
}

export const NY_TZ = 'America/New_York'

export function fmtDateTime(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = {}): string {
  if (!iso) return DASH
  return new Date(iso).toLocaleString('en-US', {
    timeZone: NY_TZ,
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...opts,
  })
}

export function fmtDate(iso: string | null | undefined, withYear = false): string {
  if (!iso) return DASH
  return new Date(iso).toLocaleDateString('en-US', { timeZone: NY_TZ, month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}) })
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: NY_TZ, hour: '2-digit', minute: '2-digit', hour12: false })
}

export function nyDayKey(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: NY_TZ })
}

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return DASH
  const s = Math.round((now - new Date(iso).getTime()) / 1000)
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}
