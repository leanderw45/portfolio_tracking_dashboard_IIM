import clsx from 'clsx'
import { Layers } from 'lucide-react'
import { pct, usd, type Exposures as Data } from '../lib'
import { Card, EmptyState, InfoTip, PairedBars, RankedBars, SegmentedBar, Skeleton, Tag } from '../ui'

const ETF_COLOR = '#9085E9'

function ExposuresSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="card space-y-3 p-5">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-3 w-64" />
          {Array.from({ length: 6 }).map((__, j) => (
            <Skeleton key={j} className="h-5 w-full" />
          ))}
        </div>
      ))}
      <div className="col-span-full text-center text-xs text-ink-3">Fetching ETF holdings and fundamentals. The first load takes ~20s, then it is cached.</div>
    </div>
  )
}

export function Exposures({ data, error }: { data: Data | null; error: string | null }) {
  if (error) return <EmptyState icon={<Layers size={22} />} title="Exposure analytics unavailable" body={error} />
  if (!data) return <ExposuresSkeleton />

  const lt = data.look_through
  const d = data.distributions
  const cash = d.region.find((r) => r.name === 'Cash')
  const maxTop = lt.top[0]?.weight || 1

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <Card
          title="Top 10 look-through holdings"
          subtitle="Single stocks + ETF constituents, aggregated by issuer · % of NAV"
          actions={
            <InfoTip side="bottom">
              Each ETF is decomposed into its published top-10 holdings. The look-through explains <b className="text-ink">{pct(lt.explained_weight, { decimals: 1 })}</b> of NAV; the rest sits in ETF constituents beyond each fund's top 10.
            </InfoTip>
          }
          bodyClassName="px-0"
        >
          <table className="w-full border-separate border-spacing-0 text-[12.5px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-[0.06em] text-ink-3 [&>th]:border-b [&>th]:border-line [&>th]:pb-2 [&>th]:font-medium">
                <th className="w-8 pl-5 text-left">#</th>
                <th className="text-left">Holding</th>
                <th className="px-3 text-right">Direct</th>
                <th className="px-3 text-right">Via ETFs</th>
                <th className="pr-5 pl-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {lt.top.map((r, i) => {
                const etfSources = r.sources.filter((s) => s.source !== 'Direct')
                return (
                  <tr key={r.symbol} className="hover:bg-surface-2 [&>td]:border-b [&>td]:border-line/60">
                    <td className="num py-2 pl-5 text-ink-3">{i + 1}</td>
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-ink">{r.symbol}</span>
                        {r.direct > 0 && r.via_etf > 0 && <Tag tone="blue">overlap</Tag>}
                      </div>
                      <div className="max-w-[240px] truncate text-[11px] text-ink-3">{r.name}</div>
                    </td>
                    <td className="num px-3 text-right text-ink-2">{r.direct ? pct(r.direct) : '—'}</td>
                    <td className="num px-3 text-right text-ink-2">
                      {r.via_etf ? (
                        <>
                          {pct(r.via_etf)}
                          <span className="ml-1.5 text-[10.5px] text-ink-3">{etfSources.map((s) => s.source).join(', ')}</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-2 pr-5 pl-3">
                      <div className="flex items-center justify-end gap-2.5">
                        <div className="flex h-1.5 w-20 gap-[2px] overflow-hidden">
                          <div className="h-full rounded-l-sm bg-port" style={{ width: `${(r.direct / maxTop) * 100}%` }} />
                          <div className="h-full rounded-r-sm" style={{ width: `${(r.via_etf / maxTop) * 100}%`, background: ETF_COLOR }} />
                        </div>
                        <span className="num w-12 text-right font-medium text-ink">{pct(r.weight)}</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-5 pt-3 text-[11px] text-ink-3">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-3 rounded-sm bg-port" /> Direct
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-3 rounded-sm" style={{ background: ETF_COLOR }} /> Via ETFs
            </span>
            {lt.overlaps.length > 0 && (
              <span>
                Overlap: <span className="text-ink-2">{lt.overlaps.map((o) => o.symbol).join(', ')}</span> held directly <i>and</i> inside an ETF
              </span>
            )}
          </div>
        </Card>

        <div className="flex flex-col gap-4">
          <Card title="Asset class">
            <SegmentedBar
              parts={d.asset_class.map((a) => ({
                key: a.name,
                value: a.weight,
                label: a.name,
                color: a.name === 'Cash' ? '#3A4250' : a.name === 'ETFs' ? ETF_COLOR : '#3B82F6',
                display: pct(a.weight, { decimals: 1 }),
              }))}
            />
          </Card>
          <Card title="Market-cap distribution" subtitle="Look-through · ETF buckets estimated from top-10 constituents · % of NAV">
            <RankedBars rows={d.market_cap.map((r) => ({ key: r.name, label: r.name, value: r.weight, display: pct(r.weight, { decimals: 1 }) }))} labelWidth="120px" />
          </Card>
          <Card title="Region & country" subtitle="Issuer domicile, look-through">
            <RankedBars
              rows={[
                ...d.country.slice(0, 6).map((r) => ({ key: r.name, label: r.name, value: r.weight, display: pct(r.weight, { decimals: 1 }) })),
                ...(cash ? [{ key: 'cash', label: <span className="text-ink-2">Cash</span>, value: cash.weight, display: pct(cash.weight, { decimals: 1 }), muted: true }] : []),
              ]}
              labelWidth="120px"
            />
            <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
              {d.region
                .filter((r) => r.name !== 'Cash')
                .map((r) => (
                  <span key={r.name} className="rounded-md bg-surface-2 px-2 py-1 text-[11px] text-ink-3">
                    {r.name} <span className="num ml-1 text-ink">{pct(r.weight, { decimals: 1 })}</span>
                  </span>
                ))}
              <span className="rounded-md bg-surface-2 px-2 py-1 text-[11px] text-ink-3">
                S&amp;P 500 <span className="num ml-1 text-ink">~100% US</span>
              </span>
            </div>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <Card title={`Sector exposure vs ${data.benchmark_label}`} subtitle="ETFs use fund-reported sector weights · % of NAV">
          <PairedBars
            aLabel="Portfolio"
            bLabel="S&P 500"
            rightHeader="Active"
            rows={d.sector.map((s) => ({
              key: s.name,
              label: s.name,
              a: s.portfolio,
              b: s.benchmark,
              aDisplay: pct(s.portfolio, { decimals: 1 }),
              bDisplay: pct(s.benchmark, { decimals: 1 }),
              right: <span className={clsx('num text-xs font-medium', s.active > 0.0005 ? 'text-port' : 'text-ink-3')}>{pct(s.active, { decimals: 1, sign: true })}</span>,
            }))}
          />
        </Card>

        {data.etfs.length > 0 && (
          <Card
            title="ETF sleeve"
            subtitle={
              <>
                Weighted expense ratio <span className="num text-ink-2">{pct(data.etf_expense_ratio, { decimals: 2 })}</span> · implied annual cost <span className="num text-ink-2">{usd(data.annual_etf_fees_usd)}</span>
              </>
            }
            bodyClassName="px-0"
          >
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-[0.06em] text-ink-3 [&>th]:border-b [&>th]:border-line [&>th]:pb-2 [&>th]:font-medium">
                  <th className="pl-5 text-left">ETF</th>
                  <th className="px-3 text-right">Weight</th>
                  <th className="px-3 text-right">TER</th>
                  <th className="pr-5 pl-3 text-right">Top holdings</th>
                </tr>
              </thead>
              <tbody>
                {data.etfs.map((e) => (
                  <tr key={e.ticker} className="hover:bg-surface-2 [&>td]:border-b [&>td]:border-line/60">
                    <td className="py-2.5 pl-5">
                      <div className="font-semibold text-ink">{e.ticker}</div>
                      <div className="max-w-[170px] truncate text-[11px] text-ink-3">{e.name}</div>
                    </td>
                    <td className="num px-3 text-right text-ink">{pct(e.weight, { decimals: 1 })}</td>
                    <td className="num px-3 text-right text-ink-2">{pct(e.expense_ratio, { decimals: 2 })}</td>
                    <td className="pr-5 pl-3 text-right text-[11.5px] text-ink-3">
                      {e.top_holdings.slice(0, 3).map((h) => (
                        <span key={h.symbol} className="ml-2.5 whitespace-nowrap">
                          <span className="text-ink-2">{h.symbol}</span> <span className="num">{pct(h.weight, { decimals: 1 })}</span>
                        </span>
                      ))}
                      <div className="num text-[10.5px]">top-10 = {pct(e.top10_coverage, { decimals: 0 })} of fund</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  )
}
