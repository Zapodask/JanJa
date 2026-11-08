import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { GolfView } from '../src/shared/games/golf/types'
import { GAMES } from '../src/shared/games/registry'
import { seededRng } from '../src/shared/games/types'
import type { ServerMessage } from '../src/shared/protocol'
import { RoomCore, type Conn, type ConnData, type RoomConfig } from '../src/worker/core'
import type { GameSnapshot } from '../src/worker/game/host'

/** Integração: servidor (RoomCore + GameHost) com o golfe real (jogo simultâneo), por mensagens. */
const HOST_KEY = 'chave'
class C implements Conn {
  inbox: ServerMessage[] = []
  d: ConnData = {}
  constructor(public r: Room) {}
  send(m: ServerMessage) {
    this.inbox.push(m)
  }
  close() {}
  data() {
    return this.d
  }
  setData(d: ConnData) {
    this.d = d
  }
  view(): GolfView | undefined {
    return this.inbox.filter((m) => m.type === 'game-view').at(-1)?.view as GolfView | undefined
  }
  seq(): number {
    return this.inbox.filter((m) => m.type === 'game-view').at(-1)?.seq ?? 0
  }
  async say(msg: unknown) {
    await this.r.core.onMessage(this, JSON.stringify(msg))
  }
}
class Room {
  conns: C[] = []
  now = 5_000_000
  stored: GameSnapshot | null = null
  n = 0
  core = new RoomCore({
    conns: () => this.conns,
    config: (): RoomConfig => ({ hostKeyHash: createHash('sha256').update(HOST_KEY).digest('hex'), requireApproval: false }),
    hash: async (t) => createHash('sha256').update(t).digest('hex'),
    newId: () => `id${++this.n}`,
    iceServers: async () => [],
    now: () => this.now,
    rng: () => seededRng(42),
    loadGame: () => this.stored ?? undefined,
    saveGame: (s) => {
      this.stored = s ? (JSON.parse(JSON.stringify(s)) as GameSnapshot) : null
    },
    registry: GAMES
  })
  async join(name: string, key?: string) {
    const c = new C(this)
    this.conns.push(c)
    await c.say({ type: 'join', name, clientId: `cid-${name}-000000`, hostKey: key })
    return c
  }
}

const errors = (c: C) => c.inbox.filter((m) => m.type === 'game-error')

describe('servidor + golfe', () => {
  it('tacadas simultâneas: seq antigo vale no golfe, a repetida é recusada pelo jogo', async () => {
    const r = new Room()
    const host = await r.join('Pedro', HOST_KEY)
    const bia = await r.join('Bia')
    await host.say({ type: 'game-open', gameId: 'golf', options: { mapId: 'quintal', collisions: true, holeSeconds: 60 } })
    for (const p of [host, bia]) await p.say({ type: 'game-sit' })
    await host.say({ type: 'game-start' })
    expect(host.view()?.phase).toBe('jogando')
    const staleSeq = bia.seq()
    const shot = { type: 'shot', hole: 0, stroke: 0, angle: -Math.PI / 2, power: 0.3 }
    await host.say({ type: 'game-action', seq: host.seq(), action: shot })
    r.now += 50
    // a Bia taca com a visão de antes da tacada do Pedro
    await bia.say({ type: 'game-action', seq: staleSeq, action: shot })
    expect(errors(bia)).toHaveLength(0)
    expect(bia.view()?.players.map((p) => p.strokes)).toEqual([1, 1])
    // repetir a mesma tacada (stroke 0) é recusado
    await bia.say({ type: 'game-action', seq: bia.seq(), action: shot })
    expect(errors(bia).at(-1)).toMatchObject({ code: 'acao-invalida' })
  })

  it('o alarme fecha o buraco quando o tempo acaba', async () => {
    const r = new Room()
    const host = await r.join('Pedro', HOST_KEY)
    await host.say({ type: 'game-open', gameId: 'golf', options: { holeSeconds: 60 } })
    await host.say({ type: 'game-sit' })
    await host.say({ type: 'game-start' })
    const d = r.core.game.nextDeadline()!
    r.now = d
    r.core.game.onTick(d)
    expect(host.view()?.phase).toBe('intervalo')
    expect(host.view()?.players[0].scores).toEqual([6])
  })
})
