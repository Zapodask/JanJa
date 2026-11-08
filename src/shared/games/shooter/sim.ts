/**
 * Simulação do Tiro na Sala (roda no navegador do host, 40 Hz). Determinística: só o RNG do estado.
 * `step` muta o estado; use `cloneState` para prever/testar.
 *
 * Sobre JSON: `ammo` da pistola é Infinity, que o JSON transforma em null. structuredClone preserva;
 * quem serializar em JSON deve chamar `reviveState` depois de ler.
 */
import { botInput } from './bots'
import { circleBlocked, pointShotBlocked, pointSolid, shotClear, tileIndex } from './geom'
import { getMap, gridOf } from './maps'
import type { MapGrid } from './maps/legend'
import { rngInt, rngNext } from './rng'
import {
  BLAST_EDGE_FACTOR,
  BLAST_KNOCKBACK,
  BTN_DASH,
  BTN_FIRE,
  BTN_GRENADE,
  DASH_COOLDOWN_TICKS,
  DASH_SPEED,
  DASH_TICKS,
  DT,
  EMPTY_INPUT,
  GRENADE,
  HEAL_AMOUNT,
  MAX_HP,
  PICKUP_RADIUS,
  PICKUP_RESPAWN_TICKS,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  RESPAWN_TICKS,
  SELF_BLAST_FACTOR,
  SPAWN_INVULN_TICKS,
  TICK_HZ,
  WARMUP_TICKS,
  WATER_SPEED_MUL,
  WEAPONS,
  type Input,
  type MapDef,
  type ScoreLine,
  type ShooterOptions,
  type SimApi,
  type SimEvent,
  type SimPlayer,
  type SimPlayerRef,
  type SimProjectile,
  type SimState,
  type WeaponId
} from './types'

const KNOCK_DECAY = 0.85
const KNOCK_MAX = 420
const PROJ_HIT_R2 = (PLAYER_RADIUS + 1.5) * (PLAYER_RADIUS + 1.5)
const MAX_LAG = 6
const GRENADE_BOUNCE = 0.6

const fin = (x: number, d = 0): number => (typeof x === 'number' && Number.isFinite(x) ? x : d)

// =====================================================================================
// Movimento (também usado pelo cliente na predição)
// =====================================================================================

function moveAxis(g: MapGrid, p: SimPlayer, dx: number, dy: number): void {
  if (dx !== 0) {
    const nx = p.x + dx
    if (!circleBlocked(g, nx, p.y, PLAYER_RADIUS)) p.x = nx
    else p.x += dx * freeFraction(g, p.x, p.y, dx, 0)
  }
  if (dy !== 0) {
    const ny = p.y + dy
    if (!circleBlocked(g, p.x, ny, PLAYER_RADIUS)) p.y = ny
    else p.y += dy * freeFraction(g, p.x, p.y, 0, dy)
  }
}

/** maior fração (0..1) do deslocamento que ainda cabe (bisseção) */
function freeFraction(g: MapGrid, x: number, y: number, dx: number, dy: number): number {
  let lo = 0
  let hi = 1
  for (let i = 0; i < 6; i++) {
    const mid = (lo + hi) / 2
    if (circleBlocked(g, x + dx * mid, y + dy * mid, PLAYER_RADIUS)) hi = mid
    else lo = mid
  }
  return lo
}

export function movePlayer(map: MapDef, p: SimPlayer, input: Input, tick: number): void {
  const g = gridOf(map)
  let mx = fin(input.mx)
  let my = fin(input.my)
  const len = Math.sqrt(mx * mx + my * my)
  if (len > 1) {
    mx /= len
    my /= len
  }
  let dashing = tick < p.dashUntil
  if (!dashing && (input.buttons & BTN_DASH) !== 0 && tick >= p.dashReadyTick) {
    let dx = mx
    let dy = my
    let dl = Math.sqrt(dx * dx + dy * dy)
    if (dl < 0.1) {
      // parado: dash na direção da mira
      dx = fin(input.ax, p.ax)
      dy = fin(input.ay, p.ay)
      dl = Math.sqrt(dx * dx + dy * dy)
      if (dl < 0.01) {
        dx = p.ax
        dy = p.ay
        dl = Math.sqrt(dx * dx + dy * dy) || 1
      }
    }
    p.dashX = dx / dl
    p.dashY = dy / dl
    p.dashUntil = tick + DASH_TICKS
    p.dashReadyTick = tick + DASH_COOLDOWN_TICKS
    dashing = true
  }
  let vx: number
  let vy: number
  if (dashing) {
    vx = p.dashX * DASH_SPEED
    vy = p.dashY * DASH_SPEED
  } else {
    const i = tileIndex(g, p.x, p.y)
    const sp = i >= 0 && g.slow[i] === 1 ? PLAYER_SPEED * WATER_SPEED_MUL : PLAYER_SPEED
    vx = mx * sp
    vy = my * sp
  }
  vx += p.kx
  vy += p.ky
  p.kx *= KNOCK_DECAY
  p.ky *= KNOCK_DECAY
  if (p.kx > -0.5 && p.kx < 0.5) p.kx = 0
  if (p.ky > -0.5 && p.ky < 0.5) p.ky = 0
  moveAxis(g, p, vx * DT, vy * DT)
}

// =====================================================================================
// Criação e utilidades do estado
// =====================================================================================

function newPlayer(ref: SimPlayerRef): SimPlayer {
  return {
    slot: ref.slot,
    id: ref.id,
    bot: ref.bot,
    away: false,
    x: 0,
    y: 0,
    kx: 0,
    ky: 0,
    ax: 1,
    ay: 0,
    hp: MAX_HP,
    alive: true,
    respawnTick: 0,
    invulnUntil: 0,
    weapon: 'pistola',
    ammo: Infinity,
    nextFireTick: 0,
    dashUntil: 0,
    dashReadyTick: 0,
    dashX: 1,
    dashY: 0,
    grenades: GRENADE.maxCarry,
    grenadeRegenTick: 0,
    kills: 0,
    deaths: 0,
    damage: 0,
    streak: 0,
    lastSeq: 0,
    prevButtons: 0
  }
}

/** Nasce no spawn livre mais longe dos inimigos vivos (sem inimigos: sorteia). */
function spawnPlayer(state: SimState, map: MapDef, p: SimPlayer, events: SimEvent[] | null): void {
  let best = -1
  let bestD = -1
  for (let i = 0; i < map.spawns.length; i++) {
    const s = map.spawns[i]
    let minD = Infinity
    for (const q of state.players) {
      if (q === p || !q.alive || q.away) continue
      const dx = q.x - s.x
      const dy = q.y - s.y
      const d = dx * dx + dy * dy
      if (d < minD) minD = d
    }
    if (minD === Infinity) continue
    if (minD > bestD) {
      bestD = minD
      best = i
    }
  }
  if (best < 0) best = rngInt(state, map.spawns.length)
  const s = map.spawns[best]
  const t = state.tick
  p.x = s.x
  p.y = s.y
  p.kx = 0
  p.ky = 0
  p.hp = MAX_HP
  p.alive = true
  p.invulnUntil = t + SPAWN_INVULN_TICKS
  p.weapon = 'pistola'
  p.ammo = Infinity
  p.nextFireTick = t
  p.dashUntil = t
  p.dashReadyTick = t
  p.grenades = GRENADE.maxCarry
  p.grenadeRegenTick = t + GRENADE.regenTicks
  p.prevButtons = 0
  if (events) events.push({ type: 'spawn', slot: p.slot, x: p.x, y: p.y })
}

export function createSim(players: SimPlayerRef[], opts: ShooterOptions, seed: number): SimState {
  const map = getMap(opts.mapId)
  const state: SimState = {
    mapId: opts.mapId,
    tick: 0,
    phase: 'aquecendo',
    warmupEndTick: WARMUP_TICKS,
    endTick: WARMUP_TICKS + opts.minutes * 60 * TICK_HZ,
    killLimit: opts.killLimit,
    rng: seed >>> 0,
    nextId: 1,
    players: [],
    projectiles: [],
    pickups: map.pickups.map((p, i) => ({ id: i, kind: p.kind, x: p.x, y: p.y, backTick: 0 }))
  }
  for (const ref of [...players].sort((a, b) => a.slot - b.slot)) {
    const p = newPlayer(ref)
    state.players.push(p)
    spawnPlayer(state, map, p, null)
  }
  return state
}

export function addPlayer(state: SimState, ref: SimPlayerRef): void {
  const map = getMap(state.mapId)
  const old = state.players.find((q) => q.slot === ref.slot)
  if (old) {
    // mesmo slot voltando: só reativa
    old.id = ref.id
    old.bot = ref.bot
    old.away = false
    return
  }
  const p = newPlayer(ref)
  state.players.push(p)
  spawnPlayer(state, map, p, null)
}

export function setAway(state: SimState, slot: number, away: boolean): void {
  const p = state.players.find((q) => q.slot === slot)
  if (!p || p.away === away) return
  p.away = away
  p.prevButtons = 0
  // ao sair/voltar, não repete botões segurados
  if (p.lastInput) p.lastInput = { ...p.lastInput, buttons: 0, mx: 0, my: 0, lagTicks: undefined }
}

export function cloneState(s: SimState): SimState {
  return {
    ...s,
    players: s.players.map((p) => {
      const c: SimPlayer = { ...p }
      if (p.lastInput) c.lastInput = { ...p.lastInput }
      if (p.ai) c.ai = { ...p.ai }
      return c
    }),
    projectiles: s.projectiles.map((q) => ({ ...q })),
    pickups: s.pickups.map((q) => ({ ...q }))
  }
}

/** Depois de ler o estado de um JSON: Infinity virou null; volta para a pistola infinita. */
export function reviveState(s: SimState): SimState {
  for (const p of s.players) if (p.weapon === 'pistola' || p.ammo === null || p.ammo === undefined) p.ammo = Infinity
  return s
}

export function scores(state: SimState): ScoreLine[] {
  return state.players.map((p) => ({ id: p.id, kills: p.kills, deaths: p.deaths, damage: p.damage }))
}

export function ranking(state: SimState): ScoreLine[] {
  const ps = [...state.players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || b.damage - a.damage || a.slot - b.slot)
  return ps.map((p) => ({ id: p.id, kills: p.kills, deaths: p.deaths, damage: p.damage }))
}

// =====================================================================================
// Passo
// =====================================================================================

interface Ctx {
  state: SimState
  map: MapDef
  g: MapGrid
  events: SimEvent[]
  tick: number
  limit: boolean
}

const playerBySlot = (state: SimState, slot: number): SimPlayer | undefined => {
  for (const p of state.players) if (p.slot === slot) return p
  return undefined
}

function sanitize(raw: Input, fallbackSeq: number): Input {
  const lag = fin(raw.lagTicks ?? 0)
  const out: Input = {
    seq: Number.isFinite(raw.seq) ? raw.seq : fallbackSeq,
    mx: fin(raw.mx),
    my: fin(raw.my),
    ax: fin(raw.ax),
    ay: fin(raw.ay),
    buttons: (fin(raw.buttons) | 0) & 7
  }
  if (lag > 0) out.lagTicks = Math.min(MAX_LAG, Math.floor(lag))
  return out
}

function kill(c: Ctx, victim: SimPlayer, attacker: SimPlayer | undefined, weapon: WeaponId | 'granada'): void {
  const playing = c.state.phase === 'jogando'
  victim.hp = 0
  victim.alive = false
  victim.respawnTick = c.tick + RESPAWN_TICKS
  victim.kx = 0
  victim.ky = 0
  victim.dashUntil = 0
  const other = attacker && attacker !== victim ? attacker : undefined
  if (playing) {
    victim.deaths++
    victim.streak = 0
    if (other) {
      other.kills++
      other.streak++
      if (other.kills >= c.state.killLimit) c.limit = true
    }
  }
  c.events.push({ type: 'kill', victim: victim.slot, killer: other ? other.slot : victim.slot, weapon, streak: other ? other.streak : 0 })
}

function applyDamage(c: Ctx, victim: SimPlayer, attackerSlot: number, dmg: number, weapon: WeaponId | 'granada', x: number, y: number): void {
  const real = Math.min(dmg, victim.hp)
  victim.hp -= dmg
  c.events.push({ type: 'hit', victim: victim.slot, attacker: attackerSlot, damage: dmg, x, y })
  const attacker = playerBySlot(c.state, attackerSlot)
  if (attacker && attacker !== victim && c.state.phase === 'jogando') attacker.damage += real
  if (victim.hp <= 0) kill(c, victim, attacker, weapon)
}

function explode(c: Ctx, x: number, y: number, radius: number, base: number, owner: number, weapon: WeaponId | 'granada'): void {
  c.events.push({ type: 'explode', x, y, radius })
  for (const q of c.state.players) {
    if (!q.alive || q.away) continue
    const dx = q.x - x
    const dy = q.y - y
    const d = Math.sqrt(dx * dx + dy * dy)
    const de = Math.max(0, d - PLAYER_RADIUS)
    if (de > radius) continue
    if (!shotClear(c.g, x, y, q.x, q.y)) continue
    const f = 1 - de / radius
    if (d > 0.01) {
      q.kx += (dx / d) * BLAST_KNOCKBACK * f
      q.ky += (dy / d) * BLAST_KNOCKBACK * f
      const k = Math.sqrt(q.kx * q.kx + q.ky * q.ky)
      if (k > KNOCK_MAX) {
        q.kx *= KNOCK_MAX / k
        q.ky *= KNOCK_MAX / k
      }
    }
    if (c.tick < q.invulnUntil || c.tick < q.dashUntil) continue
    let dmg = base * (1 - (1 - BLAST_EDGE_FACTOR) * (de / radius))
    if (q.slot === owner) dmg *= SELF_BLAST_FACTOR
    applyDamage(c, q, owner, Math.max(1, Math.round(dmg)), weapon, q.x, q.y)
  }
}

/** Anda o projétil um tick (subpassos de até 4 px). false = acabou (bateu/explodiu). */
function stepProjectile(c: Ctx, pr: SimProjectile): boolean {
  const g = c.g
  const sp = Math.sqrt(pr.vx * pr.vx + pr.vy * pr.vy) * DT
  const n = Math.max(1, Math.ceil(sp / 4))
  if (pr.kind === 'granada') {
    for (let i = 0; i < n; i++) {
      const nx = pr.x + (pr.vx * DT) / n
      const ny = pr.y + (pr.vy * DT) / n
      if (pointSolid(g, nx, pr.y)) pr.vx *= -GRENADE_BOUNCE
      else pr.x = nx
      if (pointSolid(g, pr.x, ny)) pr.vy *= -GRENADE_BOUNCE
      else pr.y = ny
    }
    pr.vx *= GRENADE.friction
    pr.vy *= GRENADE.friction
    return true
  }
  const sx = (pr.vx * DT) / n
  const sy = (pr.vy * DT) / n
  const players = c.state.players
  for (let i = 0; i < n; i++) {
    const nx = pr.x + sx
    const ny = pr.y + sy
    if (pointShotBlocked(g, nx, ny)) {
      c.events.push({ type: 'wall', x: pr.x, y: pr.y })
      if (pr.kind === 'rolha') explode(c, pr.x, pr.y, WEAPONS.rolha.blastRadius, pr.damage, pr.owner, 'rolha')
      return false
    }
    pr.x = nx
    pr.y = ny
    for (let k = 0; k < players.length; k++) {
      const q = players[k]
      if (q.slot === pr.owner || !q.alive || q.away) continue
      const dx = q.x - nx
      const dy = q.y - ny
      if (dx * dx + dy * dy >= PROJ_HIT_R2) continue
      if (c.tick < q.invulnUntil || c.tick < q.dashUntil) continue
      if (pr.kind === 'rolha') explode(c, nx, ny, WEAPONS.rolha.blastRadius, pr.damage, pr.owner, 'rolha')
      else applyDamage(c, q, pr.owner, pr.damage, pr.weapon as WeaponId, nx, ny)
      return false
    }
  }
  return true
}

function fire(c: Ctx, p: SimPlayer, lag: number): void {
  const state = c.state
  const w = WEAPONS[p.weapon]
  p.nextFireTick = c.tick + w.cooldownTicks
  const base = Math.atan2(p.ay, p.ax)
  c.events.push({ type: 'shot', slot: p.slot, weapon: w.id, x: p.x, y: p.y, ax: p.ax, ay: p.ay })
  for (let i = 0; i < w.pellets; i++) {
    let ang = base
    let spd = w.speed
    if (w.projectile === 'bago') {
      ang += (w.pellets > 1 ? w.spread * (i / (w.pellets - 1) - 0.5) : 0) + (rngNext(state) - 0.5) * 0.06
      spd *= 0.92 + 0.16 * rngNext(state)
    } else if (w.spread > 0) {
      ang += (rngNext(state) - 0.5) * w.spread
    }
    const dx = Math.cos(ang)
    const dy = Math.sin(ang)
    let sx = p.x + dx * (PLAYER_RADIUS + 1)
    let sy = p.y + dy * (PLAYER_RADIUS + 1)
    if (pointShotBlocked(c.g, sx, sy)) {
      sx = p.x
      sy = p.y
    }
    const pr: SimProjectile = {
      id: state.nextId++,
      owner: p.slot,
      kind: w.projectile,
      weapon: w.id,
      x: sx,
      y: sy,
      vx: dx * spd,
      vy: dy * spd,
      damage: w.damage,
      dieTick: c.tick + w.lifeTicks - lag
    }
    let alive = true
    for (let k = 0; k < lag && alive; k++) alive = stepProjectile(c, pr)
    if (alive) state.projectiles.push(pr)
  }
  if (p.weapon !== 'pistola') {
    p.ammo -= 1
    if (p.ammo <= 0) {
      p.weapon = 'pistola'
      p.ammo = Infinity
    }
  }
}

function throwGrenade(c: Ctx, p: SimPlayer): void {
  if (p.grenades >= GRENADE.maxCarry) p.grenadeRegenTick = c.tick + GRENADE.regenTicks
  p.grenades--
  let sx = p.x + p.ax * (PLAYER_RADIUS + 1)
  let sy = p.y + p.ay * (PLAYER_RADIUS + 1)
  if (pointSolid(c.g, sx, sy)) {
    sx = p.x
    sy = p.y
  }
  c.state.projectiles.push({
    id: c.state.nextId++,
    owner: p.slot,
    kind: 'granada',
    weapon: 'granada',
    x: sx,
    y: sy,
    vx: p.ax * GRENADE.throwSpeed,
    vy: p.ay * GRENADE.throwSpeed,
    damage: GRENADE.damage,
    dieTick: c.tick + GRENADE.fuseTicks
  })
  c.events.push({ type: 'grenade', slot: p.slot, x: sx, y: sy })
}

function endMatch(state: SimState, events: SimEvent[]): void {
  state.phase = 'fim'
  events.push({ type: 'phase', phase: 'fim' })
}

export function step(state: SimState, inputs: ReadonlyMap<number, Input>): SimEvent[] {
  const events: SimEvent[] = []
  if (state.phase === 'fim') return events
  const tick = state.tick
  if (state.phase === 'aquecendo' && tick >= state.warmupEndTick) {
    state.phase = 'jogando'
    events.push({ type: 'phase', phase: 'jogando' })
  }
  if (state.phase === 'jogando' && tick >= state.endTick) {
    endMatch(state, events)
    return events
  }
  const map = getMap(state.mapId)
  const c: Ctx = { state, map, g: gridOf(map), events, tick, limit: false }
  const players = state.players

  // renascimentos
  for (const p of players) {
    if (!p.alive && !p.away && tick >= p.respawnTick) spawnPlayer(state, map, p, events)
  }

  // jogadores: entrada, movimento, tiro, granada
  for (const p of players) {
    if (p.away) continue
    let raw = inputs.get(p.slot)
    let fresh = true
    if (!raw) {
      if (p.bot) raw = p.alive ? botInput(state, p.slot) : { ...EMPTY_INPUT, seq: p.lastSeq + 1 }
      else {
        raw = p.lastInput ?? { ...EMPTY_INPUT, seq: p.lastSeq }
        fresh = false
      }
    }
    const inp = sanitize(raw, p.lastSeq)
    if (!fresh) delete inp.lagTicks
    p.lastSeq = inp.seq
    if (!p.bot) p.lastInput = inp
    if (!p.alive) {
      p.prevButtons = inp.buttons
      continue
    }
    const al = Math.sqrt(inp.ax * inp.ax + inp.ay * inp.ay)
    if (al > 0.01) {
      p.ax = inp.ax / al
      p.ay = inp.ay / al
    }
    const dashBefore = p.dashUntil
    movePlayer(map, p, inp, tick)
    if (p.dashUntil !== dashBefore) events.push({ type: 'dash', slot: p.slot })
    if ((inp.buttons & BTN_FIRE) !== 0 && tick >= p.nextFireTick) fire(c, p, inp.lagTicks ?? 0)
    if ((inp.buttons & BTN_GRENADE) !== 0 && (p.prevButtons & BTN_GRENADE) === 0 && p.grenades > 0) throwGrenade(c, p)
    if (p.grenades < GRENADE.maxCarry && tick >= p.grenadeRegenTick) {
      p.grenades++
      p.grenadeRegenTick = tick + GRENADE.regenTicks
    }
    p.prevButtons = inp.buttons
  }

  // projéteis
  const arr = state.projectiles
  let w = 0
  for (let i = 0; i < arr.length; i++) {
    const pr = arr[i]
    if (tick >= pr.dieTick) {
      if (pr.kind === 'granada') explode(c, pr.x, pr.y, GRENADE.blastRadius, pr.damage, pr.owner, 'granada')
      else if (pr.kind === 'rolha') explode(c, pr.x, pr.y, WEAPONS.rolha.blastRadius, pr.damage, pr.owner, 'rolha')
      continue
    }
    if (stepProjectile(c, pr)) arr[w++] = pr
  }
  arr.length = w

  // pickups
  for (const k of state.pickups) {
    if (k.backTick > 0 && tick >= k.backTick) k.backTick = 0
    if (k.backTick !== 0 || k.kind === 'pistola') continue
    for (const p of players) {
      if (!p.alive || p.away) continue
      const dx = p.x - k.x
      const dy = p.y - k.y
      if (dx * dx + dy * dy > PICKUP_RADIUS * PICKUP_RADIUS) continue
      if (k.kind === 'vida') {
        if (p.hp >= MAX_HP) continue
        p.hp = Math.min(MAX_HP, p.hp + HEAL_AMOUNT)
      } else {
        const spec = WEAPONS[k.kind]
        if (p.weapon === k.kind) {
          if (p.ammo >= spec.ammo) continue
          p.ammo = Math.min(spec.ammo, p.ammo + spec.ammo)
        } else {
          p.weapon = k.kind
          p.ammo = spec.ammo
        }
      }
      k.backTick = tick + PICKUP_RESPAWN_TICKS[k.kind]
      events.push({ type: 'pickup', slot: p.slot, kind: k.kind, pickupId: k.id })
      break
    }
  }

  state.tick = tick + 1
  if (c.limit && state.phase === 'jogando') endMatch(state, events)
  return events
}

export { botInput }
export const sim: SimApi = { createSim, step, cloneState, addPlayer, setAway, movePlayer, botInput, scores, ranking }
