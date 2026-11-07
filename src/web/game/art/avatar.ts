import { Grid } from './grid'
import { probe } from './table'
import type { Sprite } from './palette'

export const AV = 28
const R = 5

/** Moldura 28x28 (miolo de 20x20): k, dois anéis biselados tingíveis (t/T) e k. */
export function avatarFrame(): Sprite {
  const g = new Grid(AV, AV)
  for (let y = 0; y < AV; y++)
    for (let x = 0; x < AV; x++) {
      const p = probe(x, y, AV, AV, R)
      if (p.L < 0) continue
      const l = -p.ny * 0.9 - p.nx * 0.5
      let ch = '.'
      if (p.L === 0 || p.L === 3) ch = 'k'
      else if (p.L === 1) ch = l > 0.2 ? 't' : 'T'
      else if (p.L === 2) ch = l > 0.2 ? 'T' : 't'
      g.set(x, y, ch)
    }
  return g.toSprite()
}

/** Anel do timer: restam `12 - i` de 12 fatias, no sentido horário a partir do topo. 't' sobre os anéis da moldura. */
export function timerRing(i: number): Sprite {
  const g = new Grid(AV, AV)
  const remaining = (12 - i) / 12
  for (let y = 0; y < AV; y++)
    for (let x = 0; x < AV; x++) {
      const p = probe(x, y, AV, AV, R)
      if (p.L !== 1 && p.L !== 2) continue
      if (p.angle / (2 * Math.PI) < remaining) g.set(x, y, 't')
    }
  return g.toSprite()
}
