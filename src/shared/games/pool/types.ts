import type { PBall } from './physics'
import type { Group } from './rules'

export type PoolOptions = Record<string, never>

/** prazo de cada tacada; quem saiu da sala tem a vez jogada rápido */
export const SHOT_MS = 45_000
export const AWAY_MS = 3_000

export interface PoolAction {
  type: 'shoot'
  /** direção da tacada (não precisa ser unitária) */
  dx: number
  dy: number
  /** 0 a 1 */
  power: number
  /** bola na mão: onde a branca fica antes da tacada */
  cue?: { x: number; y: number }
  /** na bola 8: a caçapa escolhida (0..5) */
  pocket?: number
  /** quantas tacadas a pessoa viu (protege de clique repetido) */
  ref: number
}

export interface PoolPlayerView {
  playerId: string
  name: string
  group: Group | null
  /** bolas do grupo que ainda estão na mesa */
  left: number
  away: boolean
}

export interface PoolShotView {
  ref: number
  by: number
  before: PBall[]
  dx: number
  dy: number
  power: number
  after: PBall[]
}

export interface PoolView {
  you: { playerId: string; index: number } | null
  players: PoolPlayerView[]
  /** bolas paradas agora (depois da última tacada) */
  balls: PBall[]
  turn: number | null
  /** bola na mão: quem joga põe a branca onde quiser */
  ballInHand: boolean
  /** quebra: a branca só atrás da linha de saída */
  behindLine: boolean
  /** quem joga já limpou o grupo: mira na 8 e escolhe a caçapa */
  onEight: boolean
  /** última tacada (a cena anima a partir de `before`) */
  shot: PoolShotView | null
  /** o que aconteceu na última tacada, em texto */
  result: string | null
  foul: string | null
  ref: number
  until: number | null
  serverNow: number
  winner: number | null
  log: string[]
}

export type PoolEvent =
  | { type: 'start'; first: number }
  | { type: 'shot'; by: number; power: number }
  | { type: 'pocket'; ids: number[] }
  | { type: 'foul'; by: number; why: string }
  | { type: 'groups'; by: number; group: Group }
  | { type: 'end'; winner: number; why: string }
