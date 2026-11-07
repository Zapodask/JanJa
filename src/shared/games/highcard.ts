import { shuffle, type GameDefinition, type GameError, type PlayerRef, type Rng, type Step } from './types'

/**
 * Jogo-teste "maior carta": cada um recebe 1 carta por rodada, a maior ganha 1 ponto.
 * Serve para testar o GameHost sem depender do poker. Carta = 0..51, valor = floor(c / 4).
 */

export interface HighCardOptions {
  rounds: number
}

export interface HighCardState {
  players: PlayerRef[]
  rounds: number
  round: number
  /** cartas da rodada atual (segredo até revelar) */
  cards: Record<string, number>
  ready: Record<string, boolean>
  scores: Record<string, number>
  away: Record<string, boolean>
  revealed: boolean
  over: boolean
  nextAt: number | null
}

export type HighCardAction = { type: 'ready' }

export type HighCardEvent =
  | { type: 'dealt'; round: number }
  | { type: 'reveal'; round: number; cards: Record<string, number>; winners: string[] }
  | { type: 'over'; scores: Record<string, number> }

export interface HighCardView {
  you: string | null
  players: PlayerRef[]
  round: number
  rounds: number
  myCard: number | null
  /** só preenchido depois de revelar */
  cards: Record<string, number> | null
  ready: Record<string, boolean>
  scores: Record<string, number>
  away: Record<string, boolean>
  revealed: boolean
  over: boolean
}

export const ROUND_MS = 3000

const fail = (error: GameError['error'], message: string): GameError => ({ error, message })

function deal(players: PlayerRef[], rng: Rng): Record<string, number> {
  const deck = shuffle(Array.from({ length: 52 }, (_, i) => i), rng)
  const cards: Record<string, number> = {}
  players.forEach((p, i) => (cards[p.playerId] = deck[i]))
  return cards
}

const noneReady = (players: PlayerRef[]): Record<string, boolean> =>
  Object.fromEntries(players.map((p) => [p.playerId, false]))

function reveal(s: HighCardState, now: number): Step<HighCardState, HighCardEvent> {
  const best = Math.max(...s.players.map((p) => Math.floor(s.cards[p.playerId] / 4)))
  const winners = s.players.filter((p) => Math.floor(s.cards[p.playerId] / 4) === best).map((p) => p.playerId)
  const scores = { ...s.scores }
  for (const w of winners) scores[w] += 1
  const events: HighCardEvent[] = [{ type: 'reveal', round: s.round, cards: { ...s.cards }, winners }]
  const over = s.round >= s.rounds
  if (over) events.push({ type: 'over', scores })
  return { state: { ...s, scores, revealed: true, over, nextAt: over ? null : now + ROUND_MS }, events }
}

export const highCardGame: GameDefinition<HighCardState, HighCardOptions, HighCardAction, HighCardView, HighCardEvent> = {
  id: 'highcard',
  name: 'Maior carta',
  minPlayers: 2,
  maxPlayers: 8,

  parseOptions(raw) {
    if (raw === undefined || raw === null) return { rounds: 3 }
    if (typeof raw !== 'object' || Array.isArray(raw)) return fail('acao-invalida', 'Opções inválidas.')
    const rounds = (raw as { rounds?: unknown }).rounds
    if (rounds === undefined) return { rounds: 3 }
    if (typeof rounds !== 'number' || !Number.isInteger(rounds) || rounds < 1 || rounds > 5) {
      return fail('acao-invalida', 'Rodadas devem ser de 1 a 5.')
    }
    return { rounds }
  },

  setup(players, options, ctx) {
    const state: HighCardState = {
      players: players.map((p) => ({ ...p })),
      rounds: options.rounds,
      round: 1,
      cards: deal(players, ctx.rng),
      ready: noneReady(players),
      scores: Object.fromEntries(players.map((p) => [p.playerId, 0])),
      away: {},
      revealed: false,
      over: false,
      nextAt: ctx.now + ROUND_MS
    }
    return { state, events: [{ type: 'dealt', round: 1 }] }
  },

  parseAction(raw) {
    if (typeof raw === 'object' && raw !== null && (raw as { type?: unknown }).type === 'ready') return { type: 'ready' }
    return fail('acao-invalida', 'Ação desconhecida.')
  },

  apply(state, playerId, _action, ctx) {
    if (state.over) return fail('partida-encerrada', 'A partida acabou.')
    if (!state.players.some((p) => p.playerId === playerId)) return fail('acao-invalida', 'Você não está na partida.')
    if (state.revealed) return fail('acao-invalida', 'A rodada já foi revelada.')
    if (state.ready[playerId]) return fail('acao-invalida', 'Você já estava pronto.')
    const next = { ...state, ready: { ...state.ready, [playerId]: true } }
    if (state.players.every((p) => next.ready[p.playerId])) return reveal(next, ctx.now)
    return { state: next, events: [] }
  },

  tick(state, ctx) {
    if (state.over || state.nextAt === null || ctx.now < state.nextAt) return { state, events: [] }
    if (!state.revealed) return reveal(state, ctx.now)
    const round = state.round + 1
    return {
      state: { ...state, round, cards: deal(state.players, ctx.rng), ready: noneReady(state.players), revealed: false, nextAt: ctx.now + ROUND_MS },
      events: [{ type: 'dealt', round }]
    }
  },

  nextDeadline: (state) => (state.over ? null : state.nextAt),

  setPresence(state, playerId, present) {
    if (!state.players.some((p) => p.playerId === playerId) || !!state.away[playerId] === !present) {
      return { state, events: [] }
    }
    return { state: { ...state, away: { ...state.away, [playerId]: !present } }, events: [] }
  },

  view(state, playerId) {
    const mine = playerId !== null && playerId in state.cards ? state.cards[playerId] : null
    return {
      you: playerId,
      players: state.players,
      round: state.round,
      rounds: state.rounds,
      myCard: mine,
      cards: state.revealed ? { ...state.cards } : null,
      ready: { ...state.ready },
      scores: { ...state.scores },
      away: { ...state.away },
      revealed: state.revealed,
      over: state.over
    }
  },

  isOver: (state) => state.over
}

