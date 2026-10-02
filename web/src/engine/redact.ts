/** Redaction of secrets & PII before sharing. Deterministic, regex-based, conservative. */
import type { Message, Span, Trace } from './types'

interface RedactRule {
  label: string
  re: RegExp
  validate?: (m: string) => boolean
  /** Replace only this capture group (e.g. the value in `password=...`). */
  group?: number
}

function luhn(num: string): boolean {
  const d = num.replace(/\D/g, '')
  if (d.length < 13 || d.length > 19) return false
  let sum = 0
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i])
    if (i % 2 === 1) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
  }
  return sum % 10 === 0
}

export const REDACT_RULES: RedactRule[] = [
  {
    label: 'PRIVATE_KEY',
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  { label: 'API_KEY', re: /\bsk-(?:ant-|proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/g },
  { label: 'API_KEY', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { label: 'API_KEY', re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/g },
  { label: 'API_KEY', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { label: 'API_KEY', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { label: 'JWT', re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { label: 'TOKEN', re: /\bBearer\s+([A-Za-z0-9._~+/-]{16,}=*)/g, group: 1 },
  {
    label: 'SECRET',
    re: /\b(?:api[_-]?key|secret|token|password|passwd|pwd)\b["']?\s*[:=]\s*["']?([^\s"',}{]{6,})/gi,
    group: 1,
  },
  { label: 'EMAIL', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { label: 'CARD', re: /\b(?:\d[ -]?){12,18}\d\b/g, validate: luhn },
  { label: 'SSN', re: /\b\d{3}-\d{2}-\d{4}\b/g },
  { label: 'PHONE', re: /(?<![\w.])(?:\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g },
  { label: 'IP', re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g },
]

export function redactText(text: string): {
  text: string
  count: number
  labels: Record<string, number>
} {
  let out = text
  let count = 0
  const labels: Record<string, number> = {}
  for (const r of REDACT_RULES) {
    out = out.replace(r.re, (match, ...groups) => {
      if (r.validate && !r.validate(match)) return match
      count++
      labels[r.label] = (labels[r.label] ?? 0) + 1
      if (r.group) {
        const g = groups[r.group - 1] as string
        return match.replace(g, `[${r.label}]`)
      }
      return `[${r.label}]`
    })
  }
  return { text: out, count, labels }
}

export function redact(text: string | undefined): string | undefined {
  return text === undefined ? undefined : redactText(text).text
}

function redactDeep(v: unknown): unknown {
  if (typeof v === 'string') return redactText(v).text
  if (Array.isArray(v)) return v.map(redactDeep)
  if (v && typeof v === 'object')
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redactDeep(x)]))
  return v
}

function redactMessages(ms: Message[] | undefined): Message[] | undefined {
  return ms?.map((m) => ({
    ...m,
    content: redactText(m.content).text,
    toolCalls: m.toolCalls?.map((c) => ({
      ...c,
      argsRaw: redactText(c.argsRaw).text,
      args: redactDeep(c.args),
    })),
  }))
}

export function redactTrace(trace: Trace): Trace {
  const spans: Span[] = trace.spans.map((s) => ({
    ...s,
    name: redactText(s.name).text,
    error: redact(s.error),
    input: redactMessages(s.input),
    output: redactMessages(s.output),
    toolArgs: redactDeep(s.toolArgs),
    toolArgsRaw: redact(s.toolArgsRaw),
    toolResult: redact(s.toolResult),
    attributes: redactDeep(s.attributes) as Record<string, unknown>,
  }))
  return {
    ...trace,
    name: redactText(trace.name).text,
    spans,
    finalOutput: redact(trace.finalOutput),
  }
}
