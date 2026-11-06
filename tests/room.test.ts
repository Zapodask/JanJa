import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { ServerMessage } from '../src/shared/protocol'
import { RoomCore, type Conn, type ConnData, type RoomConfig } from '../src/worker/core'

const sha = async (t: string) => createHash('sha256').update(t).digest('hex')
const HOST_KEY = 'chave-do-host'

class FakeConn implements Conn {
  inbox: ServerMessage[] = []
  closed?: string
  private d: ConnData = {}
  constructor(private readonly room: FakeRoom) {}
  send(msg: ServerMessage) {
    if (!this.closed) this.inbox.push(msg)
  }
  close(_code: number, reason: string) {
    this.closed = reason
    this.room.drop(this)
  }
  data() {
    return this.d
  }
  setData(d: ConnData) {
    this.d = d
  }
  /** outro objeto para a mesma conexão */
  view(): Conn {
    return {
      send: (m) => this.send(m),
      close: (code, reason) => this.close(code, reason),
      data: () => this.data(),
      setData: (d) => this.setData(d)
    }
  }
  last<T extends ServerMessage['type']>(type: T) {
    return [...this.inbox].reverse().find((m) => m.type === type) as Extract<ServerMessage, { type: T }> | undefined
  }
  async say(msg: unknown) {
    await this.room.core.onMessage(this, JSON.stringify(msg))
  }
}

class FakeRoom {
  conns: FakeConn[] = []
  core: RoomCore
  private n = 0
  constructor(public config: RoomConfig | undefined, maxPeers?: number) {
    this.core = new RoomCore({
      // como no Durable Object: objetos novos a cada chamada, apontando para o mesmo socket
      conns: () => this.conns.map((c) => c.view()),
      config: () => this.config,
      hash: sha,
      newId: () => `id${++this.n}`,
      iceServers: async () => [{ urls: 'stun:stun.example:3478' }],
      maxPeers
    })
  }
  open() {
    const c = new FakeConn(this)
    this.conns.push(c)
    return c
  }
  drop(c: FakeConn) {
    this.core.onClose(c)
    this.conns = this.conns.filter((x) => x !== c)
  }
  leave(c: FakeConn) {
    const left = this.core.onClose(c)
    this.conns = this.conns.filter((x) => x !== c)
    return left
  }
}

const room = async (requireApproval = false, maxPeers?: number) =>
  new FakeRoom({ hostKeyHash: await sha(HOST_KEY), requireApproval }, maxPeers)

describe('sala sem aprovação', () => {
  it('apresenta os participantes, marca o host e avisa quem entra e sai', async () => {
    const r = await room()
    const host = r.open()
    await host.say({ type: 'join', name: 'Pedro', hostKey: HOST_KEY })
    const wh = host.last('welcome')!
    expect(wh).toMatchObject({ isHost: true, peers: [], iceServers: [{ urls: 'stun:stun.example:3478' }] })
    expect(host.last('peer-joined')).toBeUndefined()

    const bia = r.open()
    await bia.say({ type: 'join', name: 'Bia', hostKey: 'chave-errada' })
    const wb = bia.last('welcome')!
    expect(wb.isHost).toBe(false)
    expect(wb.peers).toEqual([{ peerId: wh.peerId, name: 'Pedro', state: { sharing: false, micMuted: false }, isHost: true }])
    expect(host.last('peer-joined')!.peer).toMatchObject({ peerId: wb.peerId, name: 'Bia', isHost: false })
    // ninguém recebe o aviso da própria entrada
    expect(bia.inbox.filter((m) => m.type === 'peer-joined')).toEqual([])

    expect(r.leave(bia)).toBe(1)
    expect(host.last('peer-left')!.peerId).toBe(wb.peerId)
  })

  it('repassa signal só ao destinatário e propaga estado', async () => {
    const r = await room()
    const [a, b, c] = [r.open(), r.open(), r.open()]
    await a.say({ type: 'join', name: 'A' })
    await b.say({ type: 'join', name: 'B' })
    await c.say({ type: 'join', name: 'C' })
    const ida = a.last('welcome')!.peerId
    const idb = b.last('welcome')!.peerId
    const payload = { description: { type: 'offer', sdp: 'v=0' } }
    await b.say({ type: 'signal', to: ida, payload })
    expect(a.last('signal')).toEqual({ type: 'signal', from: idb, payload })
    expect(c.last('signal')).toBeUndefined()

    await b.say({ type: 'state', state: { sharing: true, micMuted: false, screenStreamId: 's1' } })
    expect(a.last('state')).toEqual({ type: 'state', from: idb, state: { sharing: true, micMuted: false, screenStreamId: 's1' } })
    const d = r.open()
    await d.say({ type: 'join', name: 'D' })
    expect(d.last('welcome')!.peers.find((p) => p.peerId === idb)?.state.sharing).toBe(true)
  })

  it('recusa sala inexistente, sala cheia e mensagens fora do protocolo', async () => {
    const ghost = new FakeRoom(undefined)
    const g = ghost.open()
    await g.say({ type: 'join', name: 'X' })
    expect(g.last('error')!.code).toBe('room-not-found')
    expect(g.closed).toBe('room-not-found')

    const r = await room(false, 2)
    await r.open().say({ type: 'join', name: 'A' })
    await r.open().say({ type: 'join', name: 'B' })
    const c = r.open()
    await c.say({ type: 'join', name: 'C' })
    expect(c.last('error')!.code).toBe('room-full')

    const x = new FakeRoom({ hostKeyHash: 'h', requireApproval: false }).open()
    await x.say('não é objeto')
    expect(x.last('error')!.code).toBe('bad-message')
    await x.say({ type: 'signal', to: 'y', payload: {} })
    expect(x.last('error')!.code).toBe('not-joined')
  })
})

describe('sala com aprovação', () => {
  it('o host entra direto; convidados esperam e o host aceita ou recusa', async () => {
    const r = await room(true)
    const host = r.open()
    await host.say({ type: 'join', name: 'Pedro', hostKey: HOST_KEY })
    expect(host.last('welcome')!.isHost).toBe(true)

    const ok = r.open()
    await ok.say({ type: 'join', name: 'Amigo' })
    expect(ok.last('waiting-approval')).toBeDefined()
    expect(ok.last('welcome')).toBeUndefined()
    const req = host.last('join-request')!
    expect(req.name).toBe('Amigo')
    await host.say({ type: 'join-response', requestId: req.requestId, approved: true })
    expect(ok.last('welcome')!.peers.map((p) => p.name)).toEqual(['Pedro'])
    expect(host.last('peer-joined')!.peer.name).toBe('Amigo')

    const no = r.open()
    await no.say({ type: 'join', name: 'Intruso' })
    const req2 = host.last('join-request')!
    await host.say({ type: 'join-response', requestId: req2.requestId, approved: false })
    expect(no.last('error')!.code).toBe('denied')
    expect(no.closed).toBe('denied')
  })

  it('só o host aprova, e sem host ninguém entra', async () => {
    const r = await room(true)
    const early = r.open()
    await early.say({ type: 'join', name: 'Cedo' })
    expect(early.last('error')!.code).toBe('host-absent')

    const host = r.open()
    await host.say({ type: 'join', name: 'Pedro', hostKey: HOST_KEY })
    const a = r.open()
    await a.say({ type: 'join', name: 'A' })
    const reqA = host.last('join-request')!
    await host.say({ type: 'join-response', requestId: reqA.requestId, approved: true })

    const b = r.open()
    await b.say({ type: 'join', name: 'B' })
    const reqB = host.last('join-request')!
    await a.say({ type: 'join-response', requestId: reqB.requestId, approved: true })
    expect(b.last('welcome')).toBeUndefined()

    r.leave(host)
    expect(b.last('error')!.code).toBe('host-absent')
    expect(a.last('peer-left')).toBeDefined()
  })

  it('avisa o host quando quem esperava desiste', async () => {
    const r = await room(true)
    const host = r.open()
    await host.say({ type: 'join', name: 'Pedro', hostKey: HOST_KEY })
    const g = r.open()
    await g.say({ type: 'join', name: 'Desistente' })
    const req = host.last('join-request')!
    r.leave(g)
    expect(host.last('join-request-cancelled')!.requestId).toBe(req.requestId)
  })
})
