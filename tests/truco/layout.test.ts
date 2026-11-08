import { describe, expect, it } from 'vitest'
import { playSpot, seatSpot } from '../../src/web/game/truco/scene/layout'

describe('lugares na mesa do truco', () => {
  it('você embaixo; o seguinte (anti-horário) à direita; tudo dentro do palco e sem lugar repetido', () => {
    expect(seatSpot(0, 4).y).toBeGreaterThan(0.8)
    expect(seatSpot(1, 4).x).toBeGreaterThan(0.8)
    expect(seatSpot(2, 4).y).toBeLessThan(0.2)
    expect(seatSpot(3, 4).x).toBeLessThan(0.2)
    for (const n of [2, 4, 6]) {
      const spots = Array.from({ length: n }, (_, k) => seatSpot(k, n))
      expect(new Set(spots.map((s) => `${s.x.toFixed(3)},${s.y.toFixed(3)}`)).size).toBe(n)
      for (let k = 0; k < n; k++) {
        const s = seatSpot(k, n)
        const p = playSpot(k, n)
        for (const v of [s.x, s.y, p.x, p.y]) expect(v > 0 && v < 1).toBe(true)
        // as cartas jogadas ficam mais perto do centro que a placa
        expect(Math.hypot(p.x - 0.5, p.y - 0.5)).toBeLessThan(Math.hypot(s.x - 0.5, s.y - 0.5))
      }
    }
  })
})
