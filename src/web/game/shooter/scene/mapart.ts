/**
 * Monta o mapa inteiro como uma imagem só (camada do chão) a partir da LEGEND e da arte dos tiles.
 * Parte pura (contexto de cada tile) separada da parte de canvas, para os testes.
 */
import type { MapDef } from '../../../../shared/games/shooter/types'
import { LEGEND } from '../../../../shared/games/shooter/maps/legend'
import { SPAL } from './palette'
import type { LightSpot } from './light'
import { TILE_LIGHT, TILE_PX, tileRows, type TileCtx } from './tiles'

export interface TileRef {
  art: string
  floor?: string
  solid: boolean
}

export function tileRef(map: MapDef, tx: number, ty: number): TileRef | null {
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return null
  const ch = map.rows[ty]?.[tx]
  const info = ch === undefined ? undefined : LEGEND[ch]
  if (!info) return { art: '?', solid: true }
  return { art: info.art, floor: info.floor, solid: info.solid }
}

export function tileContext(map: MapDef, tx: number, ty: number): { ref: TileRef; ctx: TileCtx } {
  const ref = tileRef(map, tx, ty)!
  const same = (x: number, y: number) => tileRef(map, x, y)?.art === ref.art
  let l = 0
  let r = 0
  let u = 0
  let d = 0
  while (same(tx - l - 1, ty)) l++
  while (same(tx + r + 1, ty)) r++
  while (same(tx, ty - u - 1)) u++
  while (same(tx, ty + d + 1)) d++
  const above = tileRef(map, tx, ty - 1)
  const ctx: TileCtx = {
    tx,
    ty,
    bx: l,
    by: u,
    bw: l + r + 1,
    bh: u + d + 1,
    nl: l > 0,
    nr: r > 0,
    nu: u > 0,
    nd: d > 0,
    wallAbove: above?.art === 'parede',
    variant: (tx * 7 + ty * 13 + ((tx * ty) % 5)) & 3
  }
  return { ref, ctx }
}

/** luzes dos móveis (uma por bloco, no centro dele) */
export function mapLights(map: MapDef): LightSpot[] {
  const out: LightSpot[] = []
  for (let ty = 0; ty < map.h; ty++)
    for (let tx = 0; tx < map.w; tx++) {
      const { ref, ctx } = tileContext(map, tx, ty)
      const li = TILE_LIGHT[ref.art]
      if (!li) continue
      if (ctx.bx !== Math.floor(ctx.bw / 2) || ctx.by !== Math.floor(ctx.bh / 2)) continue
      out.push({ x: tx * TILE_PX + (ctx.bw % 2 ? 8 : 0), y: ty * TILE_PX + (ctx.bh % 2 ? 8 : 0), r: li.r, power: li.power, tint: li.tint })
    }
  return out
}

export interface MapArt {
  canvas: HTMLCanvasElement
  width: number
  height: number
  lights: LightSpot[]
}

/** Desenha o chão do mapa todo num canvas (precisa de DOM). */
export function buildMapCanvas(map: MapDef): MapArt {
  const width = map.w * TILE_PX
  const height = map.h * TILE_PX
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(width, height)
  const rgb = new Map<string, [number, number, number]>()
  for (const [k, v] of Object.entries(SPAL)) rgb.set(k, [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)])
  for (let ty = 0; ty < map.h; ty++)
    for (let tx = 0; tx < map.w; tx++) {
      const { ref, ctx: c } = tileContext(map, tx, ty)
      const rows = tileRows(ref.art, c, ref.floor)
      for (let y = 0; y < TILE_PX; y++)
        for (let x = 0; x < TILE_PX; x++) {
          const col = rgb.get(rows[y]![x]!)
          if (!col) continue
          const o = ((ty * TILE_PX + y) * width + tx * TILE_PX + x) * 4
          img.data[o] = col[0]
          img.data[o + 1] = col[1]
          img.data[o + 2] = col[2]
          img.data[o + 3] = 255
        }
    }
  ctx.putImageData(img, 0, 0)
  return { canvas, width, height, lights: mapLights(map) }
}
