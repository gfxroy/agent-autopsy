/** Build synthetic-but-realistic traces directly in the internal model (used by Spot the Bug). */
import { messagesTokens, toolsTokens } from '../engine/importers/messages'
import { normalizeTrace } from '../engine/normalize'
import type { Message, Span, ToolDef, Trace } from '../engine/types'
import { estimateTokens } from '../engine/util'
import type { Rng } from './rng'

export class TraceBuilder {
  private spans: Span[] = []
  private t = 0
  private ctx: Message[] = []
  private n = 0
  private callN = 0
  private name: string
  private tools: ToolDef[]
  private rng: Rng
  private model: string
  private agent: string
  constructor(name: string, tools: ToolDef[], rng: Rng, model = 'gpt-4o-mini', agent = 'agent') {
    this.name = name
    this.tools = tools
    this.rng = rng
    this.model = model
    this.agent = agent
  }

  system(text: string): this {
    this.ctx.push({ role: 'system', content: text })
    return this
  }
  user(text: string): this {
    this.ctx.push({ role: 'user', content: text })
    return this
  }

  private llm(out: Message, agent?: string): Span {
    const inTok = messagesTokens(this.ctx) + toolsTokens(this.tools)
    const outTok = messagesTokens([out])
    const dur = 350 + Math.round(inTok * 0.03) + outTok * 14 + this.rng.int(0, 400)
    const span: Span = {
      id: `g${++this.n}`,
      parentId: 'root',
      kind: 'llm',
      name: this.model,
      model: this.model,
      start: this.t,
      end: this.t + dur,
      status: 'ok',
      inputTokens: inTok,
      outputTokens: outTok,
      input: this.ctx.slice(),
      output: [out],
      finishReason: out.toolCalls?.length ? 'tool_calls' : 'stop',
      agentName: agent ?? this.agent,
      attributes: {},
    }
    this.spans.push(span)
    this.t += dur + 20
    this.ctx.push(out)
    return span
  }

  /** Model turn requesting one tool call, then the tool executing. Returns the tool span. */
  call(
    name: string,
    args: Record<string, unknown>,
    result: string,
    opts: { error?: boolean; ms?: number } = {},
  ): Span {
    const id = `call_${(++this.callN).toString(36)}${this.rng.int(100, 999)}`
    const argsRaw = JSON.stringify(args)
    this.llm({ role: 'assistant', content: '', toolCalls: [{ id, name, args, argsRaw }] })
    const ms =
      opts.ms ?? 150 + this.rng.int(0, 900) + Math.min(1500, Math.round(estimateTokens(result) / 4))
    const span: Span = {
      id: `t${++this.n}`,
      parentId: 'root',
      kind: 'tool',
      name,
      toolName: name,
      toolCallId: id,
      toolArgs: args,
      toolArgsRaw: argsRaw,
      toolResult: result,
      start: this.t,
      end: this.t + ms,
      status: opts.error ? 'error' : 'ok',
      error: opts.error ? result.slice(0, 200) : undefined,
      attributes: {},
    }
    this.spans.push(span)
    this.t += ms + 15
    this.ctx.push({ role: 'tool', content: result, toolCallId: id, isError: opts.error })
    return span
  }

  answer(text: string): Span {
    return this.llm({ role: 'assistant', content: text })
  }

  handoff(from: string, to: string): Span {
    this.llm(
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: `h${++this.callN}`,
            name: `transfer_to_${to.toLowerCase().replace(/\W+/g, '_')}`,
            args: {},
            argsRaw: '{}',
          },
        ],
      },
      from,
    )
    const span: Span = {
      id: `h${++this.n}`,
      parentId: 'root',
      kind: 'handoff',
      name: `handoff → ${to}`,
      start: this.t,
      end: this.t + 5,
      status: 'ok',
      attributes: { from_agent: from, to_agent: to },
    }
    this.spans.push(span)
    this.t += 25
    return span
  }

  build(id: string, finalOutput?: string): Trace {
    const root: Span = {
      id: 'root',
      kind: 'agent',
      name: this.agent,
      agentName: this.agent,
      start: 0,
      end: this.t,
      status: 'ok',
      attributes: {},
    }
    const lastLlm = [...this.spans].reverse().find((s) => s.kind === 'llm')
    const final =
      finalOutput ??
      (lastLlm && !lastLlm.output?.[0]?.toolCalls?.length
        ? lastLlm.output?.[0]?.content
        : undefined)
    return normalizeTrace(
      {
        id,
        name: this.name,
        format: 'jsonl',
        spans: [root, ...this.spans],
        tools: this.tools,
        finalOutput: final,
        timingEstimated: false,
        meta: { synthetic: true },
      },
      `${this.name}:${this.spans.length}:${this.t}`,
    )
  }
}
