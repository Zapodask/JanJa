// O primeiro import do Pixi precisa ser este (o CSP do site proíbe eval).
import 'pixi.js/unsafe-eval'
import '@fontsource-variable/pixelify-sans/wght.css'
import { Application, Assets, Container, Graphics, Sprite, Texture, TextureSource } from 'pixi.js'
import type { Spritesheet } from 'pixi.js'
import gsap from 'gsap'
import { PALETTE } from '../art/palette'
import { DIGIT_1, RANK_GLYPHS } from '../art/glyphs'
import type { Sprite as Rows } from '../art/palette'
import { TABLE } from '../../../shared/games/poker/types'
import type { Card, PokerView, RankingEntry, SeatView } from '../../../shared/games/poker/types'
import type { PokerSceneProps, Rect } from '../contract'
import { SeqGate, bubbleText, planSteps, timeScale, totalMs } from './plan'
import type { Step } from './plan'
import { composeRoom, composeVignette } from './room'
import { cardSprite, chipPlan, computeScene, computeViewport, pileSprite, seatPositions, stackPlan, toCss, tvCssRects } from './layout'
import type { Pile, SceneGeom, SeatSpot, Viewport } from './layout'

const FONT_CSS = '400 10px "Pixelify Sans Variable", monospace'
const WALL_COLOR = '#221C19'
const DEFAULT_COLORS = ['#FFC94A', '#FF7A6B', '#6FD49B', '#7FB7E6', '#E8B48A', '#D9CCB8', '#C98E66', '#8A5A34']

const hex = (c: string) => parseInt(c.replace('#', ''), 16)
const darken = (c: number, k: number) => (Math.round(((c >> 16) & 255) * k) << 16) | (Math.round(((c >> 8) & 255) * k) << 8) | Math.round((c & 255) * k)

/** Desenha linhas de letras num canvas (paleta do jogo). */
export function rowsToCanvas(rows: Rows): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = rows[0].length
  cv.height = rows.length
  const ctx = cv.getContext('2d')!
  rows.forEach((line, y) =>
    [...line].forEach((ch, x) => {
      if (ch === '.') return
      ctx.fillStyle = PALETTE[ch]
      ctx.fillRect(x, y, 1, 1)
    })
  )
  return cv
}

/** Números em fonte 5x7 desenhada à mão (5, 3, 6 e 8 ficam inconfundíveis); letras em Pixelify Sans. */
const ZERO = ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.']
const DIGIT: Record<string, string[]> = { ...RANK_GLYPHS, '0': ZERO, '1': DIGIT_1 }

/**
 * Texto pixel perfeito: letras em Pixelify Sans 10 px sem suavização (limiar de alfa), números na fonte 5x7,
 * contorno de 1 px. Branco + preto, então `tint` colore o miolo.
 */
function renderPx(str: string): HTMLCanvasElement {
  const probe = document.createElement('canvas').getContext('2d')!
  probe.font = FONT_CSS
  const runs = str.match(/\d+|\D+/g) ?? []
  const widths = runs.map((r) => (/\d/.test(r[0]) ? r.length * 6 - 1 : Math.ceil(probe.measureText(r).width)))
  const w = widths.reduce((a, b) => a + b, 0) + 4
  const H = 15
  const mask = new Uint8Array(w * H)
  let xo = 2
  runs.forEach((r, k) => {
    if (/\d/.test(r[0])) {
      ;[...r].forEach((ch, i) => DIGIT[ch].forEach((line, y) => [...line].forEach((c, x) => c === '#' && (mask[(y + 2) * w + xo + i * 6 + x] = 1))))
    } else {
      const a = document.createElement('canvas')
      a.width = widths[k] + 2
      a.height = H
      const x = a.getContext('2d', { willReadFrequently: true })!
      x.font = FONT_CSS
      x.fillStyle = '#fff'
      x.textBaseline = 'top'
      x.fillText(r, 0, 1)
      const d = x.getImageData(0, 0, a.width, H)
      for (let j = 0; j < H; j++) for (let i = 0; i < a.width; i++) if (d.data[(j * a.width + i) * 4 + 3] > 127 && xo + i < w) mask[j * w + xo + i] = 1
    }
    xo += widths[k] + (/\d/.test(r[0]) ? 1 : 0)
  })
  const on = (i: number, j: number) => i >= 0 && j >= 0 && i < w && j < H && mask[j * w + i] === 1
  const out = document.createElement('canvas')
  out.width = w
  out.height = H
  const ox = out.getContext('2d')!
  const img = ox.createImageData(w, H)
  for (let j = 0; j < H; j++)
    for (let i = 0; i < w; i++) {
      const o = (j * w + i) * 4
      if (on(i, j)) {
        img.data[o] = img.data[o + 1] = img.data[o + 2] = 255
        img.data[o + 3] = 255
      } else if (on(i - 1, j) || on(i + 1, j) || on(i, j - 1) || on(i, j + 1) || on(i - 1, j - 1) || on(i + 1, j + 1) || on(i - 1, j + 1) || on(i + 1, j - 1)) img.data[o + 3] = 255
    }
  ox.putImageData(img, 0, 0)
  return out
}

class PxText extends Sprite {
  private t = ''
  constructor(text: string) {
    super(Texture.EMPTY)
    this.text = text
  }
  get text() {
    return this.t
  }
  set text(v: string) {
    if (v === this.t && (v === '' || this.texture !== Texture.EMPTY)) return
    this.t = v
    const old = this.texture
    this.texture = v ? Texture.from(renderPx(v)) : Texture.EMPTY
    if (old !== Texture.EMPTY) old.destroy(true)
  }
  override destroy(o?: Parameters<Sprite['destroy']>[0]) {
    const t = this.texture
    super.destroy(o)
    if (t !== Texture.EMPTY) t.destroy(true)
  }
}

interface SeatNode {
  pid: string
  holes: Sprite[]
  holeLayer: Container
  root: Container
  stackLayer: Container
  frame: Sprite
  fill: Graphics
  initial: PxText
  ring: Sprite
  name: PxText
  stackT: PxText
  tag: PxText
  btns: Container
  bet: Container
  betKey: string
  stackKey: string
  spot: SeatSpot
  color: number
  seat: SeatView | null
}

class JanPlayer {
  frames: Record<string, Texture[]> = {}
  sprite: Sprite
  cur = 'jan_idle'
  i = 0
  acc = 0
  fps = 2
  until = 0
  constructor(sheet: Spritesheet) {
    for (const k of Object.keys(sheet.animations)) if (k.startsWith('jan_')) this.frames[k] = sheet.animations[k]
    this.sprite = new Sprite(this.frames.jan_idle[0])
    this.sprite.anchor.set(0.5, 1)
  }
  play(name: string, fps: number, ms: number) {
    this.cur = name
    this.i = 0
    this.acc = 0
    this.fps = fps
    this.until = ms > 0 ? performance.now() + ms : 0
    this.sprite.texture = this.frames[name][0]
  }
  idle() {
    this.play('jan_idle', 2, 0)
  }
  update(dtMs: number) {
    if (this.until && performance.now() > this.until) return this.idle()
    this.acc += dtMs
    const step = 1000 / this.fps
    if (this.acc >= step) {
      this.acc -= step
      const fr = this.frames[this.cur]
      this.i = (this.i + 1) % fr.length
      this.sprite.texture = fr[this.i]
    }
  }
}

interface Particle {
  s: Sprite
  vx: number
  vy: number
  life: number
}

export interface EngineCallbacks {
  onTvRects?: (r: Rect[]) => void
  onTvClick?: (i: number) => void
  onAnchors?: PokerSceneProps['onAnchors']
}

export class SceneEngine {
  app!: Application
  private sheet!: Spritesheet
  private props: PokerSceneProps | null = null
  private cb: EngineCallbacks = {}
  private cw = 0
  private ch = 0
  private vp!: Viewport
  private geom!: SceneGeom
  private geomKey = ''
  private ready = false
  private dead = false
  private gate = new SeqGate()
  private chain: Promise<void> = Promise.resolve()
  private backlog = 0
  private timeMul = 1
  private tweens = new Set<gsap.core.Tween>()
  private lastRects = ''
  private lastAnchors = ''

  // camadas
  private world = new Container()
  private room = new Sprite()
  private vignette = new Sprite()
  private tvHit = new Container()
  private noise: { canvas: HTMLCanvasElement; tex: Texture; sprite: Sprite; t: number } | null = null
  private stackLayer = new Container()
  private holeLayer = new Container()
  private seatLayer = new Container()
  private tableLayer = new Container()
  private cardLayer = new Container()
  private janLayer = new Container()
  private lampLayer = new Container()
  private lightLayer = new Container()
  private fx = new Container()
  private overlay = new Container()

  private nodes = new Map<string, SeatNode>()
  private slots: Sprite[] = []
  private board: Sprite[] = []
  private deck = new Container()
  private potNode = new Container()
  private jan!: JanPlayer
  private lamp = new Sprite()
  private cord = new Graphics()
  private light = new Sprite()
  private spot = new Sprite()
  private lightBase = 0.2
  private particles: Particle[] = []
  private pulse: { s: Sprite; baseY: number; k: number }[] = []
  private drizzleT = 0
  private podium: Container | null = null
  private clock = 0

  // seguram o estado estático enquanto a animação não chegou
  private holeShown = new Map<string, number>()
  private lastHole = new Map<string, number>()
  private backHold = new Set<string>()
  private boardShown: number | null = null
  private lastBoard = 0
  private betHold = new Map<string, number>()
  private hlHold = false
  private podiumHold = false
  private spotPid: string | null = null

  constructor(private host: HTMLElement) {}

  // ---------------------------------------------------------------- ciclo de vida
  async init(): Promise<void> {
    TextureSource.defaultOptions.scaleMode = 'nearest'
    const app = new Application()
    // diagnóstico: localStorage 'janja.debug.renderer' = 'canvas' força o renderizador 2D (dá para capturar a tela em testes)
    let preference: 'webgl' | 'canvas' = 'webgl'
    try {
      if (localStorage.getItem('janja.debug.renderer') === 'canvas') preference = 'canvas'
    } catch {
      /* sem storage */
    }
    await app.init({ width: 480, height: 270, antialias: false, roundPixels: true, resolution: 1, autoDensity: false, background: WALL_COLOR, preference })
    if (this.dead) return app.destroy(true, { children: true })
    this.app = app
    const cv = app.canvas
    cv.style.position = 'absolute'
    cv.style.imageRendering = 'pixelated'
    cv.style.display = 'block'
    this.host.appendChild(cv)

    // o CSP do site não permite worker de blob: decodifica as imagens na thread principal (é uma imagem só)
    Assets.setPreferences({ preferWorkers: false })
    this.sheet = await Assets.load<Spritesheet>('/game/sprites.json')
    await document.fonts.load('10px "Pixelify Sans Variable"').catch(() => undefined)
    if (this.dead) return
    this.build()
    this.ready = true
    app.ticker.add((t) => this.update(t.deltaMS))
    if (this.props) this.applyProps(this.props, true)
    ;(this.host as HTMLElement & { __engine?: SceneEngine }).__engine = this
    this.host.setAttribute('data-scene-ready', '1')
  }

  destroy() {
    this.dead = true
    this.tweens.forEach((t) => t.kill())
    this.tweens.clear()
    if (this.app) {
      try {
        this.app.destroy(true, { children: true })
      } catch {
        /* já destruído */
      }
    }
  }

  private tex(name: string): Texture {
    const t = this.sheet.textures[name]
    if (!t) throw new Error(`textura ausente: ${name}`)
    return t
  }
  private spr(name: string, ax = 0.5, ay = 0.5): Sprite {
    const s = new Sprite(this.tex(name))
    s.anchor.set(ax, ay)
    return s
  }
  private text(str: string, tint = 0xf3ebdd): PxText {
    const t = new PxText(str)
    t.tint = tint
    return t
  }

  private build() {
    const w = this.world
    this.app.stage.addChild(w)
    this.jan = new JanPlayer(this.sheet)
    this.janLayer.addChild(this.jan.sprite)
    this.light = this.spr('light_normal', 0.5, 0)
    this.light.blendMode = 'add'
    this.spot = this.spr('light_spot', 0.5, 0)
    this.spot.blendMode = 'add'
    this.spot.alpha = 0
    this.lamp = this.spr('lamp', 0.5, 0)
    this.lampLayer.addChild(this.cord, this.lamp)
    this.lightLayer.addChild(this.light, this.spot, this.vignette)
    this.vignette.alpha = 0.5
    for (let i = 0; i < 5; i++) {
      const s = this.spr('card_slot')
      this.slots.push(s)
      const c = this.spr('card_back')
      c.visible = false
      this.board.push(c)
      this.tableLayer.addChild(s)
      this.cardLayer.addChild(c)
    }
    for (let i = 0; i < 4; i++) {
      const d = this.spr('card_mini_back')
      d.position.set(-i, -i)
      this.deck.addChild(d)
    }
    this.tableLayer.addChild(this.deck, this.potNode)
    w.addChild(this.room, this.tvHit, this.stackLayer, this.holeLayer, this.seatLayer, this.tableLayer, this.cardLayer, this.janLayer, this.lampLayer, this.lightLayer, this.fx, this.overlay)
    this.jan.idle()
  }

  // ---------------------------------------------------------------- props e layout
  setProps(p: PokerSceneProps) {
    this.props = p
    this.cb = { onTvRects: p.onTvRects, onTvClick: p.onTvClick, onAnchors: p.onAnchors }
    if (this.ready) this.applyProps(p, false)
  }

  resize(cw: number, ch: number) {
    this.cw = cw
    this.ch = ch
    if (this.ready && this.props) this.applyProps(this.props, true)
  }

  private applyProps(p: PokerSceneProps, force: boolean) {
    if (!this.cw || !this.ch) return
    // 1) eventos novos: segura o estado e enfileira os passos antes de desenhar a visão nova
    if (this.gate.accept(p.lastEvents) && p.lastEvents) this.enqueue(planSteps(p.lastEvents.events))
    // 2) geometria
    const vp = computeViewport(this.cw, this.ch, p.layout)
    const key = `${vp.w}x${vp.h}|${p.layout}|${p.tvCount}|${vp.scale}|${vp.offX}|${vp.offY}`
    if (force || key !== this.geomKey) {
      this.geomKey = key
      this.vp = vp
      this.geom = computeScene(vp.w, vp.h, vp.orientation, p.layout, p.tvCount)
      this.layout()
    }
    // 3) visão
    this.syncView()
    this.report()
  }

  private layout() {
    const g = this.geom
    const vp = this.vp
    this.app.renderer.resize(vp.w, vp.h)
    const cv = this.app.canvas
    cv.style.width = `${vp.cssW}px`
    cv.style.height = `${vp.cssH}px`
    cv.style.left = `${vp.offX}px`
    cv.style.top = `${vp.offY}px`
    const old = this.room.texture
    this.room.texture = Texture.from(rowsToCanvas(composeRoom(g)))
    if (old !== Texture.EMPTY && old !== Texture.WHITE) old.destroy(true)
    const ov = this.vignette.texture
    this.vignette.texture = Texture.from(rowsToCanvas(composeVignette(g.w, g.h)))
    if (ov !== Texture.EMPTY && ov !== Texture.WHITE) ov.destroy(true)
    // TVs: áreas clicáveis e chiado da TV decorativa
    this.tvHit.removeChildren().forEach((c) => c.destroy())
    g.tvs.forEach((t, i) => {
      const hit = new Graphics().rect(t.frame.x, t.frame.y, t.frame.w, t.frame.h).fill({ color: 0xffffff, alpha: 0.001 })
      hit.eventMode = g.tvDecor ? 'none' : 'static'
      hit.cursor = 'pointer'
      hit.on('pointertap', () => this.cb.onTvClick?.(i))
      this.tvHit.addChild(hit)
    })
    this.noise?.sprite.destroy()
    this.noise = null
    if (g.tvDecor && g.tvs[0]) {
      const h = g.tvs[0].hole
      const canvas = document.createElement('canvas')
      canvas.width = h.w
      canvas.height = h.h
      const tex = Texture.from(canvas)
      const sprite = new Sprite(tex)
      sprite.position.set(h.x, h.y)
      this.tvHit.addChild(sprite)
      this.noise = { canvas, tex, sprite, t: 0 }
      this.drawNoise()
    }
    // abajur e luz
    const lx = g.lampX
    this.lamp.visible = lx !== null
    this.light.visible = lx !== null
    this.cord.clear()
    if (lx !== null) {
      this.lamp.position.set(lx, 0)
      this.light.position.set(lx, 34)
      this.spot.position.set(lx, 0)
    } else {
      this.light.visible = true
      this.light.position.set(g.center.x, -20)
    }
    // mesa: cartas comunitárias, monte, Jan
    g.board.forEach((b, i) => {
      this.slots[i].position.set(b.x, b.y)
      this.board[i].position.set(b.x, b.y)
    })
    this.deck.position.set(g.deck.x, g.deck.y)
    this.jan.sprite.position.set(g.jan.x, g.jan.y)
    this.potNode.position.set(g.pot.x, g.pot.y)
    // seats serão reposicionados em syncView (n pode ter mudado)
    for (const n of this.nodes.values()) n.betKey = n.stackKey = ''
    if (this.podium) {
      this.podium.destroy({ children: true })
      this.podium = null
    }
  }

  private drawNoise() {
    const n = this.noise
    if (!n) return
    const ctx = n.canvas.getContext('2d')!
    const { width: w, height: h } = n.canvas
    const cols = ['#0F0B09', '#221C19', '#2E2622', '#3B312C', '#B7A99A']
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const r = Math.random()
        ctx.fillStyle = cols[r < 0.45 ? 0 : r < 0.75 ? 1 : r < 0.92 ? 2 : r < 0.985 ? 3 : 4]
        ctx.fillRect(x, y, 1, 1)
      }
    // faixa rolando
    const band = Math.floor(n.t * 20) % (h + 8)
    ctx.fillStyle = 'rgba(243,235,221,0.10)'
    ctx.fillRect(0, band, w, 3)
    n.tex.source.update()
  }

  private report() {
    const rects = tvCssRects(this.geom, this.vp)
    const rk = JSON.stringify(rects)
    if (rk !== this.lastRects) {
      this.lastRects = rk
      this.cb.onTvRects?.(rects)
    }
    if (this.cb.onAnchors && this.props) {
      const g = this.geom
      const seats: Record<string, Rect> = {}
      for (const [pid, n] of this.nodes) seats[pid] = toCss({ x: n.spot.x - 14, y: n.spot.y - 14, w: 28, h: 28 }, this.vp)
      const anchors = {
        myHand: toCss({ x: g.hand.x - 26, y: g.hand.y - 48, w: 52, h: 48 }, this.vp),
        pot: toCss({ x: g.pot.x - 40, y: g.pot.y - 8, w: 80, h: 18 }, this.vp),
        seats
      }
      const ak = JSON.stringify(anchors)
      if (ak !== this.lastAnchors) {
        this.lastAnchors = ak
        this.cb.onAnchors(anchors)
      }
    }
  }

  // ---------------------------------------------------------------- estado estático
  private colorOf(pid: string, i: number): number {
    return hex(this.props?.colors[pid] ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length])
  }

  private ringOrder(view: PokerView, me: string | null): SeatView[] {
    const seats = [...view.seats].sort((a, b) => a.seat - b.seat)
    const mi = me ? seats.findIndex((s) => s.playerId === me) : -1
    if (mi <= 0) return seats
    return [...seats.slice(mi), ...seats.slice(0, mi)]
  }

  private makeNode(pid: string): SeatNode {
    const root = new Container()
    const holeLayer = new Container()
    const stackLayer = new Container()
    const frame = this.spr('avatar_frame', 0.5, 0.5)
    const fill = new Graphics()
    const initial = this.text('?', 0xf3ebdd)
    initial.anchor.set(0.5, 0.5)
    const ring = this.spr('timer_ring_0')
    ring.visible = false
    const name = this.text('', 0xf3ebdd)
    const stackT = this.text('', 0xffc94a)
    const tag = this.text('', 0xff7a6b)
    const btns = new Container()
    const bet = new Container()
    root.addChild(fill, frame, initial, ring, name, stackT, tag)
    this.seatLayer.addChild(root)
    this.holeLayer.addChild(holeLayer)
    this.stackLayer.addChild(stackLayer)
    this.tableLayer.addChild(bet, btns)
    return { pid, holes: [], holeLayer, root, stackLayer, frame, fill, initial, ring, name, stackT, tag, btns, bet, betKey: '', stackKey: '', spot: { x: 0, y: 0, angle: 0, dx: 0, dy: -1, label: 'below' }, color: 0xffffff, seat: null }
  }

  private destroyNode(n: SeatNode) {
    n.root.destroy({ children: true })
    n.holeLayer.destroy({ children: true })
    n.stackLayer.destroy({ children: true })
    n.btns.destroy({ children: true })
    n.bet.destroy({ children: true })
  }

  /** Cartas a mostrar de cada jogador, já descontando o que a animação ainda não entregou. */
  private holeCount(s: SeatView): number {
    if (this.holeShown.has(s.playerId)) return this.holeShown.get(s.playerId)!
    if (s.status === 'desistiu' || s.status === 'fora') return 0
    return s.cardCount
  }

  private hlSet(): Set<string> {
    const v = this.props?.view
    const out = new Set<string>()
    if (!v?.showdown || this.hlHold) return out
    for (const w of v.showdown.winners) if (w.hand) for (const c of w.hand.cards) out.add(c)
    return out
  }

  private syncView() {
    const p = this.props!
    const view = p.view
    const g = this.geom
    const me = p.me
    const order = this.ringOrder(view, me)
    const spots = seatPositions(order.length, g)
    const seen = new Set<string>()
    const hl = this.hlSet()
    const holdem = view.mode === 'holdem'

    order.forEach((s, i) => {
      seen.add(s.playerId)
      let n = this.nodes.get(s.playerId)
      if (!n) {
        n = this.makeNode(s.playerId)
        this.nodes.set(s.playerId, n)
      }
      n.seat = s
      n.spot = spots[i]
      const isMe = s.playerId === me
      n.color = this.colorOf(s.playerId, i)
      const sp = n.spot
      n.root.position.set(sp.x, sp.y)
      // avatar: miolo escuro na cor do jogador + inicial
      n.frame.tint = n.color
      n.fill.clear().rect(-10, -10, 20, 20).fill(darken(n.color, 0.42))
      n.initial.text = (s.name[0] ?? '?').toUpperCase()
      n.initial.tint = n.color
      n.ring.tint = n.color
      const out = s.status === 'desistiu' || s.status === 'fora' || s.status === 'zerado' || !s.present || s.status === 'ausente'
      n.root.alpha = out ? 0.55 : 1
      // nome, stack e etiqueta
      n.name.text = s.name.length > 9 ? `${s.name.slice(0, 8)}.` : s.name
      n.stackT.text = String(s.stack)
      n.tag.text = s.status === 'allin' ? 'Tudo' : s.status === 'desistiu' ? 'Desistiu' : s.status === 'zerado' ? 'Zerado' : s.status === 'fora' ? 'Fora' : !s.present || s.status === 'ausente' ? 'Ausente' : ''
      n.tag.tint = s.status === 'allin' ? 0xffc94a : 0xb7a99a
      const side = sp.label
      const hasTag = n.tag.text !== ''
      n.tag.visible = hasTag
      if (side === 'below') {
        n.name.anchor.set(0.5, 0)
        n.stackT.anchor.set(0.5, 0)
        n.tag.anchor.set(0.5, 0)
        n.name.position.set(0, 13)
        n.stackT.position.set(0, 24)
        n.tag.position.set(0, 35)
      } else {
        const right = side === 'right'
        n.name.anchor.set(right ? 0 : 1, 0)
        n.stackT.anchor.set(right ? 0 : 1, 0)
        n.tag.anchor.set(right ? 0 : 1, 0)
        const x = right ? 16 : -16
        const y0 = hasTag ? -17 : -11
        n.name.position.set(x, y0)
        n.stackT.position.set(x, y0 + 11)
        n.tag.position.set(x, y0 + 22)
      }
      // cartas do jogador
      const count = this.holeCount(s)
      if (!this.holeShown.has(s.playerId)) this.lastHole.set(s.playerId, count)
      this.syncHoles(n, count, isMe, hl)
      // fichas do stack (proporcionais ao valor), ao lado do avatar, do lado oposto ao nome
      const sk = `${s.stack > 0 ? stackPlan(s.stack).slice(0, 2).map((q) => `${q.color}${q.count}`).join('') : ''}|${sp.x},${sp.y}`
      if (sk !== n.stackKey) {
        n.stackKey = sk
        this.fillPiles(n.stackLayer, s.stack > 0 ? stackPlan(s.stack).slice(0, 2) : [], 0)
        const out = sp.label === 'right' ? -1 : sp.label === 'left' ? 1 : sp.x >= g.center.x ? 1 : -1
        const topC = sp.dy > 0.5 && Math.abs(sp.dx) < 0.3
        n.stackLayer.position.set(sp.x + out * (topC ? 56 : 25), sp.y + 12)
      }
      // aposta da rodada
      const held = (this.betHold.get(s.playerId) ?? 0) > 0
      const bk = `${held ? 0 : s.bet}|${sp.x},${sp.y}`
      if (bk !== n.betKey) {
        n.betKey = bk
        n.bet.removeChildren().forEach((c) => c.destroy())
        const amt = held ? 0 : s.bet
        if (amt > 0) {
          const piles = chipPlan(amt)
          const pc = new Container()
          this.fillPiles(pc, piles, 0)
          const lbl = this.text(String(amt), 0xf3ebdd)
          lbl.anchor.set(0.5, 0)
          lbl.position.set(0, 2)
          n.bet.addChild(pc, lbl)
        }
        const bp = this.betPos(n, isMe)
        n.bet.position.set(bp.x, bp.y)
      }
      // botões D / SB / BB
      n.btns.removeChildren().forEach((c) => c.destroy())
      const list: string[] = []
      if (s.dealer) list.push('btn_dealer')
      if (s.smallBlind) list.push('btn_sb')
      if (s.bigBlind) list.push('btn_bb')
      // selos nos cantos de cima do avatar (D no direito; SB/BB no esquerdo)
      const badgeAt: [number, number][] = [[15, -14], [-15, -14], [0, -21]]
      list.forEach((nm, k) => {
        const b = this.spr(nm)
        b.position.set(sp.x + badgeAt[k][0], sp.y + badgeAt[k][1])
        n!.btns.addChild(b)
      })
    })
    for (const [pid, n] of this.nodes)
      if (!seen.has(pid)) {
        this.destroyNode(n)
        this.nodes.delete(pid)
        this.lastHole.delete(pid)
      }

    // tabuleiro
    const shown = this.boardShown ?? view.board.length
    if (this.boardShown === null) this.lastBoard = view.board.length
    this.pulse = this.pulse.filter((q) => !q.s.destroyed)
    this.slots.forEach((s, i) => (s.visible = holdem && i >= shown))
    this.board.forEach((c, i) => {
      const card = view.board[i]
      const vis = holdem && i < shown && !!card && !this.flipping.has(i)
      c.visible = vis
      if (vis && card) {
        const lit = hl.has(card)
        c.texture = this.tex(cardSprite(card) + (lit ? '_hl' : ''))
        c.alpha = hl.size && !lit ? 0.5 : 1
        c.y = this.geom.board[i].y
        if (lit) this.pulse.push({ s: c, baseY: this.geom.board[i].y, k: i })
      } else if (!vis) c.alpha = 1
    })
    this.deck.visible = true
    this.syncPot(view)
    this.syncLight(view)
    if (view.phase === 'fim' && view.ranking && !this.podiumHold && !this.podium) this.showPodium(view.ranking, false)
    if (view.phase !== 'fim' && this.podium) this.hidePodium()
  }

  private flipping = new Set<number>()

  private betPos(n: SeatNode, me: boolean): { x: number; y: number } {
    const g = this.geom
    if (me) return g.meBet
    const sp = n.spot
    if (sp.dy > 0.5 && Math.abs(sp.dx) < 0.3) return { x: sp.x + 38, y: sp.y + 30 }
    const t = 0.36
    return { x: Math.round(sp.x + (g.center.x - sp.x) * t), y: Math.round(sp.y + (g.center.y - sp.y) * t) }
  }

  /** Posição da carta i de `count`. Fechadas dos outros = mini; viradas = tamanho cheio, mais para dentro da mesa. */
  private holePos(n: SeatNode, i: number, count: number, me: boolean, face = false): { x: number; y: number } {
    const g = this.geom
    let bx: number
    let by: number
    let gap: number
    if (me) {
      bx = g.hand.x
      by = g.hand.y - 24
      gap = 20
    } else {
      const sp = n.spot
      const inward = face ? (Math.abs(sp.dx) > 0.5 ? 48 : 38) : 19
      bx = sp.x + sp.dx * inward
      by = sp.y + sp.dy * inward
      if (sp.dy > 0.5 && Math.abs(sp.dx) < 0.3) {
        bx = sp.x - (face ? 66 : 29)
        by = sp.y + (face ? 24 : 6)
      }
      gap = face ? 24 : 6
    }
    return { x: Math.round(bx + (i - (count - 1) / 2) * gap), y: Math.round(by) }
  }

  private syncHoles(n: SeatNode, count: number, me: boolean, hl: Set<string>) {
    while (n.holes.length < 3) {
      const h = this.spr('card_back')
      n.holes.push(h)
      n.holeLayer.addChild(h)
    }
    const s = n.seat!
    const faceUp = !!s.cards && (me || !this.backHold.has(s.playerId))
    n.holes.forEach((h, i) => {
      h.visible = i < count && !this.flyingHole.has(`${s.playerId}:${i}`) && !this.flipLock.has(`${s.playerId}:${i}`)
      if (!h.visible) return
      const card: Card | undefined = faceUp ? s.cards?.[i] : undefined
      const pos = this.holePos(n, i, count, me, !!card && !me)
      h.position.set(pos.x, pos.y)
      h.scale.set(1)
      const lit = !!card && hl.has(card)
      h.texture = this.tex(card ? cardSprite(card) + (lit ? '_hl' : '') : me ? 'card_back' : 'card_mini_back')
      h.alpha = s.status === 'desistiu' ? 0.5 : hl.size && !lit && card ? 0.6 : 1
      if (lit) this.pulse.push({ s: h, baseY: pos.y, k: i + 5 })
    })
  }

  private flipLock = new Set<string>()
  private flyingHole = new Set<string>()

  private fillPiles(c: Container, piles: Pile[], gapY: number) {
    c.removeChildren().forEach((x) => x.destroy())
    const total = piles.length * 13 - 1
    piles.forEach((q, i) => {
      const s = this.spr(pileSprite(q.color, q.count), 0.5, 1)
      s.position.set(Math.round(i * 13 - total / 2 + 6), gapY)
      c.addChild(s)
    })
  }

  private potKey = ''
  private potHold = 0
  private lastPot = { total: 0, side: 0 }
  private syncPot(view: PokerView) {
    let total = view.pots.reduce((a, q) => a + q.amount, 0)
    let side = view.pots.slice(1).reduce((a, q) => a + q.amount, 0)
    if (this.potHold > 0) ({ total, side } = this.lastPot)
    else this.lastPot = { total, side }
    if (view.phase === 'fim' && view.ranking) total = 0
    const key = `${total}|${side}|${this.geom.pot.x}`
    if (key === this.potKey) return
    this.potKey = key
    this.potNode.removeChildren().forEach((c) => c.destroy())
    if (total <= 0) return
    const label = side > 0 ? `Pote ${total - side}  Lateral ${side}` : `Pote ${total}`
    const t = this.text(label, 0xffc94a)
    t.anchor.set(0.5, 0)
    t.position.set(0, -1)
    const pc = new Container()
    this.fillPiles(pc, chipPlan(total), 0)
    const w = t.width
    pc.position.set(-w / 2 - 10 - (chipPlan(total).length * 13) / 2, 9)
    this.potNode.addChild(t, pc)
  }

  private syncLight(view: PokerView) {
    const allin = view.seats.some((s) => s.status === 'allin') && view.phase !== 'intervalo' && view.phase !== 'showdown'
    void allin
    this.light.alpha = this.spotPid ? 0.07 : this.lightBase
  }

  // ---------------------------------------------------------------- fila de animações
  private enqueue(steps: Step[]) {
    if (!steps.length) return
    steps.forEach((s) => this.prepare(s))
    this.backlog += totalMs(steps)
    for (const s of steps) {
      this.chain = this.chain.then(async () => {
        if (this.dead) return
        this.timeMul = timeScale(this.backlog, !!this.props?.reducedMotion)
        try {
          await this.run(s)
        } catch (e) {
          console.error('animação falhou', s.kind, e)
        }
        this.backlog = Math.max(0, this.backlog - s.ms)
      })
    }
  }

  private prepare(s: Step) {
    const me = this.props?.me ?? null
    switch (s.kind) {
      case 'deal':
        for (const pid of s.to) {
          this.holeShown.set(pid, 0)
          if (pid === me) this.backHold.add(pid)
        }
        break
      case 'street':
        if (this.boardShown === null) this.boardShown = this.lastBoard
        break
      case 'chips':
      case 'allin':
        this.betHold.set(s.by, (this.betHold.get(s.by) ?? 0) + 1)
        this.potHold++
        break
      case 'fold':
        this.holeShown.set(s.by, this.lastHole.get(s.by) ?? 2)
        break
      case 'reveal':
        if (s.by !== me) this.backHold.add(s.by)
        break
      case 'win':
        this.hlHold = true
        this.potHold++
        break
      case 'end':
        this.podiumHold = true
        break
      default:
        break
    }
  }

  // ---------------------------------------------------------------- utilitários de animação
  private d(ms: number) {
    return ms * this.timeMul
  }

  private tween(ms: number, ease: string, fn: (p: number) => void): Promise<void> {
    const d = this.d(ms)
    if (d <= 0 || this.dead) {
      fn(1)
      return Promise.resolve()
    }
    return new Promise((res) => {
      const o = { p: 0 }
      const tw = gsap.to(o, {
        p: 1,
        duration: d / 1000,
        ease,
        onUpdate: () => fn(o.p),
        onComplete: () => {
          this.tweens.delete(tw)
          fn(1)
          res()
        }
      })
      this.tweens.add(tw)
    })
  }

  private wait(ms: number) {
    return this.tween(ms, 'none', () => undefined)
  }

  private reduced() {
    return !!this.props?.reducedMotion
  }

  private seatNode(pid: string) {
    return this.nodes.get(pid)
  }

  /** Voa um sprite em arco de a até b. */
  private fly(s: Sprite, a: { x: number; y: number }, b: { x: number; y: number }, ms: number, opt: { arc?: number; ease?: string; rot?: number; grow?: Texture } = {}) {
    const arc = opt.arc ?? 16
    const rot = opt.rot ?? 0
    return this.tween(ms, opt.ease ?? 'power2.inOut', (p) => {
      if (opt.grow && p > 0.3 && s.texture !== opt.grow) s.texture = opt.grow
      s.x = Math.round(a.x + (b.x - a.x) * p)
      s.y = Math.round(a.y + (b.y - a.y) * p - arc * 4 * p * (1 - p))
      s.rotation = rot * (1 - p)
    })
  }

  private chipFlight(from: { x: number; y: number }, to: { x: number; y: number }, count: number, color: string, ms: number, bounce = true) {
    const jobs: Promise<void>[] = []
    for (let i = 0; i < count; i++) {
      const c = this.spr(`chip_${color}`)
      c.position.set(from.x, from.y)
      this.fx.addChild(c)
      const dest = { x: to.x + (i % 3) * 2 - 2, y: to.y - Math.floor(i / 3) * 2 }
      jobs.push(
        this.wait(i * 55)
          .then(() => this.fly(c, from, dest, ms, { arc: 20, ease: 'power2.out' }))
          .then(() => (bounce ? this.tween(140, 'bounce.out', (p) => (c.y = dest.y - Math.round(3 * (1 - p)))) : undefined))
          .then(() => c.destroy())
      )
    }
    return Promise.all(jobs).then(() => undefined)
  }

  private janDo(name: string, fps: number, ms: number) {
    if (this.reduced()) return
    this.jan.play(name, fps, Math.max(ms, 300))
  }

  private bubble(pid: string | null, text: string, tint = 0xf3ebdd) {
    const n = pid ? this.seatNode(pid) : undefined
    const g = this.geom
    const at = n ? n.spot : { x: g.center.x, y: g.center.y - 20, dy: 1 }
    const t = this.text(text, 0xf3ebdd)
    t.anchor.set(0.5, 0.5)
    t.y = 0
    const w = Math.ceil(t.width) + 6
    const h = 17
    const above = !(n && n.spot.y < g.table.y + 24 && n.spot.dy > 0.3)
    const c = new Container()
    const bg = new Graphics()
    // caixa escura com borda de 1 px na cor da mensagem e cantos cortados; rabinho aponta para o avatar
    bg.rect(-w / 2 + 1, -h / 2, w - 2, h).fill(tint)
    bg.rect(-w / 2, -h / 2 + 1, w, h - 2).fill(tint)
    bg.rect(-w / 2 + 1, -h / 2 + 1, w - 2, h - 2).fill(0x221c19)
    bg.rect(-w / 2 + 2, -h / 2 + 1, w - 4, 1).fill(0x2e2622)
    const ty = above ? h / 2 : -h / 2 - 3
    bg.rect(-2, ty, 5, 3).fill(tint)
    bg.rect(-1, ty + (above ? 0 : 1), 3, 2).fill(0x221c19)
    c.addChild(bg, t)
    let x = Math.round(at.x)
    x = Math.max(w / 2 + 2, Math.min(g.w - w / 2 - 2, x))
    const y0 = Math.round(at.y + (above ? -36 : 36))
    c.position.set(x, y0)
    this.fx.addChild(c)
    const rm = this.reduced()
    const life = rm ? 700 : 1200
    void this.tween(160, 'back.out(2)', (p) => {
      if (!rm) c.y = y0 + Math.round((1 - p) * (above ? 5 : -5))
    })
      .then(() => this.tweenRaw(life, () => undefined))
      .then(() => this.tweenRaw(200, (p) => (c.alpha = 1 - p)))
      .then(() => c.destroy({ children: true }))
  }

  /** Tween que não é encurtado pela fila (balões precisam ser lidos). */
  private tweenRaw(ms: number, fn: (p: number) => void): Promise<void> {
    if (this.dead) return Promise.resolve()
    return new Promise((res) => {
      const o = { p: 0 }
      const tw = gsap.to(o, { p: 1, duration: ms / 1000, ease: 'none', onUpdate: () => fn(o.p), onComplete: () => (this.tweens.delete(tw), fn(1), res()) })
      this.tweens.add(tw)
    })
  }

  private flip(s: Sprite, to: Texture, ms = 240, onMid?: () => void) {
    const flash = this.rm_flash(s)
    return this.tween(ms / 2, 'power2.in', (p) => (s.scale.x = 1 - p)).then(() => {
      s.texture = to
      onMid?.()
      flash?.()
      return this.tween(ms / 2, 'power2.out', (p) => (s.scale.x = p))
    })
  }

  /** brilho de 1 quadro ao virar */
  private rm_flash(s: Sprite): (() => void) | null {
    return () => {
      const f = new Sprite(s.texture)
      f.anchor.copyFrom(s.anchor)
      f.position.copyFrom(s.position)
      f.blendMode = 'add'
      f.alpha = 0.55
      f.scale.copyFrom(s.scale)
      this.fx.addChild(f)
      setTimeout(() => f.destroy(), 60)
    }
  }

  private shake(ms: number) {
    if (this.reduced()) return Promise.resolve()
    const w = this.world
    return this.tweenRaw(ms, (p) => {
      const k = Math.floor(p * ms / 38)
      w.x = p >= 1 ? 0 : k % 2 ? 2 : -2
      w.y = p >= 1 ? 0 : k % 3 === 0 ? 1 : -1
    })
  }

  private burst(x: number, y: number, n: number, up = 90) {
    if (this.reduced()) return
    const cols = ['confetti_amber', 'confetti_coral', 'confetti_green', 'confetti_cream', 'confetti_sky']
    for (let i = 0; i < n && this.particles.length < 260; i++) {
      const s = this.spr(cols[i % 5])
      s.position.set(x, y)
      this.fx.addChild(s)
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2
      const v = up * (0.5 + Math.random())
      this.particles.push({ s, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1.4 + Math.random() * 0.8 })
    }
  }

  // ---------------------------------------------------------------- passos
  private async run(s: Step) {
    const g = this.geom
    const me = this.props?.me ?? null
    const txt = bubbleText(s)
    switch (s.kind) {
      case 'shuffle': {
        this.janDo('jan_shuffle', 11, this.d(s.ms))
        const bounce = this.tween(s.ms, 'none', (p) => {
          this.deck.x = g.deck.x + (Math.floor(p * 14) % 2 ? 1 : -1)
        })
        await bounce
        this.deck.x = g.deck.x
        break
      }
      case 'deal': {
        this.janDo('jan_deal', 9, this.d(s.ms))
        const order: { pid: string; i: number }[] = []
        for (let r = 0; r < s.count; r++) for (const pid of s.to) order.push({ pid, i: r })
        await Promise.all(
          order.map(async (o, k) => {
            await this.wait(k * 105)
            const n = this.seatNode(o.pid)
            if (!n) return
            const total = Math.max(s.count, this.props?.view.seats.find((q) => q.playerId === o.pid)?.cardCount ?? s.count)
            const pos = this.holePos(n, o.i, total, o.pid === me)
            const c = this.spr('card_mini_back')
            c.position.set(g.deck.x, g.deck.y)
            this.fx.addChild(c)
            await this.fly(c, g.deck, pos, 300, { arc: 22, rot: (o.pid === me ? 0.2 : -0.3) * (o.i % 2 ? 1 : -1), grow: o.pid === me ? this.tex('card_back') : undefined })
            await this.tween(70, 'power2.out', (p) => (c.scale.y = 1 - 0.021 * Math.sin(p * Math.PI)))
            this.holeShown.set(o.pid, (this.holeShown.get(o.pid) ?? 0) + 1)
            this.syncView()
            c.destroy()
          })
        )
        for (const pid of s.to) this.holeShown.delete(pid)
        this.syncView()
        // as minhas cartas viram para mim
        if (me && s.to.includes(me) && this.backHold.has(me)) {
          const n = this.seatNode(me)
          const hand = n?.seat?.cards
          if (n && hand) {
            await Promise.all(
              n.holes.slice(0, hand.length).map(async (h, i) => {
                await this.wait(i * 90)
                await this.flip(h, this.tex(cardSprite(hand[i])), 240)
              })
            )
          }
          this.backHold.delete(me)
          this.syncView()
        }
        break
      }
      case 'street': {
        const rk = s.street === 'river'
        if (rk) {
          await this.wait(380)
        }
        const start = this.boardShown ?? this.lastBoard
        for (let k = 0; k < s.cards.length; k++) {
          const idx = start + k
          const target = g.board[idx]
          if (!target) continue
          const c = this.spr('card_mini_back')
          c.position.set(g.deck.x, g.deck.y)
          this.fx.addChild(c)
          this.flipping.add(idx)
          await this.fly(c, g.deck, target, 260, { arc: 26, rot: 0.3, grow: this.tex('card_back') })
          await this.flip(c, this.tex(cardSprite(s.cards[k])), 240)
          this.flipping.delete(idx)
          this.boardShown = Math.min(5, (this.boardShown ?? start) + 1)
          this.syncView()
          c.destroy()
          await this.wait(rk ? 120 : 70)
        }
        if (this.boardShown !== null && this.boardShown >= (this.props?.view.board.length ?? 0)) this.boardShown = null
        this.syncView()
        break
      }
      case 'chips': {
        const n = this.seatNode(s.by)
        if (!n) break
        if (txt) this.bubble(s.by, txt)
        const isMe = s.by === me
        const to = this.betPos(n, isMe)
        const color = s.amount >= 100 ? 'amber' : s.amount >= 25 ? 'green' : s.amount >= 10 ? 'coral' : 'cream'
        await this.chipFlight({ x: n.spot.x, y: n.spot.y }, to, Math.min(4, Math.max(1, Math.ceil(s.amount / 15))), color, 320)
        this.releaseBet(s.by)
        break
      }
      case 'check': {
        const n = this.seatNode(s.by)
        if (txt) this.bubble(s.by, txt)
        if (n) {
          await this.tween(110, 'power2.out', (p) => (n.root.y = n.spot.y + Math.round(2 * Math.sin(p * Math.PI))))
          await this.tween(110, 'power2.out', (p) => (n.root.y = n.spot.y + Math.round(2 * Math.sin(p * Math.PI))))
        }
        break
      }
      case 'fold': {
        const n = this.seatNode(s.by)
        if (txt) this.bubble(s.by, txt)
        if (n) {
          const cnt = this.holeShown.get(s.by) ?? 0
          const ghosts: Sprite[] = []
          for (let i = 0; i < cnt; i++) {
            const c = this.spr(s.by === me ? 'card_back' : 'card_mini_back')
            const p = this.holePos(n, i, cnt, s.by === me)
            c.position.set(p.x, p.y)
            this.fx.addChild(c)
            ghosts.push(c)
            this.flyingHole.add(`${s.by}:${i}`)
          }
          this.holeShown.set(s.by, 0)
          this.syncView()
          await Promise.all(
            ghosts.map((c, i) => {
              const a = { x: c.x, y: c.y }
              return this.wait(i * 50)
                .then(() => this.tween(300, 'power2.in', (p) => {
                  c.x = Math.round(a.x + (g.deck.x - a.x) * p)
                  c.y = Math.round(a.y + (g.deck.y - a.y) * p)
                  c.alpha = 1 - p * 0.9
                }))
                .then(() => c.destroy())
            })
          )
          this.flyingHole.clear()
          this.holeShown.delete(s.by)
          this.syncView()
        }
        break
      }
      case 'allin': {
        const n = this.seatNode(s.by)
        if (!n) break
        if (txt) this.bubble(s.by, txt, 0xffc94a)
        this.janDo('jan_scared', 8, this.d(s.ms))
        this.spotPid = s.by
        this.spot.position.set(n.spot.x, n.spot.y - 168)
        this.spot.tint = 0xffffff
        const to = this.betPos(n, s.by === me)
        const done = this.chipFlight({ x: n.spot.x, y: n.spot.y }, to, 6, 'amber', 340)
        await Promise.all([
          this.tween(300, 'power2.out', (p) => {
            this.spot.alpha = 0.42 * p
            this.light.alpha = this.lightBase - (this.lightBase - 0.06) * p
          }),
          this.wait(120).then(() => this.shake(420)),
          done
        ])
        this.releaseBet(s.by)
        await this.wait(560)
        await this.tween(300, 'power2.in', (p) => {
          this.spot.alpha = 0.42 * (1 - p)
          this.light.alpha = 0.06 + (this.lightBase - 0.06) * p
        })
        this.spotPid = null
        this.light.alpha = this.lightBase
        break
      }
      case 'timeout': {
        const n = this.seatNode(s.by)
        if (txt) this.bubble(s.by, txt, 0xff7a6b)
        if (n) await this.tween(260, 'none', (p) => (n.root.x = n.spot.x + (Math.floor(p * 8) % 2 ? 1 : -1) * (p < 1 ? 1 : 0)))
        if (n) n.root.x = n.spot.x
        break
      }
      case 'reveal': {
        const n = this.seatNode(s.by)
        if (n && s.by !== me) {
          const hand = n.seat?.cards ?? s.cards
          const count = Math.min(n.holes.filter((h) => h.visible).length, hand.length)
          await Promise.all(
            n.holes.slice(0, count).map(async (h, i) => {
              await this.wait(i * 100)
              await this.flip(h, this.tex(cardSprite(hand[i])), 260, () => {
                const p = this.holePos(n, i, count, false, true)
                h.position.set(p.x, p.y)
              })
            })
          )
        }
        this.backHold.delete(s.by)
        this.syncView()
        break
      }
      case 'win': {
        this.hlHold = false
        this.syncView()
        const n = this.seatNode(s.by)
        if (!n) break
        if (txt) this.bubble(s.by, txt, 0xffc94a)
        this.janDo('jan_clap', 7, this.d(s.ms))
        this.burst(n.spot.x, n.spot.y - 6, 26)
        await this.chipFlight(g.pot, { x: n.spot.x, y: n.spot.y + 6 }, Math.min(8, Math.max(3, Math.ceil(s.amount / 60))), 'amber', 420, false)
        this.potHold = Math.max(0, this.potHold - 1)
        this.syncView()
        break
      }
      case 'rebuy': {
        const n = this.seatNode(s.by)
        if (txt) this.bubble(s.by, txt)
        this.janDo('jan_give', 5, this.d(s.ms))
        if (n) await this.chipFlight({ x: g.jan.x + 6, y: g.jan.y - 14 }, { x: n.spot.x, y: n.spot.y }, 3, 'amber', 420, false)
        break
      }
      case 'end': {
        this.podiumHold = false
        this.showPodium(s.ranking, true)
        await this.wait(900)
        break
      }
    }
  }

  private releaseBet(pid: string) {
    const c = (this.betHold.get(pid) ?? 1) - 1
    if (c <= 0) this.betHold.delete(pid)
    else this.betHold.set(pid, c)
    this.potHold = Math.max(0, this.potHold - 1)
    this.syncView()
  }

  // ---------------------------------------------------------------- pódio
  private showPodium(ranking: RankingEntry[], animate: boolean) {
    this.hidePodium()
    const g = this.geom
    const c = new Container()
    const dim = new Graphics().rect(0, 0, g.w, g.h).fill({ color: 0x0f0b09, alpha: 0.62 })
    c.addChild(dim)
    const px = Math.round(g.w / 2 - 48)
    const py = g.h - 36 - (g.compact ? 6 : 66)
    const pod = this.spr('podium', 0, 0)
    pod.position.set(px, py)
    c.addChild(pod)
    const stepTop = [py, py + 8, py + 16] // 1º, 2º, 3º
    const stepX = [px + 48, px + 16, px + 80]
    const items: Container[] = []
    ranking.slice(0, 3).forEach((r, i) => {
      const col = hex(this.props?.colors[r.playerId] ?? DEFAULT_COLORS[i])
      const a = new Container()
      const fr = this.spr('avatar_frame')
      fr.tint = col
      const fill = new Graphics().rect(-10, -10, 20, 20).fill(darken(col, 0.42))
      const ini = this.text((r.name[0] ?? '?').toUpperCase(), col)
      ini.anchor.set(0.5)
      const nm = this.text(r.name.length > 8 ? `${r.name.slice(0, 7)}.` : r.name, i === 0 ? 0xffc94a : 0xf3ebdd)
      nm.anchor.set(0.5, 1)
      nm.position.set(0, -16)
      a.addChild(fill, fr, ini, nm)
      a.position.set(stepX[i], stepTop[i] - 16)
      c.addChild(a)
      items.push(a)
    })
    const trophy = this.spr('trophy', 0.5, 1)
    trophy.position.set(stepX[0], stepTop[0] - 46)
    c.addChild(trophy)
    // demais colocados
    ranking.slice(3, 8).forEach((r, i) => {
      const t = this.text(`${r.place}. ${r.name.slice(0, 8)} ${r.net >= 0 ? '+' : ''}${r.net}`, 0xb7a99a)
      t.position.set(px + 108, py + 4 + i * 10)
      c.addChild(t)
    })
    // Jan entrega o troféu
    const jan = new JanPlayer(this.sheet)
    jan.sprite.position.set(px - 22, py + 36)
    jan.play('jan_give_trophy', 5, 0)
    c.addChild(jan.sprite)
    ;(c as Container & { jan?: JanPlayer }).jan = jan
    this.overlay.addChild(c)
    this.podium = c
    if (animate && !this.reduced()) {
      c.alpha = 0
      pod.y = py + 40
      items.forEach((a) => (a.alpha = 0))
      trophy.alpha = 0
      void this.tweenRaw(350, (p) => (c.alpha = p))
      void this.tweenRaw(520, (p) => {
        const e = 1 - Math.pow(1 - p, 3)
        pod.y = Math.round(py + 40 * (1 - e))
      }).then(() => {
        items.forEach((a, i) => void this.tweenRaw(260, (p) => (a.alpha = p)).then(() => (a.alpha = 1)).then(() => i))
        void this.tweenRaw(300, (p) => (trophy.alpha = p))
        this.burst(g.w / 2, py - 10, 80, 130)
      })
    }
  }

  private hidePodium() {
    if (!this.podium) return
    this.podium.destroy({ children: true })
    this.podium = null
  }

  // ---------------------------------------------------------------- ticker
  private update(dt: number) {
    this.clock += dt
    this.jan.update(dt)
    const pj = (this.podium as (Container & { jan?: JanPlayer }) | null)?.jan
    pj?.update(dt)
    // anel do timer
    const view = this.props?.view
    for (const n of this.nodes.values()) {
      const mine = view?.toAct === n.pid && view.actDeadline
      n.ring.visible = !!mine
      if (mine && view?.actDeadline) {
        const left = Math.max(0, view.actDeadline - Date.now())
        const frac = Math.min(1, left / TABLE.actMs)
        const i = Math.max(0, Math.min(11, Math.floor((1 - frac) * 12)))
        n.ring.texture = this.tex(`timer_ring_${i}`)
        n.ring.tint = frac < 0.25 && Math.floor(this.clock / 250) % 2 ? 0xff7a6b : n.color
      }
    }
    // pulso das cartas vencedoras
    const on = Math.floor(this.clock / 380) % 2 === 0
    for (const q of this.pulse) if (!q.s.destroyed && !this.reduced()) q.s.y = q.baseY - (on === (q.k % 2 === 0) ? 1 : 0)
    // confete
    const dts = dt / 1000
    this.particles = this.particles.filter((p) => {
      p.life -= dts
      p.vy += 220 * dts
      p.s.x += p.vx * dts
      p.s.y += p.vy * dts
      if (p.life <= 0 || p.s.y > this.geom.h + 4) {
        p.s.destroy()
        return false
      }
      return true
    })
    if (this.podium && !this.reduced()) {
      this.drizzleT += dt
      if (this.drizzleT > 130) {
        this.drizzleT = 0
        this.burst(Math.random() * this.geom.w, -2, 2, 10)
      }
    }
    // chiado da TV decorativa
    if (this.noise) {
      this.noise.t += dt / 1000
      if (Math.floor(this.noise.t * 9) !== Math.floor((this.noise.t - dt / 1000) * 9)) this.drawNoise()
    }
  }
}
