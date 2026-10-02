/**
 * LangChain / LangSmith runs: run objects with `run_type` (chain, llm, chat_model, tool,
 * retriever, prompt, parser), nested `child_runs` or flat lists linked by `parent_run_id`.
 * LLM inputs/outputs may be serialized LangChain messages (`lc` constructor form) or plain dicts.
 */
import type { Message, Span, SpanKind, ToolDef, Trace } from '../types'
import { asNumber, asString, contentToText, isRecord, toMs, tryParseJson } from '../util'
import { looksLikeError } from './messages'
import { convertChatTools } from './openaiChat'
import type { Importer } from './types'

function isRun(x: unknown): x is Record<string, unknown> {
  return (
    isRecord(x) &&
    typeof x.run_type === 'string' &&
    ('inputs' in x || 'start_time' in x || 'child_runs' in x)
  )
}

function flatten(d: unknown): Record<string, unknown>[] {
  const roots = Array.isArray(d) ? d : isRecord(d) && Array.isArray(d.runs) ? d.runs : [d]
  const out: Record<string, unknown>[] = []
  const walk = (r: unknown, parent?: string) => {
    if (!isRun(r)) return
    out.push(parent && !r.parent_run_id ? { ...r, parent_run_id: parent } : r)
    for (const c of (r.child_runs as unknown[]) ?? []) walk(c, asString(r.id))
  }
  for (const r of roots) walk(r)
  return out
}

const LC_ROLE: Record<string, Message['role']> = {
  human: 'user',
  user: 'user',
  ai: 'assistant',
  assistant: 'assistant',
  system: 'system',
  tool: 'tool',
  function: 'tool',
  HumanMessage: 'user',
  AIMessage: 'assistant',
  AIMessageChunk: 'assistant',
  SystemMessage: 'system',
  ToolMessage: 'tool',
  FunctionMessage: 'tool',
}

export function convertLcMessage(raw: unknown): Message | undefined {
  if (typeof raw === 'string') return { role: 'user', content: raw }
  if (!isRecord(raw)) return undefined
  const kw = isRecord(raw.kwargs) ? raw.kwargs : raw
  const idName = Array.isArray(raw.id) ? String(raw.id[raw.id.length - 1]) : undefined
  const role =
    LC_ROLE[idName ?? ''] ?? LC_ROLE[String(raw.type ?? kw.type ?? raw.role ?? '')] ?? 'user'
  const msg: Message = { role, content: contentToText(kw.content) }
  const calls = Array.isArray(kw.tool_calls)
    ? kw.tool_calls
    : isRecord(kw.additional_kwargs) && Array.isArray(kw.additional_kwargs.tool_calls)
      ? kw.additional_kwargs.tool_calls
      : []
  if (calls.length) {
    msg.toolCalls = calls.filter(isRecord).map((c, i) => {
      if (isRecord(c.function)) {
        const argsRaw = String(c.function.arguments ?? '{}')
        return {
          id: asString(c.id) ?? `call_${i}`,
          name: String(c.function.name),
          argsRaw,
          args: tryParseJson(argsRaw),
        }
      }
      return {
        id: asString(c.id) ?? `call_${i}`,
        name: asString(c.name) ?? 'unknown',
        args: c.args,
        argsRaw: JSON.stringify(c.args ?? {}),
      }
    })
  }
  if (role === 'tool') {
    msg.toolCallId = asString(kw.tool_call_id)
    msg.isError = kw.status === 'error' || looksLikeError(msg.content)
  }
  return msg
}

function llmMessages(inputs: unknown): Message[] | undefined {
  if (!isRecord(inputs)) return undefined
  let msgs = inputs.messages
  if (Array.isArray(msgs) && Array.isArray(msgs[0])) msgs = msgs[0]
  if (Array.isArray(msgs)) return msgs.map(convertLcMessage).filter((m): m is Message => !!m)
  if (Array.isArray(inputs.prompts))
    return inputs.prompts.map((p) => ({ role: 'user' as const, content: String(p) }))
  return undefined
}

function llmOutput(outputs: unknown): {
  messages?: Message[]
  usage: Record<string, number | undefined>
  model?: string
  finish?: string
} {
  const usage: Record<string, number | undefined> = {}
  if (!isRecord(outputs)) return { usage }
  const gens = Array.isArray(outputs.generations)
    ? Array.isArray(outputs.generations[0])
      ? outputs.generations[0]
      : outputs.generations
    : []
  const messages: Message[] = []
  let model: string | undefined
  let finish: string | undefined
  for (const g of gens) {
    if (!isRecord(g)) continue
    const m = g.message
      ? convertLcMessage(g.message)
      : { role: 'assistant' as const, content: String(g.text ?? '') }
    if (m) messages.push({ ...m, role: 'assistant' })
    const kw =
      isRecord(g.message) && isRecord(g.message.kwargs)
        ? g.message.kwargs
        : isRecord(g.message)
          ? g.message
          : {}
    const um = isRecord(kw.usage_metadata) ? kw.usage_metadata : {}
    usage.input = usage.input ?? asNumber(um.input_tokens)
    usage.output = usage.output ?? asNumber(um.output_tokens)
    const rm = isRecord(kw.response_metadata) ? kw.response_metadata : {}
    model = model ?? asString(rm.model_name) ?? asString(rm.model)
    finish =
      finish ??
      asString(rm.finish_reason) ??
      asString(rm.stop_reason) ??
      (isRecord(g.generation_info) ? asString(g.generation_info.finish_reason) : undefined)
  }
  if (isRecord(outputs.llm_output)) {
    const tu = isRecord(outputs.llm_output.token_usage) ? outputs.llm_output.token_usage : {}
    usage.input = usage.input ?? asNumber(tu.prompt_tokens)
    usage.output = usage.output ?? asNumber(tu.completion_tokens)
    model = model ?? asString(outputs.llm_output.model_name)
  }
  return { messages: messages.length ? messages : undefined, usage, model, finish }
}

function kindOf(rt: string): SpanKind {
  if (rt === 'llm' || rt === 'chat_model') return 'llm'
  if (rt === 'tool') return 'tool'
  if (rt === 'retriever') return 'retrieval'
  if (rt === 'chain') return 'chain'
  return 'other'
}

export const langsmithImporter: Importer = {
  id: 'langsmith',
  label: 'LangChain / LangSmith runs',
  detect(d) {
    const runs = flatten(d)
    return runs.length ? 0.97 : 0
  },
  parse(d, name): Trace {
    const runs = flatten(d)
    const tools = new Map<string, ToolDef>()
    const spans: Span[] = []
    let finalOutput: string | undefined
    for (const r of runs) {
      const rt = String(r.run_type)
      const start = toMs(r.start_time) ?? 0
      const end = toMs(r.end_time) ?? start
      const err = asString(r.error) ?? undefined
      const extra = isRecord(r.extra) ? r.extra : {}
      const inv = isRecord(extra.invocation_params) ? extra.invocation_params : {}
      const md = isRecord(extra.metadata) ? extra.metadata : {}
      const span: Span = {
        id: asString(r.id) ?? `run_${spans.length}`,
        parentId: asString(r.parent_run_id) ?? undefined,
        kind: kindOf(rt),
        name: asString(r.name) ?? rt,
        start,
        end,
        status: err ? 'error' : 'ok',
        error: err,
        attributes: { run_type: rt, tags: r.tags },
      }
      if (span.kind === 'llm') {
        const out = llmOutput(r.outputs)
        span.input = llmMessages(r.inputs)
        span.output = out.messages
        span.model =
          asString(inv.model) ?? asString(inv.model_name) ?? asString(md.ls_model_name) ?? out.model
        span.provider = asString(md.ls_provider)
        span.inputTokens = asNumber(r.prompt_tokens) ?? out.usage.input
        span.outputTokens = asNumber(r.completion_tokens) ?? out.usage.output
        span.finishReason = out.finish
        for (const t of convertChatTools(inv.tools)) tools.set(t.name, t)
        const text = out.messages
          ?.filter((m) => !m.toolCalls?.length)
          .map((m) => m.content)
          .join('\n')
        if (out.messages?.some((m) => m.toolCalls?.length)) finalOutput = undefined
        else if (text?.trim()) finalOutput = text
      } else if (span.kind === 'tool') {
        const inputs = isRecord(r.inputs) ? r.inputs : {}
        const rawInput =
          'input' in inputs && Object.keys(inputs).length === 1 ? inputs.input : inputs
        span.toolName = span.name
        span.toolArgsRaw = typeof rawInput === 'string' ? rawInput : JSON.stringify(rawInput)
        span.toolArgs =
          typeof rawInput === 'string' ? (tryParseJson(rawInput) ?? rawInput) : rawInput
        const outputs = isRecord(r.outputs) ? r.outputs : {}
        const o = outputs.output ?? outputs
        span.toolResult =
          isRecord(o) && (o.kwargs || o.lc) ? convertLcMessage(o)?.content : contentToText(o)
        const tcid = isRecord(o) && isRecord(o.kwargs) ? asString(o.kwargs.tool_call_id) : undefined
        if (tcid) span.toolCallId = tcid
        if (!err && looksLikeError(span.toolResult)) {
          span.status = 'error'
          span.error = span.toolResult?.slice(0, 300)
        }
      } else if (span.kind === 'retrieval') {
        span.toolResult = contentToText(
          isRecord(r.outputs) ? (r.outputs.documents ?? r.outputs) : r.outputs,
        )
      }
      if (!span.parentId && span.kind !== 'llm' && span.kind !== 'tool') {
        span.kind = 'agent'
        const out = isRecord(r.outputs) ? r.outputs : {}
        const text = asString(out.output) ?? asString(out.answer) ?? asString(out.text)
        if (text && !finalOutput) finalOutput = text
      }
      spans.push(span)
    }
    // Final answer: prefer the root chain's output when present.
    const root = runs.find((r) => !r.parent_run_id)
    if (root && isRecord(root.outputs)) {
      const o = root.outputs
      const txt = asString(o.output) ?? asString(o.answer)
      if (txt) finalOutput = txt
      else if (Array.isArray(o.messages)) {
        const last = convertLcMessage(o.messages[o.messages.length - 1])
        finalOutput =
          last && last.role === 'assistant' && !last.toolCalls?.length ? last.content : undefined
      }
    }
    return {
      id: '',
      name: name ?? asString(root?.name) ?? 'LangSmith trace',
      format: 'langsmith',
      spans,
      tools: [...tools.values()],
      finalOutput,
      timingEstimated: false,
      meta: { trace_id: root?.trace_id ?? root?.id },
    }
  },
}
