import { useEffect, useMemo, useRef, useState } from 'react'
import { analyze, loadTrace, type Analysis } from '../engine'
import { certificateData, drawCertificate, SITE_URL } from '../lib/certificate'
import { plainReport, reportText } from '../lib/plain'
import { SAMPLES, sampleUrl } from '../lib/samples'

export function Examine({ sample }: { sample?: string }) {
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const examine = (text: string, name: string) => {
    try {
      setError(null)
      setAnalysis(analyze(loadTrace(text, name)))
      window.scrollTo(0, 0)
    } catch (e) {
      setError(`We couldn’t read that log. ${(e as Error).message}`)
    }
  }

  const loadSample = async (id: string) => {
    const s = SAMPLES.find((x) => x.id === id)
    if (!s) return
    setBusy(true)
    try {
      const res = await fetch(sampleUrl(s.file))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      examine(await res.text(), s.title)
    } catch (e) {
      setError(`Couldn’t load the sample (${(e as Error).message}).`)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (sample) void loadSample(sample)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sample])

  if (analysis)
    return (
      <Report
        analysis={analysis}
        onBack={() => {
          setAnalysis(null)
          if (location.hash.includes('sample=')) history.replaceState(null, '', '#/examine')
        }}
      />
    )
  return <Input onText={examine} onSample={(id) => void loadSample(id)} error={error} busy={busy} />
}

function Input({
  onText,
  onSample,
  error,
  busy,
}: {
  onText: (text: string, name: string) => void
  onSample: (id: string) => void
  error: string | null
  busy: boolean
}) {
  const [drag, setDrag] = useState(false)
  const [paste, setPaste] = useState('')
  const file = useRef<HTMLInputElement>(null)

  const readFile = async (f: File | undefined) => {
    if (f) onText(await f.text(), f.name.replace(/\.(jsonl?|log|txt)$/i, ''))
  }

  return (
    <div className="wrap py-16 sm:py-20" data-testid="examine-input">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Examine a log</h1>
      <p className="mt-3 text-neutral-500">Runs in your browser. Nothing is uploaded.</p>

      <div
        className={`mt-10 flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-6 py-14 text-center transition-colors ${drag ? 'border-neutral-900 bg-neutral-50' : 'border-neutral-300 hover:border-neutral-500'}`}
        onClick={() => file.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          void readFile(e.dataTransfer.files[0])
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && file.current?.click()}
        data-testid="dropzone"
      >
        <div className="font-medium">Drop a log file here</div>
        <div className="mt-1 text-sm text-neutral-500">
          or click to choose a file (.json, .jsonl, .log)
        </div>
        <input
          ref={file}
          type="file"
          accept=".json,.jsonl,.log,.txt,application/json"
          className="hidden"
          onChange={(e) => void readFile(e.target.files?.[0])}
          data-testid="file-input"
        />
      </div>

      <div className="mt-8">
        <label htmlFor="paste" className="label">
          Or paste it
        </label>
        <textarea
          id="paste"
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder='[{"role": "user", "content": "…"}, …]'
          className="mt-2 h-36 w-full resize-y rounded-md border border-neutral-300 p-3 font-mono text-[13px] outline-none focus:border-neutral-900"
          data-testid="paste-input"
        />
        <button
          className="btn-primary mt-3"
          disabled={!paste.trim()}
          onClick={() => onText(paste, 'Pasted log')}
          data-testid="paste-submit"
        >
          Examine
        </button>
      </div>

      {error && (
        <p
          className="mt-6 rounded-md border border-neutral-900 px-4 py-3 text-sm"
          role="alert"
          data-testid="error"
        >
          {error}
        </p>
      )}

      <div className="mt-14">
        <div className="label">Or try a sample log</div>
        <ul className="mt-3 divide-y divide-neutral-200 border-y border-neutral-200">
          {SAMPLES.map((s) => (
            <li key={s.id}>
              <button
                disabled={busy}
                onClick={() => onSample(s.id)}
                className="flex w-full cursor-pointer items-center justify-between gap-4 py-4 text-left transition-colors hover:bg-neutral-50 disabled:opacity-50"
                data-testid={`sample-${s.id}`}
              >
                <span className="font-medium">{s.title}</span>
                <span className="shrink-0 text-sm text-neutral-400">{s.blurb} →</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-10 text-sm text-neutral-500">
        Supported: OpenAI (Chat, Responses, Agents SDK), Anthropic, LangChain / LangSmith,
        OpenTelemetry, MCP and JSONL logs from the{' '}
        <a
          className="underline underline-offset-4"
          href="https://github.com/gfxroy/agent-autopsy/tree/main/python"
          target="_blank"
          rel="noreferrer"
        >
          Python recorder
        </a>
        .
      </p>
    </div>
  )
}

function Report({ analysis, onBack }: { analysis: Analysis; onBack: () => void }) {
  const r = useMemo(() => plainReport(analysis), [analysis])
  const cert = useMemo(() => certificateData(analysis), [analysis])
  const canvas = useRef<HTMLCanvasElement>(null)
  const [copied, setCopied] = useState(false)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    if (canvas.current) drawCertificate(canvas.current, cert)
  }, [cert])

  const copy = async () => {
    const text = reportText(r, SITE_URL)
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const download = () => {
    const c = canvas.current
    if (!c) return
    const a = document.createElement('a')
    a.download = `agent-autopsy-certificate-${cert.caseNo.toLowerCase()}.png`
    a.href = c.toDataURL('image/png')
    a.click()
  }

  const LIMIT = 14
  const failedIdx = r.steps.findIndex((s) => s.failed)
  const visible =
    showAll || r.steps.length <= LIMIT
      ? r.steps
      : r.steps.filter(
          (s, i) => i < 4 || i >= r.steps.length - 3 || Math.abs(i - failedIdx) <= 2 || s.failed,
        )

  return (
    <div className="wrap py-12 sm:py-16" data-testid="report">
      <button onClick={onBack} className="link text-sm" data-testid="back">
        ← Examine another log
      </button>

      <div className="mt-8 flex items-start gap-6 sm:gap-8">
        <div
          className="flex size-20 shrink-0 items-center justify-center rounded-md border-2 border-neutral-900 font-serif text-4xl sm:size-24 sm:text-5xl"
          data-testid="grade"
          aria-label={`Grade ${r.grade}`}
        >
          {r.grade}
        </div>
        <div className="min-w-0">
          <div className="label" data-testid="status">
            {r.statusLabel}
          </div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight break-words sm:text-2xl">
            {r.name}
          </h1>
          <p className="mt-1 text-sm text-neutral-500">{r.facts}</p>
        </div>
      </div>

      <section className="mt-10">
        <h2 className="label">{r.status === 'healthy' ? 'Result' : 'Cause of death'}</h2>
        <p className="mt-2 text-xl leading-snug sm:text-2xl" data-testid="cause">
          {r.cause}
        </p>
      </section>

      <section className="mt-12">
        <h2 className="label">What happened</h2>
        <ol className="mt-4 border-t border-neutral-200" data-testid="steps">
          {visible.map((s, i) => (
            <li key={s.id}>
              {i > 0 && s.n - visible[i - 1].n > 1 && (
                <button
                  onClick={() => setShowAll(true)}
                  className="w-full border-b border-neutral-200 py-2 text-left text-sm text-neutral-400 hover:text-neutral-900"
                >
                  … {s.n - visible[i - 1].n - 1} more steps
                </button>
              )}
              <div
                className={`flex gap-4 border-b border-neutral-200 py-3 ${s.failed ? 'bg-neutral-100' : ''}`}
                data-testid="step"
                data-failed={s.failed}
              >
                <span
                  className={`w-8 shrink-0 pl-1 text-right font-mono text-sm ${s.failed ? 'font-bold text-neutral-900' : 'text-neutral-400'}`}
                >
                  {s.failed ? '✕' : s.n}
                </span>
                <div className="min-w-0">
                  <div className={s.failed ? 'font-semibold' : ''}>
                    {s.text}
                    {s.n === r.failedStep && (
                      <span className="ml-2 text-xs font-medium tracking-wide text-neutral-500 uppercase">
                        step {s.n} · failed here
                      </span>
                    )}
                  </div>
                  {s.detail && (
                    <div className="mt-0.5 truncate text-sm text-neutral-500">{s.detail}</div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {r.fixes.length > 0 && (
        <section className="mt-12">
          <h2 className="label">How to fix</h2>
          <ul className="mt-4 space-y-3" data-testid="fixes">
            {r.fixes.map((f) => (
              <li key={f} className="flex gap-3 leading-relaxed">
                <span className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-neutral-900" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-12 flex flex-wrap gap-3">
        <button className="btn-primary" onClick={() => void copy()} data-testid="copy-report">
          {copied ? 'Copied' : 'Copy report'}
        </button>
        <button className="btn" onClick={download} data-testid="download-certificate">
          Download certificate
        </button>
      </div>

      <section className="mt-12">
        <h2 className="label">Certificate</h2>
        <canvas
          ref={canvas}
          width={1200}
          height={675}
          className="mt-4 w-full rounded-md border border-neutral-200"
          data-testid="certificate"
          aria-label={`${cert.title}: ${cert.cause}`}
        />
        <p className="mt-2 text-sm text-neutral-500">
          Personal data such as emails, keys and phone numbers is removed from the certificate and
          the copied report.
        </p>
      </section>
    </div>
  )
}
