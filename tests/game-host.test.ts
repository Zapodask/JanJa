import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { highCardGame, ROUND_MS, type HighCardView } from '../src/shared/games/highcard'
import { seededRng } from '../src/shared/games/types'
import { ClientMessageSchema, type ServerMessage } from '../src/shared/protocol'
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
  last<T extends ServerMessage['type']>(type: T) {
    return this.all(type).at(-1)
  }
  lobby() {
    return this.last('game-lobby')?.lobby
  }
  gview() {
    return this.last('game-view')?.view as HighCardView | undefined
  }
  seq() {
    return this.last('game-view')?.seq ?? 0
  }
  errors() {
    return this.all('game-error').map((e) => e.code)
  }
  async say(msg: unknown) {
    await this.room.core.onMessage(this, JSON.stringify(msg))
  }
}

class FakeRoom {
  conns: FakeConn[] = []
  core: RoomCore
  now = 1_000_000
  stored: GameSnapshot | null | undefined
  private n = 0
  constructor(opts: { load?: GameSnapshot } = {}) {
    this.stored = opts.load
    const config: RoomConfig = { hostKeyHash: createHash('sha256').update(HOST_KEY).digest('hex'), requireApproval: false }
    this.core = new RoomCore({
      conns: () => this.conns.map((c) => c.view()),
      config: () => config,
      hash: sha,
      newId: () => `id${++this.n}`,
      iceServers: async () => [],
      now: () => this.now,
      rng: () => seededRng(7),
      loadGame: () => this.stored ?? undefined,
      saveGame: (s) => {
        // simula o storage: guarda uma cópia serializada
        this.stored = s ? (JSON.parse(JSON.stringify(s)) as GameSnapshot) : null
      },
      registry: { poker: highCardGame }
    })
  }
  async join(name: string, clientId?: string, hostKey?: string) {
    const c = new FakeConn(this)
    this.conns.push(c)
    await c.say({ type: 'join', name, clientId, hostKey })
    return c
  }
  leave(c: FakeConn) {
    this.core.onClose(c)
    this.conns = this.conns.filter((x) => x !== c)
  }
}

const CID = (n: string) => `client-${n}-0000`

async function table(sit = ['ana', 'bia']) {
  const r = new FakeRoom()
  const host = await r.join('Host', CID('host'), HOST_KEY)
  const players: Record<string, FakeConn> = {}
  for (const n of sit) players[n] = await r.join(n, CID(n))
  await players[sit[0]].say({ type: 'game-open', gameId: 'poker', options: { rounds: 3 } })
  for (const n of sit) await players[n].say({ type: 'game-sit' })
  return { r, host, ...players } as { r: FakeRoom; host: FakeConn } & Record<string, FakeConn>
}

describe('protocolo', () => {
  it('aceita game-* e clientId opcional no join', () => {
    expect(ClientMessageSchema.safeParse({ type: 'join', name: 'a' }).success).toBe(true)
    expect(ClientMessageSchema.safeParse({ type: 'join', name: 'a', clientId: 'abcdefgh' }).success).toBe(true)
    expect(ClientMessageSchema.safeParse({ type: 'join', name: 'a', clientId: 'x' }).success).toBe(false)
    expect(ClientMessageSchema.safeParse({ type: 'game-action', seq: 1, action: { a: 1 } }).success).toBe(true)
    expect(ClientMessageSchema.safeParse({ type: 'game-action', seq: -1, action: 1 }).success).toBe(false)
  })
})

describe('lobby', () => {
  it('abre com opções validadas, senta e levanta; todos veem o lobby', async () => {
    const { r, host, ana } = await table(['ana'])
    expect(host.lobby()?.seats.map((s) => s.name)).toEqual(['ana'])
    expect(host.lobby()?.seats[0].you).toBe(false)
    expect(ana.lobby()?.seats[0].you).toBe(true)
    expect(JSON.stringify(host.inbox)).not.toContain(CID('ana'))
    await ana.say({ type: 'game-stand' })
    expect(host.lobby()?.seats).toEqual([])
    const late = await r.join('Late', CID('late'))
    expect(late.lobby()?.openedBy).toBe('ana')
  })

  it('recusa opções inválidas, segundo jogo e jogo inexistente', async () => {
    const r = new FakeRoom()
    const a = await r.join('A', CID('a'))
    await a.say({ type: 'game-open', gameId: 'poker', options: { rounds: 99 } })
    expect(a.errors()).toEqual(['opcoes-invalidas'])
    await a.say({ type: 'game-sit' })
    expect(a.errors().at(-1)).toBe('sem-jogo')
    await a.say({ type: 'game-open', gameId: 'poker', options: {} })
    await a.say({ type: 'game-open', gameId: 'poker', options: {} })
    expect(a.errors().at(-1)).toBe('jogo-aberto')
  })

  it('cadeira ocupada, mesa cheia e cadeira fora do limite', async () => {
    const { r, ana, bia } = await table(['ana', 'bia'])
    await bia.say({ type: 'game-sit', seat: 0 })
    expect(bia.errors()).toEqual(['mesa-cheia'])
    await bia.say({ type: 'game-sit', seat: 9 })
    expect(bia.errors()).toEqual(['mesa-cheia', 'mesa-cheia'])
    await bia.say({ type: 'game-sit', seat: 5 })
    expect(ana.lobby()?.seats.map((s) => s.seat)).toEqual([0, 5])
    expect(r.stored?.seats).toHaveLength(2)
  })

  it('iniciar/encerrar: só quem abriu ou o host; mínimo de jogadores', async () => {
    const { host, ana, bia } = await table(['ana', 'bia'])
    await bia.say({ type: 'game-start' })
    expect(bia.errors()).toEqual(['sem-permissao'])
    await bia.say({ type: 'game-close' })
    expect(bia.errors()).toEqual(['sem-permissao', 'sem-permissao'])
    const solo = await table(['solo'])
    await solo.solo.say({ type: 'game-start' })
    expect(solo.solo.errors()).toEqual(['jogadores-insuficientes'])
    await ana.say({ type: 'game-start' })
    expect(ana.lobby()?.started).toBe(true)
    await host.say({ type: 'game-close' }) // host da sala pode
    expect(bia.lobby()).toBeNull()
  })
})

describe('partida', () => {
  it('cada um só recebe a própria carta; espectador não recebe nenhuma', async () => {
    const { r, host, ana, bia } = await table()
    await ana.say({ type: 'game-start' })
    const va = ana.gview()!
    const vb = bia.gview()!
    const vh = host.gview()!
    expect(va.you).not.toBe(vb.you)
    expect(va.myCard).not.toBeNull()
    expect(vb.myCard).not.toBeNull()
    expect(vh.myCard).toBeNull()
    for (const v of [va, vb, vh]) expect(v.cards).toBeNull()
    // a carta alheia não aparece em nenhum lugar do que a pessoa recebeu
    const everything = (c: FakeConn) => JSON.stringify(c.inbox.filter((m) => m.type !== 'game-lobby'))
    expect(everything(host)).not.toMatch(/"myCard":\d/)
    expect(r.stored?.state).toBeTruthy()
    // revelar depois que todos confirmam
    await ana.say({ type: 'game-action', seq: ana.seq(), action: { type: 'ready' } })
    expect(ana.gview()!.cards).toBeNull()
    await bia.say({ type: 'game-action', seq: bia.seq(), action: { type: 'ready' } })
    for (const c of [ana, bia, host]) expect(c.gview()!.cards).not.toBeNull()
    expect(host.all('game-events').at(-1)!.events[0]).toMatchObject({ type: 'reveal' })
  })

  it('seq cresce; seq antigo é recusado; ação inválida e fora da partida são recusadas', async () => {
    const { host, ana, bia } = await table()
    await ana.say({ type: 'game-action', seq: 0, action: { type: 'ready' } })
    expect(ana.errors()).toEqual(['acao-invalida']) // partida não começou
    await ana.say({ type: 'game-start' })
    const s0 = ana.seq()
    await ana.say({ type: 'game-action', seq: s0, action: { type: 'ready' } })
    expect(ana.seq()).toBeGreaterThan(s0)
    expect(bia.seq()).toBe(ana.seq())
    await bia.say({ type: 'game-action', seq: s0, action: { type: 'ready' } })
    expect(bia.errors()).toEqual(['seq-antigo'])
    await bia.say({ type: 'game-action', seq: bia.seq() + 5, action: { type: 'ready' } })
    expect(bia.errors().at(-1)).toBe('acao-invalida')
    await bia.say({ type: 'game-action', seq: bia.seq(), action: { type: 'trapaca' } })
    expect(bia.errors().at(-1)).toBe('acao-invalida')
    await ana.say({ type: 'game-action', seq: ana.seq(), action: { type: 'ready' } })
    expect(ana.errors().at(-1)).toBe('acao-invalida') // já estava pronto
    await host.say({ type: 'game-action', seq: host.seq(), action: { type: 'ready' } })
    expect(host.errors()).toEqual(['nao-sentado'])
    const seqs = ana.all('game-view').map((m) => m.seq)
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
  })

  it('não dá para sentar nem levantar no meio da partida', async () => {
    const { host, ana } = await table()
    await ana.say({ type: 'game-start' })
    await host.say({ type: 'game-sit' })
    expect(host.errors()).toEqual(['ja-comecou'])
    await ana.say({ type: 'game-stand' })
    expect(ana.errors()).toEqual(['ja-comecou'])
    await ana.say({ type: 'game-start' })
    expect(ana.errors().at(-1)).toBe('ja-comecou')
  })

  it('tick: revela, distribui a nova rodada e termina; nextDeadline some no fim', async () => {
    const { r, ana, bia } = await table()
    await ana.say({ type: 'game-start' })
    expect(r.core.game.nextDeadline()).toBe(r.now + ROUND_MS)
    r.core.game.onTick(r.now + 1) // ainda não venceu
    expect(ana.gview()!.revealed).toBe(false)
    for (let i = 0; i < 3; i++) {
      r.now += ROUND_MS
      r.core.game.onTick() // revela
      expect(ana.gview()!.revealed).toBe(true)
      if (i < 2) {
        r.now += ROUND_MS
        r.core.game.onTick() // nova rodada
        expect(ana.gview()!.round).toBe(i + 2)
        expect(ana.gview()!.revealed).toBe(false)
      }
    }
    expect(bia.gview()!.over).toBe(true)
    expect(r.core.game.nextDeadline()).toBeNull()
    await ana.say({ type: 'game-action', seq: ana.seq(), action: { type: 'ready' } })
    expect(ana.errors()).toEqual(['partida-encerrada'])
    await ana.say({ type: 'game-stand' }) // acabou: pode sair da mesa
    expect(ana.errors()).toEqual(['partida-encerrada'])
  })
})

describe('reconexão e presença', () => {
  it('mesmo clientId recupera a cadeira e recebe lobby + view; presença no jogo e no lobby', async () => {
    const { r, host, ana, bia } = await table()
    await ana.say({ type: 'game-start' })
    const pidBia = bia.gview()!.you!
    const cardBia = bia.gview()!.myCard
    r.leave(bia)
    expect(host.gview()!.away[pidBia]).toBe(true)
    expect(host.lobby()!.seats.find((s) => s.playerId === pidBia)!.present).toBe(false)
    const bia2 = await r.join('Bia', CID('bia'))
    expect(bia2.lobby()!.seats.find((s) => s.you)!.playerId).toBe(pidBia)
    expect(bia2.gview()!.myCard).toBe(cardBia)
    expect(bia2.gview()!.you).toBe(pidBia)
    expect(host.gview()!.away[pidBia]).toBe(false)
    expect(host.lobby()!.seats.find((s) => s.playerId === pidBia)!.present).toBe(true)
  })

  it('clientId de outra pessoa não dá a cadeira; duas abas contam como uma presença', async () => {
    const { r, host, ana, bia } = await table()
    await ana.say({ type: 'game-start' })
    const intruso = await r.join('Intruso', CID('intruso'))
    expect(intruso.gview()!.you).toBeNull()
    expect(intruso.gview()!.myCard).toBeNull()
    const aba2 = await r.join('Bia', CID('bia'))
    expect(aba2.gview()!.you).toBe(bia.gview()!.you)
    r.leave(bia)
    expect(host.gview()!.away[aba2.gview()!.you!]).toBeFalsy()
    r.leave(aba2)
    expect(host.gview()!.away[aba2.gview()!.you!]).toBe(true)
  })

  it('cliente sem clientId entra como espectador/jogador temporário sem quebrar', async () => {
    const r = new FakeRoom()
    const a = await r.join('Antigo')
    await a.say({ type: 'game-open', gameId: 'poker', options: {} })
    await a.say({ type: 'game-sit' })
    expect(a.lobby()!.seats).toHaveLength(1)
  })
})

describe('persistência', () => {
  it('salva no meio e uma nova instância continua de onde parou, sem vazar clientId', async () => {
    const { r, ana, bia } = await table()
    await ana.say({ type: 'game-start' })
    await ana.say({ type: 'game-action', seq: ana.seq(), action: { type: 'ready' } })
    const snap = r.stored!
    expect(snap.started).toBe(true)
    const pidBia = bia.gview()!.you!
    const cardBia = bia.gview()!.myCard

    const r2 = new FakeRoom({ load: JSON.parse(JSON.stringify(snap)) })
    r2.now = r.now
    const ana2 = await r2.join('Ana', CID('ana'))
    const bia2 = await r2.join('Bia', CID('bia'))
    expect(bia2.gview()!.you).toBe(pidBia)
    expect(bia2.gview()!.myCard).toBe(cardBia)
    expect(bia2.seq()).toBeGreaterThanOrEqual(snap.seq)
    expect(ana2.gview()!.ready[ana.gview()!.you!]).toBe(true)
    await bia2.say({ type: 'game-action', seq: bia2.seq(), action: { type: 'ready' } })
    expect(bia2.gview()!.revealed).toBe(true)
    expect(r2.core.game.nextDeadline()).not.toBeNull()
    expect(JSON.stringify(ana2.inbox)).not.toContain(CID('bia'))
  })

  it('encerrar apaga o snapshot', async () => {
    const { r, ana } = await table()
    await ana.say({ type: 'game-close' })
    expect(r.stored).toBeNull()
  })

  it('snapshot de jogo desconhecido é ignorado', async () => {
    const bad = { v: 1, gameId: 'xadrez' } as unknown as GameSnapshot
    const r = new FakeRoom({ load: bad })
    const a = await r.join('A', CID('a'))
    expect(a.lobby()).toBeUndefined()
  })
})
