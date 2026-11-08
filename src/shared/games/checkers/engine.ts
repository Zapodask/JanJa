/**
 * Motor das damas para a sala: duas pessoas, uma de cada vez, com relógio opcional.
 * Funções puras (tempo e sorteio só via GameCtx). Relógio, empate, desistência e quem sai da sala
 * ficam em ../duel.ts (iguais ao xadrez).
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
import { fromText, initialPosition, isKing, legalMoves, makeMove, notation, parseSquare, positionKey, squareName, type Position } from './rules'
import {
  DEFAULT_CHECKERS_OPTIONS,
  QUIET_DRAW_PLIES,
  type CheckersAction,
  type CheckersEndReason,
  type CheckersEvent,
  type CheckersMoveRec,
  type CheckersOptions,
  type CheckersView
} from './types'

export interface CheckersState extends Duel<CheckersEndReason> {
  options: CheckersOptions
  pos: Position
  seen: string[]
  moves: CheckersMoveRec[]
  /** lances seguidos só de damas, sem captura */
  quiet: number
}

type S = Step<CheckersState, CheckersEvent>

const err = (error: GameError['error'], message: string): GameError => ({ error, message })
const clone = <T>(x: T): T => structuredClone(x)

export const parseOptions = (raw: unknown): CheckersOptions | GameError => parseMinutes(raw, DEFAULT_CHECKERS_OPTIONS.minutes)

export function parseAction(raw: unknown): CheckersAction | GameError {
  if (typeof raw !== 'object' || raw === null) return err('acao-invalida', 'Lance inválido.')
  const a = raw as Record<string, unknown>
  if (a.type === 'resign' || a.type === 'draw' || a.type === 'decline') return { type: a.type }
  if (a.type !== 'move') return err('acao-invalida', 'Ação desconhecida.')
  const path = a.path
  if (!Array.isArray(path) || path.length < 2 || path.length > 16 || !path.every((s) => typeof s === 'string' && parseSquare(s) !== null)) {
    return err('acao-invalida', 'Lance inválido.')
  }
  return { type: 'move', path: path as string[] }
}

function expire(s: CheckersState, now: number, events: CheckersEvent[]): boolean {
  const due = overdue(s, s.pos.turn, now)
  if (!due) return false
  if (due.kind === 'tempo') {
    // nas damas quem ainda tem peça sempre pode vencer: estourou o tempo, perdeu
    spendClock(s, s.pos.turn, due.at)
    finish(s, { winner: otherSide(s.pos.turn), reason: 'tempo' }, events)
  } else {
    spendClock(s, s.pos.turn, now)
    finish(s, { winner: due.both ? null : otherSide(due.gone), reason: 'abandono' }, events)
  }
  return true
}

function checkEnd(s: CheckersState, events: CheckersEvent[]): void {
  if (legalMoves(s.pos).length === 0) return finish(s, { winner: otherSide(s.pos.turn), reason: 'sem-lances' }, events)
  const key = s.seen[s.seen.length - 1]
  if (s.seen.filter((k) => k === key).length >= 3) return finish(s, { winner: null, reason: 'repeticao' }, events)
  if (s.quiet >= QUIET_DRAW_PLIES) return finish(s, { winner: null, reason: 'damas' }, events)
}

export function setup(players: PlayerRef[], options: CheckersOptions, ctx: GameCtx, text?: string): S {
  const pos = text ? fromText(text) : initialPosition()
  const s: CheckersState = {
    ...newDuel<CheckersEndReason>(players, options.minutes, ctx),
    options,
    pos,
    seen: [positionKey(pos)],
    moves: [],
    quiet: 0
  }
  return { state: s, events: [{ type: 'start', white: s.players.w.playerId, black: s.players.b.playerId }] }
}

export function apply(state: CheckersState, playerId: string, action: CheckersAction, ctx: GameCtx): S | GameError {
  if (state.result) return err('partida-encerrada', 'A partida acabou.')
  const me = sideOf(state, playerId)
  if (!me) return err('nao-e-sua-vez', 'Você não está jogando.')
  const s = clone(state)
  const events: CheckersEvent[] = []
  if (expire(s, ctx.now, events)) return { state: s, events }
  if (action.type !== 'move') {
    const e = applyDuelAction(s, me, action, events)
    return e ?? { state: s, events }
  }
  if (s.pos.turn !== me) return err('nao-e-sua-vez', 'Espere a sua vez.')
  const want = action.path.map((x) => parseSquare(x)).join(',')
  const legal = legalMoves(s.pos)
  const move = legal.find((m) => m.path.join(',') === want)
  if (!move) {
    const capture = legal[0]?.captured.length ?? 0
    return err('acao-invalida', capture ? `Esse lance não vale: capture ${capture === 1 ? 'a peça' : `${capture} peças`}.` : 'Esse lance não vale.')
  }
  spendClock(s, me, ctx.now)
  const pieces = move.captured.map((c) => s.pos.board[c])
  s.pos = makeMove(s.pos, move)
  s.seen.push(positionKey(s.pos))
  s.quiet = isKing(move.piece) && !move.captured.length ? s.quiet + 1 : 0
  const rec: CheckersMoveRec = {
    text: notation(move),
    path: move.path.map(squareName),
    captured: move.captured.map(squareName),
    pieces,
    promote: move.promote
  }
  s.moves.push(rec)
  afterMove(s, me)
  events.push({ type: 'move', color: me, text: rec.text, path: rec.path, captures: move.captured.length, promote: move.promote })
  checkEnd(s, events)
  return { state: s, events }
}

export function tick(state: CheckersState, ctx: GameCtx): S {
  if (!overdue(state, state.pos.turn, ctx.now)) return { state, events: [] }
  const s = clone(state)
  const events: CheckersEvent[] = []
  expire(s, ctx.now, events)
  return { state: s, events }
}

export const nextDeadline = (s: CheckersState): number | null => duelDeadline(s, s.pos.turn)

export function setPresence(state: CheckersState, playerId: string, present: boolean, ctx: GameCtx): S {
  const s = clone(state)
  return markPresence(s, playerId, present, ctx.now) ? { state: s, events: [] } : { state, events: [] }
}

export function view(s: CheckersState, playerId: string | null, now: number): CheckersView {
  const color = playerId ? sideOf(s, playerId) : null
  const all = s.result ? [] : legalMoves(s.pos)
  const mine = color && color === s.pos.turn ? all : []
  const last = s.moves[s.moves.length - 1]
  return {
    ...duelView(s, s.pos.turn, s.options.minutes, now),
    you: color && playerId ? { playerId, color } : null,
    board: s.pos.board.slice(),
    turn: s.pos.turn,
    legal: mine.map((m) => m.path.map(squareName)),
    mustCapture: (all[0]?.captured.length ?? 0) > 0,
    lastMove: last ? structuredClone(last) : null,
    moves: s.moves.map((m) => structuredClone(m))
  }
}

export const isOver = (s: CheckersState): boolean => s.result !== null
