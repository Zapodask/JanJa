import { describe, expect, it } from 'vitest'
import { buildCourse, type HoleDef } from '../../src/shared/games/golf/course'
import { MAPS } from '../../src/shared/games/golf/maps'
import { advance, nextChange, shotVelocity, STEP_MS, type Ball, type World } from '../../src/shared/games/golf/physics'

const ball = (playerId: string, x: number, z: number, vx = 0, vz = 0, live = true): Ball => ({
  playerId,
  x,
  z,
  vx,
  vz,
  mode: vx || vz ? 'roll' : 'rest',
  lx: x,
  lz: z,
  splash: 0,
  live,
  age: 0
})

const box: HoleDef = { name: 'caixa', par: 3, rows: ['.........', '.........', '....O....', '.........', '.........', '.........', '....T....', '.........'] }

function toRest(def: HoleDef, balls: Ball[], collisions = true): World {
  const c = buildCourse(def)
  return advance(c, { t0: 0, balls }, 60_000, collisions)
}

describe('física do golfe', () => {
  it('é determinística (mesma entrada, mesmos números)', () => {
    const def = MAPS[1].holes[2]
    const c = buildCourse(def)
    const v = shotVelocity(-1.3, 0.8)
    const run = () => advance(c, { t0: 0, balls: [ball('a', c.tee.x, c.tee.z, v.vx, v.vz)] }, 3_000, true)
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()))
  })

  it('avançar em pedaços dá o mesmo que avançar de uma vez', () => {
    const c = buildCourse(MAPS[2].holes[3])
    const v = shotVelocity(-1.5, 0.6)
    const w0: World = { t0: 1000, balls: [ball('a', c.tee.x, c.tee.z, v.vx, v.vz)] }
    const once = advance(c, w0, 4000, true)
    let w = w0
    for (const t of [1333, 2017, 2500, 3999, 4000]) w = advance(c, w, t, true)
    expect(w).toEqual(once)
  })

  it('a bola para sozinha e bate na parede', () => {
    const w = toRest(box, [ball('a', 4.5, 6.5, 9, 0)])
    const b = w.balls[0]
    expect(b.mode).toBe('rest')
    expect(b.x).toBeLessThan(9)
    expect(b.x).toBeGreaterThan(0)
  })

  it('cai no buraco devagar e passa por cima rápido', () => {
    const slow = toRest(box, [ball('a', 4.5, 4.5, 0, -2.8)])
    expect(slow.balls[0].mode).toBe('cup')
    // rápido: passa por cima (pode voltar depois da tabela, mas não na primeira passada)
    const fast = advance(buildCourse(box), { t0: 0, balls: [ball('a', 4.5, 7.5, 0, -9)] }, 800, true)
    expect(fast.balls[0].mode).toBe('roll')
    expect(fast.balls[0].z).toBeLessThan(2.5)
  })

  it('areia freia mais que a grama', () => {
    const grass: HoleDef = { name: 'g', par: 2, rows: ['O' + '.'.repeat(14) + 'T'] }
    const sand: HoleDef = { name: 's', par: 2, rows: ['O' + ':'.repeat(14) + 'T'] }
    const g = toRest(grass, [ball('a', 14.5, 0.5, -4, 0)]).balls[0]
    const s = toRest(sand, [ball('a', 14.5, 0.5, -4, 0)]).balls[0]
    expect(14.5 - s.x).toBeLessThan((14.5 - g.x) / 2)
  })

  it('água devolve a bola e conta 1 tacada', () => {
    const lake: HoleDef = { name: 'l', par: 3, rows: ['.O.', '...', '~~~', '...', '.T.'] }
    const w = toRest(lake, [ball('a', 1.5, 4.5, 0, -3)])
    expect(w.balls[0]).toMatchObject({ mode: 'rest', x: 1.5, z: 4.5, splash: 1 })
  })

  it('rampa: devagar volta, forte sobe', () => {
    const def = MAPS.find((m) => m.id === 'montanha')!.holes[0]
    const weak = toRest(def, [ball('a', 1.5, 6.5, 0, -2.5)]).balls[0]
    expect(weak.z).toBeGreaterThan(4)
    const strong = toRest(def, [ball('a', 1.5, 6.5, 0, -8.5)]).balls[0]
    expect(strong.z).toBeLessThan(3)
  })

  it('bolas só batem com colisão ligada', () => {
    const mk = () => [ball('a', 2.5, 3.5, 4, 0), ball('b', 5.5, 3.5)]
    const on = toRest(box, mk(), true)
    const off = toRest(box, mk(), false)
    expect(on.balls[1].x).toBeGreaterThan(5.6)
    expect(off.balls[1].x).toBe(5.5)
  })

  it('bola que ainda não saiu da saída não bate', () => {
    const w = toRest(box, [ball('a', 4.5, 6.5, 0, -1), ball('b', 4.5, 6.5, 0, 0, false)])
    expect(w.balls[1]).toMatchObject({ x: 4.5, z: 6.5 })
  })

  it('nextChange aponta o instante em que a bola para', () => {
    const c = buildCourse(box)
    const w: World = { t0: 0, balls: [ball('a', 4.5, 6.5, 3, 0)] }
    const t = nextChange(c, w, true)!
    expect(t % STEP_MS).toBe(0)
    expect(advance(c, w, t - STEP_MS, true).balls[0].mode).toBe('roll')
    expect(advance(c, w, t, true).balls[0].mode).toBe('rest')
  })

  it('pior caso cabe no orçamento de CPU do Worker', () => {
    const def = MAPS[1].holes[8]
    const c = buildCourse(def)
    const balls = Array.from({ length: 8 }, (_, i) => {
      const v = shotVelocity(-0.4 - i * 0.3, 1)
      return ball(`p${i}`, c.tee.x + (i % 3) * 0.3, c.tee.z, v.vx, v.vz)
    })
    const t = performance.now()
    nextChange(c, { t0: 0, balls }, true)
    advance(c, { t0: 0, balls }, 25_000, true)
    expect(performance.now() - t).toBeLessThan(150)
  })
})
