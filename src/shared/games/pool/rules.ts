/**
 * Bola 8: armação do triângulo e as contas dos grupos (puro).
 * Lisas 1..7, listradas 9..15, a 8 preta. A branca começa na marca de saída (atrás da linha).
 */
import { shuffle, type Rng } from '../types'
import { isFree, R, TABLE_H, type PBall } from './physics'

export type Group = 'lisas' | 'listradas'

/** linha de saída: na quebra (e só nela) a branca vai atrás desta linha */
export const HEAD_X = 25
export const HEAD = { x: 25, y: TABLE_H / 2 }
export const FOOT = { x: 75, y: TABLE_H / 2 }

export const SOLIDS = [1, 2, 3, 4, 5, 6, 7]
export const STRIPES = [9, 10, 11, 12, 13, 14, 15]
export const groupOf = (id: number): Group | null => (id >= 1 && id <= 7 ? 'lisas' : id >= 9 && id <= 15 ? 'listradas' : null)
export const ballsOf = (g: Group): number[] => (g === 'lisas' ? SOLIDS : STRIPES)
export const other = (g: Group): Group => (g === 'lisas' ? 'listradas' : 'lisas')

/** Triângulo com a ponta na marca do fundo: a 8 no meio, um canto de trás lisa e o outro listrada. */
export function rack(rng: Rng): PBall[] {
  const gap = 0.02
  const dx = (2 * R + gap) * 0.8660254037844386 // sqrt(3)/2
  const spots: Array<{ x: number; y: number }> = []
  for (let row = 0; row < 5; row++)
    for (let k = 0; k <= row; k++) spots.push({ x: FOOT.x + row * dx, y: FOOT.y + (k - row / 2) * (2 * R + gap) })
  // posições: 4 = meio da 3ª fileira (a 8); 10 e 14 = cantos de trás
  const corners = rng.int(2) === 0 ? [1, 9] : [9, 1]
  const rest = shuffle(
    [...SOLIDS, ...STRIPES].filter((n) => n !== corners[0] && n !== corners[1]),
    rng
  )
  const ids: number[] = []
  for (let i = 0; i < 15; i++) ids.push(i === 4 ? 8 : i === 10 ? corners[0] : i === 14 ? corners[1] : (rest.shift() as number))
  return [{ id: 0, x: HEAD.x, y: HEAD.y, vx: 0, vy: 0, in: false }, ...ids.map((id, i) => ({ id, ...spots[i], vx: 0, vy: 0, in: false }))]
}

/** Primeiro lugar livre a partir de `from`, andando para a direita (devolve a 8 ou a branca à mesa). */
export function freeSpot(balls: readonly PBall[], from: { x: number; y: number }, id: number): { x: number; y: number } {
  for (let k = 0; k < 200; k++) {
    for (const dy of [0, 2.4, -2.4, 4.8, -4.8]) {
      const p = { x: from.x + k * 0.6 * (k % 2 ? -1 : 1), y: from.y + dy }
      if (isFree(balls, p.x, p.y, id)) return p
    }
  }
  return { ...from }
}
