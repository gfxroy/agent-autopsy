/** Optional "Explain this failure" / LLM roast with the visitor's own key. Key lives in sessionStorage only. */
import type { Analysis } from '../engine/analyze'
import { redactText } from '../engine/redact'
import { fmtMs, fmtUsd, truncate } from '../engine/util'

export type Provider = 'openai' | 'gemini'

export interface LlmConfig {
  provider: Provider
  model: string
  key: string
}

export const DEFAULT_MODELS: Record<Provider, string> = {
  openai: 'gpt-4o-mini',
  gemini: 'gemini-3.5-flash-lite',
}

const KEY = 'agent-autopsy:llm'

export function loadLlmConfig(): LlmConfig | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as LlmConfig) : null
  } catch {
    return null
  }
}

export function saveLlmConfig(cfg: LlmConfig | null): void {
  if (cfg) sessionStorage.setItem(KEY, JSON.stringify(cfg))
  else sessionStorage.removeItem(KEY)
}

/** Compact, always-redacted summary of the run for the prompt (never the full trace). */
export function traceDigest(a: Analysis): string {
  const steps = a.trace.spans
    .filter((s) => s.kind !== 'agent' && s.kind !== 'chain')
    .slice(0, 60)
    .map((s, i) => {
      const base = `${i + 1}. [${s.kind}${s.status === 'error' ? ' ERROR' : ''}] ${s.toolName ?? s.name} (${fmtMs(s.end - s.start)})`
      if (s.kind === 'tool')
        return `${base} args=${truncate(s.toolArgsRaw ?? '', 160)} result=${truncate((s.toolResult ?? s.error ?? '').replace(/\s+/g, ' '), 220)}`
      if (s.kind === 'llm') {
        const out = s.output
          ?.map(
            (m) => m.toolCalls?.map((c) => `call ${c.name}`).join(', ') || truncate(m.content, 160),
          )
          .join(' | ')
        return `${base} in=${s.inputTokens} out=${s.outputTokens} → ${out ?? ''}`
      }
      return base
    })
  const findings = a.findings.map((f) => `- [${f.severity}] ${f.title}: ${truncate(f.detail, 240)}`)
  const user =
    a.trace.spans.find((s) => s.kind === 'llm')?.input?.find((m) => m.role === 'user')?.content ??
    ''
  return redactText(
    [
      `Task: ${truncate(user, 400)}`,
      `Grade ${a.grade}, health ${a.health}/100, cost ${fmtUsd(a.totalCost)}, wasted ${fmtUsd(a.wastedUsd)}.`,
      `Final answer: ${truncate(a.trace.finalOutput ?? '(none)', 300)}`,
      'Steps:',
      ...steps,
      'Automatic findings:',
      ...(findings.length ? findings : ['(none)']),
    ].join('\n'),
  ).text
}

export function explainPrompt(a: Analysis, mode: 'explain' | 'roast'): string {
  const digest = traceDigest(a)
  if (mode === 'roast')
    return `You are a savage but good-natured stand-up comedian who is also a senior AI engineer. Roast this AI agent run in 4 short punchy lines, each grounded in a specific thing that happened. End with one genuinely useful fix. No slurs, keep it work-safe.\n\n${digest}`
  return `You are a senior applied-AI engineer debugging an agent run. Explain in plain English (max 180 words): (1) the root cause of the failure, (2) the chain of events, (3) the 2-3 most impactful concrete fixes (prompt, tool design, or orchestration code). Be specific to this trace.\n\n${digest}`
}

export async function callLlm(
  cfg: LlmConfig,
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  if (cfg.provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
      }),
      signal,
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data?.error?.message ?? `OpenAI error ${res.status}`)
    return data.choices?.[0]?.message?.content ?? ''
  }
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.key },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
      signal,
    },
  )
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message ?? `Gemini error ${res.status}`)
  return (data.candidates?.[0]?.content?.parts ?? [])
    .map((p: { text?: string }) => p.text ?? '')
    .join('')
}
