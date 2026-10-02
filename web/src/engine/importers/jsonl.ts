/**
 * Generic span JSONL. Two flavours:
 *  1. Agent Autopsy JSONL (written by the Python helper): OTel-GenAI-style flat spans
 *     `{trace_id, span_id, parent_span_id, name, start_time_unix_nano, end_time_unix_nano, attributes, status}`.
 *  2. Loose records: `{id, parent_id, type|kind, name, start|timestamp, end|duration_ms, model,
 *     input_tokens, output_tokens, input, output, args, result, error}` — handy for hand-rolled logs.
 */
import type { Span, SpanKind, ToolDef, Trace } from '../types'
import { asNumber, asString, contentToText, isRecord, toMs, tryParseJson } from '../util'
import { flatToSpan } from './genai'
import { looksLikeError } from './messages'
import type { Importer } from './types'

const KINDS = new Set([
  'agent',
  'llm',
  'tool',
  'retrieval',
  'handoff',
  'guardrail',
  'chain',
  'other',
])
const KIND_ALIASES: Record<string, SpanKind> = {
  chat: 'llm',
  generation: 'llm',
  model: 'llm',
  function: 'tool',
  tool_call: 'tool',
  retriever: 'retrieval',
  step: 'chain',
  workflow: 'agent',
  run: 'agent',
}

function isOtelFlat(x: unknown): boolean {
  return isRecord(x) && typeof x.span_id === 'string' && isRecord(x.attributes)
}

function isLoose(x: unknown): x is Record<string, unknown> {
  if (!isRecord(x)) return false
  const k = String(x.type ?? x.kind ?? '')
  return (
    (KINDS.has(k) || k in KIND_ALIASES) &&
    (typeof x.name === 'string' || typeof x.tool === 'string' || typeof x.model === 'string')
  )
}

function looseKind(x: Record<string, unknown>): SpanKind {
  const k = String(x.type ?? x.kind)
  return KINDS.has(k) ? (k as SpanKind) : KIND_ALIASES[k]
}

export const jsonlImporter: Importer = {
  id: 'jsonl',
  label: 'Span JSONL (Agent Autopsy / generic)',
  detect(d) {
    if (!Array.isArray(d) || !d.length) return 0
    const objs = d.filter((x) => !(isRecord(x) && x.type === 'meta'))
    if (objs.every(isOtelFlat)) return 0.96
    if (objs.every((x) => isOtelFlat(x) || isLoose(x))) return 0.85
    return 0
  },
  parse(d, name): Trace {
    const arr = (d as unknown[]).filter(isRecord)
    const meta = arr.find((x) => x.type === 'meta')
    const spans: Span[] = []
    const tools = new Map<string, ToolDef>()
    let t = 0
    let estimated = false
    arr.forEach((x, i) => {
      if (x === meta) return
      if (isOtelFlat(x)) {
        const status = isRecord(x.status) ? x.status : {}
        const isError = status.code === 'ERROR' || status.code === 2
        const { span, tools: defs } = flatToSpan({
          id: String(x.span_id),
          parentId: asString(x.parent_span_id),
          name: String(x.name ?? 'span'),
          start: toMs(x.start_time_unix_nano ?? x.start_time) ?? 0,
          end: toMs(x.end_time_unix_nano ?? x.end_time) ?? 0,
          attrs: x.attributes as Record<string, unknown>,
          isError,
          statusError: isError ? (asString(status.message) ?? 'error') : undefined,
        })
        for (const def of defs) tools.set(def.name, def)
        spans.push(span)
        return
      }
      const kind = looseKind(x)
      let start = toMs(x.start ?? x.start_time ?? x.timestamp ?? x.ts)
      const dur = asNumber(x.duration_ms ?? x.latency_ms)
      let end =
        toMs(x.end ?? x.end_time) ??
        (start !== undefined && dur !== undefined ? start + dur : undefined)
      if (start === undefined) {
        estimated = true
        start = t
        end = t + (dur ?? 500)
      }
      end = end ?? start
      t = end
      const err = x.error ? contentToText(x.error) : undefined
      const span: Span = {
        id: asString(x.id) ?? asString(x.span_id) ?? `span_${i}`,
        parentId: asString(x.parent_id ?? x.parent),
        kind,
        name: asString(x.name) ?? asString(x.tool) ?? asString(x.model) ?? kind,
        start,
        end,
        status: err || x.status === 'error' ? 'error' : 'ok',
        error: err,
        attributes: {},
      }
      if (kind === 'llm') {
        const tok = isRecord(x.tokens) ? x.tokens : isRecord(x.usage) ? x.usage : {}
        span.model = asString(x.model)
        span.inputTokens = asNumber(
          x.input_tokens ?? x.prompt_tokens ?? tok.input ?? tok.input_tokens ?? tok.prompt_tokens,
        )
        span.outputTokens = asNumber(
          x.output_tokens ??
            x.completion_tokens ??
            tok.output ??
            tok.output_tokens ??
            tok.completion_tokens,
        )
        if (x.input !== undefined) span.input = [{ role: 'user', content: contentToText(x.input) }]
        if (x.output !== undefined)
          span.output = [{ role: 'assistant', content: contentToText(x.output) }]
      } else if (kind === 'tool') {
        const args = x.args ?? x.arguments ?? x.input
        span.toolName = span.name
        span.toolArgsRaw = typeof args === 'string' ? args : JSON.stringify(args ?? {})
        span.toolArgs = typeof args === 'string' ? tryParseJson(args) : args
        const res = x.result ?? x.output
        span.toolResult = res === undefined ? undefined : contentToText(res)
        if (span.status === 'ok' && looksLikeError(span.toolResult)) {
          span.status = 'error'
          span.error = span.toolResult?.slice(0, 300)
        }
      }
      spans.push(span)
    })
    if (meta && Array.isArray(meta.tools))
      for (const def of meta.tools.filter(isRecord))
        tools.set(String(def.name), {
          name: String(def.name),
          description: asString(def.description),
          parameters: isRecord(def.parameters)
            ? (def.parameters as ToolDef['parameters'])
            : undefined,
        })
    return {
      id: '',
      name: name ?? asString(meta?.name) ?? 'JSONL trace',
      format: 'jsonl',
      spans,
      tools: [...tools.values()],
      finalOutput: asString(meta?.final_output),
      timingEstimated: estimated,
      meta: meta ?? {},
    }
  },
}
