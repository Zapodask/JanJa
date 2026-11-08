import {
  describeDuelEnd,
  type DuelAction,
  type DuelEndReason,
  type DuelEvent,
  type DuelMinutes,
  type DuelPlayerView,
  type DuelResult,
  type DuelView
} from '../duel'
import type { Color, Promo } from './rules'

export type ChessMinutes = DuelMinutes
export { ABANDON_MS, DUEL_MINUTES as CHESS_MINUTES } from '../duel'

export interface ChessOptions {
  minutes: ChessMinutes
}

export const DEFAULT_CHESS_OPTIONS: ChessOptions = { minutes: 10 }

export type ChessAction =
  /** casas em notação "e2"; `promo` só quando o peão chega no fim (padrão: dama) */
  | { type: 'move'; from: string; to: string; promo?: Promo }
  | DuelAction

export type ChessEndReason = DuelEndReason | 'mate' | 'afogado' | 'repeticao' | 'cinquenta' | 'material'

export type ChessResult = DuelResult<ChessEndReason>

export interface ChessMoveRec {
  san: string
  from: string
  to: string
  /** peça capturada (letra FEN) */
  captured?: string
}

export type ChessPlayerView = DuelPlayerView

export interface ChessView extends DuelView<ChessEndReason> {
  you: { playerId: string; color: Color } | null
  /** 64 casas, a1 = 0 (letras FEN, '.' = vazio) */
  board: string[]
  turn: Color
  /** lances legais da sua vez: casa de origem -> destinos. Vazio quando não é sua vez. */
  legal: Record<string, string[]>
  lastMove: { from: string; to: string } | null
  /** casa do rei em xeque (de quem joga agora), ou null */
  check: string | null
  moves: ChessMoveRec[]
}

export type ChessEvent =
  | { type: 'start'; white: string; black: string }
  | { type: 'move'; color: Color; san: string; from: string; to: string; capture: boolean; check: boolean; castle: boolean }
  | DuelEvent<ChessEndReason>

/** frase curta para o fim da partida */
export function describeResult(r: ChessResult, white: string, black: string): string {
  const common = describeDuelEnd(r, white, black)
  if (common) return common
  const win = r.winner === 'w' ? white : black
  switch (r.reason) {
    case 'mate':
      return `Xeque-mate. ${win} venceu.`
    case 'afogado':
      return 'Rei afogado: quem joga não tem lance e não está em xeque. Empate.'
    case 'cinquenta':
      return '50 lances sem captura nem lance de peão. Empate.'
    default:
      return 'Não sobrou peça para dar mate. Empate.'
  }
}

export type { Color, Promo }
