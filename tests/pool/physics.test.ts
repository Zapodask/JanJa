import { describe, expect, it } from 'vitest'
import { aimGuide, canPlace, newLog, R, simulate, step, strike, TABLE_H, TABLE_W, type PBall } from '../../src/shared/games/pool/physics'
import { rack } from '../../src/shared/games/pool/rules'
import { seededRng } from '../../src/shared/games/types'

const ball = (id: number, x: number, y: number): PBall => ({ id, x, y, vx: 0, vy: 0, in: false })

describe('física da sinuca', () => {
  it('tacada reta na direção da caçapa do canto encaçapa a bola', () => {
    const r = simulate([ball(0, 20, 20), ball(1, 10, 10)], -1, -1, 0.5)
    expect(r.log.firstHit).toBe(1)
    expect(r.log.pocketed.map((p) => p.id)).toContain(1)
    expect(r.log.pocketed.find((p) => p.id === 1)?.pocket).toBe(0)
  })

  it('choque de frente: a branca para e a outra segue', () => {
    const r = simulate([ball(0, 30, 25), ball(5, 40, 25)], 1, 0, 0.15)
    const cue = r.balls.find((b) => b.id === 0)!
    const five = r.balls.find((b) => b.id === 5)!
    expect(cue.x).toBeLessThan(42)
    expect(five.x).toBeGreaterThan(45)
    expect(Math.abs(five.y - 25)).toBeLessThan(0.01)
  })

  it('bate na tabela e volta; não sai da mesa', () => {
    const r = simulate([ball(0, 40, 25)], 0, 1, 0.3)
    const cue = r.balls[0]
    expect(r.log.pocketed).toHaveLength(0)
    expect(cue.y).toBeGreaterThan(R - 1e-9)
    expect(cue.y).toBeLessThan(TABLE_H - R + 1e-9)
  })

  it('determinística: a mesma tacada dá exatamente o mesmo resultado', () => {
    const balls = [ball(0, 25, 25), ...rack(seededRng(3)).filter((b) => b.id !== 0)]
    const a = simulate(balls, 1, 0.013, 1)
    const b = simulate(balls, 1, 0.013, 1)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('quebra forte: bolas espalham, ficam na mesa ou na caçapa e não se sobrepõem', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const balls = rack(seededRng(seed))
      const r = simulate(balls, 1, (seed - 10) * 0.004, 1)
      const on = r.balls.filter((b) => !b.in)
      for (const b of on) {
        expect(b.x).toBeGreaterThan(0)
        expect(b.x).toBeLessThan(TABLE_W)
        expect(b.y).toBeGreaterThan(0)
        expect(b.y).toBeLessThan(TABLE_H)
      }
      for (let i = 0; i < on.length; i++)
        for (let j = i + 1; j < on.length; j++) expect(Math.hypot(on[i].x - on[j].x, on[i].y - on[j].y)).toBeGreaterThan(2 * R - 0.05)
      expect(r.log.firstHit).not.toBeNull()
    }
  })

  it('a linha de mira acerta a bola e a direção bate com a simulação', () => {
    const balls = [ball(0, 20, 25), ball(3, 40, 26)]
    const g = aimGuide(balls, 1, 0)!
    expect(g.hit).toBe(3)
    // roda até o choque e compara a velocidade da bola atingida com a previsão
    const w = balls.map((b) => ({ ...b }))
    const log = newLog()
    strike(w, 1, 0, 0.3)
    while (log.firstHit === null && log.steps < 5000) step(w, log)
    const three = w.find((b) => b.id === 3)!
    const len = Math.hypot(three.vx, three.vy)
    expect(three.vx / len).toBeCloseTo(g.object!.x, 1)
    expect(three.vy / len).toBeCloseTo(g.object!.y, 1)
  })

  it('não dá para pôr a branca em cima de outra bola nem fora da mesa', () => {
    const balls = [ball(0, 20, 25), ball(1, 50, 25)]
    expect(canPlace(balls, 50.5, 25)).toBe(false)
    expect(canPlace(balls, 60, 25)).toBe(true)
    expect(canPlace(balls, 0.5, 25)).toBe(false)
    expect(canPlace(balls, 60, 25, 25)).toBe(false) // atrás da linha na quebra
  })
})
