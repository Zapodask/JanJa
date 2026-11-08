/**
 * Motor do Mistério (dedução, de 2 a 6). Funções puras: sorteio e tempo só via GameCtx.
 *
 * Uma carta de cada tipo vai para o envelope; o resto é distribuído. Na sua vez você palpita
 * qualquer combinação; o próximo da roda que tiver alguma das três mostra uma, só para você.
 * Acusou certo, venceu; errou, sai (mas continua mostrando cartas). Sobrou um, ele vence.
 * Ninguém vê as cartas dos outros nem a carta mostrada para outra pessoa.
 */
import { shuffle, type GameCtx, type GameError, type PlayerRef, type Step } from '../types'
import { ALL_CARDS, cardById, cardName, PLACES, SUSPECTS, TOOLS, tripleText, type Kind } from './cards'
import {
  AFTER_MS,
  AWAY_MS,
  SHOW_MS,
  SUGGEST_MS,
  type MysteryAction,
  type MysteryEvent,
  type MysteryOptions,
  type MysteryPhase,
  type MysteryView,
  type SuggestionView,
  type Triple
} from './types'

interface Suggestion extends Triple {
  by: number
  shownBy: number | null | undefined
  card?: string
}

export interface MysteryState {
  players: Array<{ playerId: string; name: string; away: boolean; out: boolean }>
  hands: string[][]
  solution: Triple
  phase: MysteryPhase
  turn: number
  current: Suggestion | null
  refuter: number | null
  history: Suggestion[]
  accusations: Array<Triple & { by: number; correct: boolean }>
  until: number | null
  winner: number | null
  log: string[]
}

type S = Step<MysteryState, MysteryEvent>
const err = (error: GameError['error'], message: string): GameError => ({ error, message })
const clone = <T>(x: T): T => structuredClone(x)

function say(s: MysteryState, text: string): void {
  s.log.push(text)
  if (s.log.length > 40) s.log.splice(0, s.log.length - 40)
}

const name = (s: MysteryState, i: number) => s.players[i].name
const matches = (s: MysteryState, i: number, t: Triple): string[] => s.hands[i].filter((c) => c === t.quem || c === t.onde || c === t.como)

function setUntil(s: MysteryState, now: number): void {
  if (s.phase === 'fim') return void (s.until = null)
  const who = s.phase === 'mostrar' ? (s.refuter as number) : s.turn
  const ms = s.phase === 'palpite' ? SUGGEST_MS : s.phase === 'mostrar' ? SHOW_MS : AFTER_MS
  s.until = now + (s.players[who].away ? AWAY_MS : ms)
}

function finish(s: MysteryState, winner: number | null, events: MysteryEvent[]): void {
  s.phase = 'fim'
  s.winner = winner
  s.until = null
  s.current = null
  s.refuter = null
  events.push({ type: 'end', winner, solution: { ...s.solution } })
  say(s, `Foi ${tripleText(s.solution)}.`)
}

function nextTurn(s: MysteryState, now: number, events: MysteryEvent[]): void {
  const alive = s.players.map((p, i) => (p.out ? -1 : i)).filter((i) => i >= 0)
  if (alive.length <= 1) {
    if (alive.length === 1) say(s, `Só ${name(s, alive[0])} ficou no jogo e venceu.`)
    return finish(s, alive[0] ?? null, events)
  }
  for (let k = 1; k <= s.players.length; k++) {
    const i = (s.turn + k) % s.players.length
    if (!s.players[i].out) {
      s.turn = i
      break
    }
  }
  s.phase = 'palpite'
  s.current = null
  s.refuter = null
  setUntil(s, now)
}

function show(s: MysteryState, refuter: number, card: string, now: number, events: MysteryEvent[]): void {
  const cur = s.current as Suggestion
  cur.shownBy = refuter
  cur.card = card
  s.history.push(clone(cur))
  events.push({ type: 'shown', by: refuter, to: cur.by })
  say(s, `${name(s, refuter)} mostrou uma carta para ${name(s, cur.by)}.`)
  s.refuter = null
  s.phase = 'depois'
  setUntil(s, now)
}

/** Procura, a partir de quem palpitou, o primeiro que tem alguma das três cartas. */
function refute(s: MysteryState, now: number, events: MysteryEvent[]): void {
  const cur = s.current as Suggestion
  const n = s.players.length
  for (let k = 1; k < n; k++) {
    const i = (cur.by + k) % n
    const m = matches(s, i, cur)
    if (!m.length) continue
    if (m.length === 1) return show(s, i, m[0], now, events)
    s.phase = 'mostrar'
    s.refuter = i
    setUntil(s, now)
    return
  }
  cur.shownBy = null
  s.history.push(clone(cur))
  events.push({ type: 'none', by: cur.by })
  say(s, 'Ninguém tinha nenhuma das três cartas.')
  s.phase = 'depois'
  setUntil(s, now)
}

// ---------- contrato ----------
export const parseOptions = (): MysteryOptions => ({})

const ofKind = (id: unknown, kind: Kind): boolean => typeof id === 'string' && cardById(id)?.kind === kind
const isTriple = (a: Record<string, unknown>): boolean => ofKind(a.quem, 'quem') && ofKind(a.onde, 'onde') && ofKind(a.como, 'como')

export function parseAction(raw: unknown): MysteryAction | GameError {
  if (typeof raw !== 'object' || raw === null) return err('acao-invalida', 'Ação inválida.')
  const a = raw as Record<string, unknown>
  switch (a.type) {
    case 'suggest':
    case 'accuse':
      if (!isTriple(a)) return err('acao-invalida', 'Escolha quem, onde e com o quê.')
      return { type: a.type, quem: a.quem as string, onde: a.onde as string, como: a.como as string }
    case 'show':
      return typeof a.card === 'string' && cardById(a.card) ? { type: 'show', card: a.card } : err('acao-invalida', 'Carta inválida.')
    case 'end':
      return { type: 'end' }
    default:
      return err('acao-invalida', 'Ação desconhecida.')
  }
}

export function setup(players: PlayerRef[], _options: MysteryOptions, ctx: GameCtx): S {
  const pick = (cards: readonly { id: string }[]) => cards[ctx.rng.int(cards.length)].id
  const solution: Triple = { quem: pick(SUSPECTS), onde: pick(PLACES), como: pick(TOOLS) }
  const rest = shuffle(
    ALL_CARDS.map((c) => c.id).filter((id) => id !== solution.quem && id !== solution.onde && id !== solution.como),
    ctx.rng
  )
  const n = players.length
  const first = ctx.rng.int(n)
  const hands: string[][] = players.map(() => [])
  // distribui a partir de quem começa (quem joga depois recebe as que sobram)
  rest.forEach((c, k) => hands[(first + k) % n].push(c))
  const s: MysteryState = {
    players: players.map((p) => ({ playerId: p.playerId, name: p.name, away: false, out: false })),
    hands,
    solution,
    phase: 'palpite',
    turn: first,
    current: null,
    refuter: null,
    history: [],
    accusations: [],
    until: null,
    winner: null,
    log: [`Roubaram o quadro do Casarão! ${players[first].name} começa.`]
  }
  setUntil(s, ctx.now)
  return { state: s, events: [{ type: 'start', first }] }
}

export function apply(state: MysteryState, playerId: string, action: MysteryAction, ctx: GameCtx): S | GameError {
  if (state.phase === 'fim') return err('partida-encerrada', 'A partida acabou.')
  const i = state.players.findIndex((p) => p.playerId === playerId)
  if (i < 0) return err('nao-e-sua-vez', 'Você não está jogando.')
  const s = clone(state)
  const events: MysteryEvent[] = []
  const now = ctx.now
  if (action.type === 'show') {
    if (s.phase !== 'mostrar' || s.refuter !== i) return err('nao-e-sua-vez', 'Não é você que mostra agora.')
    if (!matches(s, i, s.current as Triple).includes(action.card)) return err('acao-invalida', 'Mostre uma das cartas do palpite.')
    show(s, i, action.card, now, events)
    return { state: s, events }
  }
  if (s.turn !== i) return err('nao-e-sua-vez', 'Espere a sua vez.')
  switch (action.type) {
    case 'suggest': {
      if (s.phase !== 'palpite') return err('acao-invalida', 'Você já palpitou nesta vez.')
      const t: Triple = { quem: action.quem, onde: action.onde, como: action.como }
      s.current = { ...t, by: i, shownBy: undefined }
      events.push({ type: 'suggest', by: i, ...t })
      say(s, `${name(s, i)} palpitou: ${tripleText(t)}.`)
      refute(s, now, events)
      break
    }
    case 'accuse': {
      if (s.phase !== 'palpite' && s.phase !== 'depois') return err('acao-invalida', 'Agora não dá para acusar.')
      const t: Triple = { quem: action.quem, onde: action.onde, como: action.como }
      const correct = t.quem === s.solution.quem && t.onde === s.solution.onde && t.como === s.solution.como
      s.accusations.push({ ...t, by: i, correct })
      events.push({ type: 'accuse', by: i, correct, ...t })
      say(s, `${name(s, i)} acusou: ${tripleText(t)}. ${correct ? 'Acertou!' : 'Errou e saiu do jogo.'}`)
      if (correct) finish(s, i, events)
      else {
        s.players[i].out = true
        nextTurn(s, now, events)
      }
      break
    }
    case 'end':
      if (s.phase !== 'palpite' && s.phase !== 'depois') return err('acao-invalida', 'Espere a carta.')
      if (s.phase === 'palpite') say(s, `${name(s, i)} passou a vez.`)
      nextTurn(s, now, events)
      break
  }
  return { state: s, events }
}

export function tick(state: MysteryState, ctx: GameCtx): S {
  if (state.phase === 'fim' || state.until === null || ctx.now < state.until) return { state, events: [] }
  const s = clone(state)
  const events: MysteryEvent[] = []
  if (s.phase === 'mostrar') {
    // estourou: mostra a primeira que servir
    const i = s.refuter as number
    show(s, i, matches(s, i, s.current as Triple)[0], ctx.now, events)
  } else {
    if (s.phase === 'palpite') say(s, `${name(s, s.turn)} não palpitou a tempo.`)
    nextTurn(s, ctx.now, events)
  }
  return { state: s, events }
}

export const nextDeadline = (s: MysteryState): number | null => (s.phase === 'fim' ? null : s.until)

export function setPresence(state: MysteryState, playerId: string, present: boolean, ctx: GameCtx): S {
  const i = state.players.findIndex((p) => p.playerId === playerId)
  if (i < 0 || state.players[i].away === !present || state.phase === 'fim') return { state, events: [] }
  const s = clone(state)
  s.players[i].away = !present
  const who = s.phase === 'mostrar' ? s.refuter : s.turn
  if (!present && who === i && s.until !== null) s.until = Math.min(s.until, ctx.now + AWAY_MS)
  return { state: s, events: [] }
}

function suggestionFor(sg: Suggestion, me: number | null): SuggestionView {
  const out: SuggestionView = { quem: sg.quem, onde: sg.onde, como: sg.como, by: sg.by, shownBy: sg.shownBy ?? null }
  // a carta mostrada só vai para quem palpitou e para quem mostrou
  if (sg.card && me !== null && (me === sg.by || me === sg.shownBy)) out.card = sg.card
  return out
}

export function view(s: MysteryState, playerId: string | null, now: number): MysteryView {
  const i = playerId ? s.players.findIndex((p) => p.playerId === playerId) : -1
  const me = i >= 0 ? i : null
  const over = s.phase === 'fim'
  return {
    you: me !== null ? { playerId: playerId as string, index: me } : null,
    players: s.players.map((p, k) => ({ playerId: p.playerId, name: p.name, index: k, cards: s.hands[k].length, out: p.out, away: p.away })),
    myCards: me !== null ? [...s.hands[me]] : [],
    phase: s.phase,
    turn: over ? null : s.turn,
    current: s.current ? suggestionFor(s.current, me) : null,
    refuter: s.refuter,
    myChoices: me !== null && s.phase === 'mostrar' && s.refuter === me ? matches(s, me, s.current as Triple) : [],
    history: s.history.map((h) => suggestionFor(h, me)),
    accusations: clone(s.accusations),
    // quem errou a acusação vê a solução em segredo
    solution: over || (me !== null && s.players[me].out) ? { ...s.solution } : null,
    winner: s.winner,
    until: s.until,
    serverNow: now,
    log: s.log.slice(-10)
  }
}

export const isOver = (s: MysteryState): boolean => s.phase === 'fim'

export { cardName }
