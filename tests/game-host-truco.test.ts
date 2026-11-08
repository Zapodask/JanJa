import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { TrucoView } from '../src/shared/games/truco/types'
import { GAMES } from '../src/shared/games/registry'
import { seededRng } from '../src/shared/games/types'
import type { ServerMessage } from '../src/shared/protocol'
import { RoomCore, type Conn, type ConnData, type RoomConfig } from '../src/worker/core'
import type { GameSnapshot } from '../src/worker/game/host'

/** Integração: servidor (RoomCore + GameHost) com o truco real (cadeiras exatas, cartas escondidas), por mensagens. */
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
  view(): TrucoView | undefined {
    return this.inbox.filter((m) => m.type === 'game-view').at(-1)?.view as TrucoView | undefined
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

const lobby = (c: C) => c.inbox.filter((m) => m.type === 'game-lobby').at(-1) as Extract<ServerMessage, { type: 'game-lobby' }> | undefined

describe('servidor + truco', () => {
  it('2x2: o lobby tem 4 cadeiras e só começa com a mesa completa', async () => {
    const r = new Room()
    const ps = [await r.join('Pedro', HOST_KEY), await r.join('Bia'), await r.join('Caio'), await r.join('Duda'), await r.join('Edu')]
    const [host] = ps
    await host.say({ type: 'game-open', gameId: 'truco', options: { players: 4 } })
    expect(lobby(host)?.lobby).toMatchObject({ maxPlayers: 4, minPlayers: 4 })
    for (const p of ps.slice(0, 3)) await p.say({ type: 'game-sit' })
    await host.say({ type: 'game-start' })
    expect(errors(host).at(-1)).toMatchObject({ code: 'jogadores-insuficientes' })
    await ps[3].say({ type: 'game-sit' })
    await ps[4].say({ type: 'game-sit' })
    expect(errors(ps[4]).at(-1)).toMatchObject({ code: 'mesa-cheia' })
    await host.say({ type: 'game-start' })
    const v = host.view()!
    expect(v.myCards).toHaveLength(3)
    expect(ps[4].view()?.myCards).toEqual([]) // quem assiste não vê carta nenhuma
    // quem tem a vez joga uma carta pela mensagem
    const turn = v.mesas[0].turn!
    const who = ps.find((p) => p.view()?.you?.index === turn)!
    const mine = who.view()!
    await who.say({ type: 'game-action', seq: who.seq(), action: { type: 'play', card: mine.myCards[0], ref: mine.mesas[0].ref } })
    expect(errors(who)).toHaveLength(0)
    expect(ps[4].view()?.mesas[0].tricks[0].plays).toHaveLength(1)
  })
})
