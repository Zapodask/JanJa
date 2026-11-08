import { describe, expect, it } from 'vitest'
import { botInput, createSim, step } from '../../src/shared/games/shooter/sim'
import { TICK_HZ, WARMUP_TICKS, type MapId, type SimPlayerRef, type SimState } from '../../src/shared/games/shooter/types'

const bots4: SimPlayerRef[] = [1, 2, 3, 4].map((n) => ({ slot: 7 + n, id: `bot-${n}`, bot: true }))
const none = new Map()

function fight(mapId: MapId, seed: number, seconds: number, onSecond?: (s: SimState) => void): SimState {
  const s = createSim(bots4, { mapId, minutes: 8, killLimit: 30, bots: 4 }, seed)
  for (let t = 0; t < WARMUP_TICKS + seconds * TICK_HZ; t++) {
    step(s, none)
    if (t % TICK_HZ === 0) onSecond?.(s)
  }
  return s
}

describe('robôs', () => {
  it.each<[MapId, number]>([
    ['casa', 1],
    ['casa', 2],
    ['quintal', 3]
  ])('4 robôs em %s (semente %i) fazem abates em 60 s', (mapId, seed) => {
    const s = fight(mapId, seed, 60)
    const kills = s.players.reduce((a, p) => a + p.kills, 0)
    const damage = s.players.reduce((a, p) => a + p.damage, 0)
    expect(kills).toBeGreaterThanOrEqual(2)
    expect(damage).toBeGreaterThan(100)
    // e morrem de verdade: nenhum fica com mais abates do que o total de mortes
    expect(kills).toBeLessThanOrEqual(s.players.reduce((a, p) => a + p.deaths, 0))
  })

  it.each<[MapId, number]>([
    ['casa', 4],
    ['quintal', 5]
  ])('não ficam parados mais de 5 s em %s', (mapId, seed) => {
    const trail: Map<number, { x: number; y: number; at: number; alive: boolean }[]> = new Map()
    fight(mapId, seed, 90, (s) => {
      for (const p of s.players) {
        const list = trail.get(p.slot) ?? []
        list.push({ x: p.x, y: p.y, at: s.tick, alive: p.alive })
        trail.set(p.slot, list)
      }
    })
    for (const [slot, list] of trail) {
      // janelas de 5 s (6 amostras de 1 s) em que o robô esteve vivo o tempo todo
      for (let i = 0; i + 5 < list.length; i++) {
        const win = list.slice(i, i + 6)
        if (!win.every((w) => w.alive)) continue
        let far = 0
        for (const w of win) far = Math.max(far, Math.hypot(w.x - win[0].x, w.y - win[0].y))
        expect(far, `robô ${slot} parado perto de ${win[0].x},${win[0].y} no tick ${win[0].at}`).toBeGreaterThan(8)
      }
    }
  })

  it('botInput é determinístico com o mesmo estado', () => {
    const a = createSim(bots4, { mapId: 'casa', minutes: 3, killLimit: 10, bots: 4 }, 9)
    for (let t = 0; t < 120; t++) step(a, none)
    const b = structuredClone(a)
    expect(botInput(a, 8)).toEqual(botInput(b, 8))
    expect(a.rng).toBe(b.rng)
  })

  it('a memória do robô cabe em JSON/structuredClone', () => {
    const s = fight('casa', 6, 10)
    const ai = s.players[0].ai!
    expect(ai).toBeDefined()
    expect(structuredClone(ai)).toEqual(ai)
    expect(JSON.parse(JSON.stringify(ai))).toEqual(ai)
  })

  it('pistola procura arma; robô com pouca vida busca vida', () => {
    const s = createSim(bots4.slice(0, 1), { mapId: 'casa', minutes: 3, killLimit: 10, bots: 1 }, 11)
    let gotGun = false
    let healed = false
    for (let t = 0; t < 40 * 60 && !(gotGun && healed); t++) {
      const p = s.players[0]
      if (p.weapon !== 'pistola') gotGun = true
      if (gotGun && !healed && p.hp === 100 && t > 0) {
        p.hp = 30
        s.pickups.forEach((k) => {
          if (k.kind === 'vida') k.backTick = 0
        })
        healed = false
      }
      if (p.hp > 30 && p.hp < 100) healed = true
      step(s, none)
      if (p.hp > 30 && gotGun) healed = true
    }
    expect(gotGun).toBe(true)
  })
})
