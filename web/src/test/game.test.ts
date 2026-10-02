import { describe, expect, it } from 'vitest'
import { analyze } from '../engine/analyze'
import { buildLevel, CAMPAIGN, campaignSeed, dailyPuzzle } from '../game/levels'
import { dateSeed, Rng, todayKey } from '../game/rng'

describe('Spot the Bug levels', () => {
  for (const level of CAMPAIGN) {
    it(`level ${level.id} (${level.bug}): engine's killer is the planted bug for 40 seeds`, () => {
      for (let seed = 1; seed <= 40; seed++) {
        const trace = buildLevel(level.bug, seed * 31 + level.id)
        const a = analyze(trace)
        expect(
          a.verdict.killer?.rule,
          `seed ${seed}: ${a.findings.map((f) => `${f.severity}:${f.rule}`).join(', ')}`,
        ).toBe(level.rule)
        expect(a.verdict.killer!.spanIds.length).toBeGreaterThan(0)
        expect(a.verdict.status).toBe('dead')
      }
    })
  }

  it('campaign levels are deterministic', () => {
    const a = buildLevel('trojan-page', campaignSeed(5))
    const b = buildLevel('trojan-page', campaignSeed(5))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('daily puzzle is date-seeded and stable', () => {
    expect(dailyPuzzle('2026-10-03')).toEqual(dailyPuzzle('2026-10-03'))
    expect(dateSeed('2026-10-03')).not.toBe(dateSeed('2026-10-04'))
    const levels = new Set(
      Array.from(
        { length: 60 },
        (_, i) => dailyPuzzle(`2026-11-${String((i % 28) + 1).padStart(2, '0')}`).level.id,
      ),
    )
    expect(levels.size).toBeGreaterThan(4)
  })

  it('rng helpers', () => {
    const r = new Rng(42)
    const xs = Array.from({ length: 100 }, () => r.int(1, 3))
    expect(Math.min(...xs)).toBe(1)
    expect(Math.max(...xs)).toBe(3)
    expect(todayKey(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})
