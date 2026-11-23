import clsx from 'clsx'
import { Download, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { fmtDateTime, shares, tone, usd, type Dashboard, type Trade } from '../lib'
import { ActionBadge, Card, Segmented, SortHeader, Stat, type SortDir } from '../ui'

type Side = 'all' | 'buy' | 'sell'
type Key = 'timestamp' | 'ticker' | 'quantity' | 'price' | 'notional' | 'realized_pnl' | 'cash_after'
const TH = 'sticky top-0 z-10 bg-surface px-3 py-2.5 text-[11px] font-medium tracking-[0.06em] whitespace-nowrap text-ink-3 uppercase'

export function TradeLog({ data }: { data: Dashboard }) {
  const [query, setQuery] = useState('')
  const [side, setSide] = useState<Side>('all')
  const [sort, setSort] = useState<{ key: Key; dir: SortDir }>({ key: 'timestamp', dir: 'desc' })

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return data.trades
      .filter((t) => !q || t.ticker.toLowerCase().includes(q) || t.action.toLowerCase().includes(q))
      .filter((t) => side === 'all' || (side === 'buy' ? t.action === 'BUY' || t.action === 'COVER' : t.action === 'SELL' || t.action === 'SHORT'))
      .sort((a, b) => {
        const av = a[sort.key]
        const bv = b[sort.key]
        const c =
          sort.key === 'timestamp'
            ? new Date(av as string).getTime() - new Date(bv as string).getTime() || a.trade_id - b.trade_id
            : typeof av === 'string'
              ? av.localeCompare(bv as string)
              : (av as number) - (bv as number)
        return sort.dir === 'asc' ? c : -c
      })
  }, [data.trades, query, side, sort])

  const buys = data.trades.filter((t) => t.action === 'BUY' || t.action === 'COVER')
  const sells = data.trades.filter((t) => t.action === 'SELL' || t.action === 'SHORT')
  const gross = (ts: Trade[]) => ts.reduce((s, t) => s + t.notional, 0)
  const turnover = (gross(buys) + gross(sells)) / 2 / data.meta.initial_cash
  const onSort = (key: Key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }))
  const header = (key: Key, label: string, align: 'left' | 'right' = 'right', className = '') => (
    <SortHeader label={label} active={sort.key === key} dir={sort.dir} onClick={() => onSort(key)} align={align} className={className} />
  )

  const exportCsv = () => {
    const head = 'TradeId,TimestampET,Ticker,Action,Quantity,Price,Fee,Notional,RealizedPnL,PositionAfter,CashAfter'
    const lines = rows.map((t) => [t.trade_id, t.timestamp, t.ticker, t.action, t.quantity, t.price, t.fee, t.notional.toFixed(2), t.realized_pnl.toFixed(2), t.position_after, t.cash_after.toFixed(2)].join(','))
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([[head, ...lines].join('\n')], { type: 'text/csv' }))
    a.download = `trade_log_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="space-y-4">
      <div className="card grid grid-cols-2 gap-6 px-5 py-4 md:grid-cols-5">
        <Stat label="Trades" value={data.trades.length} sub={`${buys.length} buys · ${sells.length} sells`} />
        <Stat label="Gross bought" value={usd(gross(buys), { compact: true })} />
        <Stat label="Gross sold" value={usd(gross(sells), { compact: true })} />
        <Stat label="Turnover" value={`${(turnover * 100).toFixed(1)}%`} sub="½ (buys + sells) ÷ initial cash" />
        <Stat label="Fees paid" value={usd(data.kpis.fees, { decimals: 2 })} />
      </div>

      <Card
        title="Trade ledger"
        subtitle="Every fill, chronological · times in US/Eastern"
        bodyClassName="px-0 pb-0"
        actions={
          <>
            <div className="relative">
              <Search size={13} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-3" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search ticker"
                className="focus-ring h-8 w-44 rounded-lg border border-line bg-bg/60 pl-8 pr-3 text-xs text-ink placeholder:text-ink-3 hover:border-line-strong"
              />
            </div>
            <Segmented
              size="xs"
              value={side}
              onChange={setSide}
              options={[
                { value: 'all', label: 'All' },
                { value: 'buy', label: 'Buys' },
                { value: 'sell', label: 'Sells' },
              ]}
            />
            <button onClick={exportCsv} className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs text-ink-2 hover:border-line-strong hover:text-ink">
              <Download size={13} /> CSV
            </button>
          </>
        }
      >
        <div className="max-h-[640px] overflow-auto">
          <table className="w-full min-w-[900px] border-separate border-spacing-0 text-[12.5px]">
            <thead>
              <tr className="[&>th]:border-b [&>th]:border-line">
                {header('timestamp', 'Time (ET)', 'left', 'pl-5')}
                {header('ticker', 'Ticker', 'left')}
                <th className={clsx(TH, 'text-left')}>Side</th>
                {header('quantity', 'Quantity')}
                {header('price', 'Price')}
                {header('notional', 'Notional')}
                {header('realized_pnl', 'Realised P&L')}
                <th className={clsx(TH, 'text-right')}>Position after</th>
                {header('cash_after', 'Cash after', 'right', 'pr-5')}
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.trade_id} className="transition-colors hover:bg-surface-2 [&>td]:border-b [&>td]:border-line/60">
                  <td className="num py-2.5 pr-3 pl-5 text-ink-2">{fmtDateTime(t.timestamp, { year: 'numeric' })}</td>
                  <td className="px-3 font-semibold text-ink">{t.ticker}</td>
                  <td className="px-3">
                    <ActionBadge action={t.action} />
                  </td>
                  <td className="num px-3 text-right text-ink">{shares(t.quantity)}</td>
                  <td className="num px-3 text-right text-ink-2">{usd(t.price, { decimals: 2 })}</td>
                  <td className="num px-3 text-right text-ink">{usd(t.notional)}</td>
                  <td className={clsx('num px-3 text-right', t.realized_pnl ? tone(t.realized_pnl) : 'text-ink-3')}>{t.realized_pnl ? usd(t.realized_pnl, { sign: true }) : '—'}</td>
                  <td className="num px-3 text-right text-ink-2">{shares(t.position_after)}</td>
                  <td className="num py-2.5 pr-5 pl-3 text-right text-ink-2">{usd(t.cash_after)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-xs text-ink-3">
                    No trades match “{query}”
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
