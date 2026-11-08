/**
 * Motor da batalha naval (1x1). Funções puras: tempo e sorteio só via GameCtx.
 * Os dois posicionam ao mesmo tempo (o jogo é `concurrent`); depois cada um atira na sua vez.
 * A frota de um nunca vai na visão do outro: só os tiros e os navios já afundados.
 */
import type { GameCtx, GameError, PlayerRef, Step } from '../types'
import { cellName, checkFleet, inside, key, randomFleet, SIZE, shipCells, shipDef, type Cell, type Placement } from './fleet'
import {
  AWAY_MS,
  DEFAULT_NAVAL_OPTIONS,
  NAVAL_MODES,
  PLACE_MS,
  SHOT_MS,
  type NavalAction,
  type NavalEvent,
  type NavalMode,
  type NavalOptions,
  type NavalView,
  type Shot
} from './types'

export interface NavalState {
  options: NavalOptions
  players: Array<{ playerId: string; name: string; away: boolean }>
  fleets: Array<Placement[] | null>
  ready: boolean[]
  /** tiros recebidos no mar de cada um */
  shots: Shot[][]
  phase: 'posicionar' | 'batalha' | 'fim'
  turn: number
  /** quantas ações de tiro já houve (o `ref` das ações) */
  ref: number
  last: { by: number; cells: Shot[] } | null
  until: number | null
  winner: number | null
  log: string[]
}

type S = Step<NavalState, NavalEvent>
const err = (error: GameError['error'], message: string): GameError => ({ error, message })
const clone = <T>(x: T): T => structuredClone(x)
const other = (i: number): number => 1 - i

function say(s: NavalState, text: string): void {
  s.log.push(text)
  if (s.log.length > 40) s.log.splice(0, s.log.length - 40)
}

const isSunk = (ship: Placement, shots: Shot[]): boolean => {
  const hit = new Set(shots.filter((x) => x.hit).map(key))
  return shipCells(ship).every((c) => hit.has(key(c)))
}
const sunkOf = (s: NavalState, i: number): Placement[] => (s.fleets[i] ?? []).filter((sh) => isSunk(sh, s.shots[i]))
const afloatOf = (s: NavalState, i: number): number => (s.fleets[i] ?? []).length - sunkOf(s, i).length

/** quantos tiros quem está na vez dá agora */
function shotsNow(s: NavalState): number {
  if (s.options.mode === 'classico') return 1
  const free = SIZE * SIZE - s.shots[other(s.turn)].length
  return Math.min(afloatOf(s, s.turn), free)
}

function setUntil(s: NavalState, now: number): void {
  if (s.phase === 'posicionar') {
    const waiting = s.players.filter((_, i) => !s.ready[i])
    s.until = now + (waiting.length && waiting.every((p) => p.away) ? AWAY_MS : PLACE_MS)
  } else if (s.phase === 'batalha') s.until = now + (s.players[s.turn].away ? AWAY_MS : SHOT_MS)
  else s.until = null
}

function startBattle(s: NavalState, ctx: GameCtx, events: NavalEvent[]): void {
  s.phase = 'batalha'
  s.turn = ctx.rng.int(2)
  events.push({ type: 'battle', first: s.turn })
  say(s, `Frotas prontas. ${s.players[s.turn].name} atira primeiro.`)
  setUntil(s, ctx.now)
}

function place(s: NavalState, i: number, ships: Placement[], ctx: GameCtx, events: NavalEvent[]): void {
  s.fleets[i] = ships.map((x) => ({ id: x.id, x: x.x, y: x.y, dir: x.dir }))
  if (!s.ready[i]) say(s, `${s.players[i].name} posicionou a frota.`)
  s.ready[i] = true
  events.push({ type: 'placed', p: i })
  if (s.ready.every(Boolean)) startBattle(s, ctx, events)
  else setUntil(s, ctx.now)
}

function shoot(s: NavalState, i: number, cells: Cell[], now: number, events: NavalEvent[]): void {
  const t = other(i)
  const fleet = s.fleets[t] ?? []
  const occupied = new Set(fleet.flatMap((sh) => shipCells(sh).map(key)))
  const before = new Set(sunkOf(s, t).map((x) => x.id))
  const fired: Shot[] = cells.map((c) => ({ x: c.x, y: c.y, hit: occupied.has(key(c)) }))
  s.shots[t].push(...fired)
  s.ref++
  s.last = { by: i, cells: fired }
  const sunk = sunkOf(s, t).filter((x) => !before.has(x.id))
  events.push({ type: 'shot', p: i, cells: fired, sunk: sunk.map((x) => x.id) })
  const name = s.players[i].name
  say(s, `${name} atirou em ${fired.map((f) => `${cellName(f)} (${f.hit ? 'acertou' : 'água'})`).join(', ')}.`)
  for (const x of sunk) say(s, `${name} afundou o ${shipDef(x.id)?.name.toLowerCase()} de ${s.players[t].name}!`)
  if (afloatOf(s, t) === 0) {
    s.phase = 'fim'
    s.winner = i
    s.until = null
    events.push({ type: 'end', winner: i })
    say(s, `${name} afundou a frota toda e venceu.`)
    return
  }
  // clássico: acertou, joga de novo
  const again = s.options.mode === 'classico' && fired.some((f) => f.hit)
  if (!again) s.turn = t
  setUntil(s, now)
}

// ---------- contrato ----------
export function parseOptions(raw: unknown): NavalOptions | GameError {
  if (raw === undefined || raw === null) return { ...DEFAULT_NAVAL_OPTIONS }
  if (typeof raw !== 'object' || Array.isArray(raw)) return err('acao-invalida', 'Opções inválidas.')
  const mode = (raw as Record<string, unknown>).mode ?? DEFAULT_NAVAL_OPTIONS.mode
  if (!(NAVAL_MODES as readonly unknown[]).includes(mode)) return err('acao-invalida', 'Modo inválido.')
  return { mode: mode as NavalMode }
}

const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x)

export function parseAction(raw: unknown): NavalAction | GameError {
  if (typeof raw !== 'object' || raw === null) return err('acao-invalida', 'Ação inválida.')
  const a = raw as Record<string, unknown>
  if (a.type === 'place') {
    if (!Array.isArray(a.ships) || a.ships.length > 10) return err('acao-invalida', 'Frota inválida.')
    const ships = a.ships.map((x) => x as Record<string, unknown>)
    if (!ships.every((x) => typeof x === 'object' && x && typeof x.id === 'string' && isInt(x.x) && isInt(x.y) && (x.dir === 'h' || x.dir === 'v'))) {
      return err('acao-invalida', 'Frota inválida.')
    }
    return { type: 'place', ships: ships.map((x) => ({ id: x.id as string, x: x.x as number, y: x.y as number, dir: x.dir as 'h' | 'v' })) }
  }
  if (a.type === 'shoot') {
    if (!isInt(a.ref) || !Array.isArray(a.cells) || a.cells.length < 1 || a.cells.length > 5) return err('acao-invalida', 'Tiro inválido.')
    const cells = a.cells.map((c) => c as Record<string, unknown>)
    if (!cells.every((c) => typeof c === 'object' && c && isInt(c.x) && isInt(c.y) && inside(c as unknown as Cell))) return err('acao-invalida', 'Tiro fora do mar.')
    return { type: 'shoot', ref: a.ref, cells: cells.map((c) => ({ x: c.x as number, y: c.y as number })) }
  }
  return err('acao-invalida', 'Ação desconhecida.')
}

export function setup(players: PlayerRef[], options: NavalOptions, ctx: GameCtx): S {
  const s: NavalState = {
    options,
    players: players.map((p) => ({ playerId: p.playerId, name: p.name, away: false })),
    fleets: [null, null],
    ready: [false, false],
    shots: [[], []],
    phase: 'posicionar',
    turn: 0,
    ref: 0,
    last: null,
    until: null,
    winner: null,
    log: ['Posicionem as frotas.']
  }
  setUntil(s, ctx.now)
  return { state: s, events: [] }
}

export function apply(state: NavalState, playerId: string, action: NavalAction, ctx: GameCtx): S | GameError {
  if (state.phase === 'fim') return err('partida-encerrada', 'A partida acabou.')
  const i = state.players.findIndex((p) => p.playerId === playerId)
  if (i < 0) return err('nao-e-sua-vez', 'Você não está jogando.')
  const s = clone(state)
  const events: NavalEvent[] = []
  if (action.type === 'place') {
    if (s.phase !== 'posicionar') return err('acao-invalida', 'A batalha já começou.')
    const why = checkFleet(action.ships)
    if (why) return err('acao-invalida', why)
    place(s, i, action.ships, ctx, events)
    return { state: s, events }
  }
  if (s.phase !== 'batalha') return err('acao-invalida', 'Espere as frotas.')
  if (s.turn !== i) return err('nao-e-sua-vez', 'Espere a sua vez.')
  if (action.ref !== s.ref) return err('acao-invalida', 'A tela estava atrasada. Tente de novo.')
  const n = shotsNow(s)
  if (action.cells.length !== n) return err('acao-invalida', n === 1 ? 'Escolha uma casa.' : `Escolha ${n} casas.`)
  const already = new Set(s.shots[other(i)].map(key))
  const picked = new Set(action.cells.map(key))
  if (picked.size !== action.cells.length || action.cells.some((c) => already.has(key(c)))) return err('acao-invalida', 'Você já atirou aí.')
  shoot(s, i, action.cells, ctx.now, events)
  return { state: s, events }
}

/** casas livres para um tiro automático */
function randomShots(s: NavalState, n: number, ctx: GameCtx): Cell[] {
  const used = new Set(s.shots[other(s.turn)].map(key))
  const free: Cell[] = []
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (!used.has(key({ x, y }))) free.push({ x, y })
  const out: Cell[] = []
  for (let k = 0; k < n && free.length; k++) out.push(free.splice(ctx.rng.int(free.length), 1)[0])
  return out
}

export function tick(state: NavalState, ctx: GameCtx): S {
  if (state.phase === 'fim' || state.until === null || ctx.now < state.until) return { state, events: [] }
  const s = clone(state)
  const events: NavalEvent[] = []
  if (s.phase === 'posicionar') {
    // estourou o tempo: posiciona sozinho para quem não terminou
    for (let i = 0; i < 2; i++) {
      if (s.ready[i]) continue
      say(s, `O tempo acabou: a frota de ${s.players[i].name} foi posicionada sozinha.`)
      place(s, i, randomFleet(ctx.rng), ctx, events)
    }
  } else {
    shoot(s, s.turn, randomShots(s, shotsNow(s), ctx), ctx.now, events)
  }
  return { state: s, events }
}

export const nextDeadline = (s: NavalState): number | null => (s.phase === 'fim' ? null : s.until)

export function setPresence(state: NavalState, playerId: string, present: boolean, ctx: GameCtx): S {
  const i = state.players.findIndex((p) => p.playerId === playerId)
  if (i < 0 || state.players[i].away === !present || state.phase === 'fim') return { state, events: [] }
  const s = clone(state)
  s.players[i].away = !present
  if (!present && s.until !== null) {
    const waiting = s.phase === 'posicionar' ? s.players.filter((_, k) => !s.ready[k]) : [s.players[s.turn]]
    if (waiting.length && waiting.every((p) => p.away)) s.until = Math.min(s.until, ctx.now + AWAY_MS)
  }
  return { state: s, events: [] }
}

export function view(s: NavalState, playerId: string | null, now: number): NavalView {
  const i = playerId ? s.players.findIndex((p) => p.playerId === playerId) : -1
  const me = i >= 0 ? i : null
  const over = s.phase === 'fim'
  return {
    you: me !== null ? { playerId: playerId as string, index: me } : null,
    players: s.players.map((p, k) => ({ playerId: p.playerId, name: p.name, ready: s.ready[k], away: p.away })),
    mode: s.options.mode,
    phase: s.phase,
    myFleet: me !== null && s.fleets[me] ? clone(s.fleets[me]) : null,
    seas: [0, 1].map((k) => ({ shots: clone(s.shots[k]), sunk: clone(sunkOf(s, k)), afloat: afloatOf(s, k) })),
    fleets: over ? clone(s.fleets) : null,
    turn: s.phase === 'batalha' ? s.turn : null,
    shots: s.phase === 'batalha' ? shotsNow(s) : 0,
    ref: s.ref,
    last: s.last ? clone(s.last) : null,
    until: s.until,
    serverNow: now,
    winner: s.winner,
    log: s.log.slice(-8)
  }
}

export const isOver = (s: NavalState): boolean => s.phase === 'fim'
