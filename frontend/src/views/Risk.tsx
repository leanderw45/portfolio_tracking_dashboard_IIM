import clsx from 'clsx'
import { useMemo } from 'react'
import { Area, CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmtDate, fmtDateTime, num, nyDayKey, pct, tone, usd, type Dashboard, type Exposures, type N } from '../lib'
import { BENCH, Card, InfoTip, Legend, PORT, Skeleton, Stat, Tag, TooltipShell } from '../ui'

const NEG = '#F43F5E'

function heatColor(v: number, scale: number): string {
  const t = Math.max(-1, Math.min(1, v / scale))
  const mid = [28, 33, 42]
  const end = t >= 0 ? [59, 130, 246] : [230, 103, 103]
  const c = mid.map((m, i) => Math.round(m + (end[i] - m) * Math.abs(t)))
  return `rgb(${c[0]} ${c[1]} ${c[2]})`
}

function dayTicks(ts: string[]): number[] {
  const out: number[] = []
  let prev = ''
  ts.forEach((t, i) => {
    const k = nyDayKey(t)
    if (k !== prev) out.push(i)
    prev = k
  })
  return out
}

function MetricRow({ label, value, bench, tip, valueClass }: { label: string; value: string; bench?: string; tip?: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between py-[7px] text-[12.5px]">
      <span className="flex items-center gap-1.5 text-ink-2">
        {label}
        {tip && <InfoTip>{tip}</InfoTip>}
      </span>
      <span className="flex items-baseline gap-3">
        {bench !== undefined && <span className="num w-16 text-right text-[11.5px] text-ink-3">{bench}</span>}
        <span className={clsx('num w-20 text-right font-medium', valueClass ?? 'text-ink')}>{value}</span>
      </span>
    </div>
  )
}

export function Risk({ data, exposures }: { data: Dashboard; exposures: Exposures | null }) {
  const r = data.risk as unknown as Record<string, N>
  const rs = data.risk as unknown as Record<string, string | null>
  const basis = data.meta.metrics_basis
  const intraday = basis.frequency !== 'daily'
  const benchName = data.meta.benchmark === 'SPY' ? 'SPY' : 'S&P 500'

  const dd = useMemo(() => {
    const src = data.series.daily.length >= 15 ? data.series.daily : data.series.intraday
    return src.map((p, i) => ({ i, t: p.t, dd: p.dd, bdd: p.bench_dd }))
  }, [data])
  const ddTicks = useMemo(() => (data.series.daily.length >= 15 ? dd.filter((_, i) => i % Math.ceil(dd.length / 8) === 0).map((p) => p.i) : dayTicks(dd.map((p) => p.t))), [dd, data])

  const rolling = useMemo(() => data.risk.rolling.map((p, i) => ({ ...p, i })), [data])
  const rollTicks = useMemo(() => dayTicks(rolling.map((p) => p.t)), [rolling])
  const basisLabel = intraday ? `${basis.observations} × 30-min returns` : `${basis.observations} daily returns`

  const chartAxes = (ticks: number[], pts: { t: string }[], fmt: (v: number) => string) => (
    <>
      <CartesianGrid vertical={false} />
      <XAxis dataKey="i" type="number" domain={[0, Math.max(pts.length - 1, 1)]} ticks={ticks} tickFormatter={(i: number) => (pts[i] ? fmtDate(pts[i].t) : '')} axisLine={false} tickLine={false} tickMargin={10} minTickGap={24} />
      <YAxis orientation="right" tickFormatter={fmt} axisLine={false} tickLine={false} width={56} tickCount={5} />
    </>
  )

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Card
          title="Underwater curve"
          subtitle={`Drawdown from running peak · ${intraday ? '30-minute bars' : 'daily closes'}`}
          actions={
            <Legend
              items={[
                { label: 'Portfolio', color: NEG, value: pct(r.max_drawdown) },
                { label: benchName, color: BENCH, value: pct(r.benchmark_max_drawdown) },
              ]}
            />
          }
        >
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={dd} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="ddFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor={NEG} stopOpacity={0.04} />
                    <stop offset="100%" stopColor={NEG} stopOpacity={0.22} />
                  </linearGradient>
                </defs>
                {chartAxes(ddTicks, dd, (v) => pct(v, { decimals: 1 }))}
                <ReferenceLine y={0} stroke="#2a313c" />
                <Tooltip
                  cursor={{ stroke: '#3a4250' }}
                  isAnimationActive={false}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const p = payload[0].payload as (typeof dd)[number]
                    return (
                      <TooltipShell
                        title={`${fmtDateTime(p.t)} ET`}
                        rows={[
                          { label: 'Portfolio', swatch: NEG, value: pct(p.dd) },
                          { label: benchName, swatch: BENCH, value: pct(p.bdd) },
                        ]}
                      />
                    )
                  }}
                />
                <Line type="linear" dataKey="bdd" stroke={BENCH} strokeWidth={1.5} dot={false} isAnimationActive={false} activeDot={{ r: 4, fill: BENCH, stroke: '#111318', strokeWidth: 2 }} />
                <Area type="linear" dataKey="dd" stroke={NEG} strokeWidth={1.75} fill="url(#ddFill)" baseValue={0} dot={false} isAnimationActive={false} activeDot={{ r: 4, fill: NEG, stroke: '#111318', strokeWidth: 2 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-4 border-t border-line pt-3">
            <Stat label="Peak" value={fmtDateTime(rs.max_drawdown_peak)} />
            <Stat label="Trough" value={fmtDateTime(rs.max_drawdown_trough)} />
            <Stat label="Recovered" value={rs.max_drawdown_recovery ? fmtDateTime(rs.max_drawdown_recovery) : 'Not yet'} valueClass={rs.max_drawdown_recovery ? 'text-pos' : 'text-ink-2'} />
          </div>
        </Card>

        <Card
          title="Risk metrics"
          subtitle={
            <span className="flex items-center gap-2">
              Realised since inception · {basisLabel}
              {intraday && <Tag tone="warn">early estimate</Tag>}
            </span>
          }
        >
          <div className="mb-1 flex justify-end gap-3 text-[10.5px] uppercase tracking-[0.06em] text-ink-3">
            <span className="w-16 text-right">{benchName}</span>
            <span className="w-20 text-right">Portfolio</span>
          </div>
          <div className="divide-y divide-line/70">
            <MetricRow label="Volatility (ann.)" value={pct(r.volatility, { decimals: 1 })} bench={pct(r.benchmark_volatility, { decimals: 1 })} />
            <MetricRow label="Sharpe ratio" value={num(r.sharpe)} bench={num(r.benchmark_sharpe)} valueClass={tone(r.sharpe)} />
            <MetricRow label="Sortino ratio" value={num(r.sortino)} valueClass={tone(r.sortino)} />
            <MetricRow label="Beta" value={num(r.beta)} bench="1.00" tip="OLS slope of portfolio excess returns on benchmark excess returns." />
            <MetricRow label="Alpha (ann.)" value={pct(r.alpha, { sign: true, decimals: 1 })} valueClass={tone(r.alpha)} tip="Jensen's alpha, annualised. Very noisy over short windows." />
            <MetricRow label="Correlation" value={num(r.correlation)} />
            <MetricRow label="Tracking error" value={pct(r.tracking_error, { decimals: 1 })} />
            <MetricRow label="Information ratio" value={num(r.information_ratio)} valueClass={tone(r.information_ratio)} />
            <MetricRow label="Up / down capture" value={`${pct(r.up_capture, { decimals: 0 })} / ${pct(r.down_capture, { decimals: 0 })}`} tip="Share of the benchmark's up-period (down-period) return the portfolio captured. Ideal: high up, low down." />
            <MetricRow label="Win rate (days)" value={pct(r.win_rate_days, { decimals: 0 })} tip={`${r.positive_days ?? 0} up days, ${r.negative_days ?? 0} down days`} />
            <MetricRow label="Days beating benchmark" value={pct(r.days_outperformed, { decimals: 0 })} />
            <MetricRow label="Best day" value={pct(r.best_day, { sign: true })} valueClass="text-pos" bench={fmtDate(rs.best_day_date)} />
            <MetricRow label="Worst day" value={pct(r.worst_day, { sign: true })} valueClass="text-neg" bench={fmtDate(rs.worst_day_date)} />
            <MetricRow label={`VaR 95% (per ${intraday ? '30m' : 'day'})`} value={pct(r.var_95)} tip="Historical value-at-risk on realised returns at the metrics frequency." />
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Rolling volatility" subtitle={`Annualised · window ${basis.rolling_window} ${intraday ? 'bars (1 session)' : 'days'}`} actions={<Legend items={[{ label: 'Portfolio', color: PORT }, { label: benchName, color: BENCH }]} />}>
          <div className="h-[220px]">
            {rolling.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rolling} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                  {chartAxes(rollTicks, rolling, (v) => pct(v, { decimals: 0 }))}
                  <Tooltip
                    cursor={{ stroke: '#3a4250' }}
                    isAnimationActive={false}
                    content={({ active, payload }) =>
                      active && payload?.length ? (
                        <TooltipShell
                          title={`${fmtDateTime((payload[0].payload as { t: string }).t)} ET`}
                          rows={[
                            { label: 'Portfolio', swatch: PORT, value: pct((payload[0].payload as { vol: number }).vol, { decimals: 1 }) },
                            { label: benchName, swatch: BENCH, value: pct((payload[0].payload as { bench_vol: number }).bench_vol, { decimals: 1 }) },
                          ]}
                        />
                      ) : null
                    }
                  />
                  <Line type="monotone" dataKey="bench_vol" stroke={BENCH} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="vol" stroke={PORT} strokeWidth={2} dot={false} isAnimationActive={false} activeDot={{ r: 4, fill: PORT, stroke: '#111318', strokeWidth: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="grid h-full place-items-center text-xs text-ink-3">Not enough observations yet</div>
            )}
          </div>
        </Card>
        <Card title={`Rolling beta to ${benchName}`} subtitle={`Window ${basis.rolling_window} ${intraday ? 'bars (1 session)' : 'days'} · reference line at β = 1`}>
          <div className="h-[220px]">
            {rolling.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rolling} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                  {chartAxes(rollTicks, rolling, (v) => num(v, 1))}
                  <ReferenceLine y={1} stroke="#3a4250" />
                  <Tooltip
                    cursor={{ stroke: '#3a4250' }}
                    isAnimationActive={false}
                    content={({ active, payload }) =>
                      active && payload?.length ? <TooltipShell title={`${fmtDateTime((payload[0].payload as { t: string }).t)} ET`} rows={[{ label: 'Beta', swatch: PORT, value: num((payload[0].payload as { beta: number }).beta) }]} /> : null
                    }
                  />
                  <Line type="monotone" dataKey="beta" stroke={PORT} strokeWidth={2} dot={false} isAnimationActive={false} activeDot={{ r: 4, fill: PORT, stroke: '#111318', strokeWidth: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="grid h-full place-items-center text-xs text-ink-3">Not enough observations yet</div>
            )}
          </div>
        </Card>
      </div>

      <ExAnte data={data} exposures={exposures} />
    </div>
  )
}

function ExAnte({ data, exposures }: { data: Dashboard; exposures: Exposures | null }) {
  if (!exposures) {
    return (
      <div className="card p-5">
        <Skeleton className="h-3.5 w-48" />
        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-7">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      </div>
    )
  }
  const x = exposures.ex_ante
  const rc = exposures.risk_contribution
  const maxRc = Math.max(...rc.flatMap((r) => [r.risk_contribution, r.weight]), 1e-9)
  const corr = exposures.correlation

  return (
    <>
      <Card
        title="Ex-ante risk"
        subtitle={`Forward-looking: current weights × trailing 1-year daily covariance · vs ${exposures.benchmark_label}`}
        actions={
          <InfoTip side="bottom">
            Unlike the realised metrics above (only {data.meta.days_live} sessions of history), these use a full year of daily returns of the names you hold today, so they are statistically meaningful from day one.
          </InfoTip>
        }
      >
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-4 xl:grid-cols-8">
          <Stat label="Volatility" value={pct(x.volatility, { decimals: 1 })} sub={`S&P ${pct(x.benchmark_volatility, { decimals: 1 })}`} />
          <Stat label="Beta" value={num(x.beta)} sub="vs benchmark" />
          <Stat label="Tracking error" value={pct(x.tracking_error, { decimals: 1 })} sub="annualised" />
          <Stat label="1-day VaR 95%" value={usd(x.var_95_1d_usd, { compact: true })} sub={pct(x.var_95_1d)} valueClass="text-neg" tip="Historical simulation: the loss exceeded on 1 day in 20, using the last year of returns." />
          <Stat label="1-day CVaR 95%" value={usd(x.cvar_95_1d_usd, { compact: true })} sub={pct(x.cvar_95_1d)} valueClass="text-neg" tip="Expected shortfall: the average loss on the worst 5% of days." />
          <Stat label="Diversification" value={`${num(x.diversification_ratio)}×`} sub="Σ wσ ÷ σₚ" tip="Weighted average stand-alone vol ÷ portfolio vol. Higher = more diversification benefit." />
          <Stat label="Avg. correlation" value={num(x.avg_pairwise_correlation)} sub="pairwise, holdings" />
          <Stat label="1Y backcast" value={pct(x.backcast_return_1y, { sign: true, decimals: 1 })} valueClass={tone(x.backcast_return_1y)} sub={`S&P ${pct(x.benchmark_return_1y, { sign: true, decimals: 1 })} · SR ${num(x.backcast_sharpe, 1)}`} tip="Hypothetical: what today's weights would have returned over the past year." />
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Risk contribution vs weight" subtitle="Share of ex-ante variance each position drives · bars on a shared scale">
          <div className="mb-2 flex gap-4 px-2 text-[11px] text-ink-2">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-3 rounded-sm bg-port" /> Risk contribution
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-3 rounded-sm bg-bench" /> Capital weight
            </span>
          </div>
          <div className="space-y-0.5">
            {rc.map((r) => {
              const over = r.risk_contribution / Math.max(r.weight, 1e-9)
              return (
                <div key={r.ticker} className="grid grid-cols-[56px_1fr_64px_64px_56px] items-center gap-3 rounded-md px-2 py-1 hover:bg-surface-2">
                  <span className="text-xs font-medium text-ink">{r.ticker}</span>
                  <div className="flex flex-col gap-[2px]">
                    <div className="h-[6px] bg-port" style={{ width: `${Math.max(0.5, (r.risk_contribution / maxRc) * 100)}%`, borderRadius: '0 3px 3px 0' }} />
                    <div className="h-[6px] bg-bench" style={{ width: `${Math.max(0.5, (r.weight / maxRc) * 100)}%`, borderRadius: '0 3px 3px 0' }} />
                  </div>
                  <span className="num text-right text-xs text-ink">{pct(r.risk_contribution, { decimals: 1 })}</span>
                  <span className="num text-right text-xs text-ink-3">{pct(r.weight, { decimals: 1 })}</span>
                  <span className={clsx('num text-right text-[11px]', over > 1.5 ? 'text-warn' : 'text-ink-3')} title="Risk share ÷ weight">
                    {num(over, 1)}×
                  </span>
                </div>
              )
            })}
          </div>
        </Card>

      <Card title="Correlation matrix" subtitle="Pairwise daily-return correlation of holdings, trailing 1 year · sorted by weight" bodyClassName="px-0 pb-4">
        <div className="overflow-x-auto px-5">
          <table className="border-separate border-spacing-[2px] text-[10.5px]">
            <thead>
              <tr>
                <th />
                {corr.tickers.map((t) => (
                  <th key={t} className="px-1 pb-1 text-center font-medium text-ink-3">
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {corr.tickers.map((row, i) => (
                <tr key={row}>
                  <th className="pr-2 text-right font-medium text-ink-2">{row}</th>
                  {corr.matrix[i].map((v, j) => (
                    <td
                      key={j}
                      title={`${row} × ${corr.tickers[j]}: ${num(v, 2)}`}
                      className="num h-8 min-w-[46px] rounded-[3px] text-center"
                      style={{ background: i === j ? '#161a21' : heatColor(v, 1), color: i === j ? '#6b7380' : Math.abs(v) > 0.55 ? '#fff' : '#c9ced8' }}
                    >
                      {i === j ? '—' : num(v, 2)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex items-center gap-3 text-[11px] text-ink-3">
            <span className="num">−1</span>
            <div className="h-1.5 w-40 rounded-full" style={{ background: `linear-gradient(90deg, ${heatColor(-1, 1)}, ${heatColor(0, 1)}, ${heatColor(1, 1)})` }} />
            <span className="num">+1</span>
          </div>
        </div>
      </Card>
      </div>
    </>
  )
}
