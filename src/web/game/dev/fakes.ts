/** Mesa de mentira para o laboratório: gera PokerView + eventos sem servidor. */
import { fullDeck } from '../../../shared/games/poker/cards'
import type { Card, PokerEvent, PokerView, RankingEntry, SeatView } from '../../../shared/games/poker/types'
import type { EventBatch } from '../contract'

export const NAMES = ['Pedro', 'Bia', 'Caio', 'Duda', 'Edu', 'Fabi', 'Gui', 'Helena']
export const COLORS = ['#FFC94A', '#FF7A6B', '#6FD49B', '#7FB7E6', '#E8B48A', '#D9CCB8', '#C98E66', '#A98BFF']

export interface FakeState {
  n: number
  hand: number
  seq: number
  phase: PokerView['phase']
  seats: SeatView[]
  board: Card[]
  deck: Card[]
  hole: Record<string, Card[]>
  pot: number
  toAct: number
  mode: 'holdem' | 'tres'
  ranking: RankingEntry[] | null
  showdown: PokerView['showdown']
  lastEvents: EventBatch | null
}

const shuffle = <T,>(a: T[]) => {
  const x = [...a]
  for (let i = x.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[x[i], x[j]] = [x[j], x[i]]
  }
  return x
}

export function initial(n: number, mode: 'holdem' | 'tres' = 'holdem'): FakeState {
  const seats: SeatView[] = Array.from({ length: n }, (_, i) => ({
    playerId: `p${i}`,
    name: NAMES[i],
    seat: i,
    stack: 1000,
    bet: 0,
    status: 'jogando',
    dealer: i === 0,
    smallBlind: false,
    bigBlind: false,
    cards: null,
    cardCount: 0,
    rebuys: 0,
    net: 0,
    lastAction: null,
    present: true
  }))
  return { n, hand: 0, seq: 0, phase: 'intervalo', seats, board: [], deck: [], hole: {}, pot: 0, toAct: 1 % n, mode, ranking: null, showdown: null, lastEvents: null }
}

const emit = (s: FakeState, events: PokerEvent[]): FakeState => ({ ...s, seq: s.seq + 1, lastEvents: { seq: s.seq + 1, events } })

export function newHand(s: FakeState): FakeState {
  const deck = shuffle(fullDeck())
  const per = s.mode === 'tres' ? 3 : 2
  const hole: Record<string, Card[]> = {}
  s.seats.forEach((q) => (hole[q.playerId] = deck.splice(0, per)))
  const sb = (s.hand + 1) % s.n
  const bb = (s.hand + 2) % s.n
  const seats = s.seats.map((q, i) => ({
    ...q,
    status: q.stack > 0 ? ('jogando' as const) : ('zerado' as const),
    dealer: i === s.hand % s.n,
    smallBlind: i === sb,
    bigBlind: i === bb,
    bet: i === sb ? 5 : i === bb ? 10 : 0,
    stack: q.stack - (i === sb ? 5 : i === bb ? 10 : 0),
    cardCount: per,
    cards: q.playerId === 'p0' ? hole[q.playerId] : null
  }))
  const events: PokerEvent[] = [
    { kind: 'shuffle', handNo: s.hand + 1 },
    { kind: 'deal', to: seats.map((q) => q.playerId), count: per },
    { kind: 'blind', by: seats[sb].playerId, amount: 5 },
    { kind: 'blind', by: seats[bb].playerId, amount: 10 }
  ]
  return emit({ ...s, hand: s.hand + 1, phase: 'preflop', seats, board: [], deck, hole, pot: 15, toAct: (bb + 1) % s.n, ranking: null, showdown: null }, events)
}

export function act(s: FakeState, action: 'check' | 'call' | 'raise' | 'allin' | 'fold'): FakeState {
  const q = s.seats[s.toAct]
  const amount = action === 'call' ? 10 : action === 'raise' ? 20 : action === 'allin' ? q.stack : 0
  const seats = s.seats.map((x, i) =>
    i !== s.toAct ? x : { ...x, stack: x.stack - amount, bet: x.bet + amount, status: action === 'fold' ? ('desistiu' as const) : action === 'allin' ? ('allin' as const) : x.status, cardCount: action === 'fold' ? 0 : x.cardCount }
  )
  let next = (s.toAct + 1) % s.n
  while (seats[next].status === 'desistiu') next = (next + 1) % s.n
  return emit({ ...s, seats, pot: s.pot + amount, toAct: next }, [{ kind: 'act', by: q.playerId, action, amount }])
}

function street(s: FakeState, name: 'flop' | 'turn' | 'river', count: number): FakeState {
  const cards = s.deck.slice(0, count)
  const seats = s.seats.map((x) => ({ ...x, bet: 0 }))
  return emit({ ...s, phase: name, board: [...s.board, ...cards], deck: s.deck.slice(count), seats }, [{ kind: 'street', street: name, cards }])
}
export const flop = (s: FakeState) => street(s, 'flop', 3)
export const turn = (s: FakeState) => street(s, 'turn', 1)
export const river = (s: FakeState) => street(s, 'river', 1)

export function showdown(s: FakeState): FakeState {
  const alive = s.seats.filter((q) => q.status !== 'desistiu')
  const winner = alive[Math.min(1, alive.length - 1)] ?? s.seats[0]
  const events: PokerEvent[] = []
  const seats = s.seats.map((q) => {
    if (q.status === 'desistiu') return q
    const cards = s.hole[q.playerId]
    if (q.playerId !== 'p0') events.push({ kind: 'reveal', by: q.playerId, cards })
    return { ...q, cards, bet: 0 }
  })
  const handCards = [...s.board.slice(0, 3), ...(s.hole[winner.playerId] ?? [])].slice(0, 5)
  events.push({ kind: 'win', by: winner.playerId, amount: s.pot, potIndex: 0 })
  const final = seats.map((q) => (q.playerId === winner.playerId ? { ...q, stack: q.stack + s.pot } : q))
  return emit(
    {
      ...s,
      phase: 'showdown',
      seats: final,
      pot: 0,
      toAct: -1,
      showdown: { winners: [{ playerId: winner.playerId, amount: s.pot, hand: { category: 2, name: 'Par de Reis', cards: handCards } }], explanation: `${winner.name} ganhou com Par de Reis` }
    },
    events
  )
}

export function rebuy(s: FakeState): FakeState {
  const i = s.n - 1
  const seats = s.seats.map((q, k) => (k === i ? { ...q, stack: q.stack + 1000, rebuys: q.rebuys + 1, status: 'jogando' as const } : q))
  return emit({ ...s, seats }, [{ kind: 'rebuy', by: seats[i].playerId, amount: 1000 }])
}

export function timeout(s: FakeState): FakeState {
  return emit(s, [{ kind: 'timeout', by: s.seats[s.toAct >= 0 ? s.toAct : 0].playerId }])
}

export function end(s: FakeState): FakeState {
  const ranking: RankingEntry[] = [...s.seats]
    .map((q, i) => ({ playerId: q.playerId, name: q.name, net: [420, 180, -60, -150, 90, -200, 10, -290][i] ?? 0, rebuys: 0, place: 0 }))
    .sort((a, b) => b.net - a.net)
    .map((r, i) => ({ ...r, place: i + 1 }))
  return emit({ ...s, phase: 'fim', ranking }, [{ kind: 'end', ranking }])
}

/** Visão do ponto de vista do jogador `me` (null = espectador). */
export function toView(s: FakeState, me: string | null, deadlineMs = 24_000): PokerView {
  const mine = me ? (s.hole[me] ?? []) : []
  return {
    mode: s.mode,
    options: { mode: s.mode, minutes: 30, buy: 'recompra' },
    phase: s.phase,
    handNo: s.hand,
    endsAt: null,
    seats: s.seats.map((q) => ({ ...q, cards: q.playerId === me ? (s.hole[q.playerId] ?? null) : q.cards && s.phase === 'showdown' ? q.cards : null })),
    board: s.board,
    pots: s.pot > 0 ? [{ amount: s.pot, eligible: s.seats.map((q) => q.playerId) }] : [],
    toAct: s.toAct >= 0 && ['preflop', 'flop', 'turn', 'river'].includes(s.phase) ? s.seats[s.toAct].playerId : null,
    actDeadline: Date.now() + deadlineMs,
    legal: [],
    you: me ? { playerId: me, hand: mine, best: null, draws: [] } : null,
    showdown: s.showdown,
    ranking: s.ranking
  }
}

export const colorMap = (n: number): Record<string, string> => Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${i}`, COLORS[i]]))
