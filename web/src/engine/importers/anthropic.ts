/**
 * Anthropic Messages API: `messages` whose content is an array of blocks — assistant
 * `tool_use` blocks and user `tool_result` blocks. Accepts a bare messages array, a request
 * body `{model, system, messages, tools}` (+ optional `response`), or a call log
 * `[{request, response}]` where response is a `{type: "message", usage}` object.
 */
import type { Message, ToolDef, Trace } from '../types'
import { asNumber, asString, contentToText, isRecord, toMs } from '../util'
import { buildSpansFromMessages, looksLikeError, type CallMeta } from './messages'
import type { Importer } from './types'

function hasBlocks(m: unknown): boolean {
  return (
    isRecord(m) &&
    Array.isArray(m.content) &&
    m.content.some(
      (b) =>
        isRecord(b) && ['tool_use', 'tool_result', 'thinking', 'text'].includes(String(b.type)),
    )
  )
}

function isAnthropicMessage(m: unknown): boolean {
  return isRecord(m) && (m.role === 'user' || m.role === 'assistant')
}

export function convertAnthropicMessages(raw: Record<string, unknown>[]): Message[] {
  const out: Message[] = []
  for (const m of raw) {
    const role = m.role === 'assistant' ? 'assistant' : 'user'
    if (!Array.isArray(m.content)) {
      out.push({ role, content: contentToText(m.content) })
      continue
    }
    const blocks = m.content.filter(isRecord)
    if (role === 'assistant') {
      const text = blocks
        .filter((b) => b.type === 'text')
        .map((b) => String(b.text ?? ''))
        .join('\n')
      const toolCalls = blocks
        .filter((b) => b.type === 'tool_use' || b.type === 'server_tool_use')
        .map((b) => ({
          id: asString(b.id) ?? 'toolu',
          name: asString(b.name) ?? 'unknown',
          args: b.input,
          argsRaw: JSON.stringify(b.input ?? {}),
        }))
      out.push({ role, content: text, toolCalls: toolCalls.length ? toolCalls : undefined })
    } else {
      for (const b of blocks.filter((b) => b.type === 'tool_result')) {
        const content = contentToText(b.content)
        out.push({
          role: 'tool',
          content,
          toolCallId: asString(b.tool_use_id),
          isError: b.is_error === true || looksLikeError(content),
        })
      }
      const text = blocks
        .filter((b) => b.type !== 'tool_result')
        .map((b) => contentToText([b]))
        .join('\n')
      if (text.trim()) out.push({ role: 'user', content: text })
    }
  }
  return out
}

function convertTools(tools: unknown): ToolDef[] {
  if (!Array.isArray(tools)) return []
  return tools.filter(isRecord).map((t) => ({
    name: asString(t.name) ?? 'unknown',
    description: asString(t.description),
    parameters: isRecord(t.input_schema) ? (t.input_schema as ToolDef['parameters']) : undefined,
  }))
}

function usageMeta(resp: unknown): CallMeta {
  if (!isRecord(resp)) return {}
  const u = isRecord(resp.usage) ? resp.usage : {}
  const input = asNumber(u.input_tokens)
  const cacheRead = asNumber(u.cache_read_input_tokens) ?? 0
  const cacheWrite = asNumber(u.cache_creation_input_tokens) ?? 0
  return {
    model: asString(resp.model),
    inputTokens: input === undefined ? undefined : input + cacheRead + cacheWrite,
    outputTokens: asNumber(u.output_tokens),
    cachedTokens: cacheRead || undefined,
    finishReason: asString(resp.stop_reason),
  }
}

function isCallLog(d: unknown): d is Record<string, unknown>[] {
  return (
    Array.isArray(d) &&
    d.length > 0 &&
    d.every((e) => isRecord(e) && isRecord(e.request) && Array.isArray(e.request.messages)) &&
    d.some(
      (e) =>
        (isRecord(e.response) && e.response.type === 'message') ||
        ((e.request as Record<string, unknown>).messages as unknown[]).some(hasBlocks),
    )
  )
}

function systemText(sys: unknown): string | undefined {
  if (sys == null) return undefined
  return contentToText(sys)
}

export const anthropicImporter: Importer = {
  id: 'anthropic',
  label: 'Anthropic Messages',
  detect(d) {
    if (isCallLog(d)) return 0.97
    const msgs = Array.isArray(d) ? d : isRecord(d) && Array.isArray(d.messages) ? d.messages : null
    if (!msgs?.length || !msgs.every(isAnthropicMessage)) return 0
    const blocky = msgs.some(
      (m) =>
        isRecord(m) &&
        Array.isArray(m.content) &&
        m.content.some((b) => isRecord(b) && (b.type === 'tool_use' || b.type === 'tool_result')),
    )
    if (blocky) return 0.96
    if (
      isRecord(d) &&
      (typeof d.system === 'string' || Array.isArray(d.system)) &&
      msgs.some(hasBlocks)
    )
      return 0.8
    return 0
  },
  parse(d, name = 'Anthropic trace'): Trace {
    let raw: Record<string, unknown>[] = []
    let tools: ToolDef[] = []
    let model: string | undefined
    let system: string | undefined
    const calls: CallMeta[] = []
    if (isCallLog(d)) {
      for (const e of d) {
        const started = toMs(e.started_at ?? e.timestamp)
        const latency = asNumber(e.latency_ms ?? e.duration_ms)
        calls.push({
          ...usageMeta(e.response),
          start: started,
          end:
            started !== undefined && latency !== undefined ? started + latency : toMs(e.ended_at),
        })
      }
      const last = d[d.length - 1]
      const req = last.request as Record<string, unknown>
      raw = (req.messages as unknown[]).filter(isRecord)
      if (isRecord(last.response) && Array.isArray(last.response.content))
        raw = [...raw, { role: 'assistant', content: last.response.content }]
      tools = convertTools(req.tools)
      model = asString(req.model)
      system = systemText(req.system)
    } else if (Array.isArray(d)) {
      raw = d.filter(isRecord)
    } else if (isRecord(d)) {
      raw = (d.messages as unknown[]).filter(isRecord)
      tools = convertTools(d.tools)
      model = asString(d.model)
      system = systemText(d.system)
      if (isRecord(d.response) && Array.isArray(d.response.content)) {
        raw = [...raw, { role: 'assistant', content: d.response.content }]
        const n = raw.filter((m) => m.role === 'assistant').length
        calls.length = n
        calls[n - 1] = usageMeta(d.response)
      }
    }
    const messages = convertAnthropicMessages(raw)
    if (system) messages.unshift({ role: 'system', content: system })
    const built = buildSpansFromMessages(messages, {
      tools,
      model,
      provider: 'anthropic',
      calls: calls.length ? Array.from(calls, (c) => c ?? {}) : undefined,
      agentName: 'agent',
    })
    return {
      id: '',
      name,
      format: 'anthropic',
      spans: built.spans,
      tools,
      finalOutput: built.finalOutput,
      timingEstimated: built.timingEstimated,
      meta: { model },
    }
  },
}
