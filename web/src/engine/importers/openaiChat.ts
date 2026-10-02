/**
 * OpenAI Chat Completions: a `messages` array (with assistant `tool_calls` and `tool` role
 * results), a request body `{model, messages, tools}`, optionally with the `response`, or a
 * log of calls `[{request, response, started_at?, latency_ms?}]` (what most wrappers record).
 */
import type { Message, ToolCall, ToolDef, Trace } from '../types'
import { asNumber, asString, contentToText, isRecord, toMs, tryParseJson } from '../util'
import { buildSpansFromMessages, looksLikeError, type CallMeta } from './messages'
import type { Importer } from './types'

const ROLES = new Set(['system', 'developer', 'user', 'assistant', 'tool', 'function'])

function isChatMessage(m: unknown): boolean {
  if (!isRecord(m) || typeof m.role !== 'string' || !ROLES.has(m.role)) return false
  // Anthropic-style content blocks are handled by the Anthropic importer.
  if (
    Array.isArray(m.content) &&
    m.content.some((b) => isRecord(b) && (b.type === 'tool_use' || b.type === 'tool_result'))
  )
    return false
  return true
}

export function convertChatMessage(m: Record<string, unknown>): Message {
  const role =
    m.role === 'developer' ? 'system' : m.role === 'function' ? 'tool' : (m.role as Message['role'])
  const msg: Message = { role, content: contentToText(m.content ?? m.refusal) }
  if (Array.isArray(m.tool_calls)) {
    msg.toolCalls = m.tool_calls.filter(isRecord).map((tc, i): ToolCall => {
      const fn = isRecord(tc.function) ? tc.function : {}
      const argsRaw =
        typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {})
      return {
        id: asString(tc.id) ?? `call_${i}`,
        name: asString(fn.name) ?? 'unknown',
        argsRaw,
        args: tryParseJson(argsRaw),
      }
    })
  } else if (isRecord(m.function_call)) {
    const fc = m.function_call
    const argsRaw = asString(fc.arguments) ?? '{}'
    msg.toolCalls = [
      {
        id: `fc_${asString(fc.name)}`,
        name: asString(fc.name) ?? 'unknown',
        argsRaw,
        args: tryParseJson(argsRaw),
      },
    ]
  }
  if (role === 'tool') {
    msg.toolCallId =
      asString(m.tool_call_id) ?? (m.role === 'function' ? `fc_${asString(m.name)}` : undefined)
    msg.name = asString(m.name)
    msg.isError = looksLikeError(msg.content)
  }
  return msg
}

export function convertChatTools(tools: unknown): ToolDef[] {
  if (!Array.isArray(tools)) return []
  return tools.filter(isRecord).map((t) => {
    const fn = isRecord(t.function) ? t.function : t
    return {
      name: asString(fn.name) ?? 'unknown',
      description: asString(fn.description),
      parameters: isRecord(fn.parameters) ? (fn.parameters as ToolDef['parameters']) : undefined,
    }
  })
}

function isCallLog(d: unknown): d is Record<string, unknown>[] {
  return (
    Array.isArray(d) &&
    d.length > 0 &&
    d.every(
      (e) =>
        isRecord(e) &&
        isRecord(e.request) &&
        Array.isArray(e.request.messages) &&
        e.request.messages.every(isChatMessage) &&
        (!isRecord(e.response) || Array.isArray(e.response.choices)),
    )
  )
}

function responseMessage(resp: unknown): { msg?: Record<string, unknown>; finish?: string } {
  if (!isRecord(resp) || !Array.isArray(resp.choices) || !isRecord(resp.choices[0])) return {}
  const c = resp.choices[0]
  return { msg: isRecord(c.message) ? c.message : undefined, finish: asString(c.finish_reason) }
}

function usageMeta(resp: unknown): CallMeta {
  if (!isRecord(resp)) return {}
  const u = isRecord(resp.usage) ? resp.usage : {}
  const details = isRecord(u.prompt_tokens_details) ? u.prompt_tokens_details : {}
  return {
    model: asString(resp.model),
    inputTokens: asNumber(u.prompt_tokens),
    outputTokens: asNumber(u.completion_tokens),
    cachedTokens: asNumber(details.cached_tokens),
  }
}

export const openaiChatImporter: Importer = {
  id: 'openai-chat',
  label: 'OpenAI Chat Completions',
  detect(d) {
    if (isCallLog(d)) return 0.95
    const msgs = Array.isArray(d) ? d : isRecord(d) && Array.isArray(d.messages) ? d.messages : null
    if (!msgs || msgs.length === 0) return 0
    if (!msgs.every(isChatMessage)) return 0
    const hasOpenAiShape = msgs.some(
      (m) =>
        isRecord(m) && (Array.isArray(m.tool_calls) || m.role === 'tool' || m.role === 'developer'),
    )
    return hasOpenAiShape ? 0.9 : 0.55
  },
  parse(d, name = 'OpenAI chat trace'): Trace {
    let rawMessages: Record<string, unknown>[] = []
    let tools: ToolDef[] = []
    let model: string | undefined
    const calls: CallMeta[] = []

    if (isCallLog(d)) {
      // The last request contains the whole history; append its response.
      for (const entry of d) {
        const resp = entry.response
        const meta = usageMeta(resp)
        const started = toMs(entry.started_at ?? entry.start_time ?? entry.timestamp)
        const latency = asNumber(entry.latency_ms ?? entry.duration_ms)
        const ended =
          toMs(entry.ended_at ?? entry.end_time) ??
          (started !== undefined && latency !== undefined ? started + latency : undefined)
        calls.push({
          ...meta,
          start: started,
          end: ended,
          finishReason: responseMessage(resp).finish,
        })
      }
      const last = d[d.length - 1]
      const req = last.request as Record<string, unknown>
      rawMessages = (req.messages as unknown[]).filter(isRecord)
      const { msg } = responseMessage(last.response)
      if (msg) rawMessages = [...rawMessages, msg]
      tools = convertChatTools(req.tools)
      model = asString(req.model)
    } else if (Array.isArray(d)) {
      rawMessages = d.filter(isRecord)
    } else if (isRecord(d)) {
      rawMessages = (d.messages as unknown[]).filter(isRecord)
      tools = convertChatTools(d.tools)
      model = asString(d.model)
      const { msg, finish } = responseMessage(d.response)
      if (msg) {
        rawMessages = [...rawMessages, msg]
        calls.length = rawMessages.filter((m) => m.role === 'assistant').length
        calls[calls.length - 1] = { ...usageMeta(d.response), finishReason: finish }
      }
    }
    const messages = rawMessages.map(convertChatMessage)
    const built = buildSpansFromMessages(messages, {
      tools,
      model,
      provider: 'openai',
      calls: calls.length ? Array.from(calls, (c) => c ?? {}) : undefined,
      agentName: isRecord(d) && typeof d.name === 'string' ? d.name : 'agent',
    })
    return {
      id: '',
      name,
      format: 'openai-chat',
      spans: built.spans,
      tools,
      finalOutput: built.finalOutput,
      timingEstimated: built.timingEstimated,
      meta: { model },
    }
  },
}
