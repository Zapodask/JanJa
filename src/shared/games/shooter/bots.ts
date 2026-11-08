/**
 * IA dos robôs. Determinística (só o RNG do estado) e sem cache fora do estado: tudo que o robô
 * lembra fica em `SimPlayer.ai` (BotMemory), então o estado continua clonável e serializável.
 * Caminho: distância por BFS em grade de tiles a partir do objetivo, recalculada a cada ~10 ticks.
 */
import { circleBlocked, pointSolid, shotClear, tileIndex, walkClear } from './geom'
import { getMap, gridOf } from './maps'
import type { MapGrid } from './maps/legend'
import { rngInt, rngNext } from './rng'
import { BTN_DASH, BTN_FIRE, BTN_GRENADE, DT, EMPTY_INPUT, PLAYER_RADIUS, TILE, WEAPONS, type BotMemory, type Input, type SimPlayer, type SimState, type WeaponId } from './types'

const SIGHT = 320
const LOST_TICKS = 60
const TWO_PI = Math.PI * 2
const MAX_TURN = 0.45

/** distância preferida do inimigo, por arma */
const PREFERRED: Record<WeaponId, number> = { pistola: 140, escopeta: 55, sub: 110, rifle: 230, rolha: 190 }

const wrap = (a: number): number => a - TWO_PI * Math.round(a / TWO_PI)

function initMemory(me: SimPlayer, tick: number): BotMemory {
  return {
    target: -1,
    aimTicks: 0,
    err: 0,
    errTick: 0,
    seenTick: -1000,
    seenX: me.x,
    seenY: me.y,
    tvx: 0,
    tvy: 0,
    still: 0,
    goalX: me.x,
    goalY: me.y,
    goalTick: -1000,
    wayX: me.x,
    wayY: me.y,
    pathTick: -1000,
    strafe: 1,
    strafeUntil: tick,
    hp: me.hp,
    hurtTick: -1000,
    chkTick: tick,
    chkX: me.x,
    chkY: me.y,
    stuck: 0,
    freeUntil: -1,
    freeX: 0,
    freeY: 0
  }
}

// --- BFS (buffers de trabalho reaproveitados; sempre zerados antes de usar) ---
let distBuf = new Int16Array(0)
let queueBuf = new Int32Array(0)

function bfsFrom(g: MapGrid, goalIdx: number): Int16Array {
  const n = g.w * g.h
  if (distBuf.length < n) {
    distBuf = new Int16Array(n)
    queueBuf = new Int32Array(n)
  }
  distBuf.fill(-1, 0, n)
  let head = 0
  let tail = 0
  distBuf[goalIdx] = 0
  queueBuf[tail++] = goalIdx
  while (head < tail) {
    const i = queueBuf[head++]
    const d = distBuf[i] + 1
    const x = i % g.w
    if (x > 0 && distBuf[i - 1] < 0 && g.solid[i - 1] === 0) {
      distBuf[i - 1] = d
      queueBuf[tail++] = i - 1
    }
    if (x < g.w - 1 && distBuf[i + 1] < 0 && g.solid[i + 1] === 0) {
      distBuf[i + 1] = d
      queueBuf[tail++] = i + 1
    }
    if (i >= g.w && distBuf[i - g.w] < 0 && g.solid[i - g.w] === 0) {
      distBuf[i - g.w] = d
      queueBuf[tail++] = i - g.w
    }
    if (i < n - g.w && distBuf[i + g.w] < 0 && g.solid[i + g.w] === 0) {
      distBuf[i + g.w] = d
      queueBuf[tail++] = i + g.w
    }
  }
  return distBuf
}

/** Próximo tile no caminho (menor distância); -1 se não há. */
function stepDown(g: MapGrid, dist: Int16Array, i: number): number {
  const d = dist[i]
  if (d <= 0) return -1
  const x = i % g.w
  if (x > 0 && dist[i - 1] === d - 1) return i - 1
  if (x < g.w - 1 && dist[i + 1] === d - 1) return i + 1
  if (i >= g.w && dist[i - g.w] === d - 1) return i - g.w
  if (i + g.w < g.w * g.h && dist[i + g.w] === d - 1) return i + g.w
  return -1
}

const tileCx = (g: MapGrid, i: number): number => (i % g.w) * TILE + TILE / 2
const tileCy = (g: MapGrid, i: number): number => Math.floor(i / g.w) * TILE + TILE / 2

/** Recalcula o ponto para onde andar em direção ao objetivo. */
function updateWaypoint(g: MapGrid, me: SimPlayer, ai: BotMemory, tick: number): void {
  ai.pathTick = tick
  const gi = tileIndex(g, ai.goalX, ai.goalY)
  const mi = tileIndex(g, me.x, me.y)
  if (gi < 0 || mi < 0 || g.solid[gi] === 1) {
    ai.wayX = me.x
    ai.wayY = me.y
    return
  }
  if (gi === mi) {
    ai.wayX = ai.goalX
    ai.wayY = ai.goalY
    return
  }
  const dist = bfsFrom(g, gi)
  const a = stepDown(g, dist, mi)
  if (a < 0) {
    ai.wayX = me.x
    ai.wayY = me.y
    return
  }
  ai.wayX = tileCx(g, a)
  ai.wayY = tileCy(g, a)
  const b = stepDown(g, dist, a)
  if (b >= 0) {
    const bx = tileCx(g, b)
    const by = tileCy(g, b)
    if (walkClear(g, me.x, me.y, bx, by) && !circleBlocked(g, (me.x + bx) / 2, (me.y + by) / 2, PLAYER_RADIUS)) {
      ai.wayX = bx
      ai.wayY = by
    }
  }
}

function pickGoal(state: SimState, me: SimPlayer, ai: BotMemory, tick: number): void {
  const map = getMap(state.mapId)
  let bestD = Infinity
  let bx = 0
  let by = 0
  let found = false
  const wantHeal = me.hp < 60
  const wantGun = me.weapon === 'pistola'
  if (wantHeal || wantGun) {
    for (const k of state.pickups) {
      if (k.backTick > 0 && tick < k.backTick) continue
      const heal = k.kind === 'vida'
      if (heal ? !wantHeal : !wantGun) continue
      const dx = k.x - me.x
      const dy = k.y - me.y
      const d = dx * dx + dy * dy - (heal && me.hp < 40 ? 1e9 : 0)
      if (d < bestD) {
        bestD = d
        bx = k.x
        by = k.y
        found = true
      }
    }
  }
  if (found) {
    ai.goalX = bx
    ai.goalY = by
  } else {
    const n = map.spawns.length + map.pickups.length
    const r = rngInt(state, n)
    const pt = r < map.spawns.length ? map.spawns[r] : map.pickups[r - map.spawns.length]
    ai.goalX = pt.x
    ai.goalY = pt.y
  }
  ai.goalTick = tick
  ai.pathTick = -1000
}

/** primeira direção livre entre a desejada e algumas rotações dela */
function freeDirection(g: MapGrid, me: SimPlayer, dx: number, dy: number): { x: number; y: number } {
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 0.01) return { x: 0, y: 0 }
  const ux = dx / len
  const uy = dy / len
  const rots = [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9]
  for (const r of rots) {
    const c = Math.cos(r)
    const s = Math.sin(r)
    const vx = ux * c - uy * s
    const vy = ux * s + uy * c
    if (!circleBlocked(g, me.x + vx * 9, me.y + vy * 9, PLAYER_RADIUS)) return { x: vx, y: vy }
  }
  return { x: ux, y: uy }
}

function coverNear(g: MapGrid, x: number, y: number): boolean {
  for (const o of [-22, 22]) {
    if (pointSolid(g, x + o, y) || pointSolid(g, x, y + o)) return true
  }
  return false
}

export function botInput(state: SimState, slot: number): Input {
  const me = state.players.find((p) => p.slot === slot)
  if (!me) return { ...EMPTY_INPUT }
  const out: Input = { seq: me.lastSeq + 1, mx: 0, my: 0, ax: me.ax, ay: me.ay, buttons: 0 }
  const tick = state.tick
  const ai = me.ai ?? (me.ai = initMemory(me, tick))
  if (!me.alive) {
    ai.target = -1
    ai.goalTick = -1000
    return out
  }
  const map = getMap(state.mapId)
  const g = gridOf(map)

  const hurt = me.hp < ai.hp
  if (hurt) ai.hurtTick = tick
  ai.hp = me.hp

  // ----- alvo -----
  let tgt = ai.target >= 0 ? state.players.find((p) => p.slot === ai.target) : undefined
  if (tgt && (!tgt.alive || tgt.away)) tgt = undefined
  let visible = false
  if (tgt) {
    const dx = tgt.x - me.x
    const dy = tgt.y - me.y
    visible = dx * dx + dy * dy < SIGHT * SIGHT && shotClear(g, me.x, me.y, tgt.x, tgt.y)
  }
  if (!tgt || !visible || tick % 5 === slot % 5) {
    let best: SimPlayer | undefined
    let bestD = Infinity
    for (const q of state.players) {
      if (q === me || !q.alive || q.away) continue
      const dx = q.x - me.x
      const dy = q.y - me.y
      const d = dx * dx + dy * dy
      if (d >= SIGHT * SIGHT || d >= bestD) continue
      if (!shotClear(g, me.x, me.y, q.x, q.y)) continue
      bestD = d
      best = q
    }
    if (best && (!tgt || !visible || best === tgt)) {
      tgt = best
      visible = true
    } else if (best && tgt && visible) {
      const dx = tgt.x - me.x
      const dy = tgt.y - me.y
      if (bestD < (dx * dx + dy * dy) * 0.36) {
        tgt = best
        visible = true
      }
    }
  }
  if (tgt && tgt.slot !== ai.target) {
    ai.target = tgt.slot
    ai.aimTicks = 0
    ai.tvx = 0
    ai.tvy = 0
    ai.still = 0
    ai.seenTick = visible ? tick - 1 : ai.seenTick
    ai.seenX = tgt.x
    ai.seenY = tgt.y
  }
  if (tgt && visible) {
    if (ai.seenTick === tick - 1) {
      const vx = (tgt.x - ai.seenX) / DT
      const vy = (tgt.y - ai.seenY) / DT
      ai.tvx = ai.tvx * 0.6 + vx * 0.4
      ai.tvy = ai.tvy * 0.6 + vy * 0.4
      ai.still = vx * vx + vy * vy < 64 ? ai.still + 1 : 0
    }
    ai.seenTick = tick
    ai.seenX = tgt.x
    ai.seenY = tgt.y
    ai.aimTicks++
  } else {
    ai.aimTicks = Math.max(0, ai.aimTicks - 2)
    if (!tgt || tick - ai.seenTick > LOST_TICKS) {
      ai.target = -1
      tgt = undefined
    }
  }

  // ----- mira -----
  if (tick >= ai.errTick) {
    const mag = 0.04 + 0.3 * Math.max(0, 1 - ai.aimTicks / 80)
    ai.err = (rngNext(state) - 0.5) * 2 * mag
    ai.errTick = tick + 8
  }
  const spec = WEAPONS[me.weapon]
  let dist = 0
  let desired = Math.atan2(me.ay, me.ax)
  if (tgt) {
    const px = visible ? tgt.x : ai.seenX
    const py = visible ? tgt.y : ai.seenY
    dist = Math.sqrt((px - me.x) * (px - me.x) + (py - me.y) * (py - me.y))
    const lead = visible ? (dist / spec.speed) * 0.8 : 0
    desired = Math.atan2(py + ai.tvy * lead - me.y, px + ai.tvx * lead - me.x)
  }

  // ----- movimento -----
  let mvx = 0
  let mvy = 0
  if (tgt && visible) {
    const ux = (tgt.x - me.x) / (dist || 1)
    const uy = (tgt.y - me.y) / (dist || 1)
    if (tick >= ai.strafeUntil) {
      ai.strafe = rngNext(state) < 0.5 ? 1 : -1
      ai.strafeUntil = tick + 15 + rngInt(state, 35)
    }
    const pref = PREFERRED[me.weapon]
    let radial = dist > pref + 20 ? 1 : dist < pref - 20 ? -1 : 0
    if (me.hp < 30) radial = -1
    mvx = ux * radial * 0.9 + -uy * ai.strafe * 0.85
    mvy = uy * radial * 0.9 + ux * ai.strafe * 0.85
    // pouca vida: corre para uma vida por perto
    if (me.hp < 35) {
      for (const k of state.pickups) {
        if (k.kind !== 'vida' || (k.backTick > 0 && tick < k.backTick)) continue
        const kx = k.x - me.x
        const ky = k.y - me.y
        const kd = Math.sqrt(kx * kx + ky * ky)
        if (kd < 200 && walkClear(g, me.x, me.y, k.x, k.y)) {
          mvx = kx / kd
          mvy = ky / kd
          break
        }
      }
    }
    // tomou dano: dash para o lado, às vezes
    if (tick - ai.hurtTick <= 1 && tick >= me.dashReadyTick && rngNext(state) < 0.4) {
      out.buttons |= BTN_DASH
      mvx = -uy * ai.strafe
      mvy = ux * ai.strafe
    }
  } else {
    // sem alvo à vista: persegue o último ponto visto ou segue o objetivo
    const chase = tgt !== undefined
    if (chase) {
      if (ai.goalX !== ai.seenX || ai.goalY !== ai.seenY) {
        ai.goalX = ai.seenX
        ai.goalY = ai.seenY
        ai.pathTick = -1000
      }
    } else {
      const gdx = ai.goalX - me.x
      const gdy = ai.goalY - me.y
      const reached = gdx * gdx + gdy * gdy < 14 * 14
      const reconsider = (me.hp < 60 || me.weapon === 'pistola') && tick % 20 === slot % 20
      if (tick - ai.goalTick > 400 || reached || reconsider) {
        pickGoal(state, me, ai, tick)
      }
    }
    const wdx = ai.wayX - me.x
    const wdy = ai.wayY - me.y
    if (tick - ai.pathTick >= 10 || wdx * wdx + wdy * wdy < 5 * 5) updateWaypoint(g, me, ai, tick)
    mvx = ai.wayX - me.x
    mvy = ai.wayY - me.y
    const l = Math.sqrt(mvx * mvx + mvy * mvy)
    if (l > 0.5) {
      mvx /= l
      mvy /= l
    } else {
      mvx = 0
      mvy = 0
    }
    if (!tgt && (mvx !== 0 || mvy !== 0)) desired = Math.atan2(mvy, mvx)
  }

  // destravar
  if (tick - ai.chkTick >= 20) {
    const dx = me.x - ai.chkX
    const dy = me.y - ai.chkY
    if (dx * dx + dy * dy < 25 && (mvx !== 0 || mvy !== 0)) ai.stuck++
    else ai.stuck = 0
    ai.chkTick = tick
    ai.chkX = me.x
    ai.chkY = me.y
    if (ai.stuck >= 2) {
      const a = rngNext(state) * TWO_PI
      ai.freeX = Math.cos(a)
      ai.freeY = Math.sin(a)
      ai.freeUntil = tick + 25
      ai.stuck = 0
      ai.goalTick = -1000
      ai.pathTick = -1000
    }
  }
  if (tick < ai.freeUntil) {
    mvx = ai.freeX
    mvy = ai.freeY
  }
  const dir = freeDirection(g, me, mvx, mvy)
  out.mx = dir.x
  out.my = dir.y

  // ----- gira a mira (com velocidade limitada) e atira -----
  const cur = Math.atan2(me.ay, me.ax)
  const want = desired + (tgt && visible ? ai.err : 0)
  const turn = Math.max(-MAX_TURN, Math.min(MAX_TURN, wrap(want - cur)))
  const aim = cur + turn
  out.ax = Math.cos(aim)
  out.ay = Math.sin(aim)

  if (tgt && visible) {
    const off = Math.abs(wrap(desired - aim))
    const tol = me.weapon === 'rifle' ? 0.1 : dist < 70 ? 0.4 : 0.2
    const range = (spec.speed * spec.lifeTicks * DT) * 0.9
    if (ai.aimTicks >= 6 && off < tol && dist <= range && (me.weapon !== 'rolha' || dist > 55)) out.buttons |= BTN_FIRE
    // granada em inimigo parado perto de cobertura
    if (
      me.grenades > 0 &&
      (me.prevButtons & BTN_GRENADE) === 0 &&
      dist > 110 &&
      dist < 175 &&
      ai.still >= 12 &&
      off < 0.15 &&
      coverNear(g, tgt.x, tgt.y) &&
      walkClear(g, me.x, me.y, tgt.x, tgt.y) &&
      rngNext(state) < 0.06
    ) {
      out.buttons |= BTN_GRENADE
    }
  }
  return out
}
