/**
 * Cena 3D do golfe (Three.js). Só este diretório importa `three` (fica no pedaço do golfe).
 *
 * Desenha em resolução baixa e amplia sem suavizar: cara de pixel, como o resto do JanJa.
 * As bolas são animadas pela MESMA física do servidor, a partir do retrato da visão (t0 + bolas).
 */
import {
  AmbientLight,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NearestFilter,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Raycaster,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
  type Object3D
} from 'three'
import { buildCourse, LEVEL_H, surfaceLevel, type Course } from '../../../../shared/games/golf/course'
import { mapById } from '../../../../shared/games/golf/maps'
import { BALL_R, cloneBalls, STEP_MS, step, type Ball } from '../../../../shared/games/golf/physics'
import type { GolfView } from '../../../../shared/games/golf/types'
import type { GolfSceneProps, SfxName } from '../../contract'
import { aimEnd, buildHoleMeshes, type MeshData } from './geometry'

/** altura virtual da imagem (em pixels "gordos") */
const VIRTUAL_H = 300
/** quantos passos de física no máximo por quadro (o resto alcança nos próximos) */
const MAX_STEPS_PER_FRAME = 400
/** arrastar até esta distância (em ladrilhos) = força máxima */
const DRAG_FULL = 3
const CHARGE_MS = 1600
const BG = '#221C19'
const AIM_DOTS = 24
/** quanto o relógio estimado pode recuar por visão (ms) */
const CLOCK_DECAY_MS = 2
/** acima disso (em ladrilhos) a bola pula mesmo (ex.: voltou da água) */
const NUDGE_MAX = 0.6
/** quanto da correção sobra a cada quadro */
const NUDGE_KEEP = 0.82
/** a câmera olha um pouco à frente da bola, para o caminho aparecer */
const LOOK_AHEAD = 1.4

interface BallObj {
  group: Group
  ball: Mesh
  shadow: Mesh
  label: Sprite | null
}

function toGeometry(m: MeshData): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(m.pos, 3))
  g.setAttribute('color', new Float32BufferAttribute(m.col, 3))
  g.computeVertexNormals()
  return g
}

function labelSprite(text: string, color: string): Sprite {
  const cv = document.createElement('canvas')
  const ctx = cv.getContext('2d')!
  const font = '600 22px "Pixelify Sans Variable", "Pixelify Sans", monospace'
  ctx.font = font
  const w = Math.ceil(ctx.measureText(text).width) + 16
  cv.width = w
  cv.height = 32
  ctx.font = font
  ctx.fillStyle = 'rgba(34, 28, 25, 0.8)'
  ctx.fillRect(0, 0, w, 32)
  ctx.fillStyle = color
  ctx.fillRect(0, 28, w, 4)
  ctx.fillStyle = '#F3EBDD'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 8, 15)
  const tex = new CanvasTexture(cv)
  tex.magFilter = NearestFilter
  tex.minFilter = NearestFilter
  const sp = new Sprite(new SpriteMaterial({ map: tex, depthTest: false, transparent: true }))
  const h = 0.22
  sp.scale.set((h * w) / 32, h, 1)
  sp.renderOrder = 10
  return sp
}

function disposeTree(o: Object3D): void {
  o.traverse((x) => {
    const m = x as Mesh
    m.geometry?.dispose()
    const mat = m.material as Material | Material[] | undefined
    if (Array.isArray(mat)) mat.forEach((y) => y.dispose())
    else if (mat) {
      const map = (mat as SpriteMaterial).map
      map?.dispose()
      mat.dispose()
    }
  })
}

export class GolfEngine {
  private renderer: WebGLRenderer
  private scene = new Scene()
  private camera = new PerspectiveCamera(48, 16 / 9, 0.05, 200)
  private holeGroup = new Group()
  private ballsGroup = new Group()
  /** mira: pontinhos quadrados deitados no chão (linha de 1 px some na imagem ampliada) */
  private aimDots: Mesh[] = []
  private aimMat = new MeshBasicMaterial({ color: '#FFC94A', side: DoubleSide })
  private flag: Group
  private water: MeshLambertMaterial | null = null
  private raf = 0
  private w = 1
  private h = 1
  private disposed = false

  private props: GolfSceneProps | null = null
  private view: GolfView | null = null
  private course: Course | null = null
  private holeKey = ''

  // simulação local
  private anchorT0 = 0
  private sim: Ball[] = []
  private simStep = 0
  private serverOffset = 0
  private ballObjs = new Map<string, BallObj>()
  /** correção visual que some em poucos quadros (por bola) */
  private nudge = new Map<string, { dx: number; dz: number }>()

  // câmera (órbita em volta do alvo)
  private yaw = 0
  private pitch = 0.85
  private dist = 6
  private curDist = 6
  private target = new Vector3()
  private camReady = false
  /** visão do buraco inteiro: ligada com V e por alguns segundos no começo de cada buraco */
  private overview = false
  private overviewUntil = 0

  // mira
  private aiming: 'mouse' | 'keys' | null = null
  private aimAngle = 0
  private aimPower = 0
  private chargeStart = 0
  private pendingUntil = 0
  private pendingStrokes = -1
  private dragOrbit: { x: number; y: number; yaw: number; pitch: number } | null = null
  private ray = new Raycaster()
  private lastBounce = 0

  constructor(host: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(1)
    const cv = this.renderer.domElement
    cv.className = 'golf-canvas'
    cv.tabIndex = 0
    cv.setAttribute('aria-label', 'Campo de golfe. Arraste da bola para trás e solte para tacar.')
    host.appendChild(cv)
    this.scene.background = new Color(BG)
    this.scene.fog = new Fog(BG, 14, 40)
    this.scene.add(new HemisphereLight('#FFE8C0', '#3A2E28', 1.6))
    this.scene.add(new AmbientLight('#FFC94A', 0.25))
    const sun = new DirectionalLight('#FFF1D6', 1.6)
    sun.position.set(-4, 10, 3)
    this.scene.add(sun)
    this.scene.add(this.holeGroup, this.ballsGroup)

    const dot = new PlaneGeometry(0.07, 0.07)
    dot.rotateX(-Math.PI / 2)
    for (let i = 0; i < AIM_DOTS; i++) {
      const m = new Mesh(dot, this.aimMat)
      m.visible = false
      m.renderOrder = 5
      this.aimDots.push(m)
      this.scene.add(m)
    }

    // bandeira: mastro e pano
    this.flag = new Group()
    const pole = new Mesh(new CylinderGeometry(0.02, 0.02, 1.1, 6), new MeshLambertMaterial({ color: '#F3EBDD' }))
    pole.position.y = 0.55
    const cloth = new Mesh(new PlaneGeometry(0.42, 0.26), new MeshLambertMaterial({ color: '#FFC94A', side: DoubleSide }))
    cloth.position.set(0.22, 0.95, 0)
    this.flag.add(pole, cloth)
    this.scene.add(this.flag)

    cv.addEventListener('pointerdown', this.onDown)
    cv.addEventListener('pointermove', this.onMove)
    cv.addEventListener('pointerup', this.onUp)
    cv.addEventListener('pointercancel', this.onCancel)
    cv.addEventListener('wheel', this.onWheel, { passive: false })
    cv.addEventListener('contextmenu', (e) => e.preventDefault())
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    this.raf = requestAnimationFrame(this.frame)
  }

  resize(w: number, h: number): void {
    this.w = Math.max(1, w)
    this.h = Math.max(1, h)
    const px = Math.max(1, Math.round((this.h * (window.devicePixelRatio || 1)) / VIRTUAL_H))
    const rw = Math.max(1, Math.round((this.w * (window.devicePixelRatio || 1)) / px))
    const rh = Math.max(1, Math.round((this.h * (window.devicePixelRatio || 1)) / px))
    this.renderer.setSize(rw, rh, false)
    this.camera.aspect = this.w / this.h
    this.camera.updateProjectionMatrix()
  }

  setProps(p: GolfSceneProps): void {
    this.props = p
    const v = p.view
    if (v === this.view) return
    const prev = this.view
    this.view = v
    this.syncClock(v.serverNow)
    const key = `${v.mapId}:${v.hole}`
    if (key !== this.holeKey) this.loadHole(key, v)
    // retrato novo: recomeça a simulação dele e alcança o agora de uma vez (sem sons repetidos)
    void prev
    const before = new Map(this.sim.map((b) => [b.playerId, b]))
    this.anchorT0 = v.t0
    this.sim = cloneBalls(v.balls)
    this.simStep = 0
    this.catchUp()
    // diferença pequena (atraso da rede): desliza até o lugar certo em vez de pular
    for (const b of this.sim) {
      const o = before.get(b.playerId)
      const prevNudge = this.nudge.get(b.playerId) ?? { dx: 0, dz: 0 }
      const dx = o ? o.x + prevNudge.dx - b.x : 0
      const dz = o ? o.z + prevNudge.dz - b.z : 0
      if (o && b.mode !== 'cup' && dx * dx + dz * dz < NUDGE_MAX * NUDGE_MAX) this.nudge.set(b.playerId, { dx, dz })
      else this.nudge.delete(b.playerId)
    }
    this.syncBallObjs()
    // a tacada voltou do servidor: libera a próxima
    const mine = v.players.find((x) => x.playerId === p.me)
    if (mine && mine.strokes !== this.pendingStrokes) this.pendingUntil = 0
  }

  private loadHole(key: string, v: GolfView): void {
    this.holeKey = key
    const def = mapById(v.mapId)?.holes[v.hole]
    if (!def) return
    const c = buildCourse(def)
    this.course = c
    // buraco novo: nada de deslizar bola do buraco anterior
    this.sim = []
    this.nudge.clear()
    for (const ch of [...this.holeGroup.children]) {
      this.holeGroup.remove(ch)
      disposeTree(ch)
    }
    const m = buildHoleMeshes(c)
    const mat = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide, flatShading: true })
    this.holeGroup.add(new Mesh(toGeometry(m.floor), mat))
    this.holeGroup.add(new Mesh(toGeometry(m.rails), mat.clone()))
    this.holeGroup.add(new Mesh(toGeometry(m.marks), new MeshBasicMaterial({ vertexColors: true, side: DoubleSide })))
    this.water = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide, transparent: true, opacity: 0.85, emissive: '#10324A' })
    this.holeGroup.add(new Mesh(toGeometry(m.water), this.water))
    // tapete embaixo de tudo
    const rug = new Mesh(new PlaneGeometry(c.w + 40, c.h + 40), new MeshLambertMaterial({ color: '#2B231F' }))
    rug.rotation.x = -Math.PI / 2
    rug.position.set(c.w / 2, -1.5 * LEVEL_H - 0.01, c.h / 2)
    this.holeGroup.add(rug)
    this.flag.position.set(c.cup.x, surfaceLevel(c, c.cup.x, c.cup.z) * LEVEL_H, c.cup.z)
    // câmera: atrás da saída olhando para o buraco
    this.yaw = Math.atan2(c.cup.z - c.tee.z, c.cup.x - c.tee.x)
    this.aimAngle = this.yaw
    this.dist = Math.min(10, Math.max(5.5, Math.hypot(c.w, c.h) * 0.55))
    this.overviewUntil = performance.now() + 2800
    this.camReady = false
    this.aiming = null
    for (const d of this.aimDots) d.visible = false
  }

  private syncBallObjs(): void {
    const v = this.view
    const p = this.props
    if (!v || !p) return
    const want = new Set(v.balls.map((b) => b.playerId))
    for (const [id, o] of this.ballObjs) {
      if (want.has(id)) continue
      this.ballsGroup.remove(o.group)
      disposeTree(o.group)
      this.ballObjs.delete(id)
    }
    for (const b of v.balls) {
      if (this.ballObjs.has(b.playerId)) continue
      const color = p.colors[b.playerId] ?? '#F3EBDD'
      const mine = b.playerId === p.me
      const ghost = !v.collisions && !mine
      const group = new Group()
      const ball = new Mesh(
        new SphereGeometry(BALL_R, 12, 8),
        new MeshLambertMaterial({ color, transparent: ghost, opacity: ghost ? 0.45 : 1, emissive: mine ? '#2A2010' : '#000000' })
      )
      const shadow = new Mesh(new CylinderGeometry(BALL_R * 1.1, BALL_R * 1.1, 0.002, 10), new MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.35 }))
      group.add(ball, shadow)
      const name = v.players.find((x) => x.playerId === b.playerId)?.name ?? ''
      const label = mine ? null : labelSprite(name, color)
      if (label) group.add(label)
      this.ballsGroup.add(group)
      this.ballObjs.set(b.playerId, { group, ball, shadow, label })
    }
    // marcador de "é você": um cone pequeno em cima da sua bola
    const me = p.me ? this.ballObjs.get(p.me) : undefined
    if (me && !me.group.getObjectByName('me-marker')) {
      const cone = new Mesh(new ConeGeometry(0.07, 0.14, 4), new MeshBasicMaterial({ color: '#FFC94A' }))
      cone.rotation.x = Math.PI
      cone.position.y = 0.42
      cone.name = 'me-marker'
      me.group.add(cone)
    }
  }

  // ---------- tempo e física ----------
  /**
   * Relógio do servidor estimado aqui. Cada visão dá uma amostra (servidor - cliente - atraso da rede);
   * a maior amostra é a de menor atraso, então só subimos para ela e descemos devagar. Sem isso, o
   * sobe-e-desce do atraso fazia as bolas pularem a cada visão nova.
   */
  private clockSet = false
  private syncClock(serverNow: number): void {
    const sample = serverNow - Date.now()
    if (!this.clockSet || sample > this.serverOffset) this.serverOffset = sample
    else this.serverOffset -= Math.min(this.serverOffset - sample, CLOCK_DECAY_MS)
    this.clockSet = true
  }

  private serverNow(): number {
    return Date.now() + this.serverOffset
  }

  /** alcança o relógio sem limite por quadro (usado ao receber um retrato novo) */
  private catchUp(): void {
    const c = this.course
    const v = this.view
    if (!c || !v) return
    const want = Math.floor((this.serverNow() - this.anchorT0) / STEP_MS)
    while (this.simStep < want && this.sim.some((b) => b.mode === 'roll')) {
      step(c, this.sim, v.collisions)
      this.simStep++
    }
  }

  private advanceSim(): void {
    const c = this.course
    const v = this.view
    if (!c || !v) return
    const want = Math.floor((this.serverNow() - this.anchorT0) / STEP_MS)
    let n = 0
    while (this.simStep < want && n < MAX_STEPS_PER_FRAME && this.sim.some((b) => b.mode === 'roll')) {
      const before = this.sim.map((b) => ({ mode: b.mode, splash: b.splash, vx: b.vx, vz: b.vz }))
      step(c, this.sim, v.collisions)
      this.simStep++
      n++
      this.detectSfx(before)
    }
    if (!this.sim.some((b) => b.mode === 'roll')) this.simStep = Math.max(this.simStep, want)
  }

  private detectSfx(before: Array<{ mode: string; splash: number; vx: number; vz: number }>): void {
    const sfx = this.props?.onSfx
    if (!sfx) return
    const now = performance.now()
    this.sim.forEach((b, i) => {
      const was = before[i]
      if (!was) return
      let name: SfxName | null = null
      if (b.splash > was.splash) name = 'splash'
      else if (b.mode === 'cup' && was.mode !== 'cup') name = 'cup'
      else if (b.mode === 'roll') {
        const dot = b.vx * was.vx + b.vz * was.vz
        const sp = Math.sqrt(was.vx * was.vx + was.vz * was.vz)
        if (sp > 1.2 && dot < 0.3 * sp * sp && now - this.lastBounce > 90) {
          name = 'bounce'
          this.lastBounce = now
        }
      }
      if (name) sfx(name)
    })
  }

  // ---------- quadro ----------
  private frame = (): void => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.frame)
    this.advanceSim()
    this.placeBalls()
    this.updateAim()
    this.updateCamera()
    if (import.meta.env.DEV) this.exposeBall()
    if (this.water && !this.props?.reducedMotion) {
      const t = performance.now() / 1000
      this.water.emissive.setRGB(0.06 + Math.sin(t * 2) * 0.02, 0.2 + Math.sin(t * 1.3) * 0.03, 0.29)
    }
    this.renderer.render(this.scene, this.camera)
  }

  private placeBalls(): void {
    const c = this.course
    if (!c) return
    for (const b of this.sim) {
      const o = this.ballObjs.get(b.playerId)
      if (!o) continue
      const n = this.nudge.get(b.playerId)
      let x = b.x
      let z = b.z
      if (n) {
        x += n.dx
        z += n.dz
        n.dx *= NUDGE_KEEP
        n.dz *= NUDGE_KEEP
        if (n.dx * n.dx + n.dz * n.dz < 1e-6) this.nudge.delete(b.playerId)
      }
      const ground = surfaceLevel(c, x, z) * LEVEL_H
      const sink = b.mode === 'cup' ? -BALL_R * 1.6 : 0
      o.group.position.set(x, ground, z)
      o.ball.position.y = BALL_R + sink
      o.shadow.visible = b.mode !== 'cup'
      o.shadow.position.y = 0.004
      if (o.label) {
        o.label.position.y = 0.45
        o.label.visible = b.mode !== 'cup'
      }
    }
  }

  /** só em dev: posição da sua bola na tela, para os testes no navegador */
  private exposeBall(): void {
    const b = this.myBall()
    const c = this.course
    if (!b || !c) return
    const p = new Vector3(b.x, surfaceLevel(c, b.x, b.z) * LEVEL_H + BALL_R, b.z).project(this.camera)
    const r = this.renderer.domElement.getBoundingClientRect()
    this.renderer.domElement.dataset.ball = `${Math.round(r.left + ((p.x + 1) / 2) * r.width)},${Math.round(r.top + ((1 - p.y) / 2) * r.height)}`
  }

  private myBall(): Ball | undefined {
    const me = this.props?.me
    return me ? this.sim.find((b) => b.playerId === me) : undefined
  }

  /** posso tacar agora? */
  private canShoot(): boolean {
    const v = this.view
    const me = this.props?.me
    if (!v || !me || v.phase !== 'jogando') return false
    const pl = v.players.find((x) => x.playerId === me)
    const b = this.myBall()
    if (!pl || !b || pl.done || pl.strokes >= v.cap) return false
    if (performance.now() < this.pendingUntil) return false
    return b.mode === 'rest'
  }

  private updateCamera(): void {
    const c = this.course
    if (!c) return
    const b = this.myBall()
    const want = new Vector3()
    let dist = this.dist
    const wide = this.overview || (performance.now() < this.overviewUntil && !this.aiming)
    if (wide) {
      want.set(c.w / 2, 0, c.h / 2)
      dist = Math.max(this.dist, Math.hypot(c.w, c.h) * 0.95 + 2)
    } else if (b && b.mode !== 'cup') {
      want.set(b.x + Math.cos(this.yaw) * LOOK_AHEAD, surfaceLevel(c, b.x, b.z) * LEVEL_H, b.z + Math.sin(this.yaw) * LOOK_AHEAD)
    }
    else want.set(c.cup.x, surfaceLevel(c, c.cup.x, c.cup.z) * LEVEL_H, c.cup.z)
    if (!this.camReady || this.props?.reducedMotion) {
      this.target.copy(want)
      this.curDist = dist
      this.camReady = true
    } else {
      this.target.lerp(want, 0.08)
      this.curDist += (dist - this.curDist) * 0.08
    }
    const cp = Math.cos(this.pitch)
    this.camera.position.set(
      this.target.x - Math.cos(this.yaw) * cp * this.curDist,
      this.target.y + Math.sin(this.pitch) * this.curDist,
      this.target.z - Math.sin(this.yaw) * cp * this.curDist
    )
    this.camera.lookAt(this.target)
  }

  private updateAim(): void {
    const c = this.course
    const b = this.myBall()
    if (!c || !b || !this.aiming || !this.canShoot()) {
      for (const d of this.aimDots) d.visible = false
      if (this.aiming && !this.canShoot()) this.aiming = null
      return
    }
    if (this.aiming === 'keys' && this.chargeStart) {
      const t = ((performance.now() - this.chargeStart) % (CHARGE_MS * 2)) / CHARGE_MS
      this.aimPower = t <= 1 ? t : 2 - t
    }
    const len = 0.6 + this.aimPower * 3.4
    const end = aimEnd(c, b.x, b.z, this.aimAngle, len)
    const reach = Math.hypot(end.x - b.x, end.z - b.z)
    const gap = 0.17
    this.aimDots.forEach((d, i) => {
      const at = BALL_R + 0.08 + i * gap
      d.visible = at <= reach
      if (!d.visible) return
      const x = b.x + Math.cos(this.aimAngle) * at
      const z = b.z + Math.sin(this.aimAngle) * at
      d.position.set(x, surfaceLevel(c, x, z) * LEVEL_H + 0.02, z)
    })
    // cor: do papel (fraca) ao abajur (forte) ao vermelho (máxima)
    const p = this.aimPower
    this.aimMat.color.set(p > 0.9 ? '#E0603A' : p > 0.5 ? '#FFC94A' : '#F3EBDD')
  }

  private shoot(): void {
    if (!this.canShoot() || this.aimPower < 0.03) {
      this.aiming = null
      return
    }
    const me = this.view?.players.find((x) => x.playerId === this.props?.me)
    this.pendingStrokes = me?.strokes ?? -1
    this.pendingUntil = performance.now() + 2500
    this.props?.onShot(this.aimAngle, Math.min(1, this.aimPower))
    this.aiming = null
    this.chargeStart = 0
    this.aimPower = 0
  }

  // ---------- entrada ----------
  private groundPoint(e: PointerEvent, y: number): Vector3 | null {
    const r = this.renderer.domElement.getBoundingClientRect()
    const ndc = new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    this.ray.setFromCamera(ndc, this.camera)
    const hit = new Vector3()
    return this.ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -y), hit)
  }

  private ballScreenDist(e: PointerEvent, b: Ball): number {
    const c = this.course!
    const p = new Vector3(b.x, surfaceLevel(c, b.x, b.z) * LEVEL_H + BALL_R, b.z).project(this.camera)
    const r = this.renderer.domElement.getBoundingClientRect()
    const sx = r.left + ((p.x + 1) / 2) * r.width
    const sy = r.top + ((1 - p.y) / 2) * r.height
    return Math.hypot(e.clientX - sx, e.clientY - sy)
  }

  private onDown = (e: PointerEvent): void => {
    this.renderer.domElement.focus({ preventScroll: true })
    const b = this.myBall()
    if (e.button === 0 && b && this.canShoot() && !this.overview && this.ballScreenDist(e, b) < Math.max(48, this.h * 0.08)) {
      this.aiming = 'mouse'
      this.overviewUntil = 0
      this.aimPower = 0
      this.renderer.domElement.setPointerCapture(e.pointerId)
      return
    }
    this.dragOrbit = { x: e.clientX, y: e.clientY, yaw: this.yaw, pitch: this.pitch }
    this.renderer.domElement.setPointerCapture(e.pointerId)
  }

  private onMove = (e: PointerEvent): void => {
    if (this.aiming === 'mouse') {
      const b = this.myBall()
      const c = this.course
      if (!b || !c) return
      const g = this.groundPoint(e, surfaceLevel(c, b.x, b.z) * LEVEL_H)
      if (!g) return
      // estilingue: puxa para trás, a bola vai para o lado oposto
      const dx = b.x - g.x
      const dz = b.z - g.z
      const len = Math.hypot(dx, dz)
      if (len > 0.02) this.aimAngle = Math.atan2(dz, dx)
      this.aimPower = Math.min(1, len / DRAG_FULL)
      return
    }
    if (this.dragOrbit) {
      const d = this.dragOrbit
      this.yaw = d.yaw + ((e.clientX - d.x) / this.w) * Math.PI * 1.5
      this.pitch = Math.min(1.45, Math.max(0.25, d.pitch + ((e.clientY - d.y) / this.h) * 1.5))
    }
  }

  private onUp = (e: PointerEvent): void => {
    if (this.aiming === 'mouse') this.shoot()
    this.dragOrbit = null
    if (this.renderer.domElement.hasPointerCapture(e.pointerId)) this.renderer.domElement.releasePointerCapture(e.pointerId)
  }

  private onCancel = (): void => {
    if (this.aiming === 'mouse') this.aiming = null
    this.dragOrbit = null
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    this.dist = Math.min(14, Math.max(2, this.dist * (e.deltaY > 0 ? 1.1 : 0.9)))
  }

  private typing(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null
    return !!t && (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || !!t.closest('[role="listbox"], [role="dialog"]'))
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.typing(e) || e.ctrlKey || e.metaKey || e.altKey) return
    const k = e.key
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      e.preventDefault()
      const d = (k === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.01 : 0.04)
      if (this.canShoot()) {
        this.overview = false
        this.overviewUntil = 0
        if (!this.aiming) this.aiming = 'keys'
        this.aimAngle += d
        if (this.aiming === 'keys') this.yaw = this.aimAngle
      } else this.yaw += d
    } else if (k === 'ArrowUp' || k === 'ArrowDown') {
      e.preventDefault()
      this.dist = Math.min(14, Math.max(2, this.dist * (k === 'ArrowUp' ? 0.92 : 1.08)))
    } else if (k === ' ') {
      e.preventDefault()
      if (e.repeat || !this.canShoot()) return
      this.overview = false
      this.overviewUntil = 0
      if (this.aiming !== 'keys') {
        this.aiming = 'keys'
        // começa mirando para onde a câmera olha
        this.aimAngle = this.yaw
      }
      this.chargeStart = performance.now()
    } else if (k === 'v' || k === 'V') {
      e.preventDefault()
      this.overview = !this.overview
      this.overviewUntil = 0
    } else if (k === 'Escape' && this.aiming) {
      this.aiming = null
      this.chargeStart = 0
    }
  }

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === ' ' && this.aiming === 'keys' && this.chargeStart) {
      e.preventDefault()
      this.shoot()
    }
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    disposeTree(this.scene)
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
