import clsx from 'clsx'
import { useMemo } from 'react'
import type { Analysis } from '../engine/analyze'
import { isPriced } from '../engine/analyze'
import { messagesTokens } from '../engine/importers/messages'
import { contextWindow, DEFAULT_PRICES, priceFor, spanCost, type PriceRow } from '../engine/pricing'
import { fmtNum, fmtUsd } from '../engine/util'
import { useStore } from '../store'
import { Stat } from './ui'

const ROLE_COLORS = {
  system: '#64748b',
  user: '#38bdf8',
  assistant: '#a78bfa',
  tool: '#22d3ee',
} as const

export function CostView({ analysis: a }: { analysis: Analysis }) {
  const { prices, setPrices, select, selectedSpanId } = useStore()
  const llm = a.ctx.llm
  const waste = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of a.findings)
      for (const [id, t] of Object.entries(f.wasteBySpan ?? {})) m.set(id, (m.get(id) ?? 0) + t)
    return m
  }, [a.findings])
  const maxCost = Math.max(1e-9, ...llm.map((s) => a.ctx.cost(s)))
  const inTok = llm.reduce((s, x) => s + (x.inputTokens ?? 0), 0)
  const outTok = llm.reduce((s, x) => s + (x.outputTokens ?? 0), 0)
  const cached = llm.reduce((s, x) => s + (x.cachedTokens ?? 0), 0)
  const unpriced = a.models.filter((m) => !isPriced(m.model, prices))

  return (
    <div className="space-y-4" data-testid="cost">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Total cost" value={fmtUsd(a.totalCost)} />
        <Stat
          label="Wasted"
          value={fmtUsd(a.wastedUsd)}
          sub={`${fmtNum(a.wastedTokens)} tokens`}
          tone={a.wastedUsd > 0 ? 'bad' : 'good'}
        />
        <Stat
          label="Input tokens"
          value={fmtNum(inTok)}
          sub={cached ? `${fmtNum(cached)} cached` : 'no cache hits'}
        />
        <Stat label="Output tokens" value={fmtNum(outTok)} />
        <Stat
          label="LLM calls"
          value={llm.length}
          sub={llm.length ? `${fmtUsd(a.totalCost / llm.length)} avg` : undefined}
        />
        <Stat
          label="Efficiency"
          value={`${Math.round(a.efficiency * 100)}%`}
          tone={a.efficiency < 0.6 ? 'bad' : a.efficiency > 0.85 ? 'good' : 'warn'}
        />
      </div>

      {llm.length === 0 ? (
        <div className="panel p-6 text-center text-sm text-slate-400">
          No LLM calls in this trace (tool-only log) — nothing to price.
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          <section className="panel p-4">
            <h3 className="panel-title">Cost per LLM call</h3>
            <p className="mt-1 text-xs text-slate-500">
              <span className="inline-block h-2 w-2 rounded-sm bg-violet-400" /> input{' '}
              <span className="ml-2 inline-block h-2 w-2 rounded-sm bg-fuchsia-300" /> output{' '}
              <span className="ml-2 inline-block h-2 w-2 rounded-sm bg-rose-500" /> wasted share
            </p>
            <div className="mt-3 space-y-1">
              {llm.map((s, i) => {
                const c = spanCost(s, prices)
                const total = (s.inputTokens ?? 0) + (s.outputTokens ?? 0)
                const w = Math.min(1, (waste.get(s.id) ?? 0) / Math.max(1, total))
                return (
                  <button
                    key={s.id}
                    onClick={() => select(s.id)}
                    className={clsx(
                      'grid w-full grid-cols-[2.2rem_1fr_4.5rem] items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-white/[0.04]',
                      selectedSpanId === s.id && 'bg-white/[0.06]',
                    )}
                  >
                    <span className="font-mono text-[11px] text-slate-500">#{i + 1}</span>
                    <span className="relative h-4 overflow-hidden rounded-sm bg-white/[0.04]">
                      <span
                        className="absolute inset-y-0 left-0 flex"
                        style={{ width: `${(c.total / maxCost) * 100}%` }}
                      >
                        <span
                          className="h-full bg-violet-400/80"
                          style={{ width: `${(c.input / Math.max(1e-12, c.total)) * 100}%` }}
                        />
                        <span className="h-full flex-1 bg-fuchsia-300/80" />
                      </span>
                      {w > 0 && (
                        <span
                          className="absolute inset-y-0 left-0 bg-[repeating-linear-gradient(45deg,rgba(244,63,94,.85)_0_4px,rgba(244,63,94,.35)_4px_8px)]"
                          style={{ width: `${(c.total / maxCost) * w * 100}%` }}
                        />
                      )}
                    </span>
                    <span className="text-right font-mono text-[11px] text-slate-300">
                      {fmtUsd(c.total)}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>
          <ContextChart analysis={a} />
        </div>
      )}

      <section className="overflow-x-auto panel">
        <div className="flex items-center justify-between border-b border-white/[0.06] p-3">
          <h3 className="panel-title">By model</h3>
          {unpriced.length > 0 && (
            <span className="text-xs text-amber-300">
              ⚠ {unpriced.map((m) => m.model).join(', ')} not in price table — using fallback “*”
              row
            </span>
          )}
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-[11px] tracking-wider text-slate-500 uppercase">
            <tr>
              {['Model', 'Calls', 'Input', 'Cached', 'Output', '$/1M in·out', 'Cost', 'Share'].map(
                (h) => (
                  <th key={h} className="px-3 py-2">
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {a.models.map((m) => {
              const p = priceFor(m.model, prices)
              return (
                <tr key={m.model} className="border-t border-white/[0.04] font-mono text-[12.5px]">
                  <td className="px-3 py-1.5 text-violet-200">{m.model}</td>
                  <td className="px-3 py-1.5">{m.calls}</td>
                  <td className="px-3 py-1.5">{fmtNum(m.inputTokens)}</td>
                  <td className="px-3 py-1.5">{fmtNum(m.cachedTokens)}</td>
                  <td className="px-3 py-1.5">{fmtNum(m.outputTokens)}</td>
                  <td className="px-3 py-1.5 text-slate-400">
                    {p.input}·{p.output} <span className="text-slate-600">({p.pattern})</span>
                  </td>
                  <td className="px-3 py-1.5">{fmtUsd(m.cost)}</td>
                  <td className="px-3 py-1.5">
                    {a.totalCost ? Math.round((m.cost / a.totalCost) * 100) : 0}%
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      <PriceEditor prices={prices} setPrices={setPrices} />
    </div>
  )
}

function ContextChart({ analysis: a }: { analysis: Analysis }) {
  const llm = a.ctx.llm
  const W = 560
  const H = 220
  const P = { l: 46, r: 12, t: 14, b: 26 }
  const data = llm.map((s) => {
    const by = { system: 0, user: 0, assistant: 0, tool: 0 }
    for (const m of s.input ?? []) by[m.role] += messagesTokens([m])
    const est = Object.values(by).reduce((x, y) => x + y, 0)
    const scale = est > 0 ? (s.inputTokens ?? est) / est : 0
    return {
      s,
      by: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v * scale])) as typeof by,
      total: s.inputTokens ?? 0,
    }
  })
  const limit = contextWindow(llm[0]?.model)
  const maxY = Math.max(1, ...data.map((d) => d.total)) * 1.1
  const showLimit = limit <= maxY * 3
  const yMax = showLimit ? Math.max(maxY, limit * 1.05) : maxY
  const x = (i: number) =>
    P.l + (data.length <= 1 ? (W - P.l - P.r) / 2 : (i / (data.length - 1)) * (W - P.l - P.r))
  const y = (v: number) => H - P.b - (v / yMax) * (H - P.t - P.b)
  const roles = ['system', 'user', 'assistant', 'tool'] as const
  const hasComposition = data.some((d) => Object.values(d.by).some((v) => v > 0))
  let base = data.map(() => 0)
  const areas = roles.map((r) => {
    const top = data.map(
      (d, i) => base[i] + (hasComposition ? d.by[r] : r === 'user' ? d.total : 0),
    )
    const path = `M${data.map((_, i) => `${x(i)},${y(top[i])}`).join(' L')} L${data.map((_, i) => `${x(data.length - 1 - i)},${y(base[data.length - 1 - i])}`).join(' L')} Z`
    base = top
    return { r, path }
  })
  return (
    <section className="panel p-4">
      <div className="flex items-center justify-between">
        <h3 className="panel-title">Context window growth</h3>
        <span className="text-xs text-slate-500">
          input tokens per call{' '}
          {showLimit ? `· limit ${fmtNum(limit)}` : `· limit ${fmtNum(limit)} (off-chart)`}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-2 w-full"
        role="img"
        aria-label="Context growth chart"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line
              x1={P.l}
              x2={W - P.r}
              y1={y(yMax * f)}
              y2={y(yMax * f)}
              stroke="rgba(255,255,255,0.05)"
            />
            <text
              x={P.l - 6}
              y={y(yMax * f) + 3}
              textAnchor="end"
              className="fill-slate-500 font-mono text-[9px]"
            >
              {fmtNum(Math.round(yMax * f))}
            </text>
          </g>
        ))}
        {areas.map(({ r, path }) => (
          <path key={r} d={path} fill={ROLE_COLORS[r]} opacity="0.55" />
        ))}
        <polyline
          points={data.map((d, i) => `${x(i)},${y(d.total)}`).join(' ')}
          fill="none"
          stroke="#fff"
          strokeWidth="1.5"
        />
        {data.map((d, i) => (
          <circle key={i} cx={x(i)} cy={y(d.total)} r="2.5" fill="#fff">
            <title>{`call #${i + 1}: ${fmtNum(d.total)} input tokens`}</title>
          </circle>
        ))}
        {showLimit && (
          <g>
            <line
              x1={P.l}
              x2={W - P.r}
              y1={y(limit)}
              y2={y(limit)}
              stroke="#f43f5e"
              strokeDasharray="6 4"
            />
            <text
              x={W - P.r}
              y={y(limit) - 4}
              textAnchor="end"
              className="fill-rose-300 font-mono text-[9px]"
            >
              context limit
            </text>
          </g>
        )}
        {data.map((_, i) =>
          data.length <= 20 || i % Math.ceil(data.length / 20) === 0 ? (
            <text
              key={i}
              x={x(i)}
              y={H - 8}
              textAnchor="middle"
              className="fill-slate-500 font-mono text-[9px]"
            >
              {i + 1}
            </text>
          ) : null,
        )}
      </svg>
      {hasComposition && (
        <div className="mt-1 flex gap-3 text-[11px] text-slate-400">
          {roles.map((r) => (
            <span key={r} className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm" style={{ background: ROLE_COLORS[r] }} />
              {r}
            </span>
          ))}
        </div>
      )}
    </section>
  )
}

function PriceEditor({
  prices,
  setPrices,
}: {
  prices: PriceRow[]
  setPrices: (p: PriceRow[]) => void
}) {
  const upd = (i: number, k: keyof PriceRow, v: string) => {
    const next = prices.map((r, j) =>
      j === i ? { ...r, [k]: k === 'pattern' ? v : Number(v) || 0 } : r,
    )
    setPrices(next)
  }
  return (
    <details className="panel p-3" data-testid="price-editor">
      <summary className="cursor-pointer panel-title">
        Price table (USD per 1M tokens) — editable, saved locally
      </summary>
      <div className="mt-3 overflow-x-auto">
        <table className="text-sm">
          <thead className="text-left text-[11px] text-slate-500 uppercase">
            <tr>
              <th className="px-2 py-1">Model prefix</th>
              <th className="px-2 py-1">Input</th>
              <th className="px-2 py-1">Cached input</th>
              <th className="px-2 py-1">Output</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {prices.map((r, i) => (
              <tr key={i}>
                <td className="px-2 py-0.5">
                  <input
                    value={r.pattern}
                    onChange={(e) => upd(i, 'pattern', e.target.value)}
                    className="w-44 rounded border border-white/10 bg-ink-800 px-2 py-0.5 font-mono text-xs"
                    aria-label="Model prefix"
                  />
                </td>
                {(['input', 'cachedInput', 'output'] as const).map((k) => (
                  <td key={k} className="px-2 py-0.5">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={r[k] ?? ''}
                      onChange={(e) => upd(i, k, e.target.value)}
                      className="w-24 rounded border border-white/10 bg-ink-800 px-2 py-0.5 font-mono text-xs"
                      aria-label={`${r.pattern} ${k}`}
                    />
                  </td>
                ))}
                <td>
                  <button
                    className="text-xs text-slate-500 hover:text-rose-300"
                    onClick={() => setPrices(prices.filter((_, j) => j !== i))}
                    aria-label="Remove row"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          className="btn-ghost !text-xs"
          onClick={() =>
            setPrices([{ pattern: 'my-model', input: 1, output: 4, cachedInput: 0.25 }, ...prices])
          }
        >
          + Add model
        </button>
        <button className="btn-ghost !text-xs" onClick={() => setPrices(DEFAULT_PRICES)}>
          Reset to defaults
        </button>
        <span className="self-center text-xs text-slate-500">
          Prices change often — verify against your provider’s pricing page.
        </span>
      </div>
    </details>
  )
}
