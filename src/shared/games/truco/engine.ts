/**
 * Motor do truco gaudério (1x1, 2x2, 3x3). Funções puras: tempo e baralho só via GameCtx.
 *
 * - Times alternados pela cadeira: pares (0) x ímpares (1). A vez anda no sentido anti-horário
 *   (índice seguinte); quem dá as cartas é sorteado e quem é "mão" é o seguinte.
 * - A mão acontece em "mesas": uma só na mão normal; três duelos 1x1 na mão de testa (3x3,
 *   quando os dois times estão entre 5 e 25, alternando com a normal). Os duelos correm ao mesmo
 *   tempo (o jogo é `concurrent`); cada ação traz a versão da mesa que a pessoa viu (`ref`).
 * - Ninguém vê as cartas dos outros: a visão só leva as suas e as que já foram jogadas.
 */
import { shuffle, type GameCtx, type GameError, type PlayerRef, type Rng, type Step } from '../types'
import { cardName, DECK, envidoPoints, florPoints, power, type Card } from './cards'
import {
  AWAY_MS,
  BREAK_MS,
  CONTRAFLOR_POINTS,
  DECIDE_MS,
  DEFAULT_TRUCO_OPTIONS,
  envidoName,
  FLOR_POINTS,
  TARGET,
  TESTA_FROM,
  TESTA_TO,
  TRUCO_PLAYERS,
  trucoName,
  type EnvidoKind,
  type EnvidoResult,
  type MesaView,
  type Team,
  type TrucoAction,
  type TrucoCan,
  type TrucoEvent,
  type TrucoOptions,
  type TrucoPlayers,
  type TrucoView
} from './types'

export interface Mesa {
  id: number
  order: number[]
  tricks: Array<{ plays: Array<{ p: number; card: Card }>; result: Team | 'P' | null }>
  turn: number | null
  ref: number
  truco: { level: number; owner: Team | null; pending: { by: Team; level: number } | null }
  envido: { open: boolean; calls: EnvidoKind[]; by: Team | null; pending: boolean; result: EnvidoResult | null }
  flor: { holders: number[]; stage: { kind: 'decide' | 'answer'; team: Team } | null; result: string | null }
  winner: Team | null
  until: number | null
}

export interface TrucoState {
  options: TrucoOptions
  players: Array<{ playerId: string; name: string; away: boolean }>
  score: [number, number]
  dealer: number
  hand: number
  testa: boolean
  lastTesta: boolean
  /** cartas que cada um ainda tem */
  cards: Record<number, Card[]>
  /** as três recebidas (envido e flor contam por elas) */
  dealt: Record<number, Card[]>
  mesas: Mesa[]
  phase: 'jogando' | 'intervalo' | 'fim'
  until: number | null
  log: string[]
  winner: Team | null
}

type S = Step<TrucoState, TrucoEvent>
type Ev = TrucoEvent[]
type Actor = { kind: 'play'; player: number } | { kind: 'truco' | 'envido' | 'flor' | 'contraflor'; team: Team }

const err = (error: GameError['error'], message: string): GameError => ({ error, message })
const clone = <T>(x: T): T => structuredClone(x)
const LOG_MAX = 40

export const teamOf = (i: number): Team => (i % 2) as Team
const other = (t: Team): Team => (t === 0 ? 1 : 0)
const teamName = (s: TrucoState, t: Team): string => {
  const names = s.players.filter((_, i) => teamOf(i) === t).map((p) => p.name)
  return names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ' e ' + names[names.length - 1]
}
const ENVIDO_VALUE: Record<EnvidoKind, number> = { envido: 2, real: 3, falta: 0 }

function say(s: TrucoState, text: string): void {
  s.log.push(text)
  if (s.log.length > LOG_MAX) s.log.splice(0, s.log.length - LOG_MAX)
}

const mesaOf = (s: TrucoState, i: number): Mesa | undefined => s.mesas.find((m) => m.order.includes(i))
const curTrick = (m: Mesa) => m.tricks[m.tricks.length - 1]

export function actor(m: Mesa): Actor | null {
  if (m.winner !== null) return null
  if (m.flor.stage) return { kind: m.flor.stage.kind === 'decide' ? 'flor' : 'contraflor', team: m.flor.stage.team }
  if (m.envido.pending) return { kind: 'envido', team: other(m.envido.by as Team) }
  if (m.truco.pending) return { kind: 'truco', team: other(m.truco.pending.by) }
  return m.turn === null ? null : { kind: 'play', player: m.turn }
}

/** envido novo: só na primeira vaza, se ninguém cantou e não tem flor na mesa */
const envidoAllowed = (m: Mesa): boolean => m.envido.open && m.envido.calls.length === 0 && m.tricks.length === 1 && m.tricks[0].result === null

function envidoRaises(calls: EnvidoKind[]): EnvidoKind[] {
  if (calls.includes('falta')) return []
  if (calls.includes('real')) return ['falta']
  return calls.filter((c) => c === 'envido').length < 2 ? ['envido', 'real', 'falta'] : ['real', 'falta']
}

const canRaiseTruco = (m: Mesa, t: Team): boolean => !m.truco.pending && m.truco.level < 4 && (m.truco.owner === null || m.truco.owner === t)

export function canOf(s: TrucoState, i: number): TrucoCan | null {
  const m = mesaOf(s, i)
  if (s.phase !== 'jogando' || !m) return null
  const a = actor(m)
  const t = teamOf(i)
  const c: TrucoCan = { play: false, truco: null, envido: [], quero: false, naoquero: false, contraflor: false, mazo: false }
  if (!a) return c
  if (a.kind === 'play') {
    if (a.player !== i) return c
    c.play = true
    c.truco = canRaiseTruco(m, t) ? m.truco.level + 1 : null
    c.envido = envidoAllowed(m) ? ['envido', 'real', 'falta'] : []
    c.mazo = true
    return c
  }
  if (a.team !== t) return c
  switch (a.kind) {
    case 'truco': {
      const pend = m.truco.pending as { level: number }
      c.quero = c.naoquero = c.mazo = true
      c.truco = pend.level < 4 ? pend.level + 1 : null
      // "o envido está primeiro": trucaram na primeira vaza, ainda dá para cantar envido
      c.envido = envidoAllowed(m) && pend.level === 2 ? ['envido', 'real', 'falta'] : []
      return c
    }
    case 'envido':
      c.quero = c.naoquero = true
      c.envido = envidoRaises(m.envido.calls)
      return c
    case 'flor':
      c.contraflor = c.naoquero = true
      return c
    case 'contraflor':
      c.quero = c.naoquero = true
      return c
  }
}

// ---------- pontos ----------
function addPoints(s: TrucoState, team: Team, points: number, why: string, events: Ev): void {
  if (s.winner !== null || points <= 0) return
  s.score[team] += points
  events.push({ type: 'points', team, points, why })
  const solo = s.players.length === 2
  const pts = points === 1 ? '1 ponto' : `${points} pontos`
  say(s, `${teamName(s, team)} ${solo ? 'fez' : 'fizeram'} ${pts} (${why}).`)
  if (s.score[team] >= TARGET) {
    s.winner = team
    s.phase = 'fim'
    s.until = null
    for (const m of s.mesas) m.until = null
    events.push({ type: 'end', winner: team })
    say(s, `${teamName(s, team)} ${solo ? `chegou a ${TARGET} e ganhou` : `chegaram a ${TARGET} e ganharam`} a partida.`)
  }
}

const faltaPoints = (s: TrucoState): number => TARGET - Math.max(s.score[0], s.score[1])

/** melhor de cada time (empate: quem está mais perto da mão) */
function bestByTeam(m: Mesa, value: (p: number) => number | null): Partial<Record<Team, { p: number; points: number }>> {
  const best: Partial<Record<Team, { p: number; points: number }>> = {}
  for (const p of m.order) {
    const v = value(p)
    if (v === null) continue
    const t = teamOf(p)
    if (!best[t] || v > (best[t] as { points: number }).points) best[t] = { p, points: v }
  }
  return best
}

function duelWinner(m: Mesa, best: Partial<Record<Team, { p: number; points: number }>>): Team {
  const a = best[0]
  const b = best[1]
  if (!a) return 1
  if (!b) return 0
  if (a.points !== b.points) return a.points > b.points ? 0 : 1
  return m.order.indexOf(a.p) < m.order.indexOf(b.p) ? 0 : 1
}

// ---------- prazos ----------
function arm(s: TrucoState, m: Mesa, now: number): void {
  const a = actor(m)
  if (!a || s.phase !== 'jogando') {
    m.until = null
    return
  }
  const who = a.kind === 'play' ? [a.player] : m.order.filter((p) => teamOf(p) === a.team)
  m.until = now + (who.every((p) => s.players[p].away) ? AWAY_MS : DECIDE_MS)
}

function refreshUntil(s: TrucoState): void {
  if (s.phase !== 'jogando') return
  const t = s.mesas.map((m) => m.until).filter((x): x is number => x !== null)
  s.until = t.length ? Math.min(...t) : null
}

// ---------- mão ----------
function setupFlor(s: TrucoState, m: Mesa, events: Ev): void {
  const holders = m.order.filter((p) => florPoints(s.dealt[p]) !== null)
  m.flor.holders = holders
  if (!holders.length) return
  m.envido.open = false
  for (const p of holders) {
    events.push({ type: 'call', mesa: m.id, p, call: 'flor' })
    say(s, `${s.players[p].name} cantou flor.`)
  }
  const teams = new Set(holders.map(teamOf))
  if (teams.size === 1) {
    const t = teamOf(holders[0])
    m.flor.result = `${teamName(s, t)}: flor`
    addPoints(s, t, FLOR_POINTS * holders.length, holders.length > 1 ? 'flores' : 'flor', events)
    return
  }
  // as duas equipes têm flor: quem cantou depois decide se canta contra-flor
  m.flor.stage = { kind: 'decide', team: other(teamOf(holders[0])) }
}

function newMesa(id: number, order: number[]): Mesa {
  return {
    id,
    order,
    tricks: [{ plays: [], result: null }],
    turn: order[0],
    ref: 0,
    truco: { level: 1, owner: null, pending: null },
    envido: { open: true, calls: [], by: null, pending: false, result: null },
    flor: { holders: [], stage: null, result: null },
    winner: null,
    until: null
  }
}

function startHand(s: TrucoState, now: number, rng: Rng, events: Ev): void {
  const n = s.players.length
  s.hand++
  const mao = (s.dealer + 1) % n
  const deck = shuffle(DECK, rng)
  for (let k = 0; k < n; k++) {
    const p = (mao + k) % n
    s.cards[p] = deck.slice(k * 3, k * 3 + 3)
    s.dealt[p] = [...s.cards[p]]
  }
  const inRange = n === 6 && s.score.every((x) => x >= TESTA_FROM && x <= TESTA_TO)
  s.testa = inRange && !s.lastTesta
  s.lastTesta = s.testa
  buildMesas(s, now, events)
}

/** Monta as mesas da mão com as cartas já dadas (flor cantada sozinha). */
function buildMesas(s: TrucoState, now: number, events: Ev): void {
  const n = s.players.length
  const mao = (s.dealer + 1) % n
  const dist = (p: number) => (p - mao + n) % n
  const groups = s.testa ? [0, 1, 2].map((i) => [i, i + 3]) : [Array.from({ length: n }, (_, i) => i)]
  s.mesas = groups.map((g, id) => newMesa(id, [...g].sort((a, b) => dist(a) - dist(b))))
  s.phase = 'jogando'
  events.push({ type: 'deal', hand: s.hand, dealer: s.dealer, testa: s.testa })
  say(s, `Mão ${s.hand}: ${s.players[s.dealer].name} deu as cartas${s.testa ? '. Mão de testa: cada um contra quem está na frente.' : '.'}`)
  for (const m of s.mesas) {
    setupFlor(s, m, events)
    if (s.winner !== null) return
    arm(s, m, now)
  }
  refreshUntil(s)
}

/** Troca as cartas da mão atual (testes e laboratório: "mão combinada"). */
export function withHands(state: TrucoState, hands: Card[][], now: number): TrucoState {
  const s = clone(state)
  hands.forEach((h, p) => {
    s.cards[p] = [...h]
    s.dealt[p] = [...h]
  })
  s.winner = null
  buildMesas(s, now, [])
  return s
}

/** Quem ganhou a mão pelas vazas (null = ainda não dá para saber). */
export function handWinner(results: Array<Team | 'P'>, maoTeam: Team): Team | null {
  const r = results
  for (const t of [0, 1] as Team[]) if (r.filter((x) => x === t).length >= 2) return t
  if (r.length >= 2) {
    if (r[0] === 'P' && r[1] !== 'P') return r[1]
    if (r[0] !== 'P' && r[1] === 'P') return r[0]
  }
  if (r.length === 3) {
    if (r[0] === 'P' && r[1] === 'P') return r[2] === 'P' ? maoTeam : r[2]
    if (r[2] === 'P') return r[0] as Team
    return r[2]
  }
  return null
}

function finishMesa(s: TrucoState, m: Mesa, winner: Team, points: number, why: string, now: number, events: Ev): void {
  m.winner = winner
  m.turn = null
  m.until = null
  events.push({ type: 'mesa-end', mesa: m.id, winner, points })
  addPoints(s, winner, points, why, events)
  if (s.phase === 'jogando' && s.mesas.every((x) => x.winner !== null)) {
    s.phase = 'intervalo'
    s.until = now + BREAK_MS
  }
}

function playCard(s: TrucoState, m: Mesa, p: number, card: Card, now: number, events: Ev): void {
  s.cards[p] = s.cards[p].filter((c) => c !== card)
  const trick = curTrick(m)
  trick.plays.push({ p, card })
  events.push({ type: 'play', mesa: m.id, p, card })
  say(s, `${s.players[p].name} jogou ${cardName(card)}.`)
  if (trick.plays.length < m.order.length) {
    // próximo no sentido da mesa que ainda não jogou nesta vaza
    const k = m.order.indexOf(p)
    for (let j = 1; j <= m.order.length; j++) {
      const q = m.order[(k + j) % m.order.length]
      if (!trick.plays.some((x) => x.p === q)) {
        m.turn = q
        break
      }
    }
    return
  }
  const best = Math.max(...trick.plays.map((x) => power(x.card)))
  const top = trick.plays.filter((x) => power(x.card) === best)
  const teams = new Set(top.map((x) => teamOf(x.p)))
  trick.result = teams.size > 1 ? 'P' : teamOf(top[0].p)
  events.push({ type: 'trick', mesa: m.id, result: trick.result })
  say(s, trick.result === 'P' ? 'Vaza parda (empate).' : `${s.players[top[0].p].name} fez a vaza.`)
  m.envido.open = false
  const results = m.tricks.map((t) => t.result as Team | 'P')
  const won = handWinner(results, teamOf(m.order[0]))
  if (won !== null) {
    const lvl = m.truco.level
    return finishMesa(s, m, won, lvl, lvl === 1 ? 'mão' : trucoName(lvl).toLowerCase(), now, events)
  }
  m.tricks.push({ plays: [], result: null })
  m.turn = trick.result === 'P' ? m.order[0] : top[0].p
}

function resolveEnvido(s: TrucoState, m: Mesa, quero: boolean, events: Ev): void {
  const calls = m.envido.calls
  const by = m.envido.by as Team
  m.envido.pending = false
  m.envido.open = false
  if (!quero) {
    const pts = calls.length === 1 ? 1 : calls.slice(0, -1).reduce((a, k) => a + ENVIDO_VALUE[k], 0)
    m.envido.result = { winner: by, points: pts, sung: [] }
    addPoints(s, by, pts, 'envido não querido', events)
    return
  }
  const pts = calls[calls.length - 1] === 'falta' ? faltaPoints(s) : calls.reduce((a, k) => a + ENVIDO_VALUE[k], 0)
  const best = bestByTeam(m, (p) => envidoPoints(s.dealt[p]))
  const winner = duelWinner(m, best)
  const sung = ([0, 1] as Team[]).flatMap((t) => (best[t] ? [best[t] as { p: number; points: number }] : []))
  m.envido.result = { winner, points: pts, sung }
  for (const x of sung) say(s, `${s.players[x.p].name} tem ${x.points} de envido.`)
  addPoints(s, winner, pts, 'envido', events)
}

function resolveContraflor(s: TrucoState, m: Mesa, quero: boolean, events: Ev): void {
  const stage = m.flor.stage as { team: Team }
  m.flor.stage = null
  const callers = other(stage.team)
  if (!quero) {
    const n = m.flor.holders.filter((p) => teamOf(p) === callers).length
    m.flor.result = `${teamName(s, callers)}: contra-flor não querida`
    return addPoints(s, callers, FLOR_POINTS * n, 'contra-flor não querida', events)
  }
  const best = bestByTeam(m, (p) => (m.flor.holders.includes(p) ? florPoints(s.dealt[p]) : null))
  const winner = duelWinner(m, best)
  for (const t of [0, 1] as Team[]) {
    const b = best[t]
    if (b) say(s, `${s.players[b.p].name} tem ${b.points} de flor.`)
  }
  m.flor.result = `${teamName(s, winner)}: contra-flor`
  addPoints(s, winner, CONTRAFLOR_POINTS, 'contra-flor', events)
}

// ---------- contrato ----------
export function parseOptions(raw: unknown): TrucoOptions | GameError {
  if (raw === undefined || raw === null) return { ...DEFAULT_TRUCO_OPTIONS }
  if (typeof raw !== 'object' || Array.isArray(raw)) return err('acao-invalida', 'Opções inválidas.')
  const players = (raw as Record<string, unknown>).players ?? DEFAULT_TRUCO_OPTIONS.players
  if (!(TRUCO_PLAYERS as readonly unknown[]).includes(players)) return err('acao-invalida', 'Escolha 1x1, 2x2 ou 3x3.')
  return { players: players as TrucoPlayers }
}

const isRef = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0

export function parseAction(raw: unknown): TrucoAction | GameError {
  if (typeof raw !== 'object' || raw === null) return err('acao-invalida', 'Ação inválida.')
  const a = raw as Record<string, unknown>
  if (!isRef(a.ref)) return err('acao-invalida', 'Ação inválida.')
  switch (a.type) {
    case 'play':
      return typeof a.card === 'string' && DECK.includes(a.card) ? { type: 'play', card: a.card, ref: a.ref } : err('acao-invalida', 'Carta inválida.')
    case 'envido':
      return a.kind === 'envido' || a.kind === 'real' || a.kind === 'falta' ? { type: 'envido', kind: a.kind, ref: a.ref } : err('acao-invalida', 'Envido inválido.')
    case 'truco':
    case 'quero':
    case 'naoquero':
    case 'contraflor':
    case 'mazo':
      return { type: a.type, ref: a.ref }
    default:
      return err('acao-invalida', 'Ação desconhecida.')
  }
}

export function setup(players: PlayerRef[], options: TrucoOptions, ctx: GameCtx): S {
  const s: TrucoState = {
    options,
    players: players.map((p) => ({ playerId: p.playerId, name: p.name, away: false })),
    score: [0, 0],
    // sorteia quem dá as cartas; quem é mão é o seguinte
    dealer: ctx.rng.int(players.length),
    hand: 0,
    testa: false,
    lastTesta: false,
    cards: {},
    dealt: {},
    mesas: [],
    phase: 'jogando',
    until: null,
    log: [],
    winner: null
  }
  const events: Ev = []
  startHand(s, ctx.now, ctx.rng, events)
  return { state: s, events }
}

/** Faz a ação de `p` (já validada a vez). Usado pela pessoa e pelo prazo estourado. */
function act(s: TrucoState, m: Mesa, p: number, action: TrucoAction, now: number, events: Ev): GameError | null {
  const can = canOf(s, p)
  if (!can) return err('acao-invalida', 'Agora não dá.')
  const t = teamOf(p)
  const a = actor(m) as Actor
  const name = s.players[p].name
  switch (action.type) {
    case 'play':
      if (!can.play) return err('nao-e-sua-vez', 'Espere a sua vez.')
      if (!s.cards[p].includes(action.card)) return err('acao-invalida', 'Essa carta não está na sua mão.')
      playCard(s, m, p, action.card, now, events)
      break
    case 'truco': {
      if (can.truco === null) return err('acao-invalida', 'Agora não dá para trucar.')
      const level = can.truco
      if (a.kind === 'truco') {
        // aumentar = aceitar o anterior e pedir o próximo
        m.truco.level = level - 1
        m.envido.open = false
      }
      m.truco.pending = { by: t, level }
      const call = level === 2 ? 'truco' : level === 3 ? 'retruco' : 'vale4'
      events.push({ type: 'call', mesa: m.id, p, call })
      say(s, `${name}: ${trucoName(level)}!`)
      break
    }
    case 'envido':
      if (!can.envido.includes(action.kind)) return err('acao-invalida', 'Agora não dá para cantar isso.')
      m.envido.calls.push(action.kind)
      m.envido.by = t
      m.envido.pending = true
      events.push({ type: 'call', mesa: m.id, p, call: action.kind })
      say(s, `${name}: ${envidoName(action.kind)}!`)
      break
    case 'quero':
    case 'naoquero': {
      const quero = action.type === 'quero'
      if (quero ? !can.quero : !can.naoquero) return err('acao-invalida', 'Não há nada para responder.')
      events.push({ type: 'answer', mesa: m.id, p, quero })
      if (a.kind === 'flor') {
        // não cantar contra-flor: cada time leva a sua flor
        say(s, `${name}: só a flor.`)
        m.flor.stage = null
        m.flor.result = 'cada time com a sua flor'
        for (const team of [0, 1] as Team[]) {
          const n = m.flor.holders.filter((x) => teamOf(x) === team).length
          addPoints(s, team, FLOR_POINTS * n, 'flor', events)
        }
        break
      }
      say(s, `${name}: ${quero ? 'Quero' : 'Não quero'}.`)
      if (a.kind === 'contraflor') resolveContraflor(s, m, quero, events)
      else if (a.kind === 'envido') resolveEnvido(s, m, quero, events)
      else if (a.kind === 'truco') {
        const pend = m.truco.pending as { by: Team; level: number }
        if (quero) {
          m.truco.level = pend.level
          m.truco.owner = t
          m.truco.pending = null
          m.envido.open = false
        } else {
          m.truco.pending = null
          finishMesa(s, m, pend.by, pend.level - 1, `${trucoName(pend.level).toLowerCase()} não querido`, now, events)
        }
      }
      break
    }
    case 'contraflor':
      if (!can.contraflor) return err('acao-invalida', 'Agora não dá para cantar contra-flor.')
      m.flor.stage = { kind: 'answer', team: other(t) }
      events.push({ type: 'call', mesa: m.id, p, call: 'contraflor' })
      say(s, `${name}: Contra-flor!`)
      break
    case 'mazo':
      if (!can.mazo) return err('acao-invalida', 'Agora não dá para ir ao baralho.')
      events.push({ type: 'mazo', mesa: m.id, p })
      say(s, `${name} foi ao baralho.`)
      m.truco.pending = null
      finishMesa(s, m, other(t), m.truco.level, 'foram ao baralho', now, events)
      break
  }
  m.ref++
  arm(s, m, now)
  refreshUntil(s)
  return null
}

export function apply(state: TrucoState, playerId: string, action: TrucoAction, ctx: GameCtx): S | GameError {
  if (state.phase === 'fim') return err('partida-encerrada', 'A partida acabou.')
  const p = state.players.findIndex((x) => x.playerId === playerId)
  if (p < 0) return err('nao-e-sua-vez', 'Você não está jogando.')
  if (state.phase !== 'jogando') return err('acao-invalida', 'Espere as cartas.')
  const sm = mesaOf(state, p)
  if (!sm || sm.winner !== null) return err('acao-invalida', 'Sua mão já acabou. Espere os outros.')
  if (action.ref !== sm.ref) return err('acao-invalida', 'A mesa mudou. Tente de novo.')
  const s = clone(state)
  const events: Ev = []
  const e = act(s, mesaOf(s, p) as Mesa, p, action, ctx.now, events)
  return e ?? { state: s, events }
}

/** a carta mais fraca (prazo estourado) */
const weakest = (cards: Card[]): Card => [...cards].sort((a, b) => power(a) - power(b))[0]

export function tick(state: TrucoState, ctx: GameCtx): S {
  if (state.phase === 'fim') return { state, events: [] }
  const s = clone(state)
  const events: Ev = []
  if (s.phase === 'intervalo') {
    if (s.until === null || ctx.now < s.until) return { state, events: [] }
    s.dealer = (s.dealer + 1) % s.players.length
    startHand(s, ctx.now, ctx.rng, events)
    return { state: s, events }
  }
  let changed = false
  for (const m of s.mesas) {
    if (s.phase !== 'jogando' || m.until === null || ctx.now < m.until) continue
    const a = actor(m)
    if (!a) continue
    // prazo estourado: joga a carta mais fraca ou não quer
    const p = a.kind === 'play' ? a.player : (m.order.find((x) => teamOf(x) === a.team) as number)
    const action: TrucoAction = a.kind === 'play' ? { type: 'play', card: weakest(s.cards[p]), ref: m.ref } : { type: 'naoquero', ref: m.ref }
    if (!act(s, m, p, action, ctx.now, events)) changed = true
  }
  return changed ? { state: s, events } : { state, events: [] }
}

export const nextDeadline = (s: TrucoState): number | null => (s.phase === 'fim' ? null : s.until)

export function setPresence(state: TrucoState, playerId: string, present: boolean, ctx: GameCtx): S {
  const p = state.players.findIndex((x) => x.playerId === playerId)
  if (p < 0 || state.players[p].away === !present || state.phase === 'fim') return { state, events: [] }
  const s = clone(state)
  s.players[p].away = !present
  // saiu na vez dele: o prazo encurta
  const m = mesaOf(s, p)
  if (!present && m && s.phase === 'jogando' && m.until !== null) {
    const a = actor(m)
    const who = !a ? [] : a.kind === 'play' ? [a.player] : m.order.filter((x) => teamOf(x) === a.team)
    if (who.includes(p) && who.every((x) => s.players[x].away)) m.until = Math.min(m.until, ctx.now + AWAY_MS)
    refreshUntil(s)
  }
  return { state: s, events: [] }
}

function mesaView(m: Mesa): MesaView {
  const a = actor(m)
  return {
    id: m.id,
    order: [...m.order],
    mao: m.order[0],
    tricks: m.tricks.map((t) => ({ plays: t.plays.map((x) => ({ ...x })), result: t.result })),
    turn: a?.kind === 'play' ? a.player : null,
    answering: a && a.kind !== 'play' ? a.team : null,
    asking: a && a.kind !== 'play' ? a.kind : null,
    truco: { level: m.truco.level, pending: m.truco.pending?.level ?? null, owner: m.truco.owner },
    envido: { calls: [...m.envido.calls], result: m.envido.result ? clone(m.envido.result) : null },
    flor: { holders: [...m.flor.holders], result: m.flor.result },
    winner: m.winner,
    ref: m.ref,
    until: m.until
  }
}

export function view(s: TrucoState, playerId: string | null, now: number): TrucoView {
  const i = playerId ? s.players.findIndex((x) => x.playerId === playerId) : -1
  const me = i >= 0 ? i : null
  const myMesa = me !== null ? (mesaOf(s, me)?.id ?? null) : null
  return {
    you: me !== null ? { playerId: playerId as string, index: me, team: teamOf(me) } : null,
    players: s.players.map((p, k) => ({
      playerId: p.playerId,
      name: p.name,
      index: k,
      team: teamOf(k),
      away: p.away,
      cardsLeft: s.cards[k]?.length ?? 0,
      flor: s.mesas.some((m) => m.flor.holders.includes(k))
    })),
    mode: s.options.players,
    score: [s.score[0], s.score[1]],
    target: TARGET,
    dealer: s.dealer,
    hand: s.hand,
    testa: s.testa,
    mesas: s.mesas.map(mesaView),
    myCards: me !== null ? [...(s.cards[me] ?? [])] : [],
    myMesa,
    can: me !== null ? canOf(s, me) : null,
    phase: s.phase,
    until: s.until,
    serverNow: now,
    log: s.log.slice(-12),
    winner: s.winner
  }
}

export const isOver = (s: TrucoState): boolean => s.phase === 'fim'
