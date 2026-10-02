import { describe, expect, it, vi } from 'vitest'
import { roastFinding, roastHeadline } from '../engine/roast'
import { CAMPAIGN } from '../game/levels'
import { certificateData, drawCertificate, shareText, SITE_URL } from '../lib/certificate'
import {
  BADGES,
  emptyProgress,
  leaderboard,
  onAutopsy,
  onGameResult,
  ProgressTx,
  rankFor,
  RANKS,
  scoreCase,
  starsFor,
} from '../lib/progress'
import { reportHtml, reportMarkdown } from '../lib/report'
import { traceDigest } from '../lib/llm'
import { analyzeChat, analyzeSample, fn, say, step, user } from './helpers'

const win = (over: Partial<Parameters<typeof onGameResult>[1]> = {}) => ({
  mode: 'daily' as const,
  levelId: 1,
  date: '2026-10-03',
  correct: true,
  ms: 20_000,
  wrong: 0,
  hinted: false,
  combo: 1,
  score: 900,
  rule: 'tool-error',
  ...over,
})

describe('progress: XP, ranks, badges, streaks', () => {
  it('ranks go from Intern Coroner to Chief Medical Examiner', () => {
    expect(rankFor(0).title).toBe('Intern Coroner')
    expect(rankFor(RANKS[RANKS.length - 1].xp + 1).title).toBe('Chief Medical Examiner')
    expect(rankFor(150).progress).toBeCloseTo(0.5)
  })
  it('badges are awarded once and grant XP; rank-up emits an event', () => {
    let tx = new ProgressTx(emptyProgress()).badge('roast-master').badge('roast-master')
    expect(tx.p.badges).toEqual(['roast-master'])
    expect(tx.p.xp).toBe(150)
    tx = new ProgressTx(tx.p).xp(200, 'test')
    expect(tx.events.some((e) => e.type === 'rank')).toBe(true)
    expect(BADGES.length).toBeGreaterThanOrEqual(20)
  })
  it('does not mutate the input progress', () => {
    const p = emptyProgress()
    new ProgressTx(p).xp(500, 'x').badge('notary')
    expect(p).toEqual(emptyProgress())
  })
  it('onAutopsy: first autopsy, own trace, polyglot', () => {
    let p = emptyProgress()
    for (const [i, f] of ['openai-chat', 'anthropic', 'otel', 'mcp'].entries())
      p = onAutopsy(p, { id: `t${i}`, format: f, own: i === 0, grade: 'B', efficiency: 0.9 }).p
    expect(p.badges).toEqual(expect.arrayContaining(['first-autopsy', 'own-trace', 'polyglot']))
    const again = onAutopsy(p, {
      id: 't0',
      format: 'openai-chat',
      own: true,
      grade: 'B',
      efficiency: 0.9,
    })
    expect(again.events.filter((e) => e.type === 'xp')).toHaveLength(0)
  })
  it('daily streak counts consecutive days and resets after a gap', () => {
    let p = emptyProgress()
    for (const d of ['2026-10-01', '2026-10-02', '2026-10-03'])
      p = onGameResult(p, win({ date: d })).p
    expect(p.streak.current).toBe(3)
    expect(p.badges).toContain('three-peat')
    p = onGameResult(p, win({ date: '2026-10-06' })).p
    expect(p.streak.current).toBe(1)
    expect(p.streak.best).toBe(3)
    // replaying the same day does not double count
    const again = onGameResult(p, win({ date: '2026-10-06', score: 5000 })).p
    expect(again.daily['2026-10-06'].score).toBe(900)
  })
  it('campaign stars, rule badges and leaderboard', () => {
    let p = emptyProgress()
    for (const l of CAMPAIGN)
      p = onGameResult(
        p,
        win({ mode: 'campaign', levelId: l.id, ms: 5000, rule: l.rule, combo: 5 }),
      ).p
    expect(Object.keys(p.campaign)).toHaveLength(10)
    expect(p.badges).toEqual(
      expect.arrayContaining([
        'board-certified',
        'chief-of-staff',
        'loop-breaker',
        'injection-detective',
        'speed-demon',
        'unstoppable',
      ]),
    )
    const top = leaderboard(p, 'campaign')
    expect(top[0].bot).toBeFalsy()
    expect(top.length).toBeLessThanOrEqual(10)
  })
  it('scoring rewards speed, combos and punishes wrong guesses and hints', () => {
    expect(scoreCase(3, 5_000, 0, false, 1)).toBeGreaterThan(scoreCase(3, 60_000, 0, false, 1))
    expect(
      Math.abs(scoreCase(3, 5_000, 0, false, 3) - scoreCase(3, 5_000, 0, false, 1) * 2),
    ).toBeLessThanOrEqual(20)
    expect(scoreCase(3, 5_000, 2, false, 1)).toBeLessThan(scoreCase(3, 5_000, 0, false, 1))
    expect(scoreCase(3, 5_000, 0, true, 1)).toBeLessThan(scoreCase(3, 5_000, 0, false, 1))
    expect(starsFor(10_000, 0, false)).toBe(3)
    expect(starsFor(50_000, 1, false)).toBe(2)
    expect(starsFor(80_000, 2, true)).toBe(1)
  })
})

describe('roast mode', () => {
  it('is deterministic per finding + seed and fills template vars', () => {
    const a = analyzeSample('looping-research.agents-sdk.json')
    const f = a.verdict.killer!
    expect(roastFinding(f, 'x')).toBe(roastFinding(f, 'x'))
    expect(roastFinding(f, 'x')).not.toMatch(/\{\w+\}/)
    for (const g of a.findings) expect(roastFinding(g, a.trace.id)).not.toMatch(/\{\w+\}/)
    expect(roastHeadline(a)).toBeTruthy()
  })
  it('healthy runs get a (gentle) roast too', () => {
    const a = analyzeChat([user('hi'), step('ping', {}, 'pong'), say('pong')], [fn('ping')])
    expect(roastHeadline(a)).toMatch(/\w/)
  })
})

describe('death certificate', () => {
  it('is always redacted and has share text with the site link', () => {
    const a = analyzeChat(
      [
        user('email me at boss@corp.example'),
        ...Array.from({ length: 5 }, () => step('lookup_boss@corp.example', { q: 'x' }, 'r')),
        say('ok'),
      ],
      [fn('lookup')],
    )
    const d = certificateData(a, 'Dr. Test', new Date(2026, 9, 3))
    expect(JSON.stringify(d)).not.toContain('boss@corp.example')
    expect(d.date).toBe('2026-10-03')
    expect(d.status).toBe('dead')
    const text = shareText(d)
    expect(text).toContain(SITE_URL)
    expect(text).toContain(d.grade)
    expect(text.length).toBeLessThan(500)
  })
  it('alive runs get a survival certificate', () => {
    const d = certificateData(analyzeSample('clean-travel.openai-chat.json'), 'x')
    expect(d.status).toBe('alive')
    expect(shareText(d)).toMatch(/ALIVE/)
  })
  it('drawCertificate degrades gracefully without a 2D context', () => {
    const c = document.createElement('canvas')
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    expect(
      drawCertificate(c, certificateData(analyzeSample('looping-research.agents-sdk.json'), 'x')),
    ).toBe(false)
    expect(
      typeof drawCertificate(
        c,
        certificateData(analyzeSample('looping-research.agents-sdk.json'), 'x'),
      ),
    ).toBe('boolean')
  })
})

describe('reports & LLM digest', () => {
  it('markdown/html reports include verdict and findings; redaction option works', () => {
    const a = analyzeChat(
      [
        user('contact me: jane@corp.example'),
        step('fetch', { u: 1 }, 'Error: 500'),
        step('fetch', { u: 2 }, 'Error: 500'),
        say("I'm sorry, I couldn't complete it."),
      ],
      [fn('fetch')],
    )
    const md = reportMarkdown(a, { redact: true, roast: true })
    expect(md).toContain('Agent Autopsy')
    expect(md).toContain(a.grade)
    expect(md).not.toContain('jane@corp.example')
    expect(reportHtml(a, { redact: false, roast: false })).toContain('<html')
  })
  it('the LLM digest is compact and redacted', () => {
    const a = analyzeChat([user('my key is ' + 'sk-' + 'x'.repeat(30)), say('ok')])
    const dg = traceDigest(a)
    expect(dg).not.toContain('x'.repeat(30))
    expect(dg.length).toBeLessThan(8000)
  })
})
