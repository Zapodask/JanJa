/**
 * Motor do Poker facilitado (Hold'em limit 2..8 jogadores e modo 3 cartas).
 * Funções puras: tempo e sorteio só via GameCtx. O estado é JSON puro (sem classes/funções);
 * contém o baralho e as cartas fechadas, por isso NUNCA vai para clientes: use `view`.
 */
import { fullDeck } from './cards'
import { bestHand, dePessoa, drawHints, handNameWithArticle, isOnTable, tieBreak, toHandInfo } from './describe'
import { evaluate, evaluate3, type Evaluated } from './evaluate'
import { shuffle, type GameCtx, type GameError, type PlayerRef, type Step } from '../types'
import {
  DEFAULT_OPTIONS,
  TABLE,
  type BuyMode,
  type Card,
  type HandInfo,
  type LegalAction,
  type Phase,
  type PokerAction,
  type PokerEvent,
  type PokerMode,
  type PokerOptions,
  type PokerView,
  type PotView,
  type RankingEntry,
  type SeatStatus,
  type SeatView,
  type ShowdownView,
  type Street
} from './types'

// ---------- estado interno (JSON puro) ----------
export interface PokerSeatState {
  playerId: string
  name: string
  stack: number
  rebuys: number
  status: SeatStatus
  present: boolean
  /** quando caiu (ms epoch); null se presente */
  awaySince: number | null
  hole: Card[]
  /** aposta na rodada atual */
  bet: number
  /** total colocado na mão (antes + rodada atual) */
  contrib: number
  /** já agiu desde a última aposta/aumento completo */
  acted: boolean
  /** cartas reveladas (showdown) */
  shown: boolean
  lastAction: SeatView['lastAction']
}

export interface PokerState {
  options: PokerOptions
  players: PokerSeatState[]
  handNo: number
  phase: Phase
  /** índices em `players` (-1 = nenhum) */
  dealer: number
  sb: number
  bb: number
  /** segredo: nunca sai em view */
  deck: Card[]
  board: Card[]
  /** valor a igualar na rodada */
  currentBet: number
  /** apostas+aumentos completos já feitos na rodada (no pré-flop o BB conta como a 1ª) */
  betCount: number
  actor: number
  actDeadline: number | null
  /** quando começa a próxima mão; null = esperando gente voltar (ou partida acabou) */
  nextHandAt: number | null
  endsAt: number | null
  showdown: ShowdownView | null
  ranking: RankingEntry[] | null
}

type Ev = PokerEvent[]
const err = (error: GameError['error'], message: string): GameError => ({ error, message })

// ---------- opções e ações ----------
export function parseOptions(raw: unknown): PokerOptions | GameError {
  if (raw === undefined || raw === null) return { ...DEFAULT_OPTIONS }
  if (typeof raw !== 'object' || Array.isArray(raw)) return err('acao-invalida', 'Opções inválidas.')
  const o = raw as Record<string, unknown>
  const mode = o.mode ?? DEFAULT_OPTIONS.mode
  const minutes = o.minutes ?? DEFAULT_OPTIONS.minutes
  const buy = o.buy ?? DEFAULT_OPTIONS.buy
  if (mode !== 'holdem' && mode !== 'tres') return err('acao-invalida', 'Modo inválido.')
  if (minutes !== 0 && minutes !== 15 && minutes !== 30 && minutes !== 45) return err('acao-invalida', 'Duração inválida.')
  if (buy !== 'recompra' && buy !== 'torneio') return err('acao-invalida', 'Tipo de entrada inválido.')
  return { mode: mode as PokerMode, minutes, buy: buy as BuyMode }
}

const ACTION_KINDS = ['check', 'call', 'raise', 'allin', 'fold'] as const
export function parseAction(raw: unknown): PokerAction | GameError {
  if (typeof raw !== 'object' || raw === null) return err('acao-invalida', 'Ação inválida.')
  const kind = (raw as { kind?: unknown }).kind
  if (typeof kind !== 'string' || !(ACTION_KINDS as readonly string[]).includes(kind)) return err('acao-invalida', 'Ação inválida.')
  return { kind } as PokerAction
}

// ---------- utilidades ----------
const inHand = (p: PokerSeatState): boolean => p.status === 'jogando' || p.status === 'allin'
const countInHand = (st: PokerState): number => st.players.filter(inHand).length
const countJogando = (st: PokerState): number => st.players.filter((p) => p.status === 'jogando').length
const isTres = (st: PokerState): boolean => st.options.mode === 'tres'
const capOf = (st: PokerState): number => (isTres(st) ? 3 : TABLE.capPerStreet)
const betSize = (st: PokerState): number =>
  isTres(st) ? TABLE.tresBet : st.phase === 'preflop' || st.phase === 'flop' ? TABLE.smallBet : TABLE.bigBet
const net = (p: PokerSeatState): number => p.stack - TABLE.startStack * (1 + p.rebuys)
const clone = <T,>(x: T): T => structuredClone(x)

function nextToAct(st: PokerState, from: number): number {
  const n = st.players.length
  const jog = countJogando(st)
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n
    const p = st.players[i]
    if (p.status !== 'jogando') continue
    if (p.bet < st.currentBet) return i
    // sem aposta para pagar: só precisa agir se ainda não agiu e houver alguém que possa responder
    if (!p.acted && jog >= 2) return i
  }
  return -1
}

export function legalActions(st: PokerState, idx: number): LegalAction[] {
  const p = st.players[idx]
  if (!p || p.status !== 'jogando') return []
  const toCall = st.currentBet - p.bet
  const size = betSize(st)
  const canRaise = !p.acted && st.betCount < capOf(st)
  const out: LegalAction[] = []
  if (toCall <= 0) {
    out.push({ kind: 'check' })
    if (canRaise) {
      if (p.stack >= size) out.push({ kind: 'raise', amount: size, to: st.currentBet + size })
      else out.push({ kind: 'allin', amount: p.stack })
    }
    return out
  }
  out.push({ kind: 'fold' })
  if (p.stack < toCall) {
    out.push({ kind: 'allin', amount: p.stack })
    return out
  }
  out.push({ kind: 'call', amount: toCall })
  if (canRaise) {
    const need = toCall + size
    if (p.stack >= need) out.push({ kind: 'raise', amount: need, to: st.currentBet + size })
    else if (p.stack > toCall) out.push({ kind: 'allin', amount: p.stack })
  }
  return out
}

/** Potes (principal + laterais) a partir do total colocado por cada um. Camadas iguais são unidas. */
export function buildPots(entries: { id: string; contrib: number; folded: boolean }[]): PotView[] {
  const levels = [...new Set(entries.map((e) => e.contrib).filter((c) => c > 0))].sort((a, b) => a - b)
  const pots: PotView[] = []
  let prev = 0
  for (const level of levels) {
    let amount = 0
    for (const e of entries) amount += Math.min(e.contrib, level) - Math.min(e.contrib, prev)
    const eligible = entries.filter((e) => !e.folded && e.contrib >= level).map((e) => e.id)
    prev = level
    if (amount <= 0) continue
    const last = pots[pots.length - 1]
    if (eligible.length === 0) {
      // dinheiro morto sem candidato: vai para o pote anterior
      if (last) last.amount += amount
      continue
    }
    if (last && last.eligible.length === eligible.length && last.eligible.every((x, i) => x === eligible[i])) last.amount += amount
    else pots.push({ amount, eligible })
  }
  return pots
}

// ---------- início de mão ----------
const isOk = (p: PokerSeatState, now: number): boolean =>
  p.present || (p.awaySince !== null && now - p.awaySince <= TABLE.awayGraceMs)

function setActor(st: PokerState, idx: number, ctx: GameCtx): void {
  st.actor = idx
  st.actDeadline = ctx.now + TABLE.actMs
}

/** Tenta começar uma mão. Se não houver 2 aptos, entra em espera. */
function startHand(st: PokerState, ctx: GameCtx, ev: Ev): void {
  const now = ctx.now
  const dealt: number[] = []
  const rebuy: number[] = []
  st.players.forEach((p, i) => {
    p.hole = []; p.bet = 0; p.contrib = 0; p.acted = false; p.shown = false; p.lastAction = null
    const ok = isOk(p, now)
    if (p.stack === 0) {
      if (st.options.buy === 'torneio') p.status = 'fora'
      else if (ok) { rebuy.push(i); dealt.push(i) }
      else p.status = 'zerado'
    } else if (ok) { p.status = 'jogando'; dealt.push(i) }
    else p.status = 'ausente'
  })
  st.board = []
  st.actor = -1
  st.actDeadline = null
  if (dealt.length < 2) {
    for (const i of rebuy) st.players[i].status = 'zerado'
    st.deck = []
    st.phase = 'intervalo'
    st.nextHandAt = null
    return
  }
  for (const i of rebuy) {
    const p = st.players[i]
    p.stack += TABLE.startStack
    p.rebuys++
    p.status = 'jogando'
    ev.push({ kind: 'rebuy', by: p.playerId, amount: TABLE.startStack })
  }
  const n = st.players.length
  st.handNo++
  st.nextHandAt = null
  st.showdown = null
  st.sb = -1
  st.bb = -1
  if (st.dealer < 0) st.dealer = dealt[ctx.rng.int(dealt.length)]
  else {
    for (let k = 1; k <= n; k++) {
      const i = (st.dealer + k) % n
      if (dealt.includes(i)) { st.dealer = i; break }
    }
  }
  st.deck = shuffle(fullDeck(), ctx.rng)
  st.phase = 'preflop'
  st.currentBet = 0
  st.betCount = 0
  ev.push({ kind: 'shuffle', handNo: st.handNo })

  const after = (from: number): number => {
    for (let k = 1; k <= n; k++) {
      const i = (from + k) % n
      if (dealt.includes(i)) return i
    }
    return from
  }
  const pay = (p: PokerSeatState, amount: number, asBet: boolean): number => {
    const a = Math.min(p.stack, amount)
    p.stack -= a
    p.contrib += a
    if (asBet) p.bet += a
    if (p.stack === 0) p.status = 'allin'
    return a
  }

  let cursor: number
  if (isTres(st)) {
    for (const i of dealt) {
      const p = st.players[i]
      const a = pay(p, TABLE.tresAnte, false)
      p.lastAction = { kind: 'ante', amount: a }
      ev.push({ kind: 'ante', by: p.playerId, amount: a })
    }
    cursor = st.dealer // primeiro a falar: à esquerda do botão
  } else {
    st.sb = dealt.length === 2 ? st.dealer : after(st.dealer)
    st.bb = after(st.sb)
    const sbP = st.players[st.sb]
    const bbP = st.players[st.bb]
    const a1 = pay(sbP, TABLE.smallBlind, true)
    sbP.lastAction = { kind: 'blind', amount: a1 }
    ev.push({ kind: 'blind', by: sbP.playerId, amount: a1 })
    const a2 = pay(bbP, TABLE.bigBlind, true)
    bbP.lastAction = { kind: 'blind', amount: a2 }
    ev.push({ kind: 'blind', by: bbP.playerId, amount: a2 })
    st.currentBet = TABLE.bigBlind
    st.betCount = 1
    cursor = st.bb
  }
  const per = isTres(st) ? 3 : 2
  for (const i of dealt) {
    const p = st.players[i]
    for (let k = 0; k < per; k++) p.hole.push(st.deck.pop() as Card)
  }
  ev.push({ kind: 'deal', to: dealt.map((i) => st.players[i].playerId), count: per })
  moveOn(st, ctx, ev, cursor)
}

// ---------- fluxo da mão ----------
function revealAll(st: PokerState, ev: Ev): void {
  for (const p of st.players) {
    if (inHand(p) && !p.shown) {
      p.shown = true
      ev.push({ kind: 'reveal', by: p.playerId, cards: [...p.hole] })
    }
  }
}

function closeStreet(st: PokerState): void {
  for (const p of st.players) {
    p.bet = 0
    p.acted = false
    if (p.status === 'jogando') p.lastAction = null
  }
  st.currentBet = 0
  st.betCount = 0
}

const NEXT_STREET: Record<Street, Street | null> = { preflop: 'flop', flop: 'turn', turn: 'river', river: null }

function moveOn(st: PokerState, ctx: GameCtx, ev: Ev, from: number): void {
  let cursor = from
  for (;;) {
    if (countInHand(st) <= 1) return endByFold(st, ctx, ev)
    const nxt = nextToAct(st, cursor)
    if (nxt >= 0) return setActor(st, nxt, ctx)
    // rodada fechada
    closeStreet(st)
    const street = st.phase as Street
    const next = isTres(st) ? null : NEXT_STREET[street]
    if (next === null) return showdown(st, ctx, ev)
    if (countJogando(st) <= 1) revealAll(st, ev) // ninguém mais pode apostar: mostra e distribui o resto
    const n = next === 'flop' ? 3 : 1
    const cards: Card[] = []
    for (let k = 0; k < n; k++) cards.push(st.deck.pop() as Card)
    st.board.push(...cards)
    st.phase = next
    ev.push({ kind: 'street', street: next, cards })
    cursor = st.dealer
  }
}

function endByFold(st: PokerState, ctx: GameCtx, ev: Ev): void {
  const winner = st.players.findIndex(inHand)
  const w = st.players[winner]
  let total = 0
  for (const p of st.players) { total += p.contrib; p.bet = 0 }
  w.stack += total
  ev.push({ kind: 'win', by: w.playerId, amount: total, potIndex: 0 })
  st.showdown = {
    winners: [{ playerId: w.playerId, amount: total, hand: null }],
    explanation: `${w.name} levou o pote (todos desistiram)`
  }
  finishHand(st, ctx, ev)
}

function handEval(st: PokerState, p: PokerSeatState): Evaluated {
  return isTres(st) ? evaluate3(p.hole) : evaluate([...p.hole, ...st.board])
}

function showdown(st: PokerState, ctx: GameCtx, ev: Ev): void {
  revealAll(st, ev)
  const n = st.players.length
  // devolve a parte não igualada da maior contribuição
  const sorted = st.players.map((p, i) => ({ i, c: p.contrib })).sort((a, b) => b.c - a.c)
  if (sorted.length >= 2 && sorted[0].c > sorted[1].c) {
    const extra = sorted[0].c - sorted[1].c
    const p = st.players[sorted[0].i]
    p.contrib -= extra
    p.stack += extra
  }
  for (const p of st.players) p.bet = 0
  const evs = new Map<number, Evaluated>()
  st.players.forEach((p, i) => { if (inHand(p)) evs.set(i, handEval(st, p)) })
  const idxById = new Map(st.players.map((p, i) => [p.playerId, i]))
  const pots = buildPots(st.players.map((p) => ({ id: p.playerId, contrib: p.contrib, folded: !inHand(p) })))

  const won = new Map<number, number>()
  const sentences: string[] = []
  pots.forEach((pot, potIndex) => {
    const elig = pot.eligible.map((id) => idxById.get(id) as number)
    let best = -1
    for (const i of elig) best = Math.max(best, (evs.get(i) as Evaluated).value)
    const winners = elig.filter((i) => (evs.get(i) as Evaluated).value === best)
    winners.sort((a, b) => ((a - st.dealer - 1 + n) % n) - ((b - st.dealer - 1 + n) % n))
    const share = Math.floor(pot.amount / winners.length)
    const rem = pot.amount - share * winners.length
    winners.forEach((i, k) => {
      const amount = share + (k < rem ? 1 : 0)
      if (amount > 0) {
        st.players[i].stack += amount
        won.set(i, (won.get(i) ?? 0) + amount)
        ev.push({ kind: 'win', by: st.players[i].playerId, amount, potIndex })
      }
    })
    const wEv = evs.get(winners[0]) as Evaluated
    const names = winners.map((i) => st.players[i].name)
    if (elig.length === 1) sentences.push(`${names[0]} levou o pote (ninguém mais disputava)`)
    else if (winners.length === 1) {
      const rest = elig.filter((i) => !winners.includes(i))
      let runner = rest[0]
      for (const i of rest) if ((evs.get(i) as Evaluated).value > (evs.get(runner) as Evaluated).value) runner = i
      const lEv = evs.get(runner) as Evaluated
      const rName = st.players[runner].name
      const tb = isTres(st) ? null : tieBreak(wEv, lEv)
      if (tb) {
        // mesmo nome de mão (ex.: par que está na mesa): explica o desempate em vez de "Par de 8 bateu Par de 8"
        const shared = isOnTable(wEv, st.players[winners[0]].hole) && isOnTable(lEv, st.players[runner].hole)
        sentences.push(
          `${names[0]} ganhou no desempate: ${names[0]} e ${rName} tinham ${toHandInfo(wEv).name}${shared ? ', que está na mesa' : ''}, e ${tb.rule} (${tb.win} contra ${tb.lose})`
        )
      } else {
        sentences.push(`${names[0]} ganhou com ${toHandInfo(wEv).name} (bateu ${handNameWithArticle(lEv)} ${dePessoa(rName)})`)
      }
    } else {
      const lista = names.length === 2 ? names.join(' e ') : `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`
      const boardOnly = !isTres(st) && st.board.length === 5 && evaluate(st.board).value === wEv.value
      sentences.push(`${lista} dividiram o pote com ${toHandInfo(wEv).name}${boardOnly ? ' (a melhor mão é a da mesa, vale para todos)' : ''}`)
    }
  })
  st.showdown = {
    winners: [...won.entries()].map(([i, amount]) => ({
      playerId: st.players[i].playerId,
      amount,
      hand: toHandInfo(evs.get(i) as Evaluated) as HandInfo
    })),
    explanation: sentences.join('. ')
  }
  finishHand(st, ctx, ev)
}

function shouldEnd(st: PokerState, now: number): boolean {
  if (st.endsAt !== null && now >= st.endsAt) return true
  if (st.options.buy === 'torneio' && st.players.filter((p) => p.stack > 0).length <= 1) return true
  return false
}

function rankingOf(st: PokerState): RankingEntry[] {
  return st.players
    .map((p, i) => ({ p, i }))
    .sort((a, b) => net(b.p) - net(a.p) || b.p.stack - a.p.stack || a.i - b.i)
    .map(({ p }, k) => ({ playerId: p.playerId, name: p.name, net: net(p), rebuys: p.rebuys, place: k + 1 }))
}

function finishGame(st: PokerState, ev: Ev): void {
  st.phase = 'fim'
  st.actor = -1
  st.actDeadline = null
  st.nextHandAt = null
  st.ranking = rankingOf(st)
  ev.push({ kind: 'end', ranking: st.ranking })
}

function finishHand(st: PokerState, ctx: GameCtx, ev: Ev): void {
  for (const p of st.players) {
    p.bet = 0
    p.contrib = 0
    if (p.stack === 0) p.status = st.options.buy === 'torneio' ? 'fora' : 'zerado'
  }
  st.actor = -1
  st.actDeadline = null
  st.currentBet = 0
  st.betCount = 0
  st.phase = 'intervalo'
  st.nextHandAt = ctx.now + TABLE.betweenHandsMs
  if (shouldEnd(st, ctx.now)) finishGame(st, ev)
}

// ---------- ações ----------
function perform(st: PokerState, idx: number, kind: PokerAction['kind'], ctx: GameCtx, ev: Ev): void {
  const p = st.players[idx]
  const toCall = st.currentBet - p.bet
  const size = betSize(st)
  let pay = 0
  if (kind === 'call') pay = toCall
  else if (kind === 'raise') pay = toCall + size
  else if (kind === 'allin') pay = p.stack
  p.stack -= pay
  p.bet += pay
  p.contrib += pay
  if (kind === 'fold') p.status = 'desistiu'
  else if (p.stack === 0) p.status = 'allin'
  if (kind === 'raise') {
    st.currentBet += size
    st.betCount++
    for (const q of st.players) if (q.status === 'jogando' && q !== p) q.acted = false
  } else if (kind === 'allin' && p.bet > st.currentBet) {
    st.currentBet = p.bet // all-in parcial: sobe o valor a pagar, mas não reabre nem conta como aumento
  }
  if (kind !== 'fold') p.acted = true
  p.lastAction = { kind, amount: pay }
  ev.push({ kind: 'act', by: p.playerId, action: kind, amount: pay })
  moveOn(st, ctx, ev, idx)
}

export function apply(state: PokerState, playerId: string, action: PokerAction, ctx: GameCtx): Step<PokerState, PokerEvent> | GameError {
  if (state.phase === 'fim') return err('partida-encerrada', 'A partida acabou.')
  const idx = state.players.findIndex((p) => p.playerId === playerId)
  if (idx < 0) return err('acao-invalida', 'Jogador desconhecido.')
  if (state.actor !== idx) return err('nao-e-sua-vez', 'Não é a sua vez.')
  if (!legalActions(state, idx).some((l) => l.kind === action.kind)) return err('acao-invalida', 'Essa ação não é permitida agora.')
  const st = clone(state)
  const ev: Ev = []
  perform(st, idx, action.kind, ctx, ev)
  return { state: st, events: ev }
}

export function tick(state: PokerState, ctx: GameCtx): Step<PokerState, PokerEvent> {
  if (state.phase === 'fim') return { state, events: [] }
  const st = clone(state)
  const ev: Ev = []
  if (st.actor >= 0) {
    if (st.actDeadline !== null && ctx.now >= st.actDeadline) {
      const idx = st.actor
      const kind = legalActions(st, idx).some((l) => l.kind === 'check') ? 'check' : 'fold'
      ev.push({ kind: 'timeout', by: st.players[idx].playerId })
      perform(st, idx, kind, ctx, ev)
    }
  } else if (st.phase === 'intervalo') {
    if (st.nextHandAt !== null) {
      if (ctx.now >= st.nextHandAt) {
        if (shouldEnd(st, ctx.now)) finishGame(st, ev)
        else startHand(st, ctx, ev)
      }
    } else if (st.endsAt !== null && ctx.now >= st.endsAt) finishGame(st, ev)
  }
  return { state: st, events: ev }
}

export function nextDeadline(st: PokerState): number | null {
  if (st.phase === 'fim') return null
  if (st.actor >= 0) return st.actDeadline
  if (st.nextHandAt !== null) return st.nextHandAt
  return st.endsAt
}

export function setPresence(state: PokerState, playerId: string, present: boolean, ctx: GameCtx): Step<PokerState, PokerEvent> {
  const idx = state.players.findIndex((p) => p.playerId === playerId)
  if (idx < 0 || state.players[idx].present === present) return { state, events: [] }
  const st = clone(state)
  const ev: Ev = []
  const p = st.players[idx]
  p.present = present
  p.awaySince = present ? null : ctx.now
  ev.push({ kind: 'away', by: p.playerId, away: !present })
  if (present && st.phase === 'intervalo' && st.nextHandAt === null && !shouldEnd(st, ctx.now)) startHand(st, ctx, ev)
  return { state: st, events: ev }
}

// ---------- criação ----------
export function setup(players: PlayerRef[], options: PokerOptions, ctx: GameCtx): Step<PokerState, PokerEvent> {
  if (players.length < TABLE.minPlayers || players.length > TABLE.maxPlayers) throw new Error('Poker exige de 2 a 8 jogadores')
  const st: PokerState = {
    options: { ...options },
    players: players.map((pl) => ({
      playerId: pl.playerId,
      name: pl.name,
      stack: TABLE.startStack,
      rebuys: 0,
      status: 'jogando',
      present: true,
      awaySince: null,
      hole: [],
      bet: 0,
      contrib: 0,
      acted: false,
      shown: false,
      lastAction: null
    })),
    handNo: 0,
    phase: 'intervalo',
    dealer: -1,
    sb: -1,
    bb: -1,
    deck: [],
    board: [],
    currentBet: 0,
    betCount: 0,
    actor: -1,
    actDeadline: null,
    nextHandAt: null,
    endsAt: options.minutes > 0 ? ctx.now + options.minutes * 60_000 : null,
    showdown: null,
    ranking: null
  }
  const ev: Ev = []
  startHand(st, ctx, ev)
  return { state: st, events: ev }
}

// ---------- visão ----------
export function view(st: PokerState, playerId: string | null, _now: number): PokerView {
  const me = playerId === null ? -1 : st.players.findIndex((p) => p.playerId === playerId)
  const seats: SeatView[] = st.players.map((p, i) => ({
    playerId: p.playerId,
    name: p.name,
    seat: i,
    stack: p.stack,
    bet: p.bet,
    status: p.status,
    dealer: st.handNo > 0 && i === st.dealer,
    smallBlind: i === st.sb,
    bigBlind: i === st.bb,
    cards: i === me || p.shown ? [...p.hole] : null,
    cardCount: i === me || p.status !== 'desistiu' ? p.hole.length : 0,
    rebuys: p.rebuys,
    net: net(p),
    lastAction: p.lastAction,
    present: p.present
  }))
  const betting = st.phase === 'preflop' || st.phase === 'flop' || st.phase === 'turn' || st.phase === 'river'
  const pots: PotView[] = betting
    ? buildPots(st.players.map((p) => ({ id: p.playerId, contrib: p.contrib - p.bet, folded: !inHand(p) })))
    : []
  let you: PokerView['you'] = null
  if (me >= 0 && st.players[me].hole.length > 0) {
    const p = st.players[me]
    const live = inHand(p)
    const best = live ? bestHand(st.options.mode, p.hole, st.board) : null
    you = {
      playerId: p.playerId,
      hand: [...p.hole],
      best: best ? best.info : null,
      draws: best && st.options.mode === 'holdem' ? drawHints(p.hole, st.board, best.ev.category) : []
    }
  }
  return {
    mode: st.options.mode,
    options: { ...st.options },
    phase: st.phase,
    handNo: st.handNo,
    endsAt: st.endsAt,
    seats,
    board: [...st.board],
    pots,
    toAct: st.actor >= 0 ? st.players[st.actor].playerId : null,
    actDeadline: st.actor >= 0 ? st.actDeadline : null,
    legal: me >= 0 && st.actor === me ? legalActions(st, me) : [],
    you,
    showdown: st.showdown,
    ranking: st.phase === 'fim' ? st.ranking : null
  }
}

export const isOver = (st: PokerState): boolean => st.phase === 'fim'
