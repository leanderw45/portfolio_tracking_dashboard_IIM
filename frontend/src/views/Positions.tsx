import clsx from 'clsx'
import { Download, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { bps, pct, shares, tone, usd, type Dashboard, type Exposures, type Position } from '../lib'
import { Card, DivergingBars, Segmented, SortHeader, Stat, type SortDir } from '../ui'

type Key = 'ticker' | 'quantity' | 'avg_cost' | 'price' | 'day_change_pct' | 'market_value' | 'weight' | 'unrealized_pnl' | 'unrealized_pnl_pct' | 'contribution'
type Filter = 'all' | 'winners' | 'losers' | 'etf' | 'stock'

const COLS: { key: Key; label: string; align?: 'left' }[] = [
  { key: 'ticker', label: 'Ticker', align: 'left' },
  { key: 'quantity', label: 'Shares' },
  { key: 'avg_cost', label: 'Avg entry' },
  { key: 'price', label: 'Price' },
  { key: 'day_change_pct', label: 'Day' },
  { key: 'market_value', label: 'Market value' },
  { key: 'weight', label: 'Weight' },
  { key: 'unrealized_pnl', label: 'Unreal. P&L' },
  { key: 'unrealized_pnl_pct', label: 'Unreal. %' },
  { key: 'contribution', label: 'Contrib.' },
]

export function Positions({ data, exposures }: { data: Dashboard; exposures: Exposures | null }) {
  const [sort, setSort] = useState<{ key: Key; dir: SortDir }>({ key: 'market_value', dir: 'desc' })
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const info = useMemo(() => Object.fromEntries((exposures?.holdings ?? []).map((h) => [h.ticker, h])), [exposures])

  const open = useMemo(() => data.positions.filter((p) => p.is_open), [data.positions])
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return open
      .filter((p) => !q || p.ticker.toLowerCase().includes(q) || (info[p.ticker]?.name ?? '').toLowerCase().includes(q))
      .filter((p) => {
        if (filter === 'winners') return p.unrealized_pnl > 0
        if (filter === 'losers') return p.unrealized_pnl <= 0
        if (filter === 'etf') return info[p.ticker]?.kind === 'ETF'
        if (filter === 'stock') return info[p.ticker]?.kind === 'Stock'
        return true
      })
      .sort((a, b) => {
        const av = a[sort.key]
        const bv = b[sort.key]
        const c = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number)
        return sort.dir === 'asc' ? c : -c
      })
  }, [open, query, filter, sort, info])

  const tot = useMemo(() => {
    const s = (f: (p: Position) => number) => rows.reduce((acc, p) => acc + f(p), 0)
    const cost = s((p) => p.cost_basis)
    return { mv: s((p) => p.market_value), w: s((p) => p.weight), upnl: s((p) => p.unrealized_pnl), cost, contrib: s((p) => p.contribution), daily: s((p) => p.daily_pnl) }
  }, [rows])
  const maxW = Math.max(...open.map((p) => p.weight), 0.0001)

  const onSort = (key: Key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'ticker' ? 'asc' : 'desc' }))

  const exportCsv = () => {
    const head = ['Ticker', 'Name', 'Type', 'Shares', 'AvgEntry', 'Price', 'DayChangePct', 'MarketValue', 'WeightPct', 'UnrealizedPnL', 'UnrealizedPnLPct', 'ContributionBps']
    const lines = rows.map((p) =>
      [p.ticker, `"${info[p.ticker]?.name ?? ''}"`, info[p.ticker]?.kind ?? '', p.quantity, p.avg_cost.toFixed(4), p.price.toFixed(4), (p.day_change_pct * 100).toFixed(3), p.market_value.toFixed(2), (p.weight * 100).toFixed(3), p.unrealized_pnl.toFixed(2), (p.unrealized_pnl_pct * 100).toFixed(3), (p.contribution * 1e4).toFixed(1)].join(','),
    )
    const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `positions_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const contribRows = [...open]
    .sort((a, b) => b.contribution - a.contribution)
    .map((p) => ({ key: p.ticker, label: p.ticker, value: p.contribution, display: bps(p.contribution), detail: usd(p.total_pnl, { sign: true, compact: true }) }))

  const sleeve = (kind: 'ETF' | 'Stock') => open.filter((p) => info[p.ticker]?.kind === kind)
  const sleeveContrib = (kind: 'ETF' | 'Stock') => sleeve(kind).reduce((s, p) => s + p.contribution, 0)
  const sleeveWeight = (kind: 'ETF' | 'Stock') => sleeve(kind).reduce((s, p) => s + p.weight, 0)

  return (
    <div className="grid gap-4 2xl:grid-cols-[1fr_380px]">
      <Card
        title="Holdings"
        subtitle={`${rows.length} of ${open.length} open positions · prices as of last refresh`}
        bodyClassName="px-0 pb-0"
        actions={
          <>
            <div className="relative">
              <Search size={13} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-3" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter ticker or name"
                className="focus-ring h-8 w-48 rounded-lg border border-line bg-bg/60 pl-8 pr-3 text-xs text-ink placeholder:text-ink-3 hover:border-line-strong"
              />
            </div>
            <Segmented
              size="xs"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'winners', label: 'Winners' },
                { value: 'losers', label: 'Losers' },
                { value: 'etf', label: 'ETFs' },
                { value: 'stock', label: 'Stocks' },
              ]}
            />
            <button onClick={exportCsv} className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs text-ink-2 hover:border-line-strong hover:text-ink" title="Export CSV">
              <Download size={13} />
              CSV
            </button>
          </>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] border-separate border-spacing-0 text-[12.5px]">
            <thead>
              <tr className="[&>th]:border-b [&>th]:border-line">
                {COLS.map((c) => (
                  <SortHeader key={c.key} label={c.label} active={sort.key === c.key} dir={sort.dir} onClick={() => onSort(c.key)} align={c.align ?? 'right'} className={c.key === 'ticker' ? 'pl-5' : c.key === 'contribution' ? 'pr-5' : ''} />
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const h = info[p.ticker]
                return (
                  <tr key={p.ticker} className="group transition-colors hover:bg-surface-2 [&>td]:border-b [&>td]:border-line/60">
                    <td className="py-2.5 pr-3 pl-5">
                      <div className="flex items-center gap-2.5">
                        <span className="font-semibold tracking-[-0.01em] text-ink">{p.ticker}</span>
                        {h?.kind === 'ETF' && <span className="rounded bg-surface-3 px-1 py-px text-[9.5px] font-medium tracking-wide text-ink-3">ETF</span>}
                      </div>
                      <div className="max-w-[200px] truncate text-[11px] text-ink-3">{h?.name ?? ' '}</div>
                    </td>
                    <td className="num px-3 text-right text-ink-2">{shares(p.quantity)}</td>
                    <td className="num px-3 text-right text-ink-2">{usd(p.avg_cost, { decimals: 2 })}</td>
                    <td className="num px-3 text-right text-ink">{usd(p.price, { decimals: 2 })}</td>
                    <td className={clsx('num px-3 text-right', tone(p.day_change_pct))}>{pct(p.day_change_pct, { sign: true })}</td>
                    <td className="num px-3 text-right text-ink">{usd(p.market_value)}</td>
                    <td className="px-3">
                      <div className="flex items-center justify-end gap-2.5">
                        <div className="h-1 w-16 overflow-hidden rounded-full bg-surface-3">
                          <div className="h-full rounded-full bg-port/80" style={{ width: `${(p.weight / maxW) * 100}%` }} />
                        </div>
                        <span className="num w-12 text-right text-ink">{pct(p.weight, { decimals: 1 })}</span>
                      </div>
                    </td>
                    <td className={clsx('num px-3 text-right font-medium', tone(p.unrealized_pnl))}>{usd(p.unrealized_pnl, { sign: true })}</td>
                    <td className={clsx('num px-3 text-right', tone(p.unrealized_pnl_pct))}>{pct(p.unrealized_pnl_pct, { sign: true })}</td>
                    <td className={clsx('num py-2.5 pr-5 pl-3 text-right', tone(p.contribution))}>{bps(p.contribution, true).replace(' bps', '')}<span className="ml-0.5 text-[10px] text-ink-3">bp</span></td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="[&>td]:border-t [&>td]:border-line-strong [&>td]:bg-surface [&>td]:py-3 text-[12.5px]">
                <td className="pl-5 font-medium text-ink-2">Total {filter !== 'all' || query ? '(filtered)' : 'invested'}</td>
                <td />
                <td className="num px-3 text-right text-ink-3">{usd(tot.cost, { compact: true })}</td>
                <td />
                <td className={clsx('num px-3 text-right', tone(tot.daily))}>{usd(tot.daily, { sign: true, compact: true })}</td>
                <td className="num px-3 text-right font-medium text-ink">{usd(tot.mv)}</td>
                <td className="num px-3 text-right font-medium text-ink">{pct(tot.w, { decimals: 1 })}</td>
                <td className={clsx('num px-3 text-right font-medium', tone(tot.upnl))}>{usd(tot.upnl, { sign: true })}</td>
                <td className={clsx('num px-3 text-right', tone(tot.upnl))}>{pct(tot.cost ? tot.upnl / tot.cost : null, { sign: true })}</td>
                <td className={clsx('num pr-5 pl-3 text-right font-medium', tone(tot.contrib))}>{bps(tot.contrib).replace(' bps', '')}<span className="ml-0.5 text-[10px] text-ink-3">bp</span></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <div className="flex flex-col gap-4">
        <Card title="Contribution to return" subtitle="Position P&L ÷ initial capital · sums to total return">
          <DivergingBars rows={contribRows} />
          <div className="mt-3 flex items-center justify-between border-t border-line px-2 pt-3 text-xs">
            <span className="text-ink-3">Total portfolio</span>
            <span className={clsx('num font-medium', tone(data.kpis.total_return))}>{bps(data.kpis.total_return)}</span>
          </div>
        </Card>
        {exposures && (
          <Card title="Attribution by sleeve">
            <div className="grid grid-cols-2 gap-4">
              {(['ETF', 'Stock'] as const).map((k) => (
                <Stat
                  key={k}
                  label={k === 'ETF' ? 'ETF sleeve' : 'Single stocks'}
                  value={bps(sleeveContrib(k))}
                  valueClass={tone(sleeveContrib(k))}
                  sub={`${pct(sleeveWeight(k), { decimals: 1 })} of NAV · ${sleeve(k).length} names`}
                />
              ))}
              <Stat label="Cash drag" value={pct(data.kpis.cash_weight, { decimals: 1 })} sub="uninvested, earns 0%" />
              <Stat
                label="Return on invested"
                value={pct(tot.cost ? open.reduce((s, p) => s + p.unrealized_pnl, 0) / open.reduce((s, p) => s + p.cost_basis, 0) : null, { sign: true })}
                valueClass={tone(data.kpis.unrealized_pnl)}
                sub="P&L ÷ cost basis"
              />
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}
