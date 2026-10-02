import { describe, expect, it } from 'vitest'
import { loadTrace } from '../engine'
import { detectFormat, importTrace } from '../engine/importers'
import { parseJsonOrJsonl } from '../engine/util'
import { readSample, sample } from './helpers'

const CASES: [string, string][] = [
  ['looping-research.agents-sdk.json', 'openai-agents'],
  ['looping-research-fixed.agents-sdk.json', 'openai-agents'],
  ['triage-pingpong.agents-sdk.jsonl', 'openai-agents'],
  ['coding-agent.anthropic.json', 'anthropic'],
  ['injected-browser.otel.json', 'otel'],
  ['clean-travel.openai-chat.json', 'openai-chat'],
  ['hr-agent.langsmith.json', 'langsmith'],
  ['filesystem.mcp.log', 'mcp'],
  ['refund-support.responses.json', 'openai-responses'],
  ['trip-planner.python-helper.jsonl', 'jsonl'],
]

describe('format detection + import of bundled samples', () => {
  for (const [file, fmt] of CASES) {
    it(`${file} → ${fmt}`, () => {
      expect(detectFormat(parseJsonOrJsonl(readSample(file)))?.format).toBe(fmt)
      const t = sample(file)
      expect(t.format).toBe(fmt)
      expect(t.spans.length).toBeGreaterThan(2)
      expect(
        t.spans.filter((s) => s.kind === 'tool' || s.kind === 'handoff').length,
      ).toBeGreaterThan(0)
      // normalized: exactly one root, every parent exists, DFS index is dense
      const ids = new Set(t.spans.map((s) => s.id))
      expect(t.spans.filter((s) => !s.parentId).length).toBe(1)
      for (const s of t.spans) if (s.parentId) expect(ids.has(s.parentId)).toBe(true)
      t.spans.forEach((s, i) => expect(s.index).toBe(i))
      for (const s of t.spans) expect(s.end).toBeGreaterThanOrEqual(s.start)
    })
  }
})

describe('inline fixtures', () => {
  it('OpenAI chat: bare message array with tool calls and results', () => {
    const t = loadTrace(
      JSON.stringify([
        { role: 'user', content: 'weather in Paris?' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'c1',
              type: 'function',
              function: { name: 'get_weather', arguments: '{"city":"Paris"}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'c1', content: '{"temp":21}' },
        { role: 'assistant', content: 'It is 21°C in Paris.' },
      ]),
    )
    expect(t.format).toBe('openai-chat')
    expect(t.timingEstimated).toBe(true)
    const tool = t.spans.find((s) => s.kind === 'tool')!
    expect(tool.toolName).toBe('get_weather')
    expect(tool.toolArgs).toEqual({ city: 'Paris' })
    expect(tool.toolResult).toContain('21')
    expect(t.finalOutput).toContain('21°C')
  })

  it('OpenAI chat: request/response call log keeps real usage numbers', () => {
    const t = loadTrace(
      JSON.stringify([
        {
          request: { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] },
          response: {
            model: 'gpt-4o',
            choices: [{ message: { role: 'assistant', content: 'hello!' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1234, completion_tokens: 56 },
          },
        },
      ]),
    )
    const llm = t.spans.find((s) => s.kind === 'llm')!
    expect(llm.inputTokens).toBe(1234)
    expect(llm.outputTokens).toBe(56)
    expect(llm.model).toBe('gpt-4o')
  })

  it('Anthropic: tool_use / tool_result blocks and is_error', () => {
    const t = loadTrace(
      JSON.stringify({
        model: 'claude-sonnet-4-5',
        system: 'You are a coding agent.',
        tools: [
          {
            name: 'run_tests',
            description: 'run',
            input_schema: { type: 'object', properties: {} },
          },
        ],
        messages: [
          { role: 'user', content: 'fix the bug' },
          {
            role: 'assistant',
            content: [
              { type: 'text', text: 'running tests' },
              { type: 'tool_use', id: 'tu1', name: 'run_tests', input: {} },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'tu1',
                content: 'FAILED 3 tests',
                is_error: true,
              },
            ],
          },
          { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
        ],
      }),
    )
    expect(t.format).toBe('anthropic')
    expect(t.tools.map((x) => x.name)).toEqual(['run_tests'])
    const tool = t.spans.find((s) => s.kind === 'tool')!
    expect(tool.status).toBe('error')
  })

  it('OTel GenAI flat attributes (OTLP JSON)', () => {
    const attr = (key: string, v: string | number) => ({
      key,
      value: typeof v === 'number' ? { intValue: String(v) } : { stringValue: v },
    })
    const t = loadTrace(
      JSON.stringify({
        resourceSpans: [
          {
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: 'a',
                    spanId: '1',
                    name: 'invoke_agent shop',
                    startTimeUnixNano: '1000000000',
                    endTimeUnixNano: '5000000000',
                    attributes: [attr('gen_ai.operation.name', 'invoke_agent')],
                  },
                  {
                    traceId: 'a',
                    spanId: '2',
                    parentSpanId: '1',
                    name: 'chat gpt-4o',
                    startTimeUnixNano: '1100000000',
                    endTimeUnixNano: '2000000000',
                    attributes: [
                      attr('gen_ai.operation.name', 'chat'),
                      attr('gen_ai.request.model', 'gpt-4o'),
                      attr('gen_ai.usage.input_tokens', 900),
                      attr('gen_ai.usage.output_tokens', 20),
                    ],
                  },
                  {
                    traceId: 'a',
                    spanId: '3',
                    parentSpanId: '1',
                    name: 'execute_tool search',
                    startTimeUnixNano: '2100000000',
                    endTimeUnixNano: '3000000000',
                    attributes: [
                      attr('gen_ai.operation.name', 'execute_tool'),
                      attr('gen_ai.tool.name', 'search'),
                      attr('gen_ai.tool.call.arguments', '{"q":"x"}'),
                    ],
                    status: { code: 2, message: 'boom' },
                  },
                ],
              },
            ],
          },
        ],
      }),
    )
    expect(t.format).toBe('otel')
    expect(t.timingEstimated).toBe(false)
    const llm = t.spans.find((s) => s.kind === 'llm')!
    expect(llm.inputTokens).toBe(900)
    const tool = t.spans.find((s) => s.kind === 'tool')!
    expect(tool.toolName).toBe('search')
    expect(tool.status).toBe('error')
    expect(tool.end - tool.start).toBe(900)
  })

  it('MCP JSON-RPC lines: tools/list declares, tools/call becomes tool spans', () => {
    const lines = [
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      {
        jsonrpc: '2.0',
        id: 1,
        result: {
          tools: [
            {
              name: 'read_file',
              inputSchema: {
                type: 'object',
                properties: { path: { type: 'string' } },
                required: ['path'],
              },
            },
          ],
        },
      },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'read_file', arguments: { path: '/etc/hosts' } },
      },
      {
        jsonrpc: '2.0',
        id: 2,
        result: { content: [{ type: 'text', text: '127.0.0.1 localhost' }] },
      },
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'read_file', arguments: { path: '/nope' } },
      },
      {
        jsonrpc: '2.0',
        id: 3,
        result: { content: [{ type: 'text', text: 'ENOENT' }], isError: true },
      },
    ]
    const t = loadTrace(lines.map((l) => JSON.stringify(l)).join('\n'))
    expect(t.format).toBe('mcp')
    expect(t.tools.map((x) => x.name)).toEqual(['read_file'])
    const tools = t.spans.filter((s) => s.kind === 'tool')
    expect(tools).toHaveLength(2)
    expect(tools[0].toolResult).toContain('localhost')
    expect(tools[1].status).toBe('error')
  })

  it('rejects unrecognised input with a helpful message', () => {
    expect(() => importTrace('{"hello":"world"}')).toThrow(/Unrecognized trace format/)
    expect(() => importTrace('not json at all')).toThrow()
  })

  it('format can be forced explicitly', () => {
    const t = loadTrace(
      JSON.stringify([
        { role: 'user', content: 'x' },
        { role: 'assistant', content: 'y' },
      ]),
      'n',
      'openai-chat',
    )
    expect(t.format).toBe('openai-chat')
  })
})

describe('parseJsonOrJsonl', () => {
  it('parses JSON, JSONL and log lines with a JSON suffix', () => {
    expect(parseJsonOrJsonl('{"a":1}')).toEqual({ a: 1 })
    expect(parseJsonOrJsonl('{"a":1}\n{"a":2}\n')).toEqual([{ a: 1 }, { a: 2 }])
    const parsed = parseJsonOrJsonl(
      '2025-01-01T00:00:00Z [fs] [info] Message from client: {"jsonrpc":"2.0","id":1,"method":"ping"}',
    ) as unknown[]
    expect(Array.isArray(parsed)).toBe(true)
  })
})

describe('cross-language: Python helper output', () => {
  it('trip-planner JSONL written by agent_autopsy.Recorder is fully understood', () => {
    const t = sample('trip-planner.python-helper.jsonl')
    expect(t.spans.some((s) => s.kind === 'agent')).toBe(true)
    expect(t.spans.some((s) => s.kind === 'llm' && (s.inputTokens ?? 0) > 0)).toBe(true)
    expect(t.spans.filter((s) => s.kind === 'tool').every((s) => !!s.toolName)).toBe(true)
    expect(t.tools.length).toBeGreaterThan(0)
    expect(t.finalOutput).toBeTruthy()
  })
})
