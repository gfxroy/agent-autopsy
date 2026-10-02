import clsx from 'clsx'
import type { ReactNode } from 'react'
import type { Severity, Span, SpanKind } from '../engine/types'

export const KIND_COLOR: Record<SpanKind, string> = {
  llm: '#a78bfa',
  tool: '#22d3ee',
  agent: '#94a3b8',
  handoff: '#fbbf24',
  retrieval: '#34d399',
  guardrail: '#f472b6',
  chain: '#64748b',
  other: '#64748b',
}

export const KIND_ICON: Record<SpanKind, string> = {
  llm: '✦',
  tool: '⚙',
  agent: '◉',
  handoff: '⇄',
  retrieval: '⌕',
  guardrail: '⛨',
  chain: '⛓',
  other: '•',
}

export const SEV_STYLE: Record<Severity, string> = {
  critical: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
  high: 'bg-orange-500/15 text-orange-300 border-orange-500/40',
  medium: 'bg-amber-500/12 text-amber-200 border-amber-500/35',
  low: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
  info: 'bg-slate-500/10 text-slate-300 border-slate-500/30',
}

export const SEV_DOT: Record<Severity, string> = {
  critical: 'bg-rose-500',
  high: 'bg-orange-400',
  medium: 'bg-amber-300',
  low: 'bg-sky-400',
  info: 'bg-slate-400',
}

export function SeverityPill({ severity }: { severity: Severity }) {
  return (
    <span
      className={clsx(
        'rounded border px-1.5 py-px font-mono text-[10px] font-semibold tracking-wider uppercase',
        SEV_STYLE[severity],
      )}
    >
      {severity}
    </span>
  )
}

export function KindBadge({ kind }: { kind: SpanKind }) {
  return (
    <span
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] font-bold"
      style={{ color: KIND_COLOR[kind], background: `${KIND_COLOR[kind]}1f` }}
      title={kind}
    >
      {KIND_ICON[kind]}
    </span>
  )
}

export function spanLabel(s: Span): string {
  return s.kind === 'tool' ? (s.toolName ?? s.name) : s.name
}

export function Md({ text, className }: { text: string; className?: string }) {
  // Tiny inline renderer: `code` and **bold** only — content is untrusted, so no HTML.
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
  return (
    <span className={className}>
      {parts.map((p, i) =>
        p.startsWith('`') && p.endsWith('`') ? (
          <code
            key={i}
            className="rounded bg-white/[0.07] px-1 font-mono text-[0.92em] text-cyan-200"
          >
            {p.slice(1, -1)}
          </code>
        ) : p.startsWith('**') && p.endsWith('**') ? (
          <strong key={i} className="text-white">
            {p.slice(2, -2)}
          </strong>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </span>
  )
}

export function Empty({
  icon,
  title,
  children,
}: {
  icon: string
  title: string
  children?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <div className="text-4xl">{icon}</div>
      <div className="text-base font-semibold text-slate-200">{title}</div>
      <div className="max-w-md text-sm text-slate-400">{children}</div>
    </div>
  )
}

export function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: 'bad' | 'good' | 'warn'
}) {
  return (
    <div className="min-w-0 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
      <div className="panel-title !text-[10px]">{label}</div>
      <div
        className={clsx(
          'mt-0.5 truncate font-mono text-lg font-semibold tabular-nums',
          tone === 'bad'
            ? 'text-rose-300'
            : tone === 'good'
              ? 'text-emerald-300'
              : tone === 'warn'
                ? 'text-amber-200'
                : 'text-white',
        )}
      >
        {value}
      </div>
      {sub && <div className="truncate text-[11px] text-slate-500">{sub}</div>}
    </div>
  )
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:items-center"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className={clsx('w-full animate-pop panel p-5', wide ? 'max-w-4xl' : 'max-w-lg')}>
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button className="btn-ghost !px-2 !py-1" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export const GRADE_COLOR = (g: string) =>
  g.startsWith('A')
    ? '#34d399'
    : g.startsWith('B')
      ? '#a3e635'
      : g.startsWith('C')
        ? '#fbbf24'
        : g.startsWith('D')
          ? '#fb923c'
          : '#f43f5e'
