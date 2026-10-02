import type { FormatId, Trace } from '../types'
import { parseJsonOrJsonl } from '../util'
import { anthropicImporter } from './anthropic'
import { jsonlImporter } from './jsonl'
import { langsmithImporter } from './langsmith'
import { mcpImporter } from './mcp'
import { openaiAgentsImporter } from './openaiAgents'
import { openaiChatImporter } from './openaiChat'
import { openaiResponsesImporter } from './openaiResponses'
import { otelImporter } from './otel'
import type { Importer } from './types'

export const IMPORTERS: Importer[] = [
  otelImporter,
  openaiAgentsImporter,
  langsmithImporter,
  openaiResponsesImporter,
  anthropicImporter,
  openaiChatImporter,
  mcpImporter,
  jsonlImporter,
]

export const FORMAT_LABELS: Record<FormatId, string> = Object.fromEntries(
  IMPORTERS.map((i) => [i.id, i.label]),
) as Record<FormatId, string>

export interface Detection {
  format: FormatId
  confidence: number
}

export function detectFormat(data: unknown): Detection | null {
  let best: Detection | null = null
  for (const imp of IMPORTERS) {
    let c = 0
    try {
      c = imp.detect(data)
    } catch {
      c = 0
    }
    if (c > (best?.confidence ?? 0)) best = { format: imp.id, confidence: c }
  }
  return best && best.confidence >= 0.3 ? best : null
}

/** Parse raw text in any supported format into an (un-normalized) Trace. */
export function importTrace(text: string, name?: string, format?: FormatId): Trace {
  const data = parseJsonOrJsonl(text)
  const fmt = format ?? detectFormat(data)?.format
  if (!fmt) {
    throw new Error(
      'Unrecognized trace format. Supported: OpenAI Chat / Responses / Agents SDK, Anthropic Messages, LangSmith runs, OTLP GenAI spans, MCP JSON-RPC logs, span JSONL.',
    )
  }
  const imp = IMPORTERS.find((i) => i.id === fmt)!
  return imp.parse(data, name)
}
