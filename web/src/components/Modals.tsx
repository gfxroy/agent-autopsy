import { useState } from 'react'
import { DEFAULT_MODELS, loadLlmConfig, saveLlmConfig, type Provider } from '../lib/llm'
import { useStore } from '../store'
import { Modal } from './ui'

export function SettingsModal() {
  const st = useStore()
  const cur = loadLlmConfig()
  const [provider, setProvider] = useState<Provider>(cur?.provider ?? 'gemini')
  const [model, setModel] = useState(cur?.model ?? DEFAULT_MODELS[cur?.provider ?? 'gemini'])
  const [key, setKey] = useState(cur?.key ?? '')
  return (
    <Modal title="⚙️ Settings" onClose={() => st.setModal(null)}>
      <div className="space-y-4 text-sm">
        <section>
          <h3 className="font-semibold text-white">
            LLM explain / roast (optional, bring your own key)
          </h3>
          <p className="mt-1 text-xs text-slate-400">
            Your key is kept in <code>sessionStorage</code> (cleared when the tab closes) and sent
            only to the provider you pick, directly from your browser. Only a short, always-redacted
            digest of the run is sent — never the raw trace.
          </p>
          <div className="mt-3 grid grid-cols-[6rem_1fr] items-center gap-2">
            <label htmlFor="prov" className="text-slate-400">
              Provider
            </label>
            <select
              id="prov"
              value={provider}
              onChange={(e) => {
                const p = e.target.value as Provider
                setProvider(p)
                setModel(DEFAULT_MODELS[p])
              }}
              className="rounded border border-white/10 bg-ink-800 px-2 py-1.5"
            >
              <option value="gemini">Google Gemini</option>
              <option value="openai">OpenAI</option>
            </select>
            <label htmlFor="model" className="text-slate-400">
              Model
            </label>
            <input
              id="model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="rounded border border-white/10 bg-ink-800 px-2 py-1.5 font-mono"
            />
            <label htmlFor="key" className="text-slate-400">
              API key
            </label>
            <input
              id="key"
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={provider === 'openai' ? 'sk-…' : 'AIza…'}
              className="rounded border border-white/10 bg-ink-800 px-2 py-1.5 font-mono"
            />
          </div>
          <div className="mt-3 flex gap-2">
            <button
              className="btn-primary"
              onClick={() => {
                saveLlmConfig(
                  key.trim()
                    ? { provider, model: model.trim() || DEFAULT_MODELS[provider], key: key.trim() }
                    : null,
                )
                st.toast({
                  icon: '🔑',
                  title: key.trim() ? 'Key saved for this session' : 'Key cleared',
                  tone: 'info',
                })
                st.setModal(null)
              }}
            >
              Save
            </button>
            <button
              className="btn-ghost"
              onClick={() => {
                saveLlmConfig(null)
                setKey('')
              }}
            >
              Forget key
            </button>
          </div>
        </section>
        <section className="border-t border-white/[0.06] pt-3 text-xs text-slate-400">
          Model prices used for cost estimates can be edited in the <b>Cost</b> tab. Sound effects
          and Roast mode are in the header.
        </section>
      </div>
    </Modal>
  )
}

const KEYS: [string, string][] = [
  ['1 – 8', 'Switch tabs'],
  ['j / k  or  ↑ / ↓', 'Next / previous span'],
  ['Enter', 'Accuse span (Spot the Bug)'],
  ['h', 'Hint (Spot the Bug)'],
  ['r', 'Toggle Roast mode'],
  ['x', 'Toggle redaction'],
  ['c', 'Death certificate'],
  ['p', 'Paste a trace'],
  ['?', 'This help'],
  ['Esc', 'Close / deselect'],
]

export function ShortcutsModal() {
  const st = useStore()
  return (
    <Modal title="⌨️ Keyboard shortcuts" onClose={() => st.setModal(null)}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        {KEYS.map(([k, v]) => (
          <div key={k} className="contents">
            <dt>
              <span className="kbd">{k}</span>
            </dt>
            <dd className="text-slate-300">{v}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  )
}

export function PasteModal() {
  const st = useStore()
  const [text, setText] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const submit = () => {
    try {
      st.addTrace(text, 'Pasted trace', 'paste')
      st.setModal(null)
      st.setTab('autopsy')
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  return (
    <Modal title="📋 Paste a trace" onClose={() => st.setModal(null)} wide>
      <p className="mb-2 text-xs text-slate-400">
        OpenAI / Anthropic messages or request logs, Responses API, Agents SDK, LangSmith, OTLP /
        OpenInference JSON, MCP JSON-RPC logs, or JSONL. Everything stays in your browser.
      </p>
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="h-72 w-full rounded-lg border border-white/10 bg-ink-900 p-3 font-mono text-xs text-slate-200"
        placeholder='[{"role":"user","content":"…"}, …]'
        aria-label="Trace JSON"
        data-testid="paste-input"
      />
      {err && <p className="mt-2 text-sm text-rose-300">{err}</p>}
      <div className="mt-3 flex justify-end">
        <button
          className="btn-primary"
          disabled={!text.trim()}
          onClick={submit}
          data-testid="paste-submit"
        >
          Run autopsy
        </button>
      </div>
    </Modal>
  )
}
