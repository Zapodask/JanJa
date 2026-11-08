import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { highCardGame, type HighCardState } from '../src/shared/games/highcard'
import { RELAY_MAX_PER_SEC } from '../src/shared/games/protocol'
import { seededRng, type AnyGame } from '../src/shared/games/types'
import type { ServerMessage } from '../src/shared/protocol'
import { RoomCore, type Conn, type ConnData, type RoomConfig } from '../src/worker/core'
import type { GameSnapshot } from '../src/worker/game/host'

const sha = async (t: string) => createHash('sha256').update(t).digest('hex')
const HOST_KEY = 'chave-do-host'

class FakeConn implements Conn {
  inbox: ServerMessage[] = []
  private d: ConnData = {}
  constructor(private readonly room: FakeRoom) {}
  send(msg: ServerMessage) {
    this.inbox.push(msg)
  }
  close() {}
  data() {
    return this.d
  }
  setData(d: ConnData) {
    this.d = d
  }
  view(): Conn {
    return { send: (m) => this.send(m), close: () => {}, data: () => this.data(), setData: (d) => this.setData(d) }
  }
  all<T extends ServerMessage['type']>(type: T) {
    return this.inbox.filter((m) => m.type === type) as Extract<ServerMessage, { type: T }>[]
  }
  relays() {
    return this.all('game-relay')
  }
  errors() {
    return this.all('game-error').map((e) => e.code)
  }
  playerId() {
    return this.all('game-lobby').at(-1)?.lobby?.seats.find((s) => s.you)?.playerId
  }
  async say(msg: unknown) {
    await this.room.core.onMessage(this, JSON.stringify(msg))
  }
}

/** highcard + entrada no meio da partida */
const joinable: AnyGame = {
  ...highCardGame,
  addPlayer(state: HighCardState, player) {
    return {
      state: { ...state, players: [...state.players, player], scores: { ...state.scores, [player.playerId]: 0 } } satisfies HighCardState,
      events: []
    }
  }
}

class FakeRoom {
  conns: FakeConn[] = []
  core: RoomCore
  now = 1_000_000
  private n = 0
  constructor(game: AnyGame) {
    const config: RoomConfig = { hostKeyHash: createHash('sha256').update(HOST_KEY).digest('hex'), requireApproval: false }
    let stored: GameSnapshot | undefined
    this.core = new RoomCore({
      conns: () => this.conns.map((c) => c.view()),
      config: () => config,
      hash: sha,
      newId: () => `id${++this.n}`,
      iceServers: async () => [],
      now: () => this.now,
      rng: () => seededRng(7),
      loadGame: () => stored,
      saveGame: (s) => {
        stored = s ? (JSON.parse(JSON.stringify(s)) as GameSnapshot) : undefined
      },
      registry: { poker: game }
    })
  }
  async join(name: string) {
    const c = new FakeConn(this)
    this.conns.push(c)
    await c.say({ type: 'join', name, clientId: `client-${name}-0000` })
    return c
  }
}

async function started(game: AnyGame = highCardGame, sit = ['ana', 'bia', 'cau']) {
  const r = new FakeRoom(game)
  const conns: Record<string, FakeConn> = {}
  for (const n of [...sit, 'fora']) conns[n] = await r.join(n)
  await conns[sit[0]].say({ type: 'game-open', gameId: 'poker', options: { rounds: 3 } })
  for (const n of sit) await conns[n].say({ type: 'game-sit' })
  await conns[sit[0]].say({ type: 'game-start' })
  return { r, ...conns } as { r: FakeRoom } & Record<'ana' | 'bia' | 'cau' | 'fora', FakeConn>
}

describe('game-relay', () => {
  it('repassa para um sentado com o playerId de quem mandou', async () => {
    const { ana, bia, cau } = await started()
    await ana.say({ type: 'game-relay', to: bia.playerId(), data: 'AAEC' })
    expect(bia.relays()).toEqual([{ type: 'game-relay', from: ana.playerId(), data: 'AAEC' }])
    expect(cau.relays()).toEqual([])
    expect(ana.relays()).toEqual([])
    expect(ana.errors()).toEqual([])
  })

  it('"*" vai para todos os sentados menos quem mandou (e não para quem está de fora)', async () => {
    const { ana, bia, cau, fora } = await started()
    await ana.say({ type: 'game-relay', to: '*', data: 'xyz' })
    expect(bia.relays()).toHaveLength(1)
    expect(cau.relays()).toHaveLength(1)
    expect(ana.relays()).toHaveLength(0)
    expect(fora.relays()).toHaveLength(0)
  })

  it('quem não está sentado é ignorado, sem erro; destino desconhecido também', async () => {
    const { ana, bia, fora } = await started()
    await fora.say({ type: 'game-relay', to: ana.playerId(), data: 'x' })
    await fora.say({ type: 'game-relay', to: '*', data: 'x' })
    await ana.say({ type: 'game-relay', to: 'ninguem', data: 'x' })
    expect(ana.relays()).toHaveLength(0)
    expect(bia.relays()).toHaveLength(0)
    expect(fora.errors()).toEqual([])
    expect(ana.errors()).toEqual([])
  })

  it('antes de iniciar não repassa', async () => {
    const r = new FakeRoom(highCardGame)
    const a = await r.join('ana')
    const b = await r.join('bia')
    await a.say({ type: 'game-open', gameId: 'poker', options: {} })
    await a.say({ type: 'game-sit' })
    await b.say({ type: 'game-sit' })
    await a.say({ type: 'game-relay', to: '*', data: 'x' })
    expect(b.relays()).toHaveLength(0)
  })

  it('limite por segundo por conexão; a janela reabre depois de 1 s', async () => {
    const { r, ana, bia, cau } = await started()
    for (let i = 0; i < RELAY_MAX_PER_SEC + 25; i++) await ana.say({ type: 'game-relay', to: bia.playerId(), data: 'x' })
    expect(bia.relays()).toHaveLength(RELAY_MAX_PER_SEC)
    expect(ana.errors()).toEqual([])
    // outra conexão tem a própria cota
    await cau.say({ type: 'game-relay', to: bia.playerId(), data: 'x' })
    expect(bia.relays()).toHaveLength(RELAY_MAX_PER_SEC + 1)
    r.now += 1000
    await ana.say({ type: 'game-relay', to: bia.playerId(), data: 'x' })
    expect(bia.relays()).toHaveLength(RELAY_MAX_PER_SEC + 2)
  })

  it('pacote grande demais é recusado pelo protocolo', async () => {
    const { ana, bia } = await started()
    await ana.say({ type: 'game-relay', to: bia.playerId(), data: 'a'.repeat(6001) })
    expect(bia.relays()).toHaveLength(0)
    expect(ana.all('error')).toHaveLength(1)
  })
})

describe('addPlayer (entrar no meio)', () => {
  it('jogo com addPlayer aceita quem senta depois do início', async () => {
    const { r, ana, fora } = await started(joinable, ['ana', 'bia'])
    await fora.say({ type: 'game-sit' })
    expect(fora.errors()).toEqual([])
    expect(ana.all('game-lobby').at(-1)?.lobby?.seats.map((s) => s.name)).toEqual(['ana', 'bia', 'fora'])
    const v = fora.all('game-view').at(-1)?.view as { players: { name: string }[] }
    expect(v.players.map((p: { name: string }) => p.name)).toContain('fora')
    // e já pode usar o repasse
    await fora.say({ type: 'game-relay', to: ana.playerId(), data: 'oi' })
    expect(ana.relays()).toHaveLength(1)
    void r
  })

  it('jogo sem addPlayer mantém ja-comecou', async () => {
    const { fora } = await started(highCardGame, ['ana', 'bia'])
    await fora.say({ type: 'game-sit' })
    expect(fora.errors()).toEqual(['ja-comecou'])
  })

  it('mesa cheia recusa', async () => {
    const small: AnyGame = { ...joinable, maxPlayers: 2 }
    const { fora } = await started(small, ['ana', 'bia'])
    await fora.say({ type: 'game-sit' })
    expect(fora.errors()).toEqual(['mesa-cheia'])
  })
})
