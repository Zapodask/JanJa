/**
 * Cliente da simulação: predição e reconciliação do próprio boneco, interpolação dos outros,
 * projéteis extrapolados, tiro previsto e eventos sem repetição. Sem DOM, sem rede, relógio injetado
 * (todo método que depende de tempo recebe `now` em ms). O host também usa isto (laço local).
 */
import {
  BTN_FIRE,
  INPUT_REDUNDANCY,
  INTERP_DELAY_MS,
  PICKUP_RESPAWN_TICKS,
  PLAYER_RADIUS,
  TICK_MS,
  WEAPONS,
  type Input,
  type MapDef,
  type MapId,
  type ScoreLine,
  type ShooterPlayerView,
  type SimApi,
  type SimPickup,
  type SimPlayer
} from '../../../../shared/games/shooter/types'
import { mergeStatics, quantizeInput, type SnapPlayer, type Snapshot, type SnapshotStatics } from '../../../../shared/games/shooter/codec'
import type { FrameEvent, InputState, RenderPickup, RenderPlayer, RenderProjectile, ShooterFrame } from '../contract'

/** correção menor que isto é suavizada; maior é teletransporte */
export const SMOOTH_MAX_PX = 24
export const SMOOTH_MS = 100
/** tiro previsto some depois disto se o real não chegar */
export const PREDICTED_SHOT_TTL_MS = 300
const MAX_SNAPS = 40
const MAX_PENDING = 120
/** distância que conta como teletransporte entre dois snapshots (respawn) */
const TELEPORT_PX = 64

interface PredictedShot {
  t0: number
  list: RenderProjectile[]
}

export interface ClientOptions {
  sim: Pick<SimApi, 'movePlayer'>
  getMap(id: MapId): MapDef
  /** meu slot (null = espectador) */
  me: number | null
  interpDelayMs?: number
}

export class ClientCore {
  readonly me: number | null
  private readonly sim: Pick<SimApi, 'movePlayer'>
  private readonly getMap: (id: MapId) => MapDef
  private readonly delay: number
  private snaps: Snapshot[] = []
  private epoch = -1
  private statics: SnapshotStatics | null = null
  private offset: number | null = null
  private lastRecvAt = 0
  private roster = new Map<number, ShooterPlayerView>()
  private seq = 0
  private pending: Input[] = []
  private sent: Input[] = []
  private pred: SimPlayer | null = null
  private predTick = 0
  private localNextFire = 0
  private smoothDx = 0
  private smoothDy = 0
  private smoothAt = 0
  private aimX = 1
  private aimY = 0
  private shots: PredictedShot[] = []
  private nextTempId = -1
  private seenEvents = new Set<number>()
  private firstSnapshot = true
  private out: FrameEvent[] = []
  private pingValue = 0
  private mapCache: MapDef | null = null

  constructor(opts: ClientOptions) {
    this.me = opts.me
    this.sim = opts.sim
    this.getMap = opts.getMap
    this.delay = opts.interpDelayMs ?? INTERP_DELAY_MS
  }

  // ---------- entrada de dados ----------

  setRoster(players: readonly ShooterPlayerView[]): void {
    this.roster = new Map(players.map((p) => [p.slot, p]))
  }

  setPing(ms: number): void {
    this.pingValue = this.pingValue === 0 ? ms : this.pingValue * 0.7 + ms * 0.3
  }

  get pingMs(): number {
    return Math.round(this.pingValue)
  }

  /**
   * Novo host: segue desenhando o último retrato até chegar o primeiro do epoch novo (aí esquece
   * snapshots e relógio, porque o tick recomeça de onde o novo host parou). Entradas pendentes e
   * sequência continuam.
   */
  beginEpoch(epoch: number): void {
    if (epoch === this.epoch) return
    this.epoch = epoch
    this.resetPending = true
  }
  private resetPending = false

  get latest(): Snapshot | undefined {
    return this.snaps[this.snaps.length - 1]
  }

  get latestStatics(): SnapshotStatics | null {
    return this.statics
  }

  get lastReceiveAt(): number {
    return this.lastRecvAt
  }

  get hasSnapshot(): boolean {
    return this.snaps.length > 0
  }

  /** Aplica um snapshot. Devolve false se for repetido, antigo ou de outro epoch. */
  onSnapshot(snap: Snapshot, now: number): boolean {
    if (snap.epoch !== this.epoch) {
      if (snap.epoch < this.epoch) return false
      this.beginEpoch(snap.epoch)
    }
    if (this.resetPending) {
      this.resetPending = false
      this.snaps = []
      this.offset = null
      this.firstSnapshot = true
      this.seenEvents.clear()
    }
    const last = this.latest
    if (last && snap.tick <= last.tick) return false
    this.statics = mergeStatics(this.statics, snap)
    this.snaps.push(snap)
    if (this.snaps.length > MAX_SNAPS) this.snaps.shift()
    this.lastRecvAt = now

    const sample = now - snap.tick * TICK_MS
    if (this.offset === null || sample < this.offset) this.offset = sample
    else this.offset += (sample - this.offset) * 0.01

    this.processEvents(snap, now)
    this.reconcile(snap, now)
    return true
  }

  private processEvents(snap: Snapshot, now: number): void {
    const ordinal = new Map<number, number>()
    for (const { tick, ev } of snap.events) {
      const i = ordinal.get(tick) ?? 0
      ordinal.set(tick, i + 1)
      const key = tick * 1024 + i
      if (this.seenEvents.has(key)) continue
      this.seenEvents.add(key)
      if (this.firstSnapshot) continue // histórico de antes de eu chegar: não toca de novo
      // meu tiro já foi tocado na hora (previsão); o real só tira o projétil previsto
      if (ev.type === 'shot' && this.me !== null && ev.slot === this.me) {
        this.shots.shift()
        continue
      }
      this.out.push(ev)
    }
    this.firstSnapshot = false
    if (this.seenEvents.size > 600) {
      const floor = (snap.tick - 400) * 1024
      for (const k of this.seenEvents) if (k < floor) this.seenEvents.delete(k)
    }
    this.shots = this.shots.filter((s) => now - s.t0 < PREDICTED_SHOT_TTL_MS)
  }

  /** eventos novos desde a última chamada */
  drainEvents(): FrameEvent[] {
    if (!this.out.length) return this.out
    const o = this.out
    this.out = []
    return o
  }

  private idOf(slot: number, bot: boolean): string {
    return this.roster.get(slot)?.id ?? this.statics?.ids[slot] ?? (bot ? `bot-${slot}` : `jogador-${slot}`)
  }

  private reconcile(snap: Snapshot, now: number): void {
    if (this.me === null) return
    const sp = snap.players.find((p) => p.slot === this.me)
    if (!sp) {
      this.pred = null
      return
    }
    this.pending = this.pending.filter((i) => i.seq > sp.lastSeq)
    const prev = this.pred
    const prevPos = prev ? this.renderPos(prev, now) : null
    const np: SimPlayer = { ...sp, id: this.idOf(sp.slot, sp.bot) }
    let tick = snap.tick
    if (np.alive && !np.away && snap.phase !== 'fim') {
      const map = this.map(snap.mapId)
      for (const i of this.pending) this.sim.movePlayer(map, np, i, ++tick)
    }
    this.pred = np
    this.predTick = tick
    if (prevPos && prev?.alive && np.alive) {
      const dx = prevPos.x - np.x
      const dy = prevPos.y - np.y
      if (Math.hypot(dx, dy) < SMOOTH_MAX_PX) {
        this.smoothDx = dx
        this.smoothDy = dy
        this.smoothAt = now
        return
      }
    }
    this.smoothDx = this.smoothDy = 0
  }

  private map(id: MapId): MapDef {
    if (!this.mapCache || this.mapCache.id !== id) this.mapCache = this.getMap(id)
    return this.mapCache
  }

  private smoothFactor(now: number): number {
    return Math.max(0, 1 - (now - this.smoothAt) / SMOOTH_MS)
  }

  private renderPos(p: { x: number; y: number }, now: number): { x: number; y: number } {
    const f = this.smoothFactor(now)
    return f > 0 ? { x: p.x + this.smoothDx * f, y: p.y + this.smoothDy * f } : { x: p.x, y: p.y }
  }

  // ---------- entrada local ----------

  /**
   * Um tick local: cria a entrada nova, prevê o movimento e o tiro. Devolve as últimas
   * INPUT_REDUNDANCY+1 entradas (a mais antiga primeiro) para mandar ao host, ou null se não joga.
   */
  localTick(now: number, st: InputState): Input[] | null {
    if (this.me === null) return null
    const snap = this.latest
    const mag = Math.hypot(st.ax, st.ay)
    const aimOk = mag > 1e-4
    const input = quantizeInput({
      seq: ++this.seq,
      mx: st.mx,
      my: st.my,
      ax: aimOk ? st.ax / mag : this.aimX,
      ay: aimOk ? st.ay / mag : this.aimY,
      buttons: st.buttons
    })
    if (aimOk) {
      this.aimX = st.ax / mag
      this.aimY = st.ay / mag
    }
    this.pending.push(input)
    if (this.pending.length > MAX_PENDING) this.pending.shift()
    this.sent.push(input)
    if (this.sent.length > INPUT_REDUNDANCY + 1) this.sent.shift()

    const p = this.pred
    if (snap && p && p.alive && !p.away && snap.phase !== 'fim') {
      this.sim.movePlayer(this.map(snap.mapId), p, input, ++this.predTick)
      if (input.buttons & BTN_FIRE) this.predictShot(p, input, now)
    }
    return this.sent.slice()
  }

  private predictShot(p: SimPlayer, input: Input, now: number): void {
    const spec = WEAPONS[p.weapon]
    if (p.ammo <= 0 || this.predTick < Math.max(p.nextFireTick, this.localNextFire)) return
    this.localNextFire = this.predTick + spec.cooldownTicks
    if (Number.isFinite(p.ammo)) p.ammo -= 1
    const ax = input.ax
    const ay = input.ay
    const ox = p.x + ax * (PLAYER_RADIUS + 3)
    const oy = p.y + ay * (PLAYER_RADIUS + 3)
    const list: RenderProjectile[] = []
    const n = spec.pellets
    for (let k = 0; k < n; k++) {
      const a = n > 1 ? (k / (n - 1) - 0.5) * spec.spread : 0
      const c = Math.cos(a)
      const s = Math.sin(a)
      list.push({
        id: this.nextTempId--,
        owner: p.slot,
        kind: spec.projectile,
        x: ox,
        y: oy,
        vx: (ax * c - ay * s) * spec.speed,
        vy: (ax * s + ay * c) * spec.speed,
        predicted: true
      })
    }
    this.shots.push({ t0: now, list })
    if (this.shots.length > 12) this.shots.shift()
    this.out.push({ type: 'shot', slot: p.slot, weapon: p.weapon, x: ox, y: oy, ax, ay, local: true })
  }

  // ---------- quadro ----------

  private hostNow(now: number): number {
    return this.offset === null ? 0 : now - this.offset
  }

  /** Quadro para desenhar. `net` e `pingMs` o dono da sessão preenche. */
  frame(now: number, roster?: readonly ShooterPlayerView[]): ShooterFrame | null {
    const last = this.latest
    if (!last || this.offset === null) return null
    if (roster) this.setRoster(roster)
    const hostNow = this.hostNow(now)
    const renderT = hostNow - this.delay
    const tickNow = Math.min(last.tick + 10, Math.max(last.tick, hostNow / TICK_MS))

    // par de snapshots em volta de renderT
    let a = this.snaps[0]
    let b = this.snaps[0]
    for (let i = this.snaps.length - 1; i >= 0; i--) {
      if (this.snaps[i].tick * TICK_MS <= renderT) {
        a = this.snaps[i]
        b = this.snaps[Math.min(i + 1, this.snaps.length - 1)]
        break
      }
    }
    if (renderT >= last.tick * TICK_MS) a = b = last
    const span = (b.tick - a.tick) * TICK_MS
    const u = span > 0 ? Math.min(1, Math.max(0, (renderT - a.tick * TICK_MS) / span)) : 0

    const players: RenderPlayer[] = []
    for (const sp of last.players) {
      if (sp.away) continue
      const isMe = this.me !== null && sp.slot === this.me
      let x = sp.x
      let y = sp.y
      let ax = sp.ax
      let ay = sp.ay
      if (isMe && this.pred) {
        const r = this.renderPos(this.pred, now)
        x = r.x
        y = r.y
        ax = this.aimX
        ay = this.aimY
        if (!this.pred.alive) {
          x = sp.x
          y = sp.y
        }
      } else {
        const pa = a.players.find((p) => p.slot === sp.slot)
        const pb = b.players.find((p) => p.slot === sp.slot)
        const q = pickPair(pa, pb, u)
        if (q) {
          x = q.x
          y = q.y
          ax = q.ax
          ay = q.ay
        }
      }
      const info = this.roster.get(sp.slot)
      players.push({
        slot: sp.slot,
        id: info?.id ?? this.idOf(sp.slot, sp.bot),
        name: info?.name ?? (sp.bot ? `Robô ${sp.slot - 7}` : 'Jogador'),
        bot: sp.bot,
        x,
        y,
        ax,
        ay,
        hp: sp.hp,
        alive: sp.alive,
        weapon: sp.weapon,
        ammo: sp.ammo,
        grenades: sp.grenades,
        dashing: sp.dashUntil > tickNow,
        invulnerable: sp.invulnUntil > tickNow,
        me: isMe,
        kills: sp.kills,
        deaths: sp.deaths
      })
    }

    const projectiles: RenderProjectile[] = []
    for (const pr of last.projectiles) {
      const mine = this.me !== null && pr.owner === this.me
      const t = ((mine ? hostNow : renderT) - last.tick * TICK_MS) / 1000
      const k = Math.max(-0.2, Math.min(0.35, t))
      projectiles.push({ id: pr.id, owner: pr.owner, kind: pr.kind, x: pr.x + pr.vx * k, y: pr.y + pr.vy * k, vx: pr.vx, vy: pr.vy, predicted: false })
    }
    for (const s of this.shots) {
      const age = now - s.t0
      if (age >= PREDICTED_SHOT_TTL_MS) continue
      for (const p of s.list) projectiles.push({ ...p, x: p.x + (p.vx * age) / 1000, y: p.y + (p.vy * age) / 1000 })
    }

    const map = this.map(last.mapId)
    const pickups: RenderPickup[] = last.pickups.map((pk) => pickupView(pk, map, tickNow))

    const timeLeftMs =
      last.phase === 'aquecendo'
        ? Math.max(0, (last.warmupEndTick - tickNow) * TICK_MS)
        : last.phase === 'jogando'
          ? Math.max(0, (last.endTick - tickNow) * TICK_MS)
          : 0

    return {
      mapId: last.mapId,
      phase: last.phase,
      timeLeftMs,
      killLimit: last.killLimit,
      me: this.me,
      players,
      projectiles,
      pickups,
      scores: this.scoresOf(last.players),
      net: 'conectando',
      pingMs: this.pingMs
    }
  }

  scoresOf(players: readonly SnapPlayer[]): ScoreLine[] {
    return players
      .map((p) => ({ id: this.roster.get(p.slot)?.id ?? this.idOf(p.slot, p.bot), kills: p.kills, deaths: p.deaths, damage: p.damage }))
      .sort((x, y) => y.kills - x.kills || x.deaths - y.deaths || y.damage - x.damage)
  }

  /** posição prevista do meu boneco (sem suavização), para testes */
  get predicted(): SimPlayer | null {
    return this.pred
  }

  get pendingCount(): number {
    return this.pending.length
  }
}

function pickPair(pa: SnapPlayer | undefined, pb: SnapPlayer | undefined, u: number) {
  if (pa && pb) {
    // morreu/nasceu ou teletransportou entre os dois: não interpola
    if (pa.alive !== pb.alive || Math.hypot(pb.x - pa.x, pb.y - pa.y) > TELEPORT_PX) return u < 0.5 ? pa : pb
    let ax = pa.ax + (pb.ax - pa.ax) * u
    let ay = pa.ay + (pb.ay - pa.ay) * u
    const l = Math.hypot(ax, ay)
    if (l > 1e-4) {
      ax /= l
      ay /= l
    } else {
      ax = pb.ax
      ay = pb.ay
    }
    return { x: pa.x + (pb.x - pa.x) * u, y: pa.y + (pb.y - pa.y) * u, ax, ay }
  }
  return pb ?? pa
}

function pickupView(pk: SimPickup, map: MapDef, tickNow: number): RenderPickup {
  const def = map.pickups[pk.id]
  const kind = def?.kind ?? pk.kind
  const available = pk.backTick <= tickNow
  const total = PICKUP_RESPAWN_TICKS[kind] || 1
  return {
    id: pk.id,
    kind,
    x: def?.x ?? pk.x,
    y: def?.y ?? pk.y,
    available,
    ready: available ? 1 : Math.max(0, Math.min(1, 1 - (pk.backTick - tickNow) / total))
  }
}
