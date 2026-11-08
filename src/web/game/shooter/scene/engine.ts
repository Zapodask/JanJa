// O primeiro import do Pixi precisa ser este (o CSP do site proíbe eval).
import 'pixi.js/unsafe-eval'
import '@fontsource-variable/pixelify-sans/wght.css'
import { Application, Assets, CanvasSource, Container, Sprite, Texture, TextureSource } from 'pixi.js'
import { getMap } from '../../../../shared/games/shooter/maps'
import { MAX_HP, WEAPONS, type MapDef, type WeaponId } from '../../../../shared/games/shooter/types'
import type { FrameEvent, RenderPlayer, ShooterFrame, ShooterSceneProps } from '../contract'
import { cameraTarget, computeView, screenToWorld, shakeOffset, stepCamera, type Cam, type ViewSize } from './camera'
import { Particles } from './fx'
import { InputController, type TouchSnapshot } from './input'
import { drawDarkness, type LightSpot } from './light'
import { buildMapCanvas, type MapArt } from './mapart'
import { SPAL, hexNum, rowsToCanvas, tintedPalette, type Rows } from './palette'
import { labelTexture } from './pxText'
import {
  ARM,
  BIG_FLASH,
  CROSSHAIR,
  GHOST,
  HITMARKER,
  MUZZLE_FLASH,
  PICKUP_SIZE,
  PROJECTILE_ART,
  WEAPON_ART,
  bodyRows,
  facingOf,
  pickupRows,
  ringPoints,
  type Facing
} from './sprites'

const WALL_COLOR = '#221C19'
const DARK_COLOR = '#0F0B09'
const FALLBACK_COLORS = ['#D98E5F', '#C9A227', '#8FAE6B', '#5FA39A', '#C27C8E', '#B4846C', '#7E9CB5', '#D4A373']
const AMBIENT: Record<string, number> = { casa: 0.5, quintal: 0.3 }
/** a pessoa ouve até aqui (px do mundo) */
const HEAR = 260
const BODY_DX = -8
const BODY_DY = -9
const STEP_DIST = 9

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

function hashColor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return FALLBACK_COLORS[h % FALLBACK_COLORS.length]!
}

function canvasTexture(cv: HTMLCanvasElement): Texture {
  return new Texture({ source: new CanvasSource({ resource: cv, scaleMode: 'nearest' }) })
}

interface PlayerNode {
  root: Container
  shadow: Sprite
  body: Sprite
  gun: Container
  arm: Sprite
  wep: Sprite
  label: Sprite
  labelKey: string
  weapon: WeaponId | ''
  lastX: number
  lastY: number
  walk: number
  stepAcc: number
  flash: number
  recoil: number
  alive: boolean
  color: string
}

interface Floating {
  spr: Sprite
  x: number
  y: number
  vy: number
  age: number
  life: number
}

interface Glow {
  x: number
  y: number
  r: number
  power: number
  age: number
  life: number
  tint?: string
}

/** Cena do tiro em Pixi: lê session.frame() no ticker, sem re-render do React. */
export class ShooterEngine {
  private app: Application | null = null
  private dead = false
  private ready = false
  private props: ShooterSceneProps | null = null
  private controller: InputController | null = null
  private view: ViewSize = computeView(480, 270)
  private hostW = 480
  private hostH = 270

  // camadas
  private world = new Container()
  private ground = new Sprite()
  private shadows = new Container()
  private pickupLayer = new Container()
  private things = new Container()
  private air = new Container()
  private labelWorld = new Container()
  private fxCv = document.createElement('canvas')
  private fxCtx = this.fxCv.getContext('2d')!
  private fxSpr = new Sprite()
  private lightCv = document.createElement('canvas')
  private lightCtx = this.lightCv.getContext('2d')!
  private lightSpr = new Sprite()
  private ovCv = document.createElement('canvas')
  private ovCtx = this.ovCv.getContext('2d')!
  private ovSpr = new Sprite()

  private mapId = ''
  private map: MapDef | null = null
  private mapArt: MapArt | null = null
  private mapTex: Texture | null = null

  // texturas
  private bodyTex = new Map<string, Texture>()
  private armTex = new Map<string, Texture>()
  private wepTex = new Map<string, Texture>()
  private projTex = new Map<string, Texture>()
  private pickTex = new Map<string, Texture>()
  private ghostCv = new Map<string, HTMLCanvasElement>()
  private shadowTex: Texture | null = null
  private flashCv: HTMLCanvasElement | null = null
  private bigFlashCv: HTMLCanvasElement | null = null
  private crossCv: HTMLCanvasElement | null = null
  private hitCv: HTMLCanvasElement | null = null

  // estado
  private nodes = new Map<number, PlayerNode>()
  private projSprites = new Map<number, Sprite>()
  private projShadow = new Map<number, Sprite>()
  private pickSprites = new Map<number, Sprite>()
  private floaters: Floating[] = []
  private glows: Glow[] = []
  private parts = new Particles()
  private events: FrameEvent[] = []
  private unsub: (() => void) | null = null
  private session: ShooterSceneProps['session'] | null = null
  private cam: Cam = { x: 0, y: 0 }
  private camInit = false
  private lastMe = { x: 0, y: 0 }
  private lastAim = { x: 1, y: 0 }
  private shake = 0
  private hitStop = 0
  private hurt = 0
  private hitmarker = 0
  private time = 0
  private frameNo = 0
  private lastFrame: ShooterFrame | null = null
  private lastCount = -1
  private lastPhase = ''
  private mouseView: { x: number; y: number } | null = null
  private touch: TouchSnapshot | null = null
  private nodeColor = new Map<string, string>()

  /** a casca React liga isto para desenhar os joysticks */
  onTouchUi: ((t: TouchSnapshot) => void) | null = null

  constructor(private host: HTMLElement) {}

  setTouchButton(bit: number, down: boolean): void {
    this.controller?.setTouchButton(bit, down)
  }

  // ------------------------------------------------------------ ciclo de vida
  async init(): Promise<void> {
    TextureSource.defaultOptions.scaleMode = 'nearest'
    const app = new Application()
    let preference: 'webgl' | 'canvas' = 'webgl'
    try {
      if (localStorage.getItem('janja.debug.renderer') === 'canvas') preference = 'canvas'
    } catch {
      /* sem storage */
    }
    await app.init({ width: this.view.viewW, height: this.view.viewH, antialias: false, roundPixels: true, resolution: 1, autoDensity: false, background: WALL_COLOR, preference })
    if (this.dead) return app.destroy(true, { children: true })
    this.app = app
    const cv = app.canvas
    cv.style.position = 'absolute'
    cv.style.imageRendering = 'pixelated'
    cv.style.display = 'block'
    cv.style.cursor = 'none'
    cv.setAttribute('aria-label', 'Tiro na Sala: a partida')
    this.host.appendChild(cv)

    // o CSP do site não permite worker de blob
    Assets.setPreferences({ preferWorkers: false })
    await document.fonts.load('500 11px "Pixelify Sans Variable"').catch(() => undefined)
    if (this.dead) return

    this.shadowTex = canvasTexture(shadowCanvas())
    this.flashCv = rowsToCanvas(MUZZLE_FLASH)
    this.bigFlashCv = rowsToCanvas(BIG_FLASH)
    this.crossCv = rowsToCanvas(CROSSHAIR)
    this.hitCv = rowsToCanvas(HITMARKER)

    this.things.sortableChildren = true
    this.world.addChild(this.ground, this.shadows, this.pickupLayer, this.things, this.air)
    this.fxSpr.texture = canvasTexture(this.fxCv)
    this.lightSpr.texture = canvasTexture(this.lightCv)
    this.ovSpr.texture = canvasTexture(this.ovCv)
    app.stage.addChild(this.world, this.fxSpr, this.lightSpr, this.labelWorld, this.ovSpr)
    this.sizeCanvases()

    this.controller = new InputController({
      el: this.host,
      getView: () => ({ cam: this.cam, view: this.view, me: this.lastFrame?.me != null ? this.lastMe : null }),
      enabled: () => this.inputOn(),
      onTouch: (t) => {
        this.touch = t
        this.onTouchUi?.(t)
      }
    })
    this.host.addEventListener('pointermove', this.onHostPointer)
    this.host.addEventListener('pointerdown', this.onHostPointer)
    this.host.addEventListener('pointerleave', this.onHostLeave)

    this.ready = true
    app.ticker.add((t) => this.update(Math.min(50, t.deltaMS)))
    if (this.props) this.applyProps(this.props)
    ;(this.host as HTMLElement & { __engine?: ShooterEngine }).__engine = this
    this.host.setAttribute('data-scene-ready', '1')
  }

  destroy(): void {
    this.dead = true
    this.unsub?.()
    this.unsub = null
    this.controller?.dispose()
    this.host.removeEventListener('pointermove', this.onHostPointer)
    this.host.removeEventListener('pointerdown', this.onHostPointer)
    this.host.removeEventListener('pointerleave', this.onHostLeave)
    if (this.app) {
      try {
        this.app.destroy(true, { children: true })
      } catch {
        /* já destruído */
      }
    }
  }

  private onHostPointer = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return
    const r = this.host.getBoundingClientRect()
    this.mouseView = { x: (e.clientX - r.left - this.view.offX) / this.view.scale, y: (e.clientY - r.top - this.view.offY) / this.view.scale }
  }
  private onHostLeave = (): void => {
    this.mouseView = null
  }

  setProps(p: ShooterSceneProps): void {
    this.props = p
    if (this.ready) this.applyProps(p)
  }

  private applyProps(p: ShooterSceneProps): void {
    if (this.session !== p.session) {
      this.unsub?.()
      this.session = p.session
      this.unsub = p.session.onEvents((evs) => {
        for (const e of evs) this.events.push(e)
        if (this.events.length > 300) this.events.splice(0, this.events.length - 300)
      })
    }
  }

  resize(w: number, h: number): void {
    this.hostW = Math.max(1, w)
    this.hostH = Math.max(1, h)
    this.view = computeView(this.hostW, this.hostH)
    if (this.ready) this.sizeCanvases()
  }

  /** informações para o laboratório e os testes */
  debug(): { cam: Cam; view: ViewSize; particles: number; lights: number } {
    return { cam: this.cam, view: this.view, particles: this.parts.list.length, lights: this.glows.length }
  }

  private sizeCanvases(): void {
    const app = this.app
    if (!app) return
    const v = this.view
    app.renderer.resize(v.viewW, v.viewH)
    const cv = app.canvas
    cv.style.width = `${v.cssW}px`
    cv.style.height = `${v.cssH}px`
    cv.style.left = `${v.offX}px`
    cv.style.top = `${v.offY}px`
    for (const c of [this.fxCv, this.lightCv, this.ovCv]) {
      c.width = v.viewW
      c.height = v.viewH
      this.fxCtx.imageSmoothingEnabled = false
    }
    for (const ctx of [this.fxCtx, this.lightCtx, this.ovCtx]) ctx.imageSmoothingEnabled = false
    // o Pixi guarda o tamanho da textura do canvas: refaz as fontes
    for (const s of [this.fxSpr, this.lightSpr, this.ovSpr]) {
      const src = s.texture.source as CanvasSource
      src.resize(v.viewW, v.viewH)
    }
  }

  private inputOn(): boolean {
    const p = this.props
    if (!p || p.inputEnabled === false) return false
    const f = this.lastFrame
    return !!f && f.phase !== 'fim'
  }

  // ------------------------------------------------------------ texturas
  private colorOf(id: string): string {
    const c = this.props?.colors[id]
    if (c) return c
    let v = this.nodeColor.get(id)
    if (!v) this.nodeColor.set(id, (v = hashColor(id)))
    return v
  }

  private tex(cache: Map<string, Texture>, key: string, make: () => HTMLCanvasElement): Texture {
    let t = cache.get(key)
    if (!t) cache.set(key, (t = canvasTexture(make())))
    return t
  }

  private bodyTexture(color: string, f: Facing, frame: number, white: boolean): Texture {
    return this.tex(this.bodyTex, `${color}|${f}|${frame}|${white ? 1 : 0}`, () => {
      const rows = bodyRows(f, frame)
      if (!white) return rowsToCanvas(rows, tintedPalette(color))
      const pal: Record<string, string> = {}
      for (const k of Object.keys(SPAL)) pal[k] = '#FFFFFF'
      return rowsToCanvas(rows, pal)
    })
  }

  private armTexture(color: string): Texture {
    return this.tex(this.armTex, color, () => rowsToCanvas(ARM, tintedPalette(color)))
  }
  private weaponTexture(w: WeaponId): Texture {
    return this.tex(this.wepTex, w, () => rowsToCanvas(WEAPON_ART[w].rows))
  }
  private projTexture(kind: string): Texture {
    return this.tex(this.projTex, kind, () => rowsToCanvas((PROJECTILE_ART as Record<string, Rows>)[kind] ?? PROJECTILE_ART.bala))
  }
  private pickupTexture(kind: string, ghost: boolean): Texture {
    return this.tex(this.pickTex, `${kind}|${ghost ? 1 : 0}`, () => rowsToCanvas(pickupRows(kind as WeaponId | 'vida')))
  }
  private ghostCanvas = (color: string): HTMLCanvasElement => {
    let c = this.ghostCv.get(color)
    if (!c) this.ghostCv.set(color, (c = rowsToCanvas(GHOST.map((l) => l.replace(/p/g, 't')), { ...tintedPalette(color), t: mix(color, '#F3EBDD', 0.55) })))
    return c
  }

  // ------------------------------------------------------------ mapa
  private loadMap(id: string): void {
    this.mapId = id
    this.map = getMap(id as 'casa' | 'quintal')
    this.mapArt = buildMapCanvas(this.map)
    this.mapTex?.destroy(true)
    this.mapTex = canvasTexture(this.mapArt.canvas)
    this.ground.texture = this.mapTex
    this.camInit = false
    this.parts.clear()
    this.glows.length = 0
    for (const n of this.nodes.values()) n.root.destroy({ children: true })
    this.nodes.clear()
    for (const s of this.projSprites.values()) s.destroy()
    this.projSprites.clear()
    for (const s of this.projShadow.values()) s.destroy()
    this.projShadow.clear()
    for (const s of this.pickSprites.values()) s.destroy()
    this.pickSprites.clear()
  }

  // ------------------------------------------------------------ quadro
  private update(dtMs: number): void {
    const props = this.props
    const session = this.session
    if (!props || !session || !this.app) return
    const frame = session.frame()
    this.lastFrame = frame
    this.frameNo++
    const reduced = props.reducedMotion
    if (!frame) {
      this.drawIdle()
      return
    }
    if (frame.mapId !== this.mapId) this.loadMap(frame.mapId)
    const map = this.map!

    // entrada: um InputState por quadro
    const input = this.controller?.poll()
    if (input) session.setInput(input)

    // eventos primeiro (viram partículas e sons)
    const me = frame.players.find((p) => p.slot === frame.me) ?? null
    if (me) this.lastMe = { x: me.x, y: me.y }
    this.handleEvents(frame, me, reduced)

    const frozen = this.hitStop > 0
    this.hitStop = Math.max(0, this.hitStop - dtMs)
    const dt = frozen ? 0 : dtMs / 1000
    this.time += dt

    // câmera
    const aim = input ? { x: input.ax, y: input.ay } : this.lastAim
    this.lastAim = aim
    let focus: { x: number; y: number } | null = me && me.alive ? me : me ? this.lastMe : null
    if (!focus) {
      const lead = frame.scores.length ? frame.players.find((p) => p.id === frame.scores[0]!.id && p.alive) : undefined
      focus = lead ?? frame.players.find((p) => p.alive) ?? { x: map.w * 8, y: map.h * 8 }
    }
    const v = this.view
    const tgt = cameraTarget(focus.x, focus.y, me && me.alive ? aim.x : 0, me && me.alive ? aim.y : 0, v.viewW, v.viewH, map.w * 16, map.h * 16)
    if (!this.camInit) {
      this.cam = tgt
      this.camInit = true
    } else if (!frozen) this.cam = stepCamera(this.cam, tgt, dtMs)

    this.shake *= Math.pow(0.5, dtMs / 70)
    if (this.shake < 0.2) this.shake = 0
    const sh = reduced ? { x: 0, y: 0 } : shakeOffset(this.shake, this.frameNo)
    const cx = Math.round(this.cam.x)
    const cy = Math.round(this.cam.y)
    this.world.position.set(-cx + sh.x, -cy + sh.y)
    this.labelWorld.position.set(-cx + sh.x, -cy + sh.y)
    const camV: Cam = { x: cx - sh.x, y: cy - sh.y }

    // entidades
    this.syncPlayers(frame, reduced)
    this.syncProjectiles(frame)
    this.syncPickups(frame)
    this.syncFloaters(dt)
    this.countdown(frame)

    this.parts.step(dt)
    for (const g of this.glows) g.age += dt
    this.glows = this.glows.filter((g) => g.age < g.life)

    // camadas de tela
    this.drawFx(frame, camV, reduced)
    this.drawLight(frame, camV, reduced)
    this.drawOverlay(frame, me, aim, dtMs, reduced)
    for (const s of [this.fxSpr, this.lightSpr, this.ovSpr]) s.texture.source.update()
  }

  private drawIdle(): void {
    const ctx = this.ovCtx
    ctx.clearRect(0, 0, this.ovCv.width, this.ovCv.height)
    this.fxCtx.clearRect(0, 0, this.fxCv.width, this.fxCv.height)
    this.lightCtx.clearRect(0, 0, this.lightCv.width, this.lightCv.height)
    for (const s of [this.fxSpr, this.lightSpr, this.ovSpr]) s.texture.source.update()
  }

  // ------------------------------------------------------------ eventos
  private listener(me: RenderPlayer | null): { x: number; y: number } {
    return me ? { x: me.x, y: me.y } : { x: this.cam.x + this.view.viewW / 2, y: this.cam.y + this.view.viewH / 2 }
  }

  private sfx(name: string, x: number, y: number, me: RenderPlayer | null, base = 1): void {
    const cb = this.props?.onSfx
    if (!cb) return
    const l = this.listener(me)
    const d = Math.hypot(x - l.x, y - l.y)
    const vol = base * clamp(1 - d / HEAR, 0, 1)
    if (vol < 0.04) return
    cb(name, { volume: Math.round(vol * 100) / 100, pan: Math.round(clamp((x - l.x) / 180, -1, 1) * 100) / 100 })
  }

  private sfxMine(name: string, vol = 1): void {
    this.props?.onSfx?.(name, { volume: vol, pan: 0 })
  }

  private addShake(mag: number, x: number, y: number, me: RenderPlayer | null, force = false): void {
    const l = this.listener(me)
    const d = Math.hypot(x - l.x, y - l.y)
    const k = force ? 1 : clamp(1 - d / 200, 0, 1)
    this.shake = Math.max(this.shake, mag * k)
  }

  private playerBy(frame: ShooterFrame, slot: number): RenderPlayer | undefined {
    return frame.players.find((p) => p.slot === slot)
  }

  private handleEvents(frame: ShooterFrame, me: RenderPlayer | null, reduced: boolean): void {
    const evs = this.events
    this.events = []
    const meSlot = frame.me
    for (const e of evs) {
      switch (e.type) {
        case 'shot': {
          const p = this.playerBy(frame, e.slot)
          const w = WEAPONS[e.weapon]
          const art = WEAPON_ART[e.weapon]
          const mx = e.x + e.ax * (4 + art.muzzleX - art.gripX)
          const my = e.y + e.ay * (4 + art.muzzleX - art.gripX) - 1
          const node = this.nodes.get(e.slot)
          if (node) {
            node.recoil = 2
          }
          this.parts.add({ kind: 'puff', x: mx, y: my, life: 0.06, color: SPAL.u!, size: 1 })
          this.flashes.push({ x: mx, y: my, ax: e.ax, ay: e.ay, left: 1, big: e.weapon === 'escopeta' || e.weapon === 'rolha' })
          this.glows.push({ x: mx, y: my, r: e.weapon === 'escopeta' ? 54 : e.weapon === 'rifle' ? 50 : 42, power: reduced ? 0.45 : 0.9, age: 0, life: 0.09, tint: '#FFC94A' })
          if (e.weapon !== 'rifle') this.parts.shell(e.x, e.y, e.ax, e.ay)
          else this.parts.streak(mx, my, mx + e.ax * 420, my + e.ay * 420, SPAL.p!, 0.1)
          const mine = e.slot === meSlot
          this.addShake(w.shake * (mine ? 1 : 0.5), e.x, e.y, me, mine)
          this.sfx(`tiro-${e.weapon}`, e.x, e.y, me, mine ? 1 : 0.8)
          void p
          break
        }
        case 'grenade':
          this.sfx('granada', e.x, e.y, me, 0.7)
          break
        case 'hit': {
          const v = this.playerBy(frame, e.victim)
          const node = this.nodes.get(e.victim)
          if (node) node.flash = 2
          const color = v ? this.colorOf(v.id) : SPAL.o!
          const a = this.playerBy(frame, e.attacker)
          const dirx = a && v ? v.x - a.x : 0
          const diry = a && v ? v.y - a.y : 0
          this.parts.hitBurst(e.x, e.y, dirx, diry, color, 4 + Math.min(6, Math.round(e.damage / 10)))
          this.spawnFloater(`${Math.round(e.damage)}`, e.x, e.y - 12, e.attacker === meSlot ? SPAL.y! : SPAL.p!)
          if (e.attacker === meSlot) {
            this.hitmarker = 1
            this.sfxMine('hitmarker', 0.8)
          }
          if (e.victim === meSlot) {
            this.hurt = 1
            this.addShake(Math.min(4, 1 + e.damage / 25), e.x, e.y, me, true)
            this.sfxMine('dano', 0.9)
          } else if (e.attacker !== meSlot) this.sfx('dano', e.x, e.y, me, 0.4)
          break
        }
        case 'kill': {
          const v = this.playerBy(frame, e.victim)
          if (v) {
            const color = this.colorOf(v.id)
            this.parts.ghost(v.x, v.y, color)
            this.parts.hitBurst(v.x, v.y, 0, -1, color, 10)
            const involved = e.victim === meSlot || e.killer === meSlot
            if (!reduced && involved) this.hitStop = 60
            if (e.killer === meSlot) this.sfxMine('abate', 1)
            else this.sfx('abate', v.x, v.y, me, 0.6)
          }
          break
        }
        case 'spawn': {
          const p = this.playerBy(frame, e.slot)
          this.parts.spawnBurst(e.x, e.y, p ? this.colorOf(p.id) : SPAL.y!)
          this.glows.push({ x: e.x, y: e.y, r: 44, power: 0.8, age: 0, life: 0.4, tint: '#FFC94A' })
          if (e.slot === meSlot) this.sfxMine('renascer', 0.9)
          else this.sfx('renascer', e.x, e.y, me, 0.4)
          break
        }
        case 'pickup': {
          const pk = frame.pickups.find((x) => x.id === e.pickupId)
          const x = pk?.x ?? this.lastMe.x
          const y = pk?.y ?? this.lastMe.y
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2
            this.parts.add({ kind: 'spark', x, y, vx: Math.cos(a) * 40, vy: Math.sin(a) * 40, life: 0.3, color: e.kind === 'vida' ? SPAL.g! : SPAL.y!, size: 1 })
          }
          const name = e.kind === 'vida' ? 'pegar-vida' : 'pegar-arma'
          if (e.slot === meSlot) this.sfxMine(name, 0.9)
          else this.sfx(name, x, y, me, 0.5)
          break
        }
        case 'explode': {
          this.parts.explosion(e.x, e.y, e.radius)
          this.glows.push({ x: e.x, y: e.y, r: e.radius * 2.6, power: reduced ? 0.6 : 1, age: 0, life: 0.35, tint: '#FF7A6B' })
          this.addShake(5, e.x, e.y, me)
          this.sfx('explosao', e.x, e.y, me, 1)
          break
        }
        case 'wall':
          this.parts.sparks(e.x, e.y, 0, 0, 4)
          break
        case 'dash': {
          const p = this.playerBy(frame, e.slot)
          if (p) for (let i = 0; i < 3; i++) this.parts.afterimage(p.x - p.ax * i * 3, p.y - p.ay * i * 3, this.colorOf(p.id))
          if (p) this.sfx('dash', p.x, p.y, me, e.slot === meSlot ? 0.9 : 0.6)
          break
        }
        case 'phase':
          break
      }
    }
    // clarões de cano duram um quadro
    for (const f of this.flashes) f.left--
    this.flashesDraw = this.flashes.filter((f) => f.left >= 0)
    this.flashes = this.flashes.filter((f) => f.left > 0)
  }

  private flashes: { x: number; y: number; ax: number; ay: number; left: number; big: boolean }[] = []
  private flashesDraw: { x: number; y: number; ax: number; ay: number; left: number; big: boolean }[] = []

  private countdown(frame: ShooterFrame): void {
    if (frame.phase === 'aquecendo') {
      const secs = Math.ceil(frame.timeLeftMs / 1000)
      if (secs !== this.lastCount && secs <= 5 && secs > 0) this.sfxMine('contagem', 0.6)
      this.lastCount = secs
    } else {
      if (this.lastPhase === 'aquecendo' && frame.phase === 'jogando') this.sfxMine('renascer', 0.7)
      this.lastCount = -1
    }
    this.lastPhase = frame.phase
  }

  // ------------------------------------------------------------ números e nomes
  private spawnFloater(text: string, x: number, y: number, color: string): void {
    const spr = new Sprite(labelTexture(text, color))
    spr.anchor.set(0.5, 1)
    this.labelWorld.addChild(spr)
    this.floaters.push({ spr, x, y, vy: -26, age: 0, life: 0.8 })
    if (this.floaters.length > 40) this.floaters.shift()?.spr.destroy()
  }

  private syncFloaters(dt: number): void {
    for (const f of this.floaters) {
      f.age += dt
      f.y += f.vy * dt
      f.vy *= 1 - 3 * dt
      f.spr.position.set(Math.round(f.x), Math.round(f.y))
      f.spr.alpha = f.age > f.life * 0.6 ? Math.max(0, 1 - (f.age - f.life * 0.6) / (f.life * 0.4)) : 1
    }
    for (const f of this.floaters) if (f.age >= f.life) f.spr.destroy()
    this.floaters = this.floaters.filter((f) => f.age < f.life)
  }

  // ------------------------------------------------------------ jogadores
  private makeNode(p: RenderPlayer): PlayerNode {
    const root = new Container()
    const shadow = new Sprite(this.shadowTex!)
    shadow.position.set(-5, 2)
    const body = new Sprite()
    const gun = new Container()
    const arm = new Sprite()
    arm.position.set(0, -1)
    const wep = new Sprite()
    gun.addChild(arm, wep)
    root.addChild(shadow, body, gun)
    const label = new Sprite()
    label.anchor.set(0.5, 1)
    this.things.addChild(root)
    this.labelWorld.addChild(label)
    return { root, shadow, body, gun, arm, wep, label, labelKey: '', weapon: '', lastX: p.x, lastY: p.y, walk: 0, stepAcc: 0, flash: 0, recoil: 0, alive: p.alive, color: '' }
  }

  private syncPlayers(frame: ShooterFrame, reduced: boolean): void {
    const seen = new Set<number>()
    for (const p of frame.players) {
      seen.add(p.slot)
      let n = this.nodes.get(p.slot)
      if (!n) this.nodes.set(p.slot, (n = this.makeNode(p)))
      const color = this.colorOf(p.id)
      n.color = color
      n.root.visible = p.alive
      n.label.visible = p.alive
      if (!p.alive) {
        n.lastX = p.x
        n.lastY = p.y
        n.alive = false
        continue
      }
      if (!n.alive) {
        n.alive = true
        n.lastX = p.x
        n.lastY = p.y
        n.walk = 0
      }
      const moved = Math.hypot(p.x - n.lastX, p.y - n.lastY)
      n.lastX = p.x
      n.lastY = p.y
      const moving = moved > 0.15 && moved < 40
      if (moving) {
        n.walk += moved
        n.stepAcc += moved
        if (n.stepAcc >= STEP_DIST) {
          n.stepAcc = 0
          if (!p.dashing) {
            if (p.slot === frame.me) this.sfxMine('passo', 0.35)
            else this.sfx('passo', p.x, p.y, frame.players.find((q) => q.slot === frame.me) ?? null, 0.3)
            if (!reduced && this.rndStep()) this.parts.dust(p.x + (this.rndStep() ? 2 : -2), p.y + 5)
          }
        }
      } else n.stepAcc = 0
      const f = facingOf(p.ax, p.ay)
      const cycle = [1, 0, 2, 0][Math.floor(n.walk / 5) % 4]!
      const frameIdx = moving ? cycle : 0
      const white = n.flash > 0
      if (n.flash > 0) n.flash--
      n.body.texture = this.bodyTexture(color, f, frameIdx, white)
      const bob = frameIdx !== 0 ? 0 : 0
      n.body.position.set(BODY_DX, BODY_DY + bob)
      n.root.position.set(Math.round(p.x), Math.round(p.y))
      n.root.zIndex = Math.round(p.y)
      n.root.alpha = p.invulnerable && Math.floor(this.time * 18) % 2 === 0 ? 0.45 : 1

      // braço e arma girando para a mira
      if (n.weapon !== p.weapon) {
        n.weapon = p.weapon
        n.wep.texture = this.weaponTexture(p.weapon)
      }
      n.arm.texture = this.armTexture(color)
      const art = WEAPON_ART[p.weapon]
      n.wep.position.set(4 - art.gripX, -1 - art.gripY + 0)
      const ang = Math.atan2(p.ay, p.ax)
      n.gun.rotation = ang
      n.gun.scale.y = p.ax < 0 ? -1 : 1
      const rec = n.recoil > 0 ? 1 : 0
      if (n.recoil > 0) n.recoil--
      n.gun.position.set(Math.round(-p.ax * rec), Math.round(-p.ay * rec) - 1)
      // de costas, a arma fica atrás do corpo
      const behind = p.ay < -0.5
      const gunIdx = n.root.getChildIndex(n.gun)
      const wantIdx = behind ? 1 : 2
      if (gunIdx !== wantIdx) n.root.setChildIndex(n.gun, wantIdx)

      // rastro do dash
      if (p.dashing && !reduced) this.parts.afterimage(p.x, p.y, color)
      else if (p.dashing) if (this.frameNo % 3 === 0) this.parts.afterimage(p.x, p.y, color)

      // nome
      const key = `${p.name}|${p.me ? 1 : 0}`
      if (n.labelKey !== key) {
        n.labelKey = key
        n.label.texture = labelTexture(shortName(p.name), p.me ? SPAL.y! : SPAL.p!)
      }
      n.label.position.set(Math.round(p.x), Math.round(p.y) - (p.hp < MAX_HP ? 14 : 12))
    }
    for (const [slot, n] of this.nodes) {
      if (seen.has(slot)) continue
      n.root.destroy({ children: true })
      n.label.destroy()
      this.nodes.delete(slot)
    }
  }

  private stepFlip = 0
  private rndStep(): boolean {
    this.stepFlip = (this.stepFlip * 1103515245 + 12345) & 0x7fffffff
    return (this.stepFlip & 0x100) !== 0
  }

  // ------------------------------------------------------------ projéteis e caixas
  private syncProjectiles(frame: ShooterFrame): void {
    const seen = new Set<number>()
    for (const pr of frame.projectiles) {
      seen.add(pr.id)
      let s = this.projSprites.get(pr.id)
      if (!s) {
        s = new Sprite(this.projTexture(pr.kind))
        s.anchor.set(0.5)
        this.air.addChild(s)
        this.projSprites.set(pr.id, s)
        if (pr.kind === 'granada') {
          const sh = new Sprite(this.shadowTex!)
          sh.scale.set(0.6)
          this.shadows.addChild(sh)
          this.projShadow.set(pr.id, sh)
        }
      }
      let hop = 0
      if (pr.kind === 'granada') {
        const sp = Math.hypot(pr.vx, pr.vy)
        hop = Math.round(Math.abs(Math.sin(this.time * 14 + pr.id)) * Math.min(4, sp / 40))
        const sh = this.projShadow.get(pr.id)
        sh?.position.set(Math.round(pr.x) - 3, Math.round(pr.y) + 1)
        s.rotation = this.time * 6 * (sp > 20 ? 1 : 0)
      } else {
        s.rotation = Math.atan2(pr.vy, pr.vx)
      }
      s.position.set(Math.round(pr.x), Math.round(pr.y) - hop)
      // rastros
      if (pr.kind === 'rifle') this.parts.streak(pr.x, pr.y, pr.x - pr.vx * 0.03, pr.y - pr.vy * 0.03, SPAL.p!, 0.1)
      else if (pr.kind === 'rolha') {
        if (this.frameNo % 2 === 0) this.parts.add({ kind: 'smoke', x: pr.x - pr.vx * 0.02, y: pr.y - pr.vy * 0.02, vx: 0, vy: 0, life: 0.45, color: SPAL.D!, size: 4 })
        this.parts.add({ kind: 'fire', x: pr.x - pr.vx * 0.016, y: pr.y - pr.vy * 0.016, life: 0.12, color: SPAL.y!, size: 2 })
      } else if (pr.kind === 'bala' && this.frameNo % 2 === 0) this.parts.streak(pr.x, pr.y, pr.x - pr.vx * 0.012, pr.y - pr.vy * 0.012, SPAL.Y!, 0.06)
    }
    for (const [id, s] of this.projSprites) {
      if (seen.has(id)) continue
      s.destroy()
      this.projSprites.delete(id)
      this.projShadow.get(id)?.destroy()
      this.projShadow.delete(id)
    }
  }

  private syncPickups(frame: ShooterFrame): void {
    const seen = new Set<number>()
    for (const pk of frame.pickups) {
      seen.add(pk.id)
      let s = this.pickSprites.get(pk.id)
      if (!s) {
        s = new Sprite(this.pickupTexture(pk.kind, false))
        this.pickupLayer.addChild(s)
        this.pickSprites.set(pk.id, s)
      }
      const bob = pk.available ? Math.round(Math.sin(this.time * 3 + pk.id) * 1) : 0
      s.position.set(Math.round(pk.x) - PICKUP_SIZE / 2, Math.round(pk.y) - PICKUP_SIZE / 2 + bob)
      s.alpha = pk.available ? 1 : 0.28
    }
    for (const [id, s] of this.pickSprites) {
      if (seen.has(id)) continue
      s.destroy()
      this.pickSprites.delete(id)
    }
  }

  // ------------------------------------------------------------ camadas de tela
  private drawFx(frame: ShooterFrame, cam: Cam, reduced: boolean): void {
    const ctx = this.fxCtx
    const { viewW: w, viewH: h } = this.view
    ctx.clearRect(0, 0, w, h)
    // anel de tempo das caixas e brilho das disponíveis
    for (const pk of frame.pickups) {
      const sx = Math.round(pk.x - cam.x)
      const sy = Math.round(pk.y - cam.y)
      if (sx < -20 || sy < -20 || sx > w + 20 || sy > h + 20) continue
      if (!pk.available) {
        ctx.fillStyle = SPAL.D!
        for (const [dx, dy] of ringPoints(10, 1)) ctx.fillRect(sx + dx, sy + dy, 1, 1)
        ctx.fillStyle = SPAL.y!
        for (const [dx, dy] of ringPoints(10, pk.ready)) ctx.fillRect(sx + dx, sy + dy, 1, 1)
      } else {
        // pontinhos girando em volta, bem de leve
        const a = this.time * 2 + pk.id
        ctx.fillStyle = pk.kind === 'vida' ? SPAL.g! : SPAL.y!
        for (let i = 0; i < 3; i++) {
          const aa = a + (i * Math.PI * 2) / 3
          ctx.globalAlpha = 0.7
          ctx.fillRect(sx + Math.round(Math.cos(aa) * 10), sy + Math.round(Math.sin(aa) * 10), 1, 1)
        }
        ctx.globalAlpha = 1
      }
    }
    // barras de vida de quem levou dano
    for (const p of frame.players) {
      if (!p.alive || p.hp >= MAX_HP) continue
      const sx = Math.round(p.x - cam.x) - 6
      const sy = Math.round(p.y - cam.y) - 12
      ctx.fillStyle = SPAL.k!
      ctx.fillRect(sx - 1, sy - 1, 14, 4)
      ctx.fillStyle = SPAL.r!
      ctx.fillRect(sx, sy, 12, 2)
      const f = clamp(p.hp / MAX_HP, 0, 1)
      ctx.fillStyle = f > 0.5 ? SPAL.g! : f > 0.25 ? SPAL.y! : SPAL.o!
      ctx.fillRect(sx, sy, Math.max(1, Math.round(12 * f)), 2)
    }
    this.parts.draw(ctx, cam.x, cam.y, w, h, this.ghostCanvas, reduced)
    // clarões de cano (um quadro)
    for (const f of this.flashesDraw) {
      const img = f.big ? this.bigFlashCv! : this.flashCv!
      ctx.save()
      ctx.translate(Math.round(f.x - cam.x), Math.round(f.y - cam.y))
      ctx.rotate(Math.atan2(f.ay, f.ax))
      ctx.globalAlpha = reduced ? 0.6 : 1
      ctx.drawImage(img, -1, -Math.floor(img.height / 2))
      ctx.restore()
    }
    this.flashesDraw = []
    ctx.globalAlpha = 1
  }

  private drawLight(frame: ShooterFrame, cam: Cam, reduced: boolean): void {
    const { viewW: w, viewH: h } = this.view
    const lights: LightSpot[] = []
    if (this.mapArt) for (const l of this.mapArt.lights) lights.push(l)
    for (const p of frame.players) if (p.alive) lights.push({ x: p.x, y: p.y - 2, r: p.me ? 78 : 62, power: p.me ? 1 : 0.85, tint: '#FFC94A' })
    for (const pk of frame.pickups) if (pk.available) lights.push({ x: pk.x, y: pk.y, r: 22, power: 0.55 + (reduced ? 0 : Math.sin(this.time * 3 + pk.id) * 0.08), tint: pk.kind === 'vida' ? '#6FD49B' : '#FFC94A' })
    for (const g of this.glows) {
      const k = 1 - g.age / g.life
      lights.push({ x: g.x, y: g.y, r: g.r, power: g.power * k, tint: g.tint })
    }
    drawDarkness(this.lightCtx, w, h, cam, lights, { ambient: AMBIENT[frame.mapId] ?? 0.45, color: DARK_COLOR })
  }

  private drawOverlay(frame: ShooterFrame, me: RenderPlayer | null, aim: { x: number; y: number }, dtMs: number, reduced: boolean): void {
    const ctx = this.ovCtx
    const { viewW: w, viewH: h } = this.view
    ctx.clearRect(0, 0, w, h)
    // borda vermelha ao tomar dano
    this.hurt = Math.max(0, this.hurt - dtMs / (reduced ? 220 : 380))
    const lowHp = me && me.alive && me.hp <= 30
    const a = this.hurt > 0 ? this.hurt * (reduced ? 0.35 : 0.8) : lowHp ? 0.22 : 0
    if (a > 0.02) {
      ctx.fillStyle = SPAL.R!
      const t = this.hurt > 0 ? 3 : 2
      for (let i = 0; i < t; i++) {
        ctx.globalAlpha = a * (1 - i / (t + 1))
        ctx.fillRect(i, i, w - i * 2, 1)
        ctx.fillRect(i, h - 1 - i, w - i * 2, 1)
        ctx.fillRect(i, i, 1, h - i * 2)
        ctx.fillRect(w - 1 - i, i, 1, h - i * 2)
      }
      ctx.globalAlpha = 1
    }
    // mira e hitmarker
    if (me && me.alive && frame.phase !== 'fim' && this.props?.inputEnabled !== false) {
      let cx: number
      let cy: number
      if (this.mouseView && !this.touch?.aim.active && this.mouseView.x >= 0 && this.mouseView.y >= 0 && this.mouseView.x < w && this.mouseView.y < h) {
        cx = Math.round(this.mouseView.x)
        cy = Math.round(this.mouseView.y)
      } else {
        cx = Math.round(me.x - this.cam.x + aim.x * 44)
        cy = Math.round(me.y - this.cam.y + aim.y * 44)
      }
      const touchOnly = this.controller?.touched && !this.mouseView
      if (!touchOnly) ctx.drawImage(this.crossCv!, cx - 5, cy - 5)
      if (this.hitmarker > 0) {
        this.hitmarker = Math.max(0, this.hitmarker - dtMs / 170)
        ctx.globalAlpha = reduced ? 0.7 : 1
        ctx.drawImage(this.hitCv!, cx - 4, cy - 4)
        ctx.globalAlpha = 1
      }
    }
  }

  /** ponto do mundo sob o ponteiro (laboratório) */
  worldAt(cssX: number, cssY: number): { x: number; y: number } {
    return screenToWorld(cssX, cssY, this.cam, this.view)
  }
}

function shortName(n: string): string {
  return n.length > 12 ? `${n.slice(0, 11)}…` : n
}

function shadowCanvas(): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = 10
  cv.height = 5
  const ctx = cv.getContext('2d')!
  ctx.fillStyle = 'rgba(15,11,9,0.42)'
  for (let y = 0; y < 5; y++)
    for (let x = 0; x < 10; x++) {
      const d = ((x + 0.5 - 5) / 5) ** 2 + ((y + 0.5 - 2.5) / 2.5) ** 2
      if (d <= 1) ctx.fillRect(x, y, 1, 1)
    }
  return cv
}

function mix(a: string, b: string, t: number): string {
  const x = hexNum(a)
  const y = hexNum(b)
  const c = (s: number) => Math.round(((x >> s) & 255) * (1 - t) + ((y >> s) & 255) * t)
  return `#${((c(16) << 16) | (c(8) << 8) | c(0)).toString(16).padStart(6, '0')}`
}
