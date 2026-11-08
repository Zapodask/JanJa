import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { MysteryView } from '../src/shared/games/mystery/types'
import { GAMES } from '../src/shared/games/registry'
import { seededRng } from '../src/shared/games/types'
import type { ServerMessage } from '../src/shared/protocol'
import { RoomCore, type Conn, type ConnData, type RoomConfig } from '../src/worker/core'
import type { GameSnapshot } from '../src/worker/game/host'

/** Integração: servidor (RoomCore + GameHost) com o Mistério real (cartas e carta mostrada em segredo), por mensagens. */
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
  view(): MysteryView | undefined {
    return this.inbox.filter((m) => m.type === 'game-view').at(-1)?.view as MysteryView | undefined
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

describe('servidor + Mistério', () => {
  it('cada um vê só as suas cartas e o palpite passa pelo servidor', async () => {
    const r = new Room()
    const ps = [await r.join('Pedro', HOST_KEY), await r.join('Bia'), await r.join('Caio')]
    const watcher = await r.join('Duda')
    await ps[0].say({ type: 'game-open', gameId: 'mystery', options: {} })
    for (const p of ps) await p.say({ type: 'game-sit' })
    await ps[0].say({ type: 'game-start' })
    const hands = ps.map((p) => p.view()!.myCards)
    expect(hands.flat()).toHaveLength(17)
    expect(watcher.view()?.myCards).toEqual([])
    for (const [k, p] of ps.entries()) for (const c of hands[(k + 1) % 3]) expect(JSON.stringify(p.view())).not.toContain(`"${c}"`)
    const turn = watcher.view()!.turn!
    const who = ps.find((p) => p.view()?.you?.index === turn)!
    await who.say({ type: 'game-action', seq: who.seq(), action: { type: 'suggest', quem: 'lia', onde: 'jardim', como: 'escada' } })
    expect(errors(who)).toHaveLength(0)
    expect(watcher.view()?.current).toMatchObject({ quem: 'lia', by: turn })
  })
})
