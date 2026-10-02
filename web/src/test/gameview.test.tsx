import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GameView } from '../components/GameView'
import { analyze } from '../engine/analyze'
import { buildLevel, dailyPuzzle } from '../game/levels'
import { todayKey } from '../game/rng'
import { emptyProgress } from '../lib/progress'
import { useStore } from '../store'

describe('Spot the Bug UI', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: true,
      media: q,
      addEventListener() {},
      removeEventListener() {},
    }))
    useStore.setState({ progress: emptyProgress() })
  })

  it('daily case: wrong accusation costs a life, the killer span solves it and records progress', () => {
    const d = dailyPuzzle(todayKey())
    const killer = analyze(buildLevel(d.level.bug, d.seed)).verdict.killer!
    render(<GameView />)
    fireEvent.click(screen.getByTestId('start-daily'))
    fireEvent.click(screen.getByTestId('begin-case'))
    const spans = screen.getAllByTestId('case-span')
    const innocent = spans.find(
      (s) => !killer.spanIds.includes(s.dataset.spanId!) && s.dataset.spanId !== killer.spanIds[0],
    )!
    fireEvent.click(innocent)
    fireEvent.click(screen.getByTestId('accuse'))
    expect(screen.getByLabelText('2 lives')).toBeInTheDocument()
    fireEvent.click(
      screen.getAllByTestId('case-span').find((s) => s.dataset.spanId === killer.spanIds[0])!,
    )
    fireEvent.click(screen.getByTestId('accuse'))
    expect(screen.getByTestId('case-result').dataset.won).toBe('true')
    const p = useStore.getState().progress
    expect(p.daily[todayKey()]?.correct).toBe(true)
    expect(p.badges).toContain('daily-doctor')
    expect(p.xp).toBeGreaterThan(0)
  })

  it('campaign: level 2 is locked until level 1 is cleared', () => {
    render(<GameView />)
    expect(screen.getByTestId('level-1')).not.toBeDisabled()
    expect(screen.getByTestId('level-2')).toBeDisabled()
  })
})
