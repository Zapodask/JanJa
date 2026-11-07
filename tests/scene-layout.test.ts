import { describe, expect, it } from 'vitest'
import { cardSprite, chipPlan, computeScene, computeViewport, pileSprite, seatPositions, stackPlan, tvCssRects, tvSlots } from '../src/web/game/scene/layout'

describe('computeViewport', () => {
  it('usa escala inteira e centraliza', () => {
    const v = computeViewport(1920, 1080, 'mesa')
    expect(v.scale).toBe(4)
    expect(Number.isInteger(v.scale)).toBe(true)
    expect(v.cssW).toBe(v.w * v.scale)
    expect(v.offX).toBeGreaterThanOrEqual(0)
    expect(v.offY).toBeGreaterThanOrEqual(0)
  })
  it('ultrawide aumenta a largura interna até 640 e mantém a altura', () => {
    const v = computeViewport(3440, 1440, 'mesa')
    expect(v.h).toBe(270)
    expect(v.w).toBeGreaterThan(480)
    expect(v.w).toBeLessThanOrEqual(640)
    expect(v.scale).toBe(5)
  })
  it('faixa tem 120 de altura interna', () => {
    expect(computeViewport(1920, 300, 'faixa').h).toBe(120)
  })
  it('celular em pé usa orientação vertical', () => {
    const v = computeViewport(390, 844, 'mesa')
    expect(v.orientation).toBe('port')
    expect(v.h).toBeGreaterThan(v.w)
  })
  it('a escala nunca passa do container', () => {
    for (const [w, h] of [[800, 450], [1280, 720], [1366, 768], [2560, 1080]]) {
      const v = computeViewport(w, h, 'mesa')
      expect(v.cssW).toBeLessThanOrEqual(w)
      expect(v.cssH).toBeLessThanOrEqual(h)
    }
  })
})

describe('seatPositions', () => {
  const g = computeScene(480, 270, 'land', 'mesa', 1)
  for (let n = 2; n <= 8; n++) {
    it(`${n} jogadores: distintos, dentro do canvas, eu embaixo`, () => {
      const s = seatPositions(n, g)
      expect(s).toHaveLength(n)
      expect(new Set(s.map((p) => `${p.x},${p.y}`)).size).toBe(n)
      for (const p of s) {
        expect(p.x).toBeGreaterThan(0)
        expect(p.x).toBeLessThan(g.w)
        expect(p.y).toBeGreaterThan(0)
        expect(p.y).toBeLessThan(g.h)
      }
      const me = s[0]
      expect(Math.max(...s.map((p) => p.y))).toBe(me.y)
    })
  }
})

describe('TVs', () => {
  it('quantidade, 16:9 e sem tocar o abajur', () => {
    for (let n = 1; n <= 8; n++) {
      const slots = tvSlots(n, 480, 14, 62, 240)
      expect(slots).toHaveLength(n)
      for (const t of slots) {
        expect(t.frame.x + t.frame.w <= 240 - 34 || t.frame.x >= 240 + 34).toBe(true)
        expect(Math.abs(t.hole.w / t.hole.h - 16 / 9)).toBeLessThan(0.15)
      }
    }
    expect(tvSlots(0, 480, 14, 62, 240)).toEqual([])
  })
  it('retângulos em CSS acompanham a escala', () => {
    const vp = computeViewport(1920, 1080, 'mesa')
    const g = computeScene(vp.w, vp.h, vp.orientation, 'mesa', 1)
    const r = tvCssRects(g, vp)
    expect(r).toHaveLength(1)
    expect(r[0].w).toBe(g.tvs[0].hole.w * vp.scale)
  })
  it('TV decorativa (0) não gera retângulo', () => {
    const vp = computeViewport(1920, 1080, 'mesa')
    expect(tvCssRects(computeScene(vp.w, vp.h, vp.orientation, 'mesa', 0), vp)).toEqual([])
  })
})

describe('fichas e cartas', () => {
  it('chipPlan usa as maiores denominações, até 3 pilhas', () => {
    expect(chipPlan(0)).toEqual([])
    expect(chipPlan(5)).toEqual([{ color: 'cream', count: 1 }])
    expect(chipPlan(130)).toEqual([{ color: 'amber', count: 1 }, { color: 'green', count: 1 }, { color: 'cream', count: 1 }])
    expect(chipPlan(100000).length).toBeLessThanOrEqual(3)
    expect(chipPlan(100000)[0].count).toBe(5)
  })
  it('stackPlan cresce com o valor', () => {
    expect(stackPlan(0)).toEqual([])
    expect(stackPlan(1)[0].color).toBe('cream')
  })
  it('nomes de sprite', () => {
    expect(pileSprite('amber', 1)).toBe('chip_amber')
    expect(pileSprite('green', 4)).toBe('chipstack_green_5')
    expect(cardSprite('Ts')).toBe('card_10s')
    expect(cardSprite('Ah')).toBe('card_Ah')
  })
})
