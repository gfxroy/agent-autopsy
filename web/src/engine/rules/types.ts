import type { RuleContext } from '../context'
import type { Finding, RuleId } from '../types'

export interface Rule {
  id: RuleId
  name: string
  description: string
  run(ctx: RuleContext): Finding[]
}

export function wasteFromLlm(
  ctx: RuleContext,
  llmIds: Iterable<string>,
): { tokens: number; usd: number; bySpan: Record<string, number> } {
  const bySpan: Record<string, number> = {}
  let tokens = 0
  let usd = 0
  for (const id of new Set(llmIds)) {
    const s = ctx.byId.get(id)
    if (!s) continue
    const t = (s.inputTokens ?? 0) + (s.outputTokens ?? 0)
    bySpan[id] = t
    tokens += t
    usd += ctx.cost(s)
  }
  return { tokens, usd, bySpan }
}
