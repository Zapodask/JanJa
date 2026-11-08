import type { PlayerRef } from '../types'
import type { Ball } from './physics'

export type HoleSeconds = 60 | 90 | 120

export interface GolfOptions {
  mapId: string
  /** bolas batem umas nas outras */
  collisions: boolean
  holeSeconds: HoleSeconds
}

export const DEFAULT_GOLF_OPTIONS: GolfOptions = { mapId: 'quintal', collisions: true, holeSeconds: 90 }
export const HOLE_SECONDS: readonly HoleSeconds[] = [60, 90, 120]

/** pausa com o placar entre um buraco e outro */
export const BREAK_MS = 6000
/** tacadas a mais que o par antes de a bola ser recolhida */
export const CAP_OVER_PAR = 4

/** `stroke` = quantas tacadas você já tinha neste buraco (protege contra tacada repetida/atrasada) */
export interface GolfAction {
  type: 'shot'
  hole: number
  stroke: number
  /** radianos; 0 = +x, PI/2 = +z */
  angle: number
  /** 0..1 */
  power: number
}

export type GolfPhase = 'jogando' | 'intervalo' | 'fim'

export interface GolfPlayerView {
  playerId: string
  name: string
  /** índice do jogador (cor) */
  color: number
  away: boolean
  /** tacadas no buraco atual (água conta) */
  strokes: number
  /** terminou o buraco (acertou ou estourou o limite) */
  done: boolean
  /** resultado de cada buraco jogado */
  scores: number[]
  total: number
}

export interface GolfView {
  you: { playerId: string } | null
  mapId: string
  mapName: string
  holeCount: number
  /** índice do buraco atual (0..) */
  hole: number
  par: number
  cap: number
  collisions: boolean
  phase: GolfPhase
  /** fim do buraco (jogando) ou da pausa (intervalo), ms epoch */
  until: number | null
  /** relógio do servidor quando esta visão foi feita (o cliente acerta o dele) */
  serverNow: number
  /** retrato do mundo; o cliente simula a partir daqui */
  t0: number
  balls: Ball[]
  players: GolfPlayerView[]
  /** fim: do melhor para o pior */
  ranking: Array<{ playerId: string; total: number; place: number }> | null
}

export type GolfEvent =
  | { type: 'hole-start'; hole: number; name: string; par: number }
  | { type: 'shot'; playerId: string; t0: number; balls: Ball[] }
  | { type: 'holed'; playerId: string; strokes: number; par: number }
  | { type: 'hole-end'; hole: number; scores: Record<string, number> }
  | { type: 'game-over'; ranking: Array<{ playerId: string; total: number; place: number }> }

export type { PlayerRef }
