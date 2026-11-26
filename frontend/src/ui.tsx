import clsx from 'clsx'
import { ArrowDownRight, ArrowUpRight, ChevronDown, ChevronUp, ChevronsUpDown, Info } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { N } from './lib'

export const PORT = '#3B82F6'
export const BENCH = '#64748B'
export const HOLD = '#9085E9'

export function Card({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={clsx('card flex flex-col animate-in', className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
          <div className="min-w-0">
            {title && <h3 className="text-[13px] font-semibold text-ink tracking-[-0.005em]">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-xs text-ink-3">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={clsx('flex-1 px-5 pb-5', !title && !actions && 'pt-5', bodyClassName)}>{children}</div>
    </section>
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'sm',
}: {
  options: { value: T; label: ReactNode }[]
  value: T
  onChange: (v: T) => void
  size?: 'sm' | 'xs'
}) {
  return (
    <div role="tablist" className="inline-flex rounded-lg border border-line bg-bg/60 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'focus-ring rounded-md font-medium transition-colors',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-2 py-0.5 text-[11px]',
            o.value === value ? 'bg-surface-3 text-ink shadow-[inset_0_0_0_1px_#2a313c]' : 'text-ink-3 hover:text-ink-2',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function DeltaBadge({ value, format, suffix }: { value: N | undefined; format: (v: number) => string; suffix?: string }) {
  if (value == null || !Number.isFinite(value)) return null
  const up = value > 0
  const flat = Math.abs(value) < 1e-9
  return (
    <span
      className={clsx(
        'num inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium',
        flat ? 'bg-surface-3 text-ink-2' : up ? 'bg-pos/10 text-pos' : 'bg-neg/10 text-neg',
      )}
    >
      {!flat && (up ? <ArrowUpRight size={12} strokeWidth={2.25} /> : <ArrowDownRight size={12} strokeWidth={2.25} />)}
      {format(value)}
      {suffix && <span className="ml-0.5 font-sans font-normal opacity-70">{suffix}</span>}
    </span>
  )
}

export function ActionBadge({ action }: { action: string }) {
  const buyish = action === 'BUY' || action === 'COVER'
  return (
    <span
      className={clsx(
        'num inline-flex min-w-[46px] justify-center rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold tracking-wide ring-1 ring-inset',
        buyish ? 'bg-pos/10 text-pos ring-pos/20' : 'bg-neg/10 text-neg ring-neg/20',
      )}
    >
      {action}
    </span>
  )
}

export function Tag({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'blue' | 'warn' }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-md px-1.5 py-0.5 text-[10.5px] font-medium ring-1 ring-inset',
        tone === 'neutral' && 'bg-surface-3 text-ink-2 ring-line-strong',
        tone === 'blue' && 'bg-port/10 text-port ring-port/25',
        tone === 'warn' && 'bg-warn/10 text-warn ring-warn/25',
      )}
    >
      {children}
    </span>
  )
}

export function InfoTip({ children, side = 'top' }: { children: ReactNode; side?: 'top' | 'bottom' }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" aria-label="More info" onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} className="focus-ring rounded text-ink-3 hover:text-ink-2">
        <Info size={12} />
      </button>
      {open && (
        <span
          role="tooltip"
          className={clsx(
            'pointer-events-none absolute left-1/2 z-50 w-64 -translate-x-1/2 rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-[11.5px] leading-relaxed font-normal normal-case tracking-normal text-ink-2 shadow-2xl shadow-black/50',
            side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
          )}
        >
          {children}
        </span>
      )}
    </span>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton', className)} />
}

export function TooltipShell({ title, rows }: { title: ReactNode; rows: { label: ReactNode; value: ReactNode; swatch?: string; className?: string }[] }) {
  return (
    <div className="min-w-[180px] rounded-lg border border-line-strong bg-surface-2/95 px-3 py-2.5 shadow-2xl shadow-black/60 backdrop-blur">
      <div className="mb-1.5 text-[11px] font-medium text-ink-3">{title}</div>
      <div className="space-y-1">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center justify-between gap-6 text-xs">
            <span className="flex items-center gap-2 text-ink-2">
              {r.swatch && <span className="h-2 w-2 rounded-full" style={{ background: r.swatch }} />}
              {r.label}
            </span>
            <span className={clsx('num font-medium', r.className ?? 'text-ink')}>{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export type SortDir = 'asc' | 'desc'

export function SortHeader({
  label,
  active,
  dir,
  onClick,
  align = 'right',
  className,
}: {
  label: ReactNode
  active: boolean
  dir: SortDir
  onClick: () => void
  align?: 'left' | 'right'
  className?: string
}) {
  const Icon = !active ? ChevronsUpDown : dir === 'asc' ? ChevronUp : ChevronDown
  return (
    <th className={clsx('sticky top-0 z-10 bg-surface px-3 py-2.5 font-medium', align === 'right' ? 'text-right' : 'text-left', className)}>
      <button
        onClick={onClick}
        className={clsx(
          'focus-ring group inline-flex items-center gap-1 whitespace-nowrap rounded text-[11px] uppercase tracking-[0.06em] transition-colors',
          align === 'right' && 'flex-row-reverse',
          active ? 'text-ink' : 'text-ink-3 hover:text-ink-2',
        )}
      >
        {label}
        <Icon size={12} className={clsx(active ? 'opacity-100' : 'opacity-0 group-hover:opacity-60')} />
      </button>
    </th>
  )
}

export function Stat({ label, value, sub, valueClass, tip }: { label: ReactNode; value: ReactNode; sub?: ReactNode; valueClass?: string; tip?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-[11.5px] text-ink-3">
        {label}
        {tip && <InfoTip>{tip}</InfoTip>}
      </div>
      <div className={clsx('num mt-1 truncate text-[15px] font-medium', valueClass ?? 'text-ink')}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-ink-3">{sub}</div>}
    </div>
  )
}

export function EmptyState({ title, body, icon }: { title: string; body?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      {icon && <div className="text-ink-3">{icon}</div>}
      <div className="text-sm font-medium text-ink-2">{title}</div>
      {body && <div className="max-w-sm text-xs text-ink-3">{body}</div>}
    </div>
  )
}

export function Legend({ items }: { items: { label: ReactNode; color: string; value?: ReactNode; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-1.5 text-xs text-ink-2">
          <span className="h-[2px] w-3 rounded-full" style={{ background: it.color }} />
          {it.label}
          {it.value != null && <span className="num text-ink">{it.value}</span>}
        </span>
      ))}
    </div>
  )
}

const POS = '#10B981'
const NEG = '#F43F5E'

export interface DivRow {
  key: string
  label: ReactNode
  value: number
  display: ReactNode
  detail?: ReactNode
  color?: string
}

export function DivergingBars({ rows, thickness = 10, colorBySign = true, color }: { rows: DivRow[]; thickness?: number; colorBySign?: boolean; color?: string }) {
  const [hover, setHover] = useState<string | null>(null)
  const maxPos = Math.max(0, ...rows.map((r) => r.value))
  const maxNeg = Math.max(0, ...rows.map((r) => -r.value))
  const span = maxPos + maxNeg || 1
  const zero = (maxNeg / span) * 100

  return (
    <div className="space-y-0.5">
      {rows.map((r) => {
        const w = (Math.abs(r.value) / span) * 100
        const pos = r.value >= 0
        const fill = r.color ?? color ?? (colorBySign ? (pos ? POS : NEG) : '#3B82F6')
        return (
          <div
            key={r.key}
            onMouseEnter={() => setHover(r.key)}
            onMouseLeave={() => setHover(null)}
            className={clsx('grid grid-cols-[minmax(56px,auto)_1fr_auto] items-center gap-3 rounded-md px-2 py-[5px] transition-colors', hover === r.key && 'bg-surface-2')}
          >
            <div className="truncate text-xs font-medium text-ink">{r.label}</div>
            <div className="relative h-4">
              <div className="absolute top-0 bottom-0 w-px bg-line-strong" style={{ left: `${zero}%` }} />
              <div
                className="absolute top-1/2 -translate-y-1/2 transition-[width] duration-300"
                style={{
                  height: thickness,
                  width: `${w}%`,
                  left: pos ? `${zero}%` : `${zero - w}%`,
                  background: fill,
                  opacity: hover && hover !== r.key ? 0.45 : 0.9,
                  borderRadius: pos ? '0 4px 4px 0' : '4px 0 0 4px',
                }}
              />
            </div>
            <div className="min-w-[84px] text-right">
              <div className="num text-xs font-medium text-ink">{r.display}</div>
              {r.detail && <div className="num text-[10.5px] text-ink-3">{r.detail}</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export interface RankRow {
  key: string
  label: ReactNode
  value: number
  display: ReactNode
  sub?: ReactNode
  muted?: boolean
}

export function RankedBars({ rows, max, color = '#3B82F6', thickness = 6, labelWidth = 'minmax(64px,auto)' }: { rows: RankRow[]; max?: number; color?: string; thickness?: number; labelWidth?: string }) {
  const [hover, setHover] = useState<string | null>(null)
  const m = max ?? Math.max(...rows.map((r) => Math.abs(r.value)), 1e-9)
  return (
    <div className="space-y-0.5">
      {rows.map((r) => (
        <div
          key={r.key}
          onMouseEnter={() => setHover(r.key)}
          onMouseLeave={() => setHover(null)}
          className={clsx('grid items-center gap-3 rounded-md px-2 py-[5px] transition-colors', hover === r.key && 'bg-surface-2')}
          style={{ gridTemplateColumns: `${labelWidth} 1fr auto` }}
        >
          <div className="truncate text-xs font-medium text-ink">{r.label}</div>
          <div className="relative h-3 rounded-full">
            <div
              className="absolute top-1/2 left-0 -translate-y-1/2 transition-[width] duration-300"
              style={{
                height: thickness,
                width: `${Math.max(0.5, (Math.abs(r.value) / m) * 100)}%`,
                background: r.muted ? '#64748B' : color,
                opacity: hover && hover !== r.key ? 0.45 : r.muted ? 0.7 : 0.9,
                borderRadius: '0 4px 4px 0',
              }}
            />
          </div>
          <div className="flex min-w-[96px] items-baseline justify-end gap-2">
            {r.sub && <span className="num text-[10.5px] text-ink-3">{r.sub}</span>}
            <span className="num text-xs font-medium text-ink">{r.display}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

export interface PairRow {
  key: string
  label: ReactNode
  a: number
  b: number
  aDisplay: ReactNode
  bDisplay: ReactNode
  right?: ReactNode
}

export function PairedBars({ rows, aColor = '#3B82F6', bColor = '#64748B', rightHeader, aLabel, bLabel }: { rows: PairRow[]; aColor?: string; bColor?: string; rightHeader?: ReactNode; aLabel: string; bLabel: string }) {
  const [hover, setHover] = useState<string | null>(null)
  const m = Math.max(...rows.flatMap((r) => [r.a, r.b]), 1e-9)
  return (
    <div>
      <div className="mb-2 grid grid-cols-[minmax(120px,1.1fr)_2fr_64px_64px_auto] items-center gap-3 px-2 text-[10.5px] uppercase tracking-[0.06em] text-ink-3">
        <span />
        <span className="flex gap-4 normal-case tracking-normal">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-3 rounded-sm" style={{ background: aColor }} /> {aLabel}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-3 rounded-sm" style={{ background: bColor }} /> {bLabel}
          </span>
        </span>
        <span className="text-right">{aLabel.split(' ')[0]}</span>
        <span className="text-right">{bLabel.split(' ')[0]}</span>
        <span className="min-w-[72px] text-right">{rightHeader}</span>
      </div>
      <div className="space-y-0.5">
        {rows.map((r) => (
          <div
            key={r.key}
            onMouseEnter={() => setHover(r.key)}
            onMouseLeave={() => setHover(null)}
            className={clsx('grid grid-cols-[minmax(120px,1.1fr)_2fr_64px_64px_auto] items-center gap-3 rounded-md px-2 py-1.5 transition-colors', hover === r.key && 'bg-surface-2')}
          >
            <div className="truncate text-xs text-ink">{r.label}</div>
            <div className="flex flex-col gap-[2px]">
              <div className="h-[6px]" style={{ width: `${Math.max(0.4, (r.a / m) * 100)}%`, background: aColor, borderRadius: '0 3px 3px 0', opacity: r.a > 0 ? 0.92 : 0.25 }} />
              <div className="h-[6px]" style={{ width: `${Math.max(0.4, (r.b / m) * 100)}%`, background: bColor, borderRadius: '0 3px 3px 0', opacity: r.b > 0 ? 0.85 : 0.25 }} />
            </div>
            <div className="num text-right text-xs text-ink">{r.aDisplay}</div>
            <div className="num text-right text-xs text-ink-3">{r.bDisplay}</div>
            <div className="min-w-[72px] text-right">{r.right}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function SegmentedBar({ parts, height = 10 }: { parts: { key: string; value: number; color: string; label: string; display: ReactNode }[]; height?: number }) {
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0) || 1
  return (
    <div>
      <div className="flex gap-[2px] overflow-hidden rounded-[4px]" style={{ height }}>
        {parts.map((p) => (
          <div key={p.key} title={`${p.label}`} style={{ width: `${(Math.max(0, p.value) / total) * 100}%`, background: p.color }} />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
        {parts.map((p) => (
          <span key={p.key} className="flex items-center gap-1.5 text-xs text-ink-2">
            <span className="h-2 w-2 rounded-[2px]" style={{ background: p.color }} />
            {p.label}
            <span className="num text-ink">{p.display}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
