/**
 * Partes comuns dos jogos de tabuleiro para duas pessoas (xadrez e damas): cores sorteadas,
 * relógio por jogador, oferta de empate, desistência e quem sai da sala.
 * Funções puras sobre um pedaço do estado do jogo (`Duel`); cada jogo cuida do tabuleiro.
 */
import type { GameCtx, GameError, PlayerRef } from './types'

export type Side = 'w' | 'b'
export const otherSide = (c: Side): Side => (c === 'w' ? 'b' : 'w')

/** minutos de relógio para cada um (0 = sem relógio) */
export type DuelMinutes = 0 | 5 | 10 | 15
export const DUEL_MINUTES: readonly DuelMinutes[] = [0, 5, 10, 15]

/** quem sai da sala e não volta neste tempo perde a partida */
export const ABANDON_MS = 120_000

/** motivos de fim que valem para todo duelo; cada jogo soma os seus */
export type DuelEndReason = 'tempo' | 'desistiu' | 'acordo' | 'abandono'

export interface DuelResult<R extends string = string> {
  /** null = empate */
  winner: Side | null
  reason: R
}

export interface Duel<R extends string = string> {
  players: { w: PlayerRef; b: PlayerRef }
  /** tempo que sobrava para cada um no começo da vez atual (null = sem relógio) */
  clock: { w: number; b: number } | null
  /** quando a vez atual começou (ms epoch) */
  turnStart: number
  drawOffer: Side | null
  /** playerId -> desde quando está fora da sala */
  away: Record<string, number>
  result: DuelResult<R> | null
}

/** ações comuns: desistir, oferecer/aceitar empate e recusar */
export type DuelAction = { type: 'resign' } | { type: 'draw' } | { type: 'decline' }

export type DuelEvent<R extends string = string> =
  | { type: 'draw-offer'; color: Side }
  | { type: 'draw-declined'; color: Side }
  | { type: 'end'; result: DuelResult<R> }

export interface DuelPlayerView {
  playerId: string
  name: string
  /** saiu da sala: perde em `awayUntil` se não voltar */
  away: boolean
  awayUntil: number | null
}

export interface DuelView<R extends string = string> {
  white: DuelPlayerView
  black: DuelPlayerView
  minutes: DuelMinutes
  /** tempo que sobra para cada um quando esta visão foi feita (null = sem relógio) */
  clock: { w: number; b: number } | null
  /** relógio do servidor quando esta visão foi feita (o cliente acerta o dele) */
  serverNow: number
  drawOffer: Side | null
  result: DuelResult<R> | null
}

/** onde os eventos vão (a lista de eventos de cada jogo, que é mais larga) */
export interface EventSink<E> {
  push: (e: E) => unknown
}

const err = (error: GameError['error'], message: string): GameError => ({ error, message })

export function parseMinutes(raw: unknown, fallback: DuelMinutes): { minutes: DuelMinutes } | GameError {
  if (raw === undefined || raw === null) return { minutes: fallback }
  if (typeof raw !== 'object' || Array.isArray(raw)) return err('acao-invalida', 'Opções inválidas.')
  const minutes = (raw as Record<string, unknown>).minutes ?? fallback
  if (!(DUEL_MINUTES as readonly unknown[]).includes(minutes)) return err('acao-invalida', 'Tempo de relógio inválido.')
  return { minutes: minutes as DuelMinutes }
}

/** Começo do duelo: sorteia quem fica com as brancas. */
export function newDuel<R extends string>(players: PlayerRef[], minutes: DuelMinutes, ctx: GameCtx): Duel<R> {
  const [a, b] = players.map((p) => ({ playerId: p.playerId, name: p.name }))
  const [w, bl] = ctx.rng.int(2) === 0 ? [a, b] : [b, a]
  const ms = minutes * 60_000
  return { players: { w, b: bl }, clock: ms > 0 ? { w: ms, b: ms } : null, turnStart: ctx.now, drawOffer: null, away: {}, result: null }
}

export const sideOf = (d: Duel, playerId: string): Side | null =>
  d.players.w.playerId === playerId ? 'w' : d.players.b.playerId === playerId ? 'b' : null

/** quando acaba o tempo de quem joga agora (null = sem relógio) */
export const flagAt = (d: Duel, turn: Side): number | null => (d.clock ? d.turnStart + d.clock[turn] : null)

/** Desconta o tempo gasto na vez atual e começa a próxima em `now`. */
export function spendClock(d: Duel, turn: Side, now: number): void {
  if (d.clock) d.clock[turn] = Math.max(0, d.clock[turn] - (now - d.turnStart))
  d.turnStart = now
}

export function finish<R extends string>(d: Duel<R>, result: DuelResult<R>, events: EventSink<DuelEvent<R>>): void {
  d.result = result
  d.drawOffer = null
  events.push({ type: 'end', result })
}

/** Depois de um lance de `mover`: a oferta de empate cai quando quem recebeu joga. */
export function afterMove(d: Duel, mover: Side): void {
  if (d.drawOffer !== mover) d.drawOffer = null
}

/** Desistir e empate (muda `d`). */
export function applyDuelAction<R extends string>(
  d: Duel<R | DuelEndReason>,
  me: Side,
  action: DuelAction,
  events: EventSink<DuelEvent<R | DuelEndReason>>
): GameError | null {
  switch (action.type) {
    case 'resign':
      finish(d, { winner: otherSide(me), reason: 'desistiu' }, events)
      return null
    case 'draw':
      if (d.drawOffer === otherSide(me)) finish(d, { winner: null, reason: 'acordo' }, events)
      else if (d.drawOffer === me) return err('acao-invalida', 'Você já ofereceu empate.')
      else {
        d.drawOffer = me
        events.push({ type: 'draw-offer', color: me })
      }
      return null
    case 'decline':
      if (d.drawOffer !== otherSide(me)) return err('acao-invalida', 'Não há empate para recusar.')
      d.drawOffer = null
      events.push({ type: 'draw-declined', color: me })
      return null
  }
}

/** Prazo vencido em `now`: o tempo de quem joga (em `at`) ou alguém que saiu e não voltou. */
export function overdue(d: Duel, turn: Side, now: number): { kind: 'tempo'; at: number } | { kind: 'abandono'; gone: Side; both: boolean } | null {
  if (d.result) return null
  const fa = flagAt(d, turn)
  if (fa !== null && now >= fa) return { kind: 'tempo', at: fa }
  const gone = (['w', 'b'] as const).find((c) => {
    const since = d.away[d.players[c].playerId]
    return since !== undefined && now >= since + ABANDON_MS
  })
  if (!gone) return null
  return { kind: 'abandono', gone, both: d.away[d.players[otherSide(gone)].playerId] !== undefined }
}

export function duelDeadline(d: Duel, turn: Side): number | null {
  if (d.result) return null
  const times = [flagAt(d, turn), ...Object.values(d.away).map((t) => t + ABANDON_MS)].filter((t): t is number => t !== null)
  return times.length ? Math.min(...times) : null
}

/** Marca quem saiu/voltou. Devolve false se nada mudou. */
export function markPresence(d: Duel, playerId: string, present: boolean, now: number): boolean {
  if (d.result || !sideOf(d, playerId) || playerId in d.away === !present) return false
  if (present) delete d.away[playerId]
  else d.away[playerId] = now
  return true
}

export function duelView<R extends string>(d: Duel<R>, turn: Side, minutes: DuelMinutes, now: number): DuelView<R> {
  const running = !d.result && d.clock
  const clock = d.clock
    ? {
        w: Math.max(0, d.clock.w - (running && turn === 'w' ? now - d.turnStart : 0)),
        b: Math.max(0, d.clock.b - (running && turn === 'b' ? now - d.turnStart : 0))
      }
    : null
  const player = (c: Side): DuelPlayerView => {
    const p = d.players[c]
    const since = d.away[p.playerId]
    return { playerId: p.playerId, name: p.name, away: since !== undefined, awayUntil: since !== undefined ? since + ABANDON_MS : null }
  }
  return {
    white: player('w'),
    black: player('b'),
    minutes,
    clock,
    serverNow: now,
    drawOffer: d.drawOffer,
    result: d.result ? { ...d.result } : null
  }
}

/** Frase de fim para os motivos comuns (null = o jogo descreve o motivo dele). */
export function describeDuelEnd(r: DuelResult, white: string, black: string): string | null {
  const win = r.winner === 'w' ? white : r.winner === 'b' ? black : null
  const loser = r.winner === 'w' ? black : white
  switch (r.reason) {
    case 'tempo':
      return win ? `O tempo acabou. ${win} venceu.` : 'O tempo acabou, mas não dá mais para vencer. Empate.'
    case 'desistiu':
      return `${loser} desistiu. ${win} venceu.`
    case 'abandono':
      return win ? `${loser} saiu da sala. ${win} venceu.` : 'Os dois saíram da sala. Empate.'
    case 'acordo':
      return 'Empate combinado.'
    case 'repeticao':
      return 'A mesma posição se repetiu três vezes. Empate.'
    default:
      return null
  }
}
