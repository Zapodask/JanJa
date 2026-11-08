/**
 * Laço da simulação do host, sem DOM e sem Worker (o relógio entra por `advance(now)`).
 * Roda dentro do Web Worker (hostWorker.ts) ou, se o Worker não existir, na thread principal.
 */
import {
  MAX_LAG_COMP_MS,
  SNAPSHOT_EVERY,
  TICK_HZ,
  TICK_MS,
  type Input,
  type ScoreLine,
  type SimApi,
  type SimEvent,
  type SimPlayerRef,
  type SimState
} from '../../../../shared/games/shooter/types'
import { encodeSnapshot, snapshotFromState, type Snapshot, type TimedEvent } from '../../../../shared/games/shooter/codec'

/** mensagens para o host */
export type HostIn =
  | { k: 'init'; state: SimState; epoch: number }
  /** entradas de um jogador (a mais antiga primeiro); repetidas são descartadas aqui */
  | { k: 'input'; slot: number; inputs: Input[] }
  /** ida e volta medida para aquele jogador (ms) */
  | { k: 'ping'; slot: number; pingMs: number }
  | { k: 'add'; ref: SimPlayerRef }
  | { k: 'away'; slot: number; away: boolean }
  | { k: 'stop' }

/** mensagens do host */
export type HostOut =
  | { k: 'snap'; snap: Snapshot; bytes: ArrayBuffer }
  | { k: 'score'; epoch: number; scores: ScoreLine[] }
  | { k: 'result'; epoch: number; ranking: ScoreLine[] }

/** fila máxima de entradas por jogador */
export const MAX_QUEUE = 3
/** se o laço atrasar mais que isto, pula em vez de correr */
export const MAX_CATCHUP_MS = 250
/** sem entrada por tantos ticks: o jogador "solta tudo" */
export const STALE_TICKS = 8
/** eventos dos últimos N ticks vão repetidos em cada snapshot (cobre perda) */
export const EVENT_WINDOW_TICKS = 6
export const SCORE_EVERY_TICKS = 5 * TICK_HZ

const MAX_LAG_TICKS = Math.ceil(MAX_LAG_COMP_MS / TICK_MS)

/** Entrada vinda da rede: números finitos e limitados, ou null. */
export function sanitizeInput(i: Input): Input | null {
  if (!i || typeof i !== 'object') return null
  if (!Number.isFinite(i.seq) || i.seq <= 0 || i.seq > 0xffffffff) return null
  const f = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0)
  const buttons = typeof i.buttons === 'number' && Number.isFinite(i.buttons) ? i.buttons & 7 : 0
  return { seq: Math.floor(i.seq), mx: f(i.mx), my: f(i.my), ax: f(i.ax), ay: f(i.ay), buttons }
}

export class HostLoop {
  readonly state: SimState
  readonly epoch: number
  private last: number
  private acc = 0
  private stopped = false
  private readonly seen = new Map<number, number>()
  private readonly queue = new Map<number, Input[]>()
  private readonly stale = new Map<number, number>()
  private readonly ping = new Map<number, number>()
  private recent: TimedEvent[] = []
  private resultSent = false
  private firstSnap = true
  private overTicks = 0
  /** quantas entradas foram aplicadas (diagnóstico/testes) */
  applied = 0
  /** gancho de teste: chamado a cada entrada nova aplicada */
  onApply?: (slot: number, seq: number) => void

  constructor(
    private readonly sim: SimApi,
    init: { state: SimState; epoch: number },
    private readonly out: (m: HostOut) => void,
    now: number
  ) {
    this.state = init.state
    this.epoch = init.epoch
    this.last = now
    for (const p of this.state.players) this.seen.set(p.slot, p.lastSeq)
    this.resultSent = this.state.phase === 'fim'
  }

  handle(m: HostIn): void {
    if (this.stopped) return
    switch (m.k) {
      case 'input':
        this.accept(m.slot, m.inputs)
        break
      case 'ping':
        if (Number.isFinite(m.pingMs)) this.ping.set(m.slot, Math.max(0, Math.min(2000, m.pingMs)))
        break
      case 'add':
        if (!this.state.players.some((p) => p.slot === m.ref.slot)) {
          this.sim.addPlayer(this.state, m.ref)
          this.seen.set(m.ref.slot, 0)
        }
        break
      case 'away':
        this.sim.setAway(this.state, m.slot, m.away)
        break
      case 'stop':
        this.stopped = true
        break
      case 'init':
        break
    }
  }

  /** Entradas novas (seq maior que a maior já vista), em ordem; as repetidas da redundância caem fora. */
  private accept(slot: number, inputs: readonly Input[]): void {
    const p = this.state.players.find((x) => x.slot === slot)
    if (!p || p.bot) return
    let q = this.queue.get(slot)
    if (!q) this.queue.set(slot, (q = []))
    let seen = this.seen.get(slot) ?? 0
    const sorted = [...inputs].sort((a, b) => a.seq - b.seq)
    for (const raw of sorted) {
      const i = sanitizeInput(raw)
      if (!i || i.seq <= seen) continue
      seen = i.seq
      q.push(i)
    }
    this.seen.set(slot, seen)
    while (q.length > MAX_QUEUE) q.shift()
  }

  /** Avança o relógio; roda quantos ticks forem devidos (pula se atrasou demais). */
  advance(now: number): void {
    if (this.stopped) return
    let dt = now - this.last
    this.last = now
    if (dt < 0) dt = 0
    if (dt > MAX_CATCHUP_MS) {
      this.acc = 0
      dt = TICK_MS
    }
    this.acc += dt
    let n = 0
    while (this.acc >= TICK_MS && n < 12) {
      this.acc -= TICK_MS
      this.tick()
      n++
    }
    if (n === 12) this.acc = 0
  }

  private lag(slot: number): number {
    const ping = this.ping.get(slot) ?? 0
    return Math.min(MAX_LAG_TICKS, Math.round(ping / 2 / TICK_MS))
  }

  private tick(): void {
    const s = this.state
    const inputs = new Map<number, Input>()
    for (const p of s.players) {
      if (p.bot) continue
      const q = this.queue.get(p.slot)
      const next = q?.shift()
      if (next) {
        this.stale.set(p.slot, 0)
        inputs.set(p.slot, { ...next, lagTicks: this.lag(p.slot) })
        this.applied++
        this.onApply?.(p.slot, next.seq)
      } else {
        const n = (this.stale.get(p.slot) ?? 0) + 1
        this.stale.set(p.slot, n)
        // perda curta: a sim repete a última; sumiu de vez: solta tudo
        if (n > STALE_TICKS) inputs.set(p.slot, { seq: this.seen.get(p.slot) ?? p.lastSeq, mx: 0, my: 0, ax: 0, ay: 0, buttons: 0 })
      }
    }
    const t0 = s.tick
    const events: SimEvent[] = this.sim.step(s, inputs)
    for (const ev of events) this.recent.push({ tick: t0, ev })
    const min = s.tick - EVENT_WINDOW_TICKS
    if (this.recent.length && this.recent[0].tick <= min) this.recent = this.recent.filter((e) => e.tick > min)

    // depois do fim o tick para: reenvia o retrato final algumas vezes (o canal perde pacotes)
    const over = s.phase === 'fim' && s.tick === t0
    if (over) this.overTicks++
    const due = over ? this.overTicks % 20 === 1 && this.overTicks < 200 : s.tick % SNAPSHOT_EVERY === 0
    if (due) {
      const full = this.firstSnap || over || s.tick % TICK_HZ === 0
      this.firstSnap = false
      const snap = snapshotFromState(s, this.recent, { epoch: this.epoch, full })
      this.out({ k: 'snap', snap, bytes: encodeSnapshot(snap) })
    }
    if (!over && s.tick % SCORE_EVERY_TICKS === 0) this.out({ k: 'score', epoch: this.epoch, scores: this.sim.scores(s) })
    if (s.phase === 'fim' && !this.resultSent) {
      this.resultSent = true
      this.out({ k: 'score', epoch: this.epoch, scores: this.sim.scores(s) })
      this.out({ k: 'result', epoch: this.epoch, ranking: this.sim.ranking(s) })
    }
  }
}
