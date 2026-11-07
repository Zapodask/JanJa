import { Grid } from './grid'
import type { Sprite } from './palette'

/**
 * Anel biselado desenhado por distância até a borda (SDF de retângulo arredondado):
 * a mesma função gera a mesa (madeira + feltro), a moldura da TV e a moldura do avatar.
 */
interface Probe {
  /** camada (0 = borda externa) ou -1 se fora */
  L: number
  /** normal externa */
  nx: number
  ny: number
  /** posição ao longo da borda (para a veia da madeira e para o timer) */
  along: number
  angle: number
}
export function probe(x: number, y: number, W: number, H: number, R: number): Probe {
  const px = x + 0.5
  const py = y + 0.5
  const cx = px < R ? R : px > W - R ? W - R : null
  const cy = py < R ? R : py > H - R ? H - R : null
  let d: number
  let nx: number
  let ny: number
  let along: number
  if (cx !== null && cy !== null && R > 0) {
    const dx = px - cx
    const dy = py - cy
    const dc = Math.hypot(dx, dy) || 1e-6
    d = R - dc
    nx = dx / dc
    ny = dy / dc
    along = Math.round(Math.atan2(dy, dx) * (R - 5) * 1.4) + 200
  } else {
    const dl = px
    const dr = W - px
    const dt = py
    const db = H - py
    d = Math.min(dl, dr, dt, db)
    if (d === dt) [nx, ny, along] = [0, -1, x]
    else if (d === db) [nx, ny, along] = [0, 1, x]
    else if (d === dl) [nx, ny, along] = [-1, 0, y]
    else [nx, ny, along] = [1, 0, y]
  }
  const angle = (Math.atan2(px - W / 2, -(py - H / 2)) + 2 * Math.PI) % (2 * Math.PI)
  return { L: d < 0 ? -1 : Math.floor(d), nx, ny, along, angle }
}

/** luz de cima, um pouco da esquerda: >0 = voltado para a luz */
const lit = (p: Probe) => -p.ny * 0.9 - p.nx * 0.35

// ---------- mesa 48x48 (9-slice com cantos de 16) ----------
const TW = 48
const TR = 14
const RAIL = 12

function feltNoise(x: number, y: number): string {
  if (x % 8 === 2 && y % 4 === 1) return 'h'
  if (x % 8 === 6 && y % 4 === 3) return 'f'
  if (x % 16 === 11 && y % 8 === 6) return 'h'
  return 'F'
}

function tableTexel(x: number, y: number): string {
  const p = probe(x, y, TW, TW, TR)
  if (p.L < 0) return '.'
  const l = lit(p)
  const { L } = p
  if (L === 0) return 'k'
  if (L === 1) return l > 0.35 ? 'M' : l < -0.35 ? 'n' : 'm'
  if (L <= 9) {
    if (L === 9) return 'n'
    if (L === 2) return l > 0.35 ? 'M' : 'm'
    const a = p.along
    if (L === 4 && (a + 3) % 14 < 8) return 'n'
    if (L === 7 && (a + 9) % 18 < 10) return 'n'
    if (L === 3 && (a * 1) % 16 < 6) return 'M'
    if (L === 6 && (a + 5) % 20 < 5) return 'M'
    if (L === 5 && a % 23 === 7) return 'n'
    return 'm'
  }
  if (L === 10) return l < -0.35 ? 'M' : l > 0.35 ? 'n' : 'm'
  if (L === 11) return 'k'
  // feltro: sombra projetada pela borda (mais larga embaixo da borda de cima)
  const e = L - RAIL
  const reach = l > 0.35 ? 4 : l < -0.35 ? 1 : 2
  if (e < reach) {
    if (e === 0) return 'f'
    const t = e / reach
    return (x + y) % 2 === 0 ? (t < 0.5 ? 'f' : 'F') : t < 0.5 ? 'F' : feltNoise(x, y)
  }
  return feltNoise(x, y)
}

export function table9(): Sprite {
  const g = new Grid(TW, TW)
  for (let y = 0; y < TW; y++) for (let x = 0; x < TW; x++) g.set(x, y, tableTexel(x, y))
  return g.toSprite()
}
export function crop(s: Sprite, x: number, y: number, w: number, h: number): Sprite {
  return s.slice(y, y + h).map((l) => l.slice(x, x + w))
}

// ---------- parede: tijolo 32x32 sutil ----------
export function wallTile(): Sprite {
  const g = new Grid(32, 32)
  const BW = 16
  const BH = 8
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const row = Math.floor(y / BH)
      const ry = y % BH
      const ox = (row % 2) * (BW / 2)
      const bx = (x + ox) % BW
      const brick = Math.floor((x + ox) / BW)
      let ch = 'W'
      if (ry === 0 || bx === 0) ch = 'w'
      else if (ry === 1) ch = (x + y) % 2 === 0 ? 'r' : 'W'
      else if (ry === BH - 1) ch = (x + y) % 2 === 0 ? 'w' : 'W'
      else {
        const v = (brick * 5 + row * 3) % 4
        if (v === 0 && (x * 3 + y * 5) % 11 === 0) ch = 'r'
        else if (v === 1 && (x * 7 + y) % 13 === 0) ch = 'w'
        else if (v === 2 && x % 4 === 1 && y % 3 === 0 && ry < 5) ch = 'r'
      }
      g.set(x, y, ch)
    }
  return g.toSprite()
}

// ---------- moldura da TV pendurada (9-slice 36x36, borda de 12; o buraco é transparente) ----------
const FW = 36
const FRAME_T = 9
function tvFrameTexel(x: number, y: number): string {
  const p = probe(x, y, FW, FW, 3)
  if (p.L < 0) return '.'
  const l = lit(p)
  const { L } = p
  if (L >= FRAME_T) return '.'
  if (L === 0) return 'k'
  if (L === 1) return l > 0.35 ? 'M' : l < -0.35 ? 'm' : 'M'
  if (L <= 5) return l > 0.35 ? 'M' : l < -0.35 ? 'n' : 'm'
  if (L === 6) return l > 0.35 ? 'm' : 'n'
  if (L === 7) return 'k'
  return 'w'
}
export function tvFrame9(): Sprite {
  const g = new Grid(FW, FW)
  for (let y = 0; y < FW; y++) for (let x = 0; x < FW; x++) g.set(x, y, tvFrameTexel(x, y))
  return g.toSprite()
}

/** Fio em V e prego, para ficar acima da moldura. 32x14: as pontas (x=3 e x=28) tocam o topo da moldura. */
export function tvHanger(): Sprite {
  const g = new Grid(32, 14)
  const line = (x0: number, y0: number, x1: number, y1: number, ch: string) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))
    for (let i = 0; i <= n; i++) g.set(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), ch)
  }
  line(15, 3, 3, 13, 'd')
  line(16, 3, 28, 13, 'd')
  line(15, 4, 4, 13, 'k')
  line(16, 4, 27, 13, 'k')
  // prego
  g.rect(14, 0, 4, 4, 'k')
  g.rect(15, 1, 2, 2, 'p')
  g.set(15, 1, 'P').set(16, 2, 'd')
  // argolas
  g.rect(2, 12, 3, 2, 'p').set(3, 13, 'k')
  g.rect(27, 12, 3, 2, 'p').set(28, 13, 'k')
  return g.toSprite()
}

export const tvLed = (on: boolean): Sprite => (on ? ['kgk', 'ggg', 'kgk'].map((l) => l) : ['kkk', 'krk', 'kkk'])
