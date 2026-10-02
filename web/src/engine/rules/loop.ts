import { canonicalJson } from '../util'
import type { Finding, Span } from '../types'
import { wasteFromLlm, type Rule } from './types'

const STOP = new Set([
  'the',
  'a',
  'an',
  'of',
  'for',
  'in',
  'on',
  'to',
  'and',
  'or',
  'with',
  'is',
  'what',
  'best',
  'top',
])

function argsKey(s: Span): string {
  return `${s.toolName ?? s.name}::${s.toolArgs !== undefined ? canonicalJson(s.toolArgs) : (s.toolArgsRaw ?? '')}`
}

function words(s: Span): Set<string> {
  const text = (s.toolArgsRaw ?? JSON.stringify(s.toolArgs ?? '')).toLowerCase()
  return new Set(text.split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w)))
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

/** Repeated identical tool calls (and near-identical paraphrased ones). */
export const loopRule: Rule = {
  id: 'loop',
  name: 'Loops & repeated tool calls',
  description: 'The same tool called again and again with identical (or near-identical) arguments.',
  run(ctx) {
    const findings: Finding[] = []
    const groups = new Map<string, Span[]>()
    for (const t of ctx.tools) groups.set(argsKey(t), [...(groups.get(argsKey(t)) ?? []), t])
    const flagged = new Set<string>()
    for (const [, list] of groups) {
      if (list.length < 2) continue
      // Two identical calls only count when back-to-back (no other tool call in between).
      if (list.length === 2) {
        const i0 = ctx.tools.indexOf(list[0])
        if (ctx.tools[i0 + 1] !== list[1] || list[0].status === 'error') continue
      }
      // Retrying a failing call is covered by the tool-error rule unless it repeats a lot.
      if (list.length < 4 && list.every((s) => s.status === 'error')) continue
      const n = list.length
      const name = list[0].toolName ?? list[0].name
      const repeats = list.slice(1)
      repeats.forEach((s) => flagged.add(s.id))
      const w = wasteFromLlm(
        ctx,
        repeats.map((s) => ctx.requestedBy.get(s.id)).filter((x): x is string => !!x),
      )
      findings.push({
        rule: 'loop',
        severity: n >= 5 ? 'critical' : n >= 3 ? 'high' : 'medium',
        title: `\`${name}\` called ${n}× with identical arguments`,
        detail: `The agent repeated the exact same \`${name}\` call ${n} times (args: ${truncateArgs(list[0])}). Every repeat returned information it already had.`,
        fix: 'Feed the previous result back explicitly ("you already searched X, result: …"), dedupe tool calls in your loop (cache by name+args), and add a max-iterations / no-progress stop condition.',
        spanIds: [list[1].id, ...list.filter((_, i) => i !== 1).map((s) => s.id)],
        wastedTokens: w.tokens,
        wastedUsd: w.usd,
        wasteBySpan: w.bySpan,
        cause: `Infinite loop — \`${name}\` ×${n}`,
        vars: { tool: name, n },
      })
    }
    // Near-duplicates: ≥4 consecutive calls of the same tool with ≥60% word overlap.
    const byTool = new Map<string, Span[]>()
    for (const t of ctx.tools)
      byTool.set(t.toolName ?? t.name, [...(byTool.get(t.toolName ?? t.name) ?? []), t])
    for (const [name, list] of byTool) {
      let cluster: Span[] = []
      const flush = () => {
        const fresh = cluster.filter((s) => !flagged.has(s.id))
        const uniq = new Set(cluster.map(argsKey))
        if (cluster.length >= 4 && fresh.length >= 3 && uniq.size > 1) {
          const w = wasteFromLlm(
            ctx,
            cluster
              .slice(1)
              .map((s) => ctx.requestedBy.get(s.id))
              .filter((x): x is string => !!x),
          )
          cluster.slice(1).forEach((s) => flagged.add(s.id))
          findings.push({
            rule: 'loop',
            severity: cluster.length >= 6 ? 'high' : 'medium',
            title: `\`${name}\` re-asked ${cluster.length}× with paraphrased arguments`,
            detail: `${cluster.length} consecutive \`${name}\` calls with near-identical arguments (≥60% word overlap) — the agent is rephrasing the same question instead of using results.`,
            fix: 'Tell the model what it already tried, raise result quality (more results per call), and stop when new calls return no new information.',
            spanIds: [cluster[1].id, ...cluster.filter((_, i) => i !== 1).map((s) => s.id)],
            wastedTokens: w.tokens,
            wastedUsd: w.usd,
            wasteBySpan: w.bySpan,
            cause: `Going in circles — \`${name}\` ×${cluster.length}`,
            vars: { tool: name, n: cluster.length },
          })
        }
        cluster = []
      }
      for (const s of list) {
        const prev = cluster[cluster.length - 1]
        if (!prev || jaccard(words(prev), words(s)) >= 0.6) cluster.push(s)
        else {
          flush()
          cluster = [s]
        }
      }
      flush()
    }
    return findings
  },
}

function truncateArgs(s: Span): string {
  const raw = s.toolArgsRaw ?? JSON.stringify(s.toolArgs ?? {})
  return raw.length > 80 ? `${raw.slice(0, 79)}…` : raw
}
