/**
 * Convert a flat span with OpenTelemetry GenAI semantic-convention attributes into our span model.
 * Shared by the OTLP JSON importer and the Agent Autopsy JSONL format (written by the Python helper).
 * Also understands common legacy/sibling conventions (gen_ai.prompt.N.*, OpenInference, OpenLLMetry).
 */
import type { Message, Span, SpanKind, ToolCall, ToolDef } from '../types'
import { asNumber, asString, contentToText, isRecord, tryParseJson } from '../util'
import { looksLikeError } from './messages'

export interface FlatSpan {
  id: string
  parentId?: string
  name: string
  start: number
  end: number
  attrs: Record<string, unknown>
  statusError?: string
  isError?: boolean
}

function jsonAttr(v: unknown): unknown {
  return typeof v === 'string' ? (tryParseJson(v) ?? v) : v
}

/** GenAI semconv message: `{role, parts: [{type: text|tool_call|tool_call_response, ...}]}`. */
export function convertGenAiMessages(v: unknown): Message[] | undefined {
  const arr = jsonAttr(v)
  if (!Array.isArray(arr)) return undefined
  const out: Message[] = []
  for (const m of arr) {
    if (!isRecord(m)) continue
    const role = (m.role === 'developer' ? 'system' : m.role) as Message['role']
    if (!Array.isArray(m.parts)) {
      out.push({ role: role ?? 'user', content: contentToText(m.content) })
      continue
    }
    const text: string[] = []
    const calls: ToolCall[] = []
    for (const p of m.parts.filter(isRecord)) {
      if (p.type === 'text' || p.type === 'reasoning') text.push(String(p.content ?? ''))
      else if (p.type === 'tool_call') {
        const argsRaw =
          typeof p.arguments === 'string' ? p.arguments : JSON.stringify(p.arguments ?? {})
        calls.push({
          id: asString(p.id) ?? `call_${calls.length}`,
          name: asString(p.name) ?? 'unknown',
          argsRaw,
          args: tryParseJson(argsRaw),
        })
      } else if (p.type === 'tool_call_response') {
        const content = contentToText(p.response ?? p.result)
        out.push({
          role: 'tool',
          content,
          toolCallId: asString(p.id),
          isError: looksLikeError(content),
        })
      } else text.push(contentToText([p]))
    }
    if (role === 'tool' && !text.length && !calls.length) continue
    out.push({
      role: role ?? 'user',
      content: text.join('\n'),
      toolCalls: calls.length ? calls : undefined,
    })
  }
  return out
}

/** Legacy indexed attributes: gen_ai.prompt.0.role / gen_ai.prompt.0.content (OpenLLMetry). */
function indexedMessages(attrs: Record<string, unknown>, prefix: string): Message[] | undefined {
  const out: Message[] = []
  for (let i = 0; i < 500; i++) {
    const content = attrs[`${prefix}.${i}.content`]
    const role = attrs[`${prefix}.${i}.role`]
    if (content === undefined && role === undefined) break
    out.push({
      role: (asString(role) as Message['role']) ?? 'user',
      content: contentToText(content),
    })
  }
  return out.length ? out : undefined
}

export function convertToolDefs(v: unknown): ToolDef[] {
  const arr = jsonAttr(v)
  if (!Array.isArray(arr)) return []
  return arr.filter(isRecord).map((t) => {
    const fn = isRecord(t.function) ? t.function : t
    const params = fn.parameters ?? fn.input_schema ?? fn.inputSchema
    return {
      name: asString(fn.name) ?? 'unknown',
      description: asString(fn.description),
      parameters: isRecord(params) ? (params as ToolDef['parameters']) : undefined,
    }
  })
}

function classify(name: string, a: Record<string, unknown>): SpanKind {
  const op = asString(a['gen_ai.operation.name'])
  if (op) {
    if (['chat', 'text_completion', 'generate_content', 'completion'].includes(op)) return 'llm'
    if (op === 'execute_tool') return 'tool'
    if (op === 'invoke_agent' || op === 'create_agent') return 'agent'
    if (op === 'embeddings' || op === 'retrieval') return 'retrieval'
    if (op === 'handoff') return 'handoff'
  }
  const oi = asString(a['openinference.span.kind'])?.toUpperCase()
  if (oi) {
    if (oi === 'LLM') return 'llm'
    if (oi === 'TOOL') return 'tool'
    if (oi === 'AGENT') return 'agent'
    if (oi === 'RETRIEVER' || oi === 'EMBEDDING') return 'retrieval'
    if (oi === 'CHAIN') return 'chain'
    if (oi === 'GUARDRAIL') return 'guardrail'
  }
  const kind = asString(a['agent_autopsy.kind'] ?? a.kind)
  if (
    kind &&
    ['agent', 'llm', 'tool', 'retrieval', 'handoff', 'guardrail', 'chain', 'other'].includes(kind)
  )
    return kind as SpanKind
  if (a['gen_ai.tool.name'] || a['tool.name']) return 'tool'
  if (
    a['gen_ai.request.model'] ||
    a['llm.model_name'] ||
    a['gen_ai.usage.input_tokens'] !== undefined
  )
    return 'llm'
  if (a['gen_ai.agent.name']) return 'agent'
  if (/^(chat|text_completion|generate_content)\b/.test(name)) return 'llm'
  if (/^execute_tool\b/.test(name)) return 'tool'
  if (/^invoke_agent\b/.test(name)) return 'agent'
  return 'other'
}

export function flatToSpan(f: FlatSpan): { span: Span; tools: ToolDef[] } {
  const a = f.attrs
  const kind = classify(f.name, a)
  const span: Span = {
    id: f.id,
    parentId: f.parentId || undefined,
    kind,
    name: f.name,
    start: f.start,
    end: f.end,
    status: f.isError ? 'error' : 'ok',
    error: f.statusError ?? asString(a['error.type']),
    attributes: a,
  }
  if (span.error && !f.isError && a['error.type']) span.status = 'error'
  const tools = convertToolDefs(a['gen_ai.tool.definitions'])
  span.agentName = asString(a['gen_ai.agent.name'])
  if (kind === 'llm') {
    span.model =
      asString(a['gen_ai.response.model']) ??
      asString(a['gen_ai.request.model']) ??
      asString(a['llm.model_name'])
    span.provider =
      asString(a['gen_ai.provider.name']) ??
      asString(a['gen_ai.system']) ??
      asString(a['llm.provider'])
    span.inputTokens = asNumber(
      a['gen_ai.usage.input_tokens'] ??
        a['gen_ai.usage.prompt_tokens'] ??
        a['llm.token_count.prompt'] ??
        a['llm.usage.prompt_tokens'],
    )
    span.outputTokens = asNumber(
      a['gen_ai.usage.output_tokens'] ??
        a['gen_ai.usage.completion_tokens'] ??
        a['llm.token_count.completion'] ??
        a['llm.usage.completion_tokens'],
    )
    span.cachedTokens = asNumber(
      a['gen_ai.usage.cache_read.input_tokens'] ??
        a['gen_ai.usage.cached_tokens'] ??
        a['llm.token_count.prompt_details.cache_read'],
    )
    const input =
      convertGenAiMessages(a['gen_ai.input.messages']) ??
      indexedMessages(a, 'gen_ai.prompt') ??
      indexedMessages(a, 'llm.input_messages')
    const sys = jsonAttr(a['gen_ai.system_instructions'])
    if (sys && input && !input.some((m) => m.role === 'system'))
      input.unshift({
        role: 'system',
        content: contentToText(
          Array.isArray(sys) ? sys.map((p) => (isRecord(p) ? p.content : p)) : sys,
        ),
      })
    span.input = input
    span.output =
      convertGenAiMessages(a['gen_ai.output.messages']) ?? indexedMessages(a, 'gen_ai.completion')
    const fr = jsonAttr(a['gen_ai.response.finish_reasons'])
    span.finishReason = Array.isArray(fr) ? asString(fr[0]) : asString(fr)
    if (!span.finishReason) {
      const out = jsonAttr(a['gen_ai.output.messages'])
      if (Array.isArray(out) && isRecord(out[0])) span.finishReason = asString(out[0].finish_reason)
    }
    span.name = span.model ? `chat ${span.model}` : f.name
  } else if (kind === 'tool') {
    span.toolName =
      asString(a['gen_ai.tool.name']) ??
      asString(a['tool.name']) ??
      f.name.replace(/^execute_tool\s+/, '')
    span.toolCallId = asString(a['gen_ai.tool.call.id'])
    const args = a['gen_ai.tool.call.arguments'] ?? a['tool.parameters'] ?? a['input.value']
    span.toolArgsRaw =
      typeof args === 'string' ? args : args === undefined ? undefined : JSON.stringify(args)
    span.toolArgs = typeof args === 'string' ? tryParseJson(args) : args
    const res = a['gen_ai.tool.call.result'] ?? a['output.value']
    span.toolResult = res === undefined ? undefined : contentToText(res)
    if (span.status === 'ok' && looksLikeError(span.toolResult)) {
      span.status = 'error'
      span.error = span.toolResult?.slice(0, 300)
    }
    span.name = span.toolName
  } else if (kind === 'agent') {
    span.name = span.agentName ?? f.name.replace(/^invoke_agent\s+/, '')
  }
  return { span, tools }
}
