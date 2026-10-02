import { priceFor, spanCost, type PriceRow, DEFAULT_PRICES } from './pricing'
import type { Span, ToolCall, ToolDef, Trace } from './types'

export interface RuleContext {
  trace: Trace
  spans: Span[]
  llm: Span[]
  tools: Span[]
  byId: Map<string, Span>
  declared: Map<string, ToolDef>
  /** tool span id → id of the LLM span that requested it */
  requestedBy: Map<string, string>
  /** Every tool call requested in LLM outputs, in order. */
  requestedCalls: { llm: Span; call: ToolCall; toolSpan?: Span }[]
  prices: PriceRow[]
  cost(span: Span): number
  /** USD for `tokens` input tokens at the span's model price. */
  inputUsd(span: Span | undefined, tokens: number): number
  totalTokens: number
  totalCost: number
  duration: number
  t0: number
}

export function buildContext(trace: Trace, prices: PriceRow[] = DEFAULT_PRICES): RuleContext {
  const spans = trace.spans
  const byStart = (a: Span, b: Span) => a.start - b.start || (a.index ?? 0) - (b.index ?? 0)
  const llm = spans.filter((s) => s.kind === 'llm').sort(byStart)
  const tools = spans.filter((s) => s.kind === 'tool').sort(byStart)
  const byId = new Map(spans.map((s) => [s.id, s]))
  const declared = new Map(trace.tools.map((t) => [t.name, t]))
  const callOwner = new Map<string, Span>()
  for (const l of llm)
    for (const m of l.output ?? []) for (const c of m.toolCalls ?? []) callOwner.set(c.id, l)
  const requestedBy = new Map<string, string>()
  const toolByCallId = new Map<string, Span>()
  for (const t of tools) {
    let owner = t.toolCallId ? callOwner.get(t.toolCallId) : undefined
    if (!owner) {
      const before = llm.filter((l) => l.start <= t.start + 1)
      owner =
        [...before]
          .reverse()
          .find((l) => l.output?.some((m) => m.toolCalls?.some((c) => c.name === t.toolName))) ??
        before[before.length - 1]
    }
    if (owner) requestedBy.set(t.id, owner.id)
    if (t.toolCallId) toolByCallId.set(t.toolCallId, t)
  }
  const requestedCalls: RuleContext['requestedCalls'] = []
  for (const l of llm)
    for (const m of l.output ?? [])
      for (const c of m.toolCalls ?? [])
        requestedCalls.push({ llm: l, call: c, toolSpan: toolByCallId.get(c.id) })
  const costCache = new Map<string, number>()
  const cost = (s: Span) => {
    if (!costCache.has(s.id)) costCache.set(s.id, spanCost(s, prices).total)
    return costCache.get(s.id)!
  }
  const t0 = Math.min(...spans.map((s) => s.start))
  const t1 = Math.max(...spans.map((s) => s.end))
  return {
    trace,
    spans,
    llm,
    tools,
    byId,
    declared,
    requestedBy,
    requestedCalls,
    prices,
    cost,
    inputUsd: (s, tokens) => (tokens * priceFor(s?.model ?? llm[0]?.model, prices).input) / 1e6,
    totalTokens: llm.reduce((a, s) => a + (s.inputTokens ?? 0) + (s.outputTokens ?? 0), 0),
    totalCost: llm.reduce((a, s) => a + cost(s), 0),
    duration: t1 - t0,
    t0,
  }
}

export function llmTokens(s: Span | undefined): number {
  return s ? (s.inputTokens ?? 0) + (s.outputTokens ?? 0) : 0
}
