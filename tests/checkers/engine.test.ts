import { describe, expect, it } from 'vitest'
import { apply, nextDeadline, parseAction, parseOptions, setPresence, setup, tick, view, type CheckersState } from '../../src/shared/games/checkers/engine'
import { ABANDON_MS } from '../../src/shared/games/duel'
import type { CheckersAction } from '../../src/shared/games/checkers/types'
import { isGameError, seededRng, type GameCtx } from '../../src/shared/games/types'

const PLAYERS = [
  { playerId: 'a', name: 'Ana' },
  { playerId: 'b', name: 'Bruno' }
]
const T0 = 1_000_000
const ctx = (now = T0): GameCtx => ({ now, rng: seededRng(3) })
const start = (minutes: 0 | 5 = 0, text?: string) => {
  const s = setup(PLAYERS, { minutes }, ctx(), text).state
  return { s, w: s.players.w.playerId, b: s.players.b.playerId }
}
const mv = (...path: string[]): CheckersAction => ({ type: 'move', path })
function act(s: CheckersState, who: string, a: CheckersAction, now = T0): CheckersState {
  const r = apply(s, who, a, ctx(now))
  if (isGameError(r)) throw new Error(r.message)
  return r.state
}

describe('motor das damas', () => {
  it('opções e ações', () => {
    expect(parseOptions(undefined)).toEqual({ minutes: 10 })
    expect(isGameError(parseOptions({ minutes: 3 }))).toBe(true)
    expect(parseAction({ type: 'move', path: ['c3', 'd4'] })).toEqual(mv('c3', 'd4'))
    expect(isGameError(parseAction({ type: 'move', path: ['c3'] }))).toBe(true)
    expect(isGameError(parseAction({ type: 'move', path: ['c3', 'z9'] }))).toBe(true)
  })

  it('brancas começam; só joga na vez; a visão traz os lances legais', () => {
    const { s, w, b } = start()
    expect(isGameError(apply(s, b, mv('b6', 'a5'), ctx()))).toBe(true)
    expect(view(s, w, T0).legal).toHaveLength(7)
    expect(view(s, b, T0).legal).toEqual([])
    const s2 = act(s, w, mv('c3', 'd4'))
    expect(view(s2, null, T0).lastMove?.text).toBe('c3-d4')
    expect(view(s2, b, T0).turn).toBe('b')
  })

  it('recusa lance que deixa de capturar e explica', () => {
    const { s, w } = start(0, '......../......../......../......../...b..../..w...../......../w....... w')
    const r = apply(s, w, mv('a1', 'b2'), ctx())
    expect(isGameError(r) && r.message).toContain('capture')
    expect(view(s, w, T0).mustCapture).toBe(true)
  })

  it('capturar a última peça vence', () => {
    const { s, w } = start(0, '......../......../......../......../...b..../..w...../......../........ w')
    const s2 = act(s, w, mv('c3', 'e5'))
    expect(s2.result).toEqual({ winner: 'w', reason: 'sem-lances' })
    expect(s2.moves[0].pieces).toEqual(['b'])
  })

  it('repetição tripla empata', () => {
    let { s, w, b } = start(0, '.......B/......../......../......../......../......../......../.......W w')
    for (let i = 0; i < 2; i++) {
      s = act(s, w, mv('h1', 'g2'))
      s = act(s, b, mv('h8', 'g7'))
      s = act(s, w, mv('g2', 'h1'))
      s = act(s, b, mv('g7', 'h8'))
    }
    expect(s.result).toEqual({ winner: null, reason: 'repeticao' })
  })

  it('relógio e quem sai da sala', () => {
    let { s, w, b } = start(5)
    expect(nextDeadline(s)).toBe(T0 + 300_000)
    s = act(s, w, mv('c3', 'd4'), T0 + 5000)
    expect(view(s, null, T0 + 5000).clock).toEqual({ w: 295_000, b: 300_000 })
    expect(tick(s, ctx(T0 + 305_000)).state.result).toEqual({ winner: 'w', reason: 'tempo' })
    const gone = setPresence(s, w, false, ctx(T0 + 6000)).state
    expect(nextDeadline(gone)).toBe(T0 + 6000 + ABANDON_MS)
    expect(tick(gone, ctx(T0 + 6000 + ABANDON_MS)).state.result).toEqual({ winner: 'b', reason: 'abandono' })
    void b
  })

  it('empate oferecido e aceito', () => {
    let { s, w, b } = start()
    s = act(s, b, { type: 'draw' })
    expect(act(s, w, { type: 'draw' }).result).toEqual({ winner: null, reason: 'acordo' })
  })
})
