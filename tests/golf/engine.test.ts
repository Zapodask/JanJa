import { describe, expect, it } from 'vitest'
import { buildCourse } from '../../src/shared/games/golf/course'
import { apply, nextDeadline, parseAction, parseOptions, setPresence, setup, tick, view, type GolfState } from '../../src/shared/games/golf/engine'
import { MAPS } from '../../src/shared/games/golf/maps'
import { advance, shotVelocity } from '../../src/shared/games/golf/physics'
import { BREAK_MS, type GolfAction, type GolfEvent } from '../../src/shared/games/golf/types'
import { isGameError, seededRng, type GameCtx } from '../../src/shared/games/types'

const T0 = 1_000_000
const ctx = (now: number): GameCtx => ({ now, rng: seededRng(1) })
const players = [
  { playerId: 'a', name: 'Ana' },
  { playerId: 'b', name: 'Bia' }
]
const UP = -Math.PI / 2

/** força que acerta o buraco reto (Quintal 1) direto da saída */
function holeInOnePower(): number {
  const c = buildCourse(MAPS[0].holes[0])
  for (let p = 0; p <= 1; p += 0.01) {
    const v = shotVelocity(UP, p)
    const w = advance(c, { t0: 0, balls: [{ playerId: 'x', x: c.tee.x, z: c.tee.z, vx: v.vx, vz: v.vz, mode: 'roll', lx: 0, lz: 0, splash: 0, live: true, age: 0 }] }, 30_000, true)
    if (w.balls[0].mode === 'cup') return p
  }
  throw new Error('sem força que acerte')
}

const shot = (s: GolfState, playerId: string, power: number, angle = UP): GolfAction => ({
  type: 'shot',
  hole: s.hole,
  stroke: view(s, playerId, 0).players.find((p) => p.playerId === playerId)!.strokes,
  angle,
  power
})

function ok(s: GolfState, playerId: string, a: GolfAction, now: number): { state: GolfState; events: GolfEvent[] } {
  const r = apply(s, playerId, a, ctx(now))
  if (isGameError(r)) throw new Error(r.message)
  return r
}

/** roda os prazos até `until` */
function runUntil(s: GolfState, until: number): { state: GolfState; events: GolfEvent[] } {
  const events: GolfEvent[] = []
  for (let i = 0; i < 200; i++) {
    const d = nextDeadline(s)
    if (d === null || d > until) break
    const r = tick(s, ctx(d))
    s = r.state
    events.push(...r.events)
  }
  return { state: s, events }
}

describe('motor do golfe', () => {
  it('opções: padrão, mapa desconhecido e tempo inválido', () => {
    expect(parseOptions(undefined)).toEqual({ mapId: 'quintal', collisions: true, holeSeconds: 90 })
    expect(isGameError(parseOptions({ mapId: 'lua' }))).toBe(true)
    expect(isGameError(parseOptions({ holeSeconds: 30 }))).toBe(true)
    expect(parseOptions({ mapId: 'montanha', collisions: false, holeSeconds: 60 })).toEqual({ mapId: 'montanha', collisions: false, holeSeconds: 60 })
  })

  it('ação: rejeita força fora de 0..1 e ângulo não numérico', () => {
    expect(isGameError(parseAction({ type: 'shot', hole: 0, stroke: 0, angle: 0, power: 2 }))).toBe(true)
    expect(isGameError(parseAction({ type: 'shot', hole: 0, stroke: 0, angle: 'x', power: 1 }))).toBe(true)
    expect(isGameError(parseAction({ type: 'shot', hole: 0, stroke: 0, angle: 1, power: 0.5 }))).toBe(false)
  })

  it('começa no buraco 1 com todos na saída e o estado é JSON puro', () => {
    const { state, events } = setup(players, parseOptions(undefined) as never, ctx(T0))
    expect(events[0]).toMatchObject({ type: 'hole-start', hole: 0 })
    expect(state.world.balls).toHaveLength(2)
    expect(JSON.parse(JSON.stringify(state))).toEqual(state)
    expect(nextDeadline(state)).toBe(T0 + 90_000)
  })

  it('dois jogadores tacam ao mesmo tempo; tacada repetida é recusada', () => {
    let s = setup(players, parseOptions(undefined) as never, ctx(T0)).state
    const a1 = shot(s, 'a', 0.3)
    s = ok(s, 'a', a1, T0 + 100).state
    s = ok(s, 'b', shot(s, 'b', 0.4), T0 + 150).state
    // a mesma tacada de novo (stroke antigo)
    expect(isGameError(apply(s, 'a', a1, ctx(T0 + 200)))).toBe(true)
    // bola ainda rolando
    expect(apply(s, 'a', shot(s, 'a', 0.3), ctx(T0 + 200))).toMatchObject({ error: 'nao-e-sua-vez' })
    const r = runUntil(s, T0 + 30_000)
    expect(r.state.world.balls.every((b) => b.mode !== 'roll')).toBe(true)
    expect(view(r.state, 'a', T0).players.map((p) => p.strokes)).toEqual([1, 1])
  })

  it('tacada depois de um tempo parado começa agora (o retrato não fica no passado)', () => {
    let s = setup(players, parseOptions(undefined) as never, ctx(T0)).state
    const r = ok(s, 'a', shot(s, 'a', 0.5), T0 + 5_000)
    const ev = r.events.find((e) => e.type === 'shot') as Extract<GolfEvent, { type: 'shot' }>
    expect(ev.t0).toBeGreaterThan(T0 + 5_000 - 8)
    expect(r.state.world.t0).toBe(ev.t0)
    // a bola ainda está na saída, rolando
    const b = r.state.world.balls.find((x) => x.playerId === 'a')!
    expect(b).toMatchObject({ mode: 'roll', x: 1.5, z: 6.5 })
    expect(nextDeadline(r.state)).toBeGreaterThan(T0 + 5_000)
    s = r.state
    // segunda tacada (de outro) também ancora no instante dela
    const r2 = ok(s, 'b', shot(s, 'b', 0.2), T0 + 9_000)
    expect(r2.state.world.t0).toBeGreaterThan(T0 + 9_000 - 8)
  })

  it('acerto: evento holed, buraco fecha quando todos terminam, pausa e próximo buraco', () => {
    const p = holeInOnePower()
    let s = setup(players, parseOptions(undefined) as never, ctx(T0)).state
    s = ok(s, 'a', shot(s, 'a', p), T0 + 10).state
    s = ok(s, 'b', shot(s, 'b', p), T0 + 2000).state
    const r = runUntil(s, T0 + 20_000)
    expect(r.events.filter((e) => e.type === 'holed').map((e) => (e as { playerId: string }).playerId)).toEqual(['a', 'b'])
    const end = r.events.find((e) => e.type === 'hole-end')
    expect(end).toMatchObject({ scores: { a: 1, b: 1 } })
    expect(r.events.some((e) => e.type === 'hole-start' && e.hole === 1)).toBe(true)
    expect(r.state.hole).toBe(1)
    expect(view(r.state, null, T0).players[0].scores).toEqual([1])
  })

  it('tempo esgotado: quem não acertou leva o limite (par + 4)', () => {
    let s = setup(players, parseOptions({ holeSeconds: 60 }) as never, ctx(T0)).state
    s = ok(s, 'a', shot(s, 'a', holeInOnePower()), T0 + 10).state
    const r = runUntil(s, T0 + 60_000)
    expect(r.events.find((e) => e.type === 'hole-end')).toMatchObject({ scores: { a: 1, b: 6 } })
    expect(r.state.phase).toBe('intervalo')
    expect(r.state.until).toBe(T0 + 60_000 + BREAK_MS)
  })

  it('quem caiu não segura o buraco', () => {
    let s = setup(players, parseOptions(undefined) as never, ctx(T0)).state
    s = setPresence(s, 'b', false, ctx(T0 + 5)).state
    s = ok(s, 'a', shot(s, 'a', holeInOnePower()), T0 + 10).state
    const r = runUntil(s, T0 + 20_000)
    expect(r.events.find((e) => e.type === 'hole-end')).toMatchObject({ scores: { a: 1, b: 6 } })
  })

  it('joga o mapa inteiro só com tempo esgotado e termina com o ranking', () => {
    let s = setup(players, parseOptions({ holeSeconds: 60 }) as never, ctx(T0)).state
    s = ok(s, 'a', shot(s, 'a', holeInOnePower()), T0 + 10).state
    const r = runUntil(s, T0 + 10 * 70_000)
    expect(r.state.phase).toBe('fim')
    expect(nextDeadline(r.state)).toBeNull()
    const over = r.events.find((e) => e.type === 'game-over') as Extract<GolfEvent, { type: 'game-over' }>
    expect(over.ranking[0]).toMatchObject({ playerId: 'a', place: 1 })
    expect(view(r.state, 'b', 0).players[1].scores).toHaveLength(6)
    expect(apply(r.state, 'a', shot(r.state, 'a', 0.5), ctx(T0 + 10 * 70_000))).toMatchObject({ error: 'partida-encerrada' })
  })
})
