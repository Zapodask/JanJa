/**
 * Física da sinuca. Determinística como a do golfe: passo fixo (`DT`) e só + - * / sqrt dentro do
 * laço, então o servidor (Worker) e o navegador chegam ao mesmo lugar. A tacada chega como vetor
 * de direção (nada de seno/cosseno). O servidor simula a tacada inteira de uma vez; o navegador
 * roda a mesma simulação passo a passo para animar e, no fim, encaixa no resultado do servidor.
 *
 * Mesa: área de jogo de 100 x 50 (x para a direita, y para baixo), origem no canto de cima à esquerda.
 */

export const TABLE_W = 100
export const TABLE_H = 50
export const R = 1.12
/** passos por segundo */
export const HZ = 480
export const DT = 1 / HZ
export const MAX_SPEED = 300
export const MIN_SPEED = 8
/** nenhuma tacada dura mais que isso (passos) */
export const MAX_STEPS = HZ * 25

/** atrito do pano: um tanto fixo e um tanto que cresce com a velocidade (bola rápida perde força logo) */
const FRICTION = 6
const DRAG = 0.12
const REST = 0.5
const BALL_E = 0.96
const RAIL_E = 0.78

export interface Pocket {
  x: number
  y: number
  /** a bola cai se o centro chegar a esta distância */
  r: number
}

/** raio das caçapas: do canto e do meio (o centro da bola encostada na tabela fica a 1,92 da do meio) */
const CORNER_R = 2.4
const SIDE_R = 2.2

export const POCKETS: readonly Pocket[] = [
  { x: 0, y: 0, r: CORNER_R },
  { x: TABLE_W / 2, y: -0.8, r: SIDE_R },
  { x: TABLE_W, y: 0, r: CORNER_R },
  { x: 0, y: TABLE_H, r: CORNER_R },
  { x: TABLE_W / 2, y: TABLE_H + 0.8, r: SIDE_R },
  { x: TABLE_W, y: TABLE_H, r: CORNER_R }
]

/** 0 = branca, 1..7 lisas, 8 a preta, 9..15 listradas */
export interface PBall {
  id: number
  x: number
  y: number
  vx: number
  vy: number
  /** caiu na caçapa */
  in: boolean
}

export interface ShotLog {
  /** primeira bola em que a branca encostou */
  firstHit: number | null
  pocketed: Array<{ id: number; pocket: number }>
  /** alguma bola bateu na tabela depois do primeiro toque */
  railAfterHit: boolean
  steps: number
}

export const newLog = (): ShotLog => ({ firstHit: null, pocketed: [], railAfterHit: false, steps: 0 })
export const cloneBalls = (balls: readonly PBall[]): PBall[] => balls.map((b) => ({ ...b }))

/** Põe a branca em movimento: `dx, dy` é a direção (qualquer tamanho), `power` de 0 a 1. */
export function strike(balls: PBall[], dx: number, dy: number, power: number): void {
  const cue = balls.find((b) => b.id === 0)
  const len = Math.sqrt(dx * dx + dy * dy)
  if (!cue || len === 0) return
  const p = power < 0 ? 0 : power > 1 ? 1 : power
  const speed = MIN_SPEED + (MAX_SPEED - MIN_SPEED) * p
  cue.vx = (dx / len) * speed
  cue.vy = (dy / len) * speed
}

const nearPocket = (b: PBall, extra: number): number => POCKETS.findIndex((p) => (b.x - p.x) * (b.x - p.x) + (b.y - p.y) * (b.y - p.y) < (p.r + extra) * (p.r + extra))

/** Um passo. Devolve true se alguma bola ainda se move. */
export function step(balls: PBall[], log: ShotLog): boolean {
  log.steps++
  let moving = false
  for (const b of balls) {
    if (b.in) continue
    const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy)
    if (sp === 0) continue
    // atrito: desacelera sempre na mesma direção
    const ns = sp - (FRICTION + DRAG * sp) * DT
    if (ns <= REST) {
      b.vx = 0
      b.vy = 0
      continue
    }
    b.vx = (b.vx / sp) * ns
    b.vy = (b.vy / sp) * ns
    b.x += b.vx * DT
    b.y += b.vy * DT
    moving = true
    // caçapa
    const pk = nearPocket(b, 0)
    if (pk >= 0) {
      b.in = true
      b.vx = 0
      b.vy = 0
      log.pocketed.push({ id: b.id, pocket: pk })
      continue
    }
    // tabelas (na boca da caçapa a bola passa direto)
    if (nearPocket(b, R * 1.4) < 0) {
      let rail = false
      if (b.x < R) {
        b.x = R + (R - b.x)
        b.vx = -b.vx * RAIL_E
        rail = true
      } else if (b.x > TABLE_W - R) {
        b.x = TABLE_W - R - (b.x - (TABLE_W - R))
        b.vx = -b.vx * RAIL_E
        rail = true
      }
      if (b.y < R) {
        b.y = R + (R - b.y)
        b.vy = -b.vy * RAIL_E
        rail = true
      } else if (b.y > TABLE_H - R) {
        b.y = TABLE_H - R - (b.y - (TABLE_H - R))
        b.vy = -b.vy * RAIL_E
        rail = true
      }
      if (rail && log.firstHit !== null) log.railAfterHit = true
    } else if (b.x < -R || b.y < -R || b.x > TABLE_W + R || b.y > TABLE_H + R) {
      // escapou pela boca sem cair: conta como caçapa mais perto
      let best = 0
      let bd = Infinity
      POCKETS.forEach((p, i) => {
        const d = (b.x - p.x) * (b.x - p.x) + (b.y - p.y) * (b.y - p.y)
        if (d < bd) {
          bd = d
          best = i
        }
      })
      b.in = true
      b.vx = 0
      b.vy = 0
      log.pocketed.push({ id: b.id, pocket: best })
    }
  }
  // choques entre bolas (massas iguais)
  for (let i = 0; i < balls.length; i++) {
    const a = balls[i]
    if (a.in) continue
    for (let j = i + 1; j < balls.length; j++) {
      const c = balls[j]
      if (c.in) continue
      const dx = c.x - a.x
      const dy = c.y - a.y
      const d2 = dx * dx + dy * dy
      if (d2 >= 4 * R * R || d2 === 0) continue
      const d = Math.sqrt(d2)
      const nx = dx / d
      const ny = dy / d
      // separa
      const push = (2 * R - d) / 2
      a.x -= nx * push
      a.y -= ny * push
      c.x += nx * push
      c.y += ny * push
      const rel = (a.vx - c.vx) * nx + (a.vy - c.vy) * ny
      if (rel <= 0) continue
      const k = rel * (1 + BALL_E) * 0.5
      a.vx -= k * nx
      a.vy -= k * ny
      c.vx += k * nx
      c.vy += k * ny
      moving = true
      if (log.firstHit === null) {
        if (a.id === 0) log.firstHit = c.id
        else if (c.id === 0) log.firstHit = a.id
      }
    }
  }
  return moving
}

/** Simula a tacada até tudo parar. Não muda `balls`. */
export function simulate(balls: readonly PBall[], dx: number, dy: number, power: number): { balls: PBall[]; log: ShotLog } {
  const w = cloneBalls(balls)
  const log = newLog()
  strike(w, dx, dy, power)
  while (log.steps < MAX_STEPS && step(w, log));
  for (const b of w) {
    b.vx = 0
    b.vy = 0
  }
  return { balls: w, log }
}

/** A bola `id` cabe em (x, y)? (dentro da mesa, longe das caçapas e sem encostar nas outras) */
export function isFree(balls: readonly PBall[], x: number, y: number, id: number, maxX = TABLE_W - R): boolean {
  if (!(x >= R && x <= maxX && y >= R && y <= TABLE_H - R)) return false
  if (POCKETS.some((p) => (x - p.x) * (x - p.x) + (y - p.y) * (y - p.y) < (p.r + R) * (p.r + R))) return false
  return balls.every((b) => b.id === id || b.in || (b.x - x) * (b.x - x) + (b.y - y) * (b.y - y) >= 4 * R * R)
}

/** A branca pode ficar aqui? (bola na mão; `maxX` limita à linha de saída na quebra) */
export const canPlace = (balls: readonly PBall[], x: number, y: number, maxX = TABLE_W - R): boolean => isFree(balls, x, y, 0, maxX)

export interface AimGuide {
  /** bola que a branca acerta primeiro (null = tabela) */
  hit: number | null
  /** onde a branca encosta (bola fantasma) ou bate na tabela */
  ghost: { x: number; y: number }
  /** para onde a bola atingida vai (unitário) */
  object: { x: number; y: number } | null
  /** para onde a branca segue depois do choque (unitário, pode ser zero) */
  cue: { x: number; y: number } | null
}

/** Linha de mira: primeira bola na direção (dx, dy) a partir da branca. */
export function aimGuide(balls: readonly PBall[], dx: number, dy: number): AimGuide | null {
  const cue = balls.find((b) => b.id === 0 && !b.in)
  const len = Math.sqrt(dx * dx + dy * dy)
  if (!cue || len === 0) return null
  const ux = dx / len
  const uy = dy / len
  let best = Infinity
  let hit: PBall | null = null
  for (const b of balls) {
    if (b.id === 0 || b.in) continue
    const ox = b.x - cue.x
    const oy = b.y - cue.y
    const t = ox * ux + oy * uy
    if (t <= 0) continue
    const perp2 = ox * ox + oy * oy - t * t
    const rr = 4 * R * R
    if (perp2 > rr) continue
    const tHit = t - Math.sqrt(rr - perp2)
    if (tHit > 0 && tHit < best) {
      best = tHit
      hit = b
    }
  }
  // tabela
  const tx = ux > 0 ? (TABLE_W - R - cue.x) / ux : ux < 0 ? (R - cue.x) / ux : Infinity
  const ty = uy > 0 ? (TABLE_H - R - cue.y) / uy : uy < 0 ? (R - cue.y) / uy : Infinity
  const tRail = Math.min(tx, ty)
  if (!hit || tRail < best) return { hit: null, ghost: { x: cue.x + ux * tRail, y: cue.y + uy * tRail }, object: null, cue: null }
  const gx = cue.x + ux * best
  const gy = cue.y + uy * best
  const nx0 = hit.x - gx
  const ny0 = hit.y - gy
  const nl = Math.sqrt(nx0 * nx0 + ny0 * ny0)
  const nx = nx0 / nl
  const ny = ny0 / nl
  const dot = ux * nx + uy * ny
  const cx = ux - dot * nx
  const cy = uy - dot * ny
  const cl = Math.sqrt(cx * cx + cy * cy)
  return { hit: hit.id, ghost: { x: gx, y: gy }, object: { x: nx, y: ny }, cue: cl > 1e-6 ? { x: cx / cl, y: cy / cl } : null }
}
