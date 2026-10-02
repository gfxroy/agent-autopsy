import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Analysis } from '../engine/analyze'
import type { Message, Span } from '../engine/types'
import { fmtMs, fmtNum, fmtUsd } from '../engine/util'
import { useHotkeys } from '../hooks'
import { useStore } from '../store'
import { MessageView } from './Inspector'
import { KindBadge, Md, SEV_DOT, spanLabel } from './ui'

interface Ev {
  span: Span
  messages: Message[]
}

export function ReplayView({ analysis: a }: { analysis: Analysis }) {
  const { select, selectedSpanId } = useStore()
  const events = useMemo<Ev[]>(() => {
    const leaf = a.trace.spans.filter(
      (s) =>
        s.kind === 'llm' ||
        s.kind === 'tool' ||
        s.kind === 'handoff' ||
        s.kind === 'retrieval' ||
        s.kind === 'guardrail',
    )
    return leaf.map((s) => ({
      span: s,
      messages:
        s.kind === 'llm'
          ? (s.output ?? [{ role: 'assistant', content: '(output not recorded)' }])
          : s.kind === 'tool'
            ? [
                {
                  role: 'tool',
                  content: s.toolResult ?? s.error ?? '(no result)',
                  isError: s.status === 'error',
                  toolCallId: s.toolCallId,
                },
              ]
            : [
                {
                  role: 'assistant',
                  content: `[${s.kind}] ${s.name}${s.error ? ` — ${s.error}` : ''}`,
                },
              ],
    }))
  }, [a])
  const prompt = useMemo(() => {
    const first = a.ctx.llm[0]
    return (first?.input ?? []).filter((m) => m.role === 'system' || m.role === 'user').slice(0, 4)
  }, [a])
  const [i, setI] = useState(0)
  const [playing, setPlaying] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const flagged = useMemo(
    () => new Map(a.findings.flatMap((f) => f.spanIds.map((id) => [id, f] as const))),
    [a.findings],
  )

  useEffect(() => {
    if (!playing) return
    if (i >= events.length - 1) return setPlaying(false)
    const id = setTimeout(() => setI((x) => Math.min(events.length - 1, x + 1)), 900)
    return () => clearTimeout(id)
  }, [playing, i, events.length])

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-ev="${i}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [i])

  useHotkeys({
    ArrowRight: () => setI((x) => Math.min(events.length - 1, x + 1)),
    ArrowLeft: () => setI((x) => Math.max(0, x - 1)),
    ' ': (e) => {
      e.preventDefault()
      setPlaying((p) => !p)
    },
  })

  if (!events.length)
    return <div className="panel p-8 text-center text-slate-400">No steps to replay.</div>
  const cur = events[i]
  const upto = events.slice(0, i + 1)
  const cumCost = upto.reduce((s, e) => s + a.ctx.cost(e.span), 0)
  const cumTok = upto.reduce(
    (s, e) => s + (e.span.inputTokens ?? 0) + (e.span.outputTokens ?? 0),
    0,
  )
  const lastLlm = [...upto].reverse().find((e) => e.span.kind === 'llm')?.span
  const f = flagged.get(cur.span.id)

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]" data-testid="replay">
      <div className="flex min-h-[60vh] flex-col overflow-hidden panel">
        <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] p-3">
          <button className="btn-ghost !px-2.5" onClick={() => setI(0)} aria-label="First step">
            ⏮
          </button>
          <button
            className="btn-ghost !px-2.5"
            onClick={() => setI((x) => Math.max(0, x - 1))}
            aria-label="Previous step"
          >
            ◀
          </button>
          <button
            className="btn-primary !px-3"
            onClick={() =>
              i >= events.length - 1 ? (setI(0), setPlaying(true)) : setPlaying((p) => !p)
            }
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? '⏸' : '▶'}
          </button>
          <button
            className="btn-ghost !px-2.5"
            onClick={() => setI((x) => Math.min(events.length - 1, x + 1))}
            aria-label="Next step"
          >
            ▶
          </button>
          <input
            type="range"
            min={0}
            max={events.length - 1}
            value={i}
            onChange={(e) => setI(Number(e.target.value))}
            className="min-w-40 flex-1 accent-rose-500"
            aria-label="Scrub steps"
            data-testid="scrubber"
          />
          <span className="font-mono text-xs text-slate-400">
            step {i + 1}/{events.length}
          </span>
        </div>
        <div className="relative h-2 bg-ink-800">
          {events.map((e, k) => (
            <span
              key={k}
              className={clsx(
                'absolute top-0 h-2 w-[3px]',
                flagged.has(e.span.id) ? SEV_DOT[flagged.get(e.span.id)!.severity] : 'bg-white/15',
              )}
              style={{ left: `${(k / Math.max(1, events.length - 1)) * 100}%` }}
            />
          ))}
        </div>
        <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto p-3">
          {prompt.map((m, k) => (
            <MessageView key={`p${k}`} m={m} compact />
          ))}
          {upto.map((e, k) => (
            <div
              key={k}
              data-ev={k}
              className={clsx(
                'rounded-xl p-1 transition',
                k === i && 'bg-rose-500/[0.07] ring-1 ring-rose-400/40',
              )}
              onClick={() => select(e.span.id)}
            >
              <div className="mb-1 flex items-center gap-1.5 px-1 text-[11px] text-slate-500">
                <KindBadge kind={e.span.kind} />
                <span className="font-mono">{spanLabel(e.span)}</span>
                {e.span.kind === 'tool' && e.span.toolArgsRaw && (
                  <span className="truncate font-mono text-slate-600">
                    {e.span.toolArgsRaw.slice(0, 80)}
                  </span>
                )}
                <span className="ml-auto font-mono">T+{fmtMs(e.span.start - a.ctx.t0)}</span>
                {flagged.has(e.span.id) && (
                  <span
                    className={clsx(
                      'h-2 w-2 rounded-full',
                      SEV_DOT[flagged.get(e.span.id)!.severity],
                    )}
                  />
                )}
              </div>
              <div className="space-y-1">
                {e.messages.map((m, j) => (
                  <MessageView key={j} m={m} compact={k !== i} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <aside className="space-y-3">
        <div className="panel p-3">
          <div className="panel-title">At this step</div>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
            <dt className="text-slate-500">Elapsed</dt>
            <dd className="text-right font-mono">{fmtMs(cur.span.end - a.ctx.t0)}</dd>
            <dt className="text-slate-500">Context size</dt>
            <dd className="text-right font-mono">{fmtNum(lastLlm?.inputTokens ?? 0)} tok</dd>
            <dt className="text-slate-500">Tokens so far</dt>
            <dd className="text-right font-mono">{fmtNum(cumTok)}</dd>
            <dt className="text-slate-500">Spend so far</dt>
            <dd className="text-right font-mono">{fmtUsd(cumCost)}</dd>
          </dl>
          <div className="mt-3 h-1.5 overflow-hidden rounded bg-white/10">
            <div
              className="h-full bg-gradient-to-r from-cyan-400 to-rose-500 transition-all"
              style={{ width: `${(cumCost / Math.max(1e-9, a.totalCost)) * 100}%` }}
            />
          </div>
        </div>
        {f && (
          <div className="animate-pop panel border-rose-500/30 p-3 text-sm">
            <div className="panel-title text-rose-300">⚠ Problem at this step</div>
            <div className="mt-1 font-semibold text-white">
              <Md text={f.title} />
            </div>
            <div className="mt-1 text-emerald-200/80">Fix → {f.fix}</div>
          </div>
        )}
        <div className="panel p-3 text-xs text-slate-400">
          <span className="kbd">←</span> <span className="kbd">→</span> step ·{' '}
          <span className="kbd">space</span> play/pause · click a step to inspect
          {selectedSpanId && <span className="block pt-1 text-slate-500">Inspector open →</span>}
        </div>
      </aside>
    </div>
  )
}
