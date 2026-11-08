/**
 * Tabuleiro do Magnata: 32 casas numa volta, 8 por lado (a casa 0 é a Partida, no canto de baixo à direita).
 * Cantos: 0 Partida, 8 Engarrafamento, 16 Festival, 24 Aeroporto.
 * Cada lado tem um grupo de 2 cidades, um de 3, uma praia e uma casa especial.
 * Tudo aqui é dado fixo e conta pura (sem estado da partida).
 */

export type TileKind = 'start' | 'jam' | 'festival' | 'airport' | 'city' | 'beach' | 'surprise' | 'tax'

export interface Tile {
  kind: TileKind
  name: string
  /** cidade: índice do grupo (0..7) */
  group?: number
  /** cidade e praia */
  price?: number
}

export interface Group {
  name: string
  color: string
  /** custo de cada nível de construção (o hotel custa o dobro) */
  build: number
}

export const BOARD_SIZE = 32
export const SIDE = 8
export const CORNER = { start: 0, jam: 8, festival: 16, airport: 24 } as const

export const GROUPS: Group[] = [
  { name: 'Histórico', color: '#9C6B4E', build: 40 },
  { name: 'Serra', color: '#6FA3C7', build: 60 },
  { name: 'Agreste', color: '#D98E4A', build: 80 },
  { name: 'Litoral', color: '#E07A9A', build: 100 },
  { name: 'Norte', color: '#6FD49B', build: 120 },
  { name: 'Planalto', color: '#E8C547', build: 140 },
  { name: 'Sul', color: '#9A86D9', build: 160 },
  { name: 'Capitais', color: '#E05A4A', build: 200 }
]

const city = (name: string, group: number, price: number): Tile => ({ kind: 'city', name, group, price })
const beach = (name: string): Tile => ({ kind: 'beach', name, price: 200 })
const surprise: Tile = { kind: 'surprise', name: 'Surpresa' }

export const TILES: Tile[] = [
  { kind: 'start', name: 'Partida' },
  city('Penedo', 0, 60),
  city('Tiradentes', 0, 80),
  surprise,
  beach('Jericoacoara'),
  city('Canela', 1, 100),
  city('Gramado', 1, 110),
  city('Petrópolis', 1, 120),
  { kind: 'jam', name: 'Engarrafamento' },
  city('Caruaru', 2, 140),
  city('Campina Grande', 2, 160),
  beach('Porto de Galinhas'),
  { kind: 'tax', name: 'Imposto' },
  city('Paraty', 3, 180),
  city('Ubatuba', 3, 190),
  city('Ilhabela', 3, 200),
  { kind: 'festival', name: 'Festival' },
  city('Belém', 4, 220),
  city('Manaus', 4, 240),
  surprise,
  beach('Búzios'),
  city('Goiânia', 5, 260),
  city('Cuiabá', 5, 270),
  city('Brasília', 5, 280),
  { kind: 'airport', name: 'Aeroporto' },
  city('Curitiba', 6, 300),
  city('Florianópolis', 6, 320),
  beach('Noronha'),
  surprise,
  city('Salvador', 7, 350),
  city('Rio de Janeiro', 7, 380),
  city('São Paulo', 7, 400)
]

export const MAX_LEVEL = 4
/** aluguel por nível (0 = só o terreno, 1 a 3 casas, 4 = hotel), em fração do preço */
const RENT_MULT = [0.1, 0.5, 1.2, 2.2, 3.5]
/** aluguel das praias pelo número de praias do dono */
export const BEACH_RENT = [0, 50, 100, 200, 400]

const round10 = (x: number): number => Math.max(10, Math.round(x / 10) * 10)

export const tilesOfGroup = (g: number): number[] => TILES.flatMap((t, i) => (t.kind === 'city' && t.group === g ? [i] : []))
export const BEACHES: number[] = TILES.flatMap((t, i) => (t.kind === 'beach' ? [i] : []))
/** cidades de cada lado (0..3) */
export const citiesOfSide = (side: number): number[] =>
  Array.from({ length: SIDE - 1 }, (_, k) => side * SIDE + 1 + k).filter((i) => TILES[i].kind === 'city')

/** custo para subir do nível `from` até `to` (o hotel custa dois níveis) */
export function buildCost(tile: number, from: number, to: number): number {
  const g = GROUPS[TILES[tile].group as number]
  let c = 0
  for (let l = from + 1; l <= to; l++) c += l === MAX_LEVEL ? g.build * 2 : g.build
  return c
}

/** quanto foi investido na casa (terreno + construções) */
export const invested = (tile: number, level: number): number =>
  (TILES[tile].price ?? 0) + (TILES[tile].kind === 'city' ? buildCost(tile, 0, level) : 0)

/** aluguel da cidade no nível, sem bônus */
export const baseRent = (tile: number, level: number): number => round10((TILES[tile].price as number) * RENT_MULT[level])

export const sideOf = (tile: number): number => Math.floor(tile / SIDE)
