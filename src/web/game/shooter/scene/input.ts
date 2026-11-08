/**
 * Entrada do Tiro na Sala: teclado + mouse, controle (gamepad) e toque viram um InputState por quadro.
 * As funções puras ficam no topo (testadas sem DOM); a classe InputController liga tudo ao navegador.
 *
 * Mapa: WASD (ou setas) anda, mouse mira, clique segura = automático, Espaço = dash, Q ou botão direito = granada.
 * Tab (placar), M (mic da sala), F (tela cheia) e G (destaque) NÃO são capturados aqui.
 */
import { BTN_DASH, BTN_FIRE, BTN_GRENADE } from '../../../../shared/games/shooter/types'
import type { InputState, TouchUiState } from '../contract'
import { screenToWorld, type Cam, type ViewSize } from './camera'

export const STICK_DEADZONE = 0.2
export const AIM_DEADZONE = 0.28
export const TRIGGER_THRESHOLD = 0.35
/** no joystick virtual de mira, atira ao empurrar até perto da borda */
export const TOUCH_FIRE_AT = 0.9
/** raio do joystick virtual (px CSS) */
export const STICK_RADIUS = 56

export interface Vec {
  x: number
  y: number
}

/** limita o comprimento a 1 (diagonais não ficam mais rápidas) */
export function clampUnit(x: number, y: number): Vec {
  const l = Math.hypot(x, y)
  return l > 1 ? { x: x / l, y: y / l } : { x, y }
}

export function unit(x: number, y: number): Vec | null {
  const l = Math.hypot(x, y)
  return l > 1e-6 ? { x: x / l, y: y / l } : null
}

/** zona morta radial com reescala: de `dz` a 1 vira de 0 a 1 */
export function applyDeadzone(x: number, y: number, dz = STICK_DEADZONE): Vec {
  const l = Math.hypot(x, y)
  if (l <= dz) return { x: 0, y: 0 }
  const k = Math.min(1, (l - dz) / (1 - dz)) / l
  return { x: x * k, y: y * k }
}

// ---------------------------------------------------------------- teclado

export const MOVE_KEYS = {
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown']
} as const
export const DASH_KEYS = ['Space'] as const
export const GRENADE_KEYS = ['KeyQ'] as const
/** teclas que a cena consome (as outras seguem para a sala: M, F, G, Tab...) */
export const GAME_KEYS: ReadonlySet<string> = new Set([...MOVE_KEYS.left, ...MOVE_KEYS.right, ...MOVE_KEYS.up, ...MOVE_KEYS.down, ...DASH_KEYS, ...GRENADE_KEYS])

const anyDown = (keys: ReadonlySet<string>, list: readonly string[]) => list.some((k) => keys.has(k))

export function moveFromKeys(keys: ReadonlySet<string>): Vec {
  const x = (anyDown(keys, MOVE_KEYS.right) ? 1 : 0) - (anyDown(keys, MOVE_KEYS.left) ? 1 : 0)
  const y = (anyDown(keys, MOVE_KEYS.down) ? 1 : 0) - (anyDown(keys, MOVE_KEYS.up) ? 1 : 0)
  return clampUnit(x, y)
}

export function buttonsFromKeys(keys: ReadonlySet<string>, mouseButtons: number): number {
  let b = 0
  if (mouseButtons & 1) b |= BTN_FIRE
  if (mouseButtons & 2) b |= BTN_GRENADE
  if (anyDown(keys, DASH_KEYS)) b |= BTN_DASH
  if (anyDown(keys, GRENADE_KEYS)) b |= BTN_GRENADE
  return b
}

/** foco num campo de texto (o chat da sala): a cena larga o teclado */
export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as { tagName?: string; isContentEditable?: boolean; closest?: (s: string) => unknown } | null
  if (!el || !el.tagName) return false
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return true
  if (el.isContentEditable) return true
  return !!el.closest?.('[role="listbox"],[contenteditable="true"]')
}

// ---------------------------------------------------------------- controle

export interface PadSnapshot {
  axes: readonly number[]
  buttons: readonly { pressed: boolean; value: number }[]
}

export interface PadResult {
  move: Vec
  /** mira do analógico direito; null = parado */
  aim: Vec | null
  buttons: number
  /** mexeu em algo (para o controle assumir a mira) */
  active: boolean
}

const btn = (p: PadSnapshot, i: number): number => {
  const b = p.buttons[i]
  return b ? Math.max(b.value, b.pressed ? 1 : 0) : 0
}

/** Mapa "standard": analógico esquerdo anda, direito mira, RT atira, LT granada, A ou LB dash. */
export function padToInput(p: PadSnapshot): PadResult {
  const dz = applyDeadzone(p.axes[0] ?? 0, p.axes[1] ?? 0)
  const move = clampUnit(dz.x, dz.y)
  const raw = applyDeadzone(p.axes[2] ?? 0, p.axes[3] ?? 0, AIM_DEADZONE)
  const aim = unit(raw.x, raw.y)
  let buttons = 0
  if (btn(p, 7) > TRIGGER_THRESHOLD) buttons |= BTN_FIRE
  if (btn(p, 6) > TRIGGER_THRESHOLD) buttons |= BTN_GRENADE
  if (btn(p, 0) > 0.5 || btn(p, 4) > 0.5) buttons |= BTN_DASH
  // direcional digital também anda
  const dx = (btn(p, 15) > 0.5 ? 1 : 0) - (btn(p, 14) > 0.5 ? 1 : 0)
  const dy = (btn(p, 13) > 0.5 ? 1 : 0) - (btn(p, 12) > 0.5 ? 1 : 0)
  const m = dx || dy ? clampUnit(dx, dy) : move
  return { move: m, aim, buttons, active: !!buttons || Math.hypot(m.x, m.y) > 0 || !!aim }
}

// ---------------------------------------------------------------- toque

/** joystick virtual: `dx,dy` = deslocamento do dedo desde o ponto onde tocou (px) */
export function stickVector(dx: number, dy: number, radius = STICK_RADIUS): { v: Vec; mag: number } {
  const l = Math.hypot(dx, dy)
  const mag = Math.min(1, l / radius)
  if (l < 1e-6) return { v: { x: 0, y: 0 }, mag: 0 }
  return { v: { x: (dx / l) * mag, y: (dy / l) * mag }, mag }
}

/** movimento do joystick esquerdo: zona morta pequena para o dedo não tremer */
export function touchMove(dx: number, dy: number, radius = STICK_RADIUS): Vec {
  const { v } = stickVector(dx, dy, radius)
  return applyDeadzone(v.x, v.y, 0.12)
}

/** joystick direito: mira para onde empurra e atira ao chegar na borda */
export function touchAim(dx: number, dy: number, radius = STICK_RADIUS): { aim: Vec | null; fire: boolean } {
  const { v, mag } = stickVector(dx, dy, radius)
  if (mag < 0.12) return { aim: null, fire: false }
  return { aim: unit(v.x, v.y), fire: mag >= TOUCH_FIRE_AT }
}

// ---------------------------------------------------------------- mouse

/** mira do jogador (no mundo) para o ponteiro (em px CSS relativos ao palco) */
export function mouseAim(cssX: number, cssY: number, cam: Cam, view: Pick<ViewSize, 'scale' | 'offX' | 'offY'>, player: Vec): Vec | null {
  const w = screenToWorld(cssX, cssY, cam, view)
  return unit(w.x - player.x, w.y - player.y)
}

// ---------------------------------------------------------------- composição

export interface InputSources {
  keys: ReadonlySet<string>
  mouseButtons: number
  /** mira do mouse já calculada (null se o mouse não foi usado) */
  mouse: Vec | null
  pad: PadResult | null
  touch: { move: Vec; aim: Vec | null; buttons: number } | null
  /** última mira enviada */
  lastAim: Vec
}

export function composeInput(s: InputSources): InputState {
  const km = moveFromKeys(s.keys)
  const m = clampUnit(km.x + (s.pad?.move.x ?? 0) + (s.touch?.move.x ?? 0), km.y + (s.pad?.move.y ?? 0) + (s.touch?.move.y ?? 0))
  const buttons = buttonsFromKeys(s.keys, s.mouseButtons) | (s.pad?.buttons ?? 0) | (s.touch?.buttons ?? 0)
  // quem mexeu por último manda na mira: toque > controle > mouse > última
  const aim = s.touch?.aim ?? s.pad?.aim ?? s.mouse ?? s.lastAim
  return { mx: round3(m.x), my: round3(m.y), ax: round3(aim.x), ay: round3(aim.y), buttons }
}

const round3 = (n: number) => Math.round(n * 1000) / 1000

// ---------------------------------------------------------------- controlador (navegador)

export interface InputHost {
  /** elemento que recebe mouse e toque (o palco da cena) */
  el: HTMLElement
  /** estado de câmera e jogador para converter o mouse */
  getView(): { cam: Cam; view: ViewSize; me: Vec | null }
  /** desligado (miniatura, pip, partida acabou): solta tudo */
  enabled(): boolean
  /** o joystick virtual mudou (para desenhar) */
  onTouch?(t: TouchSnapshot): void
}

export type TouchSnapshot = TouchUiState

interface StickState {
  id: number
  cx: number
  cy: number
  x: number
  y: number
}

export class InputController {
  private keys = new Set<string>()
  private mouseButtons = 0
  private mouseCss: Vec | null = null
  private mouseUsed = false
  private lastAim: Vec = { x: 1, y: 0 }
  private padAim = false
  private moveStick: StickState | null = null
  private aimStick: StickState | null = null
  private touchButtons = 0
  private disposers: (() => void)[] = []
  touched = false

  constructor(private host: InputHost) {
    const on = <K extends keyof WindowEventMap>(t: Window, ev: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(ev, fn as EventListener, opts)
      this.disposers.push(() => t.removeEventListener(ev, fn as EventListener, opts))
    }
    const onEl = <K extends keyof HTMLElementEventMap>(ev: K, fn: (e: HTMLElementEventMap[K]) => void) => {
      host.el.addEventListener(ev, fn as EventListener)
      this.disposers.push(() => host.el.removeEventListener(ev, fn as EventListener))
    }

    on(window, 'keydown', (e) => {
      if (!GAME_KEYS.has(e.code)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (isTypingTarget(e.target) || !host.enabled()) return
      this.keys.add(e.code)
      e.preventDefault()
    })
    on(window, 'keyup', (e) => {
      if (GAME_KEYS.has(e.code)) this.keys.delete(e.code)
    })
    on(window, 'blur', () => this.release())
    on(window, 'pointerup', (e) => this.pointerEnd(e))
    on(window, 'pointercancel', (e) => this.pointerEnd(e))
    on(window, 'pointermove', (e) => this.pointerMove(e))

    onEl('pointerdown', (e) => {
      if (!host.enabled()) return
      if ((e.target as HTMLElement | null)?.closest?.('[data-tiro-btn]')) return
      if (isTypingTarget(document.activeElement)) (document.activeElement as HTMLElement).blur()
      const r = host.el.getBoundingClientRect()
      const x = e.clientX - r.left
      const y = e.clientY - r.top
      if (e.pointerType === 'touch') {
        this.touched = true
        this.touchDown(e.pointerId, x, y, r.width)
        try {
          host.el.setPointerCapture(e.pointerId)
        } catch {
          /* sem captura */
        }
        e.preventDefault()
        return
      }
      this.mouseCss = { x, y }
      this.mouseUsed = true
      this.mouseButtons = e.buttons
      if (e.button === 2) e.preventDefault()
    })
    onEl('contextmenu', (e) => e.preventDefault())
    onEl('pointerleave', () => undefined)
  }

  private pointerMove(e: PointerEvent): void {
    const r = this.host.el.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    if (e.pointerType === 'touch') {
      if (this.moveStick?.id === e.pointerId) {
        this.moveStick.x = x
        this.moveStick.y = y
      } else if (this.aimStick?.id === e.pointerId) {
        this.aimStick.x = x
        this.aimStick.y = y
      } else return
      this.emitTouch()
      return
    }
    this.mouseCss = { x, y }
    this.mouseUsed = true
    this.mouseButtons = e.buttons
  }

  private pointerEnd(e: PointerEvent): void {
    if (e.pointerType === 'touch') {
      if (this.moveStick?.id === e.pointerId) this.moveStick = null
      else if (this.aimStick?.id === e.pointerId) this.aimStick = null
      else return
      this.emitTouch()
      return
    }
    this.mouseButtons = e.buttons
  }

  private touchDown(id: number, x: number, y: number, width: number): void {
    // metade esquerda anda; metade direita mira
    if (x < width / 2) {
      if (!this.moveStick) this.moveStick = { id, cx: x, cy: y, x, y }
    } else if (!this.aimStick) this.aimStick = { id, cx: x, cy: y, x, y }
    this.emitTouch()
  }

  /** botões na tela (dash e granada) */
  setTouchButton(btnBit: number, down: boolean): void {
    this.touched = true
    this.touchButtons = down ? this.touchButtons | btnBit : this.touchButtons & ~btnBit
  }

  private emitTouch(): void {
    const m = this.moveStick
    const a = this.aimStick
    const aimV = a ? touchAim(a.x - a.cx, a.y - a.cy) : null
    this.host.onTouch?.({
      move: { active: !!m, cx: m?.cx ?? 0, cy: m?.cy ?? 0, x: m ? m.x - m.cx : 0, y: m ? m.y - m.cy : 0 },
      aim: { active: !!a, cx: a?.cx ?? 0, cy: a?.cy ?? 0, x: a ? a.x - a.cx : 0, y: a ? a.y - a.cy : 0, fire: !!aimV?.fire }
    })
  }

  private release(): void {
    this.keys.clear()
    this.mouseButtons = 0
    this.moveStick = null
    this.aimStick = null
    this.touchButtons = 0
    this.emitTouch()
  }

  /** chamado uma vez por quadro */
  poll(): InputState {
    if (!this.host.enabled()) {
      if (this.keys.size || this.mouseButtons || this.touchButtons) this.release()
      return { mx: 0, my: 0, ax: this.lastAim.x, ay: this.lastAim.y, buttons: 0 }
    }
    const v = this.host.getView()
    // controle
    let pad: PadResult | null = null
    if (typeof navigator !== 'undefined' && navigator.getGamepads) {
      for (const g of navigator.getGamepads()) {
        if (!g || !g.connected) continue
        const r = padToInput(g)
        if (r.active) {
          pad = r
          break
        }
      }
    }
    if (pad?.aim) this.padAim = true
    if (this.mouseUsed && this.padAim && !pad?.aim) this.padAim = false
    // mouse
    let mouse: Vec | null = null
    if (this.mouseCss && v.me && this.mouseUsed) mouse = mouseAim(this.mouseCss.x, this.mouseCss.y, v.cam, v.view, v.me)
    // toque
    let touch: InputSources['touch'] = null
    if (this.moveStick || this.aimStick || this.touchButtons) {
      const m = this.moveStick ? touchMove(this.moveStick.x - this.moveStick.cx, this.moveStick.y - this.moveStick.cy) : { x: 0, y: 0 }
      const a = this.aimStick ? touchAim(this.aimStick.x - this.aimStick.cx, this.aimStick.y - this.aimStick.cy) : { aim: null, fire: false }
      touch = { move: m, aim: a.aim, buttons: this.touchButtons | (a.fire ? BTN_FIRE : 0) }
    }
    const input = composeInput({ keys: this.keys, mouseButtons: this.mouseButtons, mouse: this.padAim && !touch?.aim ? null : mouse, pad, touch, lastAim: this.lastAim })
    this.lastAim = { x: input.ax, y: input.ay }
    return input
  }

  dispose(): void {
    for (const d of this.disposers) d()
    this.disposers = []
    this.keys.clear()
  }
}
