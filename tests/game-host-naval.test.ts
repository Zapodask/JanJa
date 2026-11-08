import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { NavalView } from '../src/shared/games/naval/types'
import { randomFleet } from '../src/shared/games/naval/fleet'
import { GAMES } from '../src/shared/games/registry'
import { seededRng } from '../src/shared/games/types'
import type { ServerMessage } from '../src/shared/protocol'
import { RoomCore, type Conn, type ConnData, type RoomConfig } from '../src/worker/core'
import type { GameSnapshot } from '../src/worker/game/host'

/** Integração: servidor (RoomCore + GameHost) com a batalha naval real (frotas escondidas), por mensagens. */
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
  view(): NavalView | undefined {
    return this.inbox.filter((m) => m.type === 'game-view').at(-1)?.view as NavalView | undefined
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

describe('servidor + batalha naval', () => {
  it('posicionam ao mesmo tempo, a frota fica escondida e o tiro passa pelo servidor', async () => {
    const r = new Room()
    const host = await r.join('Pedro', HOST_KEY)
    const bia = await r.join('Bia')
    const caio = await r.join('Caio')
    await host.say({ type: 'game-open', gameId: 'naval', options: { mode: 'classico' } })
    for (const p of [host, bia]) await p.say({ type: 'game-sit' })
    await host.say({ type: 'game-start' })
    const seq = host.seq()
    await host.say({ type: 'game-action', seq, action: { type: 'place', ships: randomFleet(seededRng(1)) } })
    // a Bia manda com o seq de antes (posicionam juntos: vale)
    await bia.say({ type: 'game-action', seq, action: { type: 'place', ships: randomFleet(seededRng(2)) } })
    expect(errors(bia)).toHaveLength(0)
    expect(caio.view()?.phase).toBe('batalha')
    expect(caio.view()?.myFleet).toBeNull()
    expect(bia.view()?.myFleet).toEqual(randomFleet(seededRng(2)))
    const v = caio.view()!
    const shooter = v.turn === 0 ? host : bia
    await shooter.say({ type: 'game-action', seq: shooter.seq(), action: { type: 'shoot', cells: [{ x: 0, y: 0 }], ref: v.ref } })
    expect(errors(shooter)).toHaveLength(0)
    expect(caio.view()?.ref).toBe(1)
  })
})
