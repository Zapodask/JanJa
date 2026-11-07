import { fullDeck, parseCards } from '../../src/shared/games/poker/cards'
import { pokerGame, type PokerState } from '../../src/shared/games/poker'
import type { Card, LegalAction, PokerAction, PokerEvent, PokerOptions, PokerView } from '../../src/shared/games/poker/types'
import { isGameError, seededRng, type GameCtx, type PlayerRef } from '../../src/shared/games/types'

export const OPTS: PokerOptions = { mode: 'holdem', minutes: 0, buy: 'recompra' }
export const ids = (n: number): PlayerRef[] => Array.from({ length: n }, (_, i) => ({ playerId: `p${i}`, name: `J${i}` }))
export const ctxAt = (now: number, seed = 1): GameCtx => ({ now, rng: seededRng(seed) })

export interface Ctr { state: PokerState; events: PokerEvent[] }

/** cria a partida procurando uma semente em que o botão cai em `dealer` (índice) */
export function start(n: number, opts: Partial<PokerOptions> = {}, dealer = 0, players: PlayerRef[] = ids(n), now = 0): Ctr {
  for (let seed = 1; seed < 500; seed++) {
    const s = pokerGame.setup(players, { ...OPTS, ...opts }, ctxAt(now, seed))
    if (s.state.dealer === dealer) return { state: s.state, events: s.events }
  }
  throw new Error('sem semente')
}

/** troca as cartas da mão atual e do baralho (a próxima carta comunitária sai na ordem dada) */
export function rig(state: PokerState, holes: Record<string, string>, board: string): PokerState {
  const st = structuredClone(state)
  const b = parseCards(board)
  const used = new Set<string>(b)
  for (const [id, h] of Object.entries(holes)) {
    const cs = parseCards(h)
    cs.forEach((c) => used.add(c))
    const p = st.players.find((x) => x.playerId === id)!
    p.hole = cs
  }
  // completa as mãos não definidas com cartas livres
  const free = fullDeck().filter((c) => !used.has(c))
  for (const p of st.players) {
    if (holes[p.playerId] === undefined && p.hole.length) {
      p.hole = free.splice(0, p.hole.length) as Card[]
    }
  }
  st.deck = [...free, ...b.slice().reverse()]
  st.board = []
  return st
}

export function setStack(state: PokerState, id: string, stack: number): PokerState {
  const st = structuredClone(state)
  st.players.find((p) => p.playerId === id)!.stack = stack
  return st
}

export function act(c: Ctr, id: string, kind: PokerAction['kind'], now = 0): Ctr {
  const r = pokerGame.apply(c.state, id, { kind } as PokerAction, ctxAt(now))
  if (isGameError(r)) throw new Error(`${id} ${kind}: ${r.error} ${r.message}`)
  return { state: r.state, events: r.events }
}

export const tryAct = (c: Ctr, id: string, kind: PokerAction['kind'], now = 0) =>
  pokerGame.apply(c.state, id, { kind } as PokerAction, ctxAt(now))

export const tickAt = (c: Ctr, now: number): Ctr => {
  const r = pokerGame.tick(c.state, ctxAt(now))
  return { state: r.state, events: r.events }
}

export const viewOf = (c: Ctr, id: string | null, now = 0): PokerView => pokerGame.view(c.state, id, now)
export const legalOf = (c: Ctr, id: string): LegalAction[] => viewOf(c, id).legal
export const kinds = (l: LegalAction[]) => l.map((x) => x.kind)
export const actor = (c: Ctr): string | null => viewOf(c, null).toAct
export const stackOf = (c: Ctr, id: string) => c.state.players.find((p) => p.playerId === id)!.stack

/** política "agressiva": aumenta se puder, senão paga/all-in/check */
export function aggressive(c: Ctr, now = 0): Ctr {
  const id = actor(c)!
  const k = kinds(legalOf(c, id))
  const kind = k.includes('raise') ? 'raise' : k.includes('call') ? 'call' : k.includes('allin') ? 'allin' : 'check'
  return act(c, id, kind, now)
}
export function passive(c: Ctr, now = 0): Ctr {
  const id = actor(c)!
  const k = kinds(legalOf(c, id))
  const kind = k.includes('check') ? 'check' : k.includes('call') ? 'call' : 'allin'
  return act(c, id, kind, now)
}
/** repete a política até a mão acabar (phase intervalo/fim) */
export function playOut(c: Ctr, policy: (c: Ctr, now?: number) => Ctr = passive, now = 0): Ctr {
  let guard = 0
  while (c.state.phase !== 'intervalo' && c.state.phase !== 'fim') {
    c = policy(c, now)
    if (++guard > 200) throw new Error('mão não termina')
  }
  return c
}
export const total = (c: Ctr) => c.state.players.reduce((s, p) => s + p.stack + p.contrib, 0)
