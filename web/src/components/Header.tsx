import clsx from 'clsx'
import { useRef } from 'react'
import { readFiles } from '../App'
import { FORMAT_LABELS } from '../engine/importers'
import { useAnalysis } from '../hooks'
import { rankFor } from '../lib/progress'
import { download, reportHtml, reportMarkdown } from '../lib/report'
import { TABS, useStore } from '../store'

function slug(s: string) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'trace'
  )
}

export function Header() {
  const st = useStore()
  const analysis = useAnalysis()
  const fileRef = useRef<HTMLInputElement>(null)
  const rank = rankFor(st.progress.xp)

  return (
    <header className="sticky top-0 z-30 mb-4 border-b border-white/[0.06] bg-ink-950/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-2 px-3 py-2 sm:px-5">
        <button
          className="mr-1 flex items-center gap-2"
          onClick={() => st.setTab('autopsy')}
          aria-label="Agent Autopsy home"
        >
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-7 w-7" />
          <span className="text-[15px] font-bold tracking-tight text-white">
            Agent<span className="text-rose-400">Autopsy</span>
          </span>
        </button>

        <div className="flex min-w-0 items-center gap-1.5">
          {st.traces.length > 0 && (
            <select
              aria-label="Active trace"
              className="max-w-[16rem] truncate rounded-lg border border-white/10 bg-ink-800 px-2 py-1.5 text-sm text-slate-200"
              value={st.activeKey ?? ''}
              onChange={(e) => st.setActive(e.target.value)}
            >
              {st.traces.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.trace.name} · {FORMAT_LABELS[t.trace.format]}
                </option>
              ))}
            </select>
          )}
          <button
            className="btn-ghost"
            onClick={() => fileRef.current?.click()}
            title="Open trace file(s)"
          >
            📂 <span className="hidden sm:inline">Open</span>
          </button>
          <button
            className="btn-ghost"
            onClick={() => st.setModal('paste')}
            title="Paste trace JSON (p)"
          >
            📋 <span className="hidden sm:inline">Paste</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".json,.jsonl,.log,.txt,.ndjson"
            className="hidden"
            onChange={(e) =>
              e.target.files && void readFiles(e.target.files).then(() => (e.target.value = ''))
            }
          />
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Toggle
            on={st.roast}
            onClick={() => st.toggle('roast')}
            label="Roast"
            icon="🌶️"
            hint="Roast mode (r)"
          />
          <Toggle
            on={st.redact}
            onClick={() => st.toggle('redact')}
            label="Redact"
            icon="🙈"
            hint="Mask emails, keys & PII (x)"
          />
          <Toggle
            on={st.sound}
            onClick={() => st.toggle('sound')}
            label=""
            icon={st.sound ? '🔊' : '🔈'}
            hint="Sound effects"
          />
          {analysis && (
            <>
              <details className="relative">
                <summary className="btn-ghost cursor-pointer list-none" title="Export report">
                  ⬇ <span className="hidden sm:inline">Export</span>
                </summary>
                <div className="absolute right-0 z-40 mt-1 w-52 rounded-lg border border-white/10 bg-ink-800 p-1 shadow-xl">
                  {(
                    [
                      [
                        'Markdown report',
                        () =>
                          download(
                            `autopsy-${slug(analysis.trace.name)}.md`,
                            reportMarkdown(analysis, { redact: st.redact, roast: st.roast }),
                            'text/markdown',
                          ),
                      ],
                      [
                        'HTML report',
                        () =>
                          download(
                            `autopsy-${slug(analysis.trace.name)}.html`,
                            reportHtml(analysis, { redact: st.redact, roast: st.roast }),
                            'text/html',
                          ),
                      ],
                      [
                        'Normalized trace (JSON)',
                        () =>
                          download(
                            `trace-${slug(analysis.trace.name)}.json`,
                            JSON.stringify(analysis.trace, null, 1),
                            'application/json',
                          ),
                      ],
                    ] as const
                  ).map(([label, fn]) => (
                    <button
                      key={label}
                      className="block w-full rounded px-2 py-1.5 text-left text-sm text-slate-200 hover:bg-white/10"
                      onClick={fn}
                    >
                      {label}
                    </button>
                  ))}
                  <div className="px-2 pt-1 pb-1.5 text-[10px] text-slate-500">
                    {st.redact ? 'Redaction ON' : 'Tip: turn on Redact before sharing'}
                  </div>
                </div>
              </details>
              <button
                className="btn-primary"
                onClick={() => st.setModal('certificate')}
                title="Death certificate (c)"
              >
                📜 <span className="hidden md:inline">Certificate</span>
              </button>
            </>
          )}
          <button
            className="btn-ghost !px-2"
            onClick={() => st.setModal('settings')}
            title="Prices & API key"
            aria-label="Settings"
          >
            ⚙
          </button>
          <button
            className="group flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1 hover:border-white/20"
            onClick={() => st.setTab('profile')}
            title={`${st.progress.xp} XP`}
          >
            <span className="text-base leading-none">{rank.icon}</span>
            <span className="hidden flex-col items-start lg:flex">
              <span className="text-[11px] leading-tight font-semibold text-white">
                {rank.title}
              </span>
              <span className="mt-0.5 h-1 w-24 overflow-hidden rounded bg-white/10">
                <span
                  className="block h-full bg-gradient-to-r from-rose-500 to-amber-300 transition-all duration-700"
                  style={{ width: `${Math.round(rank.progress * 100)}%` }}
                />
              </span>
            </span>
            <span className="font-mono text-xs text-amber-200 tabular-nums" data-testid="xp">
              {st.progress.xp} XP
            </span>
          </button>
        </div>
      </div>
      <nav
        className="mx-auto flex max-w-[1600px] gap-0.5 overflow-x-auto px-3 sm:px-5"
        aria-label="Views"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => st.setTab(t.id)}
            className={clsx(
              'relative shrink-0 px-3 py-2 text-sm transition-colors',
              st.tab === t.id ? 'text-white' : 'text-slate-400 hover:text-slate-200',
              t.needsTrace && !analysis && 'opacity-50',
            )}
            aria-current={st.tab === t.id ? 'page' : undefined}
          >
            {t.id === 'game' && <span className="mr-1">🎯</span>}
            {t.label}
            <span className="ml-1.5 kbd hidden opacity-60 md:inline-flex">{t.key}</span>
            {st.tab === t.id && (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded bg-gradient-to-r from-rose-500 to-fuchsia-500" />
            )}
          </button>
        ))}
      </nav>
    </header>
  )
}

function Toggle({
  on,
  onClick,
  label,
  icon,
  hint,
}: {
  on: boolean
  onClick: () => void
  label: string
  icon: string
  hint: string
}) {
  return (
    <button
      onClick={onClick}
      title={hint}
      aria-pressed={on}
      className={clsx(
        'btn !px-2.5',
        on
          ? 'border border-rose-400/50 bg-rose-500/15 text-rose-100'
          : 'border border-white/[0.08] bg-white/[0.03] text-slate-400 hover:text-white',
      )}
    >
      <span>{icon}</span>
      {label && <span className="hidden sm:inline">{label}</span>}
    </button>
  )
}
