import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { TycoonView } from '../src/shared/games/tycoon/types'
import { GAMES } from '../src/shared/games/registry'
import { seededRng } from '../src/shared/games/types'
import type { ServerMessage } from '../src/shared/protocol'
import { RoomCore, type Conn, type ConnData, type RoomConfig } from '../src/worker/core'
import type { GameSnapshot } from '../src/worker/game/host'

/** Integração: servidor (RoomCore + GameHost) com o Magnata real (um de cada vez, prazo de cada vez no alarme), por mensagens. */
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
  view(): TycoonView | undefined {
    return this.inbox.filter((m) => m.type === 'game-view').at(-1)?.view as TycoonView | undefined
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

describe('servidor + Magnata', () => {
  it('rola por mensagem, o prazo estourado joga sozinho e espectador vê tudo', async () => {
    const r = new Room()
    const host = await r.join('Pedro', HOST_KEY)
    const bia = await r.join('Bia')
    const caio = await r.join('Caio')
    await host.say({ type: 'game-open', gameId: 'tycoon', options: { minutes: 15 } })
    for (const p of [host, bia]) await p.say({ type: 'game-sit' })
    await host.say({ type: 'game-start' })
    const v = host.view()!
    const first = v.turn === v.you?.playerId ? host : bia
    const other = first === host ? bia : host
    await other.say({ type: 'game-action', seq: other.seq(), action: { type: 'roll' } })
    expect(errors(other).at(-1)).toMatchObject({ code: 'nao-e-sua-vez' })
    await first.say({ type: 'game-action', seq: first.seq(), action: { type: 'roll' } })
    expect(errors(first)).toHaveLength(0)
    expect(caio.view()?.dice).not.toBeNull()
    expect(caio.view()?.you).toBeNull()
    // ninguém faz nada: o alarme vai jogando
    const before = caio.view()!.rolls
    for (let i = 0; i < 6; i++) {
      const d = r.core.game.nextDeadline()!
      r.now = d
      r.core.game.onTick(d)
    }
    expect(caio.view()!.rolls).toBeGreaterThan(before)
  })
})
