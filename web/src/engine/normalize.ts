/**
 * Span normalizer: makes any importer's output safe to render and analyze.
 *  - unique ids, dangling parents removed, a single root
 *  - synthetic sequential timing when none is present
 *  - parent/child ordering, depth and step index
 *  - token estimates for LLM spans without usage
 *  - final answer fallback (last LLM output without tool calls)
 */
import { messagesTokens } from './importers/messages'
import type { Span, Trace } from './types'
import { estimateTokens, hash32 } from './util'

export function normalizeTrace(trace: Trace, sourceText = ''): Trace {
  const seen = new Set<string>()
  let spans: Span[] = trace.spans.map((s) => ({ ...s, attributes: s.attributes ?? {} }))
  for (const s of spans) {
    let id = s.id || 'span'
    while (seen.has(id)) id = `${id}'`
    s.id = id
    seen.add(id)
  }
  for (const s of spans) {
    if (s.parentId && (!seen.has(s.parentId) || s.parentId === s.id)) s.parentId = undefined
    if (!Number.isFinite(s.start)) s.start = 0
    if (!Number.isFinite(s.end) || s.end < s.start) s.end = s.start
  }

  // No timing information at all → lay spans out sequentially.
  let timingEstimated = trace.timingEstimated
  if (
    spans.length > 1 &&
    spans.every((s) => s.start === spans[0].start && s.end === spans[0].end)
  ) {
    timingEstimated = true
    let t = 0
    for (const s of spans) {
      if (s.kind === 'agent' || s.kind === 'chain') continue
      const d = s.kind === 'llm' ? 400 + (s.outputTokens ?? 50) * 15 : 300
      s.start = t
      s.end = t + d
      t += d
    }
    // Containers span their children.
    for (const s of [...spans].reverse()) {
      if (s.kind !== 'agent' && s.kind !== 'chain') continue
      const kids = spans.filter((k) => k.parentId === s.id)
      if (kids.length) {
        s.start = Math.min(...kids.map((k) => k.start))
        s.end = Math.max(...kids.map((k) => k.end))
      }
    }
    const roots = spans.filter((s) => !s.parentId)
    for (const r of roots) if (r.start === r.end && r.end === 0) r.end = t
  }

  // Single root.
  const roots = spans.filter((s) => !s.parentId)
  if (roots.length !== 1) {
    const start = Math.min(...spans.map((s) => s.start))
    const end = Math.max(...spans.map((s) => s.end))
    const rootId = seen.has('__root') ? `__root${spans.length}` : '__root'
    for (const r of roots) r.parentId = rootId
    spans.unshift({
      id: rootId,
      kind: 'agent',
      name: trace.name || 'run',
      start,
      end,
      status: 'ok',
      attributes: { synthetic: true },
    })
  }

  // Token estimates.
  for (const s of spans) {
    if (s.kind !== 'llm') continue
    if (s.inputTokens === undefined && s.input) {
      s.inputTokens = messagesTokens(s.input)
      s.tokensEstimated = true
    }
    if (s.outputTokens === undefined && s.output) {
      s.outputTokens = messagesTokens(s.output)
      s.tokensEstimated = true
    }
    s.inputTokens ??= 0
    s.outputTokens ??= 0
  }

  // Order: DFS from root, children by start time.
  const children = new Map<string, Span[]>()
  for (const s of spans)
    if (s.parentId) children.set(s.parentId, [...(children.get(s.parentId) ?? []), s])
  for (const list of children.values()) list.sort((a, b) => a.start - b.start || a.end - b.end)
  const root = spans.find((s) => !s.parentId)!
  const ordered: Span[] = []
  const walk = (s: Span, depth: number) => {
    s.depth = depth
    s.index = ordered.length
    ordered.push(s)
    for (const c of children.get(s.id) ?? []) walk(c, depth + 1)
  }
  walk(root, 0)
  // Grow container bounds to cover children.
  for (const s of [...ordered].reverse()) {
    for (const c of children.get(s.id) ?? []) {
      s.start = Math.min(s.start, c.start)
      s.end = Math.max(s.end, c.end)
    }
  }
  spans = ordered

  let finalOutput = trace.finalOutput
  if (finalOutput === undefined) {
    const llms = spans.filter((s) => s.kind === 'llm').sort((a, b) => a.end - b.end)
    const last = llms[llms.length - 1]
    const msgs = last?.output ?? []
    if (msgs.length && !msgs.some((m) => m.toolCalls?.length)) {
      const text = msgs
        .map((m) => m.content)
        .join('\n')
        .trim()
      if (text) finalOutput = text
    }
  }

  const id =
    trace.id ||
    `t${hash32(sourceText || JSON.stringify(spans.map((s) => [s.id, s.name, s.start]))).toString(36)}`
  return { ...trace, id, spans, finalOutput, timingEstimated }
}

/** Tokens of a tool result (estimated). */
export function resultTokens(s: Span): number {
  return estimateTokens(s.toolResult)
}
