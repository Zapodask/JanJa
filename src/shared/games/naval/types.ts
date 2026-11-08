import type { Cell, Placement } from './fleet'

/** clássico: um tiro por vez e quem acerta joga de novo; salva: um tiro por navio de pé, numa rajada só */
export type NavalMode = 'classico' | 'salva'
export const NAVAL_MODES: readonly NavalMode[] = ['classico', 'salva']

export interface NavalOptions {
  mode: NavalMode
}

export const DEFAULT_NAVAL_OPTIONS: NavalOptions = { mode: 'classico' }

/** prazo para posicionar a frota (estourou: posiciona sozinha) e para cada vez de atirar */
export const PLACE_MS = 120_000
export const SHOT_MS = 30_000
export const AWAY_MS = 3_000

export type NavalAction =
  /** frota completa; manda de novo para mudar enquanto o outro não terminou */
  | { type: 'place'; ships: Placement[] }
  /** `ref` = número de tiros da partida que a pessoa viu (protege de clique repetido) */
  | { type: 'shoot'; cells: Cell[]; ref: number }

export interface Shot extends Cell {
  hit: boolean
}

export interface NavalSea {
  /** tiros que este mar recebeu */
  shots: Shot[]
  /** navios afundados (aparecem para todos) */
  sunk: Placement[]
  /** navios ainda de pé */
  afloat: number
}

export interface NavalPlayerView {
  playerId: string
  name: string
  ready: boolean
  away: boolean
}

export interface NavalView {
  you: { playerId: string; index: number } | null
  players: NavalPlayerView[]
  mode: NavalMode
  phase: 'posicionar' | 'batalha' | 'fim'
  /** a sua frota (só a sua; no fim, as duas) */
  myFleet: Placement[] | null
  /** mar de cada jogador, pelo índice */
  seas: NavalSea[]
  /** no fim, todas as frotas */
  fleets: Array<Placement[] | null> | null
  turn: number | null
  /** quantos tiros quem está na vez dá agora */
  shots: number
  ref: number
  /** últimos tiros (para destacar) */
  last: { by: number; cells: Shot[] } | null
  until: number | null
  serverNow: number
  winner: number | null
  log: string[]
}

export type NavalEvent =
  | { type: 'placed'; p: number }
  | { type: 'battle'; first: number }
  | { type: 'shot'; p: number; cells: Shot[]; sunk: string[] }
  | { type: 'end'; winner: number }
