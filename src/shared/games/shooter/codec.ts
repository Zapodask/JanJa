/**
 * Formato binário do Tiro na Sala (DataView, little-endian). Byte 0 = tipo, byte 1 = versão.
 * Roda igual no navegador, no Worker e no Node (sem Buffer, sem atob/btoa).
 *
 * Pacotes: HELLO (quem sou eu), INPUT (últimas entradas, redundantes), PING/PONG e SNAPSHOT.
 * Toda decodificação devolve `null` para pacote inválido (nunca lança).
 *
 * SNAPSHOT: o host manda o estado inteiro (simples, sem delta). A cada ~1 s vai o snapshot "cheio",
 * que leva também o que não muda (tabela de ids por slot e tipo/posição dos itens do mapa); o
 * receptor guarda isso em `SnapshotStatics` e usa para restaurar o jogo numa troca de host.
 */
import {
  BOT_SLOT_BASE,
  WEAPONS,
  type MapId,
  type PickupKind,
  type ProjectileKind,
  type SimEvent,
  type SimPhase,
  type SimPickup,
  type SimPlayer,
  type SimProjectile,
  type SimState,
  type WeaponId,
  type Input,
  GRENADE
} from './types'

export const CODEC_VERSION = 1

export const PKT_HELLO = 1
export const PKT_INPUT = 2
export const PKT_PING = 3
export const PKT_PONG = 4
export const PKT_SNAPSHOT = 5

/** maior pacote binário que cabe em RELAY_MAX_DATA (6000) depois do base64 */
export const MAX_PACKET_BYTES = 4400
/** um INPUT leva no máximo isto de entradas */
export const MAX_INPUTS_PER_PACKET = 8

const WEAPON_LIST: readonly WeaponId[] = ['pistola', 'escopeta', 'sub', 'rifle', 'rolha']
const KIND_LIST: readonly ProjectileKind[] = ['bala', 'bago', 'rifle', 'rolha', 'granada']
const PHASE_LIST: readonly SimPhase[] = ['aquecendo', 'jogando', 'fim']
const MAP_LIST: readonly MapId[] = ['casa', 'quintal']
const PICKUP_LIST: readonly PickupKind[] = ['pistola', 'escopeta', 'sub', 'rifle', 'rolha', 'vida']
/** índice de "granada" no campo de arma do projétil */
const GRENADE_W = 5

// ---------------------------------------------------------------------------------------
// Tipos dos pacotes
// ---------------------------------------------------------------------------------------

export interface HelloPacket {
  t: 'hello'
  playerId: string
  epoch: number
  /** true = resposta a um HELLO (quem recebe uma resposta não responde de novo) */
  reply: boolean
}

export interface InputPacket {
  t: 'input'
  epoch: number
  slot: number
  /** da mais antiga para a mais nova */
  inputs: Input[]
}

export interface PingPacket {
  t: 'ping' | 'pong'
  /** valor opaco (u32) devolvido como veio */
  n: number
}

/** Jogador no snapshot: igual ao SimPlayer, mas o id vem da tabela (`SnapshotStatics`). */
export type SnapPlayer = Omit<SimPlayer, 'id'>

export interface TimedEvent {
  /** tick em que aconteceu */
  tick: number
  ev: SimEvent
}

/** Parte que não muda durante a partida e só vai no snapshot cheio. */
export interface SnapshotStatics {
  /** playerId/`bot-N` por slot (posições sem jogador ficam '') */
  ids: string[]
  /** tipo e posição dos itens do mapa, por índice */
  pickups: { kind: PickupKind; x: number; y: number }[]
}

export interface Snapshot {
  epoch: number
  tick: number
  phase: SimPhase
  warmupEndTick: number
  endTick: number
  killLimit: number
  mapId: MapId
  rng: number
  nextId: number
  players: SnapPlayer[]
  projectiles: SimProjectile[]
  /** só `backTick` vem em todo snapshot; kind/x/y vêm dos statics (0/vazio se ainda não chegaram) */
  pickups: SimPickup[]
  events: TimedEvent[]
  /** presente só no snapshot cheio */
  statics: SnapshotStatics | null
}

export type Packet = HelloPacket | InputPacket | PingPacket | ({ t: 'snapshot' } & Snapshot)

// ---------------------------------------------------------------------------------------
// Leitura e escrita
// ---------------------------------------------------------------------------------------

const enc = new TextEncoder()
const dec = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })

class Writer {
  buf: Uint8Array
  dv: DataView
  p = 0
  constructor(cap: number) {
    this.buf = new Uint8Array(cap)
    this.dv = new DataView(this.buf.buffer)
  }
  private need(n: number) {
    if (this.p + n <= this.buf.length) return
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.p + n))
    next.set(this.buf)
    this.buf = next
    this.dv = new DataView(next.buffer)
  }
  u8(v: number) {
    this.need(1)
    this.dv.setUint8(this.p++, clampInt(v, 0, 255))
  }
  i8(v: number) {
    this.need(1)
    this.dv.setInt8(this.p++, clampInt(v, -128, 127))
  }
  u16(v: number) {
    this.need(2)
    this.dv.setUint16(this.p, clampInt(v, 0, 65535), true)
    this.p += 2
  }
  i16(v: number) {
    this.need(2)
    this.dv.setInt16(this.p, clampInt(v, -32768, 32767), true)
    this.p += 2
  }
  u32(v: number) {
    this.need(4)
    this.dv.setUint32(this.p, Number.isFinite(v) ? Math.min(0xffffffff, Math.max(0, Math.round(v))) : 0, true)
    this.p += 4
  }
  str(s: string) {
    const b = enc.encode(s).subarray(0, 255)
    this.u8(b.length)
    this.need(b.length)
    this.buf.set(b, this.p)
    this.p += b.length
  }
  head(type: number) {
    this.u8(type)
    this.u8(CODEC_VERSION)
  }
  done(): ArrayBuffer {
    return this.buf.slice(0, this.p).buffer as ArrayBuffer
  }
}

class Reader {
  dv: DataView
  p = 0
  constructor(private readonly bytes: Uint8Array) {
    this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }
  u8() {
    const v = this.dv.getUint8(this.p)
    this.p += 1
    return v
  }
  i8() {
    const v = this.dv.getInt8(this.p)
    this.p += 1
    return v
  }
  u16() {
    const v = this.dv.getUint16(this.p, true)
    this.p += 2
    return v
  }
  i16() {
    const v = this.dv.getInt16(this.p, true)
    this.p += 2
    return v
  }
  u32() {
    const v = this.dv.getUint32(this.p, true)
    this.p += 4
    return v
  }
  str() {
    const n = this.u8()
    if (this.p + n > this.bytes.length) throw new RangeError('str')
    const s = dec.decode(this.bytes.subarray(this.p, this.p + n))
    this.p += n
    return s
  }
  get left() {
    return this.bytes.length - this.p
  }
}

function clampInt(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return 0
  const r = Math.round(v)
  return r < lo ? lo : r > hi ? hi : r
}

const toBytes = (data: ArrayBuffer | Uint8Array): Uint8Array => (data instanceof Uint8Array ? data : new Uint8Array(data))

/** posição em 1/8 px, u16 */
const q8 = (v: number) => clampInt(v * 8, 0, 65535)
const d8 = (v: number) => v / 8

/** vetor unitário em int8 */
const qUnit = (v: number) => clampInt(v * 127, -127, 127)
const dUnit = (v: number) => v / 127

function normalize(x: number, y: number, fx: number, fy: number): [number, number] {
  const l = Math.sqrt(x * x + y * y)
  return l > 1e-6 ? [x / l, y / l] : [fx, fy]
}

// ---------------------------------------------------------------------------------------
// Entrada quantizada
// ---------------------------------------------------------------------------------------

/**
 * A entrada do jeito que o host vai enxergá (int8 em mx/my/ax/ay). O cliente aplica ISTO na
 * predição, assim o boneco previsto e o do host andam igual.
 */
export function quantizeInput(i: Input): Input {
  const f = (v: number) => (Number.isFinite(v) ? dUnit(qUnit(Math.max(-1, Math.min(1, v)))) : 0)
  return { seq: i.seq >>> 0, mx: f(i.mx), my: f(i.my), ax: f(i.ax), ay: f(i.ay), buttons: i.buttons & 0xff }
}

// ---------------------------------------------------------------------------------------
// HELLO / INPUT / PING / PONG
// ---------------------------------------------------------------------------------------

export function encodeHello(playerId: string, epoch: number, reply = false): ArrayBuffer {
  const w = new Writer(32)
  w.head(PKT_HELLO)
  w.u16(epoch)
  w.u8(reply ? 1 : 0)
  w.str(playerId)
  return w.done()
}

export function encodeInput(epoch: number, slot: number, inputs: readonly Input[]): ArrayBuffer {
  const list = inputs.slice(-MAX_INPUTS_PER_PACKET)
  const w = new Writer(6 + list.length * 9)
  w.head(PKT_INPUT)
  w.u16(epoch)
  w.u8(slot)
  w.u8(list.length)
  for (const i of list) {
    w.u32(i.seq)
    w.i8(qUnit(i.mx))
    w.i8(qUnit(i.my))
    w.i8(qUnit(i.ax))
    w.i8(qUnit(i.ay))
    w.u8(i.buttons)
  }
  return w.done()
}

export function encodePing(n: number, pong = false): ArrayBuffer {
  const w = new Writer(6)
  w.head(pong ? PKT_PONG : PKT_PING)
  w.u32(n)
  return w.done()
}

// ---------------------------------------------------------------------------------------
// SNAPSHOT: montar a partir do estado e restaurar
// ---------------------------------------------------------------------------------------

export interface SnapshotOptions {
  epoch: number
  /** snapshot cheio: leva tabela de ids e itens do mapa */
  full?: boolean
}

/** Retrato do estado para a rede. `recentEvents` = eventos dos últimos ticks (redundância contra perda). */
export function snapshotFromState(state: SimState, recentEvents: readonly TimedEvent[], opts: SnapshotOptions): Snapshot {
  const players: SnapPlayer[] = state.players.map((p) => {
    const { id: _id, ...rest } = p
    void _id
    return { ...rest }
  })
  let statics: SnapshotStatics | null = null
  if (opts.full) {
    const ids: string[] = []
    for (const p of state.players) ids[p.slot] = p.id
    for (let i = 0; i < ids.length; i++) ids[i] ??= ''
    statics = { ids, pickups: state.pickups.map((k) => ({ kind: k.kind, x: k.x, y: k.y })) }
  }
  return {
    epoch: opts.epoch,
    tick: state.tick,
    phase: state.phase,
    warmupEndTick: state.warmupEndTick,
    endTick: state.endTick,
    killLimit: state.killLimit,
    mapId: state.mapId,
    rng: state.rng,
    nextId: state.nextId,
    players,
    projectiles: state.projectiles.map((p) => ({ ...p })),
    pickups: state.pickups.map((k) => ({ ...k })),
    events: recentEvents.map((e) => ({ tick: e.tick, ev: e.ev })),
    statics
  }
}

/** Junta a tabela estática mais recente com a de um snapshot novo (o cheio sobrescreve). */
export function mergeStatics(prev: SnapshotStatics | null, snap: Snapshot): SnapshotStatics | null {
  return snap.statics ?? prev
}

/**
 * SimState válido para continuar a partida (troca de host). `statics` = a tabela mais recente
 * (se o snapshot for cheio ele mesmo serve). Sem id de algum slot usa `jogador-<slot>`.
 */
export function restoreState(snap: Snapshot, statics: SnapshotStatics | null = snap.statics): SimState {
  const ids = statics?.ids ?? []
  const players: SimPlayer[] = snap.players.map((p) => ({
    ...p,
    id: ids[p.slot] || (p.bot ? `bot-${p.slot - BOT_SLOT_BASE + 1}` : `jogador-${p.slot}`)
  }))
  const pickups: SimPickup[] = snap.pickups.map((k, i) => {
    const s = statics?.pickups[i]
    return { id: i, kind: s?.kind ?? k.kind, x: s?.x ?? k.x, y: s?.y ?? k.y, backTick: k.backTick }
  })
  return {
    mapId: snap.mapId,
    tick: snap.tick,
    phase: snap.phase,
    warmupEndTick: snap.warmupEndTick,
    endTick: snap.endTick,
    killLimit: snap.killLimit,
    rng: snap.rng >>> 0,
    nextId: snap.nextId,
    players,
    projectiles: snap.projectiles.map((p) => ({ ...p })),
    pickups
  }
}

const W_MASK = 7
const SPEED_STEP = 4
const PICKUP_STEP = 8
/** ticks → u16 */
const delta16 = (v: number, tick: number) => clampInt(v - tick, 0, 65535)
const delta8 = (v: number, tick: number) => clampInt(v - tick, 0, 255)
const at = (d: number, tick: number) => (d === 0 ? 0 : tick + d)

export function encodeSnapshot(s: Snapshot): ArrayBuffer {
  const w = new Writer(1024)
  const tick = s.tick
  w.head(PKT_SNAPSHOT)
  w.u16(s.epoch)
  w.u32(tick)
  w.u8(PHASE_LIST.indexOf(s.phase))
  w.u32(s.warmupEndTick)
  w.u32(s.endTick)
  w.u8(s.killLimit)
  w.u8(MAP_LIST.indexOf(s.mapId))
  w.u32(s.rng)
  w.u32(s.nextId)
  w.u8(s.statics ? 1 : 0)
  w.u8(s.players.length)
  w.u8(Math.min(255, s.projectiles.length))
  w.u8(s.pickups.length)
  // eventos: no máximo 255, os mais novos
  const events = s.events.slice(-255)
  w.u8(events.length)

  if (s.statics) {
    const slots = s.players.map((p) => p.slot)
    w.u8(slots.length)
    for (const slot of slots) {
      w.u8(slot)
      w.str(s.statics.ids[slot] ?? '')
    }
    for (const k of s.statics.pickups) {
      w.u8(PICKUP_LIST.indexOf(k.kind))
      w.u16(q8(k.x))
      w.u16(q8(k.y))
    }
  }

  for (const p of s.players) {
    const wi = Math.max(0, WEAPON_LIST.indexOf(p.weapon))
    const dRespawn = p.alive ? 0 : delta16(p.respawnTick, tick)
    const dInvuln = delta8(p.invulnUntil, tick)
    const dFire = delta8(p.nextFireTick, tick)
    const dDash = delta8(p.dashUntil, tick)
    const dReady = delta8(p.dashReadyTick, tick)
    const dRegen = clampInt(p.grenadeRegenTick - tick, 0, 65535)
    const knock = Math.round(p.kx / 2) !== 0 || Math.round(p.ky / 2) !== 0
    w.u8(p.slot)
    w.u8((p.alive ? 1 : 0) | (p.away ? 2 : 0) | (p.bot ? 4 : 0) | (wi << 3) | (clampInt(p.grenades, 0, 3) << 6))
    w.u8(
      (knock ? 1 : 0) |
        (dDash > 0 ? 2 : 0) |
        (dRespawn > 0 ? 4 : 0) |
        (dInvuln > 0 ? 8 : 0) |
        (dFire > 0 ? 16 : 0) |
        (dReady > 0 ? 32 : 0) |
        (dRegen > 0 ? 64 : 0)
    )
    w.u8(p.hp)
    w.u8(Number.isFinite(p.ammo) ? Math.min(254, p.ammo) : 255)
    w.u8(p.streak)
    w.u16(q8(p.x))
    w.u16(q8(p.y))
    w.i8(qUnit(p.ax))
    w.i8(qUnit(p.ay))
    w.u8(p.kills)
    w.u8(p.deaths)
    w.u16(p.damage)
    w.u32(p.lastSeq)
    if (knock) {
      w.i8(p.kx / 2)
      w.i8(p.ky / 2)
    }
    if (dDash > 0) {
      w.u8(dDash)
      w.i8(qUnit(p.dashX))
      w.i8(qUnit(p.dashY))
    }
    if (dRespawn > 0) w.u16(dRespawn)
    if (dInvuln > 0) w.u8(dInvuln)
    if (dFire > 0) w.u8(dFire)
    if (dReady > 0) w.u8(dReady)
    if (dRegen > 0) w.u16(dRegen)
  }

  for (let i = 0; i < Math.min(255, s.projectiles.length); i++) {
    const p = s.projectiles[i]
    const wi = p.weapon === 'granada' ? GRENADE_W : Math.max(0, WEAPON_LIST.indexOf(p.weapon))
    w.u16(p.id & 0xffff)
    w.u16((p.owner & 15) | (Math.max(0, KIND_LIST.indexOf(p.kind)) << 4) | (wi << 7))
    w.u16(q8(p.x))
    w.u16(q8(p.y))
    // velocidade em polar: ângulo u16 e módulo em passos de 4 px/s
    w.u16(((Math.atan2(p.vy, p.vx) / (2 * Math.PI) + 1) % 1) * 65536)
    w.u8(Math.hypot(p.vx, p.vy) / SPEED_STEP)
    w.u8(delta8(p.dieTick, tick))
  }

  // volta do item em passos de 8 ticks (0,2 s), arredondando para cima
  for (const k of s.pickups) w.u8(k.backTick > tick ? Math.ceil((k.backTick - tick) / PICKUP_STEP) : 0)

  for (const { tick: t, ev } of events) {
    writeEvent(w, ev, clampInt(tick - t, 0, 255))
  }
  return w.done()
}

const EV_TYPES = ['shot', 'grenade', 'hit', 'kill', 'spawn', 'pickup', 'explode', 'wall', 'dash', 'phase'] as const

function writeEvent(w: Writer, ev: SimEvent, ago: number): void {
  w.u8(EV_TYPES.indexOf(ev.type))
  w.u8(ago)
  switch (ev.type) {
    case 'shot':
      w.u8(ev.slot)
      w.u8(WEAPON_LIST.indexOf(ev.weapon))
      w.u16(q8(ev.x))
      w.u16(q8(ev.y))
      w.i8(qUnit(ev.ax))
      w.i8(qUnit(ev.ay))
      break
    case 'grenade':
      w.u8(ev.slot)
      w.u16(q8(ev.x))
      w.u16(q8(ev.y))
      break
    case 'hit':
      w.u8(ev.victim)
      w.u8(ev.attacker)
      w.u8(ev.damage)
      w.u16(q8(ev.x))
      w.u16(q8(ev.y))
      break
    case 'kill':
      w.u8(ev.victim)
      w.u8(ev.killer)
      w.u8(ev.weapon === 'granada' ? GRENADE_W : WEAPON_LIST.indexOf(ev.weapon))
      w.u8(ev.streak)
      break
    case 'spawn':
      w.u8(ev.slot)
      w.u16(q8(ev.x))
      w.u16(q8(ev.y))
      break
    case 'pickup':
      w.u8(ev.slot)
      w.u8(PICKUP_LIST.indexOf(ev.kind))
      w.u8(ev.pickupId)
      break
    case 'explode':
      w.u16(q8(ev.x))
      w.u16(q8(ev.y))
      w.u8(ev.radius)
      break
    case 'wall':
      w.u16(q8(ev.x))
      w.u16(q8(ev.y))
      break
    case 'dash':
      w.u8(ev.slot)
      break
    case 'phase':
      w.u8(PHASE_LIST.indexOf(ev.phase))
      break
  }
}

const pick = <T>(list: readonly T[], i: number): T => {
  const v = list[i]
  if (v === undefined) throw new RangeError('índice')
  return v
}

function readEvent(r: Reader, tick: number): TimedEvent {
  const type = pick(EV_TYPES, r.u8())
  const t = tick - r.u8()
  let ev: SimEvent
  switch (type) {
    case 'shot': {
      const slot = r.u8()
      const weapon = pick(WEAPON_LIST, r.u8())
      const x = d8(r.u16())
      const y = d8(r.u16())
      const [ax, ay] = normalize(dUnit(r.i8()), dUnit(r.i8()), 1, 0)
      ev = { type, slot, weapon, x, y, ax, ay }
      break
    }
    case 'grenade':
      ev = { type, slot: r.u8(), x: d8(r.u16()), y: d8(r.u16()) }
      break
    case 'hit':
      ev = { type, victim: r.u8(), attacker: r.u8(), damage: r.u8(), x: d8(r.u16()), y: d8(r.u16()) }
      break
    case 'kill': {
      const victim = r.u8()
      const killer = r.u8()
      const wi = r.u8()
      const weapon: WeaponId | 'granada' = wi === GRENADE_W ? 'granada' : pick(WEAPON_LIST, wi)
      ev = { type, victim, killer, weapon, streak: r.u8() }
      break
    }
    case 'spawn':
      ev = { type, slot: r.u8(), x: d8(r.u16()), y: d8(r.u16()) }
      break
    case 'pickup':
      ev = { type, slot: r.u8(), kind: pick(PICKUP_LIST, r.u8()), pickupId: r.u8() }
      break
    case 'explode':
      ev = { type, x: d8(r.u16()), y: d8(r.u16()), radius: r.u8() }
      break
    case 'wall':
      ev = { type, x: d8(r.u16()), y: d8(r.u16()) }
      break
    case 'dash':
      ev = { type, slot: r.u8() }
      break
    case 'phase':
      ev = { type, phase: pick(PHASE_LIST, r.u8()) }
      break
  }
  return { tick: t, ev }
}

function readSnapshot(r: Reader): Snapshot {
  const epoch = r.u16()
  const tick = r.u32()
  const phase = pick(PHASE_LIST, r.u8())
  const warmupEndTick = r.u32()
  const endTick = r.u32()
  const killLimit = r.u8()
  const mapId = pick(MAP_LIST, r.u8())
  const rng = r.u32()
  const nextId = r.u32()
  const flags = r.u8()
  const nPlayers = r.u8()
  const nProj = r.u8()
  const nPick = r.u8()
  const nEvents = r.u8()
  if (nPlayers > 16) throw new RangeError('jogadores')

  let statics: SnapshotStatics | null = null
  if (flags & 1) {
    const n = r.u8()
    const ids: string[] = []
    for (let i = 0; i < n; i++) {
      const slot = r.u8()
      if (slot > 15) throw new RangeError('slot')
      ids[slot] = r.str()
    }
    for (let i = 0; i < ids.length; i++) ids[i] ??= ''
    const pickups: SnapshotStatics['pickups'] = []
    for (let i = 0; i < nPick; i++) pickups.push({ kind: pick(PICKUP_LIST, r.u8()), x: d8(r.u16()), y: d8(r.u16()) })
    statics = { ids, pickups }
  }

  const players: SnapPlayer[] = []
  for (let i = 0; i < nPlayers; i++) {
    const slot = r.u8()
    if (slot > 15) throw new RangeError('slot')
    const fl = r.u8()
    const fl2 = r.u8()
    const hp = r.u8()
    const ammoRaw = r.u8()
    const streak = r.u8()
    const x = d8(r.u16())
    const y = d8(r.u16())
    const [ax, ay] = normalize(dUnit(r.i8()), dUnit(r.i8()), 1, 0)
    const kills = r.u8()
    const deaths = r.u8()
    const damage = r.u16()
    const lastSeq = r.u32()
    let kx = 0
    let ky = 0
    if (fl2 & 1) {
      kx = r.i8() * 2
      ky = r.i8() * 2
    }
    let dashUntil = 0
    let dashX = 1
    let dashY = 0
    if (fl2 & 2) {
      dashUntil = at(r.u8(), tick)
      ;[dashX, dashY] = normalize(dUnit(r.i8()), dUnit(r.i8()), 1, 0)
    }
    const respawnTick = fl2 & 4 ? at(r.u16(), tick) : 0
    const invulnUntil = fl2 & 8 ? at(r.u8(), tick) : 0
    const nextFireTick = fl2 & 16 ? at(r.u8(), tick) : 0
    const dashReadyTick = fl2 & 32 ? at(r.u8(), tick) : 0
    const grenadeRegenTick = fl2 & 64 ? at(r.u16(), tick) : 0
    const prevButtons = 0
    players.push({
      slot,
      bot: (fl & 4) !== 0,
      away: (fl & 2) !== 0,
      x,
      y,
      kx,
      ky,
      ax,
      ay,
      hp,
      alive: (fl & 1) !== 0,
      respawnTick,
      invulnUntil,
      weapon: pick(WEAPON_LIST, (fl >> 3) & W_MASK),
      ammo: ammoRaw === 255 ? Infinity : ammoRaw,
      nextFireTick,
      dashUntil,
      dashReadyTick,
      dashX,
      dashY,
      grenades: fl >> 6,
      grenadeRegenTick,
      kills,
      deaths,
      damage,
      streak,
      lastSeq,
      prevButtons
    })
  }

  const projectiles: SimProjectile[] = []
  for (let i = 0; i < nProj; i++) {
    const id16 = r.u16()
    const pack = r.u16()
    const x = d8(r.u16())
    const y = d8(r.u16())
    const ang = (r.u16() / 65536) * 2 * Math.PI
    const spd = r.u8() * SPEED_STEP
    const vx = Math.round(Math.cos(ang) * spd)
    const vy = Math.round(Math.sin(ang) * spd)
    const dieTick = at(r.u8(), tick)
    const wi = (pack >> 7) & 7
    const weapon: WeaponId | 'granada' = wi === GRENADE_W ? 'granada' : pick(WEAPON_LIST, wi)
    const kind = pick(KIND_LIST, (pack >> 4) & 7)
    // reconstrói o id completo a partir do nextId (ids são crescentes)
    const id = nextId - ((nextId - id16) & 0xffff)
    projectiles.push({
      id,
      owner: pack & 15,
      kind,
      weapon,
      x,
      y,
      vx,
      vy,
      damage: weapon === 'granada' ? GRENADE.damage : WEAPONS[weapon].damage,
      dieTick
    })
  }

  const pickups: SimPickup[] = []
  for (let i = 0; i < nPick; i++) {
    const back = r.u8()
    const st = statics?.pickups[i]
    pickups.push({ id: i, kind: st?.kind ?? 'vida', x: st?.x ?? 0, y: st?.y ?? 0, backTick: back === 0 ? 0 : tick + back * PICKUP_STEP })
  }

  const events: TimedEvent[] = []
  for (let i = 0; i < nEvents; i++) events.push(readEvent(r, tick))

  if (r.left !== 0) throw new RangeError('sobra')
  return { epoch, tick, phase, warmupEndTick, endTick, killLimit, mapId, rng, nextId, players, projectiles, pickups, events, statics }
}

// ---------------------------------------------------------------------------------------
// Decodificação geral
// ---------------------------------------------------------------------------------------

/** Tipo do pacote sem decodificar tudo (ou null). */
export function packetType(data: ArrayBuffer | Uint8Array): number | null {
  const b = toBytes(data)
  return b.length >= 2 && b[1] === CODEC_VERSION && b[0] >= PKT_HELLO && b[0] <= PKT_SNAPSHOT ? b[0] : null
}

/** Decodifica qualquer pacote. Inválido, curto, de outra versão ou com sobra: null. */
export function decodePacket(data: ArrayBuffer | Uint8Array): Packet | null {
  try {
    const bytes = toBytes(data)
    if (bytes.length < 2 || bytes.length > MAX_PACKET_BYTES * 2 || bytes[1] !== CODEC_VERSION) return null
    const r = new Reader(bytes)
    const type = r.u8()
    r.u8()
    switch (type) {
      case PKT_HELLO: {
        const epoch = r.u16()
        const reply = r.u8() === 1
        const playerId = r.str()
        if (r.left !== 0 || !playerId) return null
        return { t: 'hello', playerId, epoch, reply }
      }
      case PKT_INPUT: {
        const epoch = r.u16()
        const slot = r.u8()
        const n = r.u8()
        if (slot > 15 || n === 0 || n > MAX_INPUTS_PER_PACKET || r.left !== n * 9) return null
        const inputs: Input[] = []
        for (let i = 0; i < n; i++) {
          const seq = r.u32()
          const mx = dUnit(r.i8())
          const my = dUnit(r.i8())
          const ax = dUnit(r.i8())
          const ay = dUnit(r.i8())
          inputs.push({ seq, mx, my, ax, ay, buttons: r.u8() })
        }
        return { t: 'input', epoch, slot, inputs }
      }
      case PKT_PING:
      case PKT_PONG: {
        const n = r.u32()
        if (r.left !== 0) return null
        return { t: type === PKT_PING ? 'ping' : 'pong', n }
      }
      case PKT_SNAPSHOT:
        return { t: 'snapshot', ...readSnapshot(r) }
      default:
        return null
    }
  } catch {
    return null
  }
}

export const decodeHello = (d: ArrayBuffer | Uint8Array): HelloPacket | null => {
  const p = decodePacket(d)
  return p?.t === 'hello' ? p : null
}
export const decodeInput = (d: ArrayBuffer | Uint8Array): InputPacket | null => {
  const p = decodePacket(d)
  return p?.t === 'input' ? p : null
}
export const decodePing = (d: ArrayBuffer | Uint8Array): PingPacket | null => {
  const p = decodePacket(d)
  return p?.t === 'ping' || p?.t === 'pong' ? p : null
}
export const decodeSnapshot = (d: ArrayBuffer | Uint8Array): Snapshot | null => {
  const p = decodePacket(d)
  if (p?.t !== 'snapshot') return null
  const { t: _t, ...snap } = p
  void _t
  return snap
}

// ---------------------------------------------------------------------------------------
// base64 (sem Buffer, sem atob/btoa)
// ---------------------------------------------------------------------------------------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64_REV = (() => {
  const t = new Int8Array(128).fill(-1)
  for (let i = 0; i < 64; i++) t[B64.charCodeAt(i)] = i
  return t
})()

export function toBase64(data: ArrayBuffer | Uint8Array): string {
  const b = toBytes(data)
  const parts: string[] = []
  let chunk = ''
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0)
    chunk += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < b.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < b.length ? B64[n & 63] : '=')
    if (chunk.length >= 4096) {
      parts.push(chunk)
      chunk = ''
    }
  }
  parts.push(chunk)
  return parts.join('')
}

/** base64 → bytes, ou null se o texto não for base64 válido. */
export function fromBase64(text: string): ArrayBuffer | null {
  if (text.length % 4 !== 0) return null
  let pad = 0
  if (text.endsWith('==')) pad = 2
  else if (text.endsWith('=')) pad = 1
  const out = new Uint8Array((text.length / 4) * 3 - pad)
  let o = 0
  for (let i = 0; i < text.length; i += 4) {
    let n = 0
    for (let j = 0; j < 4; j++) {
      const c = text.charCodeAt(i + j)
      let v: number
      if (c === 61 && i + j >= text.length - pad) v = 0
      else {
        v = c < 128 ? B64_REV[c] : -1
        if (v < 0) return null
      }
      n = (n << 6) | v
    }
    if (o < out.length) out[o++] = (n >> 16) & 255
    if (o < out.length) out[o++] = (n >> 8) & 255
    if (o < out.length) out[o++] = n & 255
  }
  return out.buffer as ArrayBuffer
}
