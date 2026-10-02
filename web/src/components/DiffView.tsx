import clsx from 'clsx'
import { useEffect, useMemo } from 'react'
import { diffRuns, type Metric } from '../engine/diff'
import { fmtMs, fmtNum, fmtUsd } from '../engine/util'
import { useAnalysisFor } from '../hooks'
import { ProgressTx } from '../lib/progress'
import { useStore } from '../store'
import { Empty, GRADE_COLOR, Md, SeverityPill } from './ui'

function fmt(m: Metric, v: number): string {
  if (m.format === 'usd') return fmtUsd(v)
  if (m.format === 'ms') return fmtMs(v)
  if (m.format === 'pct') return `${Math.round(v)}%`
  return fmtNum(Math.round(v))
}

export function DiffView() {
  const st = useStore()
  const aKey = st.compareKey ?? st.traces.find((t) => t.key !== st.activeKey)?.key ?? null
  const bKey = st.activeKey
  const A = st.traces.find((t) => t.key === aKey)
  const B = st.traces.find((t) => t.key === bKey)
  const aa = useAnalysisFor(A?.trace)
  const ab = useAnalysisFor(B?.trace)
  const diff = useMemo(
    () => (aa && ab && aKey !== bKey ? diffRuns(aa, ab) : null),
    [aa, ab, aKey, bKey],
  )

  useEffect(() => {
    if (diff) st.applyProgress(new ProgressTx(st.progress).badge('second-opinion'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!diff])

  const loadDemo = async () => {
    const a = await st.loadSample('looping-research')
    const b = await st.loadSample('looping-research-fixed')
    if (a && b) {
      useStore.getState().setCompare(a)
      useStore.getState().setActive(b)
    }
  }

  return (
    <div className="space-y-4" data-testid="diff">
      <div className="flex flex-wrap items-end gap-3 panel p-3">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Run A (before)
          <select
            className="w-64 rounded-lg border border-white/10 bg-ink-800 px-2 py-1.5 text-sm text-slate-200"
            value={aKey ?? ''}
            onChange={(e) => st.setCompare(e.target.value)}
            aria-label="Run A"
          >
            <option value="">—</option>
            {st.traces.map((t) => (
              <option key={t.key} value={t.key}>
                {t.trace.name}
              </option>
            ))}
          </select>
        </label>
        <span className="pb-2 text-slate-500">→</span>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Run B (after)
          <select
            className="w-64 rounded-lg border border-white/10 bg-ink-800 px-2 py-1.5 text-sm text-slate-200"
            value={bKey ?? ''}
            onChange={(e) => st.setActive(e.target.value)}
            aria-label="Run B"
          >
            {st.traces.map((t) => (
              <option key={t.key} value={t.key}>
                {t.trace.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="ml-auto btn-primary"
          onClick={() => void loadDemo()}
          data-testid="diff-demo"
        >
          ⚖️ Load demo pair (looping → fixed)
        </button>
      </div>

      {!diff || !aa || !ab ? (
        <Empty icon="⚖️" title="Compare two runs of the same task">
          Load two traces (e.g. before and after a prompt change) and pick them above — or load the
          demo pair. You will see cost, latency and health deltas, an aligned tool-call sequence,
          and which problems were fixed or introduced.
        </Empty>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-6 panel p-5">
            {[aa, ab].map((x, i) => (
              <div key={i} className="flex items-center gap-3">
                <div
                  className="font-serif text-5xl font-black"
                  style={{ color: GRADE_COLOR(x.grade) }}
                >
                  {x.grade}
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] tracking-wider text-slate-500 uppercase">
                    Run {i ? 'B' : 'A'}
                  </div>
                  <div className="max-w-64 truncate text-sm font-semibold text-white">
                    {x.trace.name}
                  </div>
                  <div className="text-xs text-slate-400">
                    <Md text={x.verdict.cause} />
                  </div>
                </div>
                {i === 0 && <div className="ml-3 text-3xl text-slate-600">→</div>}
              </div>
            ))}
            <div
              className="ml-auto max-w-md text-lg font-semibold text-white"
              data-testid="diff-verdict"
            >
              {diff.verdict}
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
            <section className="overflow-hidden panel">
              <table className="w-full text-sm">
                <thead className="text-left text-[11px] tracking-wider text-slate-500 uppercase">
                  <tr className="border-b border-white/[0.06]">
                    <th className="px-3 py-2">Metric</th>
                    <th className="px-3 py-2 text-right">A</th>
                    <th className="px-3 py-2 text-right">B</th>
                    <th className="px-3 py-2 text-right">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {diff.metrics.map((m) => {
                    const d = m.b - m.a
                    const better = d === 0 ? null : m.lowerBetter ? d < 0 : d > 0
                    const pct = m.a !== 0 ? Math.round((d / Math.abs(m.a)) * 100) : null
                    return (
                      <tr
                        key={m.label}
                        className="border-b border-white/[0.03] font-mono text-[12.5px]"
                      >
                        <td className="px-3 py-1.5 font-sans text-slate-300">{m.label}</td>
                        <td className="px-3 py-1.5 text-right text-slate-400">{fmt(m, m.a)}</td>
                        <td className="px-3 py-1.5 text-right text-white">{fmt(m, m.b)}</td>
                        <td
                          className={clsx(
                            'px-3 py-1.5 text-right',
                            better === null
                              ? 'text-slate-500'
                              : better
                                ? 'text-emerald-300'
                                : 'text-rose-300',
                          )}
                        >
                          {d === 0 ? '=' : `${d > 0 ? '+' : '−'}${fmt(m, Math.abs(d))}`}
                          {pct !== null && d !== 0 && (
                            <span className="ml-1 text-[10px] opacity-70">
                              ({pct > 0 ? '+' : ''}
                              {pct}%)
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </section>
            <section className="panel p-3">
              <h3 className="panel-title">Tool-call sequence (aligned)</h3>
              <div className="mt-2 max-h-80 space-y-0.5 overflow-y-auto font-mono text-[12px]">
                {diff.sequence.map((op, i) => (
                  <div
                    key={i}
                    className={clsx(
                      'grid grid-cols-[1.2rem_1fr_1fr] gap-2 rounded px-1.5 py-0.5',
                      op.op === 'removed' && 'bg-emerald-500/[0.08]',
                      op.op === 'added' && 'bg-rose-500/[0.08]',
                    )}
                  >
                    <span
                      className={
                        op.op === 'removed'
                          ? 'text-emerald-300'
                          : op.op === 'added'
                            ? 'text-rose-300'
                            : 'text-slate-600'
                      }
                    >
                      {op.op === 'removed' ? '−' : op.op === 'added' ? '+' : '='}
                    </span>
                    <span className={clsx('truncate', !op.a && 'opacity-20')}>
                      {op.a ? `${op.name}${op.a.status === 'error' ? ' ✖' : ''}` : '·'}
                    </span>
                    <span className={clsx('truncate', !op.b && 'opacity-20')}>
                      {op.b ? `${op.name}${op.b.status === 'error' ? ' ✖' : ''}` : '·'}
                    </span>
                  </div>
                ))}
                {!diff.sequence.length && (
                  <div className="text-slate-500">No tool calls in either run.</div>
                )}
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                − only in A (removed in B) · + only in B (new)
              </p>
            </section>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {(
              [
                ['✅ Fixed in B', diff.fixed, 'text-emerald-300'],
                ['🆕 New in B', diff.introduced, 'text-rose-300'],
                ['♻️ Still present', diff.persisting, 'text-amber-200'],
              ] as const
            ).map(([title, list, cls]) => (
              <section key={title} className="panel p-3">
                <h3 className={clsx('text-sm font-semibold', cls)}>
                  {title} · {list.length}
                </h3>
                <ul className="mt-2 space-y-1.5">
                  {list.map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <SeverityPill severity={f.severity} />
                      <Md text={f.title} className="text-slate-300" />
                    </li>
                  ))}
                  {!list.length && <li className="text-sm text-slate-500">none</li>}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
