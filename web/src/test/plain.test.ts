import { describe, expect, it, vi } from 'vitest'
import { certificateData, drawCertificate, localDate } from '../lib/certificate'
import {
  causeSentence,
  errorSummary,
  plainReport,
  plainSteps,
  reportText,
  topFixes,
} from '../lib/plain'
import { SAMPLES } from '../lib/samples'
import { analyzeChat, analyzeSample, fn, say, step, user } from './helpers'
import { readdirSync } from 'node:fs'
import { SAMPLE_DIR } from './helpers'

const JARGON = /\b(span|token|llm|rule|finding|severity|enum|schema|args?|json)\b|`|\{\w+\}/i

describe('plain-English report', () => {
  for (const file of readdirSync(SAMPLE_DIR)) {
    it(`${file}: grade, one-sentence cause, steps, 1–3 fixes, no jargon`, () => {
      const a = analyzeSample(file)
      const r = plainReport(a)
      expect(r.grade).toMatch(/^[A-DF][+-]?$/)
      expect(r.cause).toMatch(/^[A-Z].*\.$/)
      expect(r.cause.split(/(?<=\.)\s+(?=[A-Z])/).length).toBeLessThanOrEqual(2)
      expect(r.cause).not.toMatch(JARGON)
      expect(r.steps.length).toBeGreaterThan(0)
      r.steps.forEach((s, i) => expect(s.n).toBe(i + 1))
      for (const f of r.fixes) expect(f).not.toMatch(/`|\{\w+\}/)
      if (a.verdict.status === 'alive') {
        expect(r.fixes).toHaveLength(0)
        expect(r.steps.some((s) => s.failed)).toBe(false)
      } else {
        expect(r.fixes.length).toBeGreaterThanOrEqual(1)
        expect(r.fixes.length).toBeLessThanOrEqual(3)
        expect(r.failedStep).toBeGreaterThan(0)
      }
    })
  }

  it('the three UI samples exist and are failures with a marked step', () => {
    expect(SAMPLES).toHaveLength(3)
    for (const s of SAMPLES) {
      const r = plainReport(analyzeSample(s.file))
      expect(r.status).toBe('failed')
      expect(r.steps.filter((x) => x.failed).length).toBeGreaterThan(0)
    }
  })

  it('loop: cause names the tool and the repeat count; the repeated calls are marked', () => {
    const a = analyzeChat(
      [
        user('find X'),
        ...Array.from({ length: 4 }, () => step('web_search', { query: 'X' }, 'nothing')),
        say('Here.'),
      ],
      [fn('web_search', { query: { type: 'string' } })],
    )
    expect(causeSentence(a)).toBe(
      'The agent got stuck in a loop, calling web_search 4 times with exactly the same input.',
    )
    const steps = plainSteps(a)
    expect(steps.filter((s) => s.failed)).toHaveLength(4)
    expect(steps.find((s) => s.failed)!.text).toBe('Used web_search with “X”')
    expect(topFixes(a)[0]).toMatch(/web_search/)
  })

  it('tool failure reads naturally and the error line is summarized', () => {
    const a = analyzeChat(
      [
        user('x'),
        step(
          'fetch_url',
          { url: 'https://a.example' },
          'Traceback...\nline 2\nTimeoutError: upstream timed out',
        ),
        step('fetch_url', { url: 'https://b.example' }, 'Error: 503'),
        say("I'm sorry, but I couldn't complete the task."),
      ],
      [fn('fetch_url', { url: { type: 'string' } })],
    )
    const steps = plainSteps(a)
    const failed = steps.filter((s) => s.text.endsWith('it failed'))
    expect(failed.length).toBe(2)
    expect(failed[0].detail).toBe('TimeoutError: upstream timed out')
  })

  it('healthy run says so', () => {
    const a = analyzeChat(
      [
        user('weather?'),
        step('get_weather', { city: 'Paris' }, '21C'),
        say('It is 21°C in Paris.'),
      ],
      [fn('get_weather', { city: { type: 'string' } }, ['city'])],
    )
    const r = plainReport(a)
    expect(r.cause).toBe('Nothing went wrong. The agent finished the task cleanly.')
    expect(r.statusLabel).toBe('Healthy')
    expect(r.steps.map((s) => s.text)).toEqual([
      'Decided to use get_weather',
      'Used get_weather with “Paris”',
      'Wrote the final answer',
    ])
  })

  it('handoff pseudo-tools are described as handing over the task', () => {
    const r = plainReport(analyzeSample('triage-pingpong.agents-sdk.jsonl'))
    expect(r.steps[0].text).toBe('Decided to hand the task to billing agent')
    expect(r.cause).toMatch(/handing the task back and forth/)
  })

  it('copied report is plain text and redacted', () => {
    const a = analyzeChat(
      [
        user('mail me at jane@corp.example'),
        ...Array.from({ length: 3 }, () => step('send_email', { to: 'jane@corp.example' }, 'ok')),
        say('done'),
      ],
      [fn('send_email', { to: { type: 'string' } })],
    )
    const t = reportText(plainReport(a), 'https://example.test/')
    expect(t).toContain('Grade:')
    expect(t).toContain('What happened:')
    expect(t).toContain('Examined with https://example.test/')
    expect(t).not.toContain('jane@corp.example')
  })

  it('errorSummary picks the informative line', () => {
    expect(errorSummary('=====\ncollected 4\nE   AssertionError: boom\n=====')).toBe(
      'AssertionError: boom',
    )
    expect(errorSummary('just text')).toBe('just text')
    expect(errorSummary(undefined)).toBeUndefined()
  })
})

describe('death certificate', () => {
  it('is redacted, plain English and dated locally', () => {
    const a = analyzeChat(
      [
        user('x'),
        ...Array.from({ length: 5 }, () => step('lookup', { q: 'boss@corp.example' }, 'r')),
        say('ok'),
      ],
      [fn('lookup', { q: { type: 'string' } })],
    )
    const d = certificateData(a, new Date(2026, 9, 3, 1, 30))
    expect(JSON.stringify(d)).not.toContain('boss@corp.example')
    expect(d.title).toBe('Certificate of Death')
    expect(d.date).toBe('2026-10-03')
    expect(d.cause).toMatch(/stuck in a loop/)
    expect(d.failingStep).toMatch(/^Step \d+ of \d+: /)
    expect(localDate(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
  it('healthy runs get a certificate of health', () => {
    const d = certificateData(analyzeSample('clean-travel.openai-chat.json'))
    expect(d.title).toBe('Certificate of Health')
    expect(d.failingStep).toMatch(/^None/)
  })
  it('returns false without a 2D context', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    expect(
      drawCertificate(
        document.createElement('canvas'),
        certificateData(analyzeSample('looping-research.agents-sdk.json')),
      ),
    ).toBe(false)
    vi.restoreAllMocks()
  })
})
