import type { Finding } from '../types'
import { estimateTokens, fmtNum } from '../util'
import type { Rule } from './types'

/** Tools declared on every call but never used — their schemas cost tokens each turn. */
export const unusedToolsRule: Rule = {
  id: 'unused-tools',
  name: 'Unused tools',
  description:
    'Declared tools the agent never called; their schemas are sent (and billed) on every LLM call.',
  run(ctx) {
    if (ctx.declared.size < 2 || !ctx.llm.length) return []
    const used = new Set([
      ...ctx.tools.map((t) => t.toolName ?? t.name),
      ...ctx.requestedCalls.map((c) => c.call.name),
    ])
    const unused = [...ctx.declared.values()].filter((t) => !used.has(t.name))
    if (!unused.length) return []
    const perCall = unused.reduce((a, t) => a + estimateTokens(JSON.stringify(t)), 0)
    const wasted = perCall * ctx.llm.length
    const bySpan: Record<string, number> = {}
    let usd = 0
    for (const l of ctx.llm) {
      bySpan[l.id] = perCall
      usd += ctx.inputUsd(l, perCall)
    }
    return [
      {
        rule: 'unused-tools',
        severity: wasted > 5000 ? 'medium' : 'low',
        title: `${unused.length} of ${ctx.declared.size} tools never used`,
        detail: `${unused.map((t) => `\`${t.name}\``).join(', ')} — ~${fmtNum(perCall)} schema tokens × ${ctx.llm.length} calls ≈ ${fmtNum(wasted)} tokens.`,
        fix: 'Only expose the tools relevant to the current task/step (dynamic tool selection), or merge rarely-used tools. Fewer tools also improves tool-choice accuracy.',
        spanIds: [],
        wastedTokens: wasted,
        wastedUsd: usd,
        wasteBySpan: bySpan,
        cause: 'Carrying dead weight (unused tools)',
        vars: { n: unused.length, tool: unused[0].name },
      } satisfies Finding,
    ]
  },
}

/** Multi-agent handoffs bouncing between the same agents. */
export const handoffRule: Rule = {
  id: 'handoff-pingpong',
  name: 'Handoff ping-pong',
  description: 'Agents handing the task back and forth without progress.',
  run(ctx) {
    const hs = ctx.spans.filter((s) => s.kind === 'handoff').sort((a, b) => a.start - b.start)
    if (hs.length < 3) return []
    const pairs = hs.map((h) => [
      String(h.attributes.from_agent ?? ''),
      String(h.attributes.to_agent ?? h.name),
    ])
    let bounces = 0
    for (let i = 1; i < pairs.length; i++)
      if (pairs[i][0] === pairs[i - 1][1] && pairs[i][1] === pairs[i - 1][0]) bounces++
    if (bounces < 2) return []
    return [
      {
        rule: 'handoff-pingpong',
        severity: bounces >= 3 ? 'critical' : 'high',
        title: `${bounces + 1} handoffs bouncing between ${pairs[0][0]} ⇄ ${pairs[0][1]}`,
        detail: 'Agents keep handing the conversation back to each other; neither owns the task.',
        fix: 'Give each agent a crisp, non-overlapping scope in its handoff description, pass a handoff reason/context, and cap the number of handoffs per run.',
        spanIds: [hs[1].id, ...hs.filter((_, i) => i !== 1).map((h) => h.id)],
        cause: 'Identity crisis — handoff ping-pong',
        vars: { a: pairs[0][0], b: pairs[0][1], n: bounces + 1 },
      },
    ]
  },
}
