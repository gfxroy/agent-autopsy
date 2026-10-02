import clsx from 'clsx'
import { useState } from 'react'
import { CAMPAIGN } from '../game/levels'
import { BADGES, leaderboard, RANKS, rankFor } from '../lib/progress'
import { useStore } from '../store'

export function ProfileView() {
  const st = useStore()
  const p = st.progress
  const r = rankFor(p.xp)
  const [confirm, setConfirm] = useState(false)
  const stars = Object.values(p.campaign).reduce((a, c) => a + c.stars, 0)
  return (
    <div className="grid animate-fade-in gap-4 lg:grid-cols-[1fr_1.4fr]" data-testid="profile">
      <div className="space-y-4">
        <section className="panel p-6 text-center">
          <div className="text-6xl">{r.icon}</div>
          <div className="mt-2 text-2xl font-black text-white" data-testid="rank">
            {r.title}
          </div>
          <input
            defaultValue={p.playerName}
            onBlur={(e) => st.setPlayerName(e.target.value)}
            className="mx-auto mt-1 block w-48 rounded border border-transparent bg-transparent text-center text-sm text-slate-400 hover:border-white/10 focus:border-white/20"
            aria-label="Your name"
            maxLength={24}
          />
          <div className="mt-4 font-mono text-3xl font-bold text-amber-200">
            {p.xp.toLocaleString()} XP
          </div>
          <div className="mx-auto mt-2 h-2.5 max-w-xs overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-rose-500 to-amber-300 transition-all duration-700"
              style={{ width: `${Math.round(r.progress * 100)}%` }}
            />
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {r.next
              ? `${(r.next.xp - p.xp).toLocaleString()} XP to ${r.next.title}`
              : 'Maximum rank. The morgue is yours.'}
          </div>
          <div className="mt-5 grid grid-cols-3 gap-2 text-center">
            {[
              ['🔥', p.streak.current, 'day streak'],
              ['🩻', p.autopsied.length, 'autopsies'],
              ['⭐', `${stars}/30`, 'campaign stars'],
              ['🏆', p.streak.best, 'best streak'],
              ['⚡', `×${p.bestCombo}`, 'best combo'],
              ['🏅', `${p.badges.length}/${BADGES.length}`, 'badges'],
            ].map(([i, v, l]) => (
              <div
                key={String(l)}
                className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-2"
              >
                <div className="text-lg">{i}</div>
                <div className="font-mono font-bold text-white">{v}</div>
                <div className="text-[10px] text-slate-500">{l}</div>
              </div>
            ))}
          </div>
        </section>
        <section className="panel p-5">
          <h3 className="panel-title">Career ladder</h3>
          <ol className="mt-2 space-y-1">
            {RANKS.map((x, i) => (
              <li
                key={x.title}
                className={clsx(
                  'flex items-center gap-2 rounded px-2 py-1 text-sm',
                  i === r.index
                    ? 'bg-rose-500/15 text-white'
                    : i < r.index
                      ? 'text-slate-300'
                      : 'text-slate-600',
                )}
              >
                <span>{x.icon}</span>
                <span className="flex-1">{x.title}</span>
                <span className="font-mono text-xs">{x.xp.toLocaleString()}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
      <div className="space-y-4">
        <section className="panel p-5">
          <h3 className="panel-title">Badges</h3>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {BADGES.map((b) => {
              const has = p.badges.includes(b.id)
              return (
                <div
                  key={b.id}
                  className={clsx(
                    'rounded-xl border p-3',
                    has
                      ? 'border-amber-300/30 bg-amber-400/[0.06]'
                      : 'border-white/[0.05] opacity-45',
                  )}
                  data-testid="badge"
                  data-unlocked={has}
                >
                  <div className={clsx('text-2xl', !has && 'grayscale')}>{has ? b.icon : '🔒'}</div>
                  <div className="mt-1 text-sm font-semibold text-white">{b.name}</div>
                  <div className="text-[11px] text-slate-400">{b.desc}</div>
                </div>
              )
            })}
          </div>
        </section>
        <section className="panel p-5">
          <h3 className="panel-title">Campaign</h3>
          <div className="mt-2 grid grid-cols-5 gap-2">
            {CAMPAIGN.map((l) => {
              const c = p.campaign[String(l.id)]
              return (
                <div key={l.id} className="rounded-lg border border-white/[0.06] p-2 text-center">
                  <div className="text-[10px] text-slate-500">{l.title}</div>
                  <div className="text-amber-300">
                    {c ? (
                      '★'.repeat(c.stars) + '☆'.repeat(3 - c.stars)
                    ) : (
                      <span className="text-slate-700">☆☆☆</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {(['daily', 'campaign'] as const).map((m) => (
              <div key={m}>
                <div className="text-xs text-slate-400 capitalize">
                  {m} leaderboard (this browser)
                </div>
                <ol className="mt-1 space-y-0.5 text-sm">
                  {leaderboard(p, m)
                    .slice(0, 5)
                    .map((e, i) => (
                      <li
                        key={i}
                        className={clsx(
                          'flex justify-between',
                          e.bot ? 'text-slate-500' : 'text-white',
                        )}
                      >
                        <span className="truncate">
                          {i + 1}. {e.name}
                        </span>
                        <span className="font-mono">{e.score.toLocaleString()}</span>
                      </li>
                    ))}
                </ol>
              </div>
            ))}
          </div>
        </section>
        <div className="flex justify-end">
          {confirm ? (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              Erase all XP, badges and streaks?
              <button
                className="btn !border-rose-500/50 !text-rose-300"
                onClick={() => {
                  st.resetProgress()
                  setConfirm(false)
                }}
              >
                Yes, reset
              </button>
              <button className="btn-ghost" onClick={() => setConfirm(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button className="btn-ghost text-xs" onClick={() => setConfirm(true)}>
              Reset progress
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
