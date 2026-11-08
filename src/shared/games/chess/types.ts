import type { Color, Promo } from './rules'

/** minutos de relógio para cada um (0 = sem relógio) */
export type ChessMinutes = 0 | 5 | 10 | 15
export const CHESS_MINUTES: readonly ChessMinutes[] = [0, 5, 10, 15]

export interface ChessOptions {
  minutes: ChessMinutes
}

export const DEFAULT_CHESS_OPTIONS: ChessOptions = { minutes: 10 }

/** quem sai da sala e não volta neste tempo perde a partida */
export const ABANDON_MS = 120_000

export type ChessAction =
  /** casas em notação "e2"; `promo` só quando o peão chega no fim (padrão: dama) */
  | { type: 'move'; from: string; to: string; promo?: Promo }
  | { type: 'resign' }
  /** oferece empate, ou aceita se o outro já ofereceu */
  | { type: 'draw' }
  | { type: 'decline' }

export type ChessEndReason =
  | 'mate'
  | 'afogado'
  | 'tempo'
  | 'desistiu'
  | 'acordo'
  | 'repeticao'
  | 'cinquenta'
  | 'material'
  | 'abandono'

export interface ChessResult {
  /** null = empate */
  winner: Color | null
  reason: ChessEndReason
}

export interface ChessMoveRec {
  san: string
  from: string
  to: string
  /** peça capturada (letra FEN) */
  captured?: string
}

export interface ChessPlayerView {
  playerId: string
  name: string
  /** saiu da sala: perde em `awayUntil` se não voltar */
  away: boolean
  awayUntil: number | null
}

export interface ChessView {
  you: { playerId: string; color: Color } | null
  white: ChessPlayerView
  black: ChessPlayerView
  /** 64 casas, a1 = 0 (letras FEN, '.' = vazio) */
  board: string[]
  turn: Color
  /** lances legais da sua vez: casa de origem -> destinos. Vazio quando não é sua vez. */
  legal: Record<string, string[]>
  lastMove: { from: string; to: string } | null
  /** casa do rei em xeque (de quem joga agora), ou null */
  check: string | null
  moves: ChessMoveRec[]
  minutes: ChessMinutes
  /** tempo que sobra para cada um quando esta visão foi feita (null = sem relógio) */
  clock: { w: number; b: number } | null
  /** relógio do servidor quando esta visão foi feita (o cliente acerta o dele) */
  serverNow: number
  drawOffer: Color | null
  result: ChessResult | null
}

export type ChessEvent =
  | { type: 'start'; white: string; black: string }
  | { type: 'move'; color: Color; san: string; from: string; to: string; capture: boolean; check: boolean; castle: boolean }
  | { type: 'draw-offer'; color: Color }
  | { type: 'draw-declined'; color: Color }
  | { type: 'end'; result: ChessResult }

/** frase curta para o fim da partida */
export function describeResult(r: ChessResult, white: string, black: string): string {
  const win = r.winner === 'w' ? white : r.winner === 'b' ? black : null
  switch (r.reason) {
    case 'mate':
      return `Xeque-mate. ${win} venceu.`
    case 'tempo':
      return win ? `O tempo acabou. ${win} venceu.` : 'O tempo acabou, mas não dá mais para dar mate. Empate.'
    case 'desistiu':
      return `${r.winner === 'w' ? black : white} desistiu. ${win} venceu.`
    case 'abandono':
      return `${r.winner === 'w' ? black : white} saiu da sala. ${win} venceu.`
    case 'afogado':
      return 'Rei afogado: quem joga não tem lance e não está em xeque. Empate.'
    case 'acordo':
      return 'Empate combinado.'
    case 'repeticao':
      return 'A mesma posição se repetiu três vezes. Empate.'
    case 'cinquenta':
      return '50 lances sem captura nem lance de peão. Empate.'
    case 'material':
      return 'Não sobrou peça para dar mate. Empate.'
  }
}

export type { Color, Promo }
