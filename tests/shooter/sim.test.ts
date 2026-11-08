import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { circleBlocked } from '../../src/shared/games/shooter/geom'
import { gridOf } from '../../src/shared/games/shooter/maps'
import { cloneState, createSim, movePlayer, ranking, scores, setAway, step } from '../../src/shared/games/shooter/sim'
import {
  BTN_DASH,
  BTN_FIRE,
  BTN_GRENADE,
  DASH_COOLDOWN_TICKS,
  DASH_SPEED,
  DASH_TICKS,
  DT,
  GRENADE,
  HEAL_AMOUNT,
  MAX_HP,
  PICKUP_RESPAWN_TICKS,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  RESPAWN_TICKS,
  SPAWN_INVULN_TICKS,
  TICK_HZ,
  WARMUP_TICKS,
  WATER_SPEED_MUL,
  WEAPONS,
  type SimEvent
} from '../../src/shared/games/shooter/types'
import { ARENA, inp, mk, OPTS, place, px, resetSeqs, restoreMaps, run, startPlaying, testRng, useArena } from './helpers'

beforeEach(() => {
  useArena()
  resetSeqs()
})
afterEach(restoreMaps)

const none = (): Record<number, never> => ({})
const of = <T extends SimEvent['type']>(evs: SimEvent[], type: T): Extract<SimEvent, { type: T }>[] => evs.filter((e) => e.type === type) as Extract<SimEvent, { type: T }>[]

describe('movimento', () => {
  it('anda em velocidade constante e normaliza a diagonal', () => {
    const s = mk(1)
    const p = place(s, 0, 3, 2)
    const x0 = p.x
    run(s, 10, () => ({ 0: { mx: 1 } }))
    expect(p.x - x0).toBeCloseTo(PLAYER_SPEED * DT * 10, 5)
    const q = place(s, 0, 3, 8)
    const [qx, qy] = [q.x, q.y]
    run(s, 10, () => ({ 0: { mx: 1, my: 1 } }))
    const d = Math.hypot(q.x - qx, q.y - qy)
    expect(d).toBeCloseTo(PLAYER_SPEED * DT * 10, 4)
    // entrada maior que 1 também é normalizada
    const r = place(s, 0, 3, 9)
    const x1 = r.x
    run(s, 4, () => ({ 0: { mx: 5 } }))
    expect(r.x - x1).toBeCloseTo(PLAYER_SPEED * DT * 4, 5)
  })

  it('para na parede e desliza ao longo dela', () => {
    const s = mk(1)
    const p = place(s, 0, 6, 3)
    const y0 = p.y
    // parede nos tiles x=8, y=3..5 (começa em 128 px)
    run(s, 14, () => ({ 0: { mx: 1, my: 0.5 } }))
    expect(p.x).toBeLessThanOrEqual(8 * 16 - PLAYER_RADIUS + 1e-6)
    expect(p.x).toBeGreaterThan(8 * 16 - PLAYER_RADIUS - 1)
    expect(p.y).toBeGreaterThan(y0 + 5) // deslizou para baixo
    expect(circleBlocked(gridOf(ARENA), p.x, p.y, PLAYER_RADIUS)).toBe(false)
  })

  it('não sai do mapa', () => {
    const s = mk(1)
    const p = place(s, 0, 1, 1)
    run(s, 40, () => ({ 0: { mx: -1, my: -1 } }))
    expect(p.x).toBeGreaterThanOrEqual(16 + PLAYER_RADIUS - 1e-3)
    expect(p.y).toBeGreaterThanOrEqual(16 + PLAYER_RADIUS - 1e-3)
  })

  it('água deixa mais lento', () => {
    const s = mk(1)
    const p = place(s, 0, 12, 5)
    const x0 = p.x
    run(s, 1, () => ({ 0: { mx: 1 } }))
    expect(p.x - x0).toBeCloseTo(PLAYER_SPEED * WATER_SPEED_MUL * DT, 5)
  })

  it('movePlayer é puro: mesma entrada, mesmo resultado, sem RNG', () => {
    const s = mk(1)
    const a = place(s, 0, 4, 7)
    const b = { ...a }
    const i = inp({ mx: 0.6, my: -0.3, buttons: BTN_DASH })
    for (let t = 0; t < 30; t++) {
      movePlayer(ARENA, a, i, t)
      movePlayer(ARENA, b, i, t)
    }
    expect(b).toEqual(a)
    expect(s.rng).toBe(mk(1).rng) // não consumiu o RNG
  })

  it('empurrão decai x0,85 por tick', () => {
    const s = mk(1)
    const p = place(s, 0, 4, 8)
    p.kx = 100
    movePlayer(ARENA, p, inp(), 0)
    expect(p.kx).toBeCloseTo(85, 6)
    movePlayer(ARENA, p, inp(), 1)
    expect(p.kx).toBeCloseTo(72.25, 6)
  })
})

describe('dash', () => {
  it('anda DASH_SPEED por DASH_TICKS e depois volta ao normal', () => {
    const s = mk(1)
    const p = place(s, 0, 3, 8)
    const x0 = p.x
    const evs = run(s, DASH_TICKS, () => ({ 0: { mx: 1, buttons: BTN_DASH } }))
    expect(of(evs, 'dash')).toHaveLength(1)
    expect(p.x - x0).toBeCloseTo(DASH_SPEED * DT * DASH_TICKS, 4)
    const x1 = p.x
    run(s, 1, () => ({ 0: { mx: 1 } }))
    expect(p.x - x1).toBeCloseTo(PLAYER_SPEED * DT, 5)
  })

  it('parado, o dash vai na direção da mira', () => {
    const s = mk(1)
    const p = place(s, 0, 10, 8)
    const y0 = p.y
    run(s, 3, () => ({ 0: { ax: 0, ay: 1, buttons: BTN_DASH } }))
    expect(p.y - y0).toBeCloseTo(DASH_SPEED * DT * 3, 4)
  })

  it('tem recarga', () => {
    const s = mk(1)
    place(s, 0, 3, 8)
    const evs = run(s, DASH_COOLDOWN_TICKS - 1, () => ({ 0: { mx: 0.2, buttons: BTN_DASH } }))
    expect(of(evs, 'dash')).toHaveLength(1)
    const more = run(s, 2, () => ({ 0: { mx: 0.2, buttons: BTN_DASH } }))
    expect(of(more, 'dash')).toHaveLength(1)
  })

  it('durante o dash não toma dano de projétil, e depois toma', () => {
    const s = mk(2)
    startPlaying(s)
    place(s, 0, 3, 8)
    const v = place(s, 1, 6, 8)
    // vítima faz dash para a direita (sai da frente) e fica com i-frames por DASH_TICKS
    v.dashUntil = s.tick + DASH_TICKS
    s.players[0].ax = 1
    run(s, 3, () => ({ 0: { ax: 1, ay: 0, buttons: BTN_FIRE } }))
    expect(v.hp).toBe(MAX_HP)
    v.dashUntil = 0
    run(s, 30, () => ({ 0: { ax: 1, ay: 0, buttons: BTN_FIRE } }))
    expect(v.hp).toBeLessThan(MAX_HP)
  })

  it('invulnerável logo após renascer', () => {
    const s = mk(2)
    startPlaying(s)
    place(s, 0, 3, 8)
    const v = place(s, 1, 6, 8)
    v.invulnUntil = s.tick + SPAWN_INVULN_TICKS
    run(s, 20, () => ({ 0: { ax: 1, ay: 0, buttons: BTN_FIRE } }))
    expect(v.hp).toBe(MAX_HP)
  })
})

describe('armas', () => {
  function duel(weapon: 'pistola' | 'escopeta' | 'sub' | 'rifle' | 'rolha', dist: number) {
    const s = mk(2)
    startPlaying(s)
    const a = place(s, 0, 2, 8)
    const b = place(s, 1, 2, 8)
    b.x = a.x + dist
    a.weapon = weapon
    a.ammo = WEAPONS[weapon].ammo
    return { s, a, b }
  }
  const fireIn = (s: ReturnType<typeof mk>, ticks: number) => run(s, ticks, () => ({ 0: { ax: 1, ay: 0, buttons: BTN_FIRE } }))

  it('pistola: 20 de dano, 13 ticks entre tiros, munição infinita', () => {
    const { s, a, b } = duel('pistola', 80)
    const evs = fireIn(s, 14)
    expect(of(evs, 'shot')).toHaveLength(2) // tick 0 e tick 13
    expect(b.hp).toBe(MAX_HP - 20 * of(evs, 'hit').length)
    expect(of(evs, 'hit').length).toBeGreaterThanOrEqual(1)
    expect(a.ammo).toBe(Infinity)
  })

  it('escopeta: leque de 6 bagos e pouco alcance', () => {
    const { s, a } = duel('escopeta', 400)
    run(s, 1, () => ({ 0: { ax: 1, ay: 0, buttons: BTN_FIRE } }))
    expect(s.projectiles).toHaveLength(6)
    const angs = s.projectiles.map((p) => Math.atan2(p.vy, p.vx)).sort((x, y) => x - y)
    expect(angs[5] - angs[0]).toBeGreaterThan(WEAPONS.escopeta.spread * 0.8)
    expect(angs[5] - angs[0]).toBeLessThan(WEAPONS.escopeta.spread * 1.3)
    expect(a.ammo).toBe(WEAPONS.escopeta.ammo - 1)
    // morre antes de chegar longe: 14 ticks * 330 px/s ~ 185 px
    run(s, 20, none)
    expect(s.projectiles).toHaveLength(0)
  })

  it('escopeta de perto machuca bastante', () => {
    const { s, b } = duel('escopeta', 40)
    run(s, 8, () => ({ 0: { ax: 1, ay: 0, buttons: BTN_FIRE } }))
    expect(b.hp).toBeLessThan(MAX_HP - 30)
  })

  it('submetralhadora: cadência alta e espalhamento aleatório', () => {
    const { s } = duel('sub', 200)
    const evs = fireIn(s, 9)
    expect(of(evs, 'shot')).toHaveLength(3)
    const angs = s.projectiles.map((p) => Math.atan2(p.vy, p.vx))
    expect(new Set(angs.map((x) => x.toFixed(5))).size).toBe(angs.length)
    for (const x of angs) expect(Math.abs(x)).toBeLessThanOrEqual(WEAPONS.sub.spread / 2 + 1e-9)
  })

  it('rifle: 70 de dano', () => {
    const { s, b } = duel('rifle', 200)
    fireIn(s, 12)
    expect(b.hp).toBe(MAX_HP - 70)
  })

  it('rolha: explode no contato com dano', () => {
    const { s, b } = duel('rolha', 100)
    const evs = fireIn(s, 40)
    expect(of(evs, 'explode').length).toBeGreaterThanOrEqual(1)
    expect(b.hp).toBeLessThan(MAX_HP - 60)
    expect(b.kx !== 0 || b.x > px(2) + 100).toBe(true)
  })

  it('acabou a munição: volta para a pistola', () => {
    const { s, a } = duel('rolha', 300)
    a.ammo = 1
    run(s, 1, () => ({ 0: { ax: 1, ay: 0, buttons: BTN_FIRE } }))
    expect(a.weapon).toBe('pistola')
    expect(a.ammo).toBe(Infinity)
  })

  it('sub gasta 60 e volta para a pistola', () => {
    const { s, a } = duel('sub', 300)
    const evs = run(s, 3 * 60 + 2, () => ({ 0: { ax: 1, ay: 0, buttons: BTN_FIRE } }))
    expect(a.weapon === 'pistola' || of(evs, 'shot').length >= 60).toBe(true)
    expect(of(evs, 'shot').filter((e) => e.weapon === 'sub')).toHaveLength(60)
    expect(a.weapon).toBe('pistola')
  })

  it('projétil bate na parede e some (evento wall)', () => {
    const { s, a } = duel('pistola', 100)
    a.x = px(6)
    a.y = px(4)
    const evs = run(s, 12, () => ({ 0: { ax: 1, ay: 0, buttons: BTN_FIRE } }))
    expect(of(evs, 'wall').length).toBeGreaterThan(0)
    expect(of(evs, 'wall')[0].x).toBeLessThanOrEqual(8 * 16 + 1)
  })

  it('mureta baixa não bloqueia tiro, parede sim', () => {
    const { s, b } = duel('pistola', 100)
    place(s, 0, 8, 8)
    place(s, 1, 8, 10)
    s.players[0].weapon = 'pistola'
    run(s, 40, () => ({ 0: { ax: 0, ay: 1, buttons: BTN_FIRE } }))
    expect(b.hp).toBeLessThan(MAX_HP) // atirou por cima da mureta em (8,9)
  })

  it('lagTicks adianta o projétil novo', () => {
    const s = mk(2)
    startPlaying(s)
    place(s, 0, 2, 8)
    place(s, 1, 17, 1)
    run(s, 1, () => ({ 0: { ax: 1, ay: 0, buttons: BTN_FIRE, lagTicks: 4 } }))
    const lagged = s.projectiles[0].x
    const s2 = mk(2)
    startPlaying(s2)
    place(s2, 0, 2, 8)
    place(s2, 1, 17, 1)
    run(s2, 1, () => ({ 0: { ax: 1, ay: 0, buttons: BTN_FIRE } }))
    expect(lagged - s2.projectiles[0].x).toBeCloseTo(4 * WEAPONS.pistola.speed * DT, 1)
  })
})

describe('granada', () => {
  it('só na borda de subida, com recarga e 2 ao renascer', () => {
    const s = mk(1)
    startPlaying(s)
    place(s, 0, 2, 8)
    const p = s.players[0]
    expect(p.grenades).toBe(GRENADE.maxCarry)
    run(s, 5, () => ({ 0: { buttons: BTN_GRENADE } }))
    expect(p.grenades).toBe(1) // segurado não repete
    run(s, 1, () => ({ 0: { buttons: 0 } }))
    run(s, 1, () => ({ 0: { buttons: BTN_GRENADE } }))
    expect(p.grenades).toBe(0)
    run(s, 2, () => ({ 0: { buttons: 0 } }))
    run(s, 1, () => ({ 0: { buttons: BTN_GRENADE } }))
    expect(p.grenades).toBe(0) // sem granada
    run(s, GRENADE.regenTicks, none)
    expect(p.grenades).toBeGreaterThanOrEqual(1)
  })

  it('quica na parede, perde velocidade e explode no pavio', () => {
    const s = mk(2)
    startPlaying(s)
    place(s, 0, 6, 4)
    place(s, 1, 17, 10)
    const t0 = s.tick
    const evs = run(s, 1, () => ({ 0: { ax: 1, ay: 0, buttons: BTN_GRENADE } }))
    expect(of(evs, 'grenade')).toHaveLength(1)
    let bounced = false
    let prevVx = s.projectiles[0].vx
    let all: SimEvent[] = []
    for (let i = 0; i < GRENADE.fuseTicks + 2; i++) {
      all = all.concat(run(s, 1, none))
      const g = s.projectiles.find((q) => q.kind === 'granada')
      if (g && g.vx < 0 && prevVx > 0) {
        bounced = true
        expect(Math.abs(g.vx)).toBeLessThan(prevVx)
      }
      if (g) prevVx = g.vx
    }
    expect(bounced).toBe(true)
    const ex = of(all, 'explode')
    expect(ex).toHaveLength(1)
    expect(s.projectiles).toHaveLength(0)
    expect(s.tick - t0).toBeGreaterThanOrEqual(GRENADE.fuseTicks)
  })

  it('não bate em jogadores, só explode e machuca perto', () => {
    const s = mk(2)
    startPlaying(s)
    const a = place(s, 0, 2, 8)
    const b = place(s, 1, 2, 8)
    b.x = a.x + 40
    run(s, 1, () => ({ 0: { ax: 1, ay: 0, buttons: BTN_GRENADE } }))
    run(s, 10, none)
    expect(s.projectiles.some((q) => q.kind === 'granada')).toBe(true)
    expect(b.hp).toBe(MAX_HP)
    // explode perto do b: ele toma dano
    const g = s.projectiles[0]
    run(s, g.dieTick - s.tick - 1, none)
    b.x = g.x + 10
    b.y = g.y
    run(s, 2, none)
    expect(b.hp).toBeLessThan(MAX_HP)
  })
})

describe('explosão', () => {
  it('não atravessa parede e machuca quem atirou (metade)', () => {
    const s = mk(2)
    startPlaying(s)
    const a = place(s, 0, 7, 4)
    a.x = 8 * 16 - PLAYER_RADIUS - 1
    const b = place(s, 1, 9, 4)
    b.x = 9 * 16 + 6 // do outro lado da parede, perto
    a.weapon = 'rolha'
    a.ammo = 3
    const evs = run(s, 4, () => ({ 0: { ax: 1, ay: 0, buttons: BTN_FIRE } }))
    expect(of(evs, 'explode')).toHaveLength(1)
    expect(b.hp).toBe(MAX_HP)
    expect(a.hp).toBeLessThan(MAX_HP)
    expect(a.hp).toBeGreaterThan(0)
  })

  it('dano cai com a distância e dá empurrão', () => {
    const near = mk(2)
    startPlaying(near)
    place(near, 0, 2, 8)
    const n = place(near, 1, 14, 8)
    near.players[0].weapon = 'rolha'
    near.players[0].ammo = 3
    n.x = near.players[0].x + 60
    run(near, 20, () => ({ 0: { ax: 1, ay: 0, buttons: BTN_FIRE } }))
    expect(n.hp).toBeLessThan(MAX_HP)
    expect(n.hp).toBeGreaterThan(0)
  })

  it('suicídio conta morte, não tira abate', () => {
    const s = mk(2)
    startPlaying(s)
    const a = place(s, 0, 7, 4)
    a.x = 8 * 16 - PLAYER_RADIUS - 1
    a.kills = 3
    a.hp = 20
    a.weapon = 'rolha'
    a.ammo = 3
    place(s, 1, 17, 10)
    const evs = run(s, 3, () => ({ 0: { ax: 1, ay: 0, buttons: BTN_FIRE } }))
    expect(a.alive).toBe(false)
    expect(a.deaths).toBe(1)
    expect(a.kills).toBe(3)
    const k = of(evs, 'kill')[0]
    expect(k.victim).toBe(0)
    expect(k.killer).toBe(0)
  })
})

describe('morte e renascimento', () => {
  it('abate soma kills, streak, damage; vítima soma morte', () => {
    const s = mk(2)
    startPlaying(s)
    place(s, 0, 2, 8)
    const v = place(s, 1, 5, 8)
    v.hp = 20
    const evs = run(s, 10, () => ({ 0: { ax: 1, ay: 0, buttons: BTN_FIRE } }))
    const k = of(evs, 'kill')
    expect(k).toHaveLength(1)
    expect(k[0]).toMatchObject({ victim: 1, killer: 0, weapon: 'pistola', streak: 1 })
    expect(v.alive).toBe(false)
    expect(v.deaths).toBe(1)
    expect(s.players[0].kills).toBe(1)
    expect(s.players[0].damage).toBe(20)
    expect(ranking(s)[0].id).toBe('p0')
    expect(scores(s)).toHaveLength(2)
  })

  it('renasce depois de RESPAWN_TICKS no spawn mais longe do inimigo, invulnerável', () => {
    const s = mk(2)
    startPlaying(s)
    place(s, 0, 2, 8)
    const v = place(s, 1, 5, 8)
    v.hp = 20
    v.weapon = 'sub'
    v.ammo = 10
    run(s, 10, () => ({ 0: { ax: 1, ay: 0, buttons: BTN_FIRE } }))
    expect(v.alive).toBe(false)
    const me = s.players[0]
    me.weapon = 'pistola'
    const back = v.respawnTick
    s.players[0].invulnUntil = 1e9
    run(s, back - s.tick - 1, none)
    expect(v.alive).toBe(false)
    const evs = run(s, 3, none)
    expect(v.alive).toBe(true)
    expect(of(evs, 'spawn')).toHaveLength(1)
    expect(s.tick).toBeGreaterThanOrEqual(back)
    expect(v.hp).toBe(MAX_HP)
    expect(v.weapon).toBe('pistola')
    expect(v.grenades).toBe(GRENADE.maxCarry)
    expect(v.invulnUntil).toBeGreaterThan(s.tick)
    const dist = (sp: { x: number; y: number }): number => Math.hypot(sp.x - me.x, sp.y - me.y)
    const best = Math.max(...ARENA.spawns.map(dist))
    expect(dist(v)).toBeCloseTo(best, 5)
  })

  it('aquecimento: tem dano e renascimento, mas abate e morte não contam', () => {
    const s = mk(2)
    expect(s.phase).toBe('aquecendo')
    place(s, 0, 2, 8)
    const v = place(s, 1, 5, 8)
    v.hp = 20
    const evs = run(s, 10, () => ({ 0: { ax: 1, ay: 0, buttons: BTN_FIRE } }))
    expect(of(evs, 'kill')).toHaveLength(1)
    expect(s.players[0].kills).toBe(0)
    expect(v.deaths).toBe(0)
    expect(s.players[0].damage).toBe(0)
    run(s, RESPAWN_TICKS + 1, none)
    expect(v.alive).toBe(true)
  })

  it('aquecimento acaba depois de WARMUP_TICKS com evento de fase', () => {
    const s = mk(2)
    const evs = run(s, WARMUP_TICKS + 2, none)
    expect(s.phase).toBe('jogando')
    expect(of(evs, 'phase')).toEqual([{ type: 'phase', phase: 'jogando' }])
  })
})

describe('pickups', () => {
  it('troca de arma com munição cheia, some e volta', () => {
    const s = mk(1)
    startPlaying(s)
    const p = place(s, 0, 4, 6)
    const evs = run(s, 1, none)
    expect(of(evs, 'pickup')).toEqual([{ type: 'pickup', slot: 0, kind: 'escopeta', pickupId: 0 }])
    expect(p.weapon).toBe('escopeta')
    expect(p.ammo).toBe(WEAPONS.escopeta.ammo)
    const k = s.pickups[0]
    expect(k.backTick).toBe(s.tick - 1 + PICKUP_RESPAWN_TICKS.escopeta)
    p.x = px(10)
    run(s, 5, none)
    place(s, 0, 4, 6)
    p.ammo = 2
    expect(of(run(s, 1, none), 'pickup')).toHaveLength(0) // ainda não voltou
    p.x = px(10)
    run(s, PICKUP_RESPAWN_TICKS.escopeta, none)
    expect(k.backTick).toBe(0)
    place(s, 0, 4, 6)
    expect(of(run(s, 1, none), 'pickup')).toHaveLength(1)
    expect(p.ammo).toBe(WEAPONS.escopeta.ammo) // mesma arma: soma até o máximo
  })

  it('vida cura 40 e não pega se estiver cheio', () => {
    const s = mk(1)
    startPlaying(s)
    const p = place(s, 0, 15, 6)
    expect(of(run(s, 1, none), 'pickup')).toHaveLength(0)
    expect(s.pickups[1].backTick).toBe(0)
    p.hp = 30
    run(s, 1, none)
    expect(p.hp).toBe(30 + HEAL_AMOUNT)
    p.x = px(10)
    run(s, PICKUP_RESPAWN_TICKS.vida + 2, none)
    place(s, 0, 15, 6).hp = 90
    run(s, 1, none)
    expect(p.hp).toBe(MAX_HP)
  })

  it('jogador morto ou ausente não pega', () => {
    const s = mk(2)
    startPlaying(s)
    const p = place(s, 0, 4, 6)
    setAway(s, 0, true)
    place(s, 1, 17, 10)
    run(s, 2, none)
    expect(s.pickups[0].backTick).toBe(0)
    expect(p.weapon).toBe('pistola')
  })
})

describe('fim da partida', () => {
  it('por tempo', () => {
    const s = mk(2)
    place(s, 0, 2, 8)
    place(s, 1, 17, 10)
    const evs = run(s, s.endTick + 5, none)
    expect(s.phase).toBe('fim')
    expect(of(evs, 'phase').map((e) => e.phase)).toEqual(['jogando', 'fim'])
    expect(s.endTick).toBe(WARMUP_TICKS + 3 * 60 * TICK_HZ)
  })

  it('por limite de abates, e depois nada mais acontece', () => {
    const s = mk(2)
    startPlaying(s)
    s.killLimit = 10
    place(s, 0, 2, 8)
    const v = place(s, 1, 5, 8)
    s.players[0].kills = 9
    v.hp = 20
    const evs = run(s, 10, () => ({ 0: { ax: 1, ay: 0, buttons: BTN_FIRE } }))
    expect(s.phase).toBe('fim')
    expect(of(evs, 'phase').at(-1)).toEqual({ type: 'phase', phase: 'fim' })
    const snap = JSON.stringify(s)
    expect(run(s, 20, () => ({ 0: { mx: 1, buttons: BTN_FIRE } }))).toEqual([])
    expect(JSON.stringify(s)).toBe(snap)
    expect(ranking(s)[0]).toMatchObject({ id: 'p0', kills: 10 })
  })
})

describe('entradas', () => {
  it('sem entrada repete a última; lastSeq é o seq aplicado', () => {
    const s = mk(1)
    const p = place(s, 0, 3, 8)
    const x0 = p.x
    step(s, new Map([[0, inp({ seq: 7, mx: 1 })]]))
    expect(p.lastSeq).toBe(7)
    step(s, new Map())
    step(s, new Map())
    expect(p.lastSeq).toBe(7)
    expect(p.x - x0).toBeCloseTo(PLAYER_SPEED * DT * 3, 5)
  })

  it('entrada com lixo (NaN, botões enormes) não quebra', () => {
    const s = mk(1)
    const p = place(s, 0, 3, 8)
    step(s, new Map([[0, { seq: 1, mx: NaN, my: Infinity, ax: NaN, ay: 0, buttons: 0xffff } as never]]))
    expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true)
    expect(Number.isFinite(p.ax) && Number.isFinite(p.ay)).toBe(true)
  })

  it('ausente fica congelado e não toma dano', () => {
    const s = mk(2)
    startPlaying(s)
    place(s, 0, 2, 8)
    const v = place(s, 1, 5, 8)
    setAway(s, 1, true)
    const x = v.x
    run(s, 20, () => ({ 0: { ax: 1, ay: 0, buttons: BTN_FIRE }, 1: { mx: 1 } }))
    expect(v.hp).toBe(MAX_HP)
    expect(v.x).toBe(x)
    setAway(s, 1, false)
    run(s, 20, () => ({ 0: { ax: 1, ay: 0, buttons: BTN_FIRE } }))
    expect(v.hp).toBeLessThan(MAX_HP)
  })

  it('robôs jogam sozinhos quando não vem entrada', () => {
    const s = createSim([{ slot: 8, id: 'bot-1', bot: true }, { slot: 0, id: 'p0', bot: false }], OPTS, 3)
    const b = s.players.find((p) => p.slot === 8)!
    const [x, y] = [b.x, b.y]
    run(s, 80, none)
    expect(Math.hypot(b.x - x, b.y - y)).toBeGreaterThan(5)
  })
})

describe('determinismo e clone', () => {
  const play = (seed: number): string => {
    const s = createSim(
      [
        { slot: 0, id: 'p0', bot: false },
        { slot: 1, id: 'p1', bot: false },
        { slot: 8, id: 'bot-1', bot: true }
      ],
      { ...OPTS, minutes: 3 },
      seed
    )
    const r = testRng(99)
    for (let t = 0; t < 600; t++) {
      const m = new Map()
      for (const slot of [0, 1]) m.set(slot, { seq: t + 1, mx: r() * 2 - 1, my: r() * 2 - 1, ax: r() * 2 - 1, ay: r() * 2 - 1, buttons: Math.floor(r() * 8) })
      step(s, m)
    }
    return JSON.stringify(s)
  }

  it('mesma semente e mesmas entradas dão o mesmo estado', () => {
    expect(play(5)).toBe(play(5))
    expect(play(5)).not.toBe(play(6))
  })

  it('cloneState é independente do original', () => {
    const s = mk(3)
    startPlaying(s)
    run(s, 50, () => ({ 0: { mx: 1, buttons: BTN_FIRE } }))
    const c = cloneState(s)
    expect(c).toEqual(s)
    run(c, 30, () => ({ 0: { mx: -1, buttons: BTN_FIRE | BTN_GRENADE } }))
    expect(c.tick).not.toBe(s.tick)
    expect(JSON.stringify(s)).toBe(JSON.stringify(cloneState(s)))
    c.players[0].hp = 1
    expect(s.players[0].hp).not.toBe(1)
  })
})
