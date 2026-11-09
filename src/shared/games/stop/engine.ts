/**
 * Motor do Stop (adedonha). Funções puras: sorteio e tempo só via GameCtx.
 *
 * Todo mundo escreve ao mesmo tempo (o jogo é `concurrent`; as ações levam o número da rodada).
 * Enquanto escrevem, ninguém vê as respostas dos outros, só quantas categorias cada um preencheu.
 * Depois do STOP: 3 s para as últimas respostas chegarem, conferência (cada um marca "não vale"
 * nas dos outros; cai com a maioria) e pontos: 10 para resposta única, 5 para repetida, 0 vazia.
 */
import type { GameCtx, GameError, PlayerRef, Step } from '../types'
import { CATEGORIES, categoryName, DEFAULT_CATEGORIES, LETTERS, MAX_ANSWER, normalize, startsWith } from './categories'
import {
  GRACE_MS,
  REVIEW_MS,
  SCORES_MS,
  SHARED_POINTS,
  STOP_ROUNDS,
  STOP_SECONDS,
  UNIQUE_POINTS,
  type Answers,
  type ReviewEntry,
  type StopAction,
  type StopEvent,
  type StopOptions,
  type StopPhase,
  type StopRounds,
  type StopSeconds,
  type StopView
} from './types'

export interface StopState {
  options: StopOptions
  players: Array<{ playerId: string; name: string; away: boolean }>
  round: number
  letter: string
  used: string[]
  phase: StopPhase
  until: number | null
  answers: Record<string, Answers>
  /** votos "não vale": categoria -> autor -> quem votou */
  votes: Record<string, Record<string, string[]>>
  ready: string[]
  stoppedBy: string | null
  /** pontos da rodada (depois da conferência) */
  points: Record<string, Record<string, number>> | null
  history: Array<{ letter: string; points: Record<string, number> }>
  log: string[]
}

type S = Step<StopState, StopEvent>
const err = (error: GameError['error'], message: string): GameError => ({ error, message })
const clone = <T>(x: T): T => structuredClone(x)

function say(s: StopState, text: string): void {
  s.log.push(text)
  if (s.log.length > 40) s.log.splice(0, s.log.length - 40)
}

const nameOf = (s: StopState, id: string): string => s.players.find((p) => p.playerId === id)?.name ?? 'Alguém'
const isPlayer = (s: StopState, id: string): boolean => s.players.some((p) => p.playerId === id)
const totals = (s: StopState): Record<string, number> =>
  Object.fromEntries(s.players.map((p) => [p.playerId, s.history.reduce((a, h) => a + (h.points[p.playerId] ?? 0), 0)]))

/** só as categorias da partida, cortadas no tamanho máximo */
function clean(s: StopState, raw: Answers): Answers {
  const out: Answers = {}
  for (const c of s.options.categories) {
    const v = raw[c]
    if (typeof v === 'string') out[c] = v.slice(0, MAX_ANSWER)
  }
  return out
}

const filled = (s: StopState, a: Answers | undefined): number =>
  s.options.categories.filter((c) => (a?.[c] ?? '').trim() !== '' && startsWith(a?.[c] ?? '', s.letter)).length

/** a resposta caiu por votos: maioria dos outros jogadores */
function invalidByVotes(s: StopState, category: string, author: string): boolean {
  const n = s.votes[category]?.[author]?.length ?? 0
  return n * 2 > s.players.length - 1
}

function startRound(s: StopState, ctx: GameCtx, events: StopEvent[]): void {
  s.round++
  let pool = LETTERS.filter((l) => !s.used.includes(l))
  if (!pool.length) {
    s.used = []
    pool = [...LETTERS]
  }
  s.letter = pool[ctx.rng.int(pool.length)]
  s.used.push(s.letter)
  s.phase = 'escrevendo'
  s.until = s.options.seconds ? ctx.now + s.options.seconds * 1000 : null
  s.answers = {}
  s.votes = {}
  s.ready = []
  s.stoppedBy = null
  s.points = null
  events.push({ type: 'round', round: s.round, letter: s.letter })
  say(s, `Rodada ${s.round}: letra ${s.letter}!`)
}

function score(s: StopState, now: number, events: StopEvent[]): void {
  const points: Record<string, Record<string, number>> = {}
  const round: Record<string, number> = Object.fromEntries(s.players.map((p) => [p.playerId, 0]))
  for (const c of s.options.categories) {
    points[c] = {}
    const valid = s.players.filter((p) => {
      const a = s.answers[p.playerId]?.[c] ?? ''
      return a.trim() !== '' && startsWith(a, s.letter) && !invalidByVotes(s, c, p.playerId)
    })
    const count = new Map<string, number>()
    for (const p of valid) {
      const k = normalize(s.answers[p.playerId][c])
      count.set(k, (count.get(k) ?? 0) + 1)
    }
    for (const p of s.players) {
      const ok = valid.includes(p)
      const pts = ok ? ((count.get(normalize(s.answers[p.playerId][c])) ?? 0) > 1 ? SHARED_POINTS : UNIQUE_POINTS) : 0
      points[c][p.playerId] = pts
      round[p.playerId] += pts
    }
  }
  s.points = points
  s.history.push({ letter: s.letter, points: round })
  events.push({ type: 'scores', round: s.round, points: round })
  const best = Math.max(...Object.values(round))
  const top = s.players.filter((p) => round[p.playerId] === best).map((p) => p.name)
  say(s, `Fim da conferência. ${top.join(' e ')} ${top.length > 1 ? 'fizeram' : 'fez'} mais pontos: ${best}.`)
  if (s.round >= s.options.rounds) {
    s.phase = 'fim'
    s.until = null
    events.push({ type: 'end', ranking: ranking(s) })
    say(s, 'Fim da partida!')
  } else {
    s.phase = 'placar'
    s.until = now + SCORES_MS
  }
}

function ranking(s: StopState): NonNullable<StopView['ranking']> {
  const t = totals(s)
  const sorted = s.players.map((p) => ({ playerId: p.playerId, total: t[p.playerId] })).sort((a, b) => b.total - a.total)
  return sorted.map((r) => ({ ...r, place: sorted.findIndex((x) => x.total === r.total) + 1 }))
}

function toReview(s: StopState, now: number, events: StopEvent[]): void {
  s.phase = 'conferindo'
  s.until = now + REVIEW_MS
  events.push({ type: 'review', round: s.round })
}

/** conferência acaba quando todo mundo presente disse "pronto" */
function maybeScore(s: StopState, now: number, events: StopEvent[]): void {
  if (s.phase !== 'conferindo') return
  const present = s.players.filter((p) => !p.away)
  if (present.length && present.every((p) => s.ready.includes(p.playerId))) score(s, now, events)
}

// ---------- contrato ----------
export function parseOptions(raw: unknown): StopOptions | GameError {
  const def: StopOptions = { categories: [...DEFAULT_CATEGORIES], rounds: 5, seconds: 120 }
  if (raw === undefined || raw === null) return def
  if (typeof raw !== 'object' || Array.isArray(raw)) return err('acao-invalida', 'Opções inválidas.')
  const o = raw as Record<string, unknown>
  const cats = o.categories ?? def.categories
  if (!Array.isArray(cats) || !cats.every((c) => typeof c === 'string' && CATEGORIES.some((x) => x.id === c))) return err('acao-invalida', 'Categoria desconhecida.')
  const unique = CATEGORIES.map((c) => c.id).filter((id) => (cats as string[]).includes(id))
  if (unique.length < 3) return err('acao-invalida', 'Escolha pelo menos 3 categorias.')
  const rounds = o.rounds ?? def.rounds
  const seconds = o.seconds ?? def.seconds
  if (!(STOP_ROUNDS as readonly unknown[]).includes(rounds)) return err('acao-invalida', 'Número de rodadas inválido.')
  if (!(STOP_SECONDS as readonly unknown[]).includes(seconds)) return err('acao-invalida', 'Tempo inválido.')
  return { categories: unique, rounds: rounds as StopRounds, seconds: seconds as StopSeconds }
}

const isRound = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0
function parseAnswers(x: unknown): Answers | null {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return null
  const out: Answers = {}
  for (const [k, v] of Object.entries(x)) {
    if (typeof v !== 'string' || k.length > 20) return null
    out[k] = v.slice(0, MAX_ANSWER)
  }
  return Object.keys(out).length <= CATEGORIES.length ? out : null
}

export function parseAction(raw: unknown): StopAction | GameError {
  if (typeof raw !== 'object' || raw === null) return err('acao-invalida', 'Ação inválida.')
  const a = raw as Record<string, unknown>
  if (!isRound(a.round)) return err('acao-invalida', 'Ação inválida.')
  switch (a.type) {
    case 'write':
    case 'stop': {
      const answers = parseAnswers(a.answers)
      return answers ? { type: a.type, round: a.round, answers } : err('acao-invalida', 'Respostas inválidas.')
    }
    case 'vote':
      if (typeof a.target !== 'string' || typeof a.category !== 'string' || typeof a.invalid !== 'boolean') return err('acao-invalida', 'Voto inválido.')
      return { type: 'vote', round: a.round, target: a.target, category: a.category, invalid: a.invalid }
    case 'ready':
      return { type: 'ready', round: a.round }
    default:
      return err('acao-invalida', 'Ação desconhecida.')
  }
}

export function setup(players: PlayerRef[], options: StopOptions, ctx: GameCtx): S {
  const s: StopState = {
    options,
    players: players.map((p) => ({ playerId: p.playerId, name: p.name, away: false })),
    round: 0,
    letter: '',
    used: [],
    phase: 'escrevendo',
    until: null,
    answers: {},
    votes: {},
    ready: [],
    stoppedBy: null,
    points: null,
    history: [],
    log: []
  }
  const events: StopEvent[] = []
  startRound(s, ctx, events)
  return { state: s, events }
}

export function apply(state: StopState, playerId: string, a: StopAction, ctx: GameCtx): S | GameError {
  if (state.phase === 'fim') return err('partida-encerrada', 'A partida acabou.')
  if (!isPlayer(state, playerId)) return err('nao-e-sua-vez', 'Você não está jogando.')
  if (a.round !== state.round) return err('acao-invalida', 'Essa rodada já passou.')
  const s = clone(state)
  const events: StopEvent[] = []
  switch (a.type) {
    case 'write':
      // depois do STOP ainda aceita durante o tempinho de folga
      if (s.phase !== 'escrevendo' && s.phase !== 'parando') return err('acao-invalida', 'Já deram STOP.')
      s.answers[playerId] = clean(s, a.answers)
      return { state: s, events }
    case 'stop': {
      if (s.phase !== 'escrevendo') return err('acao-invalida', 'Já deram STOP.')
      const answers = clean(s, a.answers)
      const missing = s.options.categories.filter((c) => !(answers[c] ?? '').trim() || !startsWith(answers[c], s.letter))
      if (missing.length) return err('acao-invalida', `Falta preencher com ${s.letter}: ${missing.map(categoryName).join(', ')}.`)
      s.answers[playerId] = answers
      s.phase = 'parando'
      s.stoppedBy = playerId
      s.until = ctx.now + GRACE_MS
      events.push({ type: 'stop', by: playerId })
      say(s, `${nameOf(s, playerId)} gritou STOP!`)
      return { state: s, events }
    }
    case 'vote': {
      if (s.phase !== 'conferindo') return err('acao-invalida', 'Agora não dá para votar.')
      if (a.target === playerId) return err('acao-invalida', 'Não dá para votar na sua resposta.')
      if (!isPlayer(s, a.target) || !s.options.categories.includes(a.category)) return err('acao-invalida', 'Voto inválido.')
      const list = ((s.votes[a.category] ??= {})[a.target] ??= [])
      const has = list.includes(playerId)
      if (a.invalid && !has) list.push(playerId)
      if (!a.invalid && has) list.splice(list.indexOf(playerId), 1)
      return { state: s, events }
    }
    case 'ready':
      if (s.phase !== 'conferindo') return err('acao-invalida', 'Agora não.')
      if (!s.ready.includes(playerId)) s.ready.push(playerId)
      maybeScore(s, ctx.now, events)
      return { state: s, events }
  }
}

export function tick(state: StopState, ctx: GameCtx): S {
  if (state.phase === 'fim' || state.until === null || ctx.now < state.until) return { state, events: [] }
  const s = clone(state)
  const events: StopEvent[] = []
  switch (s.phase) {
    case 'escrevendo':
      // o tempo acabou: vale como STOP de ninguém
      s.phase = 'parando'
      s.until = ctx.now + GRACE_MS
      events.push({ type: 'stop', by: '' })
      say(s, 'Acabou o tempo! STOP!')
      break
    case 'parando':
      toReview(s, ctx.now, events)
      break
    case 'conferindo':
      score(s, ctx.now, events)
      break
    case 'placar':
      startRound(s, ctx, events)
      break
  }
  return { state: s, events }
}

export const nextDeadline = (s: StopState): number | null => (s.phase === 'fim' ? null : s.until)

export function setPresence(state: StopState, playerId: string, present: boolean, ctx: GameCtx): S {
  const p = state.players.find((x) => x.playerId === playerId)
  if (!p || p.away === !present || state.phase === 'fim') return { state, events: [] }
  const s = clone(state)
  ;(s.players.find((x) => x.playerId === playerId) as { away: boolean }).away = !present
  const events: StopEvent[] = []
  // quem saiu não segura a conferência
  maybeScore(s, ctx.now, events)
  return { state: s, events }
}

export function view(s: StopState, playerId: string | null, now: number): StopView {
  const me = playerId && isPlayer(s, playerId) ? playerId : null
  const open = s.phase === 'conferindo' || s.phase === 'placar' || s.phase === 'fim'
  const t = totals(s)
  let review: StopView['review'] = null
  if (open) {
    review = {}
    for (const c of s.options.categories) {
      review[c] = s.players.map((p): ReviewEntry => {
        const answer = s.answers[p.playerId]?.[c] ?? ''
        const voters = s.votes[c]?.[p.playerId] ?? []
        return {
          playerId: p.playerId,
          answer,
          fits: answer.trim() !== '' && startsWith(answer, s.letter),
          votes: voters.length,
          mine: !!me && voters.includes(me),
          invalid: invalidByVotes(s, c, p.playerId),
          points: s.points ? (s.points[c]?.[p.playerId] ?? 0) : null
        }
      })
    }
  }
  return {
    you: me ? { playerId: me } : null,
    players: s.players.map((p) => ({
      playerId: p.playerId,
      name: p.name,
      total: t[p.playerId],
      filled: filled(s, s.answers[p.playerId]),
      ready: s.ready.includes(p.playerId),
      away: p.away
    })),
    categories: s.options.categories.map((id) => CATEGORIES.find((c) => c.id === id) as (typeof CATEGORIES)[number]),
    round: s.round,
    rounds: s.options.rounds,
    letter: s.letter,
    phase: s.phase,
    until: s.until,
    serverNow: now,
    myAnswers: me ? { ...(s.answers[me] ?? {}) } : {},
    stoppedBy: s.stoppedBy,
    review,
    history: clone(s.history),
    ranking: s.phase === 'fim' ? ranking(s) : null,
    log: s.log.slice(-8)
  }
}

export const isOver = (s: StopState): boolean => s.phase === 'fim'
