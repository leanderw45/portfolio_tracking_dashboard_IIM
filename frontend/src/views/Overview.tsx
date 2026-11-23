import { useMemo, useState } from 'react'
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { bps, fmtDate, fmtDateTime, num, nyDayKey, pct, tone, usd, type Dashboard, type Exposures, type SeriesPoint } from '../lib'
import { BENCH, Card, DivergingBars, Legend, PORT, RankedBars, Segmented, SegmentedBar, Stat, TooltipShell } from '../ui'

export function Overview({ data, exposures }: { data: Dashboard; exposures: Exposures | null }) {
  const [moverMode, setMoverMode] = useState<'total' | 'today'>('total')
  const k = data.kpis

  const movers = useMemo(() => {
    const key = moverMode === 'total' ? 'pnl' : 'daily_pnl'
    const sorted = [...data.movers].sort((a, b) => b[key] - a[key])
    const winners = sorted.filter((m) => m[key] > 0).slice(0, 5)
    const losers = sorted.filter((m) => m[key] <= 0).slice(-5)
    return [...winners, ...losers].map((m) => ({
      key: m.ticker,
      label: m.ticker,
      value: m[key],
      display: usd(m[key], { sign: true }),
      detail: pct(moverMode === 'total' ? m.pnl_pct : m.day_change_pct, { sign: true }),
    }))
  }, [data.movers, moverMode])

  const kinds = useMemo(() => Object.fromEntries((exposures?.holdings ?? []).map((h) => [h.ticker, h.kind])), [exposures])
  const alloc = data.allocation
  const holdings = alloc.filter((a) => a.name !== 'Cash').sort((a, b) => b.weight - a.weight)
  const cash = alloc.find((a) => a.name === 'Cash')
  const etfW = holdings.filter((h) => kinds[h.name] === 'ETF').reduce((s, h) => s + h.weight, 0)
  const stockW = holdings.filter((h) => kinds[h.name] === 'Stock').reduce((s, h) => s + h.weight, 0)

  return (
    <div className="space-y-4">
      <EquityCurve data={data} />

      <div className="grid gap-4 lg:grid-cols-[1.05fr_1fr]">
        <Card title="Allocation" subtitle={`${k.positions_count} positions + cash · % of NAV`}>
          {exposures && (
            <div className="mb-5">
              <SegmentedBar
                parts={[
                  { key: 'stk', value: stockW, color: '#3B82F6', label: 'Single stocks', display: pct(stockW, { decimals: 1 }) },
                  { key: 'etf', value: etfW, color: '#9085E9', label: 'ETFs', display: pct(etfW, { decimals: 1 }) },
                  { key: 'cash', value: cash?.weight ?? 0, color: '#3A4250', label: 'Cash', display: pct(cash?.weight, { decimals: 1 }) },
                ]}
              />
            </div>
          )}
          <RankedBars
            rows={[
              ...holdings.map((h) => ({
                key: h.name,
                label: (
                  <span className="flex items-center gap-2">
                    {h.name}
                    {kinds[h.name] === 'ETF' && <span className="rounded bg-surface-3 px-1 text-[9.5px] font-medium tracking-wide text-ink-3">ETF</span>}
                  </span>
                ),
                value: h.weight,
                display: pct(h.weight, { decimals: 1 }),
                sub: usd(h.market_value, { compact: true }),
              })),
              ...(cash ? [{ key: 'Cash', label: <span className="text-ink-2">Cash</span>, value: cash.weight, display: pct(cash.weight, { decimals: 1 }), sub: usd(cash.market_value, { compact: true }), muted: true }] : []),
            ]}
            labelWidth="88px"
          />
        </Card>

        <div className="flex flex-col gap-4">
          <Card
            title="Top winners & losers"
            subtitle={moverMode === 'total' ? 'Unrealised + realised P&L since entry' : 'Mark-to-market P&L since previous close'}
            actions={
              <Segmented
                size="xs"
                options={[
                  { value: 'total', label: 'Since entry' },
                  { value: 'today', label: 'Today' },
                ]}
                value={moverMode}
                onChange={setMoverMode}
              />
            }
          >
            <DivergingBars rows={movers} />
          </Card>

          <Card title="P&L composition">
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
              <Stat label="Unrealised" value={usd(k.unrealized_pnl, { sign: true })} valueClass={tone(k.unrealized_pnl)} />
              <Stat label="Realised" value={usd(k.realized_pnl, { sign: true })} valueClass={tone(k.realized_pnl)} />
              <Stat label="Fees" value={usd(-k.fees)} valueClass={k.fees ? 'text-neg' : 'text-ink-2'} />
              <Stat label="Hit rate" value={`${k.winners}/${k.positions_count}`} sub={`${pct(k.winners / Math.max(k.positions_count, 1), { decimals: 0 })} of positions green`} />
              <Stat label="Active return" value={bps(k.excess_return)} valueClass={tone(k.excess_return)} sub={`vs ${data.meta.benchmark_label}`} />
              <Stat label="Beta (realised)" value={num(data.risk.beta as number | null, 2)} sub={`${data.meta.metrics_basis.observations} obs`} />
              <Stat label="Effective # of bets" value={num(data.risk.concentration_effective_n as number | null, 1)} tip="1 / Σw² over invested weights. A portfolio of N equal-weight names scores N." />
              <Stat label="Days live" value={data.meta.days_live} sub="trading sessions" />
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

type Mode = 'pct' | 'nav'
type Range = '1W' | '1M' | 'ALL'
const RANGE_DAYS: Record<Range, number> = { '1W': 7, '1M': 31, ALL: Infinity }

interface Pt {
  i: number
  t: string
  port: number
  bench: number
  portRet: number
  benchRet: number
}

function windowed(series: SeriesPoint[], days: number): SeriesPoint[] {
  if (!series.length || !Number.isFinite(days)) return series
  const end = new Date(series[series.length - 1].t).getTime()
  const start = end - days * 86_400_000
  const idx = series.findIndex((p) => new Date(p.t).getTime() >= start)
  return series.slice(Math.max(0, idx - (idx > 0 ? 1 : 0)))
}

function EquityCurve({ data }: { data: Dashboard }) {
  const [mode, setMode] = useState<Mode>('pct')
  const [range, setRange] = useState<Range>('ALL')
  const benchLabel = data.meta.benchmark === 'SPY' ? 'SPY' : 'S&P 500'

  const { pts, intraday } = useMemo(() => {
    const days = RANGE_DAYS[range]
    const daily = windowed(data.series.daily, days)
    const intra = windowed(data.series.intraday, days)
    const useIntra = range === '1W' || daily.length < 15
    const src = useIntra && intra.length > 1 ? intra : daily
    const p0 = src[0]
    const pts: Pt[] = src.map((p, i) => ({
      i,
      t: p.t,
      port: p.nav,
      bench: (p0.nav * p.bench) / p0.bench,
      portRet: p.nav / p0.nav - 1,
      benchRet: p.bench / p0.bench - 1,
    }))
    return { pts, intraday: useIntra && intra.length > 1 }
  }, [data, range])

  const ticks = useMemo(() => {
    if (!intraday) {
      const step = Math.max(1, Math.ceil(pts.length / 8))
      return pts.filter((_, i) => i % step === 0).map((p) => p.i)
    }
    const out: number[] = []
    let prev = ''
    for (const p of pts) {
      const k = nyDayKey(p.t)
      if (k !== prev) out.push(p.i)
      prev = k
    }
    return out
  }, [pts, intraday])

  const last = pts[pts.length - 1]
  const yKeyP = mode === 'pct' ? 'portRet' : 'port'
  const yKeyB = mode === 'pct' ? 'benchRet' : 'bench'
  const fmtY = (v: number) => (mode === 'pct' ? pct(v, { decimals: 1 }) : usd(v, { compact: true }))
  const active = last ? last.portRet - last.benchRet : null

  return (
    <Card
      title="Equity curve"
      subtitle={
        <>
          Portfolio vs {data.meta.benchmark_label} · {intraday ? '30-minute bars' : 'daily closes'} · rebased to window start
        </>
      }
      actions={
        <>
          <Segmented
            options={[
              { value: 'pct', label: '% Return' },
              { value: 'nav', label: '$ NAV' },
            ]}
            value={mode}
            onChange={setMode}
          />
          <Segmented
            options={(['1W', '1M', 'ALL'] as Range[]).map((r) => ({ value: r, label: r }))}
            value={range}
            onChange={setRange}
          />
        </>
      }
    >
      {last && (
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <Legend
            items={[
              { label: 'Portfolio', color: PORT, value: <span className={tone(last.portRet)}>{mode === 'pct' ? pct(last.portRet, { sign: true }) : usd(last.port)}</span> },
              { label: benchLabel, color: BENCH, value: <span className="text-ink-2">{mode === 'pct' ? pct(last.benchRet, { sign: true }) : usd(last.bench)}</span> },
            ]}
          />
          <div className="text-xs text-ink-3">
            Active return <span className={`num ml-1 font-medium ${tone(active)}`}>{bps(active)}</span>
          </div>
        </div>
      )}
      <div className="h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={pts} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="portFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={PORT} stopOpacity={0.16} />
                <stop offset="100%" stopColor={PORT} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="i"
              type="number"
              domain={[0, Math.max(pts.length - 1, 1)]}
              ticks={ticks}
              tickFormatter={(i: number) => (pts[i] ? fmtDate(pts[i].t) : '')}
              axisLine={false}
              tickLine={false}
              tickMargin={10}
              minTickGap={24}
            />
            <YAxis
              orientation="right"
              tickFormatter={fmtY}
              axisLine={false}
              tickLine={false}
              width={64}
              tickCount={6}
              domain={['auto', 'auto']}
            />
            {mode === 'pct' && <ReferenceLine y={0} stroke="#2a313c" strokeWidth={1} />}
            {mode === 'nav' && <ReferenceLine y={data.meta.initial_cash} stroke="#2a313c" strokeWidth={1} />}
            <Tooltip
              cursor={{ stroke: '#3a4250', strokeWidth: 1 }}
              isAnimationActive={false}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const p = payload[0].payload as Pt
                const diff = mode === 'pct' ? p.portRet - p.benchRet : p.port - p.bench
                return (
                  <TooltipShell
                    title={`${fmtDateTime(p.t, intraday ? {} : { hour: undefined, minute: undefined, year: 'numeric' })}${intraday ? ' ET' : ''}`}
                    rows={[
                      { label: 'Portfolio', swatch: PORT, value: mode === 'pct' ? pct(p.portRet, { sign: true }) : usd(p.port), className: mode === 'pct' ? tone(p.portRet) : undefined },
                      { label: benchLabel, swatch: BENCH, value: mode === 'pct' ? pct(p.benchRet, { sign: true }) : usd(p.bench) },
                      { label: 'Active', value: mode === 'pct' ? bps(diff) : usd(diff, { sign: true }), className: tone(diff) },
                    ]}
                  />
                )
              }}
            />
            <Line type="linear" dataKey={yKeyB} stroke={BENCH} strokeWidth={1.5} dot={false} activeDot={{ r: 4, fill: BENCH, stroke: '#111318', strokeWidth: 2 }} isAnimationActive={false} />
            <Area
              type="linear"
              dataKey={yKeyP}
              stroke={PORT}
              strokeWidth={2}
              fill="url(#portFill)"
              baseValue="dataMin"
              strokeLinejoin="round"
              dot={false}
              activeDot={{ r: 4.5, fill: PORT, stroke: '#111318', strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}
