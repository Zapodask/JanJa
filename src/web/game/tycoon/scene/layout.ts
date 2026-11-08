/**
 * Geometria do tabuleiro do Magnata (pura, em px): 8 casas por lado, cantos maiores.
 * Casa 0 no canto de baixo à direita; a volta segue para a esquerda, sobe, vai para a direita e desce.
 */
import { BOARD_SIZE, SIDE } from '../../../../shared/games/tycoon/board'

/** tamanho do canto em relação a uma casa comum */
export const CORNER_UNITS = 1.4
const UNITS = 2 * CORNER_UNITS + (SIDE - 1)

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** largura de uma casa comum */
export const unitOf = (size: number): number => size / UNITS

export function tileBox(i: number, size: number): Box {
  const u = unitOf(size)
  const c = CORNER_UNITS * u
  const side = Math.floor((i % BOARD_SIZE) / SIDE)
  const k = i % SIDE
  if (k === 0) {
    const x = side === 0 || side === 3 ? size - c : 0
    const y = side === 0 || side === 1 ? size - c : 0
    return { x, y, w: c, h: c }
  }
  switch (side) {
    case 0:
      return { x: size - c - k * u, y: size - c, w: u, h: c }
    case 1:
      return { x: 0, y: size - c - k * u, w: c, h: u }
    case 2:
      return { x: c + (k - 1) * u, y: 0, w: u, h: c }
    default:
      return { x: size - c, y: c + (k - 1) * u, w: c, h: u }
  }
}

/** miolo do tabuleiro (dados, jogadores, histórico) */
export function centerBox(size: number): Box {
  const c = CORNER_UNITS * unitOf(size)
  return { x: c, y: c, w: size - 2 * c, h: size - 2 * c }
}

/**
 * Onde fica o peão `slot` (0..5) entre os que estão na mesma casa. Os peões ficam na metade de fora
 * da casa (o nome e o preço ficam do lado da faixa do grupo); nos cantos, no meio.
 */
export function tokenSpot(i: number, slot: number, count: number, size: number): { x: number; y: number } {
  const b = tileBox(i, size)
  const u = unitOf(size)
  const side = Math.floor((i % BOARD_SIZE) / SIDE)
  const corner = i % SIDE === 0
  // área dos peões dentro da casa
  let a: Box = b
  if (!corner) {
    if (side === 0) a = { x: b.x, y: b.y + b.h * 0.58, w: b.w, h: b.h * 0.42 }
    else if (side === 2) a = { x: b.x, y: b.y, w: b.w, h: b.h * 0.42 }
    else if (side === 1) a = { x: b.x, y: b.y, w: b.w * 0.4, h: b.h }
    else a = { x: b.x + b.w * 0.6, y: b.y, w: b.w * 0.4, h: b.h }
  } else a = { x: b.x, y: b.y + b.h * 0.15, w: b.w, h: b.h * 0.5 }
  const wide = a.w >= a.h
  const cols = count <= 1 ? 1 : wide ? Math.min(count, 3) : count <= 2 ? 1 : 2
  const rows = Math.ceil(count / cols)
  const col = slot % cols
  const row = Math.floor(slot / cols)
  const gap = u * 0.24
  return {
    x: a.x + a.w / 2 + (col - (cols - 1) / 2) * gap,
    y: a.y + a.h / 2 + (row - (rows - 1) / 2) * gap
  }
}
