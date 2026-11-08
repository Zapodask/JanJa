/**
 * Motor do mini-golfe: todo mundo joga o mesmo buraco ao mesmo tempo.
 * Funções puras (tempo só via GameCtx). Nada é escondido: a visão é igual para todos, só muda `you`.
 *
 * O estado guarda um retrato do mundo (`world`) e o próximo instante em que alguma bola muda
 * de estado (`wake`). O alarme do servidor chama `tick` nesse instante, no fim do buraco e no fim da pausa.
 */
import type { GameCtx, GameError, PlayerRef, Step } from '../types'
import { buildCourse, type Course } from './course'
import { mapById, type GolfMap } from './maps'
import { advance, nextChange, shotVelocity, type Ball, type World } from './physics'
import {
  BREAK_MS,
  CAP_OVER_PAR,
  DEFAULT_GOLF_OPTIONS,
  HOLE_SECONDS,
  type GolfAction,
  type GolfEvent,
  type GolfOptions,
  type GolfPhase,
  type GolfView,
  type HoleSeconds
} from './types'

export interface GolfState {
  options: GolfOptions
  players: PlayerRef[]
  hole: number
  phase: GolfPhase
  until: number | null
  world: World
  wake: number | null
  shots: Record<string, number>
  scores: Record<string, number[]>
  away: Record<string, boolean>
  /** já avisamos que acertou neste buraco */
  holed: Record<string, boolean>
}

type S = Step<GolfState, GolfEvent>

const err = (error: GameError['error'], message: string): GameError => ({ error, message })
const clone = <T>(x: T): T => structuredClone(x)

const mapOf = (s: GolfState): GolfMap => mapById(s.options.mapId) as GolfMap
export const courseOf = (s: GolfState): Course => buildCourse(mapOf(s).holes[s.hole])
const capOf = (c: Course): number => c.par + CAP_OVER_PAR
const ballOf = (s: GolfState, playerId: string): Ball | undefined => s.world.balls.find((b) => b.playerId === playerId)
const strokesOf = (s: GolfState, playerId: string): number => (s.shots[playerId] ?? 0) + (ballOf(s, playerId)?.splash ?? 0)

function isDone(s: GolfState, c: Course, playerId: string): boolean {
  const b = ballOf(s, playerId)
  if (!b) return true
  return b.mode === 'cup' || (b.mode === 'rest' && strokesOf(s, playerId) >= capOf(c))
}

// ---------- opções e ações ----------
export function parseOptions(raw: unknown): GolfOptions | GameError {
  if (raw === undefined || raw === null) return { ...DEFAULT_GOLF_OPTIONS }
  if (typeof raw !== 'object' || Array.isArray(raw)) return err('acao-invalida', 'Opções inválidas.')
  const o = raw as Record<string, unknown>
  const mapId = o.mapId ?? DEFAULT_GOLF_OPTIONS.mapId
  const collisions = o.collisions ?? DEFAULT_GOLF_OPTIONS.collisions
  const holeSeconds = o.holeSeconds ?? DEFAULT_GOLF_OPTIONS.holeSeconds
  if (typeof mapId !== 'string' || !mapById(mapId)) return err('acao-invalida', 'Mapa desconhecido.')
  if (typeof collisions !== 'boolean') return err('acao-invalida', 'Opção de colisão inválida.')
  if (!(HOLE_SECONDS as readonly unknown[]).includes(holeSeconds)) return err('acao-invalida', 'Tempo por buraco inválido.')
  return { mapId, collisions, holeSeconds: holeSeconds as HoleSeconds }
}

const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0
export function parseAction(raw: unknown): GolfAction | GameError {
  if (typeof raw !== 'object' || raw === null) return err('acao-invalida', 'Tacada inválida.')
  const a = raw as Record<string, unknown>
  if (a.type !== 'shot' || !isInt(a.hole) || !isInt(a.stroke)) return err('acao-invalida', 'Tacada inválida.')
  if (typeof a.angle !== 'number' || !Number.isFinite(a.angle) || Math.abs(a.angle) > 100) return err('acao-invalida', 'Mira inválida.')
  if (typeof a.power !== 'number' || !(a.power >= 0 && a.power <= 1)) return err('acao-invalida', 'Força inválida.')
  return { type: 'shot', hole: a.hole, stroke: a.stroke, angle: a.angle, power: a.power }
}

// ---------- buracos ----------
function teeBalls(s: GolfState, c: Course): Ball[] {
  return s.players.map((p) => ({
    playerId: p.playerId,
    x: c.tee.x,
    z: c.tee.z,
    vx: 0,
    vz: 0,
    mode: 'rest',
    lx: c.tee.x,
    lz: c.tee.z,
    splash: 0,
    live: false,
    age: 0
  }))
}

function startHole(s: GolfState, hole: number, now: number, events: GolfEvent[]): void {
  s.hole = hole
  const c = courseOf(s)
  s.phase = 'jogando'
  s.until = now + s.options.holeSeconds * 1000
  s.world = { t0: now, balls: teeBalls(s, c) }
  s.wake = null
  s.shots = Object.fromEntries(s.players.map((p) => [p.playerId, 0]))
  s.holed = {}
  events.push({ type: 'hole-start', hole, name: c.name, par: c.par })
}

/** Leva o mundo até `now`, avisa quem acertou e recalcula o próximo despertar. */
function sync(s: GolfState, now: number, events: GolfEvent[]): void {
  const c = courseOf(s)
  // sempre leva o retrato até agora, mesmo com tudo parado: senão a próxima tacada nasce no passado
  s.world = advance(c, s.world, now, s.options.collisions)
  for (const b of s.world.balls) {
    if (b.mode === 'cup' && !s.holed[b.playerId]) {
      s.holed[b.playerId] = true
      events.push({ type: 'holed', playerId: b.playerId, strokes: strokesOf(s, b.playerId), par: c.par })
    }
  }
  s.wake = nextChange(c, s.world, s.options.collisions)
}

function ranking(s: GolfState): NonNullable<GolfView['ranking']> {
  const totals = s.players.map((p) => ({ playerId: p.playerId, total: sum(s.scores[p.playerId]) }))
  totals.sort((a, b) => a.total - b.total)
  return totals.map((t) => ({ ...t, place: totals.findIndex((x) => x.total === t.total) + 1 }))
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0)

/** Fecha o buraco se o tempo acabou ou todo mundo presente terminou. */
function maybeEndHole(s: GolfState, now: number, events: GolfEvent[]): void {
  if (s.phase !== 'jogando') return
  const c = courseOf(s)
  const present = s.players.filter((p) => !s.away[p.playerId])
  const allDone = present.length > 0 && present.every((p) => isDone(s, c, p.playerId))
  if (!allDone && now < (s.until ?? Infinity)) return
  const cap = capOf(c)
  const scores: Record<string, number> = {}
  for (const p of s.players) {
    const b = ballOf(s, p.playerId)
    const score = b?.mode === 'cup' ? Math.min(strokesOf(s, p.playerId), cap) : cap
    scores[p.playerId] = score
    s.scores[p.playerId].push(score)
  }
  // bolas que ainda rolavam param onde estão
  s.world = { t0: s.world.t0, balls: s.world.balls.map((b) => (b.mode === 'roll' ? { ...b, vx: 0, vz: 0, mode: 'rest' } : b)) }
  s.wake = null
  events.push({ type: 'hole-end', hole: s.hole, scores })
  if (s.hole + 1 >= mapOf(s).holes.length) {
    s.phase = 'fim'
    s.until = null
    events.push({ type: 'game-over', ranking: ranking(s) })
  } else {
    s.phase = 'intervalo'
    s.until = now + BREAK_MS
  }
}

// ---------- contrato ----------
export function setup(players: PlayerRef[], options: GolfOptions, ctx: GameCtx): S {
  const s: GolfState = {
    options,
    players: players.map((p) => ({ playerId: p.playerId, name: p.name })),
    hole: 0,
    phase: 'jogando',
    until: null,
    world: { t0: ctx.now, balls: [] },
    wake: null,
    shots: {},
    scores: Object.fromEntries(players.map((p) => [p.playerId, []])),
    away: {},
    holed: {}
  }
  const events: GolfEvent[] = []
  startHole(s, 0, ctx.now, events)
  return { state: s, events }
}

export function apply(state: GolfState, playerId: string, action: GolfAction, ctx: GameCtx): S | GameError {
  if (state.phase === 'fim') return err('partida-encerrada', 'A partida acabou.')
  if (state.phase !== 'jogando' || ctx.now >= (state.until ?? Infinity)) return err('acao-invalida', 'Este buraco já acabou.')
  if (!state.players.some((p) => p.playerId === playerId)) return err('nao-e-sua-vez', 'Você não está jogando.')
  if (action.hole !== state.hole || action.stroke !== strokesOf(state, playerId)) {
    return err('acao-invalida', 'Essa tacada chegou atrasada. Tente de novo.')
  }
  const s = clone(state)
  const events: GolfEvent[] = []
  sync(s, ctx.now, events)
  const c = courseOf(s)
  const ball = ballOf(s, playerId)
  if (!ball) return err('acao-invalida', 'Sua bola sumiu.')
  if (ball.mode === 'cup') return err('acao-invalida', 'Você já acertou este buraco.')
  if (ball.mode !== 'rest') return err('nao-e-sua-vez', 'Espere a bola parar.')
  if (strokesOf(s, playerId) >= capOf(c)) return err('acao-invalida', 'Você chegou ao limite de tacadas neste buraco.')
  const v = shotVelocity(action.angle, action.power)
  ball.vx = v.vx
  ball.vz = v.vz
  ball.mode = 'roll'
  ball.lx = ball.x
  ball.lz = ball.z
  ball.age = 0
  ball.live = true
  s.shots[playerId] = (s.shots[playerId] ?? 0) + 1
  s.wake = nextChange(c, s.world, s.options.collisions)
  events.push({ type: 'shot', playerId, t0: s.world.t0, balls: s.world.balls.map((b) => ({ ...b })) })
  return { state: s, events }
}

export function tick(state: GolfState, ctx: GameCtx): S {
  const s = clone(state)
  const events: GolfEvent[] = []
  if (s.phase === 'jogando') {
    sync(s, ctx.now, events)
    maybeEndHole(s, ctx.now, events)
  } else if (s.phase === 'intervalo' && ctx.now >= (s.until ?? Infinity)) {
    startHole(s, s.hole + 1, ctx.now, events)
  }
  return { state: s, events }
}

export function nextDeadline(s: GolfState): number | null {
  if (s.phase === 'fim') return null
  if (s.phase === 'intervalo') return s.until
  return Math.min(s.wake ?? Infinity, s.until ?? Infinity)
}

export function setPresence(state: GolfState, playerId: string, present: boolean, ctx: GameCtx): S {
  if (!!state.away[playerId] === !present) return { state, events: [] }
  const s = clone(state)
  s.away[playerId] = !present
  const events: GolfEvent[] = []
  if (s.phase === 'jogando') {
    sync(s, ctx.now, events)
    maybeEndHole(s, ctx.now, events)
  }
  return { state: s, events }
}

export function view(s: GolfState, playerId: string | null, now: number): GolfView {
  const map = mapOf(s)
  const c = courseOf(s)
  const me = playerId && s.players.some((p) => p.playerId === playerId) ? { playerId } : null
  return {
    you: me,
    mapId: map.id,
    mapName: map.name,
    holeCount: map.holes.length,
    hole: s.hole,
    par: c.par,
    cap: capOf(c),
    collisions: s.options.collisions,
    phase: s.phase,
    until: s.until,
    serverNow: now,
    t0: s.world.t0,
    balls: s.world.balls.map((b) => ({ ...b })),
    players: s.players.map((p, i) => ({
      playerId: p.playerId,
      name: p.name,
      color: i,
      away: !!s.away[p.playerId],
      strokes: strokesOf(s, p.playerId),
      done: s.phase === 'jogando' ? isDone(s, c, p.playerId) : true,
      scores: [...s.scores[p.playerId]],
      total: sum(s.scores[p.playerId])
    })),
    ranking: s.phase === 'fim' ? ranking(s) : null
  }
}

export const isOver = (s: GolfState): boolean => s.phase === 'fim'

/** Pula direto para um buraco (só o laboratório /dev/golf usa). */
export function skipTo(state: GolfState, hole: number, now: number): S {
  const s = clone(state)
  const events: GolfEvent[] = []
  startHole(s, Math.max(0, Math.min(hole, mapOf(s).holes.length - 1)), now, events)
  return { state: s, events }
}
