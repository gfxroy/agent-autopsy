import clsx from 'clsx'
import { useMemo } from 'react'
import type { Analysis } from '../engine/analyze'
import { buildToolGraph } from '../engine/graph'
import type { Span } from '../engine/types'
import { estimateTokens, fmtMs, fmtNum, truncate } from '../engine/util'
import { useStore } from '../store'
import { findingsBySpan } from './Timeline'
import { KIND_COLOR, KIND_ICON, spanLabel } from './ui'

const NW = 156
const NH = 40
const CW = 196
const RH = 60
const PAD = 24

export function GraphView({ analysis: a }: { analysis: Analysis }) {
  const { select, selectedSpanId } = useStore()
  const { nodes, edges } = useMemo(() => buildToolGraph(a.ctx), [a])
  const flagged = useMemo(() => findingsBySpan(a.findings), [a.findings])

  const pos = useMemo(() => {
    const p = new Map<string, { x: number; y: number }>()
    const colOf = new Map<string, number>()
    const rows: number[] = []
    let col = -1
    for (const n of nodes) {
      let c: number
      if (n.kind === 'llm') c = ++col
      else {
        const owner = a.ctx.requestedBy.get(n.id)
        c = owner !== undefined && colOf.has(owner) ? colOf.get(owner)! : ++col
      }
      colOf.set(n.id, c)
      rows[c] = (rows[c] ?? 0) + 1
      p.set(n.id, { x: PAD + c * CW, y: PAD + (rows[c] - 1) * RH + (n.kind === 'llm' ? 0 : 14) })
    }
    return { p, cols: col + 1, maxRows: Math.max(1, ...rows.filter(Boolean)) }
  }, [nodes, a])

  const W = PAD * 2 + Math.max(1, pos.cols) * CW
  const H = PAD * 2 + pos.maxRows * RH + 20
  const fed = edges.filter((e) => e.kind === 'fed')

  const toolStats = useMemo(() => {
    const m = new Map<
      string,
      { calls: number; errors: number; ms: number; tok: number; fedInto: Set<string> }
    >()
    for (const t of a.ctx.tools) {
      const k = t.toolName ?? t.name
      const r = m.get(k) ?? { calls: 0, errors: 0, ms: 0, tok: 0, fedInto: new Set<string>() }
      r.calls++
      if (t.status === 'error') r.errors++
      r.ms += t.end - t.start
      r.tok += estimateTokens(t.toolResult)
      m.set(k, r)
    }
    for (const e of fed) {
      const src = a.ctx.byId.get(e.from)
      const dst = a.ctx.byId.get(e.to)
      if (src && dst) m.get(src.toolName ?? src.name)?.fedInto.add(dst.toolName ?? dst.name)
    }
    return [...m.entries()].sort((x, y) => y[1].calls - x[1].calls)
  }, [a, fed])

  if (!nodes.length)
    return (
      <div className="panel p-8 text-center text-slate-400">
        No LLM or tool calls in this trace.
      </div>
    )

  const anchor = (s: Span, side: 'top' | 'bottom' | 'right' | 'left') => {
    const q = pos.p.get(s.id)!
    if (side === 'top') return { x: q.x + NW / 2, y: q.y }
    if (side === 'bottom') return { x: q.x + NW / 2, y: q.y + NH }
    if (side === 'right') return { x: q.x + NW, y: q.y + NH / 2 }
    return { x: q.x, y: q.y + NH / 2 }
  }

  return (
    <div className="space-y-4" data-testid="graph">
      <div className="overflow-hidden panel">
        <div className="flex flex-wrap items-center gap-3 border-b border-white/[0.06] p-3 text-xs text-slate-400">
          <span className="panel-title">Tool-call graph</span>
          <Legend color="#a78bfa" label="LLM turn" />
          <Legend color="#22d3ee" label="tool call" />
          <span className="flex items-center gap-1">
            <svg width="26" height="8">
              <line
                x1="0"
                y1="4"
                x2="26"
                y2="4"
                stroke="#fbbf24"
                strokeWidth="2"
                strokeDasharray="4 3"
              />
            </svg>
            data lineage (output → later input)
          </span>
          <span className="ml-auto">{fed.length} lineage edges · click a node to inspect</span>
        </div>
        <div className="overflow-auto">
          <svg width={W} height={H} className="block" role="img" aria-label="Tool call graph">
            <defs>
              <marker
                id="arr"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M0 0L10 5L0 10z" fill="#475569" />
              </marker>
              <marker
                id="arr-fed"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M0 0L10 5L0 10z" fill="#fbbf24" />
              </marker>
            </defs>
            {edges
              .filter((e) => e.kind !== 'fed')
              .map((e, k) => {
                const s = a.ctx.byId.get(e.from)
                const t = a.ctx.byId.get(e.to)
                if (!s || !t || !pos.p.has(s.id) || !pos.p.has(t.id)) return null
                const p1 = e.kind === 'requested' ? anchor(s, 'bottom') : anchor(s, 'right')
                const p2 = e.kind === 'requested' ? anchor(t, 'top') : anchor(t, 'left')
                if (e.kind === 'requested' && Math.abs(p1.x - p2.x) < 2)
                  return (
                    <line
                      key={k}
                      x1={p1.x}
                      y1={p1.y}
                      x2={p2.x}
                      y2={p2.y - 2}
                      stroke="#475569"
                      strokeWidth="1.2"
                      markerEnd="url(#arr)"
                    />
                  )
                const mx = (p1.x + p2.x) / 2
                return (
                  <path
                    key={k}
                    d={`M${p1.x} ${p1.y} C${mx} ${p1.y}, ${mx} ${p2.y}, ${p2.x - 2} ${p2.y}`}
                    fill="none"
                    stroke="#334155"
                    strokeWidth="1.2"
                    markerEnd="url(#arr)"
                  />
                )
              })}
            {fed.map((e, k) => {
              const s = a.ctx.byId.get(e.from)
              const t = a.ctx.byId.get(e.to)
              if (!s || !t || !pos.p.has(s.id) || !pos.p.has(t.id)) return null
              const p1 = anchor(s, 'bottom')
              const p2 = anchor(t, 'bottom')
              const dip = Math.max(p1.y, p2.y) + 26 + (k % 3) * 8
              return (
                <g key={`f${k}`}>
                  <path
                    d={`M${p1.x} ${p1.y} C${p1.x} ${dip}, ${p2.x} ${dip}, ${p2.x} ${p2.y + 2}`}
                    fill="none"
                    stroke="#fbbf24"
                    strokeWidth="1.8"
                    strokeDasharray="5 4"
                    markerEnd="url(#arr-fed)"
                    opacity="0.85"
                  />
                  <text
                    x={(p1.x + p2.x) / 2}
                    y={dip - 4}
                    textAnchor="middle"
                    className="fill-amber-200 font-mono text-[9px]"
                  >
                    {truncate(e.label ?? '', 28)}
                  </text>
                </g>
              )
            })}
            {nodes.map((n) => {
              const q = pos.p.get(n.id)!
              const fs = flagged.get(n.id)
              const sel = selectedSpanId === n.id
              const err = n.status === 'error'
              return (
                <g
                  key={n.id}
                  transform={`translate(${q.x},${q.y})`}
                  onClick={() => select(n.id)}
                  className="cursor-pointer"
                  data-testid="graph-node"
                >
                  <rect
                    width={NW}
                    height={NH}
                    rx="8"
                    fill="#0f1118"
                    stroke={
                      sel ? '#fff' : err ? '#f43f5e' : fs ? '#fb923c' : `${KIND_COLOR[n.kind]}66`
                    }
                    strokeWidth={sel || err || fs ? 2 : 1}
                  />
                  <rect width="4" height={NH} rx="2" fill={KIND_COLOR[n.kind]} />
                  <text x="12" y="17" className="fill-slate-100 font-mono text-[11px]">
                    {KIND_ICON[n.kind]} {truncate(spanLabel(n), 18)}
                  </text>
                  <text x="12" y="31" className="fill-slate-500 font-mono text-[9.5px]">
                    {n.kind === 'llm'
                      ? `${fmtNum(n.inputTokens ?? 0)}→${fmtNum(n.outputTokens ?? 0)} tok`
                      : `${fmtMs(n.end - n.start)}${n.toolResult ? ` · ${fmtNum(estimateTokens(n.toolResult))} tok out` : ''}`}
                  </text>
                  {fs && (
                    <text x={NW - 14} y="16" className="text-[11px]">
                      ⚠
                    </text>
                  )}
                </g>
              )
            })}
          </svg>
        </div>
      </div>
      <div className="overflow-x-auto panel">
        <table className="w-full text-sm">
          <thead className="text-left text-[11px] tracking-wider text-slate-500 uppercase">
            <tr className="border-b border-white/[0.06]">
              <th className="px-3 py-2">Tool</th>
              <th className="px-3 py-2 text-right">Calls</th>
              <th className="px-3 py-2 text-right">Errors</th>
              <th className="px-3 py-2 text-right">Total time</th>
              <th className="px-3 py-2 text-right">Output tokens</th>
              <th className="px-3 py-2">Fed into</th>
              <th className="px-3 py-2">Declared</th>
            </tr>
          </thead>
          <tbody>
            {toolStats.map(([name, r]) => (
              <tr key={name} className="border-b border-white/[0.03]">
                <td className="px-3 py-1.5 font-mono text-cyan-200">{name}</td>
                <td className="px-3 py-1.5 text-right font-mono">{r.calls}</td>
                <td
                  className={clsx('px-3 py-1.5 text-right font-mono', r.errors && 'text-rose-300')}
                >
                  {r.errors}
                </td>
                <td className="px-3 py-1.5 text-right font-mono">{fmtMs(r.ms)}</td>
                <td className="px-3 py-1.5 text-right font-mono">{fmtNum(r.tok)}</td>
                <td className="px-3 py-1.5 font-mono text-xs text-amber-200">
                  {[...r.fedInto].join(', ') || '—'}
                </td>
                <td className="px-3 py-1.5">
                  {a.ctx.declared.size === 0 ? (
                    <span className="text-slate-600">n/a</span>
                  ) : a.ctx.declared.has(name) ? (
                    '✅'
                  ) : (
                    <span className="text-rose-300">❌ hallucinated</span>
                  )}
                </td>
              </tr>
            ))}
            {[...a.ctx.declared.keys()]
              .filter((n) => !toolStats.some(([k]) => k === n))
              .map((n) => (
                <tr key={n} className="border-b border-white/[0.03] text-slate-500">
                  <td className="px-3 py-1.5 font-mono">{n}</td>
                  <td className="px-3 py-1.5 text-right font-mono">0</td>
                  <td colSpan={4} className="px-3 py-1.5 text-xs">
                    never used — schema still sent on every call
                  </td>
                  <td className="px-3 py-1.5">✅</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  )
}
