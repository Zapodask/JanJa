import { describe, expect, it } from 'vitest'
import { centerBox, tileBox, tokenSpot } from '../../src/web/game/tycoon/scene/layout'

const S = 980
const r = (b: { x: number; y: number; w: number; h: number }) => ({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) })
const overlap = (a: ReturnType<typeof tileBox>, b: ReturnType<typeof tileBox>) =>
  a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 && a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01

describe('geometria do tabuleiro do Magnata', () => {
  it('cantos nos lugares certos', () => {
    expect(r(tileBox(0, S))).toEqual({ x: S - 140, y: S - 140, w: 140, h: 140 })
    expect(r(tileBox(8, S))).toMatchObject({ x: 0, y: S - 140 })
    expect(r(tileBox(16, S))).toMatchObject({ x: 0, y: 0 })
    expect(r(tileBox(24, S))).toMatchObject({ x: S - 140, y: 0 })
  })

  it('as 32 casas não se sobrepõem, ficam dentro do tabuleiro e fora do miolo', () => {
    const boxes = Array.from({ length: 32 }, (_, i) => tileBox(i, S))
    const center = centerBox(S)
    boxes.forEach((b, i) => {
      expect(b.x).toBeGreaterThanOrEqual(-0.01)
      expect(b.y + b.h).toBeLessThanOrEqual(S + 0.01)
      expect(overlap(b, center)).toBe(false)
      for (let j = i + 1; j < 32; j++) expect(overlap(b, boxes[j]), `${i} x ${j}`).toBe(false)
    })
    // a área toda é coberta: casas + miolo = tabuleiro
    const area = boxes.reduce((a, b) => a + b.w * b.h, 0) + center.w * center.h
    expect(area).toBeCloseTo(S * S, 0)
  })

  it('casas vizinhas encostam (a volta é contínua)', () => {
    for (let i = 0; i < 32; i++) {
      const a = tileBox(i, S)
      const b = tileBox((i + 1) % 32, S)
      const touch = Math.abs(a.x - (b.x + b.w)) < 0.01 || Math.abs(b.x - (a.x + a.w)) < 0.01 || Math.abs(a.y - (b.y + b.h)) < 0.01 || Math.abs(b.y - (a.y + a.h)) < 0.01
      expect(touch, `${i}`).toBe(true)
    }
  })

  it('peões na mesma casa ficam em lugares diferentes dentro dela', () => {
    const spots = Array.from({ length: 6 }, (_, k) => tokenSpot(5, k, 6, S))
    const box = tileBox(5, S)
    expect(new Set(spots.map((p) => `${p.x},${p.y}`)).size).toBe(6)
    for (const p of spots) expect(p.x > box.x && p.x < box.x + box.w && p.y > box.y && p.y < box.y + box.h).toBe(true)
    // e em toda casa, com 1 a 6 peões, o centro do peão fica dentro dela
    for (let i = 0; i < 32; i++) {
      const b = tileBox(i, S)
      for (let n = 1; n <= 6; n++)
        for (let k = 0; k < n; k++) {
          const q = tokenSpot(i, k, n, S)
          expect(q.x > b.x && q.x < b.x + b.w && q.y > b.y && q.y < b.y + b.h, `casa ${i}, ${k + 1}/${n}`).toBe(true)
        }
    }
  })
})
