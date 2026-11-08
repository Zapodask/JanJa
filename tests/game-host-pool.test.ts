import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { PoolView } from '../src/shared/games/pool/types'
import { GAMES } from '../src/shared/games/registry'
import { seededRng } from '../src/shared/games/types'
import type { ServerMessage } from '../src/shared/protocol'
import { RoomCore, type Conn, type ConnData, type RoomConfig } from '../src/worker/core'
import type { GameSnapshot } from '../src/worker/game/host'

/** Integração: servidor (RoomCore + GameHost) com a sinuca real (tacada simulada no servidor), por mensagens. */
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
  view(): PoolView | undefined {
    return this.inbox.filter((m) => m.type === 'game-view').at(-1)?.view as PoolView | undefined
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

describe('servidor + sinuca', () => {
  it('a quebra passa pelo servidor e todos recebem o antes e o depois', async () => {
    const r = new Room()
    const host = await r.join('Pedro', HOST_KEY)
    const bia = await r.join('Bia')
    const caio = await r.join('Caio')
    await host.say({ type: 'game-open', gameId: 'pool', options: {} })
    for (const p of [host, bia]) await p.say({ type: 'game-sit' })
    await host.say({ type: 'game-start' })
    const v = caio.view()!
    expect(v.balls).toHaveLength(16)
    const who = v.turn === host.view()?.you?.index ? host : bia
    await who.say({ type: 'game-action', seq: who.seq(), action: { type: 'shoot', dx: 1, dy: 0.01, power: 1, cue: { x: 20, y: 25 }, ref: 0 } })
    expect(errors(who)).toHaveLength(0)
    const after = caio.view()!
    expect(after.shot?.before.find((b) => b.id === 0)).toMatchObject({ x: 20, y: 25 })
    expect(after.shot?.after).toEqual(after.balls)
    expect(after.ref).toBe(1)
    // o alarme taca por quem não taca
    const d = r.core.game.nextDeadline()!
    r.now = d
    r.core.game.onTick(d)
    expect(caio.view()!.ref).toBe(2)
  })
})
