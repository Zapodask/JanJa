/**
 * Coordenador do Tiro na Sala (roda no Durable Object). NÃO simula o jogo: só guarda quem é o host da
 * simulação, o placar parcial e o resultado. Funções puras (tempo só via GameCtx).
 */
import type { GameCtx, GameError, PlayerRef, Step } from '../types'
import { isMapId } from './maps'
import {
  BOT_SLOT_BASE,
  COORD_GRACE_S,
  DEFAULT_SHOOTER_OPTIONS,
  KILL_LIMITS,
  MATCH_MINUTES,
  MAX_BOTS,
  MAX_HUMANS,
  TICK_HZ,
  WARMUP_TICKS,
  type KillLimit,
  type MatchMinutes,
  type ScoreLine,
  type ShooterAction,
  type ShooterEvent,
  type ShooterOptions,
  type ShooterPhase,
  type ShooterPlayerView,
  type ShooterView
} from './types'

export interface CoordState {
  options: ShooterOptions
  /** humanos (slots 0..7) e depois robôs (slots 8..) */
  players: ShooterPlayerView[]
  hostId: string
  epoch: number
  seed: number
  createdAt: number
  phase: ShooterPhase
  scores: ScoreLine[]
  ranking: ScoreLine[] | null
}

type S = Step<CoordState, ShooterEvent>

const err = (error: GameError['error'], message: string): GameError => ({ error, message })
const clone = <T>(x: T): T => structuredClone(x)
const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 1_000_000

// ---------- opções e ações ----------
export function parseOptions(raw: unknown): ShooterOptions | GameError {
  if (raw === undefined || raw === null) return { ...DEFAULT_SHOOTER_OPTIONS }
  if (typeof raw !== 'object' || Array.isArray(raw)) return err('acao-invalida', 'Opções inválidas.')
  const o = raw as Record<string, unknown>
  const d = DEFAULT_SHOOTER_OPTIONS
  const mapId = o.mapId ?? d.mapId
  const minutes = o.minutes ?? d.minutes
  const killLimit = o.killLimit ?? d.killLimit
  const bots = o.bots ?? d.bots
  if (!isMapId(mapId)) return err('acao-invalida', 'Mapa desconhecido.')
  if (!(MATCH_MINUTES as readonly unknown[]).includes(minutes)) return err('acao-invalida', 'Duração inválida.')
  if (!(KILL_LIMITS as readonly unknown[]).includes(killLimit)) return err('acao-invalida', 'Limite de abates inválido.')
  if (typeof bots !== 'number' || !Number.isInteger(bots) || bots < 0 || bots > MAX_BOTS) return err('acao-invalida', 'Quantidade de robôs inválida.')
  return { mapId, minutes: minutes as MatchMinutes, killLimit: killLimit as KillLimit, bots }
}

function parseLines(raw: unknown): ScoreLine[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_HUMANS + MAX_BOTS) return null
  const out: ScoreLine[] = []
  for (const l of raw) {
    if (typeof l !== 'object' || l === null) return null
    const x = l as Record<string, unknown>
    if (typeof x.id !== 'string' || x.id.length === 0 || x.id.length > 64) return null
    if (!isInt(x.kills) || !isInt(x.deaths) || !isInt(x.damage)) return null
    out.push({ id: x.id, kills: x.kills, deaths: x.deaths, damage: x.damage })
  }
  return out
}

export function parseAction(raw: unknown): ShooterAction | GameError {
  if (typeof raw !== 'object' || raw === null) return err('acao-invalida', 'Ação inválida.')
  const a = raw as Record<string, unknown>
  if (!isInt(a.epoch)) return err('acao-invalida', 'Ação inválida.')
  if (a.type === 'score') {
    const scores = parseLines(a.scores)
    return scores ? { type: 'score', epoch: a.epoch, scores } : err('acao-invalida', 'Placar inválido.')
  }
  if (a.type === 'result') {
    const ranking = parseLines(a.ranking)
    return ranking ? { type: 'result', epoch: a.epoch, ranking } : err('acao-invalida', 'Resultado inválido.')
  }
  return err('acao-invalida', 'Ação desconhecida.')
}

// ---------- utilidades ----------
const zero = (id: string): ScoreLine => ({ id, kills: 0, deaths: 0, damage: 0 })

/** Confere ids existentes e sem repetição; devolve as linhas na ordem dos jogadores (faltou = zero). */
function mergeLines(s: CoordState, lines: ScoreLine[]): ScoreLine[] | null {
  const byId = new Map<string, ScoreLine>()
  for (const l of lines) {
    if (byId.has(l.id) || !s.players.some((p) => p.id === l.id)) return null
    byId.set(l.id, l)
  }
  return s.players.map((p) => byId.get(p.id) ?? zero(p.id))
}

/** Ordena: abates desc, mortes asc, dano desc, depois slot. */
function sortLines(s: CoordState, lines: ScoreLine[]): ScoreLine[] {
  const slot = (id: string): number => s.players.find((p) => p.id === id)?.slot ?? 99
  return [...lines].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || b.damage - a.damage || slot(a.id) - slot(b.id))
}

function finish(s: CoordState, ranking: ScoreLine[], events: ShooterEvent[]): void {
  s.phase = 'fim'
  s.ranking = ranking
  s.scores = s.players.map((p) => ranking.find((l) => l.id === p.id) ?? zero(p.id))
  events.push({ type: 'fim', ranking: ranking.map((l) => ({ ...l })) })
}

/** Se o host está ausente e há outro humano presente, passa o comando (menor slot). */
function maybeNewHost(s: CoordState, events: ShooterEvent[]): void {
  if (s.phase === 'fim') return
  const host = s.players.find((p) => p.id === s.hostId)
  if (host && host.present) return
  const next = s.players.filter((p) => !p.bot && p.present).sort((a, b) => a.slot - b.slot)[0]
  if (!next || next.id === s.hostId) return
  s.hostId = next.id
  s.epoch++
  events.push({ type: 'host', hostId: s.hostId, epoch: s.epoch })
}

const deadline = (s: CoordState): number => s.createdAt + (s.options.minutes * 60 + WARMUP_TICKS / TICK_HZ + COORD_GRACE_S) * 1000

// ---------- contrato ----------
export function setup(players: PlayerRef[], options: ShooterOptions, ctx: GameCtx): S {
  const humans: ShooterPlayerView[] = players.slice(0, MAX_HUMANS).map((p, i) => ({ id: p.playerId, name: p.name, slot: i, bot: false, present: true }))
  const bots: ShooterPlayerView[] = []
  for (let i = 0; i < options.bots; i++) bots.push({ id: `bot-${i + 1}`, name: `Robô ${i + 1}`, slot: BOT_SLOT_BASE + i, bot: true, present: true })
  const all = [...humans, ...bots]
  const s: CoordState = {
    options: { ...options },
    players: all,
    hostId: humans[0]?.id ?? '',
    epoch: 1,
    seed: ctx.rng.int(2 ** 31),
    createdAt: ctx.now,
    phase: 'jogando',
    scores: all.map((p) => zero(p.id)),
    ranking: null
  }
  return { state: s, events: [{ type: 'host', hostId: s.hostId, epoch: s.epoch }] }
}

export function apply(state: CoordState, playerId: string, action: ShooterAction, _ctx: GameCtx): S | GameError {
  if (state.phase === 'fim') return err('partida-encerrada', 'A partida acabou.')
  if (playerId !== state.hostId) return err('acao-invalida', 'Só quem roda a partida manda o placar.')
  if (action.epoch !== state.epoch) return err('acao-invalida', 'Essa ação é de um comando antigo.')
  const s = clone(state)
  const events: ShooterEvent[] = []
  if (action.type === 'score') {
    const merged = mergeLines(s, action.scores)
    if (!merged) return err('acao-invalida', 'Placar com jogador desconhecido.')
    s.scores = merged
    return { state: s, events }
  }
  const merged = mergeLines(s, action.ranking)
  if (!merged) return err('acao-invalida', 'Resultado com jogador desconhecido.')
  // mantém a ordem enviada e coloca no fim quem faltou
  const given = action.ranking
  const rest = merged.filter((l) => !given.some((g) => g.id === l.id))
  finish(s, [...given, ...rest], events)
  return { state: s, events }
}

export function tick(state: CoordState, ctx: GameCtx): S {
  if (state.phase === 'fim' || ctx.now < deadline(state)) return { state, events: [] }
  const s = clone(state)
  const events: ShooterEvent[] = []
  finish(s, sortLines(s, s.scores), events)
  return { state: s, events }
}

export function nextDeadline(s: CoordState): number | null {
  return s.phase === 'fim' ? null : deadline(s)
}

export function setPresence(state: CoordState, playerId: string, present: boolean, _ctx: GameCtx): S {
  const p = state.players.find((x) => x.id === playerId && !x.bot)
  if (!p || p.present === present) return { state, events: [] }
  const s = clone(state)
  s.players.find((x) => x.id === playerId)!.present = present
  const events: ShooterEvent[] = []
  maybeNewHost(s, events)
  return { state: s, events }
}

export function addPlayer(state: CoordState, player: PlayerRef, _ctx: GameCtx): S | GameError {
  if (state.phase === 'fim') return err('partida-encerrada', 'A partida acabou.')
  const s = clone(state)
  const events: ShooterEvent[] = []
  const old = s.players.find((p) => p.id === player.playerId && !p.bot)
  if (old) {
    // já estava na partida: só volta
    old.present = true
    old.name = player.name
    maybeNewHost(s, events)
    return { state: s, events }
  }
  const used = new Set(s.players.filter((p) => !p.bot).map((p) => p.slot))
  let slot = 0
  while (slot < MAX_HUMANS && used.has(slot)) slot++
  if (slot >= MAX_HUMANS) return err('acao-invalida', 'A partida está cheia.')
  s.players.push({ id: player.playerId, name: player.name, slot, bot: false, present: true })
  s.players.sort((a, b) => a.slot - b.slot)
  s.scores.push(zero(player.playerId))
  events.push({ type: 'joined', id: player.playerId, name: player.name, slot })
  maybeNewHost(s, events)
  return { state: s, events }
}

export function view(s: CoordState, playerId: string | null, _now: number): ShooterView {
  const me = playerId ? s.players.find((p) => p.id === playerId && !p.bot) : undefined
  return {
    you: me ? { playerId: me.id, slot: me.slot } : null,
    options: { ...s.options },
    phase: s.phase,
    players: s.players.map((p) => ({ ...p })),
    hostId: s.hostId,
    epoch: s.epoch,
    seed: s.seed,
    createdAt: s.createdAt,
    scores: s.scores.map((l) => ({ ...l })),
    ranking: s.ranking ? s.ranking.map((l) => ({ ...l })) : null
  }
}

export const isOver = (s: CoordState): boolean => s.phase === 'fim'
