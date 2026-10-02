import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { create } from 'zustand'
import { analyze } from '../engine/analyze'
import { roastFinding } from '../engine/roast'
import type { Span } from '../engine/types'
import { fmtMs } from '../engine/util'
import { buildLevel, CAMPAIGN, campaignSeed, dailyPuzzle, type LevelDef } from '../game/levels'
import { todayKey } from '../game/rng'
import { useCountUp, useHotkeys, useStopwatch } from '../hooks'
import { burst, sfx } from '../lib/fx'
import { leaderboard, onGameResult, scoreCase, starsFor } from '../lib/progress'
import { useStore } from '../store'
import { KindBadge, Md, spanLabel } from './ui'

const TIME_LIMIT = 90_000
const LIVES = 3

const useCombo = create<{ combo: number; set: (n: number) => void }>((set) => ({
  combo: 0,
  set: (combo) => set({ combo }),
}))

interface Session {
  mode: 'daily' | 'campaign'
  level: LevelDef
  seed: number
  date: string
  practice: boolean
}

export function GameView() {
  const [session, setSession] = useState<Session | null>(null)
  const params = new URLSearchParams(location.hash.slice(1))
  const st = useStore()
  const today = todayKey()

  useEffect(() => {
    if (params.get('play') === 'daily' && !session) startDaily()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function startDaily() {
    const d = dailyPuzzle(today)
    setSession({
      mode: 'daily',
      level: d.level,
      seed: d.seed,
      date: today,
      practice: !!st.progress.daily[today],
    })
  }
  function startCampaign(level: LevelDef) {
    setSession({
      mode: 'campaign',
      level,
      seed: campaignSeed(level.id),
      date: today,
      practice: false,
    })
  }

  if (session)
    return (
      <CaseRunner
        key={`${session.mode}-${session.level.id}-${session.seed}`}
        session={session}
        onExit={() => setSession(null)}
        onNext={(l) => startCampaign(l)}
      />
    )
  return <GameMenu onDaily={startDaily} onCampaign={startCampaign} />
}

function GameMenu({
  onDaily,
  onCampaign,
}: {
  onDaily: () => void
  onCampaign: (l: LevelDef) => void
}) {
  const st = useStore()
  const today = todayKey()
  const daily = dailyPuzzle(today)
  const solved = st.progress.daily[today]
  const [board, setBoard] = useState<'daily' | 'campaign'>('daily')
  const unlocked = (id: number) => id === 1 || !!st.progress.campaign[String(id - 1)]
  const { combo } = useCombo()

  return (
    <div className="grid animate-fade-in gap-4 lg:grid-cols-[1.3fr_1fr]" data-testid="game-menu">
      <div className="space-y-4">
        <section className="relative overflow-hidden panel p-6">
          <div className="absolute -top-6 -right-4 text-[140px] leading-none opacity-[0.07]">
            🎯
          </div>
          <div className="panel-title text-amber-300/90">Daily case · {today}</div>
          <h1 className="mt-1 text-3xl font-black text-white">Spot the Bug</h1>
          <p className="mt-2 max-w-xl text-sm text-slate-400">
            Every day a new agent dies. Read the evidence, then click the span that killed it.
            Faster = more points. Wrong accusations cost a life and your combo. Everyone gets the
            same case today.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
            <span className="chip">
              difficulty {'★'.repeat(daily.level.difficulty)}
              {'☆'.repeat(5 - daily.level.difficulty)}
            </span>
            <span className="chip">
              🔥 streak {st.progress.streak.current} (best {st.progress.streak.best})
            </span>
            {combo > 1 && <span className="chip !text-amber-200">combo ×{combo}</span>}
            {solved && (
              <span className="chip !border-emerald-400/40 !text-emerald-300">
                ✓ solved · {solved.score} pts in {fmtMs(solved.ms)}
              </span>
            )}
          </div>
          <button
            className="mt-5 btn-primary !px-5 !py-2.5 text-base"
            onClick={onDaily}
            data-testid="start-daily"
          >
            {solved ? '🔁 Replay daily (practice)' : "▶ Start today's case"}
          </button>
        </section>

        <section className="panel p-5">
          <div className="flex items-center justify-between">
            <h2 className="panel-title">Campaign · 10 cases of increasingly sneaky bugs</h2>
            <span className="text-xs text-slate-500">
              {Object.keys(st.progress.campaign).length}/10 cleared
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {CAMPAIGN.map((l) => {
              const rec = st.progress.campaign[String(l.id)]
              const open = unlocked(l.id)
              return (
                <button
                  key={l.id}
                  disabled={!open}
                  onClick={() => onCampaign(l)}
                  className={clsx(
                    'rounded-xl border p-3 text-left transition',
                    open
                      ? 'border-white/10 bg-white/[0.03] hover:-translate-y-0.5 hover:border-rose-400/40'
                      : 'cursor-not-allowed border-white/5 opacity-40',
                  )}
                  data-testid={`level-${l.id}`}
                >
                  <div className="flex items-center justify-between font-mono text-[10px] text-slate-500">
                    <span>CASE {String(l.id).padStart(2, '0')}</span>
                    <span>{open ? '' : '🔒'}</span>
                  </div>
                  <div className="mt-1 text-sm font-semibold text-white">{l.title}</div>
                  <div className="mt-1 text-amber-300">
                    {rec ? (
                      '★'.repeat(rec.stars) + '☆'.repeat(3 - rec.stars)
                    ) : (
                      <span className="text-slate-600">☆☆☆</span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </section>
      </div>

      <div className="space-y-4">
        <section className="panel p-5">
          <div className="flex items-center justify-between">
            <h2 className="panel-title">Local leaderboard</h2>
            <div className="flex gap-1">
              {(['daily', 'campaign'] as const).map((b) => (
                <button
                  key={b}
                  onClick={() => setBoard(b)}
                  className={clsx(
                    'chip cursor-pointer',
                    board === b && '!border-rose-400/50 !text-white',
                  )}
                >
                  {b}
                </button>
              ))}
            </div>
          </div>
          <ol className="mt-3 space-y-1">
            {leaderboard(st.progress, board).map((e, i) => (
              <li
                key={`${e.name}-${e.date}-${i}`}
                className={clsx(
                  'flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm',
                  !e.bot ? 'bg-rose-500/10 text-white' : 'text-slate-400',
                )}
              >
                <span className="w-6 font-mono text-xs">
                  {['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`}
                </span>
                <span className="flex-1 truncate">
                  {e.name}
                  {e.date && board === 'daily' && (
                    <span className="ml-2 text-[10px] text-slate-500">{e.date}</span>
                  )}
                </span>
                <span className="font-mono">{e.score.toLocaleString()}</span>
              </li>
            ))}
          </ol>
          <label className="mt-3 flex items-center gap-2 text-xs text-slate-400">
            Your name
            <input
              defaultValue={st.progress.playerName}
              onBlur={(e) => st.setPlayerName(e.target.value)}
              className="flex-1 rounded border border-white/10 bg-ink-800 px-2 py-1 text-sm text-white"
              maxLength={24}
              aria-label="Player name"
            />
          </label>
          <p className="mt-2 text-[11px] text-slate-500">
            Scores are stored in this browser only. Bots are calibrated rivals.
          </p>
        </section>
        <section className="panel p-5 text-sm text-slate-400">
          <h2 className="panel-title">How to play</h2>
          <ul className="mt-2 list-inside list-disc space-y-1">
            <li>Click spans to inspect the evidence (arguments, outputs).</li>
            <li>
              Press <span className="kbd">Enter</span> or 🔪 to accuse the selected span.
            </li>
            <li>
              <span className="kbd">j</span>/<span className="kbd">k</span> move ·{' '}
              <span className="kbd">h</span> hint (−30% points)
            </li>
            <li>Combos multiply your score: ×1.5 → ×2 → ×3.</li>
          </ul>
        </section>
      </div>
    </div>
  )
}

function CaseRunner({
  session,
  onExit,
  onNext,
}: {
  session: Session
  onExit: () => void
  onNext: (l: LevelDef) => void
}) {
  const st = useStore()
  const { combo, set: setCombo } = useCombo()
  const trace = useMemo(() => buildLevel(session.level.bug, session.seed), [session])
  const analysis = useMemo(() => analyze(trace), [trace])
  const killer = analysis.verdict.killer!
  const accepted = killer.rule === 'context-bloat' ? [killer.spanIds[0]] : killer.spanIds
  const steps = trace.spans.filter((s) => s.kind !== 'agent')
  const [sel, setSel] = useState<string | null>(null)
  const [wrong, setWrong] = useState<string[]>([])
  const [hinted, setHinted] = useState(false)
  const [phase, setPhase] = useState<'briefing' | 'playing' | 'won' | 'lost'>('briefing')
  const [shake, setShake] = useState(0)
  const ms = useStopwatch(phase === 'playing', session.seed)
  const lives = LIVES - wrong.length
  const [result, setResult] = useState<{ score: number; stars: number; ms: number } | null>(null)

  useEffect(() => {
    if (phase === 'playing' && ms >= TIME_LIMIT) lose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, phase])

  function lose() {
    setPhase('lost')
    setCombo(0)
    sfx.fail()
  }

  function accuse(id: string | null) {
    if (phase !== 'playing' || !id || wrong.includes(id)) return
    if (accepted.includes(id)) {
      const newCombo = combo + 1
      setCombo(newCombo)
      const score = scoreCase(session.level.difficulty, ms, wrong.length, hinted, newCombo)
      const stars = starsFor(ms, wrong.length, hinted)
      setResult({ score, stars, ms })
      setPhase('won')
      sfx.success()
      burst({ count: 160 + newCombo * 30, emoji: ['🎯', '🔪', '⭐'] })
      if (!session.practice) {
        st.applyProgress(
          onGameResult(st.progress, {
            mode: session.mode,
            levelId: session.level.id,
            date: session.date,
            correct: true,
            ms,
            wrong: wrong.length,
            hinted,
            combo: newCombo,
            score,
            rule: killer.rule,
          }),
        )
      } else {
        st.toast({
          icon: '🔁',
          title: 'Practice solve',
          body: 'Daily score already recorded for today',
          tone: 'info',
        })
      }
    } else {
      const nw = [...wrong, id]
      setWrong(nw)
      setCombo(0)
      setShake((x) => x + 1)
      sfx.fail()
      if (nw.length >= LIVES) lose()
    }
  }

  useHotkeys({
    Enter: () => (phase === 'briefing' ? setPhase('playing') : accuse(sel)),
    j: () => move(1),
    k: () => move(-1),
    h: () => phase === 'playing' && setHinted(true),
  })
  function move(d: number) {
    const i = steps.findIndex((s) => s.id === sel)
    const n = steps[Math.max(0, Math.min(steps.length - 1, i + d))]
    if (n) setSel(n.id)
  }

  const selected = sel ? analysis.ctx.byId.get(sel) : undefined
  const remaining = Math.max(0, TIME_LIMIT - ms)
  const potential = scoreCase(session.level.difficulty, ms, wrong.length, hinted, combo + 1)
  const nextLevel = CAMPAIGN.find((l) => l.id === session.level.id + 1)

  return (
    <div className="space-y-3" data-testid="case-runner">
      <div className="flex flex-wrap items-center gap-3 panel p-3">
        <button className="btn-ghost !px-2" onClick={onExit} aria-label="Back to menu">
          ←
        </button>
        <div className="min-w-0">
          <div className="font-mono text-[10px] tracking-wider text-slate-500 uppercase">
            {session.mode === 'daily'
              ? `Daily case · ${session.date}${session.practice ? ' · practice' : ''}`
              : `Case ${String(session.level.id).padStart(2, '0')}`}{' '}
            · {'★'.repeat(session.level.difficulty)}
          </div>
          <div className="text-lg font-bold text-white">
            {session.mode === 'daily' ? `Daily: ${session.level.title}` : session.level.title}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-4">
          <div className="text-xl tracking-tight" aria-label={`${lives} lives`} data-testid="lives">
            {Array.from({ length: LIVES }, (_, i) => (
              <span key={i} className={clsx(i < lives ? '' : 'opacity-20 grayscale')}>
                ❤️
              </span>
            ))}
          </div>
          {combo > 0 && (
            <div className="chip !border-amber-400/40 !text-amber-200">combo ×{combo}</div>
          )}
          <div
            className={clsx(
              'font-mono text-2xl font-bold tabular-nums',
              remaining < 15_000 ? 'animate-pulse text-rose-400' : 'text-white',
            )}
            data-testid="timer"
          >
            {(remaining / 1000).toFixed(1)}s
          </div>
          {phase === 'playing' && (
            <div className="hidden font-mono text-sm text-amber-200 sm:block">≈{potential} pts</div>
          )}
        </div>
      </div>

      {phase === 'briefing' && (
        <div className="animate-pop panel p-8 text-center">
          <div className="text-5xl">🕵️</div>
          <h2 className="mt-3 text-2xl font-bold text-white">{session.level.title}</h2>
          <p className="mx-auto mt-2 max-w-lg text-slate-300">{session.level.briefing}</p>
          <p className="mt-1 text-sm text-slate-500">
            {steps.length} spans · {TIME_LIMIT / 1000}s on the clock · {LIVES} lives
          </p>
          <button
            className="mt-5 btn-primary !px-6 !py-2.5 text-base"
            onClick={() => setPhase('playing')}
            data-testid="begin-case"
            autoFocus
          >
            Open the case file ⏎
          </button>
        </div>
      )}

      {phase !== 'briefing' && (
        <div className="grid gap-3 lg:grid-cols-[1fr_420px]">
          <div key={shake} className={clsx('overflow-hidden panel', shake > 0 && 'animate-shake')}>
            <div className="border-b border-white/[0.06] p-3 text-sm">
              <div className="text-slate-300">
                <span className="text-slate-500">Task:</span>{' '}
                {analysis.ctx.llm[0]?.input?.find((m) => m.role === 'user')?.content}
              </div>
              <details className="mt-1.5">
                <summary className="cursor-pointer text-xs text-slate-400">
                  🧰 Declared tools ({trace.tools.length}) — click to view schemas
                </summary>
                <pre className="mt-1 code-block !max-h-48">
                  {trace.tools
                    .map(
                      (t) =>
                        `${t.name}(${JSON.stringify(t.parameters?.properties ?? {})}) required=${JSON.stringify(t.parameters?.required ?? [])}`,
                    )
                    .join('\n')}
                </pre>
              </details>
              {hinted && (
                <div className="mt-2 rounded border border-amber-400/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-200">
                  💡 {session.level.hint}
                </div>
              )}
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {steps.map((s, i) => {
                const isWrong = wrong.includes(s.id)
                const reveal = phase === 'won' || phase === 'lost'
                const isKiller = reveal && accepted.includes(s.id)
                return (
                  <button
                    key={s.id}
                    onClick={() => setSel(s.id)}
                    onDoubleClick={() => accuse(s.id)}
                    className={clsx(
                      'flex w-full items-center gap-2 border-b border-white/[0.03] px-3 py-2 text-left transition',
                      sel === s.id ? 'bg-white/[0.07]' : 'hover:bg-white/[0.03]',
                      isWrong && 'bg-rose-950/40 line-through opacity-50',
                      isKiller && 'bg-rose-500/20 ring-1 ring-rose-400',
                    )}
                    data-testid="case-span"
                    data-span-id={s.id}
                  >
                    <span className="w-6 font-mono text-[10px] text-slate-500">{i + 1}</span>
                    <KindBadge kind={s.kind} />
                    <span
                      className={clsx(
                        'font-mono text-[12.5px]',
                        s.status === 'error' ? 'text-rose-300' : 'text-slate-100',
                      )}
                    >
                      {spanLabel(s)}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-500">
                      {s.kind === 'tool'
                        ? s.toolArgsRaw
                        : s.kind === 'llm'
                          ? s.output?.[0]?.toolCalls?.map((c) => `→ ${c.name}`).join(', ') ||
                            s.output?.[0]?.content?.slice(0, 80)
                          : s.kind === 'handoff'
                            ? `${String(s.attributes.from_agent)} → ${String(s.attributes.to_agent)}`
                            : ''}
                    </span>
                    {isKiller && <span>☠️</span>}
                    <span className="font-mono text-[10px] text-slate-600">
                      {fmtMs(s.end - s.start)}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="space-y-3">
            {(phase === 'won' || phase === 'lost') && result !== undefined && (
              <ResultCard
                won={phase === 'won'}
                result={result}
                rule={killer}
                seed={trace.id}
                levelTitle={session.level.title}
              />
            )}
            <div className="panel p-3">
              <div className="panel-title">Evidence</div>
              {!selected ? (
                <p className="mt-2 text-sm text-slate-500">Select a span to examine it.</p>
              ) : (
                <Evidence span={selected} />
              )}
              {phase === 'playing' && (
                <div className="mt-3 flex gap-2">
                  <button
                    className="btn-primary flex-1 !py-2"
                    disabled={!sel}
                    onClick={() => accuse(sel)}
                    data-testid="accuse"
                  >
                    🔪 This span killed it
                  </button>
                  <button
                    className="btn-ghost"
                    disabled={hinted}
                    onClick={() => setHinted(true)}
                    title="Hint costs 30% of points (h)"
                  >
                    💡
                  </button>
                </div>
              )}
              {(phase === 'won' || phase === 'lost') && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {session.mode === 'campaign' && phase === 'won' && nextLevel && (
                    <button
                      className="btn-primary"
                      onClick={() => onNext(nextLevel)}
                      data-testid="next-case"
                    >
                      Next case →
                    </button>
                  )}
                  {phase === 'lost' && session.mode === 'campaign' && (
                    <button className="btn-primary" onClick={() => onNext(session.level)}>
                      Retry
                    </button>
                  )}
                  <button className="btn-ghost" onClick={onExit} data-testid="back-to-menu">
                    Back to cases
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Evidence({ span: s }: { span: Span }) {
  return (
    <div className="mt-2 space-y-2 text-sm">
      <div className="flex items-center gap-2">
        <KindBadge kind={s.kind} />
        <span className="font-mono text-white">{spanLabel(s)}</span>
        {s.status === 'error' && <span className="chip !text-rose-300">error</span>}
      </div>
      {s.kind === 'tool' && (
        <>
          <div className="text-[10px] tracking-wider text-slate-500 uppercase">Arguments</div>
          <pre className="code-block !max-h-32">{s.toolArgsRaw}</pre>
          <div className="text-[10px] tracking-wider text-slate-500 uppercase">
            Result {s.toolResult && `· ${s.toolResult.length.toLocaleString()} chars`}
          </div>
          <pre className="code-block !max-h-64">{s.toolResult?.slice(0, 6000)}</pre>
        </>
      )}
      {s.kind === 'llm' && (
        <>
          <div className="text-xs text-slate-400">
            {s.model} · {s.inputTokens?.toLocaleString()} tokens in → {s.outputTokens} out
          </div>
          {s.output?.map((m, i) => (
            <pre key={i} className="code-block !max-h-40">
              {m.content}
              {m.toolCalls?.map((c) => `→ ${c.name}(${c.argsRaw})`).join('\n')}
            </pre>
          ))}
        </>
      )}
      {s.kind === 'handoff' && (
        <div className="font-mono text-amber-200">
          {String(s.attributes.from_agent)} → {String(s.attributes.to_agent)}
        </div>
      )}
    </div>
  )
}

function ResultCard({
  won,
  result,
  rule,
  seed,
  levelTitle,
}: {
  won: boolean
  result: { score: number; stars: number; ms: number } | null
  rule: ReturnType<typeof analyze>['findings'][number]
  seed: string
  levelTitle: string
}) {
  const score = useCountUp(won && result ? result.score : 0, 1400)
  return (
    <div
      className={clsx(
        'animate-pop panel p-4',
        won ? '!border-emerald-400/40' : '!border-rose-500/40',
      )}
      data-testid="case-result"
      data-won={won}
    >
      <div
        className={clsx(
          'font-mono text-2xl font-black tracking-widest',
          won ? 'text-emerald-300' : 'text-rose-400',
        )}
      >
        {won ? 'CASE SOLVED' : 'CASE COLD'}
      </div>
      {won && result && (
        <div className="mt-1 flex items-baseline gap-3">
          <span
            className="font-mono text-4xl font-bold text-white tabular-nums"
            data-testid="case-score"
          >
            {Math.round(score)}
          </span>
          <span className="text-sm text-slate-400">pts · {fmtMs(result.ms)}</span>
          <span className="ml-auto text-2xl text-amber-300">
            {'★'.repeat(result.stars)}
            {'☆'.repeat(3 - result.stars)}
          </span>
        </div>
      )}
      <div className="mt-3 text-[10px] tracking-wider text-slate-500 uppercase">
        {levelTitle} · the killer
      </div>
      <div className="font-semibold text-white">
        <Md text={rule.title} />
      </div>
      <p className="mt-1 text-sm text-slate-300">
        <Md text={rule.detail} />
      </p>
      <p className="mt-2 rounded-lg border border-orange-400/20 bg-orange-500/[0.07] px-3 py-2 text-sm text-orange-100 italic">
        🌶️ <Md text={roastFinding(rule, seed)} />
      </p>
      <p className="mt-2 text-sm text-emerald-200/90">Fix → {rule.fix}</p>
    </div>
  )
}
