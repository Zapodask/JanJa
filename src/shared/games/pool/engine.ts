/**
 * Motor da sinuca (bola 8, 1x1). Funções puras: sorteio e tempo só via GameCtx.
 * O servidor simula a tacada inteira (physics.ts), aplica as regras e guarda o "antes" para os
 * navegadores animarem. Nada é escondido: todos veem a mesa.
 */
import type { GameCtx, GameError, PlayerRef, Step } from '../types'
import { canPlace, cloneBalls, POCKETS, simulate, TABLE_H, TABLE_W, type PBall } from './physics'
import { ballsOf, FOOT, freeSpot, groupOf, HEAD, HEAD_X, other, rack, type Group } from './rules'
import { AWAY_MS, SHOT_MS, type PoolAction, type PoolEvent, type PoolOptions, type PoolShotView, type PoolView } from './types'

export interface PoolState {
  players: Array<{ playerId: string; name: string; away: boolean; group: Group | null }>
  balls: PBall[]
  turn: number
  broken: boolean
  ballInHand: boolean
  shot: PoolShotView | null
  result: string | null
  foul: string | null
  ref: number
  until: number | null
  winner: number | null
  log: string[]
}

type S = Step<PoolState, PoolEvent>
const err = (error: GameError['error'], message: string): GameError => ({ error, message })
const clone = <T>(x: T): T => structuredClone(x)
const POCKET_NAME = ['canto de cima à esquerda', 'meio de cima', 'canto de cima à direita', 'canto de baixo à esquerda', 'meio de baixo', 'canto de baixo à direita']

function say(s: PoolState, text: string): void {
  s.log.push(text)
  if (s.log.length > 40) s.log.splice(0, s.log.length - 40)
}

const onTable = (s: PoolState, id: number): boolean => s.balls.some((b) => b.id === id && !b.in)
const left = (s: PoolState, g: Group | null): number => (g ? ballsOf(g).filter((id) => onTable(s, id)).length : 7)
/** quem joga já limpou o grupo e mira na 8 */
export const onEight = (s: PoolState, i: number): boolean => s.players[i].group !== null && left(s, s.players[i].group) === 0

function setUntil(s: PoolState, now: number): void {
  s.until = s.winner !== null ? null : now + (s.players[s.turn].away ? AWAY_MS : SHOT_MS)
}

function finish(s: PoolState, winner: number, why: string, events: PoolEvent[]): void {
  s.winner = winner
  s.until = null
  events.push({ type: 'end', winner, why })
  say(s, why)
}

/** Joga a tacada de `i` (já validada) e aplica as regras. */
function shoot(s: PoolState, i: number, a: PoolAction, now: number, events: PoolEvent[]): void {
  const me = s.players[i]
  const them = 1 - i
  const isBreak = !s.broken
  const aimingEight = onEight(s, i)
  if (s.ballInHand && a.cue) {
    const cue = s.balls.find((b) => b.id === 0) as PBall
    cue.x = a.cue.x
    cue.y = a.cue.y
    cue.in = false
  }
  const before = cloneBalls(s.balls)
  const { balls, log } = simulate(before, a.dx, a.dy, a.power)
  s.ref++
  s.shot = { ref: s.ref, by: i, before, dx: a.dx, dy: a.dy, power: a.power, after: cloneBalls(balls) }
  s.balls = balls
  s.broken = true
  events.push({ type: 'shot', by: i, power: a.power })
  const pocketed = log.pocketed.map((p) => p.id)
  const objects = pocketed.filter((id) => id !== 0)
  if (objects.length) events.push({ type: 'pocket', ids: objects })

  // faltas
  let foul: string | null = null
  const target = me.group ? (aimingEight ? [8] : ballsOf(me.group)) : null
  if (pocketed.includes(0)) foul = 'A branca caiu na caçapa.'
  else if (log.firstHit === null) foul = 'A branca não tocou em nenhuma bola.'
  else if (!isBreak && target && !target.includes(log.firstHit)) foul = aimingEight ? 'Tinha que tocar primeiro na 8.' : `Tocou primeiro numa bola do outro grupo.`
  else if (!isBreak && !target && log.firstHit === 8) foul = 'Com a mesa aberta, não pode tocar primeiro na 8.'
  else if (!isBreak && !objects.length && !log.railAfterHit) foul = 'Nenhuma bola bateu na tabela depois do toque.'

  // a 8
  if (pocketed.includes(8)) {
    if (isBreak) {
      const eight = s.balls.find((b) => b.id === 8) as PBall
      eight.in = false
      Object.assign(eight, freeSpot(s.balls, FOOT, 8))
      say(s, 'A 8 caiu na quebra e voltou para a mesa.')
    } else {
      const where = log.pocketed.find((p) => p.id === 8)?.pocket
      if (aimingEight && !foul && where === a.pocket) {
        s.result = `${me.name} matou a 8 na caçapa escolhida.`
        return finish(s, i, `${me.name} matou a 8 e venceu!`, events)
      }
      const why = !aimingEight ? 'antes da hora' : foul ? 'com falta' : 'na caçapa errada'
      s.result = `${me.name} matou a 8 ${why}.`
      return finish(s, them, `${me.name} matou a 8 ${why}. ${s.players[them].name} venceu!`, events)
    }
  }

  // grupos: a mesa abre depois da quebra; a primeira bola encaçapada sem falta define
  const counted = objects.filter((id) => id !== 8)
  if (!me.group && !isBreak && !foul && counted.length) {
    const g = groupOf(counted[0]) as Group
    me.group = g
    s.players[them].group = other(g)
    events.push({ type: 'groups', by: i, group: g })
    say(s, `${me.name} fica com as ${g}; ${s.players[them].name} com as ${other(g)}.`)
  }

  s.foul = foul
  const mine = me.group ? counted.filter((id) => groupOf(id) === me.group) : counted
  s.result = foul ? `Falta: ${foul}` : counted.length ? `${me.name} encaçapou ${counted.join(', ')}.` : `${me.name} não encaçapou nada.`
  say(s, s.result)
  if (foul) {
    events.push({ type: 'foul', by: i, why: foul })
    s.turn = them
    s.ballInHand = true
    const cue = s.balls.find((b) => b.id === 0) as PBall
    if (cue.in) {
      cue.in = false
      Object.assign(cue, freeSpot(s.balls, HEAD, 0))
    }
    say(s, `${s.players[them].name} tem bola na mão.`)
  } else {
    s.ballInHand = false
    if (!mine.length) s.turn = them
  }
  setUntil(s, now)
}

// ---------- contrato ----------
export const parseOptions = (): PoolOptions => ({})

const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

export function parseAction(raw: unknown): PoolAction | GameError {
  if (typeof raw !== 'object' || raw === null) return err('acao-invalida', 'Tacada inválida.')
  const a = raw as Record<string, unknown>
  if (a.type !== 'shoot' || !num(a.dx) || !num(a.dy) || !num(a.power) || !num(a.ref)) return err('acao-invalida', 'Tacada inválida.')
  if (a.dx === 0 && a.dy === 0) return err('acao-invalida', 'Mire para algum lado.')
  if (Math.abs(a.dx) > 1e3 || Math.abs(a.dy) > 1e3 || a.power < 0 || a.power > 1) return err('acao-invalida', 'Tacada inválida.')
  const out: PoolAction = { type: 'shoot', dx: a.dx, dy: a.dy, power: a.power, ref: a.ref }
  if (a.cue !== undefined) {
    const c = a.cue as Record<string, unknown>
    if (typeof c !== 'object' || !c || !num(c.x) || !num(c.y)) return err('acao-invalida', 'Posição da branca inválida.')
    out.cue = { x: c.x, y: c.y }
  }
  if (a.pocket !== undefined) {
    if (!num(a.pocket) || !Number.isInteger(a.pocket) || a.pocket < 0 || a.pocket >= POCKETS.length) return err('acao-invalida', 'Caçapa inválida.')
    out.pocket = a.pocket
  }
  return out
}

export function setup(players: PlayerRef[], _o: PoolOptions, ctx: GameCtx): S {
  const first = ctx.rng.int(players.length)
  const s: PoolState = {
    players: players.map((p) => ({ playerId: p.playerId, name: p.name, away: false, group: null })),
    balls: rack(ctx.rng),
    turn: first,
    broken: false,
    ballInHand: true,
    shot: null,
    result: null,
    foul: null,
    ref: 0,
    until: null,
    winner: null,
    log: [`${players[first].name} quebra. Ponha a branca atrás da linha e tacada!`]
  }
  setUntil(s, ctx.now)
  return { state: s, events: [{ type: 'start', first }] }
}

export function apply(state: PoolState, playerId: string, a: PoolAction, ctx: GameCtx): S | GameError {
  if (state.winner !== null) return err('partida-encerrada', 'A partida acabou.')
  const i = state.players.findIndex((p) => p.playerId === playerId)
  if (i < 0) return err('nao-e-sua-vez', 'Você não está jogando.')
  if (state.turn !== i) return err('nao-e-sua-vez', 'Espere a sua vez.')
  if (a.ref !== state.ref) return err('acao-invalida', 'A mesa mudou. Mire de novo.')
  if (a.cue) {
    if (!state.ballInHand) return err('acao-invalida', 'Só com bola na mão dá para mexer na branca.')
    if (!canPlace(state.balls, a.cue.x, a.cue.y, state.broken ? undefined : HEAD_X)) {
      return err('acao-invalida', state.broken ? 'A branca não cabe aí.' : 'Na quebra, a branca fica atrás da linha.')
    }
  }
  if (onEight(state, i) && a.pocket === undefined) return err('acao-invalida', 'Escolha a caçapa da 8.')
  const s = clone(state)
  const events: PoolEvent[] = []
  shoot(s, i, a, ctx.now, events)
  return { state: s, events }
}

/** Tacada automática (prazo estourado): fraca, na direção da bola válida mais perto. */
export function autoShot(s: PoolState): PoolAction {
  const i = s.turn
  const cue = s.balls.find((b) => b.id === 0) as PBall
  const g = s.players[i].group
  const ok = (id: number) => (onEight(s, i) ? id === 8 : g ? groupOf(id) === g : id !== 8 && id !== 0)
  const targets = s.balls.filter((b) => !b.in && ok(b.id))
  const t = targets.sort((a, b) => (a.x - cue.x) ** 2 + (a.y - cue.y) ** 2 - ((b.x - cue.x) ** 2 + (b.y - cue.y) ** 2))[0]
  const aim = t ?? { x: TABLE_W / 2, y: TABLE_H / 2 }
  const eight = s.balls.find((b) => b.id === 8) as PBall
  const pocket = POCKETS.map((p, k) => ({ k, d: (p.x - eight.x) ** 2 + (p.y - eight.y) ** 2 })).sort((a, b) => a.d - b.d)[0].k
  return {
    type: 'shoot',
    dx: aim.x - cue.x || 1,
    dy: aim.y - cue.y,
    power: s.broken ? 0.3 : 0.9,
    ref: s.ref,
    ...(onEight(s, i) ? { pocket } : {})
  }
}

export function tick(state: PoolState, ctx: GameCtx): S {
  if (state.winner !== null || state.until === null || ctx.now < state.until) return { state, events: [] }
  const s = clone(state)
  const events: PoolEvent[] = []
  say(s, `${s.players[s.turn].name} não tacou a tempo.`)
  shoot(s, s.turn, autoShot(s), ctx.now, events)
  return { state: s, events }
}

export const nextDeadline = (s: PoolState): number | null => (s.winner !== null ? null : s.until)

export function setPresence(state: PoolState, playerId: string, present: boolean, ctx: GameCtx): S {
  const i = state.players.findIndex((p) => p.playerId === playerId)
  if (i < 0 || state.players[i].away === !present || state.winner !== null) return { state, events: [] }
  const s = clone(state)
  s.players[i].away = !present
  if (!present && s.turn === i && s.until !== null) s.until = Math.min(s.until, ctx.now + AWAY_MS)
  return { state: s, events: [] }
}

export function view(s: PoolState, playerId: string | null, now: number): PoolView {
  const i = playerId ? s.players.findIndex((p) => p.playerId === playerId) : -1
  return {
    you: i >= 0 ? { playerId: playerId as string, index: i } : null,
    players: s.players.map((p) => ({ playerId: p.playerId, name: p.name, group: p.group, left: left(s, p.group), away: p.away })),
    balls: cloneBalls(s.balls),
    turn: s.winner !== null ? null : s.turn,
    ballInHand: s.ballInHand,
    behindLine: !s.broken,
    onEight: s.winner === null && onEight(s, s.turn),
    shot: s.shot ? clone(s.shot) : null,
    result: s.result,
    foul: s.foul,
    ref: s.ref,
    until: s.until,
    serverNow: now,
    winner: s.winner,
    log: s.log.slice(-8)
  }
}

export const isOver = (s: PoolState): boolean => s.winner !== null

export { POCKET_NAME }
