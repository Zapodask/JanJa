import { describe, expect, it } from 'vitest'
import { apply, nextDeadline, setPresence, setup, tick, view, type NavalState } from '../../src/shared/games/naval/engine'
import { randomFleet, shipCells, type Cell, type Placement } from '../../src/shared/games/naval/fleet'
import { AWAY_MS, PLACE_MS, SHOT_MS, type NavalAction } from '../../src/shared/games/naval/types'
import { isGameError, seededRng, type GameCtx } from '../../src/shared/games/types'

const T0 = 1_000_000
const ctx = (now = T0, seed = 3): GameCtx => ({ now, rng: seededRng(seed) })
const PLAYERS = [
  { playerId: 'a', name: 'Ana' },
  { playerId: 'b', name: 'Bia' }
]
const FLEET_A: Placement[] = [
  { id: 'porta-avioes', x: 0, y: 0, dir: 'h' },
  { id: 'encouracado', x: 0, y: 2, dir: 'h' },
  { id: 'cruzador', x: 0, y: 4, dir: 'h' },
  { id: 'submarino', x: 0, y: 6, dir: 'h' },
  { id: 'destroier', x: 0, y: 8, dir: 'h' }
]
const FLEET_B = FLEET_A.map((p) => ({ ...p, x: 5 }))

function act(s: NavalState, who: string, a: NavalAction, now = T0): NavalState {
  const r = apply(s, who, a, ctx(now))
  if (isGameError(r)) throw new Error(r.message)
  return r.state
}
function battle(mode: 'classico' | 'salva' = 'classico') {
  let s = setup(PLAYERS, { mode }, ctx()).state
  s = act(s, 'a', { type: 'place', ships: FLEET_A })
  s = act(s, 'b', { type: 'place', ships: FLEET_B })
  s.turn = 0 // Ana começa nos testes
  return s
}
const fire = (s: NavalState, who: string, ...cells: Cell[]) => act(s, who, { type: 'shoot', cells, ref: s.ref })

describe('batalha naval', () => {
  it('posicionar: frota inválida é recusada; a batalha começa quando os dois terminam', () => {
    let s = setup(PLAYERS, { mode: 'classico' }, ctx()).state
    expect(s.phase).toBe('posicionar')
    const bad = apply(s, 'a', { type: 'place', ships: FLEET_A.slice(1) }, ctx())
    expect(isGameError(bad) && bad.message).toContain('todos')
    s = act(s, 'a', { type: 'place', ships: FLEET_A })
    expect(view(s, 'b', T0).players[0].ready).toBe(true)
    // ainda dá para mudar enquanto a outra não terminou
    s = act(s, 'a', { type: 'place', ships: FLEET_B })
    expect(s.phase).toBe('posicionar')
    s = act(s, 'b', { type: 'place', ships: FLEET_A })
    expect(s.phase).toBe('batalha')
    expect(isGameError(apply(s, 'a', { type: 'place', ships: FLEET_A }, ctx()))).toBe(true)
  })

  it('a frota do outro não vai na visão (só tiros e afundados)', () => {
    const s = battle()
    const v = view(s, 'a', T0)
    expect(v.myFleet).toEqual(FLEET_A)
    expect(v.fleets).toBeNull()
    expect(JSON.stringify(v)).not.toContain('"x":5')
    expect(view(s, null, T0).myFleet).toBeNull()
  })

  it('clássico: acertou joga de novo, errou passa a vez', () => {
    let s = battle()
    s = fire(s, 'a', { x: 5, y: 0 })
    expect(s.shots[1]).toEqual([{ x: 5, y: 0, hit: true }])
    expect(s.turn).toBe(0)
    s = fire(s, 'a', { x: 0, y: 9 })
    expect(s.turn).toBe(1)
    expect(isGameError(apply(s, 'a', { type: 'shoot', cells: [{ x: 1, y: 1 }], ref: s.ref }, ctx()))).toBe(true)
    // atirar de novo no mesmo lugar não vale
    s = fire(s, 'b', { x: 9, y: 9 })
    expect(isGameError(apply(s, 'a', { type: 'shoot', cells: [{ x: 5, y: 0 }], ref: s.ref }, ctx()))).toBe(true)
  })

  it('afundou: o navio aparece para todos', () => {
    let s = battle()
    s = fire(s, 'a', { x: 5, y: 8 })
    const r = apply(s, 'a', { type: 'shoot', cells: [{ x: 6, y: 8 }], ref: s.ref }, ctx())
    if (isGameError(r)) throw new Error(r.message)
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'shot', sunk: ['destroier'] }))
    expect(view(r.state, 'a', T0).seas[1].sunk).toEqual([{ id: 'destroier', x: 5, y: 8, dir: 'h' }])
    expect(view(r.state, 'a', T0).seas[1].afloat).toBe(4)
  })

  it('afundar tudo vence e mostra as duas frotas', () => {
    let s = battle()
    for (const ship of FLEET_B) for (const c of shipCells(ship)) if (s.phase === 'batalha') s = fire(s, 'a', c)
    expect(s.phase).toBe('fim')
    expect(s.winner).toBe(0)
    expect(view(s, 'b', T0).fleets).toEqual([FLEET_A, FLEET_B])
    expect(nextDeadline(s)).toBeNull()
  })

  it('salva: um tiro por navio de pé, numa rajada, e passa a vez', () => {
    let s = battle('salva')
    expect(view(s, 'a', T0).shots).toBe(5)
    expect(isGameError(apply(s, 'a', { type: 'shoot', cells: [{ x: 1, y: 1 }], ref: s.ref }, ctx()))).toBe(true)
    s = fire(s, 'a', { x: 5, y: 8 }, { x: 6, y: 8 }, { x: 9, y: 9 }, { x: 9, y: 7 }, { x: 9, y: 5 })
    expect(s.turn).toBe(1) // na salva não tem tiro extra
    // Bia perdeu o destróier: tem 4 navios, então dá 4 tiros
    expect(view(s, 'b', T0).shots).toBe(4)
    s = fire(s, 'b', { x: 9, y: 9 }, { x: 9, y: 8 }, { x: 9, y: 7 }, { x: 9, y: 6 })
    expect(s.turn).toBe(0)
  })

  it('clique atrasado (ref velho) é recusado', () => {
    const s = battle()
    const r = apply(s, 'a', { type: 'shoot', cells: [{ x: 9, y: 9 }], ref: s.ref + 1 }, ctx())
    expect(isGameError(r) && r.message).toContain('atrasada')
  })

  it('prazos: posiciona sozinho e atira sozinho', () => {
    let s = setup(PLAYERS, { mode: 'classico' }, ctx()).state
    s = act(s, 'a', { type: 'place', ships: randomFleet(seededRng(9)) })
    expect(nextDeadline(s)).toBe(T0 + PLACE_MS)
    s = tick(s, ctx(T0 + PLACE_MS)).state
    expect(s.phase).toBe('batalha')
    const before = s.ref
    s = tick(s, ctx(T0 + PLACE_MS + SHOT_MS)).state
    expect(s.ref).toBe(before + 1)
  })

  it('quem sai da sala na sua vez joga sozinho rápido', () => {
    const s = battle()
    expect(setPresence(s, 'a', false, ctx(T0 + 10)).state.until).toBe(T0 + 10 + AWAY_MS)
  })
})
