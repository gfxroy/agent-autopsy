import clsx from 'clsx'
import { useMemo, useState } from 'react'
import type { Analysis } from '../engine/analyze'
import type { Finding, SpanKind } from '../engine/types'
import { fmtMs, fmtNum, fmtUsd } from '../engine/util'
import { useStore } from '../store'
import { KIND_COLOR, KindBadge, SEV_DOT, spanLabel } from './ui'

export function findingsBySpan(findings: Finding[]): Map<string, Finding[]> {
  const m = new Map<string, Finding[]>()
  for (const f of findings) for (const id of f.spanIds) m.set(id, [...(m.get(id) ?? []), f])
  return m
}

const KINDS: SpanKind[] = [
  'agent',
  'llm',
  'tool',
  'retrieval',
  'handoff',
  'guardrail',
  'chain',
  'other',
]

export function Timeline({ analysis: a }: { analysis: Analysis }) {
  const { selectedSpanId, select } = useStore()
  const [q, setQ] = useState('')
  const [hidden, setHidden] = useState<Set<SpanKind>>(new Set())
  const [onlyFlagged, setOnlyFlagged] = useState(false)
  const flagged = useMemo(() => findingsBySpan(a.findings), [a.findings])
  const t0 = a.ctx.t0
  const dur = Math.max(1, a.duration)
  const killerId = a.verdict.killerSpan?.id
  const present = new Set(a.trace.spans.map((s) => s.kind))

  const rows = a.trace.spans.filter((s) => {
    if (hidden.has(s.kind)) return false
    if (onlyFlagged && !flagged.has(s.id)) return false
    if (q) {
      const hay =
        `${s.name} ${s.toolName ?? ''} ${s.model ?? ''} ${s.toolArgsRaw ?? ''} ${s.toolResult?.slice(0, 2000) ?? ''}`.toLowerCase()
      if (!hay.includes(q.toLowerCase())) return false
    }
    return true
  })

  const ticks = Array.from({ length: 6 }, (_, i) => (dur * i) / 5)

  return (
    <div className="overflow-hidden panel" data-testid="timeline">
      <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] p-2.5">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter spans, args, outputs…"
          className="w-56 rounded-lg border border-white/10 bg-ink-800 px-2.5 py-1.5 text-sm placeholder:text-slate-500"
          aria-label="Filter spans"
        />
        {KINDS.filter((k) => present.has(k)).map((k) => (
          <button
            key={k}
            onClick={() =>
              setHidden((h) => {
                const n = new Set(h)
                if (n.has(k)) n.delete(k)
                else n.add(k)
                return n
              })
            }
            className={clsx('chip cursor-pointer', hidden.has(k) && 'line-through opacity-40')}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: KIND_COLOR[k] }} />
            {k}
          </button>
        ))}
        <button
          onClick={() => setOnlyFlagged((v) => !v)}
          className={clsx(
            'chip cursor-pointer',
            onlyFlagged && '!border-rose-400/50 !text-rose-200',
          )}
        >
          ⚠ flagged only
        </button>
        <span className="ml-auto text-xs text-slate-500">
          {rows.length}/{a.trace.spans.length} spans · <span className="kbd">j</span>/
          <span className="kbd">k</span> to step
        </span>
      </div>
      <div className="grid grid-cols-[minmax(180px,34%)_1fr] border-b border-white/[0.06] bg-ink-850/60 text-[10px] text-slate-500">
        <div className="px-3 py-1.5 font-semibold tracking-wider uppercase">Span</div>
        <div className="relative h-6">
          {ticks.map((t, i) => (
            <span
              key={i}
              className="absolute top-1.5 -translate-x-1/2 font-mono first:translate-x-0 last:-translate-x-full"
              style={{ left: `${(t / dur) * 100}%` }}
            >
              {fmtMs(t)}
            </span>
          ))}
        </div>
      </div>
      <div className="max-h-[70vh] overflow-y-auto">
        {rows.slice(0, 2000).map((s) => {
          const left = ((s.start - t0) / dur) * 100
          const width = Math.max(0.35, ((s.end - s.start) / dur) * 100)
          const fs = flagged.get(s.id)
          const worst = fs?.reduce((w, f) =>
            ['critical', 'high', 'medium', 'low', 'info'].indexOf(f.severity) <
            ['critical', 'high', 'medium', 'low', 'info'].indexOf(w.severity)
              ? f
              : w,
          )
          const sel = s.id === selectedSpanId
          return (
            <button
              key={s.id}
              onClick={() => select(sel ? null : s.id)}
              className={clsx(
                'grid w-full grid-cols-[minmax(180px,34%)_1fr] border-b border-white/[0.03] text-left transition-colors',
                sel ? 'bg-rose-500/10' : 'hover:bg-white/[0.03]',
              )}
              data-testid="span-row"
              data-kind={s.kind}
              data-span-id={s.id}
            >
              <div
                className="flex min-w-0 items-center gap-1.5 px-2 py-1"
                style={{ paddingLeft: `${8 + (s.depth ?? 0) * 14}px` }}
              >
                <KindBadge kind={s.kind} />
                <span
                  className={clsx(
                    'truncate font-mono text-[12px]',
                    s.status === 'error' ? 'text-rose-300' : 'text-slate-200',
                  )}
                >
                  {spanLabel(s)}
                </span>
                {s.id === killerId && <span title="Killer span">☠️</span>}
                {worst && (
                  <span
                    className={clsx(
                      'ml-auto h-2 w-2 shrink-0 rounded-full',
                      SEV_DOT[worst.severity],
                    )}
                    title={fs!.map((f) => f.title).join('\n')}
                  />
                )}
              </div>
              <div className="relative h-7">
                <div
                  className={clsx(
                    'absolute top-1.5 h-4 rounded-sm',
                    s.status === 'error' && 'ring-2 ring-rose-500/80',
                    sel && 'ring-2 ring-white/70',
                  )}
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    background:
                      s.kind === 'agent' || s.kind === 'chain'
                        ? `${KIND_COLOR[s.kind]}33`
                        : KIND_COLOR[s.kind],
                    opacity: s.kind === 'agent' ? 1 : 0.85,
                  }}
                />
                <span
                  className="pointer-events-none absolute top-1.5 font-mono text-[10px] whitespace-nowrap text-slate-400"
                  style={
                    left + width > 75
                      ? { right: `${100 - left + 0.5}%` }
                      : { left: `calc(${left + width}% + 4px)` }
                  }
                >
                  {fmtMs(s.end - s.start)}
                  {s.kind === 'llm' &&
                    ` · ${fmtNum((s.inputTokens ?? 0) + (s.outputTokens ?? 0))} tok · ${fmtUsd(a.ctx.cost(s))}`}
                </span>
              </div>
            </button>
          )
        })}
        {!rows.length && (
          <div className="p-8 text-center text-sm text-slate-500">No spans match.</div>
        )}
      </div>
    </div>
  )
}
