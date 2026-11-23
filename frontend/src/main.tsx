import clsx from 'clsx'
import {
  Activity, BarChart3, CheckCircle2, ChevronDown, CircleAlert, Layers, ListOrdered, Loader2, RefreshCw,
  ShieldAlert, Table2, TriangleAlert, Upload, UploadCloud, X,
} from 'lucide-react'
import { StrictMode, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts'
import './index.css'
import { api, bps, fmtDate, fmtDateTime, num, pct, relativeTime, tone, usd, type Dashboard, type Exposures as ExposuresData, type Params, type UploadResult } from './lib'
import { DeltaBadge, EmptyState, InfoTip, Skeleton } from './ui'
import { Exposures } from './views/Exposures'
import { Overview } from './views/Overview'
import { Positions } from './views/Positions'
import { Risk } from './views/Risk'
import { TradeLog } from './views/TradeLog'

interface Props {
  data: Dashboard | null
  benchmark: string
  onBenchmark: (b: string) => void
  onInitialCash: (v: number) => Promise<void>
  onRefresh: () => void
  refreshing: boolean
  onUpload: () => void
}

function TopBar({ data, benchmark, onBenchmark, onInitialCash, onRefresh, refreshing, onUpload }: Props) {
  const meta = data?.meta
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-4 px-6">
        <div className="flex items-center gap-2.5">
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-port/15 ring-1 ring-inset ring-port/30">
            <Activity size={15} className="text-port" strokeWidth={2.25} />
          </div>
          <div className="text-[15px] font-semibold tracking-[-0.01em]">IIM</div>
        </div>

        <div className="mx-2 h-6 w-px bg-line" />

        <div className="hidden items-center gap-2 text-xs text-ink-3 md:flex">
          <span className="relative flex h-2 w-2">
            {meta?.market_live && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pos opacity-50" />}
            <span className={clsx('relative inline-flex h-2 w-2 rounded-full', meta?.market_live ? 'bg-pos' : 'bg-ink-3')} />
          </span>
          <span className="text-ink-2">{meta ? (meta.market_live ? 'Market open' : 'Market closed') : 'Connecting…'}</span>
          {meta && (
            <>
              <span className="text-line-strong">·</span>
              <span>
                Prices as of <span className="num text-ink-2">{fmtDateTime(meta.as_of)} ET</span>
              </span>
              <span className="text-line-strong">·</span>
              <span title={meta.last_price_fetch ?? undefined}>Updated {relativeTime(meta.last_price_fetch ?? meta.generated_at)}</span>
            </>
          )}
          {meta && meta.warnings.length > 0 && (
            <InfoTip side="bottom">
              <span className="mb-1 flex items-center gap-1.5 font-medium text-ink">
                <CircleAlert size={12} className="text-warn" /> Data notes
              </span>
              <ul className="list-disc space-y-0.5 pl-4">
                {meta.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </InfoTip>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <label className="relative">
            <span className="sr-only">Benchmark</span>
            <select
              value={benchmark}
              onChange={(e) => onBenchmark(e.target.value)}
              className="focus-ring h-8 appearance-none rounded-lg border border-line bg-surface pl-3 pr-8 text-xs font-medium text-ink-2 hover:border-line-strong"
            >
              {(meta?.benchmarks ?? [{ value: '^GSPC', label: 'S&P 500 Index' }]).map((b) => (
                <option key={b.value} value={b.value}>
                  vs {b.label}
                </option>
              ))}
            </select>
            <ChevronDown size={13} className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-ink-3" />
          </label>

          <InitialCash value={meta?.initial_cash} onCommit={onInitialCash} />

          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-xs font-medium text-ink-2 transition-colors hover:border-line-strong hover:text-ink disabled:opacity-60"
          >
            <RefreshCw size={13} className={clsx(refreshing && 'animate-spin')} />
            {refreshing ? 'Refreshing' : 'Refresh prices'}
          </button>
          <button
            onClick={onUpload}
            className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-lg bg-port px-3 text-xs font-semibold text-white shadow-[0_0_0_1px_rgb(59_130_246/0.4),0_6px_20px_-6px_rgb(59_130_246/0.6)] transition hover:bg-[#4b8ef7]"
          >
            <Upload size={13} strokeWidth={2.25} />
            Upload Excel
          </button>
        </div>
      </div>
    </header>
  )
}

function InitialCash({ value, onCommit }: { value: number | undefined; onCommit: (v: number) => Promise<void> }) {
  const [draft, setDraft] = useState<string>('')
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState(false)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing && value != null) setDraft(value.toLocaleString('en-US'))
  }, [value, editing])

  const commit = async () => {
    const n = Number(draft.replace(/[$,\s]/g, ''))
    setEditing(false)
    if (!Number.isFinite(n) || n <= 0) {
      setError(true)
      setDraft(value?.toLocaleString('en-US') ?? '')
      setTimeout(() => setError(false), 1500)
      return
    }
    if (n !== value) await onCommit(n)
  }

  return (
    <label
      className={clsx(
        'group flex h-8 items-center gap-1.5 rounded-lg border bg-surface pl-3 pr-2 transition-colors',
        error ? 'border-neg/60' : editing ? 'border-port/60' : 'border-line hover:border-line-strong',
      )}
      title="Starting cash of the game account"
    >
      <span className="text-[11px] text-ink-3">Initial cash</span>
      <span className="num text-xs text-ink-3">$</span>
      <input
        ref={ref}
        value={draft}
        inputMode="decimal"
        onFocus={() => setEditing(true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') ref.current?.blur()
          if (e.key === 'Escape') {
            setDraft(value?.toLocaleString('en-US') ?? '')
            setEditing(false)
            setTimeout(() => ref.current?.blur())
          }
        }}
        className="num w-[92px] bg-transparent text-right text-xs font-medium text-ink outline-none"
      />
    </label>
  )
}

function Kpi({ label, tip, value, valueClass, foot, children }: { label: string; tip?: ReactNode; value: ReactNode; valueClass?: string; foot?: ReactNode; children?: ReactNode }) {
  return (
    <div className="card relative flex min-h-[124px] flex-col overflow-hidden px-4 pt-3.5 pb-3 animate-in">
      <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-ink-3">
        {label}
        {tip && <InfoTip side="bottom">{tip}</InfoTip>}
      </div>
      <div className={clsx('num mt-2 text-[22px] leading-none font-semibold tracking-[-0.02em]', valueClass ?? 'text-ink')}>{value}</div>
      <div className="mt-auto pt-3 text-[11.5px] text-ink-3">{foot}</div>
      {children}
    </div>
  )
}

function KpiStrip({ data }: { data: Dashboard | null }) {
  if (!data) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="card min-h-[124px] p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-4 h-6 w-32" />
            <Skeleton className="mt-6 h-3 w-24" />
          </div>
        ))}
      </div>
    )
  }
  const k = data.kpis
  const basis = data.meta.metrics_basis
  const spark = data.series.intraday.map((p) => ({ v: p.nav }))
  const sparkUp = spark.length > 1 && spark[spark.length - 1].v >= spark[0].v
  const benchName = data.meta.benchmark === 'SPY' ? 'SPY' : 'S&P 500'
  const basisNote =
    basis.frequency === 'daily'
      ? `Daily returns, ${basis.observations} obs, annualised ×√252.`
      : `Only ${data.meta.days_live} trading days live, so this is estimated from ${basis.observations} 30-minute returns, annualised ×√${basis.periods_per_year.toLocaleString()}. Switches to daily returns after 20 sessions.`

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Kpi
        label="Total NAV"
        value={usd(k.nav, { decimals: 0 })}
        foot={
          <span>
            <span className={clsx('num', tone(k.total_pnl))}>{usd(k.total_pnl, { sign: true })}</span> since inception
          </span>
        }
      >
        <div className="pointer-events-none absolute top-4 right-4 h-9 w-24 opacity-80">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={spark} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="spark" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={sparkUp ? '#10B981' : '#F43F5E'} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={sparkUp ? '#10B981' : '#F43F5E'} stopOpacity={0} />
                </linearGradient>
              </defs>
              <YAxis hide domain={['dataMin', 'dataMax']} />
              <Area type="monotone" dataKey="v" stroke={sparkUp ? '#10B981' : '#F43F5E'} strokeOpacity={0.8} strokeWidth={1.25} fill="url(#spark)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Kpi>

      <Kpi
        label="Total Return"
        tip={`Portfolio return since the first fill vs the ${data.meta.benchmark_label} over the identical window. Badge = active return.`}
        value={pct(k.total_return, { sign: true })}
        valueClass={tone(k.total_return)}
        foot={
          <span className="flex items-center gap-2">
            <DeltaBadge value={k.excess_return} format={(v) => bps(v)} />
            <span>
              {benchName} <span className="num text-ink-2">{pct(k.benchmark_return, { sign: true })}</span>
            </span>
          </span>
        }
      />

      <Kpi
        label="Daily P&L"
        tip="Mark-to-market change since the previous session close (includes intraday trades)."
        value={usd(k.daily_pnl, { sign: true })}
        valueClass={tone(k.daily_pnl)}
        foot={
          <span className="flex items-center gap-2">
            <span className={clsx('num', tone(k.daily_return))}>{pct(k.daily_return, { sign: true })}</span>
            <span>
              {benchName} <span className="num text-ink-2">{pct(k.benchmark_daily_return, { sign: true })}</span>
            </span>
          </span>
        }
      />

      <Kpi
        label="Cash Allocation"
        value={pct(k.cash_weight, { decimals: 1 })}
        foot={
          <div>
            <div className="mb-1.5 flex h-1.5 gap-[2px] overflow-hidden rounded-full">
              <div className="rounded-l-full bg-port" style={{ width: `${(k.invested_weight ?? 0) * 100}%` }} />
              <div className="flex-1 rounded-r-full bg-bench/50" />
            </div>
            <span className="num text-ink-2">{usd(k.cash, { compact: true })}</span> cash · <span className="num text-ink-2">{pct(k.invested_weight, { decimals: 1 })}</span> invested
          </div>
        }
      />

      <Kpi
        label="Sharpe Ratio"
        tip={
          <>
            Annualised, excess of the 13-week T-bill ({pct(data.meta.risk_free_rate)}). {basisNote}
          </>
        }
        value={num(k.sharpe, 2)}
        valueClass={tone(k.sharpe)}
        foot={
          <span>
            {benchName} <span className="num text-ink-2">{num(k.benchmark_sharpe, 2)}</span>
            {basis.frequency !== 'daily' && <span className="ml-1.5 rounded bg-warn/10 px-1 py-px text-[10px] text-warn">early est.</span>}
          </span>
        }
      />

      <Kpi
        label="Max Drawdown"
        tip="Largest peak-to-trough NAV decline since inception, measured on the finest available price grid."
        value={pct(k.max_drawdown)}
        valueClass={k.max_drawdown && k.max_drawdown < -0.0001 ? 'text-neg' : 'text-ink'}
        foot={
          <span>
            Now <span className="num text-ink-2">{pct(k.current_drawdown)}</span> · {benchName} <span className="num text-ink-2">{pct(k.benchmark_max_drawdown)}</span>
          </span>
        }
      />
    </div>
  )
}

function UploadModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<UploadResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setResult(null)
    setError(null)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const send = async (f: File) => {
    setBusy(true)
    setError(null)
    try {
      setResult(await api.upload(f))
      onSaved()
    } catch (e) {
      setError(`${f.name}: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-6 pt-[12vh] backdrop-blur-sm animate-in" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" className="card w-full max-w-lg shadow-2xl shadow-black/60" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">Upload trade blotter</h2>
            <p className="mt-0.5 text-xs text-ink-3">MarketWatch “Order history” export (.xlsx). Validated before it replaces anything; the old file is backed up.</p>
          </div>
          <button onClick={onClose} className="focus-ring rounded-md p-1 text-ink-3 hover:bg-surface-3 hover:text-ink" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="p-5">
          {result ? (
            <div className="flex items-start gap-3 rounded-lg border border-line bg-surface-2 px-4 py-3.5 animate-in">
              <CheckCircle2 size={18} className="mt-0.5 text-pos" />
              <div className="text-xs text-ink-3">
                <div className="text-sm font-medium text-ink">Imported {result.filename}</div>
                <div className="mt-1">
                  {result.rows} trades · {result.tickers.length} tickers · {fmtDateTime(result.first_trade)} – {fmtDateTime(result.last_trade)} · gross{' '}
                  <span className="num text-ink-2">{usd(result.gross_notional, { compact: true })}</span>
                </div>
                {result.warnings.map((w) => (
                  <div key={w} className="mt-1 text-warn">{w}</div>
                ))}
              </div>
            </div>
          ) : (
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragging(false)
                const f = e.dataTransfer.files?.[0]
                if (f) send(f)
              }}
              onClick={() => inputRef.current?.click()}
              className={clsx(
                'group flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-6 py-12 text-center transition-colors',
                dragging ? 'border-port bg-port/5' : 'border-line-strong hover:border-ink-3 hover:bg-surface-2',
              )}
            >
              {busy ? (
                <Loader2 size={28} className="animate-spin text-port" />
              ) : (
                <div className="grid h-12 w-12 place-items-center rounded-xl bg-surface-3 ring-1 ring-inset ring-line-strong transition group-hover:scale-105">
                  <UploadCloud size={22} className={dragging ? 'text-port' : 'text-ink-2'} />
                </div>
              )}
              <div className="mt-4 text-sm font-medium text-ink">{busy ? 'Validating…' : 'Drop your .xlsx here, or click to browse'}</div>
              <div className="mt-1 text-xs text-ink-3">Columns: Date (ET) · Ticker · Buy/Sell · Quantity · Price · optional Fee</div>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xlsm"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) send(f)
                  e.target.value = ''
                }}
              />
            </div>
          )}
          {error && (
            <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-neg/25 bg-neg/5 px-3.5 py-3 text-xs text-ink-2">
              <TriangleAlert size={14} className="mt-0.5 shrink-0 text-neg" />
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

type Tab = 'overview' | 'positions' | 'exposures' | 'risk' | 'trades'
const TABS: { id: Tab; label: string; icon: typeof BarChart3 }[] = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'positions', label: 'Positions & Attribution', icon: Table2 },
  { id: 'exposures', label: 'Exposures', icon: Layers },
  { id: 'risk', label: 'Risk Analytics', icon: ShieldAlert },
  { id: 'trades', label: 'Trade Log', icon: ListOrdered },
]
const AUTO_REFRESH_MS = 5 * 60_000
const stored = <T,>(key: string, fallback: T, parse: (s: string) => T): T => {
  const v = localStorage.getItem(key)
  return v == null ? fallback : parse(v)
}

function App() {
  const [tab, setTab] = useState<Tab>(() => stored('tab', 'overview' as Tab, (s) => s as Tab))
  const [params, setParams] = useState<Params>(() => ({
    benchmark: stored('benchmark', '^GSPC', String),
    initialCash: stored('initialCash', 10_000_000, Number),
  }))
  const [data, setData] = useState<Dashboard | null>(null)
  const [exposures, setExposures] = useState<ExposuresData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expError, setExpError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const reqId = useRef(0)

  const load = useCallback(async (p: Params, refresh = false) => {
    const id = ++reqId.current
    refresh ? setRefreshing(true) : setLoading(true)
    try {
      const d = refresh ? await api.refresh(p) : await api.dashboard(p)
      if (id !== reqId.current) return
      setData(d)
      setError(null)
      setExpError(null)
      api.exposures(p).then(
        (e) => id === reqId.current && setExposures(e),
        (e) => id === reqId.current && setExpError((e as Error).message),
      )
    } catch (e) {
      if (id === reqId.current) setError((e as Error).message)
    } finally {
      if (id === reqId.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [])

  useEffect(() => {
    localStorage.setItem('benchmark', params.benchmark)
    localStorage.setItem('initialCash', String(params.initialCash))
    load(params)
  }, [params, load])
  useEffect(() => localStorage.setItem('tab', tab), [tab])
  useEffect(() => {
    if (!data?.meta.market_live) return
    const t = setInterval(() => load(params), AUTO_REFRESH_MS)
    return () => clearInterval(t)
  }, [data?.meta.market_live, params, load])

  const update = (patch: Partial<Params>) => {
    setExposures(null)
    setParams((p) => ({ ...p, ...patch }))
  }

  return (
    <div className="min-h-full">
      <TopBar
        data={data}
        benchmark={params.benchmark}
        onBenchmark={(benchmark) => update({ benchmark })}
        onInitialCash={async (initialCash) => update({ initialCash })}
        onRefresh={() => load(params, true)}
        refreshing={refreshing}
        onUpload={() => setUploadOpen(true)}
      />

      <main className="mx-auto max-w-[1600px] space-y-5 px-6 pt-5 pb-16">
        {error && !data ? (
          <div className="card">
            <EmptyState
              icon={<TriangleAlert size={22} />}
              title="Could not load the portfolio"
              body={
                <>
                  {error}
                  <br />
                  Is the backend running on <span className="num text-ink-2">localhost:8000</span>?
                </>
              }
            />
          </div>
        ) : (
          <>
            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-warn/25 bg-warn/5 px-3.5 py-2 text-xs text-ink-2">
                <TriangleAlert size={13} className="text-warn" /> Showing last good data. Latest refresh failed: {error}
              </div>
            )}
            <KpiStrip data={data} />

            <nav className="flex items-center gap-1 border-b border-line" role="tablist">
              {TABS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className={clsx(
                    'focus-ring relative -mb-px flex items-center gap-2 rounded-t-md px-3.5 py-2.5 text-[13px] font-medium transition-colors',
                    tab === id ? 'text-ink' : 'text-ink-3 hover:text-ink-2',
                  )}
                >
                  <Icon size={14} className={tab === id ? 'text-port' : ''} />
                  {label}
                  {tab === id && <span className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-port" />}
                </button>
              ))}
              {data && (
                <span className="ml-auto hidden pb-2 text-[11px] text-ink-3 lg:block">
                  Inception {fmtDate(data.meta.inception, true)} · {data.meta.days_live} sessions · benchmark {data.meta.benchmark_label}
                </span>
              )}
            </nav>

            <div className={clsx('transition-opacity duration-200', (loading || refreshing) && data && 'opacity-60')}>
              {!data ? (
                <div className="card p-5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="mt-6 h-[300px] w-full" />
                </div>
              ) : (
                <div key={tab}>
                  {tab === 'overview' && <Overview data={data} exposures={exposures} />}
                  {tab === 'positions' && <Positions data={data} exposures={exposures} />}
                  {tab === 'exposures' && <Exposures data={exposures} error={expError} />}
                  {tab === 'risk' && <Risk data={data} exposures={exposures} />}
                  {tab === 'trades' && <TradeLog data={data} />}
                </div>
              )}
            </div>
          </>
        )}
      </main>

      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onSaved={() => {
          setExposures(null)
          load(params)
        }}
      />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
