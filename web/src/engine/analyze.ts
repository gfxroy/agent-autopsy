import { buildContext, type RuleContext } from './context'
import { DEFAULT_PRICES, normalizeModel, priceFor, type PriceRow } from './pricing'
import { RULES } from './rules'
import type { Finding, Severity, Span, Trace } from './types'

export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
}
const PENALTY: Record<Severity, number> = { critical: 28, high: 14, medium: 6, low: 2, info: 0 }
const RULE_ORDER = RULES.map((r) => r.id)

export type Grade = 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D' | 'F'

export function gradeFor(health: number): Grade {
  const table: [number, Grade][] = [
    [97, 'A+'],
    [92, 'A'],
    [88, 'A-'],
    [84, 'B+'],
    [78, 'B'],
    [74, 'B-'],
    [70, 'C+'],
    [64, 'C'],
    [60, 'C-'],
    [50, 'D'],
  ]
  for (const [min, g] of table) if (health >= min) return g
  return 'F'
}

export interface ModelRow {
  model: string
  calls: number
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  cost: number
}

export interface Verdict {
  status: 'alive' | 'injured' | 'dead'
  cause: string
  killer?: Finding
  killerSpan?: Span
  /** ms since run start */
  timeOfDeath?: number
  step?: number
  steps: number
}

export interface Analysis {
  trace: Trace
  ctx: RuleContext
  findings: Finding[]
  health: number
  grade: Grade
  iq: number
  efficiency: number
  wastedTokens: number
  wastedUsd: number
  totalTokens: number
  totalCost: number
  duration: number
  models: ModelRow[]
  verdict: Verdict
  counts: Record<Severity, number>
}

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      RULE_ORDER.indexOf(a.rule) - RULE_ORDER.indexOf(b.rule) ||
      (b.wastedTokens ?? 0) - (a.wastedTokens ?? 0),
  )
}

export function analyze(trace: Trace, prices: PriceRow[] = DEFAULT_PRICES): Analysis {
  const ctx = buildContext(trace, prices)
  const raw: Finding[] = []
  for (const rule of RULES) {
    try {
      raw.push(...rule.run(ctx))
    } catch (err) {
      console.warn(`rule ${rule.id} failed`, err)
    }
  }
  const findings = sortFindings(raw)

  // Waste: per-span, capped at the span's own token count so overlapping findings don't double count.
  const perSpan = new Map<string, number>()
  for (const f of findings)
    for (const [id, t] of Object.entries(f.wasteBySpan ?? {})) {
      const s = ctx.byId.get(id)
      const cap = s ? (s.inputTokens ?? 0) + (s.outputTokens ?? 0) : t
      perSpan.set(id, Math.min(cap, (perSpan.get(id) ?? 0) + t))
    }
  let wastedTokens = 0
  let wastedUsd = 0
  for (const [id, t] of perSpan) {
    wastedTokens += t
    const s = ctx.byId.get(id)
    const total = s ? (s.inputTokens ?? 0) + (s.outputTokens ?? 0) : 0
    wastedUsd += s && total ? ctx.cost(s) * (t / total) : 0
  }
  const efficiency =
    ctx.totalTokens > 0 ? Math.max(0, Math.min(1, 1 - wastedTokens / ctx.totalTokens)) : 1

  const byRule = new Map<string, number[]>()
  for (const f of findings) byRule.set(f.rule, [...(byRule.get(f.rule) ?? []), PENALTY[f.severity]])
  let penalty = 0
  for (const ps of byRule.values())
    penalty += Math.min(
      ps.reduce((a, b) => a + b, 0),
      Math.max(...ps) * 1.6,
    )
  penalty += Math.max(0, 0.9 - efficiency) * 30
  const health = Math.max(0, Math.min(100, Math.round(100 - penalty)))
  const grade = gradeFor(health)
  const iq = Math.round(55 + health * 0.8 + efficiency * 15)

  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
  for (const f of findings) counts[f.severity]++

  const steps = trace.spans.filter((s) => s.kind !== 'agent' && s.kind !== 'chain')
  const killer = findings.find(
    (f) => SEVERITY_RANK[f.severity] <= SEVERITY_RANK.medium && f.spanIds.length,
  )
  const serious = counts.critical + counts.high > 0
  const status: Verdict['status'] = serious || health < 70 ? 'dead' : killer ? 'injured' : 'alive'
  const killerSpan = killer ? ctx.byId.get(killer.spanIds[0]) : undefined
  const verdict: Verdict = {
    status,
    cause:
      status === 'alive'
        ? 'Natural causes — completed the task cleanly'
        : (killer?.cause ?? 'Multiple minor injuries'),
    killer,
    killerSpan,
    timeOfDeath: killerSpan ? killerSpan.end - ctx.t0 : undefined,
    step: killerSpan ? steps.indexOf(killerSpan) + 1 || undefined : undefined,
    steps: steps.length,
  }

  const models = new Map<string, ModelRow>()
  for (const l of ctx.llm) {
    const key = normalizeModel(l.model) || 'unknown'
    const row = models.get(key) ?? {
      model: key,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      cost: 0,
    }
    row.calls++
    row.inputTokens += l.inputTokens ?? 0
    row.outputTokens += l.outputTokens ?? 0
    row.cachedTokens += l.cachedTokens ?? 0
    row.cost += ctx.cost(l)
    models.set(key, row)
  }

  return {
    trace,
    ctx,
    findings,
    health,
    grade,
    iq,
    efficiency,
    wastedTokens,
    wastedUsd,
    totalTokens: ctx.totalTokens,
    totalCost: ctx.totalCost,
    duration: ctx.duration,
    models: [...models.values()].sort((a, b) => b.cost - a.cost),
    verdict,
    counts,
  }
}

export function isPriced(model: string | undefined, prices: PriceRow[]): boolean {
  return priceFor(model, prices).pattern !== '*'
}
