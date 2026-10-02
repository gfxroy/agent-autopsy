/** Small shared helpers for importers and rules. */

/** Rough token estimate (~4 chars/token for English & JSON). Deterministic. */
export function estimateTokens(text: string | undefined | null): number {
  if (!text) return 0
  return Math.max(1, Math.ceil(text.length / 4))
}

export function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Stable JSON stringify with sorted keys — used to compare tool arguments. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const obj = value as Record<string, unknown>
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(',')}}`
}

/** Turn any content shape (string, content-part arrays, objects) into display text. */
export function contentToText(content: unknown): string {
  if (content == null) return ''
  if (typeof content === 'string') return content
  if (typeof content === 'number' || typeof content === 'boolean') return String(content)
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object') {
          const p = part as Record<string, unknown>
          if (typeof p.text === 'string') return p.text
          if (typeof p.content === 'string') return p.content
          if (p.type === 'image_url' || p.type === 'image' || p.type === 'input_image')
            return '[image]'
          if (p.type === 'refusal' && typeof p.refusal === 'string') return p.refusal
          return JSON.stringify(p)
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  if (typeof content === 'object') {
    const c = content as Record<string, unknown>
    if (typeof c.text === 'string') return c.text
    return JSON.stringify(content)
  }
  return String(content)
}

/** Deterministic 32-bit hash (FNV-1a). */
export function hash32(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Nanosecond epoch fields (OTLP `*UnixNano`) → ms. Unlike `toMs`, never guesses the unit. */
export function nanosToMs(value: unknown): number | undefined {
  if (value == null || value === '') return undefined
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN
  return Number.isFinite(n) ? n / 1e6 : undefined
}

export function toMs(value: unknown): number | undefined {
  if (value == null || value === '') return undefined
  if (typeof value === 'number') {
    if (value > 1e17) return value / 1e6 // ns
    if (value > 1e14) return value / 1e3 // µs
    if (value > 1e11) return value // ms
    return value * 1000 // s
  }
  if (typeof value === 'string') {
    if (/^\d+$/.test(value)) return toMs(Number(value))
    const t = Date.parse(value)
    return Number.isNaN(t) ? undefined : t
  }
  return undefined
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

export function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return undefined
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

export function fmtMs(ms: number): string {
  if (!Number.isFinite(ms)) return '–'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`
  const m = Math.floor(ms / 60_000)
  return `${m}m ${Math.round((ms % 60_000) / 1000)}s`
}

export function fmtUsd(usd: number): string {
  if (usd === 0) return '$0.00'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  if (usd < 10) return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(2)}`
}

export function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`
  return n.toLocaleString('en-US')
}

/** Parse JSON or JSONL text into a value (array for JSONL). Throws on garbage. */
export function parseJsonOrJsonl(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('Empty input')
  try {
    return JSON.parse(trimmed)
  } catch (err) {
    const lines = trimmed.split(/\r?\n/).filter((l) => l.trim())
    if (lines.length >= 1) {
      const out: unknown[] = []
      for (const line of lines) {
        const l = line.trim()
        const parsed = tryParseJson(l)
        if (parsed !== undefined) {
          out.push(parsed)
          continue
        }
        // Log lines like `2025-01-01T00:00:00Z [server] [info] Message from client: {...}`
        const brace = l.indexOf('{')
        if (brace > 0) {
          const inner = tryParseJson(l.slice(brace))
          if (inner !== undefined) {
            out.push({ __logPrefix: l.slice(0, brace).trim(), __message: inner })
            continue
          }
        }
      }
      if (out.length) return out
    }
    throw new Error(`Could not parse JSON or JSONL: ${(err as Error).message}`)
  }
}
