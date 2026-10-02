import type { Finding } from '../types'
import { wasteFromLlm, type Rule } from './types'

export function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return dp[b.length]
}

export function closest(name: string, options: string[]): string | undefined {
  let best: string | undefined
  let bestD = Infinity
  for (const o of options) {
    const d = levenshtein(name.toLowerCase(), o.toLowerCase())
    if (d < bestD) {
      bestD = d
      best = o
    }
  }
  // Only suggest names that are plausibly a typo / paraphrase of a real tool.
  return best !== undefined && bestD <= Math.max(2, Math.floor(name.length / 4)) ? best : undefined
}

const isHandoff = (name: string) => /^transfer_to_/i.test(name)

/** Calls to tools that were never declared to the model. */
export const unknownToolRule: Rule = {
  id: 'unknown-tool',
  name: 'Hallucinated tool names',
  description: 'The model called a tool that does not exist in the declared tool list.',
  run(ctx) {
    if (!ctx.declared.size) return []
    const names = [...ctx.declared.keys()]
    const hits = new Map<string, { spanIds: string[]; llmIds: string[] }>()
    const add = (name: string, spanId: string, llmId?: string) => {
      const h = hits.get(name) ?? { spanIds: [], llmIds: [] }
      if (!h.spanIds.includes(spanId)) h.spanIds.push(spanId)
      if (llmId) h.llmIds.push(llmId)
      hits.set(name, h)
    }
    for (const t of ctx.tools) {
      const name = t.toolName ?? t.name
      if (!ctx.declared.has(name) && !isHandoff(name)) add(name, t.id, ctx.requestedBy.get(t.id))
    }
    for (const { llm, call, toolSpan } of ctx.requestedCalls) {
      if (!toolSpan && !ctx.declared.has(call.name) && !call.name.startsWith('transfer_to_'))
        add(call.name, llm.id, llm.id)
    }
    const findings: Finding[] = []
    for (const [name, h] of hits) {
      const near = closest(name, names)
      const w = wasteFromLlm(ctx, h.llmIds)
      findings.push({
        rule: 'unknown-tool',
        severity: 'critical',
        title: `Called non-existent tool \`${name}\``,
        detail: `\`${name}\` is not among the ${names.length} declared tools (${names.slice(0, 6).join(', ')}${names.length > 6 ? ', …' : ''}). ${near ? `Closest real tool: \`${near}\`.` : ''}`,
        fix: `Make tool names unambiguous and describe when to use each; enable strict function calling / structured outputs; and reject unknown tool names in your loop with an error that lists the valid tools${near ? ` (e.g. "did you mean ${near}?")` : ''}.`,
        spanIds: h.spanIds,
        wastedTokens: w.tokens,
        wastedUsd: w.usd,
        wasteBySpan: w.bySpan,
        cause: `Hallucinated tool \`${name}\``,
        vars: { tool: name, near: near ?? 'nothing' },
      })
    }
    return findings
  },
}
