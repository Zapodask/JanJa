/** Sala estática (parede, chão, TVs penduradas, prateleira, mesa) composta com os sprites da arte, em linhas de letras. */
import { Grid, bayer } from '../art/grid'
import type { Sprite } from '../art/palette'
import { chipStack } from '../art/chips'
import { table9, tvFrame9, tvHanger, wallTile } from '../art/table'
import { trophy } from '../art/podium'
import type { Rect } from '../contract'
import { TV_BORDER, type SceneGeom } from './layout'

const WALL = wallTile()
const TABLE = table9()
const TVF = tvFrame9()
const HANGER = tvHanger()

function nine(g: Grid, src: Sprite, r: Rect, b: number, skipHole: boolean) {
  const sw = src[0].length
  const sh = src.length
  const mid = sw - 2 * b
  for (let j = 0; j < r.h; j++)
    for (let i = 0; i < r.w; i++) {
      const sx = i < b ? i : i >= r.w - b ? sw - (r.w - i) : b + ((i - b) % mid)
      const sy = j < b ? j : j >= r.h - b ? sh - (r.h - j) : b + ((j - b) % mid)
      const ch = src[sy][sx]
      if (ch !== '.') g.set(r.x + i, r.y + j, ch)
      else if (skipHole) continue
    }
}

function floor(g: Grid, y0: number) {
  const PH = 9
  for (let y = y0; y < g.h; y++) {
    const row = Math.floor((y - y0) / PH)
    const ry = (y - y0) % PH
    for (let x = 0; x < g.w; x++) {
      const off = (row % 2) * 31
      const px = (x + off) % 62
      let ch = 'w'
      if (ry === 0) ch = 'k'
      else if (px === 0) ch = 'k'
      else if (ry === 1) ch = (x + y) % 2 === 0 ? 'W' : 'w'
      else if (ry === PH - 1) ch = (x + y) % 2 === 0 ? 'k' : 'w'
      else if ((px * 7 + row * 13 + ry * 3) % 29 === 0) ch = 'W'
      else if ((px + row * 5) % 17 === 0 && ry > 2 && ry < 6) ch = 'r'
      g.set(x, y, ch)
    }
  }
}

function shelf(g: Grid, r: Rect) {
  g.rect(r.x, r.y, r.w, r.h, 'k')
  g.rect(r.x + 1, r.y + 1, r.w - 2, 1, 'M')
  g.rect(r.x + 1, r.y + 2, r.w - 2, r.h - 4, 'm')
  g.rect(r.x + 1, r.y + r.h - 2, r.w - 2, 1, 'n')
  for (const bx of [r.x + 8, r.x + r.w - 12]) {
    g.rect(bx, r.y + r.h, 4, 7, 'k')
    g.rect(bx + 1, r.y + r.h, 2, 6, 'm')
  }
  const t = trophy()
  g.blit(r.x + 14, r.y - 16, t)
  g.blit(r.x + 40, r.y - 12 + 0, chipStack('green', 3).map((l) => l))
  g.blit(r.x + 58, r.y - 16 + 4, chipStack('coral', 5))
}

/** Textura da sala inteira (w x h). */
export function composeRoom(geo: SceneGeom): Sprite {
  const g = new Grid(geo.w, geo.h)
  // parede
  for (let y = 0; y < geo.h; y++) for (let x = 0; x < geo.w; x++) g.set(x, y, WALL[y & 31][x & 31])
  // chão e rodapé
  if (!geo.compact) {
    const fy = geo.floorY
    floor(g, fy)
    g.rect(0, fy - 5, geo.w, 1, 'k')
    g.rect(0, fy - 4, geo.w, 1, 'M')
    g.rect(0, fy - 3, geo.w, 2, 'm')
    g.rect(0, fy - 1, geo.w, 1, 'n')
  } else {
    floor(g, geo.h - 14)
  }
  if (geo.shelf) shelf(g, geo.shelf)
  // TVs
  for (const t of geo.tvs) {
    g.blit(t.frame.x + (t.frame.w >> 1) - 16, t.frame.y - 13, HANGER)
    nine(g, TVF, t.frame, 12, true)
    g.rect(t.hole.x, t.hole.y, t.hole.w, t.hole.h, 'k')
    // quina interna iluminada
    g.rect(t.hole.x, t.hole.y, t.hole.w, 1, 'w')
  }
  // sombra da mesa no chão (dithering)
  if (!geo.compact) {
    const tb = geo.table.y + geo.table.h
    for (let y = tb; y < tb + 9; y++)
      for (let x = geo.table.x + 4; x < geo.table.x + geo.table.w - 4; x++) {
        const t = 1 - (y - tb) / 9
        if (t > bayer(x, y) * 0.9) g.set(x, y, 'k')
      }
  }
  // mesa 9-slice (cantos 16, bordas e centro em mosaico)
  nine(g, TABLE, geo.table, 16, true)
  return g.toSprite()
}

/** Vinheta em dithering: pontos 'k' nas bordas (usar com alpha ~0.5). */
export function composeVignette(w: number, h: number): Sprite {
  const g = new Grid(w, h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (x - w / 2) / (w / 2)
      const dy = (y - h / 2) / (h / 2)
      const d = Math.sqrt(dx * dx * 0.7 + dy * dy)
      const t = (d - 0.62) / 0.55
      if (t > bayer(x, y)) g.set(x, y, 'k')
    }
  return g.toSprite()
}

export { TV_BORDER }
