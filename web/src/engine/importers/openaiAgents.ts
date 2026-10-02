/**
 * OpenAI Agents SDK trace export: `trace.span` objects with typed `span_data`
 * (agent, generation, response, function, handoff, guardrail, custom, mcp_tools).
 * Accepts an array/JSONL of spans (optionally with the `trace` object), `{trace, spans}`
 * or `{data: [...]}`.
 */
import type { Message, Span, SpanKind, ToolDef, Trace } from '../types'
import { asNumber, asString, contentToText, isRecord, toMs, tryParseJson } from '../util'
import { convertChatMessage } from './openaiChat'
import { itemsToMessages, looksLikeError } from './messages-bridge'
import type { Importer } from './types'

function isSpan(x: unknown): x is Record<string, unknown> {
  return (
    isRecord(x) &&
    (x.object === 'trace.span' || (isRecord(x.span_data) && typeof x.span_data.type === 'string'))
  )
}

function collect(d: unknown): {
  spans: Record<string, unknown>[]
  trace?: Record<string, unknown>
} {
  const list = Array.isArray(d)
    ? d
    : isRecord(d)
      ? Array.isArray(d.spans)
        ? d.spans
        : Array.isArray(d.data)
          ? d.data
          : []
      : []
  const trace = Array.isArray(d)
    ? (d.find((x) => isRecord(x) && x.object === 'trace') as Record<string, unknown> | undefined)
    : isRecord(d) && isRecord(d.trace)
      ? d.trace
      : undefined
  return { spans: list.filter(isSpan), trace }
}

function toMessages(v: unknown): Message[] | undefined {
  if (!Array.isArray(v)) return undefined
  const looksResponses = v.some((x) => isRecord(x) && typeof x.type === 'string')
  if (looksResponses) return itemsToMessages(v)
  return v
    .filter((x) => isRecord(x) && typeof x.role === 'string')
    .map((x) => convertChatMessage(x as Record<string, unknown>))
}

const KIND: Record<string, SpanKind> = {
  agent: 'agent',
  generation: 'llm',
  response: 'llm',
  function: 'tool',
  handoff: 'handoff',
  guardrail: 'guardrail',
  custom: 'other',
  mcp_tools: 'other',
  transcription: 'llm',
  speech: 'llm',
}

export const openaiAgentsImporter: Importer = {
  id: 'openai-agents',
  label: 'OpenAI Agents SDK trace',
  detect(d) {
    const { spans } = collect(d)
    if (!spans.length) return 0
    const all = Array.isArray(d) ? d.filter((x) => !(isRecord(x) && x.object === 'trace')) : spans
    return spans.length === all.length ? 0.98 : 0.5
  },
  parse(d, name): Trace {
    const { spans: raw, trace } = collect(d)
    const tools = new Map<string, ToolDef>()
    const spans: Span[] = []
    let finalOutput: string | undefined
    for (const r of raw) {
      const sd = r.span_data as Record<string, unknown>
      const type = String(sd.type)
      const kind = KIND[type] ?? 'other'
      const start = toMs(r.started_at) ?? 0
      const end = toMs(r.ended_at) ?? start
      const err = isRecord(r.error)
        ? (asString(r.error.message) ?? JSON.stringify(r.error))
        : undefined
      const span: Span = {
        id: asString(r.id) ?? `span_${spans.length}`,
        parentId: asString(r.parent_id) ?? undefined,
        kind,
        name: asString(sd.name) ?? type,
        start,
        end,
        status: err ? 'error' : 'ok',
        error: err,
        attributes: { span_type: type },
      }
      if (type === 'agent') {
        span.agentName = span.name
        for (const t of (sd.tools as unknown[]) ?? [])
          if (typeof t === 'string') tools.set(t, tools.get(t) ?? { name: t })
        if (Array.isArray(sd.handoffs)) span.attributes.handoffs = sd.handoffs
      } else if (type === 'generation' || type === 'response') {
        const usage = isRecord(sd.usage) ? sd.usage : {}
        span.model =
          asString(sd.model) ??
          (isRecord(sd.model_config) ? asString(sd.model_config.model) : undefined)
        span.name = span.model ?? type
        span.provider = 'openai'
        span.inputTokens = asNumber(usage.input_tokens ?? usage.prompt_tokens)
        span.outputTokens = asNumber(usage.output_tokens ?? usage.completion_tokens)
        const details = isRecord(usage.input_tokens_details) ? usage.input_tokens_details : {}
        span.cachedTokens = asNumber(details.cached_tokens)
        span.input = toMessages(sd.input)
        span.output = toMessages(sd.output)
        if (type === 'response') span.attributes.response_id = sd.response_id
        const outText = span.output
          ?.filter((m) => m.role === 'assistant' && !m.toolCalls?.length)
          .map((m) => m.content)
          .join('\n')
        const hasCalls = span.output?.some((m) => m.toolCalls?.length)
        if (outText?.trim()) finalOutput = outText
        else if (hasCalls) finalOutput = undefined
        span.finishReason = hasCalls ? 'tool_calls' : 'stop'
      } else if (type === 'function') {
        const argsRaw = typeof sd.input === 'string' ? sd.input : JSON.stringify(sd.input ?? {})
        span.toolName = span.name
        span.toolArgsRaw = argsRaw
        span.toolArgs = tryParseJson(argsRaw)
        span.toolResult = sd.output == null ? undefined : contentToText(sd.output)
        if (!err && looksLikeError(span.toolResult)) {
          span.status = 'error'
          span.error = span.toolResult?.slice(0, 300)
        }
        if (isRecord(sd.mcp_data)) span.attributes.mcp = sd.mcp_data
        if (!tools.has(span.name)) tools.set(span.name, { name: span.name })
      } else if (type === 'handoff') {
        span.name = `handoff → ${asString(sd.to_agent) ?? '?'}`
        span.attributes.from_agent = sd.from_agent
        span.attributes.to_agent = sd.to_agent
      } else if (type === 'guardrail') {
        span.attributes.triggered = sd.triggered
        if (sd.triggered) {
          span.status = 'error'
          span.error = `Guardrail "${span.name}" tripped`
        }
      } else if (type === 'mcp_tools') {
        span.name = `mcp list_tools ${asString(sd.server) ?? ''}`.trim()
        for (const t of (sd.result as unknown[]) ?? [])
          if (typeof t === 'string') tools.set(t, tools.get(t) ?? { name: t })
      } else if (type === 'custom') {
        span.attributes.data = sd.data
      }
      spans.push(span)
    }
    // Generations rarely carry tool-call ids that match function spans; tools were already declared by agent spans.
    // Tool names from function spans are kept only if an agent span listed them (so hallucinated names stay detectable).
    const declared = new Set<string>()
    for (const r of raw) {
      const sd = r.span_data as Record<string, unknown>
      if (sd.type === 'agent')
        for (const t of (sd.tools as unknown[]) ?? []) declared.add(String(t))
      if (sd.type === 'mcp_tools')
        for (const t of (sd.result as unknown[]) ?? []) declared.add(String(t))
    }
    const toolList = declared.size ? [...tools.values()].filter((t) => declared.has(t.name)) : []
    return {
      id: '',
      name: name ?? asString(trace?.workflow_name) ?? 'Agents SDK trace',
      format: 'openai-agents',
      spans,
      tools: toolList,
      finalOutput,
      timingEstimated: false,
      meta: { trace_id: trace?.id ?? raw[0]?.trace_id, workflow: trace?.workflow_name },
    }
  },
}
