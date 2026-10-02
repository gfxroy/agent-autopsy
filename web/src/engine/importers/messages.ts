/**
 * Shared builder: turn an ordered conversation (system/user/assistant/tool messages) into
 * spans. Used by the OpenAI Chat, Anthropic and Responses importers when the input is a plain
 * transcript with no timings. Timings are synthesized deterministically and flagged.
 */
import type { Message, Span, ToolDef } from '../types'
import { estimateTokens, hash32 } from '../util'

export interface CallMeta {
  model?: string
  inputTokens?: number
  outputTokens?: number
  cachedTokens?: number
  start?: number
  end?: number
  finishReason?: string
}

export function messagesTokens(msgs: Message[]): number {
  let total = 0
  for (const m of msgs) {
    total += 4 + estimateTokens(m.content)
    for (const tc of m.toolCalls ?? [])
      total += 6 + estimateTokens(tc.name) + estimateTokens(tc.argsRaw)
  }
  return total
}

export function toolsTokens(tools: ToolDef[]): number {
  return tools.reduce((s, t) => s + estimateTokens(JSON.stringify(t)), 0)
}

/** Synthetic duration for an LLM call: latency + ~60 tok/s decode. */
export function syntheticLlmMs(inTok: number, outTok: number, seed: string): number {
  return Math.round(350 + inTok * 0.04 + outTok * 16 + (hash32(seed) % 300))
}

export function syntheticToolMs(seed: string, result: string | undefined): number {
  return Math.round(120 + (hash32(seed) % 900) + Math.min(2000, (result?.length ?? 0) / 20))
}

export interface BuildOptions {
  tools: ToolDef[]
  model?: string
  provider?: string
  /** Per-assistant-message metadata (usage/timings), aligned by assistant index. */
  calls?: CallMeta[]
  agentName?: string
  idPrefix?: string
}

export function buildSpansFromMessages(
  messages: Message[],
  opts: BuildOptions,
): { spans: Span[]; finalOutput?: string; timingEstimated: boolean } {
  const prefix = opts.idPrefix ?? 's'
  const spans: Span[] = []
  const rootId = `${prefix}-root`
  const context: Message[] = []
  const toolTok = toolsTokens(opts.tools)
  let t = 0
  let assistantIdx = 0
  let timingEstimated = true
  let finalOutput: string | undefined
  const results = new Map<string, Message>()
  for (const m of messages) if (m.role === 'tool' && m.toolCallId) results.set(m.toolCallId, m)
  const consumed = new Set<string>()

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role !== 'assistant') {
      // Tool results get appended to context as they appear (already represented by tool spans).
      context.push(m)
      continue
    }
    const meta = opts.calls?.[assistantIdx] ?? {}
    const inTok = meta.inputTokens ?? messagesTokens(context) + toolTok
    const outTok = meta.outputTokens ?? messagesTokens([m])
    const estimated = meta.inputTokens === undefined
    let start = t
    let end = t + syntheticLlmMs(inTok, outTok, `${prefix}${i}`)
    if (meta.start !== undefined && meta.end !== undefined) {
      start = meta.start
      end = meta.end
      timingEstimated = false
    }
    const llmId = `${prefix}-llm-${assistantIdx}`
    spans.push({
      id: llmId,
      parentId: rootId,
      kind: 'llm',
      name: meta.model ?? opts.model ?? 'llm',
      start,
      end,
      status: 'ok',
      model: meta.model ?? opts.model,
      provider: opts.provider,
      inputTokens: inTok,
      outputTokens: outTok,
      cachedTokens: meta.cachedTokens,
      tokensEstimated: estimated,
      input: context.slice(),
      output: [m],
      finishReason: meta.finishReason ?? (m.toolCalls?.length ? 'tool_calls' : 'stop'),
      attributes: {},
    })
    t = end
    context.push(m)
    assistantIdx++
    if (!m.toolCalls?.length) {
      if (m.content.trim()) finalOutput = m.content
      continue
    }
    finalOutput = undefined
    for (const tc of m.toolCalls) {
      const res = results.get(tc.id)
      if (res) consumed.add(tc.id)
      const dur = syntheticToolMs(tc.id + tc.name, res?.content)
      const nextAssistantMeta = opts.calls?.[assistantIdx]
      let tStart = t
      let tEnd = t + dur
      if (!timingEstimated && meta.end !== undefined && nextAssistantMeta?.start !== undefined) {
        // Real timings known for LLM calls: tool runs in the gap between them.
        const gap = Math.max(0, nextAssistantMeta.start - meta.end)
        tStart = meta.end
        tEnd = meta.end + gap / Math.max(1, m.toolCalls.length)
      }
      spans.push({
        id: `${prefix}-tool-${tc.id}`,
        parentId: rootId,
        kind: 'tool',
        name: tc.name,
        start: tStart,
        end: tEnd,
        status: res?.isError ? 'error' : 'ok',
        error: res?.isError ? res.content.slice(0, 500) : undefined,
        toolName: tc.name,
        toolCallId: tc.id,
        toolArgs: tc.args,
        toolArgsRaw: tc.argsRaw,
        toolResult: res?.content,
        attributes: res ? {} : { missingResult: true },
      })
      t = tEnd
    }
  }

  const first = spans[0]?.start ?? 0
  const last = spans.reduce((mx, s) => Math.max(mx, s.end), first)
  spans.unshift({
    id: rootId,
    kind: 'agent',
    name: opts.agentName ?? 'agent',
    start: first,
    end: last,
    status: 'ok',
    agentName: opts.agentName,
    attributes: {},
  })
  return { spans, finalOutput, timingEstimated }
}

/** Heuristic: does a tool result look like a failure? */
export function looksLikeError(text: string | undefined): boolean {
  if (!text) return false
  const head = text.slice(0, 400)
  return (
    /^\s*(error|exception|traceback|fatal)\b/i.test(head) ||
    /Traceback \(most recent call last\)/.test(head) ||
    /^\s*\{\s*"error"\s*:/.test(head) ||
    /\b(status(_code)?["']?\s*[:=]\s*["']?(4\d\d|5\d\d))\b/i.test(head) ||
    /\b(HTTP\s+(4\d\d|5\d\d)|timed? ?out|ECONNREFUSED|ENOENT|permission denied|rate limit(ed)?)\b/i.test(
      head,
    )
  )
}
