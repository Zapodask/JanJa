/**
 * Motor do xadrez para a sala: duas pessoas, uma de cada vez, com relógio opcional.
 * Funções puras (tempo e sorteio só via GameCtx). Nada é escondido: todos veem o tabuleiro.
 */
import type { GameCtx, GameError, PlayerRef, Step } from '../types'
import {
  fromFen,
  inCheck,
  insufficientMaterial,
  kingSquare,
  legalMoves,
  loneKing,
  makeMove,
  other,
  parseSquare,
  positionKey,
  PROMOS,
  san,
  squareName,
  START_FEN,
  type Color,
  type Position,
  type Promo
} from './rules'
import {
  ABANDON_MS,
  CHESS_MINUTES,
  DEFAULT_CHESS_OPTIONS,
  type ChessAction,
  type ChessEvent,
  type ChessMinutes,
  type ChessMoveRec,
  type ChessOptions,
  type ChessResult,
  type ChessView
} from './types'

export interface ChessState {
  options: ChessOptions
  players: { w: PlayerRef; b: PlayerRef }
  pos: Position
  /** chave de cada posição já vista (repetição tripla) */
  seen: string[]
  moves: ChessMoveRec[]
  /** tempo que sobrava para cada um no começo da vez atual (null = sem relógio) */
  clock: { w: number; b: number } | null
  /** quando a vez atual começou (ms epoch) */
  turnStart: number
  drawOffer: Color | null
  /** playerId -> desde quando está fora da sala */
  away: Record<string, number>
  result: ChessResult | null
}

type S = Step<ChessState, ChessEvent>

const err = (error: GameError['error'], message: string): GameError => ({ error, message })
const clone = <T>(x: T): T => structuredClone(x)

const colorOfPlayer = (s: ChessState, playerId: string): Color | null =>
  s.players.w.playerId === playerId ? 'w' : s.players.b.playerId === playerId ? 'b' : null

/** quando acaba o tempo de quem joga agora (null = sem relógio) */
const flagAt = (s: ChessState): number | null => (s.clock ? s.turnStart + s.clock[s.pos.turn] : null)

// ---------- opções e ações ----------
export function parseOptions(raw: unknown): ChessOptions | GameError {
  if (raw === undefined || raw === null) return { ...DEFAULT_CHESS_OPTIONS }
  if (typeof raw !== 'object' || Array.isArray(raw)) return err('acao-invalida', 'Opções inválidas.')
  const minutes = (raw as Record<string, unknown>).minutes ?? DEFAULT_CHESS_OPTIONS.minutes
  if (!(CHESS_MINUTES as readonly unknown[]).includes(minutes)) return err('acao-invalida', 'Tempo de relógio inválido.')
  return { minutes: minutes as ChessMinutes }
}

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

// ---------- relógio e fim ----------
/** Desconta o tempo gasto na vez atual e começa a próxima em `now`. */
function spendClock(s: ChessState, now: number): void {
  if (s.clock) s.clock[s.pos.turn] = Math.max(0, s.clock[s.pos.turn] - (now - s.turnStart))
  s.turnStart = now
}

function finish(s: ChessState, result: ChessResult, events: ChessEvent[]): void {
  s.result = result
  s.drawOffer = null
  events.push({ type: 'end', result })
}

/** Tempo esgotado de quem joga agora: perde, a menos que o outro só tenha o rei. */
function flag(s: ChessState, now: number, events: ChessEvent[]): void {
  spendClock(s, now)
  const loser = s.pos.turn
  finish(s, { winner: loneKing(s.pos.board, other(loser)) ? null : other(loser), reason: 'tempo' }, events)
}

/** Fim automático depois de um lance. */
function checkEnd(s: ChessState, events: ChessEvent[]): void {
  const p = s.pos
  if (legalMoves(p).length === 0) {
    return finish(s, inCheck(p) ? { winner: other(p.turn), reason: 'mate' } : { winner: null, reason: 'afogado' }, events)
  }
  if (insufficientMaterial(p.board)) return finish(s, { winner: null, reason: 'material' }, events)
  const key = s.seen[s.seen.length - 1]
  if (s.seen.filter((k) => k === key).length >= 3) return finish(s, { winner: null, reason: 'repeticao' }, events)
  if (p.halfmove >= 100) return finish(s, { winner: null, reason: 'cinquenta' }, events)
}

// ---------- contrato ----------
export function setup(players: PlayerRef[], options: ChessOptions, ctx: GameCtx, fen: string = START_FEN): S {
  const [a, b] = players.map((p) => ({ playerId: p.playerId, name: p.name }))
  // quem fica com as brancas é sorteado
  const [w, bl] = ctx.rng.int(2) === 0 ? [a, b] : [b, a]
  const pos = fromFen(fen)
  const ms = options.minutes * 60_000
  const s: ChessState = {
    options,
    players: { w, b: bl },
    pos,
    seen: [positionKey(pos)],
    moves: [],
    clock: ms > 0 ? { w: ms, b: ms } : null,
    turnStart: ctx.now,
    drawOffer: null,
    away: {},
    result: null
  }
  return { state: s, events: [{ type: 'start', white: w.playerId, black: bl.playerId }] }
}

export function apply(state: ChessState, playerId: string, action: ChessAction, ctx: GameCtx): S | GameError {
  if (state.result) return err('partida-encerrada', 'A partida acabou.')
  const me = colorOfPlayer(state, playerId)
  if (!me) return err('nao-e-sua-vez', 'Você não está jogando.')
  const s = clone(state)
  const events: ChessEvent[] = []
  // o lance chegou depois do tempo acabar (antes do alarme): vale o tempo
  const fa = flagAt(s)
  if (fa !== null && ctx.now >= fa) {
    flag(s, fa, events)
    return { state: s, events }
  }

  switch (action.type) {
    case 'resign':
      finish(s, { winner: other(me), reason: 'desistiu' }, events)
      return { state: s, events }
    case 'draw':
      if (s.drawOffer === other(me)) finish(s, { winner: null, reason: 'acordo' }, events)
      else if (s.drawOffer === me) return err('acao-invalida', 'Você já ofereceu empate.')
      else {
        s.drawOffer = me
        events.push({ type: 'draw-offer', color: me })
      }
      return { state: s, events }
    case 'decline':
      if (s.drawOffer !== other(me)) return err('acao-invalida', 'Não há empate para recusar.')
      s.drawOffer = null
      events.push({ type: 'draw-declined', color: me })
      return { state: s, events }
    case 'move': {
      if (s.pos.turn !== me) return err('nao-e-sua-vez', 'Espere a sua vez.')
      const from = parseSquare(action.from)
      const to = parseSquare(action.to)
      const legal = legalMoves(s.pos)
      const promo = action.promo ?? 'q'
      const move = legal.find((m) => m.from === from && m.to === to && (!m.promo || m.promo === promo))
      if (!move) return err('acao-invalida', 'Esse lance não vale.')
      const notation = san(s.pos, move, legal)
      spendClock(s, ctx.now)
      s.pos = makeMove(s.pos, move)
      s.seen.push(positionKey(s.pos))
      s.moves.push({ san: notation, from: action.from, to: action.to, ...(move.captured ? { captured: move.captured } : {}) })
      // a oferta de empate cai quando quem recebeu joga
      if (s.drawOffer !== me) s.drawOffer = null
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
  }
}

export function tick(state: ChessState, ctx: GameCtx): S {
  if (state.result) return { state, events: [] }
  const fa = flagAt(state)
  if (fa !== null && ctx.now >= fa) {
    const s = clone(state)
    const events: ChessEvent[] = []
    flag(s, fa, events)
    return { state: s, events }
  }
  const gone = (['w', 'b'] as const).find((c) => {
    const since = state.away[state.players[c].playerId]
    return since !== undefined && ctx.now >= since + ABANDON_MS
  })
  if (gone) {
    const s = clone(state)
    const events: ChessEvent[] = []
    spendClock(s, ctx.now)
    const bothGone = state.away[state.players[other(gone)].playerId] !== undefined
    finish(s, { winner: bothGone ? null : other(gone), reason: 'abandono' }, events)
    return { state: s, events }
  }
  return { state, events: [] }
}

export function nextDeadline(s: ChessState): number | null {
  if (s.result) return null
  const times = [flagAt(s), ...Object.values(s.away).map((t) => t + ABANDON_MS)].filter((t): t is number => t !== null)
  return times.length ? Math.min(...times) : null
}

export function setPresence(state: ChessState, playerId: string, present: boolean, ctx: GameCtx): S {
  if (state.result || !colorOfPlayer(state, playerId) || (playerId in state.away) === !present) return { state, events: [] }
  const s = clone(state)
  if (present) delete s.away[playerId]
  else s.away[playerId] = ctx.now
  return { state: s, events: [] }
}

export function view(s: ChessState, playerId: string | null, now: number): ChessView {
  const color = playerId ? colorOfPlayer(s, playerId) : null
  const legal: Record<string, string[]> = {}
  if (color && color === s.pos.turn && !s.result) {
    for (const m of legalMoves(s.pos)) {
      const from = squareName(m.from)
      const to = squareName(m.to)
      const list = (legal[from] ??= [])
      if (!list.includes(to)) list.push(to)
    }
  }
  const running = !s.result && s.clock
  const clock = s.clock
    ? {
        w: Math.max(0, s.clock.w - (running && s.pos.turn === 'w' ? now - s.turnStart : 0)),
        b: Math.max(0, s.clock.b - (running && s.pos.turn === 'b' ? now - s.turnStart : 0))
      }
    : null
  const player = (c: Color) => {
    const p = s.players[c]
    const since = s.away[p.playerId]
    return { playerId: p.playerId, name: p.name, away: since !== undefined, awayUntil: since !== undefined ? since + ABANDON_MS : null }
  }
  const last = s.moves[s.moves.length - 1]
  const checked = !s.result || s.result.reason === 'mate' ? inCheck(s.pos) : false
  return {
    you: color && playerId ? { playerId, color } : null,
    white: player('w'),
    black: player('b'),
    board: s.pos.board.slice(),
    turn: s.pos.turn,
    legal,
    lastMove: last ? { from: last.from, to: last.to } : null,
    check: checked ? squareName(kingSquare(s.pos.board, s.pos.turn)) : null,
    moves: s.moves.map((m) => ({ ...m })),
    minutes: s.options.minutes,
    clock,
    serverNow: now,
    drawOffer: s.drawOffer,
    result: s.result ? { ...s.result } : null
  }
}

export const isOver = (s: ChessState): boolean => s.result !== null
