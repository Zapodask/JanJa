import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { ChessView } from '../src/shared/games/chess/types'
import { GAMES } from '../src/shared/games/registry'
import { seededRng } from '../src/shared/games/types'
import type { ServerMessage } from '../src/shared/protocol'
import { RoomCore, type Conn, type ConnData, type RoomConfig } from '../src/worker/core'
import type { GameSnapshot } from '../src/worker/game/host'

/** Integração: servidor (RoomCore + GameHost) com o xadrez real (um de cada vez, relógio no alarme), por mensagens. */
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
  view(): ChessView | undefined {
    return this.inbox.filter((m) => m.type === 'game-view').at(-1)?.view as ChessView | undefined
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

describe('servidor + xadrez', () => {
  async function game(minutes = 5) {
    const r = new Room()
    const host = await r.join('Pedro', HOST_KEY)
    const bia = await r.join('Bia')
    const caio = await r.join('Caio')
    await host.say({ type: 'game-open', gameId: 'chess', options: { minutes } })
    for (const p of [host, bia]) await p.say({ type: 'game-sit' })
    await caio.say({ type: 'game-sit' })
    expect(errors(caio).at(-1)).toMatchObject({ code: 'mesa-cheia' })
    await host.say({ type: 'game-start' })
    const white = host.view()?.you?.color === 'w' ? host : bia
    const black = white === host ? bia : host
    return { r, host, bia, caio, white, black }
  }

  it('lances por mensagem; espectador vê sem lances legais', async () => {
    const { white, black, caio } = await game()
    expect(black.view()?.you?.color).toBe('b')
    expect(caio.view()?.you).toBeNull()
    await white.say({ type: 'game-action', seq: white.seq(), action: { type: 'move', from: 'e2', to: 'e4' } })
    expect(errors(white)).toHaveLength(0)
    expect(caio.view()?.moves.map((m) => m.san)).toEqual(['e4'])
    expect(caio.view()?.legal).toEqual({})
    expect(Object.keys(black.view()?.legal ?? {})).toHaveLength(10)
    // fora da vez
    await white.say({ type: 'game-action', seq: white.seq(), action: { type: 'move', from: 'd2', to: 'd4' } })
    expect(errors(white).at(-1)).toMatchObject({ code: 'nao-e-sua-vez' })
  })

  it('o alarme derruba quem estoura o tempo', async () => {
    const { r, white } = await game(5)
    const d = r.core.game.nextDeadline()!
    expect(d).toBe(r.now + 300_000)
    r.now = d
    r.core.game.onTick(d)
    expect(white.view()?.result).toEqual({ winner: 'b', reason: 'tempo' })
    expect(r.core.game.nextDeadline()).toBeNull()
  })

  it('desistir encerra a partida', async () => {
    const { white, black } = await game(0)
    expect(white.seq()).toBeGreaterThan(0)
    await black.say({ type: 'game-action', seq: black.seq(), action: { type: 'resign' } })
    expect(white.view()?.result).toEqual({ winner: 'w', reason: 'desistiu' })
  })
})
