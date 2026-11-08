import {
  describeDuelEnd,
  type DuelAction,
  type DuelEndReason,
  type DuelEvent,
  type DuelMinutes,
  type DuelResult,
  type DuelView,
  type Side
} from '../duel'

export interface CheckersOptions {
  minutes: DuelMinutes
}

export const DEFAULT_CHECKERS_OPTIONS: CheckersOptions = { minutes: 10 }

/** lances seguidos (somando os dois lados) só com damas e sem captura até empatar: 20 de cada lado */
export const QUIET_DRAW_PLIES = 40

export type CheckersAction =
  /** casas por onde a peça passa, ex.: ["c3", "e5", "g7"] */
  | { type: 'move'; path: string[] }
  | DuelAction

export type CheckersEndReason = DuelEndReason | 'sem-lances' | 'repeticao' | 'damas'

export type CheckersResult = DuelResult<CheckersEndReason>

export interface CheckersMoveRec {
  /** "c3-d4" ou "c3xe5xg7" */
  text: string
  path: string[]
  /** casas das peças capturadas */
  captured: string[]
  /** peças capturadas (letras), para mostrar ao lado do tabuleiro */
  pieces: string[]
  promote: boolean
}

export interface CheckersView extends DuelView<CheckersEndReason> {
  you: { playerId: string; color: Side } | null
  /** 64 casas, a1 = 0: w/b pedra, W/B dama, '.' vazio */
  board: string[]
  turn: Side
  /** lances legais da sua vez (cada um é o caminho em casas). Vazio quando não é sua vez. */
  legal: string[][]
  /** quem joga é obrigado a capturar */
  mustCapture: boolean
  lastMove: CheckersMoveRec | null
  moves: CheckersMoveRec[]
}

export type CheckersEvent =
  | { type: 'start'; white: string; black: string }
  | { type: 'move'; color: Side; text: string; path: string[]; captures: number; promote: boolean }
  | DuelEvent<CheckersEndReason>

export function describeResult(r: CheckersResult, white: string, black: string): string {
  const common = describeDuelEnd(r, white, black)
  if (common) return common
  const win = r.winner === 'w' ? white : black
  const loser = r.winner === 'w' ? black : white
  if (r.reason === 'sem-lances') return `${loser} ficou sem peças ou sem lance. ${win} venceu.`
  return '20 lances de cada lado só com damas, sem captura. Empate.'
}

export type { Side }
