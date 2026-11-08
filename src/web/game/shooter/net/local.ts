/**
 * Sessão local (sem rede) para o laboratório /dev/shooter: você no slot 0 e robôs, tudo na mesma
 * página. Usa o mesmo HostLoop e o mesmo ClientCore das partidas de verdade.
 */
import {
  BOT_SLOT_BASE,
  MAX_BOTS,
  TICK_MS,
  type KillLimit,
  type MapId,
  type MatchMinutes,
  type ShooterPlayerView,
  type SimPlayerRef,
  type SimState
} from '../../../../shared/games/shooter/types'
import type { FrameEvent, InputState, ShooterFrame, ShooterSession } from '../contract'
import { ClientCore } from './client'
import { HostLoop } from './hostCore'
import { getMap, simApi } from './simBinding'
import { defaultEnv, type SessionEnv } from './session'

export interface LocalOptions {
  mapId: MapId
  bots: number
  minutes?: number
  killLimit?: number
  seed?: number
}

export function createLocalSession(
  opts: LocalOptions,
  env: Pick<SessionEnv, 'now' | 'every'> = defaultEnv
): ShooterSession & { sim(): SimState } {
  const bots = Math.max(0, Math.min(MAX_BOTS, Math.floor(opts.bots)))
  const roster: ShooterPlayerView[] = [{ id: 'voce', name: 'Você', slot: 0, bot: false, present: true }]
  for (let i = 0; i < bots; i++) roster.push({ id: `bot-${i + 1}`, name: `Robô ${i + 1}`, slot: BOT_SLOT_BASE + i, bot: true, present: true })
  const refs: SimPlayerRef[] = roster.map((p) => ({ slot: p.slot, id: p.id, bot: p.bot }))
  const seed = opts.seed ?? (Math.floor(Math.random() * 0xffffffff) >>> 0)
  const state = simApi.createSim(
    refs,
    { mapId: opts.mapId, minutes: (opts.minutes ?? 5) as MatchMinutes, killLimit: (opts.killLimit ?? 20) as KillLimit, bots },
    seed
  )

  const client = new ClientCore({ sim: simApi, getMap, me: 0 })
  client.setRoster(roster)
  client.beginEpoch(1)
  const listeners = new Set<(events: FrameEvent[]) => void>()
  const flush = () => {
    const ev = client.drainEvents()
    if (ev.length) for (const cb of listeners) cb(ev)
  }
  const loop = new HostLoop(
    simApi,
    { state, epoch: 1 },
    (m) => {
      if (m.k === 'snap' && client.onSnapshot(m.snap, env.now())) flush()
    },
    env.now()
  )

  let input: InputState = { mx: 0, my: 0, ax: 1, ay: 0, buttons: 0 }
  let nextTickAt = 0
  const stop = env.every(8, () => {
    const now = env.now()
    if (nextTickAt === 0 || now - nextTickAt > 250) nextTickAt = now
    let n = 0
    while (nextTickAt <= now && n++ < 6) {
      nextTickAt += TICK_MS
      const inputs = client.localTick(now, input)
      if (inputs) loop.handle({ k: 'input', slot: 0, inputs: inputs.slice(-1) })
    }
    loop.advance(now)
    flush()
  })

  let cache: { at: number; frame: ShooterFrame } | null = null
  return {
    frame() {
      const now = env.now()
      if (cache && now - cache.at < 3) return cache.frame
      const f = client.frame(now)
      if (!f) return null
      f.net = 'host'
      f.pingMs = 0
      cache = { at: now, frame: f }
      return f
    },
    setInput(i) {
      input = i
    },
    onEvents(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    dispose() {
      stop()
      loop.handle({ k: 'stop' })
      listeners.clear()
    },
    sim: () => loop.state
  }
}
