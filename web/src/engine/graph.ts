/** Tool-call graph: which LLM turn requested which tool, and which tool outputs fed later tool inputs. */
import type { RuleContext } from './context'
import type { Span } from './types'

export interface GraphEdge {
  from: string
  to: string
  kind: 'requested' | 'returned' | 'fed'
  label?: string
}

/** Distinctive values in a tool result that could be passed on to another tool. */
export function extractValues(text: string | undefined): string[] {
  if (!text) return []
  const out = new Set<string>()
  const add = (v: string) => {
    const t = v.trim().replace(/[.,;:)\]]+$/, '')
    if (t.length >= 5 && t.length <= 120) out.add(t)
  }
  for (const m of text.matchAll(/https?:\/\/[^\s"'<>)\]]+/g)) add(m[0])
  for (const m of text.matchAll(/[\w.+-]+@[\w-]+\.[\w.]+/g)) add(m[0])
  for (const m of text.matchAll(/\b[A-Za-z]{2,}[-_#][A-Za-z0-9-_]{3,}\b/g)) add(m[0])
  for (const m of text.matchAll(/\b[0-9a-f]{8,40}\b/gi))
    if (/\d/.test(m[0]) && /[a-f]/i.test(m[0])) add(m[0])
  for (const m of text.matchAll(/(?:\.{0,2}\/)?(?:[\w-]+\/)+[\w.-]+\.\w{1,5}\b/g)) add(m[0])
  for (const m of text.matchAll(/\b\d{5,}\b/g)) add(m[0])
  return [...out].slice(0, 300)
}

export function buildToolGraph(ctx: RuleContext): { nodes: Span[]; edges: GraphEdge[] } {
  const nodes = [...ctx.llm, ...ctx.tools].sort(
    (a, b) => a.start - b.start || (a.index ?? 0) - (b.index ?? 0),
  )
  const edges: GraphEdge[] = []
  for (const t of ctx.tools) {
    const owner = ctx.requestedBy.get(t.id)
    if (owner) edges.push({ from: owner, to: t.id, kind: 'requested' })
    const next = ctx.llm.find((l) => l.start >= t.end - 1 && l.id !== owner)
    if (next) edges.push({ from: t.id, to: next.id, kind: 'returned' })
  }
  for (let i = 0; i < ctx.tools.length; i++) {
    const src = ctx.tools[i]
    const values = extractValues(src.toolResult)
    if (!values.length) continue
    for (let j = i + 1; j < ctx.tools.length; j++) {
      const dst = ctx.tools[j]
      const args = (dst.toolArgsRaw ?? JSON.stringify(dst.toolArgs ?? '')).toLowerCase()
      const srcArgs = (src.toolArgsRaw ?? '').toLowerCase()
      const hit = values.find(
        (v) => args.includes(v.toLowerCase()) && !srcArgs.includes(v.toLowerCase()),
      )
      if (hit)
        edges.push({
          from: src.id,
          to: dst.id,
          kind: 'fed',
          label: hit.length > 40 ? `${hit.slice(0, 39)}…` : hit,
        })
    }
  }
  return { nodes, edges }
}
