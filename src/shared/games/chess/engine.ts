/**
 * Motor do xadrez para a sala: duas pessoas, uma de cada vez, com relógio opcional.
 * Funções puras (tempo e sorteio só via GameCtx). Nada é escondido: todos veem o tabuleiro.
 * Relógio, empate, desistência e quem sai da sala ficam em ../duel.ts (iguais às damas).
 */
import {
  afterMove,
  applyDuelAction,
  duelDeadline,
  duelView,
  finish,
  markPresence,
  newDuel,
  otherSide,
  overdue,
  parseMinutes,
  sideOf,
  spendClock,
  type Duel
} from '../duel'
import type { GameCtx, GameError, PlayerRef, Step } from '../types'
import {
  fromFen,
  inCheck,
  insufficientMaterial,
  kingSquare,
  legalMoves,
  loneKing,
  makeMove,
  parseSquare,
  positionKey,
  PROMOS,
  san,
  squareName,
  START_FEN,
  type Position,
  type Promo
} from './rules'
import {
  DEFAULT_CHESS_OPTIONS,
  type ChessAction,
  type ChessEndReason,
  type ChessEvent,
  type ChessMoveRec,
  type ChessOptions,
  type ChessView
} from './types'

export interface ChessState extends Duel<ChessEndReason> {
  options: ChessOptions
  pos: Position
  /** chave de cada posição já vista (repetição tripla) */
  seen: string[]
  moves: ChessMoveRec[]
}

type S = Step<ChessState, ChessEvent>

const err = (error: GameError['error'], message: string): GameError => ({ error, message })
const clone = <T>(x: T): T => structuredClone(x)

// ---------- opções e ações ----------
export const parseOptions = (raw: unknown): ChessOptions | GameError => parseMinutes(raw, DEFAULT_CHESS_OPTIONS.minutes)

export function parseAction(raw: unknown): ChessAction | GameError {
  if (typeof raw !== 'object' || raw === null) return err('acao-invalida', 'Lance inválido.')
  const a = raw as Record<string, unknown>
  if (a.type === 'resign' || a.type === 'draw' || a.type === 'decline') return { type: a.type }
  if (a.type !== 'move') return err('acao-invalida', 'Ação desconhecida.')
  if (typeof a.from !== 'string' || typeof a.to !== 'string' || parseSquare(a.from) === null || parseSquare(a.to) === null) {
    return err('acao-invalida', 'Lance inválido.')
  }
  if (a.promo !== undefined && !(PROMOS as readonly unknown[]).includes(a.promo)) return err('acao-invalida', 'Promoção inválida.')
  return { type: 'move', from: a.from, to: a.to, ...(a.promo ? { promo: a.promo as Promo } : {}) }
}

// ---------- fim ----------
/** Prazo vencido: tempo esgotado (perde, a menos que o outro só tenha o rei) ou quem saiu e não voltou. */
function expire(s: ChessState, now: number, events: ChessEvent[]): boolean {
  const due = overdue(s, s.pos.turn, now)
  if (!due) return false
  if (due.kind === 'tempo') {
    spendClock(s, s.pos.turn, due.at)
    const winner = otherSide(s.pos.turn)
    finish(s, { winner: loneKing(s.pos.board, winner) ? null : winner, reason: 'tempo' }, events)
  } else {
    spendClock(s, s.pos.turn, now)
    finish(s, { winner: due.both ? null : otherSide(due.gone), reason: 'abandono' }, events)
  }
  return true
}

/** Fim automático depois de um lance. */
function checkEnd(s: ChessState, events: ChessEvent[]): void {
  const p = s.pos
  if (legalMoves(p).length === 0) {
    return finish(s, inCheck(p) ? { winner: otherSide(p.turn), reason: 'mate' } : { winner: null, reason: 'afogado' }, events)
  }
  if (insufficientMaterial(p.board)) return finish(s, { winner: null, reason: 'material' }, events)
  const key = s.seen[s.seen.length - 1]
  if (s.seen.filter((k) => k === key).length >= 3) return finish(s, { winner: null, reason: 'repeticao' }, events)
  if (p.halfmove >= 100) return finish(s, { winner: null, reason: 'cinquenta' }, events)
}

// ---------- contrato ----------
export function setup(players: PlayerRef[], options: ChessOptions, ctx: GameCtx, fen: string = START_FEN): S {
  const pos = fromFen(fen)
  const s: ChessState = { ...newDuel<ChessEndReason>(players, options.minutes, ctx), options, pos, seen: [positionKey(pos)], moves: [] }
  return { state: s, events: [{ type: 'start', white: s.players.w.playerId, black: s.players.b.playerId }] }
}

export function apply(state: ChessState, playerId: string, action: ChessAction, ctx: GameCtx): S | GameError {
  if (state.result) return err('partida-encerrada', 'A partida acabou.')
  const me = sideOf(state, playerId)
  if (!me) return err('nao-e-sua-vez', 'Você não está jogando.')
  const s = clone(state)
  const events: ChessEvent[] = []
  // a ação chegou depois do prazo (antes do alarme): vale o prazo
  if (expire(s, ctx.now, events)) return { state: s, events }
  if (action.type !== 'move') {
    const e = applyDuelAction(s, me, action, events)
    return e ?? { state: s, events }
  }
  if (s.pos.turn !== me) return err('nao-e-sua-vez', 'Espere a sua vez.')
  const from = parseSquare(action.from)
  const to = parseSquare(action.to)
  const legal = legalMoves(s.pos)
  const promo = action.promo ?? 'q'
  const move = legal.find((m) => m.from === from && m.to === to && (!m.promo || m.promo === promo))
  if (!move) return err('acao-invalida', 'Esse lance não vale.')
  const notation = san(s.pos, move, legal)
  spendClock(s, me, ctx.now)
  s.pos = makeMove(s.pos, move)
  s.seen.push(positionKey(s.pos))
  s.moves.push({ san: notation, from: action.from, to: action.to, ...(move.captured ? { captured: move.captured } : {}) })
  afterMove(s, me)
  events.push({
    type: 'move',
    color: me,
    san: notation,
    from: action.from,
    to: action.to,
    capture: !!move.captured,
    check: inCheck(s.pos),
    castle: move.flag === 'castle'
  })
  checkEnd(s, events)
  return { state: s, events }
}

export function tick(state: ChessState, ctx: GameCtx): S {
  if (!overdue(state, state.pos.turn, ctx.now)) return { state, events: [] }
  const s = clone(state)
  const events: ChessEvent[] = []
  expire(s, ctx.now, events)
  return { state: s, events }
}

export const nextDeadline = (s: ChessState): number | null => duelDeadline(s, s.pos.turn)

export function setPresence(state: ChessState, playerId: string, present: boolean, ctx: GameCtx): S {
  const s = clone(state)
  return markPresence(s, playerId, present, ctx.now) ? { state: s, events: [] } : { state, events: [] }
}

export function view(s: ChessState, playerId: string | null, now: number): ChessView {
  const color = playerId ? sideOf(s, playerId) : null
  const legal: Record<string, string[]> = {}
  if (color && color === s.pos.turn && !s.result) {
    for (const m of legalMoves(s.pos)) {
      const list = (legal[squareName(m.from)] ??= [])
      const to = squareName(m.to)
      if (!list.includes(to)) list.push(to)
    }
  }
  const last = s.moves[s.moves.length - 1]
  const checked = !s.result || s.result.reason === 'mate' ? inCheck(s.pos) : false
  return {
    ...duelView(s, s.pos.turn, s.options.minutes, now),
    you: color && playerId ? { playerId, color } : null,
    board: s.pos.board.slice(),
    turn: s.pos.turn,
    legal,
    lastMove: last ? { from: last.from, to: last.to } : null,
    check: checked ? squareName(kingSquare(s.pos.board, s.pos.turn)) : null,
    moves: s.moves.map((m) => ({ ...m }))
  }
}

export const isOver = (s: ChessState): boolean => s.result !== null
