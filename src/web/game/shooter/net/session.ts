/**
 * Sessão do Tiro na Sala: decide se esta pessoa é o host (roda a simulação) ou cliente (manda
 * entradas, prevê e interpola), troca de papel quando hostId/epoch mudam e monta o ShooterFrame.
 * O relógio, os temporizadores e o criador do host entram por `SessionEnv` (testável sem navegador).
 */
import {
  TICK_MS,
  type SimPlayerRef,
  type SimState,
  type ShooterView
} from '../../../../shared/games/shooter/types'
import {
  decodePacket,
  encodeInput,
  encodePing,
  restoreState,
  type Snapshot,
  type SnapshotStatics
} from '../../../../shared/games/shooter/codec'
import type { FrameEvent, InputState, NetStatus, ShooterFrame, ShooterSession, ShooterSessionDeps } from '../contract'
import { ClientCore } from './client'
import type { HostOut } from './hostCore'
import { createHostRunner, type HostInit, type HostRunner } from './hostRunner'
import { getMap, simApi } from './simBinding'
import { Transport, type GameLink } from './transport'

export interface SessionEnv {
  now(): number
  /** repete `fn` a cada `ms`; devolve o cancelamento */
  every(ms: number, fn: () => void): () => void
  createRunner(init: HostInit, out: (m: HostOut) => void): HostRunner
}

export const defaultEnv: SessionEnv = {
  now: () => performance.now(),
  every: (ms, fn) => {
    const id = setInterval(fn, ms)
    return () => clearInterval(id)
  },
  createRunner: createHostRunner
}

/** Sessão com os métodos internos que o hook/sala usam (a CENA só enxerga ShooterSession). */
export interface ManagedShooterSession extends ShooterSession {
  update(view: ShooterView): void
  setManager(manager: ShooterSessionDeps['manager']): void
  role(): 'host' | 'client' | 'espectador'
  /** só para teste e diagnóstico */
  readonly debug: { client(): ClientCore; hostState(): SimState | null; lastSnapshot(): Snapshot | undefined; statics(): SnapshotStatics | null }
}

const PUMP_MS = 8
const FRAME_CACHE_MS = 3
const STALE_CONNECTING_MS = 2000
const STALE_OFFLINE_MS = 6000
const PING_EVERY_MS = 1000

const refOf = (p: ShooterView['players'][number]): SimPlayerRef => ({ slot: p.slot, id: p.id, bot: p.bot })

export function createShooterSession(deps: ShooterSessionDeps, env: SessionEnv = defaultEnv): ManagedShooterSession {
  return new SessionCore(deps, env)
}

class SessionCore implements ManagedShooterSession {
  private view: ShooterView
  private manager: ShooterSessionDeps['manager']
  private readonly selfId: string
  private readonly transport: Transport
  private client: ClientCore
  private runner?: HostRunner
  private runnerGen = 0
  private roleKey = ''
  private current: 'host' | 'client' | 'espectador' = 'espectador'
  private switching = false
  private hostReady = false
  private known = new Set<number>()
  private away = new Map<number, boolean>()
  private input: InputState = { mx: 0, my: 0, ax: 1, ay: 0, buttons: 0 }
  private nextTickAt = 0
  private nextPingAt = 0
  private hostState: SimState | null = null
  private pingSent = 0
  private cache: { at: number; frame: ShooterFrame } | null = null
  private readonly listeners = new Set<(events: FrameEvent[]) => void>()
  private readonly stops: (() => void)[] = []
  private disposed = false

  constructor(private readonly deps: ShooterSessionDeps, private readonly env: SessionEnv) {
    this.view = deps.view
    this.manager = deps.manager
    this.selfId = deps.view.you?.playerId ?? `espectador-${Math.random().toString(36).slice(2, 10)}`
    this.client = new ClientCore({ sim: simApi, getMap, me: deps.view.you?.slot ?? null })
    this.transport = new Transport({
      selfId: this.selfId,
      epoch: () => this.view.epoch,
      link: () => this.manager as unknown as GameLink | undefined,
      relay: (to, data) => this.deps.relay(to, data),
      onRelay: (cb) => this.deps.onRelay(cb),
      others: () => this.view.players.filter((p) => !p.bot && p.present && p.id !== this.selfId).map((p) => p.id)
    })
    this.stops.push(this.transport.onPacket((from, data) => this.onPacket(from, data)))
    this.stops.push(env.every(PUMP_MS, () => this.pump()))
    this.client.setRoster(this.view.players)
    this.setupRole()
    this.transport.announce()
  }

  // ---------- ShooterSession ----------

  frame(): ShooterFrame | null {
    const now = this.env.now()
    if (this.cache && now - this.cache.at < FRAME_CACHE_MS) return this.cache.frame
    const f = this.client.frame(now, this.view.players)
    if (!f) return null
    f.net = this.netStatus(now)
    f.pingMs = this.current === 'host' ? 0 : this.client.pingMs
    this.cache = { at: now, frame: f }
    return f
  }

  setInput(input: InputState): void {
    this.input = input
  }

  onEvents(cb: (events: FrameEvent[]) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.stopRunner()
    for (const s of this.stops.splice(0)) s()
    this.transport.dispose()
    this.listeners.clear()
  }

  // ---------- métodos internos ----------

  role(): 'host' | 'client' | 'espectador' {
    return this.current
  }

  readonly debug = {
    client: () => this.client,
    hostState: () => this.hostState,
    lastSnapshot: () => this.client.latest,
    statics: () => this.client.latestStatics
  }

  update(view: ShooterView): void {
    if (this.disposed) return
    const epochChanged = view.epoch !== this.view.epoch
    this.view = view
    this.client.setRoster(view.players)
    if (view.you?.slot !== this.client.me) {
      // mudou de espectador para jogador (sentou no meio da partida): cliente novo
      this.client = new ClientCore({ sim: simApi, getMap, me: view.you?.slot ?? null })
      this.client.setRoster(view.players)
      this.client.beginEpoch(view.epoch)
      this.roleKey = ''
    }
    this.setupRole()
    if (epochChanged) this.transport.announce()
    this.syncRoster()
  }

  setManager(manager: ShooterSessionDeps['manager']): void {
    this.manager = manager
    this.transport.attach()
    this.transport.announce()
  }

  // ---------- papel ----------

  private setupRole(): void {
    const v = this.view
    const key = `${v.hostId}|${v.epoch}|${v.you?.playerId ?? ''}`
    if (key === this.roleKey) return
    const first = this.roleKey === ''
    this.roleKey = key
    const last = this.client.latest
    const statics = this.client.latestStatics
    this.stopRunner()
    this.client.beginEpoch(v.epoch)
    this.hostReady = false
    this.switching = !first && v.epoch > 1
    this.nextTickAt = 0
    this.cache = null

    if (!v.you) {
      this.current = 'espectador'
      return
    }
    if (v.you.playerId !== v.hostId) {
      this.current = 'client'
      return
    }
    this.current = 'host'
    const state = last ? restoreState(last, statics) : this.freshState()
    this.hostState = state
    this.known = new Set(state.players.map((p) => p.slot))
    this.away.clear()
    for (const p of v.players) {
      if (!this.known.has(p.slot)) {
        simApi.addPlayer(state, refOf(p))
        this.known.add(p.slot)
      }
      if (!p.bot) {
        simApi.setAway(state, p.slot, !p.present)
        this.away.set(p.slot, !p.present)
      }
    }
    const gen = ++this.runnerGen
    this.runner = this.env.createRunner({ k: 'init', state, epoch: v.epoch }, (m) => {
      if (gen === this.runnerGen) this.onHostOut(m)
    })
  }

  private freshState(): SimState {
    const v = this.view
    const state = simApi.createSim(v.players.map(refOf), v.options, v.seed)
    // partida que já tinha placar e não deixou retrato: mantém os números do coordenador
    for (const line of v.scores) {
      const p = state.players.find((x) => x.id === line.id)
      if (p) {
        p.kills = line.kills
        p.deaths = line.deaths
        p.damage = line.damage
      }
    }
    return state
  }

  private stopRunner(): void {
    this.runnerGen++
    this.runner?.dispose()
    this.runner = undefined
  }

  /** jogador novo vira addPlayer; quem caiu/voltou vira setAway */
  private syncRoster(): void {
    if (this.current !== 'host' || !this.runner) return
    for (const p of this.view.players) {
      if (!this.known.has(p.slot)) {
        this.known.add(p.slot)
        this.runner.handle({ k: 'add', ref: refOf(p) })
      }
      if (!p.bot && this.away.get(p.slot) !== !p.present) {
        this.away.set(p.slot, !p.present)
        this.runner.handle({ k: 'away', slot: p.slot, away: !p.present })
      }
    }
  }

  private onHostOut(m: HostOut): void {
    switch (m.k) {
      case 'snap': {
        this.hostReady = true
        this.switching = false
        if (this.client.onSnapshot(m.snap, this.env.now())) this.flushEvents()
        this.transport.send('*', m.bytes)
        break
      }
      case 'score':
        this.deps.act({ type: 'score', epoch: m.epoch, scores: m.scores })
        break
      case 'result':
        this.deps.act({ type: 'result', epoch: m.epoch, ranking: m.ranking })
        break
    }
  }

  private flushEvents(): void {
    const ev = this.client.drainEvents()
    if (ev.length) for (const cb of this.listeners) cb(ev)
  }

  // ---------- laço ----------

  private pump(): void {
    if (this.disposed) return
    const now = this.env.now()
    this.transport.tick(now)
    if (this.current === 'espectador') return

    if (now >= this.nextPingAt) {
      this.nextPingAt = now + PING_EVERY_MS
      this.pingSent = Math.floor(now)
      this.transport.send(this.current === 'host' ? '*' : this.view.hostId, encodePing(this.pingSent >>> 0))
    }

    if (this.view.phase !== 'jogando') return
    if (this.nextTickAt === 0 || now - this.nextTickAt > 250) this.nextTickAt = now
    let n = 0
    while (this.nextTickAt <= now && n++ < 6) {
      this.nextTickAt += TICK_MS
      const inputs = this.client.localTick(now, this.input)
      if (!inputs) break
      const you = this.view.you
      if (!you) break
      if (this.current === 'host') this.runner?.handle({ k: 'input', slot: you.slot, inputs: inputs.slice(-1) })
      else this.transport.send(this.view.hostId, encodeInput(this.view.epoch, you.slot, inputs))
    }
    this.flushEvents()
  }

  private slotOf(playerId: string): number | undefined {
    return this.view.players.find((p) => p.id === playerId && !p.bot)?.slot
  }

  private onPacket(from: string, data: ArrayBuffer): void {
    const pkt = decodePacket(data)
    if (!pkt) return
    const now = this.env.now()
    switch (pkt.t) {
      case 'snapshot':
        if (this.current === 'host' || from !== this.view.hostId || pkt.epoch !== this.view.epoch) return
        if (this.client.onSnapshot(pkt, now)) {
          this.switching = false
          this.flushEvents()
        }
        return
      case 'input': {
        if (this.current !== 'host' || pkt.epoch !== this.view.epoch) return
        const slot = this.slotOf(from)
        if (slot === undefined || slot !== pkt.slot) return
        this.runner?.handle({ k: 'input', slot, inputs: pkt.inputs })
        return
      }
      case 'ping':
        this.transport.send(from, encodePing(pkt.n, true))
        return
      case 'pong': {
        const rtt = Math.floor(now) - pkt.n
        if (rtt < 0 || rtt > 10_000) return
        if (this.current === 'host') {
          const slot = this.slotOf(from)
          if (slot !== undefined) this.runner?.handle({ k: 'ping', slot, pingMs: rtt })
        } else if (from === this.view.hostId) this.client.setPing(rtt)
        return
      }
      case 'hello':
        return
    }
  }

  private netStatus(now: number): NetStatus {
    if (this.current === 'host') return this.hostReady && !this.switching ? 'host' : this.switching ? 'trocando-host' : 'conectando'
    if (this.switching) return 'trocando-host'
    if (!this.client.hasSnapshot) return 'conectando'
    const age = now - this.client.lastReceiveAt
    if (age > STALE_OFFLINE_MS) return 'offline'
    if (age > STALE_CONNECTING_MS) return 'conectando'
    return this.transport.routeTo(this.view.hostId)
  }
}

