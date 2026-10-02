import { contextWindow } from '../pricing'
import type { Finding, Span } from '../types'
import { estimateTokens, fmtNum } from '../util'
import type { Rule } from './types'

const BIG_RESULT = 1500

/** Huge tool outputs that get re-sent to the model on every following turn. */
export const contextBloatRule: Rule = {
  id: 'context-bloat',
  name: 'Context bloat',
  description:
    'Large tool outputs stay in the conversation and are paid for again on every later LLM call.',
  run(ctx) {
    const findings: Finding[] = []
    if (!ctx.llm.length) {
      // Tool-only traces (e.g. MCP logs): every byte returned lands in the client model's context.
      const big = new Map<string, Span[]>()
      for (const t of ctx.tools)
        if (estimateTokens(t.toolResult) >= 4000)
          big.set(t.toolName ?? t.name, [...(big.get(t.toolName ?? t.name) ?? []), t])
      for (const [name, list] of big) {
        const total = list.reduce((a, t) => a + estimateTokens(t.toolResult), 0)
        const size = estimateTokens(list[0].toolResult)
        findings.push({
          rule: 'context-bloat',
          severity: total >= 30_000 ? 'high' : 'medium',
          title: `\`${name}\` dumped ~${fmtNum(total)} tokens into the client's context${list.length > 1 ? ` (${list.length} calls)` : ''}`,
          detail: `Each \`${name}\` result is ~${fmtNum(size)} tokens. The calling model has to read (and pay for) all of it on every subsequent turn.`,
          fix: 'Add pagination / head / byte-range parameters to the tool, return summaries or schemas instead of full files, and cap response size server-side.',
          spanIds: list.map((t) => t.id),
          cause: `Context obesity — ${fmtNum(total)}-token \`${name}\` dump`,
          vars: { tool: name, tokens: fmtNum(size), n: list.length },
        })
      }
      return findings
    }
    for (const t of [...ctx.tools, ...ctx.spans.filter((s) => s.kind === 'retrieval')]) {
      const size = estimateTokens(t.toolResult)
      if (size < BIG_RESULT) continue
      const after = ctx.llm.filter((l) => l.start >= t.end - 1 && sameRun(ctx.byId, l, t))
      // When inputs are known, only count calls that actually contain the output.
      const withInputs = after.filter((l) => l.input?.length)
      const resent = withInputs.length
        ? withInputs.filter((l) =>
            l.input!.some(
              (m) =>
                m.role === 'tool' && (m.toolCallId === t.toolCallId || m.content === t.toolResult),
            ),
          )
        : after
      const extra = resent.slice(1) // first consumption is legitimate
      const wasted = size * extra.length
      if (wasted < 6000 && size < 8000) continue
      const bySpan: Record<string, number> = {}
      let usd = 0
      for (const l of extra) {
        bySpan[l.id] = size
        usd += ctx.inputUsd(l, size)
      }
      const name = t.toolName ?? t.name
      findings.push({
        rule: 'context-bloat',
        severity:
          wasted >= 50_000 || (wasted >= 15_000 && wasted >= 0.4 * ctx.totalTokens)
            ? 'high'
            : 'medium',
        title: `${fmtNum(size)}-token \`${name}\` output re-sent ${resent.length}×`,
        detail: `A single \`${name}\` result (~${fmtNum(size)} tokens) stayed in context for ${resent.length} later LLM call${resent.length === 1 ? '' : 's'}, costing ~${fmtNum(wasted)} extra input tokens.`,
        fix: 'Truncate or summarize tool outputs before returning them (top-k results, extract only relevant fields), store large blobs out-of-band and pass a handle, or drop stale tool results from history once consumed.',
        spanIds: [t.id, ...resent.map((l) => l.id)],
        wastedTokens: wasted,
        wastedUsd: usd,
        wasteBySpan: bySpan,
        cause: `Context obesity — ${fmtNum(size)}-token \`${name}\` dump`,
        vars: { tool: name, tokens: fmtNum(size), n: resent.length },
      })
    }
    return findings
  },
}

function sameRun(byId: Map<string, Span>, a: Span, b: Span): boolean {
  // Spans share an agent ancestor (or there is only one agent).
  const agentOf = (s: Span) => {
    let cur: Span | undefined = s
    while (cur) {
      if (cur.kind === 'agent') return cur.id
      cur = cur.parentId ? byId.get(cur.parentId) : undefined
    }
    return undefined
  }
  return agentOf(a) === agentOf(b)
}

/** Context window close to full, or growing without bound. */
export const contextOverflowRule: Rule = {
  id: 'context-overflow',
  name: 'Context window pressure',
  description:
    'Prompts approaching the model’s context limit, or context that keeps growing every turn.',
  run(ctx) {
    const findings: Finding[] = []
    let worst: { s: Span; ratio: number } | undefined
    for (const l of ctx.llm) {
      const ratio = (l.inputTokens ?? 0) / contextWindow(l.model)
      if (ratio >= 0.8 && (!worst || ratio > worst.ratio)) worst = { s: l, ratio }
    }
    if (worst) {
      const pct = Math.round(worst.ratio * 100)
      findings.push({
        rule: 'context-overflow',
        severity: worst.ratio >= 0.95 ? 'critical' : 'high',
        title: `Context window ${pct}% full`,
        detail: `One call sent ${fmtNum(worst.s.inputTokens ?? 0)} input tokens to ${worst.s.model ?? 'the model'} (limit ~${fmtNum(contextWindow(worst.s.model))}). Quality drops and truncation errors follow near the limit.`,
        fix: 'Summarize or window older turns, trim tool outputs, and move reference material to retrieval instead of the prompt.',
        spanIds: [worst.s.id],
        cause: `Suffocated — context ${pct}% full`,
        vars: { pct },
      })
    } else if (ctx.llm.length >= 4) {
      const first = ctx.llm[0].inputTokens ?? 0
      const last = ctx.llm[ctx.llm.length - 1].inputTokens ?? 0
      if (first > 0 && last >= first * 6 && last >= 30_000) {
        findings.push({
          rule: 'context-overflow',
          severity: 'medium',
          title: `Context grew ${Math.round(last / first)}× over the run`,
          detail: `Input grew from ${fmtNum(first)} to ${fmtNum(last)} tokens across ${ctx.llm.length} calls with no compaction.`,
          fix: 'Add a compaction step (summarize history every N turns) and prune tool results that are no longer needed.',
          spanIds: [ctx.llm[ctx.llm.length - 1].id],
          cause: 'Unbounded context growth',
          vars: { n: Math.round(last / first) },
        })
      }
    }
    return findings
  },
}
