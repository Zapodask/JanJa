import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { StopView } from '../src/shared/games/stop/types'
import { GAMES } from '../src/shared/games/registry'
import { seededRng } from '../src/shared/games/types'
import type { ServerMessage } from '../src/shared/protocol'
import { RoomCore, type Conn, type ConnData, type RoomConfig } from '../src/worker/core'
import type { GameSnapshot } from '../src/worker/game/host'

/** Integração: servidor (RoomCore + GameHost) com o Stop real (todos escrevem juntos, respostas escondidas), por mensagens. */
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
  view(): StopView | undefined {
    return this.inbox.filter((m) => m.type === 'game-view').at(-1)?.view as StopView | undefined
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

describe('servidor + Stop', () => {
  it('todos escrevem juntos (seq velho vale), as respostas ficam escondidas até o STOP', async () => {
    const r = new Room()
    const ps = [await r.join('Pedro', HOST_KEY), await r.join('Bia'), await r.join('Caio')]
    await ps[0].say({ type: 'game-open', gameId: 'stop', options: { categories: ['nome', 'animal', 'cor'], rounds: 3, seconds: 60 } })
    for (const p of ps) await p.say({ type: 'game-sit' })
    await ps[0].say({ type: 'game-start' })
    const v = ps[0].view()!
    const L = v.letter
    const seq = ps[0].seq()
    await ps[1].say({ type: 'game-action', seq, action: { type: 'write', round: 1, answers: { nome: `${L}xyzzy` } } })
    // o Caio escreve com o seq de antes do Bia: vale (todo mundo escreve junto)
    await ps[2].say({ type: 'game-action', seq, action: { type: 'write', round: 1, answers: { nome: `${L}qwert` } } })
    expect(errors(ps[2])).toHaveLength(0)
    expect(JSON.stringify(ps[0].view())).not.toContain('xyzzy')
    expect(ps[0].view()!.players[1].filled).toBe(1)
    await ps[0].say({ type: 'game-action', seq: ps[0].seq(), action: { type: 'stop', round: 1, answers: { nome: `${L}a`, animal: `${L}b`, cor: `${L}c` } } })
    expect(ps[1].view()!.phase).toBe('parando')
    const d = r.core.game.nextDeadline()!
    r.now = d
    r.core.game.onTick(d)
    expect(ps[0].view()!.phase).toBe('conferindo')
    expect(ps[0].view()!.review?.nome.map((e) => e.answer)).toEqual([`${L}a`, `${L}xyzzy`, `${L}qwert`])
  })
})
