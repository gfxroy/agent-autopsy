import { describe, expect, it } from 'vitest'
import { analyze, gradeFor } from '../engine/analyze'
import { diffRuns } from '../engine/diff'
import { buildToolGraph, extractValues } from '../engine/graph'
import { contextWindow, DEFAULT_PRICES, priceFor, spanCost, tokenCost } from '../engine/pricing'
import { redactText, redactTrace } from '../engine/redact'
import { canonicalJson, estimateTokens, fmtMs, fmtUsd, toMs } from '../engine/util'
import { analyzeChat, analyzeSample, chat, fn, sample, say, step, user } from './helpers'

describe('normalize', () => {
  it('synthesizes monotonic timing for message-only formats and marks it estimated', () => {
    const t = chat([user('hi'), step('lookup', { a: 1 }, 'r'), say('done')], [fn('lookup')])
    expect(t.timingEstimated).toBe(true)
    const steps = t.spans.filter((s) => s.parentId)
    for (let i = 1; i < steps.length; i++)
      expect(steps[i].start).toBeGreaterThanOrEqual(steps[i - 1].start)
    expect(t.spans[0].kind).toBe('agent')
  })
  it('estimates token counts where the source has none', () => {
    const t = chat([user('hello '.repeat(400)), say('ok')])
    const llm = t.spans.find((s) => s.kind === 'llm')!
    expect(llm.inputTokens).toBeGreaterThan(300)
  })
  it('falls back to the last assistant text as final output', () => {
    expect(chat([user('q'), say('the final answer')]).finalOutput).toBe('the final answer')
  })
})

describe('pricing', () => {
  it('longest prefix wins and * is the fallback', () => {
    expect(priceFor('gpt-4o-mini-2024-07-18').pattern).toBe('gpt-4o-mini')
    expect(priceFor('gpt-4o-2024-08-06').pattern).toBe('gpt-4o')
    expect(priceFor('openai/gpt-4.1-mini').pattern).toBe('gpt-4.1-mini')
    expect(priceFor('my-local-llama').pattern).toBe('*')
  })
  it('computes token cost with cached input discount', () => {
    const row = { pattern: 'x', input: 2, output: 8, cachedInput: 0.5 }
    const c = tokenCost(1_000_000, 500_000, 400_000, row)
    expect(c.input).toBeCloseTo(0.6 * 2 + 0.4 * 0.5)
    expect(c.output).toBeCloseTo(4)
    expect(c.total).toBeCloseTo(5.4)
  })
  it('custom price tables change totals', () => {
    const t = sample('looping-research.agents-sdk.json')
    const base = analyze(t).totalCost
    const doubled = analyze(
      t,
      DEFAULT_PRICES.map((p) => ({
        ...p,
        input: p.input * 2,
        output: p.output * 2,
        cachedInput: (p.cachedInput ?? p.input) * 2,
      })),
    ).totalCost
    expect(doubled).toBeCloseTo(base * 2, 6)
    const llm = t.spans.find((s) => s.kind === 'llm')!
    expect(spanCost(llm).total).toBeGreaterThan(0)
  })
  it('knows common context windows', () => {
    expect(contextWindow('gpt-4o')).toBe(128_000)
    expect(contextWindow('claude-sonnet-4-5')).toBeGreaterThanOrEqual(200_000)
  })
})

describe('redaction', () => {
  const key = 'sk-' + 'proj-' + 'A1b2C3d4E5f6G7h8I9j0K1l2'
  const gkey = 'AIza' + 'Sy'.padEnd(35, 'x')
  it('removes keys, emails, cards (Luhn), SSNs, phones, bearer tokens', () => {
    const text = `key=${key} gem ${gkey} mail jane.doe@example.com card 4111 1111 1111 1111 ssn 123-45-6789 call +1 415-555-0132 Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456`
    const r = redactText(text)
    expect(r.text).not.toContain(key)
    expect(r.text).not.toContain(gkey)
    expect(r.text).not.toContain('jane.doe@example.com')
    expect(r.text).not.toContain('4111 1111 1111 1111')
    expect(r.text).not.toContain('123-45-6789')
    expect(r.text).not.toContain('555-0132')
    expect(r.text).not.toContain('abcdefghijklmnopqrstuvwxyz123456')
    expect(r.count).toBeGreaterThanOrEqual(7)
  })
  it('keeps numbers that fail Luhn and ordinary text', () => {
    const r = redactText('order 1234 5678 9012 3456 shipped on 2026-01-02 to Paris')
    expect(r.text).toContain('1234 5678 9012 3456')
    expect(r.count).toBe(0)
  })
  it('redactTrace scrubs message content, args and results without mutating the input', () => {
    const t = chat(
      [
        user('my email is a.b@example.org'),
        step('send', { to: 'a.b@example.org' }, 'sent to a.b@example.org'),
        say('done'),
      ],
      [fn('send', { to: { type: 'string' } })],
    )
    const r = redactTrace(t)
    const s = JSON.stringify(r.spans)
    expect(s).not.toContain('a.b@example.org')
    expect(JSON.stringify(t.spans)).toContain('a.b@example.org')
  })
})

describe('analysis & scoring', () => {
  it('grade table boundaries', () => {
    expect(gradeFor(100)).toBe('A+')
    expect(gradeFor(97)).toBe('A+')
    expect(gradeFor(96)).toBe('A')
    expect(gradeFor(50)).toBe('D')
    expect(gradeFor(49)).toBe('F')
  })
  it('healthy run: alive, high IQ, efficient', () => {
    const a = analyzeChat(
      [user('weather?'), step('get_weather', { city: 'Paris' }, '21C'), say('21°C in Paris.')],
      [fn('get_weather', { city: { type: 'string' } }, ['city'])],
    )
    expect(a.verdict.status).toBe('alive')
    expect(a.health).toBeGreaterThanOrEqual(97)
    expect(a.efficiency).toBeGreaterThan(0.9)
    expect(a.iq).toBeGreaterThan(130)
  })
  it('dead run carries killer, time of death and step index', () => {
    const a = analyzeSample('looping-research.agents-sdk.json')
    expect(a.verdict.status).toBe('dead')
    expect(a.verdict.killerSpan).toBeDefined()
    expect(a.verdict.timeOfDeath).toBeGreaterThan(0)
    expect(a.verdict.step).toBeGreaterThan(0)
    expect(a.wastedUsd).toBeGreaterThan(0)
    expect(a.wastedTokens).toBeLessThanOrEqual(a.totalTokens)
    expect(a.grade).toBe('F')
  })
  it('findings are sorted by severity', () => {
    const order = ['critical', 'high', 'medium', 'low', 'info']
    const a = analyzeSample('coding-agent.anthropic.json')
    const idx = a.findings.map((f) => order.indexOf(f.severity))
    expect([...idx].sort((x, y) => x - y)).toEqual(idx)
  })
  it('is deterministic', () => {
    const t = sample('hr-agent.langsmith.json')
    expect(JSON.stringify(analyze(t).findings)).toBe(JSON.stringify(analyze(t).findings))
  })
})

describe('diff', () => {
  it('looping vs fixed: loop fixed, cheaper, healthier', () => {
    const a = analyzeSample('looping-research.agents-sdk.json')
    const b = analyzeSample('looping-research-fixed.agents-sdk.json')
    const d = diffRuns(a, b)
    expect(d.fixed.map((f) => f.rule)).toContain('loop')
    expect(d.introduced).toHaveLength(0)
    const cost = d.metrics.find((m) => m.label === 'Total cost')!
    expect(cost.b).toBeLessThan(cost.a)
    expect(d.verdict).toMatch(/healthier/)
    expect(d.sequence.filter((s) => s.op === 'removed').length).toBeGreaterThan(0)
    expect(d.sequence.some((s) => s.op === 'same')).toBe(true)
  })
})

describe('tool graph lineage', () => {
  it('links a value produced by one tool to the tool that consumed it', () => {
    const a = analyzeChat(
      [
        user('book'),
        step('search_flights', { to: 'NRT' }, '{"flight_id":"FL-88231","price":420}'),
        step('book_flight', { flight_id: 'FL-88231' }, 'booked'),
        say('Booked FL-88231.'),
      ],
      [
        fn('search_flights', { to: { type: 'string' } }),
        fn('book_flight', { flight_id: { type: 'string' } }),
      ],
    )
    const g = buildToolGraph(a.ctx)
    const [s1, s2] = a.ctx.tools
    expect(g.edges.some((e) => e.kind === 'fed' && e.from === s1.id && e.to === s2.id)).toBe(true)
    expect(g.edges.some((e) => e.kind === 'requested' && e.to === s1.id)).toBe(true)
  })
  it('extractValues finds ids, urls, emails and paths', () => {
    const v = extractValues(
      'see https://x.example/a?b=1, mail ops@corp.example, id ORD-12345, file src/app/main.ts',
    )
    expect(v).toEqual(
      expect.arrayContaining([
        'https://x.example/a?b=1',
        'ops@corp.example',
        'ORD-12345',
        'src/app/main.ts',
      ]),
    )
  })
})

describe('util', () => {
  it('canonical JSON is key-order independent', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 1, c: 2 }] })).toBe(
      canonicalJson({ a: [{ c: 2, d: 1 }], b: 1 }),
    )
  })
  it('toMs handles seconds, ms, µs, ns and ISO', () => {
    expect(toMs(1_700_000_000)).toBe(1_700_000_000_000)
    expect(toMs(1_700_000_000_000)).toBe(1_700_000_000_000)
    expect(toMs('1700000000000000000')).toBe(1_700_000_000_000)
    expect(toMs('2026-01-01T00:00:00Z')).toBe(Date.parse('2026-01-01T00:00:00Z'))
  })
  it('formatters', () => {
    expect(fmtMs(850)).toMatch(/850\s?ms/)
    expect(fmtMs(4740)).toBe('4.74s')
    expect(fmtUsd(0.0123)).toMatch(/^\$0\.01/)
    expect(estimateTokens('abcd'.repeat(100))).toBeGreaterThan(80)
  })
})
