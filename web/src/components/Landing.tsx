import { useRef } from 'react'
import { readFiles } from '../App'
import { dailyPuzzle } from '../game/levels'
import { todayKey } from '../game/rng'
import { SAMPLES } from '../lib/samples'
import { useStore } from '../store'

const FORMATS = [
  'OpenAI Chat Completions',
  'OpenAI Responses API',
  'OpenAI Agents SDK',
  'Anthropic Messages',
  'LangChain / LangSmith',
  'OpenTelemetry GenAI',
  'MCP JSON-RPC',
  'Span JSONL',
]

export function Landing({ compact }: { compact?: boolean }) {
  const st = useStore()
  const fileRef = useRef<HTMLInputElement>(null)
  const today = todayKey()
  const daily = dailyPuzzle(today)
  const solved = !!st.progress.daily[today]

  const open = async (id: string) => {
    const k = await st.loadSample(id)
    if (k) st.setTab('autopsy')
  }

  return (
    <div className="animate-fade-in">
      {!compact && (
        <section className="relative overflow-hidden px-2 pt-6 pb-8 text-center sm:pt-12">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-rose-400/30 bg-rose-500/10 px-3 py-1 text-xs text-rose-200">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400" /> DevTools for AI
            agents · 100% in-browser · no key needed
          </div>
          <h1 className="mx-auto mt-5 max-w-3xl text-4xl font-black tracking-tight text-white sm:text-6xl">
            Find out what{' '}
            <span className="bg-gradient-to-r from-rose-400 via-fuchsia-400 to-amber-300 bg-clip-text text-transparent">
              killed your agent.
            </span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base text-slate-400 sm:text-lg">
            Drop in a trace from OpenAI, Anthropic, LangSmith, OpenTelemetry or MCP. Get a timeline,
            tool graph, cost breakdown — and a cause of death with the fix.
          </p>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
        <button
          onClick={() => fileRef.current?.click()}
          className="group flex min-h-48 flex-col items-center justify-center gap-3 panel border-2 border-dashed !border-white/10 p-8 text-center transition hover:!border-rose-400/50 hover:bg-rose-500/[0.04]"
          data-testid="dropzone"
        >
          <div className="text-5xl transition group-hover:scale-110 group-hover:rotate-[-6deg]">
            🩻
          </div>
          <div className="text-lg font-semibold text-white">
            Drop a trace anywhere, or click to open
          </div>
          <div className="text-sm text-slate-400">
            JSON · JSONL · MCP logs — format is auto-detected. Nothing is uploaded.
          </div>
          <div className="mt-1 flex flex-wrap justify-center gap-1">
            {FORMATS.map((f) => (
              <span key={f} className="chip">
                {f}
              </span>
            ))}
          </div>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".json,.jsonl,.log,.txt,.ndjson"
            className="hidden"
            onChange={(e) => e.target.files && void readFiles(e.target.files)}
          />
        </button>

        <div className="relative flex flex-col justify-between overflow-hidden panel p-6">
          <div className="absolute -top-10 -right-10 text-[160px] opacity-[0.06]">🎯</div>
          <div>
            <div className="panel-title text-amber-300/80">Daily case · {today}</div>
            <h2 className="mt-2 text-2xl font-bold text-white">Spot the Bug</h2>
            <p className="mt-1 text-sm text-slate-400">
              A new dead agent every day. Click the span that killed it before the clock runs out.
              Streaks, combos, 10-case campaign, badges.
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="chip">🔥 streak {st.progress.streak.current}</span>
              <span className="chip">difficulty {'★'.repeat(daily.level.difficulty)}</span>
              {solved && (
                <span className="chip !border-emerald-400/40 !text-emerald-300">
                  ✓ solved today
                </span>
              )}
            </div>
          </div>
          <div className="mt-5 flex gap-2">
            <button
              className="btn-primary"
              onClick={() => st.setTab('game')}
              data-testid="play-daily-cta"
            >
              {solved ? 'Play campaign →' : "Play today's case →"}
            </button>
            <button className="btn-ghost" onClick={() => st.setModal('paste')}>
              Paste JSON
            </button>
          </div>
        </div>
      </div>

      <section className="mt-6">
        <div className="mb-2 flex items-end justify-between">
          <h3 className="panel-title">Sample bodies · realistic traces in 8 formats</h3>
          <span className="text-xs text-slate-500">click to autopsy</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {SAMPLES.map((s) => (
            <button
              key={s.id}
              onClick={() => void open(s.id)}
              className="group flex items-start gap-3 panel p-4 text-left transition hover:-translate-y-0.5 hover:!border-white/20"
              data-testid={`sample-${s.id}`}
            >
              <span className="text-2xl transition group-hover:scale-110">{s.emoji}</span>
              <span className="min-w-0">
                <span className="block font-semibold text-white">{s.title}</span>
                <span className="mt-0.5 block text-xs text-slate-400">{s.blurb}</span>
                <span className="mt-2 chip">{s.format}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {!compact && (
        <section className="mt-8 grid gap-3 text-sm sm:grid-cols-3">
          {[
            [
              '🔬',
              'Automatic diagnosis',
              '13 rules: loops, tool errors, hallucinated tools, schema violations, prompt injection, context bloat, truncation, slow & expensive steps, handoff ping-pong…',
            ],
            [
              '🔒',
              'Private by design',
              'Parsing, analysis and rendering happen in your tab. Optional LLM explanations use your own key, stored in sessionStorage only.',
            ],
            [
              '🐍',
              'Record your own',
              'pip-install the tiny agent_autopsy helper to write OTel-GenAI JSONL from any Python agent, then drop the file here.',
            ],
          ].map(([i, t, d]) => (
            <div key={t} className="panel p-4">
              <div className="text-xl">{i}</div>
              <div className="mt-1 font-semibold text-white">{t}</div>
              <div className="mt-1 text-slate-400">{d}</div>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
