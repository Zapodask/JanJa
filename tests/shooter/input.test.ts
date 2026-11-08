import { describe, expect, it } from 'vitest'
import { BTN_DASH, BTN_FIRE, BTN_GRENADE } from '../../src/shared/games/shooter/types'
import { computeView } from '../../src/web/game/shooter/scene/camera'
import {
  GAME_KEYS,
  STICK_RADIUS,
  TOUCH_FIRE_AT,
  applyDeadzone,
  buttonsFromKeys,
  clampUnit,
  composeInput,
  isTypingTarget,
  mouseAim,
  moveFromKeys,
  padToInput,
  stickVector,
  touchAim,
  touchMove,
  unit,
  type PadSnapshot
} from '../../src/web/game/shooter/scene/input'

const keys = (...k: string[]) => new Set(k)
const pad = (axes: number[] = [0, 0, 0, 0], pressed: Record<number, number> = {}): PadSnapshot => ({
  axes,
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: (pressed[i] ?? 0) > 0.5, value: pressed[i] ?? 0 }))
})

describe('teclado', () => {
  it('WASD e setas andam', () => {
    expect(moveFromKeys(keys('KeyD'))).toEqual({ x: 1, y: 0 })
    expect(moveFromKeys(keys('KeyA'))).toEqual({ x: -1, y: 0 })
    expect(moveFromKeys(keys('KeyW'))).toEqual({ x: 0, y: -1 })
    expect(moveFromKeys(keys('KeyS'))).toEqual({ x: 0, y: 1 })
    expect(moveFromKeys(keys('ArrowRight', 'ArrowUp'))).toEqual(moveFromKeys(keys('KeyD', 'KeyW')))
  })

  it('direções opostas se anulam e a diagonal é normalizada', () => {
    expect(moveFromKeys(keys('KeyA', 'KeyD'))).toEqual({ x: 0, y: 0 })
    const d = moveFromKeys(keys('KeyW', 'KeyD'))
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(1, 6)
    expect(d.x).toBeCloseTo(Math.SQRT1_2, 6)
    expect(moveFromKeys(keys())).toEqual({ x: 0, y: 0 })
  })

  it('Espaço = dash, Q = granada, clique segura = atira, botão direito = granada', () => {
    expect(buttonsFromKeys(keys('Space'), 0)).toBe(BTN_DASH)
    expect(buttonsFromKeys(keys('KeyQ'), 0)).toBe(BTN_GRENADE)
    expect(buttonsFromKeys(keys(), 1)).toBe(BTN_FIRE)
    expect(buttonsFromKeys(keys(), 2)).toBe(BTN_GRENADE)
    expect(buttonsFromKeys(keys('Space', 'KeyQ'), 1)).toBe(BTN_FIRE | BTN_DASH | BTN_GRENADE)
    expect(buttonsFromKeys(keys('KeyW'), 0)).toBe(0)
  })

  it('não captura M (mic da sala), F, G nem Tab', () => {
    for (const k of ['KeyM', 'KeyF', 'KeyG', 'Tab', 'Escape', 'KeyH', 'Enter']) expect(GAME_KEYS.has(k), k).toBe(false)
    for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyQ']) expect(GAME_KEYS.has(k), k).toBe(true)
  })

  it('largar o teclado quando o foco está num campo de texto', () => {
    expect(isTypingTarget({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true)
    expect(isTypingTarget({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(true)
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true)
    expect(isTypingTarget({ tagName: 'CANVAS' } as unknown as EventTarget)).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })
})

describe('normalização', () => {
  it('clampUnit só encolhe', () => {
    expect(clampUnit(0.3, 0.4)).toEqual({ x: 0.3, y: 0.4 })
    const c = clampUnit(3, 4)
    expect(Math.hypot(c.x, c.y)).toBeCloseTo(1, 6)
  })
  it('unit devolve null para vetor nulo', () => {
    expect(unit(0, 0)).toBeNull()
    expect(unit(0, -5)).toEqual({ x: 0, y: -1 })
  })
  it('zona morta radial reescala de 0 a 1', () => {
    expect(applyDeadzone(0.1, 0.1, 0.2)).toEqual({ x: 0, y: 0 })
    const full = applyDeadzone(1, 0, 0.2)
    expect(full.x).toBeCloseTo(1, 6)
    const half = applyDeadzone(0.6, 0, 0.2)
    expect(half.x).toBeCloseTo(0.5, 6)
  })
})

describe('controle', () => {
  it('analógico esquerdo anda, direito mira, gatilhos e botões', () => {
    const r = padToInput(pad([1, 0, 0, -1], { 7: 1, 6: 0.8, 0: 1 }))
    expect(r.move.x).toBeCloseTo(1, 6)
    expect(r.move.y).toBeCloseTo(0, 6)
    expect(r.aim).toEqual({ x: 0, y: -1 })
    expect(r.buttons).toBe(BTN_FIRE | BTN_GRENADE | BTN_DASH)
    expect(r.active).toBe(true)
  })

  it('LB também dá dash e gatilho fraco não atira', () => {
    expect(padToInput(pad([0, 0, 0, 0], { 4: 1 })).buttons).toBe(BTN_DASH)
    expect(padToInput(pad([0, 0, 0, 0], { 7: 0.2 })).buttons).toBe(0)
    expect(padToInput(pad([0, 0, 0, 0], { 7: 0.6 })).buttons).toBe(BTN_FIRE)
  })

  it('zona morta: analógico parado não anda nem mira', () => {
    const r = padToInput(pad([0.1, -0.1, 0.12, 0.05]))
    expect(r.move).toEqual({ x: 0, y: 0 })
    expect(r.aim).toBeNull()
    expect(r.active).toBe(false)
  })

  it('diagonal do analógico não passa de 1 e o direcional digital anda', () => {
    const r = padToInput(pad([1, 1, 0, 0]))
    expect(Math.hypot(r.move.x, r.move.y)).toBeLessThanOrEqual(1 + 1e-9)
    const d = padToInput(pad([0, 0, 0, 0], { 15: 1, 12: 1 }))
    expect(d.move.x).toBeCloseTo(Math.SQRT1_2, 6)
    expect(d.move.y).toBeCloseTo(-Math.SQRT1_2, 6)
  })

  it('controle vazio (sem botões) não quebra', () => {
    expect(padToInput({ axes: [], buttons: [] })).toEqual({ move: { x: 0, y: 0 }, aim: null, buttons: 0, active: false })
  })
})

describe('joystick virtual', () => {
  it('o vetor cresce até a borda e trava em 1', () => {
    expect(stickVector(0, 0).mag).toBe(0)
    expect(stickVector(STICK_RADIUS / 2, 0).mag).toBeCloseTo(0.5, 6)
    const far = stickVector(STICK_RADIUS * 3, STICK_RADIUS * 4)
    expect(far.mag).toBe(1)
    expect(Math.hypot(far.v.x, far.v.y)).toBeCloseTo(1, 6)
  })

  it('o da esquerda anda, com zona morta pequena', () => {
    expect(touchMove(2, 2)).toEqual({ x: 0, y: 0 })
    const m = touchMove(STICK_RADIUS, 0)
    expect(m.x).toBeCloseTo(1, 6)
    expect(m.y).toBeCloseTo(0, 6)
    const half = touchMove(0, -STICK_RADIUS / 2)
    expect(half.y).toBeLessThan(0)
    expect(Math.hypot(half.x, half.y)).toBeLessThan(1)
  })

  it('o da direita mira sempre e só atira perto da borda', () => {
    expect(touchAim(1, 1)).toEqual({ aim: null, fire: false })
    const mid = touchAim(0, STICK_RADIUS * 0.5)
    expect(mid.aim).toEqual({ x: 0, y: 1 })
    expect(mid.fire).toBe(false)
    const edge = touchAim(-STICK_RADIUS * TOUCH_FIRE_AT, 0)
    expect(edge.aim).toEqual({ x: -1, y: 0 })
    expect(edge.fire).toBe(true)
    expect(touchAim(STICK_RADIUS * 5, 0).fire).toBe(true)
  })
})

describe('mouse para o mundo pela câmera', () => {
  it('mira do jogador até o ponteiro, em coordenadas do mundo', () => {
    const view = computeView(960, 540) // escala 2
    const cam = { x: 100, y: 50 }
    const player = { x: 340, y: 185 } // no centro do quadro: (240,135) + cam
    // ponteiro 100 px (CSS) à direita do centro = 50 px do mundo
    const a = mouseAim(480 + 100, 270, cam, view, player)!
    expect(a.x).toBeCloseTo(1, 6)
    expect(a.y).toBeCloseTo(0, 6)
    const b = mouseAim(480, 270 + 40, cam, view, player)!
    expect(b.x).toBeCloseTo(0, 6)
    expect(b.y).toBeCloseTo(1, 6)
  })

  it('a câmera muda a mira: mesmo ponto da tela, jogador em lugar diferente', () => {
    const view = computeView(1920, 1080)
    const player = { x: 500, y: 300 }
    const left = mouseAim(300, 540, { x: 400, y: 165 }, view, player)! // ponteiro no mundo: (400+75, 165+135) = (475, 300)
    expect(left.x).toBeCloseTo(-1, 6)
    expect(left.y).toBeCloseTo(0, 6)
  })

  it('ponteiro em cima do jogador não gera mira (mantém a anterior)', () => {
    const view = computeView(960, 540)
    expect(mouseAim(480, 270, { x: 100, y: 50 }, view, { x: 340, y: 185 })).toBeNull()
  })

  it('considera a tarja da tela', () => {
    const view = computeView(3440, 1440) // quadro no limite de largura: sobra tarja dos lados
    expect(view.offX).toBeGreaterThan(0)
    const k = view.scale
    const cam = { x: 0, y: 0 }
    const a = mouseAim(view.offX + k * 200, view.offY + k * 100, cam, view, { x: 100, y: 100 })!
    expect(a.x).toBeCloseTo(1, 6)
    expect(a.y).toBeCloseTo(0, 6)
  })
})

describe('InputState final', () => {
  const base = { keys: keys(), mouseButtons: 0, mouse: null, pad: null, touch: null, lastAim: { x: 1, y: 0 } }
  it('parado: mira a última e nada apertado', () => {
    expect(composeInput({ ...base, lastAim: { x: 0, y: -1 } })).toEqual({ mx: 0, my: 0, ax: 0, ay: -1, buttons: 0 })
  })
  it('teclado + mouse', () => {
    const i = composeInput({ ...base, keys: keys('KeyD', 'Space'), mouseButtons: 1, mouse: { x: 0, y: 1 } })
    expect(i).toEqual({ mx: 1, my: 0, ax: 0, ay: 1, buttons: BTN_FIRE | BTN_DASH })
  })
  it('somar teclado e controle não passa de 1', () => {
    const i = composeInput({ ...base, keys: keys('KeyD'), pad: { move: { x: 1, y: 0 }, aim: null, buttons: 0, active: true } })
    expect(i.mx).toBe(1)
    const j = composeInput({ ...base, keys: keys('KeyD', 'KeyS'), pad: { move: { x: 1, y: 1 }, aim: null, buttons: 0, active: true } })
    expect(Math.hypot(j.mx, j.my)).toBeLessThanOrEqual(1.001)
  })
  it('a mira do toque vence a do controle e a do mouse', () => {
    const i = composeInput({
      ...base,
      mouse: { x: 0, y: 1 },
      pad: { move: { x: 0, y: 0 }, aim: { x: -1, y: 0 }, buttons: 0, active: true },
      touch: { move: { x: 0, y: 0 }, aim: { x: 0, y: -1 }, buttons: BTN_FIRE }
    })
    expect(i.ax).toBe(0)
    expect(i.ay).toBe(-1)
    expect(i.buttons).toBe(BTN_FIRE)
  })
  it('arredonda para 3 casas (pacote pequeno)', () => {
    const i = composeInput({ ...base, mouse: { x: 1 / 3, y: Math.sqrt(8) / 3 } })
    expect(i.ax).toBe(0.333)
    expect(i.ay).toBe(0.943)
  })
})
