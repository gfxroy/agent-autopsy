import type { Analysis } from './analyze'
import type { Finding, Span } from './types'

export interface SeqOp {
  op: 'same' | 'added' | 'removed'
  name: string
  a?: Span
  b?: Span
}

/** LCS alignment of two tool-call sequences by tool name. */
export function alignSequences(a: Span[], b: Span[]): SeqOp[] {
  const n = a.length
  const m = b.length
  const key = (s: Span) => s.toolName ?? s.name
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] =
        key(a[i]) === key(b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const ops: SeqOp[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (key(a[i]) === key(b[j])) {
      ops.push({ op: 'same', name: key(a[i]), a: a[i], b: b[j] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ op: 'removed', name: key(a[i]), a: a[i] })
      i++
    } else {
      ops.push({ op: 'added', name: key(b[j]), b: b[j] })
      j++
    }
  }
  while (i < n) ops.push({ op: 'removed', name: key(a[i]), a: a[i++] })
  while (j < m) ops.push({ op: 'added', name: key(b[j]), b: b[j++] })
  return ops
}

export interface Metric {
  label: string
  a: number
  b: number
  /** true when lower is better */
  lowerBetter: boolean
  format: 'usd' | 'ms' | 'num' | 'pct'
}

export interface RunDiff {
  metrics: Metric[]
  sequence: SeqOp[]
  fixed: Finding[]
  introduced: Finding[]
  persisting: Finding[]
  modelsA: string[]
  modelsB: string[]
  verdict: string
}

const fkey = (f: Finding) => `${f.rule}:${f.vars?.tool ?? ''}`

export function diffRuns(a: Analysis, b: Analysis): RunDiff {
  const errs = (x: Analysis) => x.ctx.tools.filter((t) => t.status === 'error').length
  const metrics: Metric[] = [
    { label: 'Health score', a: a.health, b: b.health, lowerBetter: false, format: 'num' },
    { label: 'Total cost', a: a.totalCost, b: b.totalCost, lowerBetter: true, format: 'usd' },
    { label: 'Wall-clock', a: a.duration, b: b.duration, lowerBetter: true, format: 'ms' },
    { label: 'Total tokens', a: a.totalTokens, b: b.totalTokens, lowerBetter: true, format: 'num' },
    {
      label: 'Wasted tokens',
      a: a.wastedTokens,
      b: b.wastedTokens,
      lowerBetter: true,
      format: 'num',
    },
    {
      label: 'LLM calls',
      a: a.ctx.llm.length,
      b: b.ctx.llm.length,
      lowerBetter: true,
      format: 'num',
    },
    {
      label: 'Tool calls',
      a: a.ctx.tools.length,
      b: b.ctx.tools.length,
      lowerBetter: true,
      format: 'num',
    },
    { label: 'Tool errors', a: errs(a), b: errs(b), lowerBetter: true, format: 'num' },
    {
      label: 'Efficiency',
      a: a.efficiency * 100,
      b: b.efficiency * 100,
      lowerBetter: false,
      format: 'pct',
    },
  ]
  const ka = new Map(a.findings.map((f) => [fkey(f), f]))
  const kb = new Map(b.findings.map((f) => [fkey(f), f]))
  const fixed = a.findings.filter((f) => !kb.has(fkey(f)))
  const introduced = b.findings.filter((f) => !ka.has(fkey(f)))
  const persisting = b.findings.filter((f) => ka.has(fkey(f)))
  const dh = b.health - a.health
  const dc = a.totalCost > 0 ? (b.totalCost - a.totalCost) / a.totalCost : 0
  const verdict =
    dh > 0
      ? `Run B is healthier (+${dh} pts, ${a.grade} → ${b.grade})${dc < 0 ? ` and ${Math.round(-dc * 100)}% cheaper` : dc > 0 ? ` but ${Math.round(dc * 100)}% more expensive` : ''}.`
      : dh < 0
        ? `Run B regressed (${dh} pts, ${a.grade} → ${b.grade})${dc > 0 ? ` and costs ${Math.round(dc * 100)}% more` : ''}.`
        : `Same health (${a.grade}); cost ${dc === 0 ? 'unchanged' : `${dc > 0 ? '+' : ''}${Math.round(dc * 100)}%`}.`
  return {
    metrics,
    sequence: alignSequences(a.ctx.tools, b.ctx.tools),
    fixed,
    introduced,
    persisting,
    modelsA: a.models.map((m) => m.model),
    modelsB: b.models.map((m) => m.model),
    verdict,
  }
}
