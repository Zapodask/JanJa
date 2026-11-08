/**
 * Cena da sinuca em canvas 2D, em pixel art (4 px por unidade da mesa, ampliado sem suavizar).
 * Anima a tacada rodando a mesma física do servidor a partir do "antes" e, no fim, encaixa nas
 * posições que o servidor mandou. Mira: mexa o mouse; segure para dar força e solte para tacar.
 */
import { aimGuide, canPlace, cloneBalls, HZ, MAX_STEPS, newLog, POCKETS, step, strike, TABLE_H, TABLE_W, type PBall, type ShotLog } from '../../../../shared/games/pool/physics'
import { HEAD_X } from '../../../../shared/games/pool/rules'
import type { PoolView } from '../../../../shared/games/pool/types'
import type { PoolShot, SfxName } from '../../contract'
import { ballFill, ballGrid, BALL_PX, PX, TABLE_COLORS as T } from './sprites'

export const RAIL = 14
export const CANVAS_W = TABLE_W * PX + 2 * RAIL
export const CANVAS_H = TABLE_H * PX + 2 * RAIL
/** força: vai de 0 a 1 e volta em 2 * CHARGE_MS */
const CHARGE_MS = 1100

export interface PoolEngineProps {
  view: PoolView
  reducedMotion: boolean
  onShoot: (s: PoolShot) => void
  onSfx?: (name: SfxName) => void
  /** muda quando a pessoa quer mover a branca de novo (bola na mão) */
  placeSeq: number
}

const cx = (x: number): number => RAIL + x * PX
const cy = (y: number): number => RAIL + y * PX

export class PoolEngine {
  private ctx: CanvasRenderingContext2D
  private sprites = new Map<number, HTMLCanvasElement>()
  private props: PoolEngineProps | null = null
  private balls: PBall[] = []
  private lastRef: number | null = null
  private anim: { balls: PBall[]; log: ShotLog; acc: number; last: number; pocketed: number } | null = null
  private mouse: { x: number; y: number } | null = null
  private aim = { x: 1, y: 0 }
  private charge: number | null = null
  private placing = false
  private placed: { x: number; y: number } | null = null
  private pocket: number | null = null
  private pocketLocked = false
  private waiting = false
  private placeSeq = 0
  private raf = 0
  private dirty = true

  constructor(private canvas: HTMLCanvasElement) {
    canvas.width = CANVAS_W
    canvas.height = CANVAS_H
    this.ctx = canvas.getContext('2d') as CanvasRenderingContext2D
    this.ctx.imageSmoothingEnabled = false
    for (let id = 0; id <= 15; id++) this.sprites.set(id, this.makeSprite(id))
    canvas.addEventListener('pointermove', this.onMove)
    canvas.addEventListener('pointerdown', this.onDown)
    canvas.addEventListener('pointerup', this.onUp)
    canvas.addEventListener('pointerleave', this.onLeave)
    canvas.addEventListener('keydown', this.onKey)
    canvas.addEventListener('keyup', this.onKeyUp)
    canvas.addEventListener('contextmenu', this.onContext)
    this.raf = requestAnimationFrame(this.loop)
  }

  dispose(): void {
    cancelAnimationFrame(this.raf)
    const c = this.canvas
    c.removeEventListener('pointermove', this.onMove)
    c.removeEventListener('pointerdown', this.onDown)
    c.removeEventListener('pointerup', this.onUp)
    c.removeEventListener('pointerleave', this.onLeave)
    c.removeEventListener('keydown', this.onKey)
    c.removeEventListener('keyup', this.onKeyUp)
    c.removeEventListener('contextmenu', this.onContext)
  }

  setProps(p: PoolEngineProps): void {
    const prev = this.props
    this.props = p
    const v = p.view
    if (this.lastRef === null) {
      // primeira visão: só mostra
      this.balls = cloneBalls(v.balls)
    } else if (v.ref !== this.lastRef) {
      this.waiting = false
      this.pocketLocked = false
      this.placed = null
      if (v.shot && v.shot.ref === v.ref && !p.reducedMotion) {
        const balls = cloneBalls(v.shot.before)
        strike(balls, v.shot.dx, v.shot.dy, v.shot.power)
        this.anim = { balls, log: newLog(), acc: 0, last: performance.now(), pocketed: 0 }
      } else {
        this.anim = null
        this.balls = cloneBalls(v.balls)
      }
    } else if (!this.anim) this.balls = cloneBalls(v.balls)
    if (this.lastRef !== v.ref || (prev && prev.view.turn !== v.turn)) this.placing = this.myTurn() && v.ballInHand
    this.lastRef = v.ref
    if (p.placeSeq !== this.placeSeq) {
      this.placeSeq = p.placeSeq
      if (this.myTurn() && v.ballInHand) {
        this.placing = true
        this.placed = null
      }
    }
    this.dirty = true
  }

  private myTurn(): boolean {
    const v = this.props?.view
    return !!v && !!v.you && v.turn === v.you.index && v.winner === null
  }

  private canAct(): boolean {
    return this.myTurn() && !this.anim && !this.waiting
  }

  private cue(): PBall | undefined {
    const c = this.balls.find((b) => b.id === 0 && !b.in)
    if (!c) return undefined
    return this.placed ? { ...c, ...this.placed } : c
  }

  // ---------- entrada ----------
  private toTable(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * CANVAS_W
    const py = ((e.clientY - r.top) / r.height) * CANVAS_H
    return { x: (px - RAIL) / PX, y: (py - RAIL) / PX }
  }

  private onMove = (e: PointerEvent): void => {
    this.mouse = this.toTable(e)
    const c = this.cue()
    if (c && !this.placing && this.charge === null) {
      const dx = this.mouse.x - c.x
      const dy = this.mouse.y - c.y
      const l = Math.hypot(dx, dy)
      if (l > 0.5) this.aim = { x: dx / l, y: dy / l }
    }
    this.dirty = true
  }

  private onLeave = (): void => {
    this.mouse = null
    this.dirty = true
  }

  private onContext = (e: Event): void => {
    e.preventDefault()
    this.charge = null
    this.dirty = true
  }

  private validSpot(x: number, y: number): boolean {
    const v = this.props?.view
    return !!v && canPlace(this.balls, x, y, v.behindLine ? HEAD_X : undefined)
  }

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0 || !this.canAct()) return
    this.canvas.focus()
    const m = this.toTable(e)
    const v = this.props!.view
    if (this.placing) {
      if (this.validSpot(m.x, m.y)) {
        this.placed = { x: m.x, y: m.y }
        this.placing = false
      }
      this.dirty = true
      return
    }
    // na 8: clicar perto de uma caçapa escolhe a caçapa
    if (v.onEight) {
      const k = POCKETS.findIndex((p) => Math.hypot(p.x - m.x, p.y - m.y) < p.r + 2.5)
      if (k >= 0) {
        this.pocket = k
        this.pocketLocked = true
        this.dirty = true
        return
      }
    }
    this.canvas.setPointerCapture(e.pointerId)
    this.charge = performance.now()
  }

  private onUp = (): void => {
    if (this.charge !== null) this.fire()
  }

  private onKey = (e: KeyboardEvent): void => {
    if (!this.canAct()) return
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      const a = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.002 : 0.02)
      const c = Math.cos(a)
      const s = Math.sin(a)
      this.aim = { x: this.aim.x * c - this.aim.y * s, y: this.aim.x * s + this.aim.y * c }
      this.dirty = true
    } else if (e.key === ' ' && !e.repeat && !this.placing) {
      e.preventDefault()
      this.charge = performance.now()
    } else if (e.key === 'Escape' && this.charge !== null) {
      e.stopPropagation()
      this.charge = null
      this.dirty = true
    }
  }

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === ' ' && this.charge !== null) {
      e.preventDefault()
      this.fire()
    }
  }

  private power(now = performance.now()): number {
    if (this.charge === null) return 0
    const t = ((now - this.charge) / CHARGE_MS) % 2
    return Math.max(0.02, t < 1 ? t : 2 - t)
  }

  private fire(): void {
    const p = this.props
    const power = this.power()
    this.charge = null
    if (!p || !this.canAct()) return
    const v = p.view
    if (v.onEight && this.pocket === null) return
    this.waiting = true
    p.onShoot({
      dx: this.aim.x,
      dy: this.aim.y,
      power,
      ...(v.ballInHand && this.placed ? { cue: this.placed } : {}),
      ...(v.onEight && this.pocket !== null ? { pocket: this.pocket } : {})
    })
    this.dirty = true
  }

  // ---------- desenho ----------
  private makeSprite(id: number): HTMLCanvasElement {
    const c = document.createElement('canvas')
    c.width = BALL_PX
    c.height = BALL_PX
    const g = c.getContext('2d') as CanvasRenderingContext2D
    ballGrid(id).forEach((row, y) =>
      [...row].forEach((ch, x) => {
        if (ch === '.') return
        g.fillStyle = ballFill(id, ch)
        g.fillRect(x, y, 1, 1)
      })
    )
    return c
  }

  private drawBall(b: { id: number; x: number; y: number }, alpha = 1): void {
    const s = this.sprites.get(b.id) as HTMLCanvasElement
    this.ctx.globalAlpha = alpha
    this.ctx.drawImage(s, Math.round(cx(b.x) - BALL_PX / 2), Math.round(cy(b.y) - BALL_PX / 2))
    this.ctx.globalAlpha = 1
  }

  /** linha de pixels (Bresenham), com tracejado opcional */
  private line(x0: number, y0: number, x1: number, y1: number, color: string, dash = 0): void {
    const ctx = this.ctx
    ctx.fillStyle = color
    let x = Math.round(x0)
    let y = Math.round(y0)
    const xe = Math.round(x1)
    const ye = Math.round(y1)
    const dx = Math.abs(xe - x)
    const dy = -Math.abs(ye - y)
    const sx = x < xe ? 1 : -1
    const sy = y < ye ? 1 : -1
    let err = dx + dy
    for (let i = 0; i < 2000; i++) {
      if (!dash || Math.floor(i / dash) % 2 === 0) ctx.fillRect(x, y, 1, 1)
      if (x === xe && y === ye) break
      const e2 = 2 * err
      if (e2 >= dy) {
        err += dy
        x += sx
      }
      if (e2 <= dx) {
        err += dx
        y += sy
      }
    }
  }

  private drawTable(): void {
    const ctx = this.ctx
    ctx.fillStyle = T.woodDark
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)
    ctx.fillStyle = T.wood
    ctx.fillRect(2, 2, CANVAS_W - 4, CANVAS_H - 4)
    ctx.fillStyle = T.woodLight
    ctx.fillRect(2, 2, CANVAS_W - 4, 1)
    ctx.fillStyle = T.cushion
    ctx.fillRect(RAIL - 5, RAIL - 5, TABLE_W * PX + 10, TABLE_H * PX + 10)
    ctx.fillStyle = T.felt
    ctx.fillRect(RAIL, RAIL, TABLE_W * PX, TABLE_H * PX)
    // linha de saída e marca do fundo
    for (let y = 0; y < TABLE_H * PX; y += 4) {
      ctx.fillStyle = T.line
      ctx.fillRect(cx(HEAD_X), RAIL + y, 1, 2)
    }
    ctx.fillRect(cx(75) - 1, cy(25) - 1, 2, 2)
    // marcas (diamantes) nas madeiras
    ctx.fillStyle = T.diamond
    for (let k = 1; k < 8; k++) if (k !== 4) for (const y of [4, CANVAS_H - 6]) ctx.fillRect(RAIL + (k * TABLE_W * PX) / 8 - 1, y, 2, 2)
    for (let k = 1; k < 4; k++) for (const x of [4, CANVAS_W - 6]) ctx.fillRect(x, RAIL + (k * TABLE_H * PX) / 4 - 1, 2, 2)
    // caçapas
    for (const [k, p] of POCKETS.entries()) {
      const r = p.r * PX * 0.95
      ctx.fillStyle = T.pocket
      ctx.beginPath()
      ctx.arc(Math.round(cx(p.x)), Math.round(cy(p.y)), r, 0, Math.PI * 2)
      ctx.fill()
      if (this.props?.view.onEight && this.myTurn() && this.pocket === k) {
        ctx.strokeStyle = '#FFC94A'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(Math.round(cx(p.x)), Math.round(cy(p.y)), r + 2, 0, Math.PI * 2)
        ctx.stroke()
      }
    }
  }

  private drawAim(now: number): void {
    const v = this.props?.view
    const cue = this.cue()
    if (!v || !cue) return
    const g = aimGuide(this.placed ? this.balls.map((b) => (b.id === 0 ? { ...b, ...this.placed } : b)) : this.balls, this.aim.x, this.aim.y)
    if (g) {
      this.line(cx(cue.x), cy(cue.y), cx(g.ghost.x), cy(g.ghost.y), 'rgba(243,235,221,0.75)', 3)
      if (g.hit !== null) {
        this.drawBall({ id: 0, x: g.ghost.x, y: g.ghost.y }, 0.35)
        const target = this.balls.find((b) => b.id === g.hit) as PBall
        if (g.object) this.line(cx(target.x), cy(target.y), cx(target.x + g.object.x * 14), cy(target.y + g.object.y * 14), '#FFC94A', 2)
        if (g.cue) this.line(cx(g.ghost.x), cy(g.ghost.y), cx(g.ghost.x + g.cue.x * 6), cy(g.ghost.y + g.cue.y * 6), 'rgba(243,235,221,0.5)', 1)
        // na 8 sem caçapa escolhida: sugere a que está na direção da bola
        if (v.onEight && g.hit === 8 && g.object && !this.pocketLocked) {
          let best = 0
          let bd = -Infinity
          POCKETS.forEach((p, k) => {
            const dx = p.x - target.x
            const dy = p.y - target.y
            const d = (dx * g.object!.x + dy * g.object!.y) / Math.hypot(dx, dy)
            if (d > bd) {
              bd = d
              best = k
            }
          })
          this.pocket = best
        }
      }
    }
    // taco
    const pull = 3 + this.power(now) * 14
    const sx = cx(cue.x) - this.aim.x * (BALL_PX / 2 + pull)
    const sy = cy(cue.y) - this.aim.y * (BALL_PX / 2 + pull)
    const ex = sx - this.aim.x * 90
    const ey = sy - this.aim.y * 90
    for (const o of [-1, 0, 1]) this.line(sx + -this.aim.y * o * 0.6, sy + this.aim.x * o * 0.6, ex + -this.aim.y * o * 1.2, ey + this.aim.x * o * 1.2, o === 0 ? '#D9B27C' : '#8A5E44')
    this.line(sx, sy, sx - this.aim.x * 3, sy - this.aim.y * 3, '#6FA3C7')
    // força
    if (this.charge !== null) {
      const w = 80
      const p = this.power(now)
      const ctx = this.ctx
      ctx.fillStyle = '#0F0B09'
      ctx.fillRect(CANVAS_W / 2 - w / 2 - 1, CANVAS_H - 9, w + 2, 6)
      ctx.fillStyle = p > 0.85 ? '#E05A4A' : '#FFC94A'
      ctx.fillRect(CANVAS_W / 2 - w / 2, CANVAS_H - 8, Math.round(w * p), 4)
    }
  }

  private loop = (now: number): void => {
    this.raf = requestAnimationFrame(this.loop)
    const a = this.anim
    if (a) {
      a.acc += Math.min(100, now - a.last) * (HZ / 1000)
      a.last = now
      let moving = true
      while (a.acc >= 1 && moving) {
        a.acc -= 1
        moving = step(a.balls, a.log) && a.log.steps < MAX_STEPS
      }
      if (a.log.pocketed.length > a.pocketed) {
        a.pocketed = a.log.pocketed.length
        this.props?.onSfx?.('cup')
      }
      this.balls = a.balls
      if (!moving) {
        // fim da animação: vale o que o servidor mandou
        this.anim = null
        this.balls = cloneBalls(this.props?.view.balls ?? a.balls)
      }
      this.dirty = true
    }
    if (this.charge !== null) this.dirty = true
    if (!this.dirty) return
    this.dirty = false
    this.draw(now)
  }

  private draw(now: number): void {
    this.drawTable()
    const v = this.props?.view
    const placingHere = this.placing && this.canAct() && this.mouse
    for (const b of this.balls) {
      if (b.in) continue
      if (b.id === 0 && (placingHere || this.placed)) continue
      this.drawBall(b)
    }
    if (this.canAct() && v) {
      if (placingHere && this.mouse) {
        const ok = this.validSpot(this.mouse.x, this.mouse.y)
        this.drawBall({ id: 0, x: this.mouse.x, y: this.mouse.y }, ok ? 0.9 : 0.35)
        if (!ok) this.line(cx(this.mouse.x) - 3, cy(this.mouse.y) - 3, cx(this.mouse.x) + 3, cy(this.mouse.y) + 3, '#E05A4A')
      } else if (!this.placing) {
        if (this.placed) this.drawBall({ id: 0, ...this.placed })
        this.drawAim(now)
      }
    }
  }
}
