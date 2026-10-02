/**
 * Token pricing (USD per 1M tokens). Defaults are editable in the UI and persisted locally —
 * provider prices change, so treat these as a starting point and verify against your invoice.
 */
import type { Span } from './types'

export interface PriceRow {
  /** Model name prefix, matched case-insensitively (longest match wins). `*` is the fallback. */
  pattern: string
  input: number
  output: number
  cachedInput?: number
}

export const DEFAULT_PRICES: PriceRow[] = [
  { pattern: 'gpt-5-nano', input: 0.05, output: 0.4, cachedInput: 0.005 },
  { pattern: 'gpt-5-mini', input: 0.25, output: 2, cachedInput: 0.025 },
  { pattern: 'gpt-5', input: 1.25, output: 10, cachedInput: 0.125 },
  { pattern: 'gpt-4.1-nano', input: 0.1, output: 0.4, cachedInput: 0.025 },
  { pattern: 'gpt-4.1-mini', input: 0.4, output: 1.6, cachedInput: 0.1 },
  { pattern: 'gpt-4.1', input: 2, output: 8, cachedInput: 0.5 },
  { pattern: 'gpt-4o-mini', input: 0.15, output: 0.6, cachedInput: 0.075 },
  { pattern: 'gpt-4o', input: 2.5, output: 10, cachedInput: 1.25 },
  { pattern: 'o4-mini', input: 1.1, output: 4.4, cachedInput: 0.275 },
  { pattern: 'o3', input: 2, output: 8, cachedInput: 0.5 },
  { pattern: 'claude-opus-4', input: 15, output: 75, cachedInput: 1.5 },
  { pattern: 'claude-sonnet-4', input: 3, output: 15, cachedInput: 0.3 },
  { pattern: 'claude-3-7-sonnet', input: 3, output: 15, cachedInput: 0.3 },
  { pattern: 'claude-3-5-sonnet', input: 3, output: 15, cachedInput: 0.3 },
  { pattern: 'claude-haiku-4', input: 1, output: 5, cachedInput: 0.1 },
  { pattern: 'claude-3-5-haiku', input: 0.8, output: 4, cachedInput: 0.08 },
  { pattern: 'gemini-2.5-pro', input: 1.25, output: 10, cachedInput: 0.31 },
  { pattern: 'gemini-2.5-flash', input: 0.3, output: 2.5, cachedInput: 0.075 },
  { pattern: 'gemini', input: 0.1, output: 0.4, cachedInput: 0.025 },
  { pattern: '*', input: 1, output: 4, cachedInput: 0.25 },
]

export function normalizeModel(model: string | undefined): string {
  if (!model) return ''
  return model
    .toLowerCase()
    .replace(/^(openai|anthropic|google|models|azure)\//, '')
    .replace(/^chat\s+/, '')
}

export function priceFor(model: string | undefined, table: PriceRow[] = DEFAULT_PRICES): PriceRow {
  const m = normalizeModel(model)
  let best: PriceRow | undefined
  for (const row of table) {
    if (row.pattern === '*') continue
    if (
      m.startsWith(row.pattern.toLowerCase()) &&
      (!best || row.pattern.length > best.pattern.length)
    )
      best = row
  }
  return best ?? table.find((r) => r.pattern === '*') ?? { pattern: '*', input: 0, output: 0 }
}

export interface Cost {
  input: number
  output: number
  total: number
}

export function tokenCost(
  inputTokens: number,
  outputTokens: number,
  cachedTokens: number,
  row: PriceRow,
): Cost {
  const cached = Math.min(cachedTokens, inputTokens)
  const input = ((inputTokens - cached) * row.input + cached * (row.cachedInput ?? row.input)) / 1e6
  const output = (outputTokens * row.output) / 1e6
  return { input, output, total: input + output }
}

export function spanCost(span: Span, table: PriceRow[] = DEFAULT_PRICES): Cost {
  if (span.kind !== 'llm') return { input: 0, output: 0, total: 0 }
  return tokenCost(
    span.inputTokens ?? 0,
    span.outputTokens ?? 0,
    span.cachedTokens ?? 0,
    priceFor(span.model, table),
  )
}

/** Context window sizes (tokens). */
const CONTEXT: [string, number][] = [
  ['gpt-5', 400_000],
  ['gpt-4.1', 1_047_576],
  ['gpt-4o', 128_000],
  ['o3', 200_000],
  ['o4', 200_000],
  ['claude', 200_000],
  ['gemini', 1_048_576],
  ['llama', 128_000],
]

export function contextWindow(model: string | undefined): number {
  const m = normalizeModel(model)
  let best: [string, number] | undefined
  for (const row of CONTEXT)
    if (m.startsWith(row[0]) && (!best || row[0].length > best[0].length)) best = row
  return best?.[1] ?? 128_000
}
