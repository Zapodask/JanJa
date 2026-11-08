/**
 * Motor do Magnata: uma pessoa por vez rola os dados, anda, compra, constrói e paga aluguel.
 * Funções puras (tempo e dados só via GameCtx). Nada é escondido: a visão é igual para todos.
 *
 * Para a partida andar rápido, toda vez tem prazo (`until`): estourou, o servidor joga sozinho
 * (rola os dados ou passa). Dívida que não cabe no caixa vende as cidades mais baratas sozinha.
 */
import { shuffle, type GameCtx, type GameError, type PlayerRef, type Step } from '../types'
import {
  BEACH_RENT,
  BEACHES,
  BOARD_SIZE,
  baseRent,
  buildCost,
  citiesOfSide,
  CORNER,
  GROUPS,
  invested,
  MAX_LEVEL,
  TILES,
  tilesOfGroup
} from './board'
import { CARDS } from './cards'
import {
  AWAY_MS,
  DECIDE_MS,
  DEFAULT_TYCOON_OPTIONS,
  FLY_FEE,
  JAM_FINE,
  JAM_TURNS,
  MAX_BUY_LEVEL,
  money,
  ROLL_MS,
  SALARY,
  START_CASH,
  TAKEOVER_MULT,
  TYCOON_MINUTES,
  type TycoonAction,
  type TycoonEndReason,
  type TycoonEvent,
  type TycoonMinutes,
  type TycoonOptions,
  type TycoonPending,
  type TycoonPhase,
  type TycoonResult,
  type TycoonView
} from './types'

export interface TycoonPlayer {
  playerId: string
  name: string
  cash: number
  position: number
  jam: number
  out: boolean
  away: boolean
}

export interface TycoonState {
  options: TycoonOptions
  /** na ordem de jogo (sorteada) */
  players: TycoonPlayer[]
  props: Record<number, { owner: string; level: number }>
  festival: number | null
  /** índice em `players` de quem joga */
  turn: number
  phase: TycoonPhase
  until: number | null
  endsAt: number | null
  /** tirou dupla: rola de novo depois de resolver a casa */
  again: boolean
  /** duplas seguidas nesta vez (a terceira manda para o engarrafamento) */
  doubles: number
  dice: [number, number] | null
  rolls: number
  /** ordem das cartas (índices de CARDS) e a próxima a sair */
  deck: number[]
  deckPos: number
  log: string[]
  /** quem quebrou, na ordem */
  outOrder: string[]
  result: TycoonResult | null
}

type S = Step<TycoonState, TycoonEvent>
type Ev = TycoonEvent[]

const LOG_MAX = 40
const err = (error: GameError['error'], message: string): GameError => ({ error, message })
const clone = <T>(x: T): T => structuredClone(x)
const round10 = (x: number): number => Math.round(x / 10) * 10

// ---------- consultas ----------
const cur = (s: TycoonState): TycoonPlayer => s.players[s.turn]
const byId = (s: TycoonState, id: string): TycoonPlayer | undefined => s.players.find((p) => p.playerId === id)
const active = (s: TycoonState): TycoonPlayer[] => s.players.filter((p) => !p.out)
const owned = (s: TycoonState, id: string): number[] =>
  Object.entries(s.props)
    .filter(([, v]) => v.owner === id)
    .map(([k]) => Number(k))

export const worth = (s: TycoonState, id: string): number =>
  (byId(s, id)?.cash ?? 0) + owned(s, id).reduce((a, t) => a + invested(t, s.props[t].level), 0)

const groupComplete = (s: TycoonState, id: string, g: number): boolean => tilesOfGroup(g).every((t) => s.props[t]?.owner === id)

export function rentOf(s: TycoonState, tile: number): number {
  const prop = s.props[tile]
  if (!prop) return 0
  if (TILES[tile].kind === 'beach') return BEACH_RENT[BEACHES.filter((b) => s.props[b]?.owner === prop.owner).length]
  let r = baseRent(tile, prop.level)
  if (groupComplete(s, prop.owner, TILES[tile].group as number)) r *= 2
  if (s.festival === tile) r *= 2
  return r
}

const takeoverPrice = (s: TycoonState, tile: number): number => TAKEOVER_MULT * invested(tile, s.props[tile].level)

function say(s: TycoonState, text: string): void {
  s.log.push(text)
  if (s.log.length > LOG_MAX) s.log.splice(0, s.log.length - LOG_MAX)
}

function setPhase(s: TycoonState, phase: TycoonPhase, now: number): void {
  s.phase = phase
  const ms = phase.kind === 'rolar' ? ROLL_MS : DECIDE_MS
  s.until = now + (cur(s).away ? Math.min(ms, AWAY_MS) : ms)
}

// ---------- fim ----------
function ranking(s: TycoonState): TycoonResult['ranking'] {
  const alive = active(s)
    .map((p) => ({ playerId: p.playerId, worth: worth(s, p.playerId) }))
    .sort((a, b) => b.worth - a.worth)
  const gone = [...s.outOrder].reverse().map((id) => ({ playerId: id, worth: 0 }))
  const all = [...alive, ...gone]
  return all.map((r, i) => ({ ...r, place: i < alive.length ? alive.findIndex((x) => x.worth === r.worth) + 1 : i + 1 }))
}

function endGame(s: TycoonState, winner: string | null, reason: TycoonEndReason, events: Ev): void {
  s.phase = { kind: 'fim' }
  s.until = null
  s.result = { winner, reason, ranking: ranking(s) }
  events.push({ type: 'end', result: s.result })
}

/** Vitória na hora: três grupos, um lado inteiro ou as quatro praias. */
function checkWin(s: TycoonState, id: string, events: Ev): boolean {
  const groups = GROUPS.filter((_, g) => groupComplete(s, id, g)).length
  if (groups >= 3) return endGame(s, id, 'grupos', events), true
  if ([0, 1, 2, 3].some((side) => citiesOfSide(side).every((t) => s.props[t]?.owner === id))) return endGame(s, id, 'lado', events), true
  if (BEACHES.every((b) => s.props[b]?.owner === id)) return endGame(s, id, 'praias', events), true
  return false
}

// ---------- dinheiro ----------
function release(s: TycoonState, tile: number): void {
  delete s.props[tile]
  if (s.festival === tile) s.festival = null
}

/** Vende as cidades mais baratas (pela metade do investido) até o caixa cobrir `need`. */
function liquidate(s: TycoonState, p: TycoonPlayer, need: number, events: Ev): void {
  const tiles = owned(s, p.playerId).sort((a, b) => invested(a, s.props[a].level) - invested(b, s.props[b].level))
  for (const t of tiles) {
    if (p.cash >= need) return
    const amount = round10(invested(t, s.props[t].level) / 2)
    release(s, t)
    p.cash += amount
    events.push({ type: 'sell', playerId: p.playerId, tile: t, amount })
    say(s, `${p.name} vendeu ${TILES[t].name} ao banco por ${money(amount)}.`)
  }
}

function bankrupt(s: TycoonState, p: TycoonPlayer, creditor: TycoonPlayer | null, events: Ev): void {
  for (const t of owned(s, p.playerId)) release(s, t)
  if (creditor) creditor.cash += p.cash
  p.cash = 0
  p.out = true
  p.jam = 0
  s.outOrder.push(p.playerId)
  events.push({ type: 'bankrupt', playerId: p.playerId })
  say(s, `${p.name} quebrou e saiu da partida.`)
}

/** Paga (vendendo o que precisar). Devolve false se quebrou. */
function pay(
  s: TycoonState,
  p: TycoonPlayer,
  to: TycoonPlayer | null,
  amount: number,
  why: Extract<TycoonEvent, { type: 'pay' }>['why'],
  events: Ev
): boolean {
  if (amount <= 0 || p.out) return !p.out
  if (p.cash < amount) liquidate(s, p, amount, events)
  if (p.cash < amount) {
    bankrupt(s, p, to, events)
    return false
  }
  p.cash -= amount
  if (to) to.cash += amount
  events.push({ type: 'pay', from: p.playerId, to: to?.playerId ?? null, amount, why })
  return true
}

function earn(p: TycoonPlayer, amount: number): void {
  p.cash += amount
}

// ---------- vez ----------
function nextTurn(s: TycoonState, now: number): void {
  s.again = false
  s.doubles = 0
  for (let k = 1; k <= s.players.length; k++) {
    const i = (s.turn + k) % s.players.length
    if (!s.players[i].out) {
      s.turn = i
      break
    }
  }
  setPhase(s, { kind: 'rolar' }, now)
}

/** Terminou de resolver a casa: rola de novo (dupla) ou passa a vez. */
function endMove(s: TycoonState, now: number, events: Ev): void {
  if (s.result) return
  const alive = active(s)
  if (alive.length <= 1) return endGame(s, alive[0]?.playerId ?? null, 'falencia', events)
  const p = cur(s)
  if (!p.out && s.again && p.jam === 0) setPhase(s, { kind: 'rolar' }, now)
  else nextTurn(s, now)
}

function sendToJam(s: TycoonState, p: TycoonPlayer, events: Ev): void {
  const from = p.position
  p.position = CORNER.jam
  p.jam = JAM_TURNS
  s.again = false
  if (from !== CORNER.jam) events.push({ type: 'move', playerId: p.playerId, from, to: CORNER.jam, walk: false })
  events.push({ type: 'jam', playerId: p.playerId })
  say(s, `${p.name} ficou preso no engarrafamento.`)
}

function salary(s: TycoonState, p: TycoonPlayer, events: Ev): void {
  earn(p, SALARY)
  say(s, `${p.name} passou pela Partida e recebeu ${money(SALARY)}.`)
  events.push({ type: 'salary', playerId: p.playerId, amount: SALARY })
}

/** Anda `steps` casas (para a frente ou para trás) e resolve onde parou. */
function walk(s: TycoonState, p: TycoonPlayer, steps: number, now: number, events: Ev): void {
  const from = p.position
  const to = (((from + steps) % BOARD_SIZE) + BOARD_SIZE) % BOARD_SIZE
  p.position = to
  events.push({ type: 'move', playerId: p.playerId, from, to, walk: true })
  if (steps > 0 && from + steps >= BOARD_SIZE) salary(s, p, events)
  land(s, p, now, events)
}

/** Vai direto para `to` (carta ou avião), sempre para a frente: passou pela Partida, recebe. */
function jump(s: TycoonState, p: TycoonPlayer, to: number, now: number, events: Ev): void {
  const from = p.position
  p.position = to
  events.push({ type: 'move', playerId: p.playerId, from, to, walk: false })
  if (to <= from) salary(s, p, events)
  land(s, p, now, events)
}

function land(s: TycoonState, p: TycoonPlayer, now: number, events: Ev): void {
  const t = p.position
  const tile = TILES[t]
  switch (tile.kind) {
    case 'start':
      return endMove(s, now, events)
    case 'surprise':
      return drawCard(s, p, now, events)
    case 'jam':
      sendToJam(s, p, events)
      return endMove(s, now, events)
    case 'festival':
      if (owned(s, p.playerId).some((x) => TILES[x].kind === 'city')) return setPhase(s, { kind: 'festival' }, now)
      say(s, `${p.name} chegou no Festival, mas não tem cidade para receber a festa.`)
      return endMove(s, now, events)
    case 'airport':
      if (p.cash >= FLY_FEE) return setPhase(s, { kind: 'voar' }, now)
      return endMove(s, now, events)
    case 'tax': {
      const amount = Math.max(50, round10(worth(s, p.playerId) * 0.1))
      say(s, `${p.name} pagou ${money(amount)} de imposto.`)
      pay(s, p, null, amount, 'imposto', events)
      return endMove(s, now, events)
    }
    case 'city':
    case 'beach': {
      const prop = s.props[t]
      if (!prop) {
        if (p.cash >= (tile.price as number)) return setPhase(s, { kind: 'comprar', tile: t }, now)
        say(s, `${p.name} não tem dinheiro para comprar ${tile.name}.`)
        return endMove(s, now, events)
      }
      if (prop.owner === p.playerId) {
        if (tile.kind === 'city' && prop.level < MAX_LEVEL && p.cash >= buildCost(t, prop.level, prop.level + 1)) {
          return setPhase(s, { kind: 'construir', tile: t }, now)
        }
        return endMove(s, now, events)
      }
      const owner = byId(s, prop.owner) as TycoonPlayer
      const rent = rentOf(s, t)
      say(s, `${p.name} pagou ${money(rent)} de aluguel para ${owner.name} em ${tile.name}.`)
      if (!pay(s, p, owner, rent, 'aluguel', events)) return endMove(s, now, events)
      if (tile.kind === 'city' && prop.level < MAX_LEVEL && p.cash >= takeoverPrice(s, t)) return setPhase(s, { kind: 'tomar', tile: t }, now)
      return endMove(s, now, events)
    }
  }
}

function drawCard(s: TycoonState, p: TycoonPlayer, now: number, events: Ev): void {
  const card = CARDS[s.deck[s.deckPos % s.deck.length]]
  s.deckPos = (s.deckPos + 1) % s.deck.length
  events.push({ type: 'card', playerId: p.playerId, text: card.text })
  say(s, `${p.name} tirou Surpresa: ${card.text}`)
  const others = () => active(s).filter((x) => x !== p)
  switch (card.id) {
    case 'rifa':
      earn(p, 100)
      break
    case 'restituicao':
      earn(p, 150)
      break
    case 'multa':
      pay(s, p, null, 50, 'carta', events)
      break
    case 'aniversario':
      for (const o of others()) pay(s, o, p, 20, 'carta', events)
      break
    case 'pizza':
      for (const o of others()) if (!pay(s, p, o, 25, 'carta', events)) break
      break
    case 'reforma': {
      const levels = owned(s, p.playerId).reduce((a, t) => a + s.props[t].level, 0)
      pay(s, p, null, 25 * levels, 'carta', events)
      break
    }
    case 'partida':
      return jump(s, p, CORNER.start, now, events)
    case 'aeroporto':
      return jump(s, p, CORNER.airport, now, events)
    case 'festival':
      return jump(s, p, CORNER.festival, now, events)
    case 'engarrafamento':
      sendToJam(s, p, events)
      break
    case 'volta3':
      return walk(s, p, -3, now, events)
    case 'praia': {
      const next = BEACHES.find((b) => b > p.position) ?? BEACHES[0]
      return jump(s, p, next, now, events)
    }
  }
  endMove(s, now, events)
}

// ---------- ações ----------
function roll(s: TycoonState, payFine: boolean, ctx: GameCtx, events: Ev): void {
  const p = cur(s)
  if (p.jam > 0 && payFine) {
    say(s, `${p.name} pagou ${money(JAM_FINE)} para sair do engarrafamento.`)
    if (!pay(s, p, null, JAM_FINE, 'multa', events)) return endMove(s, ctx.now, events)
    p.jam = 0
  }
  const dice: [number, number] = [ctx.rng.int(6) + 1, ctx.rng.int(6) + 1]
  const double = dice[0] === dice[1]
  const sum = dice[0] + dice[1]
  s.dice = dice
  s.rolls++
  events.push({ type: 'roll', playerId: p.playerId, dice })
  say(s, `${p.name} tirou ${dice[0]} e ${dice[1]}${double ? ' (dupla)' : ''}.`)
  if (p.jam > 0) {
    s.again = false
    if (double) {
      p.jam = 0
      say(s, `${p.name} saiu do engarrafamento com a dupla.`)
      return walk(s, p, sum, ctx.now, events)
    }
    p.jam--
    if (p.jam > 0) return endMove(s, ctx.now, events)
    // terceira tentativa sem dupla: paga a multa e anda
    say(s, `${p.name} pagou ${money(JAM_FINE)} e saiu do engarrafamento.`)
    if (!pay(s, p, null, JAM_FINE, 'multa', events)) return endMove(s, ctx.now, events)
    return walk(s, p, sum, ctx.now, events)
  }
  if (double) {
    s.doubles++
    if (s.doubles >= 3) {
      say(s, `${p.name} tirou três duplas seguidas.`)
      sendToJam(s, p, events)
      return endMove(s, ctx.now, events)
    }
  }
  s.again = double
  walk(s, p, sum, ctx.now, events)
}

const levelOptions = (tile: number, from: number, max: number, base: number, cash: number) =>
  Array.from({ length: max - from }, (_, k) => from + 1 + k)
    .map((level) => ({ level, cost: base + buildCost(tile, from, level) }))
    .filter((o) => o.cost <= cash)

export function parseOptions(raw: unknown): TycoonOptions | GameError {
  if (raw === undefined || raw === null) return { ...DEFAULT_TYCOON_OPTIONS }
  if (typeof raw !== 'object' || Array.isArray(raw)) return err('acao-invalida', 'Opções inválidas.')
  const minutes = (raw as Record<string, unknown>).minutes ?? DEFAULT_TYCOON_OPTIONS.minutes
  if (!(TYCOON_MINUTES as readonly unknown[]).includes(minutes)) return err('acao-invalida', 'Duração inválida.')
  return { minutes: minutes as TycoonMinutes }
}

const isTile = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < BOARD_SIZE
const isLevel = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= MAX_LEVEL

export function parseAction(raw: unknown): TycoonAction | GameError {
  if (typeof raw !== 'object' || raw === null) return err('acao-invalida', 'Ação inválida.')
  const a = raw as Record<string, unknown>
  switch (a.type) {
    case 'roll':
      return { type: 'roll', ...(a.pay === true ? { pay: true } : {}) }
    case 'buy':
    case 'build':
      return isLevel(a.level) ? { type: a.type, level: a.level } : err('acao-invalida', 'Nível inválido.')
    case 'festival':
    case 'fly':
      return isTile(a.tile) ? { type: a.type, tile: a.tile } : err('acao-invalida', 'Casa inválida.')
    case 'takeover':
    case 'pass':
      return { type: a.type }
    default:
      return err('acao-invalida', 'Ação desconhecida.')
  }
}

export function setup(players: PlayerRef[], options: TycoonOptions, ctx: GameCtx): S {
  const order = shuffle(players, ctx.rng)
  const s: TycoonState = {
    options,
    players: order.map((p) => ({ playerId: p.playerId, name: p.name, cash: START_CASH, position: 0, jam: 0, out: false, away: false })),
    props: {},
    festival: null,
    turn: 0,
    phase: { kind: 'rolar' },
    until: null,
    endsAt: options.minutes ? ctx.now + options.minutes * 60_000 : null,
    again: false,
    doubles: 0,
    dice: null,
    rolls: 0,
    deck: shuffle(
      CARDS.map((_, i) => i),
      ctx.rng
    ),
    deckPos: 0,
    log: [],
    outOrder: [],
    result: null
  }
  say(s, `${order[0].name} começa.`)
  setPhase(s, { kind: 'rolar' }, ctx.now)
  return { state: s, events: [{ type: 'start', order: order.map((p) => p.playerId) }] }
}

export function apply(state: TycoonState, playerId: string, action: TycoonAction, ctx: GameCtx): S | GameError {
  if (state.result) return err('partida-encerrada', 'A partida acabou.')
  if (!byId(state, playerId) || byId(state, playerId)?.out) return err('nao-e-sua-vez', 'Você não está jogando.')
  if (cur(state).playerId !== playerId) return err('nao-e-sua-vez', 'Espere a sua vez.')
  const s = clone(state)
  const events: Ev = []
  const p = cur(s)
  const ph = s.phase
  const now = ctx.now

  if (action.type === 'pass') {
    if (ph.kind === 'rolar' || ph.kind === 'fim') return err('acao-invalida', 'Role os dados.')
    endMove(s, now, events)
    return { state: s, events }
  }
  switch (ph.kind) {
    case 'rolar':
      if (action.type !== 'roll') return err('acao-invalida', 'Role os dados.')
      if (action.pay && (p.jam === 0 || p.cash < JAM_FINE)) return err('acao-invalida', 'Não dá para pagar a multa agora.')
      roll(s, !!action.pay, ctx, events)
      break
    case 'comprar': {
      if (action.type !== 'buy') return err('acao-invalida', 'Compre ou passe.')
      const t = ph.tile
      const max = TILES[t].kind === 'city' ? MAX_BUY_LEVEL : 0
      if (action.level > max) return err('acao-invalida', 'Nível alto demais para a compra.')
      const cost = (TILES[t].price as number) + (TILES[t].kind === 'city' ? buildCost(t, 0, action.level) : 0)
      if (cost > p.cash) return err('acao-invalida', 'Dinheiro não dá.')
      p.cash -= cost
      s.props[t] = { owner: p.playerId, level: action.level }
      events.push({ type: 'buy', playerId: p.playerId, tile: t, level: action.level })
      say(s, `${p.name} comprou ${TILES[t].name}${action.level ? ` com ${levelName(action.level)}` : ''} por ${money(cost)}.`)
      if (!checkWin(s, p.playerId, events)) endMove(s, now, events)
      break
    }
    case 'construir': {
      if (action.type !== 'build') return err('acao-invalida', 'Construa ou passe.')
      const t = ph.tile
      const from = s.props[t].level
      if (action.level <= from) return err('acao-invalida', 'Escolha um nível maior.')
      const cost = buildCost(t, from, action.level)
      if (cost > p.cash) return err('acao-invalida', 'Dinheiro não dá.')
      p.cash -= cost
      s.props[t].level = action.level
      events.push({ type: 'build', playerId: p.playerId, tile: t, level: action.level })
      say(s, `${p.name} construiu ${levelName(action.level)} em ${TILES[t].name} por ${money(cost)}.`)
      endMove(s, now, events)
      break
    }
    case 'tomar': {
      if (action.type !== 'takeover') return err('acao-invalida', 'Compre ou passe.')
      const t = ph.tile
      const price = takeoverPrice(s, t)
      const owner = byId(s, s.props[t].owner) as TycoonPlayer
      if (price > p.cash) return err('acao-invalida', 'Dinheiro não dá.')
      p.cash -= price
      owner.cash += price
      s.props[t].owner = p.playerId
      events.push({ type: 'takeover', playerId: p.playerId, from: owner.playerId, tile: t, price })
      say(s, `${p.name} comprou ${TILES[t].name} de ${owner.name} por ${money(price)}.`)
      if (checkWin(s, p.playerId, events)) break
      const lvl = s.props[t].level
      if (lvl < MAX_LEVEL && p.cash >= buildCost(t, lvl, lvl + 1)) setPhase(s, { kind: 'construir', tile: t }, now)
      else endMove(s, now, events)
      break
    }
    case 'festival': {
      if (action.type !== 'festival') return err('acao-invalida', 'Escolha uma cidade sua.')
      if (s.props[action.tile]?.owner !== p.playerId || TILES[action.tile].kind !== 'city') return err('acao-invalida', 'Escolha uma cidade sua.')
      s.festival = action.tile
      events.push({ type: 'festival', tile: action.tile })
      say(s, `${p.name} levou o Festival para ${TILES[action.tile].name}: aluguel dobrado lá.`)
      endMove(s, now, events)
      break
    }
    case 'voar': {
      if (action.type !== 'fly') return err('acao-invalida', 'Escolha o destino ou fique.')
      if (action.tile === CORNER.airport) return err('acao-invalida', 'Escolha outra casa.')
      if (p.cash < FLY_FEE) return err('acao-invalida', 'Dinheiro não dá.')
      pay(s, p, null, FLY_FEE, 'voo', events)
      say(s, `${p.name} voou para ${TILES[action.tile].name}.`)
      jump(s, p, action.tile, now, events)
      break
    }
    default:
      return err('acao-invalida', 'Ação inválida agora.')
  }
  return { state: s, events }
}

export function levelName(level: number): string {
  return level === 0 ? 'o terreno' : level === MAX_LEVEL ? 'hotel' : level === 1 ? '1 casa' : `${level} casas`
}

export function tick(state: TycoonState, ctx: GameCtx): S {
  if (state.result) return { state, events: [] }
  if (state.endsAt !== null && ctx.now >= state.endsAt) {
    const s = clone(state)
    const events: Ev = []
    const best = ranking(s)[0]
    say(s, 'O tempo acabou.')
    endGame(s, best?.playerId ?? null, 'tempo', events)
    return { state: s, events }
  }
  if (state.until === null || ctx.now < state.until) return { state, events: [] }
  // prazo da vez estourou: o jogo joga por quem está na vez
  const auto: TycoonAction = state.phase.kind === 'rolar' ? { type: 'roll' } : { type: 'pass' }
  const r = apply(state, cur(state).playerId, auto, ctx)
  if ('error' in r) return { state, events: [] }
  return r
}

export function nextDeadline(s: TycoonState): number | null {
  if (s.result) return null
  const t = [s.until, s.endsAt].filter((x): x is number => x !== null)
  return t.length ? Math.min(...t) : null
}

export function setPresence(state: TycoonState, playerId: string, present: boolean, ctx: GameCtx): S {
  const p = byId(state, playerId)
  if (!p || p.away === !present || state.result) return { state, events: [] }
  const s = clone(state)
  const q = byId(s, playerId) as TycoonPlayer
  q.away = !present
  // saiu na vez dele: o jogo joga por ele logo
  if (!present && cur(s) === q && s.until !== null) s.until = Math.min(s.until, ctx.now + AWAY_MS)
  return { state: s, events: [] }
}

function pending(s: TycoonState): TycoonPending | null {
  if (s.result) return null
  const p = cur(s)
  const ph = s.phase
  switch (ph.kind) {
    case 'rolar':
      return { kind: 'rolar', jammed: p.jam > 0, fine: JAM_FINE }
    case 'comprar': {
      const max = TILES[ph.tile].kind === 'city' ? MAX_BUY_LEVEL : 0
      const price = TILES[ph.tile].price as number
      return { kind: 'comprar', tile: ph.tile, options: [{ level: 0, cost: price }, ...levelOptions(ph.tile, 0, max, price, p.cash)] }
    }
    case 'construir': {
      const from = s.props[ph.tile].level
      return { kind: 'construir', tile: ph.tile, from, options: levelOptions(ph.tile, from, MAX_LEVEL, 0, p.cash) }
    }
    case 'tomar':
      return { kind: 'tomar', tile: ph.tile, price: takeoverPrice(s, ph.tile), owner: s.props[ph.tile].owner }
    case 'festival':
      return { kind: 'festival', tiles: owned(s, p.playerId).filter((t) => TILES[t].kind === 'city') }
    case 'voar':
      return { kind: 'voar', fee: FLY_FEE, tiles: TILES.map((_, i) => i).filter((i) => i !== CORNER.airport) }
    default:
      return null
  }
}

export function view(s: TycoonState, playerId: string | null, now: number): TycoonView {
  const me = playerId && byId(s, playerId) ? { playerId } : null
  return {
    you: me,
    players: s.players.map((p) => ({
      playerId: p.playerId,
      name: p.name,
      cash: p.cash,
      worth: p.out ? 0 : worth(s, p.playerId),
      position: p.position,
      jam: p.jam,
      out: p.out,
      away: p.away
    })),
    props: clone(s.props),
    rents: Object.fromEntries(Object.keys(s.props).map((k) => [k, rentOf(s, Number(k))])),
    festival: s.festival,
    turn: s.result ? null : cur(s).playerId,
    pending: pending(s),
    until: s.until,
    endsAt: s.endsAt,
    serverNow: now,
    dice: s.dice,
    rolls: s.rolls,
    log: s.log.slice(-12),
    result: s.result ? clone(s.result) : null
  }
}

export const isOver = (s: TycoonState): boolean => s.result !== null
