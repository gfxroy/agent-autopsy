import type { Finding, Span } from '../types'
import { fmtMs, fmtUsd } from '../util'
import type { Rule } from './types'

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}

/** Steps that dominate wall-clock time. Skipped when timings are synthetic. */
export const slowStepRule: Rule = {
  id: 'slow-step',
  name: 'Slow steps',
  description:
    'A single LLM/tool call that dominates the run’s latency (skipped for traces without real timings).',
  run(ctx) {
    if (ctx.trace.timingEstimated || ctx.duration <= 0) return []
    const leaf = ctx.spans.filter(
      (s) => s.kind === 'llm' || s.kind === 'tool' || s.kind === 'retrieval',
    )
    const findings: Finding[] = []
    const byKind = new Map<string, number[]>()
    for (const s of leaf) byKind.set(s.kind, [...(byKind.get(s.kind) ?? []), s.end - s.start])
    const slow: Span[] = leaf.filter((s) => {
      const d = s.end - s.start
      const med = median(byKind.get(s.kind) ?? [])
      return (d >= 0.3 * ctx.duration && d >= 5000) || (d >= 4 * med && d >= 10_000)
    })
    slow.sort((a, b) => b.end - b.start - (a.end - a.start))
    for (const s of slow.slice(0, 3)) {
      const d = s.end - s.start
      const pct = Math.round((d / ctx.duration) * 100)
      const name = s.toolName ?? s.name
      findings.push({
        rule: 'slow-step',
        severity: pct >= 50 ? 'medium' : 'low',
        title: `\`${name}\` took ${fmtMs(d)} (${pct}% of the run)`,
        detail: `This ${s.kind} step is ${(d / Math.max(1, median(byKind.get(s.kind) ?? []))).toFixed(1)}× the median ${s.kind} latency.`,
        fix:
          s.kind === 'llm'
            ? 'Use a smaller/faster model for this step, stream tokens, cut prompt size, or cache identical prompts.'
            : 'Add a timeout, cache results, run independent tool calls in parallel, or paginate the slow backend.',
        spanIds: [s.id],
        cause: `Exhaustion — one ${fmtMs(d)} \`${name}\` call`,
        vars: { tool: name, dur: fmtMs(d), pct },
      })
    }
    return findings
  },
}

/** A single LLM call that eats most of the budget. */
export const expensiveStepRule: Rule = {
  id: 'expensive-step',
  name: 'Expensive steps',
  description: 'One LLM call responsible for a large share of total cost.',
  run(ctx) {
    if (ctx.llm.length < 3 || ctx.totalCost <= 0) return []
    const top = [...ctx.llm].sort((a, b) => ctx.cost(b) - ctx.cost(a))[0]
    const share = ctx.cost(top) / ctx.totalCost
    if (share < 0.4 || ctx.cost(top) < 0.01) return []
    return [
      {
        rule: 'expensive-step',
        severity: share >= 0.6 ? 'medium' : 'low',
        title: `One call = ${Math.round(share * 100)}% of total cost (${fmtUsd(ctx.cost(top))})`,
        detail: `${top.model ?? 'LLM'} call with ${(top.inputTokens ?? 0).toLocaleString()} input / ${(top.outputTokens ?? 0).toLocaleString()} output tokens.`,
        fix: 'Enable prompt caching for the stable prefix, route this step to a cheaper model, or shrink what goes into the prompt.',
        spanIds: [top.id],
        cause: `Bled out on one ${fmtUsd(ctx.cost(top))} call`,
        vars: { usd: fmtUsd(ctx.cost(top)), pct: Math.round(share * 100) },
      },
    ]
  },
}
