import clsx from 'clsx'
import { useState } from 'react'
import type { Analysis } from '../engine/analyze'
import type { Message } from '../engine/types'
import { scanInjection } from '../engine/rules/injection'
import { fmtMs, fmtNum, fmtUsd } from '../engine/util'
import { useStore } from '../store'
import { KindBadge, Md, SeverityPill, spanLabel } from './ui'

function pretty(raw: string | undefined, parsed: unknown): string {
  if (parsed !== undefined && typeof parsed === 'object') return JSON.stringify(parsed, null, 2)
  if (!raw) return ''
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

export function MessageView({ m, compact }: { m: Message; compact?: boolean }) {
  const [open, setOpen] = useState(!compact || m.content.length < 400)
  const roleColor = {
    system: 'text-slate-400',
    user: 'text-sky-300',
    assistant: 'text-violet-300',
    tool: 'text-cyan-300',
  }[m.role]
  return (
    <div
      className={clsx(
        'rounded-lg border p-2',
        m.isError ? 'border-rose-500/30 bg-rose-500/[0.05]' : 'border-white/[0.06] bg-white/[0.02]',
      )}
    >
      <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold tracking-wider uppercase">
        <span className={roleColor}>{m.role}</span>
        {m.toolCallId && (
          <span className="font-mono text-slate-500 normal-case">{m.toolCallId}</span>
        )}
        {m.content.length > 400 && (
          <button
            className="ml-auto text-slate-500 normal-case hover:text-slate-300"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? 'collapse' : `expand (${fmtNum(m.content.length)} chars)`}
          </button>
        )}
      </div>
      {m.content && (
        <div
          className={clsx(
            'font-mono text-[11.5px] break-words whitespace-pre-wrap text-slate-300',
            !open && 'line-clamp-3',
          )}
        >
          {open ? m.content.slice(0, 20000) : m.content.slice(0, 300)}
        </div>
      )}
      {m.toolCalls?.map((c) => (
        <div
          key={c.id}
          className="mt-1 rounded border border-violet-400/20 bg-violet-500/[0.06] px-2 py-1 font-mono text-[11px]"
        >
          <span className="text-violet-300">→ {c.name}</span>
          <span className="text-slate-400">
            ({c.argsRaw.length > 300 ? `${c.argsRaw.slice(0, 300)}…` : c.argsRaw})
          </span>
        </div>
      ))}
    </div>
  )
}

export function Inspector({ analysis: a, spanId }: { analysis: Analysis; spanId: string }) {
  const { select } = useStore()
  const s = a.ctx.byId.get(spanId)
  const [showAllInput, setShowAllInput] = useState(false)
  if (!s) return null
  const fs = a.findings.filter((f) => f.spanIds.includes(s.id))
  const inj = s.kind === 'tool' ? scanInjection(s.toolResult) : { labels: [] as string[], score: 0 }
  const input = s.input ?? []
  const shownInput = showAllInput ? input : input.slice(-4)
  return (
    <aside
      className="fixed inset-x-2 bottom-2 z-40 flex max-h-[62vh] animate-slide-in flex-col overflow-hidden panel md:sticky md:inset-auto md:top-[108px] md:z-auto md:max-h-[calc(100vh-130px)] md:w-[440px] md:shrink-0"
      data-testid="inspector"
    >
      <div className="flex items-center gap-2 border-b border-white/[0.06] p-3">
        <KindBadge kind={s.kind} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-sm font-semibold text-white">{spanLabel(s)}</div>
          <div className="text-[11px] text-slate-500">
            {s.kind} · T+{fmtMs(s.start - a.ctx.t0)} · {fmtMs(s.end - s.start)}
            {s.index !== undefined && ` · #${s.index}`}
          </div>
        </div>
        <button
          className="btn-ghost !px-2 !py-1"
          onClick={() => select(null)}
          aria-label="Close inspector"
        >
          ✕
        </button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
        {s.status === 'error' && (
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-2 font-mono text-xs text-rose-200">
            ✖ {s.error ?? 'error'}
          </div>
        )}
        {fs.map((f, i) => (
          <div key={i} className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-2">
            <div className="flex items-center gap-2">
              <SeverityPill severity={f.severity} />
              <span className="text-xs font-semibold text-white">
                <Md text={f.title} />
              </span>
            </div>
            <div className="mt-1 text-xs text-emerald-200/80">Fix → {f.fix}</div>
          </div>
        ))}
        {s.kind === 'llm' && (
          <div className="grid grid-cols-3 gap-2 text-center">
            <Mini label="model" value={s.model ?? '—'} />
            <Mini
              label="tokens in/out"
              value={`${fmtNum(s.inputTokens ?? 0)}/${fmtNum(s.outputTokens ?? 0)}`}
              sub={
                s.tokensEstimated
                  ? 'estimated'
                  : s.cachedTokens
                    ? `${fmtNum(s.cachedTokens)} cached`
                    : undefined
              }
            />
            <Mini label="cost" value={fmtUsd(a.ctx.cost(s))} sub={s.finishReason} />
          </div>
        )}
        {s.kind === 'tool' && (
          <>
            <Section title="Arguments">
              <pre className="code-block">{pretty(s.toolArgsRaw, s.toolArgs) || '—'}</pre>
            </Section>
            <Section
              title={`Result${s.toolResult ? ` · ~${fmtNum(Math.ceil(s.toolResult.length / 4))} tokens` : ''}`}
            >
              {inj.labels.length > 0 && (
                <div className="mb-1.5 rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-xs text-rose-200">
                  ⚠ injection signals: {inj.labels.join(', ')}
                </div>
              )}
              <pre className="code-block">
                {s.toolResult?.slice(0, 30000) ??
                  (s.attributes.missingResult ? '(no result recorded)' : '—')}
              </pre>
            </Section>
          </>
        )}
        {s.kind === 'llm' && input.length > 0 && (
          <Section title={`Input · ${input.length} messages`}>
            {input.length > 4 && (
              <button
                className="mb-1.5 text-xs text-slate-400 hover:text-white"
                onClick={() => setShowAllInput((v) => !v)}
              >
                {showAllInput ? 'show last 4' : `show all ${input.length}`}
              </button>
            )}
            <div className="space-y-1.5">
              {shownInput.map((m, i) => (
                <MessageView key={i} m={m} compact />
              ))}
            </div>
          </Section>
        )}
        {s.kind === 'llm' && s.output && (
          <Section title="Output">
            <div className="space-y-1.5">
              {s.output.map((m, i) => (
                <MessageView key={i} m={m} />
              ))}
            </div>
          </Section>
        )}
        {Object.keys(s.attributes).length > 0 && (
          <details>
            <summary className="cursor-pointer panel-title">Raw attributes</summary>
            <pre className="mt-1 code-block">
              {JSON.stringify(
                s.attributes,
                (_k, v) => (typeof v === 'string' && v.length > 600 ? `${v.slice(0, 600)}…` : v),
                2,
              )}
            </pre>
          </details>
        )}
      </div>
    </aside>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-1 panel-title">{title}</div>
      {children}
    </section>
  )
}

function Mini({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1.5">
      <div className="text-[9px] tracking-wider text-slate-500 uppercase">{label}</div>
      <div className="truncate font-mono text-xs text-white" title={value}>
        {value}
      </div>
      {sub && <div className="truncate text-[10px] text-slate-500">{sub}</div>}
    </div>
  )
}
