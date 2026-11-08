import { describe, expect, it } from 'vitest'
import { apply, nextDeadline, parseAction, parseOptions, setPresence, setup, tick, view, type ChessState } from '../../src/shared/games/chess/engine'
import { ABANDON_MS, type ChessAction } from '../../src/shared/games/chess/types'
import { isGameError, seededRng, type GameCtx } from '../../src/shared/games/types'

const PLAYERS = [
  { playerId: 'a', name: 'Ana' },
  { playerId: 'b', name: 'Bruno' }
]
const T0 = 1_000_000
const ctx = (now = T0): GameCtx => ({ now, rng: seededRng(7) })

function start(minutes: 0 | 5 = 0, fen?: string) {
  const s = setup(PLAYERS, { minutes }, ctx(), fen).state
  return { s, w: s.players.w.playerId, b: s.players.b.playerId }
}

function act(s: ChessState, who: string, a: ChessAction, now = T0): ChessState {
  const r = apply(s, who, a, ctx(now))
  if (isGameError(r)) throw new Error(r.message)
  return r.state
}
const mv = (from: string, to: string, promo?: 'q' | 'n'): ChessAction => ({ type: 'move', from, to, ...(promo ? { promo } : {}) })

describe('motor do xadrez', () => {
  it('opções e ações', () => {
    expect(parseOptions(undefined)).toEqual({ minutes: 10 })
    expect(parseOptions({ minutes: 5 })).toEqual({ minutes: 5 })
    expect(isGameError(parseOptions({ minutes: 7 }))).toBe(true)
    expect(parseAction({ type: 'move', from: 'e2', to: 'e4' })).toEqual(mv('e2', 'e4'))
    expect(isGameError(parseAction({ type: 'move', from: 'e2', to: 'e9' }))).toBe(true)
    expect(isGameError(parseAction({ type: 'move', from: 'e7', to: 'e8', promo: 'k' }))).toBe(true)
  })

  it('sorteia as cores e só deixa jogar na vez', () => {
    const { s, w, b } = start()
    expect([w, b].sort()).toEqual(['a', 'b'])
    expect(isGameError(apply(s, b, mv('e7', 'e5'), ctx()))).toBe(true)
    expect(isGameError(apply(s, w, mv('e2', 'e5'), ctx()))).toBe(true)
    const s2 = act(s, w, mv('e2', 'e4'))
    const v = view(s2, b, T0)
    expect(v.turn).toBe('b')
    expect(v.you?.color).toBe('b')
    expect(v.legal['e7']).toEqual(expect.arrayContaining(['e6', 'e5']))
    expect(view(s2, w, T0).legal).toEqual({})
    expect(v.moves.map((m) => m.san)).toEqual(['e4'])
  })

  it('mate do pastor encerra a partida', () => {
    let { s, w, b } = start()
    s = act(s, w, mv('e2', 'e4'))
    s = act(s, b, mv('e7', 'e5'))
    s = act(s, w, mv('f1', 'c4'))
    s = act(s, b, mv('b8', 'c6'))
    s = act(s, w, mv('d1', 'h5'))
    s = act(s, b, mv('g8', 'f6'))
    const r = apply(s, w, mv('h5', 'f7'), ctx())
    if (isGameError(r)) throw new Error(r.message)
    expect(r.state.result).toEqual({ winner: 'w', reason: 'mate' })
    expect(r.events.at(-1)).toEqual({ type: 'end', result: { winner: 'w', reason: 'mate' } })
    expect(view(r.state, null, T0).check).toBe('e8')
    expect(isGameError(apply(r.state, b, { type: 'resign' }, ctx()))).toBe(true)
  })

  it('promoção escolhe a peça (dama por padrão)', () => {
    const { s, w } = start(0, '8/P6k/8/8/8/8/8/K7 w - - 0 1')
    expect(act(s, w, mv('a7', 'a8')).pos.board[56]).toBe('Q')
    expect(act(s, w, mv('a7', 'a8', 'n')).pos.board[56]).toBe('N')
  })

  it('empate por oferta, recusa e repetição', () => {
    let { s, w, b } = start()
    s = act(s, w, { type: 'draw' })
    expect(isGameError(apply(s, w, { type: 'draw' }, ctx()))).toBe(true)
    s = act(s, b, { type: 'decline' })
    expect(s.drawOffer).toBeNull()
    s = act(s, w, { type: 'draw' })
    expect(act(s, b, { type: 'draw' }).result).toEqual({ winner: null, reason: 'acordo' })
    // repetição tripla: cavalos vão e voltam
    ;({ s } = start())
    for (let i = 0; i < 2; i++) {
      s = act(s, w, mv('g1', 'f3'))
      s = act(s, b, mv('g8', 'f6'))
      s = act(s, w, mv('f3', 'g1'))
      s = act(s, b, mv('f6', 'g8'))
    }
    expect(s.result).toEqual({ winner: null, reason: 'repeticao' })
  })

  it('afogado e material insuficiente', () => {
    const st = start(0, 'k7/8/1Q6/8/8/8/8/7K w - - 0 1')
    expect(act(st.s, st.w, mv('b6', 'c7')).result).toEqual({ winner: null, reason: 'afogado' })
    const mat = start(0, 'k7/8/8/8/8/8/1r6/K7 w - - 0 1')
    expect(act(mat.s, mat.w, mv('a1', 'b2')).result).toEqual({ winner: null, reason: 'material' })
  })

  it('relógio: desconta o tempo e perde quem estoura', () => {
    let { s, w, b } = start(5)
    expect(nextDeadline(s)).toBe(T0 + 300_000)
    s = act(s, w, mv('e2', 'e4'), T0 + 10_000)
    expect(view(s, null, T0 + 10_000).clock).toEqual({ w: 290_000, b: 300_000 })
    expect(nextDeadline(s)).toBe(T0 + 310_000)
    expect(view(s, null, T0 + 20_000).clock).toEqual({ w: 290_000, b: 290_000 })
    // lance que chega depois do tempo vira derrota por tempo
    const late = apply(s, b, mv('e7', 'e5'), ctx(T0 + 400_000))
    if (isGameError(late)) throw new Error(late.message)
    expect(late.state.result).toEqual({ winner: 'w', reason: 'tempo' })
    const t = tick(s, ctx(T0 + 310_000))
    expect(t.state.result).toEqual({ winner: 'w', reason: 'tempo' })
    expect(nextDeadline(t.state)).toBeNull()
    void b
  })

  it('estourar o tempo contra quem só tem o rei é empate', () => {
    const { s } = start(5, 'k7/8/8/8/8/8/8/KQ6 w - - 0 1')
    expect(tick(s, ctx(T0 + 300_000)).state.result).toEqual({ winner: null, reason: 'tempo' })
  })

  it('quem sai da sala e não volta perde', () => {
    let { s, w, b } = start()
    expect(nextDeadline(s)).toBeNull()
    s = setPresence(s, b, false, ctx(T0)).state
    expect(view(s, w, T0).black.awayUntil).toBe(T0 + ABANDON_MS)
    expect(nextDeadline(s)).toBe(T0 + ABANDON_MS)
    const back = setPresence(s, b, true, ctx(T0 + 1000)).state
    expect(nextDeadline(back)).toBeNull()
    expect(tick(s, ctx(T0 + ABANDON_MS)).state.result).toEqual({ winner: 'w', reason: 'abandono' })
  })
})
