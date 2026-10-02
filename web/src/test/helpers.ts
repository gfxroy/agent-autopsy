import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { analyze } from '../engine/analyze'
import { loadTrace } from '../engine'
import type { ToolDef } from '../engine/types'

export const SAMPLE_DIR = resolve(__dirname, '../../public/samples')
export const readSample = (file: string) => readFileSync(resolve(SAMPLE_DIR, file), 'utf8')
export const sample = (file: string) => loadTrace(readSample(file), file)
export const analyzeSample = (file: string) => analyze(sample(file))

export const fn = (
  name: string,
  properties: Record<string, unknown> = {},
  required: string[] = [],
): ToolDef & { type: string; function: unknown } =>
  ({
    type: 'function',
    function: { name, description: name, parameters: { type: 'object', properties, required } },
  }) as never

let callN = 0
/** OpenAI-chat style helpers to build small fixtures quickly. */
export const user = (content: string) => ({ role: 'user', content })
export const sys = (content: string) => ({ role: 'system', content })
export const say = (content: string) => ({ role: 'assistant', content })
export function call(name: string, args: unknown, id = `call_${++callN}`) {
  return {
    msg: {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id,
          type: 'function',
          function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) },
        },
      ],
    },
    result: (content: string) => ({ role: 'tool', tool_call_id: id, content }),
  }
}
/** call + result as two messages */
export function step(name: string, args: unknown, result: string) {
  const c = call(name, args)
  return [c.msg, c.result(result)]
}

export function chat(messages: unknown[], tools: unknown[] = [], model = 'gpt-4o-mini') {
  return loadTrace(JSON.stringify({ model, tools, messages: messages.flat() }), 'fixture')
}
export const analyzeChat = (messages: unknown[], tools: unknown[] = [], model?: string) =>
  analyze(chat(messages, tools, model))
export const rules = (a: ReturnType<typeof analyze>) => a.findings.map((f) => f.rule)
