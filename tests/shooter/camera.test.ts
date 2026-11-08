import { describe, expect, it } from 'vitest'
import { LOOK_AHEAD, cameraTarget, computeView, screenToWorld, shakeOffset, stepCamera, worldToView } from '../../src/web/game/shooter/scene/camera'

describe('escala do quadro', () => {
  it('escala inteira mais perto de 480x270, e o quadro enche o palco', () => {
    const cases: [number, number, number, number, number][] = [
      [960, 540, 2, 480, 270],
      [1920, 1080, 4, 480, 270],
      [2560, 1440, 5, 512, 288],
      [1366, 768, 3, 455, 256],
      [720, 470, 2, 360, 235], // palco com barra lateral e chat abertos
      [480, 270, 1, 480, 270]
    ]
    for (const [w, h, k, vw, vh] of cases) {
      const v = computeView(w, h)
      expect(v.scale, `${w}x${h}`).toBe(k)
      expect([v.viewW, v.viewH], `${w}x${h}`).toEqual([vw, vh])
      expect(v.cssW).toBe(v.viewW * k)
      expect(v.cssW).toBeLessThanOrEqual(w)
      expect(v.cssH).toBeLessThanOrEqual(h)
      // sobra no máximo menos de 1 pixel do mundo de cada lado (ou o limite do quadro)
      if (v.viewW < 560) expect(w - v.cssW).toBeLessThan(k)
    }
  })

  it('o quadro interno tem limite (tela muito larga não vê o mapa todo)', () => {
    const v = computeView(3440, 1440)
    expect(v.viewW).toBe(560)
    expect(v.offX).toBe(Math.floor((3440 - 560 * v.scale) / 2))
  })

  it('tela pequena (celular em pé) usa escala 1, nunca escala quebrada', () => {
    const v = computeView(390, 844)
    expect(v.scale).toBe(1)
    expect(v.viewW).toBe(390)
    expect(v.viewH).toBe(560)
    const small = computeView(360, 200)
    expect(small.scale).toBe(1)
    expect([small.viewW, small.viewH]).toEqual([360, 200])
  })

  it('nunca devolve tamanho zero ou negativo', () => {
    for (const [w, h] of [[0, 0], [1, 1], [100, 50]] as const) {
      const v = computeView(w, h)
      expect(v.viewW).toBeGreaterThan(0)
      expect(v.viewH).toBeGreaterThan(0)
      expect(v.scale).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('câmera', () => {
  const map = { w: 960, h: 640 }
  it('segue o jogador e avança na direção da mira', () => {
    const still = cameraTarget(480, 320, 0, 0, 480, 270, map.w, map.h)
    const right = cameraTarget(480, 320, 1, 0, 480, 270, map.w, map.h)
    const down = cameraTarget(480, 320, 0, 1, 480, 270, map.w, map.h)
    expect(still).toEqual({ x: 240, y: 185 })
    expect(right.x - still.x).toBeCloseTo(LOOK_AHEAD)
    expect(right.y).toBe(still.y)
    expect(down.y - still.y).toBeCloseTo(LOOK_AHEAD)
  })

  it('o avanço não depende do tamanho do vetor de mira', () => {
    const a = cameraTarget(480, 320, 5, 0, 480, 270, map.w, map.h)
    const b = cameraTarget(480, 320, 0.2, 0, 480, 270, map.w, map.h)
    expect(a).toEqual(b)
  })

  it('o avanço da mira é limitado ao mapa', () => {
    // perto da borda direita/de baixo olhando para fora: a câmera para no limite
    const r = cameraTarget(map.w - 10, map.h - 10, 1, 1, 480, 270, map.w, map.h)
    expect(r.x).toBe(map.w - 480)
    expect(r.y).toBe(map.h - 270)
    const l = cameraTarget(10, 10, -1, -1, 480, 270, map.w, map.h)
    expect(l).toEqual({ x: 0, y: 0 })
  })

  it('mapa menor que a vista fica centralizado', () => {
    const c = cameraTarget(100, 100, 1, 0, 480, 270, 320, 200)
    expect(c.x).toBe((320 - 480) / 2)
    expect(c.y).toBe((200 - 270) / 2)
  })

  it('o passo suave chega no alvo sem passar dele e pula quando longe demais', () => {
    let cur = { x: 0, y: 0 }
    const tgt = { x: 100, y: 40 }
    for (let i = 0; i < 6; i++) {
      const next = stepCamera(cur, tgt, 16)
      expect(next.x).toBeGreaterThan(cur.x)
      expect(next.x).toBeLessThanOrEqual(tgt.x)
      cur = next
    }
    for (let i = 0; i < 60; i++) cur = stepCamera(cur, tgt, 16)
    expect(cur.x).toBeCloseTo(100, 0)
    expect(stepCamera({ x: 0, y: 0 }, { x: 900, y: 0 }, 16)).toEqual({ x: 900, y: 0 })
    // mesma meia-vida em qualquer taxa de quadros
    const slow = stepCamera({ x: 0, y: 0 }, tgt, 32)
    const fast = stepCamera(stepCamera({ x: 0, y: 0 }, tgt, 16), tgt, 16)
    expect(slow.x).toBeCloseTo(fast.x, 5)
  })
})

describe('mundo e tela', () => {
  it('mouse para mundo e de volta', () => {
    const view = computeView(1920, 1080)
    const cam = { x: 120, y: 80 }
    // o centro do palco (960, 540) é o centro do quadro interno
    const w = screenToWorld(960, 540, cam, view)
    expect(w).toEqual({ x: 120 + 240, y: 80 + 135 })
    const v = worldToView(w.x, w.y, cam)
    expect(v).toEqual({ x: 240, y: 135 })
  })

  it('considera a tarja e a escala', () => {
    const view = computeView(1366, 768) // escala 3
    const cam = { x: 0, y: 0 }
    expect(screenToWorld(view.offX, view.offY, cam, view)).toEqual({ x: 0, y: 0 })
    expect(screenToWorld(view.offX + 90, view.offY + 30, cam, view)).toEqual({ x: 30, y: 10 })
  })
})

describe('tremida', () => {
  it('sem força não treme, com força fica dentro do limite e é determinística', () => {
    expect(shakeOffset(0, 5)).toEqual({ x: 0, y: 0 })
    for (let s = 0; s < 50; s++) {
      const o = shakeOffset(3, s)
      expect(Math.abs(o.x)).toBeLessThanOrEqual(3)
      expect(Math.abs(o.y)).toBeLessThanOrEqual(3)
      expect(Number.isInteger(o.x) && Number.isInteger(o.y)).toBe(true)
      expect(shakeOffset(3, s)).toEqual(o)
    }
  })
})
