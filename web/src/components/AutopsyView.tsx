import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import type { Analysis, Grade } from '../engine/analyze'
import { FORMAT_LABELS } from '../engine/importers'
import { gradeQuip, roastHeadline } from '../engine/roast'
import { fmtMs, fmtNum, fmtUsd } from '../engine/util'
import { useCountUp } from '../hooks'
import { burst, sfx } from '../lib/fx'
import { callLlm, explainPrompt, loadLlmConfig } from '../lib/llm'
import { onAutopsy } from '../lib/progress'
import { useActive, useStore } from '../store'
import { FindingCard } from './FindingCard'
import { GRADE_COLOR, Md } from './ui'

const ROLL: Grade[] = ['A+', 'A', 'B+', 'B', 'C+', 'C', 'D', 'F', 'A-', 'B-', 'C-']

function useStage(max: number, key: string): [number, () => void] {
  const [stage, setStage] = useState(0)
  useEffect(() => {
    setStage(0)
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      setStage(max)
      return
    }
    const times = [550, 1050, 1500, 2300, 2700]
    const ids = times.slice(0, max).map((t, i) => setTimeout(() => setStage(i + 1), t))
    return () => ids.forEach(clearTimeout)
  }, [key, max])
  return [stage, () => setStage(max)]
}

export function AutopsyView({ analysis: a }: { analysis: Analysis }) {
  const st = useStore()
  const active = useActive()
  const [stage, skip] = useStage(5, a.trace.id)
  const v = a.verdict
  const color = GRADE_COLOR(a.grade)
  const dead = v.status === 'dead'

  // Grade slot-machine roll during stage 3.
  const [rolled, setRolled] = useState<string>('?')
  useEffect(() => {
    if (stage < 3) return setRolled('?')
    if (stage > 3) return setRolled(a.grade)
    let i = 0
    const id = setInterval(() => {
      setRolled(ROLL[i++ % ROLL.length])
      if (i % 2 === 0) sfx.tick()
    }, 70)
    return () => clearInterval(id)
  }, [stage, a.grade])

  useEffect(() => {
    if (stage === 1) sfx.thud()
    if (stage === 4) {
      if (v.status === 'alive') {
        burst({ count: 180, colors: ['#34d399', '#a3e635', '#22d3ee', '#fbbf24'] })
        sfx.success()
      } else if (dead) {
        burst({
          count: 90,
          colors: ['#f43f5e', '#881337', '#fb7185', '#1f2937'],
          emoji: ['💀', '☠️', '🪦'],
          spread: 7,
        })
      }
    }
    if (stage === 5 && active) {
      st.applyProgress(
        onAutopsy(st.progress, {
          id: a.trace.id,
          format: a.trace.format,
          own: active.source !== 'sample',
          grade: a.grade,
          efficiency: a.efficiency,
        }),
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage])

  const iq = useCountUp(stage >= 4 ? a.iq : 0, 1200, 0, a.trace.id + stage)
  const eff = useCountUp(stage >= 4 ? a.efficiency * 100 : 0, 1200, 120, a.trace.id + stage)
  const wasted = useCountUp(stage >= 4 ? a.wastedUsd : 0, 2200, 200, a.trace.id + stage)
  const cost = useCountUp(stage >= 4 ? a.totalCost : 0, 1400, 300, a.trace.id + stage)

  const killerId = v.killer ? `${v.killer.rule}:${v.killer.spanIds[0]}` : ''
  const stamp = v.status === 'alive' ? 'ALIVE' : v.status === 'injured' ? 'WOUNDED' : 'DECEASED'

  return (
    <div className="space-y-4" onClick={stage < 5 ? skip : undefined}>
      <section
        className={clsx('relative overflow-hidden panel', stage >= 1 && dead && 'animate-shake')}
        data-testid="autopsy-hero"
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            background: `radial-gradient(600px 240px at 80% 0%, ${color}22, transparent 70%)`,
          }}
        />
        <Ecg analysis={a} stage={stage} />
        <div className="relative grid gap-6 p-5 sm:p-7 lg:grid-cols-[1.4fr_1fr]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span className="chip">{FORMAT_LABELS[a.trace.format]}</span>
              <span className="chip">{v.steps} steps</span>
              <span className="chip">
                {fmtMs(a.duration)}
                {a.trace.timingEstimated && ' (est.)'}
              </span>
              <span className="chip">{fmtNum(a.totalTokens)} tokens</span>
            </div>
            <h1
              className="mt-3 truncate text-xl font-bold text-white sm:text-2xl"
              title={a.trace.name}
            >
              {a.trace.name}
            </h1>
            {stage === 0 && (
              <div className="mt-6 flex items-center gap-3 text-slate-400">
                <span className="h-3 w-3 animate-ping rounded-full bg-rose-400" /> Performing
                autopsy…
              </div>
            )}
            {stage >= 1 && (
              <div className="mt-5 flex items-start gap-5">
                <div
                  className={clsx(
                    'shrink-0 animate-slam rounded-md border-4 px-3 py-1 font-mono text-2xl font-black tracking-widest sm:text-3xl',
                    v.status === 'alive'
                      ? 'border-emerald-400 text-emerald-300'
                      : v.status === 'injured'
                        ? 'border-amber-400 text-amber-300'
                        : 'border-rose-500 text-rose-400',
                  )}
                  data-testid="verdict-stamp"
                >
                  {stamp}
                </div>
              </div>
            )}
            {stage >= 2 && (
              <div className="mt-5 animate-fade-in space-y-3">
                <div>
                  <div className="panel-title">
                    {v.status === 'alive' ? 'Condition' : 'Cause of death'}
                  </div>
                  <div
                    className={clsx(
                      'mt-1 font-serif text-2xl leading-snug sm:text-3xl',
                      v.status === 'alive' ? 'text-emerald-200' : 'text-rose-100',
                    )}
                    data-testid="cause"
                  >
                    <Md text={v.cause} />
                  </div>
                </div>
                {v.status !== 'alive' && v.timeOfDeath !== undefined && (
                  <div>
                    <div className="panel-title">Time of death</div>
                    <div className="mt-1 font-mono text-slate-200">
                      T+{fmtMs(v.timeOfDeath)} · step {v.step ?? '?'} of {v.steps}
                    </div>
                  </div>
                )}
                {st.roast && (
                  <p
                    className="rounded-lg border border-orange-400/25 bg-orange-500/10 px-3 py-2 text-orange-100 italic"
                    data-testid="roast-headline"
                  >
                    🌶️ <Md text={roastHeadline(a)} />
                  </p>
                )}
              </div>
            )}
            {stage >= 4 && (
              <div className="mt-5 flex animate-fade-in flex-wrap gap-2">
                {v.killerSpan && (
                  <button
                    className="btn-ghost"
                    onClick={() => {
                      st.select(v.killerSpan!.id)
                      st.setTab('timeline')
                    }}
                    data-testid="jump-killer"
                  >
                    🔪 Jump to the killer span
                  </button>
                )}
                <button
                  className="btn-primary"
                  onClick={() => st.setModal('certificate')}
                  data-testid="open-certificate"
                >
                  📜 Death certificate
                </button>
                <ExplainButton analysis={a} />
              </div>
            )}
          </div>

          <div className="flex flex-col items-center justify-center gap-4">
            <div className="relative grid h-44 w-44 place-items-center">
              <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90">
                <circle
                  cx="50"
                  cy="50"
                  r="44"
                  fill="none"
                  stroke="rgba(255,255,255,0.06)"
                  strokeWidth="7"
                />
                <circle
                  cx="50"
                  cy="50"
                  r="44"
                  fill="none"
                  stroke={color}
                  strokeWidth="7"
                  strokeLinecap="round"
                  strokeDasharray={`${(stage >= 4 ? a.health : 0) * 2.764} 276.4`}
                  style={{ transition: 'stroke-dasharray 1.4s cubic-bezier(.2,.9,.3,1)' }}
                />
              </svg>
              <div className="text-center">
                <div
                  className={clsx(
                    'font-serif text-7xl font-black',
                    stage === 4 || stage === 5 ? 'animate-pop' : '',
                  )}
                  style={{ color: stage >= 4 ? color : '#64748b' }}
                  data-testid="grade"
                >
                  {rolled}
                </div>
                <div className="font-mono text-[11px] text-slate-400">
                  health {stage >= 4 ? a.health : '··'}/100
                </div>
              </div>
            </div>
            {stage >= 4 && (
              <div className="animate-fade-in text-sm text-slate-400 italic">
                “{gradeQuip(a.grade)}”
              </div>
            )}
            <div className="grid w-full grid-cols-2 gap-2">
              <BigStat
                label="Agent IQ"
                value={Math.round(iq).toString()}
                tone={a.iq >= 130 ? 'good' : a.iq < 100 ? 'bad' : undefined}
              />
              <BigStat
                label="Efficiency"
                value={`${Math.round(eff)}%`}
                tone={a.efficiency >= 0.85 ? 'good' : a.efficiency < 0.6 ? 'bad' : undefined}
              />
              <BigStat
                label="Money wasted"
                value={fmtUsd(wasted)}
                tone={a.wastedUsd > 0 ? 'bad' : 'good'}
                testid="money-wasted"
              />
              <BigStat label="Total cost" value={fmtUsd(cost)} />
            </div>
          </div>
        </div>
      </section>

      {stage >= 5 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="panel-title">
              Findings · {a.findings.length}{' '}
              {a.counts.critical > 0 && (
                <span className="text-rose-300">· {a.counts.critical} critical</span>
              )}
            </h2>
            {!st.roast && (
              <button
                className="text-xs text-orange-300 hover:text-orange-200"
                onClick={() => st.toggle('roast')}
              >
                🌶️ Turn on Roast mode
              </button>
            )}
          </div>
          {a.findings.length === 0 && (
            <div className="panel p-6 text-center text-slate-300">
              <div className="text-3xl">💚</div>No issues found. Clean, efficient run — frame it.
            </div>
          )}
          {a.findings.map((f, i) => (
            <FindingCard
              key={`${f.rule}:${f.spanIds.join()}:${i}`}
              f={f}
              seed={a.trace.id}
              index={i}
              killer={`${f.rule}:${f.spanIds[0]}` === killerId}
            />
          ))}
          {a.trace.timingEstimated && (
            <p className="text-xs text-slate-500">
              ⓘ This format carries no timestamps — timings are synthesized from token counts, so
              slow-step checks are skipped.
            </p>
          )}
        </section>
      )}
    </div>
  )
}

function BigStat({
  label,
  value,
  tone,
  testid,
}: {
  label: string
  value: string
  tone?: 'good' | 'bad'
  testid?: string
}) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-2 text-center">
      <div className="panel-title !text-[10px]">{label}</div>
      <div
        className={clsx(
          'font-mono text-xl font-bold tabular-nums',
          tone === 'bad' ? 'text-rose-300' : tone === 'good' ? 'text-emerald-300' : 'text-white',
        )}
        data-testid={testid}
      >
        {value}
      </div>
    </div>
  )
}

/** "Vital signs" strip: heartbeat per step, spikes on errors, flatline after time of death. */
function Ecg({ analysis: a, stage }: { analysis: Analysis; stage: number }) {
  const path = useMemo(() => {
    const W = 1000
    const H = 60
    const mid = H / 2
    const steps = a.trace.spans.filter((s) => s.kind !== 'agent' && s.kind !== 'chain')
    const dur = Math.max(1, a.duration)
    const t0 = a.ctx.t0
    const death =
      a.verdict.status !== 'alive' && a.verdict.killerSpan
        ? a.verdict.killerSpan.end - t0
        : Infinity
    let d = `M0 ${mid}`
    for (const s of steps) {
      const x = ((s.start - t0) / dur) * W
      if (s.start - t0 > death) break
      const amp = s.status === 'error' ? 26 : s.kind === 'llm' ? 18 : 10
      d += ` L${x.toFixed(1)} ${mid} L${(x + 4).toFixed(1)} ${mid - amp} L${(x + 8).toFixed(1)} ${mid + amp * 0.6} L${(x + 12).toFixed(1)} ${mid}`
    }
    d += ` L${W} ${mid}`
    return d
  }, [a])
  return (
    <svg
      viewBox="0 0 1000 60"
      preserveAspectRatio="none"
      className="absolute right-0 bottom-0 left-0 h-12 w-full opacity-40"
      aria-hidden="true"
    >
      <path
        d={path}
        fill="none"
        stroke={a.verdict.status === 'alive' ? '#34d399' : '#f43f5e'}
        strokeWidth="1.6"
        strokeDasharray="4000"
        strokeDashoffset={stage >= 1 ? 0 : 4000}
        style={{ transition: 'stroke-dashoffset 2.4s linear' }}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

function ExplainButton({ analysis: a }: { analysis: Analysis }) {
  const st = useStore()
  const [out, setOut] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const run = async (mode: 'explain' | 'roast') => {
    const cfg = loadLlmConfig()
    if (!cfg?.key) return st.setModal('settings')
    setBusy(true)
    setErr(null)
    try {
      setOut(await callLlm(cfg, explainPrompt(a, mode)))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <button
        className="btn-ghost"
        onClick={() => void run('explain')}
        disabled={busy}
        title="Uses your own OpenAI/Gemini key (optional)"
      >
        🤖 {busy ? 'Thinking…' : 'Explain this failure'}
      </button>
      {st.roast && (
        <button
          className="btn-ghost"
          onClick={() => void run('roast')}
          disabled={busy}
          title="LLM roast with your own key"
        >
          🎤 LLM roast
        </button>
      )}
      {(out || err) && (
        <div className="mt-2 w-full animate-fade-in rounded-lg border border-cyan-400/20 bg-cyan-500/[0.05] p-3 text-sm whitespace-pre-wrap text-slate-200">
          {err ? <span className="text-rose-300">⚠ {err}</span> : out}
        </div>
      )}
    </>
  )
}
