/**
 * Geometria sobre a grade do mapa (laços quentes da simulação e da IA).
 * Só + - * / sqrt e Math.floor: nada aqui usa aleatoriedade nem relógio.
 */
import { TILE } from './types'
import type { MapGrid } from './maps/legend'

/** índice do tile que contém (x, y), ou -1 se fora do mapa */
export function tileIndex(g: MapGrid, x: number, y: number): number {
  const tx = Math.floor(x / TILE)
  const ty = Math.floor(y / TILE)
  if (tx < 0 || ty < 0 || tx >= g.w || ty >= g.h) return -1
  return ty * g.w + tx
}

/** ponto dentro de tile sólido (fora do mapa conta como sólido) */
export function pointSolid(g: MapGrid, x: number, y: number): boolean {
  const i = tileIndex(g, x, y)
  return i < 0 || g.solid[i] === 1
}

/** ponto dentro de tile que bloqueia tiro */
export function pointShotBlocked(g: MapGrid, x: number, y: number): boolean {
  const i = tileIndex(g, x, y)
  return i < 0 || g.shot[i] === 1
}

/** círculo de raio r em (x, y) encosta em algum tile sólido? (encostar de leve não conta) */
export function circleBlocked(g: MapGrid, x: number, y: number, r: number): boolean {
  const tx0 = Math.floor((x - r) / TILE)
  const tx1 = Math.floor((x + r) / TILE)
  const ty0 = Math.floor((y - r) / TILE)
  const ty1 = Math.floor((y + r) / TILE)
  const lim = r * r - 1e-4
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const out = tx < 0 || ty < 0 || tx >= g.w || ty >= g.h
      if (!out && g.solid[ty * g.w + tx] === 0) continue
      const px = x < tx * TILE ? tx * TILE : x > tx * TILE + TILE ? tx * TILE + TILE : x
      const py = y < ty * TILE ? ty * TILE : y > ty * TILE + TILE ? ty * TILE + TILE : y
      const dx = x - px
      const dy = y - py
      if (dx * dx + dy * dy < lim) return true
    }
  }
  return false
}

/** linha de visada livre de tiles que bloqueiam tiro (amostrando a cada ~2 px) */
export function shotClear(g: MapGrid, x0: number, y0: number, x1: number, y1: number): boolean {
  const dx = x1 - x0
  const dy = y1 - y0
  const n = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy) / 2))
  for (let i = 0; i <= n; i++) {
    const t = i / n
    if (pointShotBlocked(g, x0 + dx * t, y0 + dy * t)) return false
  }
  return true
}

/** linha livre de tiles sólidos (para andar/granada) */
export function walkClear(g: MapGrid, x0: number, y0: number, x1: number, y1: number): boolean {
  const dx = x1 - x0
  const dy = y1 - y0
  const n = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy) / 3))
  for (let i = 0; i <= n; i++) {
    const t = i / n
    if (pointSolid(g, x0 + dx * t, y0 + dy * t)) return false
  }
  return true
}
