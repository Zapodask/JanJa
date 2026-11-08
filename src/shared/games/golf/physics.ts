/**
 * Física do mini-golfe. Determinística: passo fixo de STEP_MS e só + - * / sqrt dentro do laço,
 * então o servidor (Worker) e o navegador (V8 dos dois lados) chegam exatamente ao mesmo lugar.
 * Seno/cosseno só em `shotVelocity`, que roda no servidor; o vetor resultante vai no evento.
 *
 * O mundo é um retrato (bolas com posição e velocidade) num instante t0. Para saber o mundo em t,
 * roda floor((t - t0) / STEP_MS) passos. Nada aqui lê relógio nem sorteia.
 */
import { tileAt, type Course } from './course'

export const STEP_MS = 8
const DT = STEP_MS / 1000

export const BALL_R = 0.11
export const CUP_R = 0.17
/** acima disso a bola passa por cima do buraco */
export const CUP_SPEED = 3.6
export const MAX_SPEED = 9
/** tacada mais fraca */
export const MIN_SPEED = 0.4
/** nenhuma bola rola mais que isso (ms) */
export const MAX_ROLL_MS = 20_000
const MAX_ROLL_STEPS = MAX_ROLL_MS / STEP_MS

const REST_SPEED = 0.06
const GRASS = { mu: 0.9, k: 0.45 }
const SAND = { mu: 4, k: 2.5 }
const TILT_ACC = 0.7
const RAMP_ACC = 3.2
const BOOST_ACC = 14
const BOOST_CAP = 10
const WALL_E = 0.72
const BUMPER_E = 1.05
const BUMPER_KICK = 1.5
const BALL_E = 0.9
const CUP_PULL = 2.2

export type BallMode = 'rest' | 'roll' | 'cup'

export interface Ball {
  playerId: string
  x: number
  z: number
  vx: number
  vz: number
  mode: BallMode
  /** onde estava parada antes de rolar (água devolve para cá) */
  lx: number
  lz: number
  /** quantas vezes caiu na água neste buraco (cada uma soma 1 tacada) */
  splash: number
  /** já saiu da saída (só bolas "vivas" batem umas nas outras) */
  live: boolean
  /** passos rolando desde a última vez que parou */
  age: number
}

export interface World {
  /** ms epoch do retrato */
  t0: number
  balls: Ball[]
}

/** velocidade da tacada. Roda só no servidor (seno/cosseno). */
export function shotVelocity(angle: number, power: number): { vx: number; vz: number } {
  const p = power < 0 ? 0 : power > 1 ? 1 : power
  const speed = MIN_SPEED + (MAX_SPEED - MIN_SPEED) * p
  return { vx: Math.cos(angle) * speed, vz: Math.sin(angle) * speed }
}

export const cloneBalls = (balls: readonly Ball[]): Ball[] => balls.map((b) => ({ ...b }))

function wallCollide(c: Course, b: Ball): void {
  const tx = Math.floor(b.x)
  const tz = Math.floor(b.z)
  if (tx < 0 || tz < 0 || tx >= c.w || tz >= c.h) return
  for (const i of c.wallsAt[tz * c.w + tx]) {
    const w = c.walls[i]
    // lado certo da parede (é de um lado só)
    const side = (b.x - w.ax) * w.nx + (b.z - w.az) * w.nz
    if (side < -1e-9) continue
    const ex = w.bx - w.ax
    const ez = w.bz - w.az
    let t = ((b.x - w.ax) * ex + (b.z - w.az) * ez) / (ex * ex + ez * ez)
    if (t < 0) t = 0
    else if (t > 1) t = 1
    const px = w.ax + ex * t
    const pz = w.az + ez * t
    let dx = b.x - px
    let dz = b.z - pz
    const d2 = dx * dx + dz * dz
    if (d2 >= BALL_R * BALL_R) continue
    const d = Math.sqrt(d2)
    if (d < 1e-9) {
      dx = w.nx
      dz = w.nz
    } else {
      dx /= d
      dz /= d
    }
    const vn = b.vx * dx + b.vz * dz
    if (vn >= 0) continue
    b.x += dx * (BALL_R - d)
    b.z += dz * (BALL_R - d)
    b.vx -= (1 + WALL_E) * vn * dx
    b.vz -= (1 + WALL_E) * vn * dz
  }
}

function bumperCollide(c: Course, b: Ball): void {
  for (const k of c.bumpers) {
    let dx = b.x - k.x
    let dz = b.z - k.z
    const min = k.r + BALL_R
    const d2 = dx * dx + dz * dz
    if (d2 >= min * min) continue
    const d = Math.sqrt(d2)
    if (d < 1e-9) {
      dx = 1
      dz = 0
    } else {
      dx /= d
      dz /= d
    }
    b.x = k.x + dx * min
    b.z = k.z + dz * min
    const vn = b.vx * dx + b.vz * dz
    if (vn < 0) {
      b.vx -= (1 + BUMPER_E) * vn * dx
      b.vz -= (1 + BUMPER_E) * vn * dz
    }
    b.vx += dx * BUMPER_KICK
    b.vz += dz * BUMPER_KICK
  }
}

function startRolling(b: Ball): void {
  if (b.mode !== 'rest') return
  b.mode = 'roll'
  b.lx = b.x
  b.lz = b.z
  b.age = 0
}

function ballsCollide(balls: Ball[]): void {
  const min = BALL_R * 2
  for (let i = 0; i < balls.length; i++) {
    const a = balls[i]
    if (a.mode === 'cup' || !a.live) continue
    for (let j = i + 1; j < balls.length; j++) {
      const b = balls[j]
      if (b.mode === 'cup' || !b.live) continue
      if (a.mode === 'rest' && b.mode === 'rest') continue
      let dx = b.x - a.x
      let dz = b.z - a.z
      const d2 = dx * dx + dz * dz
      if (d2 >= min * min) continue
      const d = Math.sqrt(d2)
      if (d < 1e-9) {
        dx = 1
        dz = 0
      } else {
        dx /= d
        dz /= d
      }
      const push = (min - d) / 2
      a.x -= dx * push
      a.z -= dz * push
      b.x += dx * push
      b.z += dz * push
      const rel = (b.vx - a.vx) * dx + (b.vz - a.vz) * dz
      if (rel >= 0) continue
      const j2 = ((1 + BALL_E) * rel) / 2
      startRolling(a)
      startRolling(b)
      a.vx += j2 * dx
      a.vz += j2 * dz
      b.vx -= j2 * dx
      b.vz -= j2 * dz
    }
  }
}

function moveBall(c: Course, b: Ball): void {
  const t = tileAt(c, Math.floor(b.x), Math.floor(b.z))
  // forças do piso
  if (t.floor === 'slope') {
    const acc = t.rise ? RAMP_ACC : TILT_ACC
    b.vx += t.dx * acc * DT
    b.vz += t.dz * acc * DT
  } else if (t.floor === 'boost') {
    const along = b.vx * t.dx + b.vz * t.dz
    if (along < BOOST_CAP) {
      b.vx += t.dx * BOOST_ACC * DT
      b.vz += t.dz * BOOST_ACC * DT
    }
  }
  // puxão leve perto do buraco
  const cx = c.cup.x - b.x
  const cz = c.cup.z - b.z
  const cd2 = cx * cx + cz * cz
  if (cd2 < CUP_R * CUP_R * 2.6) {
    const cd = Math.sqrt(cd2)
    if (cd > 1e-6) {
      b.vx += (cx / cd) * CUP_PULL * DT
      b.vz += (cz / cd) * CUP_PULL * DT
    }
  }
  // atrito (nunca inverte o sentido)
  const f = t.floor === 'sand' ? SAND : GRASS
  const speed = Math.sqrt(b.vx * b.vx + b.vz * b.vz)
  if (speed > 0) {
    const drop = (f.mu + f.k * speed) * DT
    const ns = speed > drop ? speed - drop : 0
    b.vx = (b.vx / speed) * ns
    b.vz = (b.vz / speed) * ns
  }
  if (speed > MAX_SPEED * 1.6) {
    const s = (MAX_SPEED * 1.6) / speed
    b.vx *= s
    b.vz *= s
  }
  b.x += b.vx * DT
  b.z += b.vz * DT
}

function settleBall(c: Course, b: Ball): void {
  const t = tileAt(c, Math.floor(b.x), Math.floor(b.z))
  if (t.floor === null || t.floor === 'water') {
    b.x = b.lx
    b.z = b.lz
    b.vx = 0
    b.vz = 0
    b.mode = 'rest'
    b.splash += 1
    return
  }
  const cx = c.cup.x - b.x
  const cz = c.cup.z - b.z
  const speed2 = b.vx * b.vx + b.vz * b.vz
  if (cx * cx + cz * cz < CUP_R * CUP_R && speed2 < CUP_SPEED * CUP_SPEED) {
    b.x = c.cup.x
    b.z = c.cup.z
    b.vx = 0
    b.vz = 0
    b.mode = 'cup'
    return
  }
  b.age += 1
  // parada: lenta e num piso que não empurra
  const pushes = t.floor === 'boost' || (t.floor === 'slope' && (t.rise > 0 || TILT_ACC > GRASS.mu))
  if ((speed2 < REST_SPEED * REST_SPEED && !pushes) || b.age >= MAX_ROLL_STEPS) {
    b.vx = 0
    b.vz = 0
    b.mode = 'rest'
  }
}

/** Um passo de STEP_MS. Muda `balls` no lugar. */
export function step(c: Course, balls: Ball[], collisions: boolean): void {
  for (const b of balls) {
    if (b.mode !== 'roll') continue
    moveBall(c, b)
    wallCollide(c, b)
    bumperCollide(c, b)
  }
  if (collisions) ballsCollide(balls)
  for (const b of balls) if (b.mode === 'roll') settleBall(c, b)
}

export const anyRolling = (balls: readonly Ball[]): boolean => balls.some((b) => b.mode === 'roll')

/** Mundo em `t` (>= t0): roda os passos inteiros. Devolve um mundo novo (o t0 novo pode ficar até 1 passo antes de t). */
export function advance(c: Course, w: World, t: number, collisions: boolean): World {
  const n = Math.max(0, Math.floor((t - w.t0) / STEP_MS))
  const balls = cloneBalls(w.balls)
  let done = 0
  for (; done < n && anyRolling(balls); done++) step(c, balls, collisions)
  // parado: o retrato pode pular direto para t (nada mais muda)
  return { t0: w.t0 + n * STEP_MS, balls }
}

/**
 * Próximo instante em que alguma bola muda de estado (para, cai no buraco ou na água),
 * se ninguém mais tacar. null = tudo parado.
 */
export function nextChange(c: Course, w: World, collisions: boolean): number | null {
  if (!anyRolling(w.balls)) return null
  const balls = cloneBalls(w.balls)
  const modes = balls.map((b) => b.mode)
  const splash = balls.map((b) => b.splash)
  for (let i = 1; i <= MAX_ROLL_STEPS + 1; i++) {
    step(c, balls, collisions)
    for (let k = 0; k < balls.length; k++) {
      if (balls[k].mode !== modes[k] || balls[k].splash !== splash[k]) return w.t0 + i * STEP_MS
    }
  }
  return w.t0 + (MAX_ROLL_STEPS + 1) * STEP_MS
}
