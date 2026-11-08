import { describe, expect, it } from 'vitest'
import { circleBlocked } from '../../src/shared/games/shooter/geom'
import { getMap, gridOf } from '../../src/shared/games/shooter/maps'
import { cloneState, createSim, reviveState, setAway, step } from '../../src/shared/games/shooter/sim'
import { MAX_HP, PLAYER_RADIUS, TILE, type Input, type SimPlayerRef, type SimState } from '../../src/shared/games/shooter/types'
import { testRng } from './helpers'

function checkInvariants(s: SimState, label: string): void {
  const map = getMap(s.mapId)
  const g = gridOf(map)
  let kills = 0
  let deaths = 0
  for (const p of s.players) {
    for (const v of [p.x, p.y, p.kx, p.ky, p.ax, p.ay, p.hp, p.dashX, p.dashY]) {
      if (!Number.isFinite(v)) throw new Error(`${label}: NaN/Infinity em jogador ${p.slot}`)
    }
    if (p.hp < 0 || p.hp > MAX_HP) throw new Error(`${label}: hp ${p.hp}`)
    if (p.alive && p.hp <= 0) throw new Error(`${label}: vivo com hp 0`)
    if (p.x < 0 || p.y < 0 || p.x > map.w * TILE || p.y > map.h * TILE) throw new Error(`${label}: fora do mapa`)
    if (circleBlocked(g, p.x, p.y, PLAYER_RADIUS)) throw new Error(`${label}: jogador ${p.slot} dentro de tile sólido em ${p.x},${p.y}`)
    if (!(p.ammo > 0)) throw new Error(`${label}: munição ${p.ammo}`)
    if (p.grenades < 0 || p.grenades > 2) throw new Error(`${label}: granadas ${p.grenades}`)
    if (p.kills < 0 || p.deaths < 0 || p.damage < 0) throw new Error(`${label}: placar negativo`)
    kills += p.kills
    deaths += p.deaths
  }
  if (kills > deaths) throw new Error(`${label}: abates ${kills} > mortes ${deaths}`)
  for (const q of s.projectiles) {
    for (const v of [q.x, q.y, q.vx, q.vy]) if (!Number.isFinite(v)) throw new Error(`${label}: projétil com NaN`)
  }
  for (const k of s.pickups) if (k.backTick < 0 || !Number.isFinite(k.backTick)) throw new Error(`${label}: pickup`)
  if (!Number.isFinite(s.rng)) throw new Error(`${label}: rng`)
}

describe('propriedades: partidas aleatórias', () => {
  it('200 partidas curtas com robôs e entradas aleatórias mantêm as regras', { timeout: 120_000 }, () => {
    for (let n = 0; n < 200; n++) {
      const r = testRng(1000 + n)
      const humans = 1 + Math.floor(r() * 4)
      const bots = Math.floor(r() * 5)
      const refs: SimPlayerRef[] = []
      for (let i = 0; i < humans; i++) refs.push({ slot: i, id: `p${i}`, bot: false })
      for (let i = 0; i < bots; i++) refs.push({ slot: 8 + i, id: `bot-${i + 1}`, bot: true })
      const s = createSim(refs, { mapId: r() < 0.5 ? 'casa' : 'quintal', minutes: 3, killLimit: 10, bots }, Math.floor(r() * 2 ** 31))
      // tira o aquecimento de vez em quando para contar abates
      if (r() < 0.7) s.warmupEndTick = 0
      const ticks = 150 + Math.floor(r() * 250)
      const held: Input[] = refs.map(() => ({ seq: 0, mx: 0, my: 0, ax: 1, ay: 0, buttons: 0 }) as Input)
      for (let t = 0; t < ticks; t++) {
        const m = new Map<number, Input>()
        for (let i = 0; i < humans; i++) {
          // troca de comportamento de vez em quando (entrada "presa" simula pacote perdido)
          if (r() < 0.15) {
            held[i] = { seq: 0, mx: r() * 2.4 - 1.2, my: r() * 2.4 - 1.2, ax: r() * 2 - 1, ay: r() * 2 - 1, buttons: Math.floor(r() * 8), lagTicks: Math.floor(r() * 7) }
          }
          if (r() < 0.9) m.set(i, { ...held[i], seq: t + 1 })
        }
        if (r() < 0.01) setAway(s, 0, r() < 0.5)
        step(s, m)
        if (t % 4 === 0) checkInvariants(s, `partida ${n} tick ${t}`)
        if (s.phase === 'fim') break
      }
      checkInvariants(s, `partida ${n} final`)
    }
  })

  it('cloneState é independente e dá o mesmo futuro', () => {
    const r = testRng(7)
    const refs: SimPlayerRef[] = [
      { slot: 0, id: 'p0', bot: false },
      { slot: 1, id: 'p1', bot: false },
      { slot: 8, id: 'bot-1', bot: true },
      { slot: 9, id: 'bot-2', bot: true }
    ]
    const s = createSim(refs, { mapId: 'casa', minutes: 3, killLimit: 10, bots: 2 }, 42)
    s.warmupEndTick = 0
    const mk = (t: number): Map<number, Input> =>
      new Map([0, 1].map((i) => [i, { seq: t + 1, mx: r() * 2 - 1, my: r() * 2 - 1, ax: r() * 2 - 1, ay: r() * 2 - 1, buttons: Math.floor(r() * 8) } as Input]))
    for (let t = 0; t < 200; t++) step(s, mk(t))
    const c = cloneState(s)
    const before = JSON.stringify(s)
    expect(JSON.stringify(c)).toBe(before)
    // mexer no clone não toca o original
    for (let t = 200; t < 300; t++) step(c, mk(t))
    expect(JSON.stringify(s)).toBe(before)
    // o original, com as mesmas entradas, chega ao mesmo lugar
    const r2 = testRng(7)
    void r2
    const a = cloneState(s)
    const b = cloneState(s)
    for (let t = 200; t < 260; t++) {
      const inputs = mk(t)
      step(a, inputs)
      step(b, inputs)
    }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('structuredClone preserva o estado (inclusive Infinity); JSON perde Infinity e reviveState conserta', () => {
    const refs: SimPlayerRef[] = [
      { slot: 0, id: 'p0', bot: false },
      { slot: 8, id: 'bot-1', bot: true }
    ]
    const s = createSim(refs, { mapId: 'quintal', minutes: 3, killLimit: 10, bots: 1 }, 3)
    for (let t = 0; t < 300; t++) step(s, new Map([[0, { seq: t + 1, mx: 1, my: 0.3, ax: 1, ay: 0, buttons: 1 }]]))
    expect(s.players[0].ammo === Infinity || s.players[0].weapon !== 'pistola').toBe(true)
    expect(structuredClone(s)).toEqual(s)
    const viaJson = JSON.parse(JSON.stringify(s)) as SimState
    if (s.players.some((p) => p.ammo === Infinity)) expect(viaJson.players.some((p) => p.ammo === (null as never))).toBe(true)
    reviveState(viaJson)
    expect(JSON.stringify(viaJson)).toBe(JSON.stringify(s))
    // e continua jogando igual
    const a = structuredClone(s)
    for (let t = 300; t < 400; t++) {
      const i = new Map([[0, { seq: t + 1, mx: -1, my: 0, ax: 0, ay: 1, buttons: 1 }]])
      step(a, i)
      step(viaJson, i)
    }
    expect(JSON.stringify(viaJson)).toBe(JSON.stringify(a))
  })
})
