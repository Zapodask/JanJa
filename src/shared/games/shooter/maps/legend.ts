import type { MapDef, TileInfo } from '../types'

const t = (art: string, solid: boolean, blocksShot: boolean, floor?: string, slow = false): TileInfo =>
  floor ? { art, solid, blocksShot, slow, floor } : { art, solid, blocksShot, slow }

/**
 * Legenda dos mapas. Móveis têm `floor` (piso que aparece embaixo).
 * Casa: '.' madeira, ',' cerâmica, '_' tapete, '#' parede, S sofá, T TV/estante, B balcão, M mesa de centro,
 * C cama, G guarda-roupa, F geladeira, O fogão, V vaso. Quintal: '"' grama, ':' terra, '~' água,
 * m mureta, v varal, Q churrasqueira, A árvore, E cerca.
 */
export const LEGEND: Record<string, TileInfo> = {
  '.': t('piso-madeira', false, false),
  ',': t('piso-ceramica', false, false),
  _: t('tapete', false, false),
  '"': t('grama', false, false),
  ':': t('terra', false, false),
  '#': t('parede', true, true),
  '~': t('agua', false, false, undefined, true),
  S: t('sofa', true, true, 'tapete'),
  T: t('tv', true, true, 'piso-madeira'),
  B: t('balcao', true, true, 'piso-ceramica'),
  M: t('mesa-centro', true, false, 'piso-madeira'),
  C: t('cama', true, false, 'piso-madeira'),
  G: t('guarda-roupa', true, true, 'piso-madeira'),
  F: t('geladeira', true, true, 'piso-ceramica'),
  O: t('fogao', true, true, 'piso-ceramica'),
  V: t('vaso', true, false, 'piso-madeira'),
  m: t('mureta', true, false, 'grama'),
  v: t('varal', false, false, 'grama'),
  Q: t('churrasqueira', true, true, 'grama'),
  A: t('arvore', true, true, 'grama'),
  E: t('cerca', true, false, 'grama')
}

export const WALL_TILE: TileInfo = LEGEND['#']

/** Tile em (tx, ty); fora do mapa (ou caractere desconhecido) conta como parede. */
export function tileAt(map: MapDef, tx: number, ty: number): TileInfo {
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return WALL_TILE
  return LEGEND[map.rows[ty][tx]] ?? WALL_TILE
}

/** Versão achatada do mapa para os laços quentes da simulação (1 = sim). */
export interface MapGrid {
  w: number
  h: number
  solid: Uint8Array
  shot: Uint8Array
  slow: Uint8Array
}

// cache de dados derivados do mapa (imutável); não faz parte do estado da simulação
const grids = new WeakMap<MapDef, MapGrid>()

export function gridOf(map: MapDef): MapGrid {
  let g = grids.get(map)
  if (g) return g
  const n = map.w * map.h
  g = { w: map.w, h: map.h, solid: new Uint8Array(n), shot: new Uint8Array(n), slow: new Uint8Array(n) }
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      const info = tileAt(map, x, y)
      const i = y * map.w + x
      g.solid[i] = info.solid ? 1 : 0
      g.shot[i] = info.blocksShot ? 1 : 0
      g.slow[i] = info.slow ? 1 : 0
    }
  }
  grids.set(map, g)
  return g
}
