import { describe, expect, it } from 'vitest'
import { apply, autoShot, nextDeadline, setPresence, setup, tick, view, type PoolState } from '../../src/shared/games/pool/engine'
import type { PBall } from '../../src/shared/games/pool/physics'
import { rack } from '../../src/shared/games/pool/rules'
import { AWAY_MS, SHOT_MS, type PoolAction } from '../../src/shared/games/pool/types'
import { isGameError, seededRng, type GameCtx } from '../../src/shared/games/types'

const T0 = 1_000_000
const ctx = (now = T0): GameCtx => ({ now, rng: seededRng(2) })
const PLAYERS = [
  { playerId: 'a', name: 'Ana' },
  { playerId: 'b', name: 'Bia' }
]
const ball = (id: number, x: number, y: number): PBall => ({ id, x, y, vx: 0, vy: 0, in: false })

/** mesa já quebrada, Ana na vez, bolas combinadas (as que faltarem estão na caçapa) */
function table(balls: PBall[], groups: [string | null, string | null] = ['lisas', 'listradas']): PoolState {
  const s = setup(PLAYERS, {}, ctx()).state
  const all = Array.from({ length: 16 }, (_, id) => balls.find((b) => b.id === id) ?? { ...ball(id, 0, 0), in: true })
  s.balls = all
  s.broken = true
  s.ballInHand = false
  s.turn = 0
  s.players[0].group = groups[0] as never
  s.players[1].group = groups[1] as never
  return s
}
function shoot(s: PoolState, who: string, a: Omit<PoolAction, 'type' | 'ref'>, now = T0) {
  const r = apply(s, who, { type: 'shoot', ref: s.ref, ...a }, ctx(now))
  if (isGameError(r)) throw new Error(r.message)
  return r
}
// bolas paradas longe de tudo, para não atrapalhar
const PARK = [ball(2, 60, 45), ball(10, 70, 45)]

describe('regras da bola 8', () => {
  it('armação: 15 bolas no triângulo, a 8 no meio e um canto de cada grupo', () => {
    const r = rack(seededRng(5))
    expect(r).toHaveLength(16)
    expect(new Set(r.map((b) => b.id)).size).toBe(16)
    const objs = r.slice(1)
    const eight = objs.find((b) => b.id === 8)!
    expect(objs[4].id).toBe(8)
    expect(eight.x).toBeGreaterThan(75)
    const corners = [objs[10].id, objs[14].id].sort((x, y) => x - y)
    expect(corners[0]).toBeLessThan(8)
    expect(corners[1]).toBeGreaterThan(8)
  })

  it('quebra: branca só atrás da linha; a mesa fica aberta mesmo encaçapando', () => {
    const s = setup(PLAYERS, {}, ctx()).state
    const who = s.players[s.turn].playerId
    expect(view(s, who, T0)).toMatchObject({ ballInHand: true, behindLine: true })
    expect(isGameError(apply(s, who, { type: 'shoot', dx: 1, dy: 0, power: 1, cue: { x: 40, y: 25 }, ref: 0 }, ctx()))).toBe(true)
    const r = shoot(s, who, { dx: 1, dy: 0.01, power: 1, cue: { x: 20, y: 25 } })
    expect(r.state.broken).toBe(true)
    expect(r.state.players.every((p) => p.group === null)).toBe(true)
    expect(r.state.shot?.before.find((b) => b.id === 0)).toMatchObject({ x: 20, y: 25 })
  })

  it('primeira bola encaçapada sem falta define os grupos e quem encaçapa continua', () => {
    const s = table([ball(0, 20, 20), ball(3, 10, 10), ...PARK, ball(8, 50, 40)], [null, null])
    const r = shoot(s, 'a', { dx: -1, dy: -1, power: 0.5 })
    expect(r.state.players.map((p) => p.group)).toEqual(['lisas', 'listradas'])
    expect(r.state.turn).toBe(0)
    expect(r.events).toContainEqual({ type: 'groups', by: 0, group: 'lisas' })
  })

  it('errou: passa a vez sem bola na mão', () => {
    const s = table([ball(0, 20, 25), ball(3, 40, 25), ...PARK, ball(8, 50, 40)])
    const r = shoot(s, 'a', { dx: 1, dy: 0, power: 0.4 })
    expect(r.state.foul).toBeNull()
    expect(r.state.turn).toBe(1)
    expect(r.state.ballInHand).toBe(false)
  })

  it('falta: branca na caçapa dá bola na mão e a branca volta para a mesa', () => {
    const s = table([ball(0, 10, 10), ...PARK, ball(8, 50, 40)])
    const r = shoot(s, 'a', { dx: -1, dy: -1, power: 0.4 })
    expect(r.state.foul).toContain('branca')
    expect(r.state.turn).toBe(1)
    expect(r.state.ballInHand).toBe(true)
    expect(r.state.balls.find((b) => b.id === 0)?.in).toBe(false)
    // com bola na mão, a Bia põe a branca onde quiser
    expect(isGameError(apply(r.state, 'b', { type: 'shoot', dx: 1, dy: 0, power: 0.2, cue: { x: 80, y: 10 }, ref: r.state.ref }, ctx()))).toBe(false)
  })

  it('falta: tocar primeiro na bola do outro grupo', () => {
    const s = table([ball(0, 20, 25), ball(12, 40, 25), ...PARK, ball(8, 50, 40)])
    const r = shoot(s, 'a', { dx: 1, dy: 0, power: 0.3 })
    expect(r.state.foul).toContain('outro grupo')
  })

  it('falta: nenhuma bola na tabela depois do toque', () => {
    const s = table([ball(0, 30, 25), ball(3, 32.5, 25), ...PARK, ball(8, 50, 40)])
    const r = shoot(s, 'a', { dx: 1, dy: 0, power: 0 })
    expect(r.state.foul).toContain('tabela')
  })

  it('a 8: com o grupo limpo e a caçapa escolhida, vence', () => {
    const s = table([ball(0, 20, 20), ball(8, 10, 10), ball(10, 70, 45)])
    expect(view(s, 'a', T0).onEight).toBe(true)
    expect(isGameError(apply(s, 'a', { type: 'shoot', dx: -1, dy: -1, power: 0.5, ref: 0 }, ctx()))).toBe(true) // sem caçapa
    const r = shoot(s, 'a', { dx: -1, dy: -1, power: 0.5, pocket: 0 })
    expect(r.state.winner).toBe(0)
    expect(nextDeadline(r.state)).toBeNull()
  })

  it('a 8 na caçapa errada ou antes da hora perde', () => {
    const wrong = shoot(table([ball(0, 20, 20), ball(8, 10, 10), ball(10, 70, 45)]), 'a', { dx: -1, dy: -1, power: 0.5, pocket: 5 })
    expect(wrong.state.winner).toBe(1)
    const early = shoot(table([ball(0, 20, 20), ball(8, 10, 10), ...PARK]), 'a', { dx: -1, dy: -1, power: 0.5 })
    expect(early.state.winner).toBe(1)
  })

  it('tacada atrasada (ref velho) é recusada; fora da vez também', () => {
    const s = table([ball(0, 20, 25), ball(3, 40, 25), ...PARK, ball(8, 50, 40)])
    expect(isGameError(apply(s, 'a', { type: 'shoot', dx: 1, dy: 0, power: 0.3, ref: 5 }, ctx()))).toBe(true)
    expect(isGameError(apply(s, 'b', { type: 'shoot', dx: 1, dy: 0, power: 0.3, ref: 0 }, ctx()))).toBe(true)
  })

  it('prazo estourado: o jogo taca por você; quem sai da sala joga rápido', () => {
    const s = table([ball(0, 20, 25), ball(3, 40, 25), ...PARK, ball(8, 50, 40)])
    expect(nextDeadline(s)).toBe(T0 + SHOT_MS)
    expect(autoShot(s).dx).toBeGreaterThan(0)
    const t = tick(s, ctx(T0 + SHOT_MS)).state
    expect(t.ref).toBe(1)
    expect(setPresence(s, 'a', false, ctx(T0 + 10)).state.until).toBe(T0 + 10 + AWAY_MS)
  })
})
