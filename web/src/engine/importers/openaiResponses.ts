/**
 * OpenAI Responses API: response objects (`object: "response"`, typed `output` items) or
 * conversation item lists (`message`, `function_call`, `function_call_output`, `reasoning`,
 * built-in `*_call` items). Accepts a single response, an array of responses, an items list,
 * `{input, output}` or a call log `[{request: {input, tools}, response}]`.
 */
import type { Message, ToolDef, Trace } from '../types'
import { asNumber, asString, contentToText, isRecord, toMs, tryParseJson } from '../util'
import { buildSpansFromMessages, looksLikeError, type CallMeta } from './messages'
import type { Importer } from './types'

const ITEM_TYPES = new Set([
  'message',
  'function_call',
  'function_call_output',
  'reasoning',
  'web_search_call',
  'file_search_call',
  'computer_call',
  'computer_call_output',
  'code_interpreter_call',
  'mcp_call',
  'custom_tool_call',
  'custom_tool_call_output',
])

function isItem(x: unknown): boolean {
  return (
    isRecord(x) &&
    ((typeof x.type === 'string' && ITEM_TYPES.has(x.type)) ||
      (typeof x.role === 'string' && x.type === undefined && !('tool_calls' in x)))
  )
}

function isResponse(x: unknown): x is Record<string, unknown> {
  return isRecord(x) && x.object === 'response' && Array.isArray(x.output)
}

function isCallLog(d: unknown): d is Record<string, unknown>[] {
  return (
    Array.isArray(d) &&
    d.length > 0 &&
    d.every(
      (e) => isRecord(e) && isRecord(e.request) && 'input' in e.request && isResponse(e.response),
    )
  )
}

/** Convert Responses items to chat-like messages. */
export function itemsToMessages(items: unknown[]): Message[] {
  const out: Message[] = []
  let lastAssistant: Message | undefined
  const pushCall = (id: string, name: string, argsRaw: string) => {
    if (!lastAssistant) {
      lastAssistant = { role: 'assistant', content: '' }
      out.push(lastAssistant)
    }
    lastAssistant.toolCalls = [
      ...(lastAssistant.toolCalls ?? []),
      { id, name, argsRaw, args: tryParseJson(argsRaw) },
    ]
  }
  for (const raw of items) {
    if (typeof raw === 'string') {
      out.push({ role: 'user', content: raw })
      lastAssistant = undefined
      continue
    }
    if (!isRecord(raw)) continue
    const type = raw.type ?? 'message'
    if (type === 'message') {
      const role = raw.role === 'developer' ? 'system' : ((raw.role as Message['role']) ?? 'user')
      const msg: Message = { role, content: contentToText(raw.content) }
      out.push(msg)
      lastAssistant = role === 'assistant' ? msg : undefined
    } else if (type === 'function_call' || type === 'custom_tool_call') {
      const argsRaw =
        typeof raw.arguments === 'string'
          ? raw.arguments
          : (asString(raw.input) ?? JSON.stringify(raw.arguments ?? {}))
      pushCall(
        asString(raw.call_id) ?? asString(raw.id) ?? 'call',
        asString(raw.name) ?? 'unknown',
        argsRaw,
      )
    } else if (
      type === 'function_call_output' ||
      type === 'custom_tool_call_output' ||
      type === 'computer_call_output'
    ) {
      const content = contentToText(raw.output)
      out.push({
        role: 'tool',
        content,
        toolCallId: asString(raw.call_id),
        isError: looksLikeError(content),
      })
      lastAssistant = undefined
    } else if (type === 'reasoning') {
      // Reasoning summaries are kept as attributes only; they are not part of the visible chat.
      continue
    } else if (typeof type === 'string' && type.endsWith('_call')) {
      // Built-in tools (web_search_call, file_search_call, mcp_call, ...): call + synthetic result.
      const id = asString(raw.id) ?? type
      const name = type === 'mcp_call' ? (asString(raw.name) ?? 'mcp') : type.replace(/_call$/, '')
      const args = raw.arguments ?? raw.action ?? raw.queries ?? {}
      pushCall(id, name, typeof args === 'string' ? args : JSON.stringify(args))
      const result = raw.output ?? raw.results ?? raw.error ?? raw.status ?? ''
      const content = contentToText(result)
      out.push({
        role: 'tool',
        content,
        toolCallId: id,
        isError: raw.status === 'failed' || raw.error != null,
      })
      lastAssistant = undefined
    }
  }
  return out
}

function convertTools(tools: unknown): ToolDef[] {
  if (!Array.isArray(tools)) return []
  return tools.filter(isRecord).map((t) => ({
    name: asString(t.name) ?? asString(t.type) ?? 'unknown',
    description: asString(t.description),
    parameters: isRecord(t.parameters) ? (t.parameters as ToolDef['parameters']) : undefined,
  }))
}

function usageMeta(r: Record<string, unknown>): CallMeta {
  const u = isRecord(r.usage) ? r.usage : {}
  const d = isRecord(u.input_tokens_details) ? u.input_tokens_details : {}
  const start = toMs(r.created_at)
  const end = toMs(r.completed_at)
  const status = asString(r.status)
  const incomplete = isRecord(r.incomplete_details)
    ? asString(r.incomplete_details.reason)
    : undefined
  return {
    model: asString(r.model),
    inputTokens: asNumber(u.input_tokens),
    outputTokens: asNumber(u.output_tokens),
    cachedTokens: asNumber(d.cached_tokens),
    start,
    end: end ?? (start !== undefined ? start + 1 : undefined),
    finishReason:
      incomplete === 'max_output_tokens' ? 'length' : status === 'completed' ? undefined : status,
  }
}

export const openaiResponsesImporter: Importer = {
  id: 'openai-responses',
  label: 'OpenAI Responses API',
  detect(d) {
    if (isResponse(d) || isCallLog(d)) return 0.97
    if (Array.isArray(d) && d.length && d.every(isResponse)) return 0.97
    const items = Array.isArray(d)
      ? d
      : isRecord(d) && Array.isArray(d.input)
        ? [...d.input, ...(Array.isArray(d.output) ? d.output : [])]
        : null
    if (!items?.length) return 0
    const typed = items.filter(
      (x) => isRecord(x) && typeof x.type === 'string' && ITEM_TYPES.has(x.type as string),
    )
    if (!typed.length || !items.every(isItem)) return 0
    return typed.some(
      (x) =>
        isRecord(x) &&
        (x.type === 'function_call' || x.type === 'function_call_output' || x.type === 'reasoning'),
    )
      ? 0.93
      : 0.6
  },
  parse(d, name = 'OpenAI Responses trace'): Trace {
    let items: unknown[] = []
    let tools: ToolDef[] = []
    let instructions: string | undefined
    let model: string | undefined
    let calls: CallMeta[] | undefined
    const responses: Record<string, unknown>[] = isResponse(d)
      ? [d]
      : Array.isArray(d) && d.length && d.every(isResponse)
        ? (d as Record<string, unknown>[])
        : []
    if (isCallLog(d)) {
      const last = d[d.length - 1]
      const req = last.request as Record<string, unknown>
      const input = typeof req.input === 'string' ? [req.input] : (req.input as unknown[])
      items = [...input, ...((last.response as Record<string, unknown>).output as unknown[])]
      tools = convertTools(req.tools)
      instructions = asString(req.instructions)
      model = asString(req.model)
      calls = d.map((e) => usageMeta(e.response as Record<string, unknown>))
    } else if (responses.length) {
      for (const r of responses) items.push(...(r.output as unknown[]))
      tools = convertTools(responses[0].tools)
      instructions = asString(responses[0].instructions)
      model = asString(responses[0].model)
      calls = responses.map(usageMeta)
    } else if (Array.isArray(d)) {
      items = d
    } else if (isRecord(d)) {
      items = [
        ...(typeof d.input === 'string' ? [d.input] : (d.input as unknown[])),
        ...(Array.isArray(d.output) ? d.output : []),
      ]
      tools = convertTools(d.tools)
      instructions = asString(d.instructions)
      model = asString(d.model)
    }
    const messages = itemsToMessages(items)
    if (instructions) messages.unshift({ role: 'system', content: instructions })
    // Collapse multi-response arrays: one CallMeta per assistant message (best effort).
    if (calls && calls.length !== messages.filter((m) => m.role === 'assistant').length) {
      calls = calls.map((c) => ({ ...c, start: undefined, end: undefined }))
    }
    const built = buildSpansFromMessages(messages, {
      tools,
      model,
      provider: 'openai',
      calls,
      agentName: 'agent',
    })
    return {
      id: '',
      name,
      format: 'openai-responses',
      spans: built.spans,
      tools,
      finalOutput: built.finalOutput,
      timingEstimated: built.timingEstimated,
      meta: { model },
    }
  },
}
