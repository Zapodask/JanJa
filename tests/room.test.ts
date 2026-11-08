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
      saveConfig: (c) => {
        this.config = c
      },
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
    expect(wb.peers).toEqual([
      { peerId: wh.peerId, name: 'Pedro', state: { sharing: false, micMuted: false }, isHost: true, channelId: 'geral' }
    ])
    expect(wb.channelId).toBe('geral')
    // sala sem nome gravado (criada antes de as salas terem nome) usa o nome padrão
    expect(wb.settings).toEqual({ name: 'Sala', channels: [{ id: 'geral', name: 'Geral' }] })
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

describe('canais e limite', () => {
  const setup = async () => {
    const r = await room()
    const host = r.open()
    await host.say({ type: 'join', name: 'Pedro', hostKey: HOST_KEY })
    const bia = r.open()
    await bia.say({ type: 'join', name: 'Bia' })
    return { r, host, bia, idh: host.last('welcome')!.peerId, idb: bia.last('welcome')!.peerId }
  }

  it('o host cria, edita e apaga canais; todos recebem as mudanças', async () => {
    const { r, host, bia } = await setup()
    await host.say({ type: 'channel-create', name: '  Poker ', limit: 8 })
    const created = bia.last('room-settings')!.settings.channels
    expect(created.map((c) => c.name)).toEqual(['Geral', 'Poker'])
    expect(created[1].limit).toBe(8)
    expect(r.config!.channels).toEqual(created)
    const poker = created[1].id

    await host.say({ type: 'channel-edit', channelId: poker, name: 'Mesa', limit: 4 })
    expect(bia.last('room-settings')!.settings.channels[1]).toEqual({ id: poker, name: 'Mesa', limit: 4 })

    await host.say({ type: 'channel-delete', channelId: poker })
    expect(bia.last('room-settings')!.settings.channels.map((c) => c.id)).toEqual(['geral'])
    // o último canal não pode ser apagado
    await host.say({ type: 'channel-delete', channelId: 'geral' })
    expect(host.last('error')!.code).toBe('channel-limit')
  })

  it('a sala tem nome; só o dono troca e todos recebem', async () => {
    const config = { hostKeyHash: await sha(HOST_KEY), requireApproval: false, name: 'Os Jogadores' }
    const r = new FakeRoom(config)
    const host = r.open()
    await host.say({ type: 'join', name: 'Pedro', hostKey: HOST_KEY })
    expect(host.last('welcome')!.settings.name).toBe('Os Jogadores')
    const bia = r.open()
    await bia.say({ type: 'join', name: 'Bia' })

    await bia.say({ type: 'room-rename', name: 'Da Bia' })
    expect(bia.last('error')!.code).toBe('not-host')
    await host.say({ type: 'room-rename', name: '  Família  ' })
    expect(bia.last('room-settings')!.settings.name).toBe('Família')
    expect(r.config!.name).toBe('Família')
    await host.say({ type: 'room-rename', name: '   ' })
    expect(host.last('error')!.code).toBe('bad-message')
  })

  it('só o host mexe nos canais', async () => {
    const { r, host, bia } = await setup()
    await bia.say({ type: 'channel-create', name: 'Meu', limit: 0 })
    expect(bia.last('error')!.code).toBe('not-host')
    await bia.say({ type: 'channel-edit', channelId: 'geral', name: 'Meu', limit: 2 })
    expect(bia.last('error')!.code).toBe('not-host')
    await bia.say({ type: 'channel-delete', channelId: 'geral' })
    expect(bia.last('error')!.code).toBe('not-host')
    expect(r.config!.channels).toBeUndefined()
    // as mensagens antigas (limite da sala, renomear) não existem mais no protocolo
    await host.say({ type: 'room-limit', maxPeers: 0 })
    expect(host.last('error')!.code).toBe('bad-message')
    await host.say({ type: 'channel-rename', channelId: 'geral', name: 'X' })
    expect(host.last('error')!.code).toBe('bad-message')
  })

  it('trocar de canal avisa todo mundo, inclusive quem trocou', async () => {
    const { host, bia, idb } = await setup()
    await host.say({ type: 'channel-create', name: 'AFK', limit: 0 })
    const afk = host.last('room-settings')!.settings.channels[1].id
    await bia.say({ type: 'channel-join', channelId: afk })
    expect(host.last('peer-moved')).toEqual({ type: 'peer-moved', peerId: idb, channelId: afk })
    expect(bia.last('peer-moved')).toEqual({ type: 'peer-moved', peerId: idb, channelId: afk })

    await bia.say({ type: 'channel-join', channelId: 'nao-existe' })
    expect(bia.last('error')!.code).toBe('unknown-channel')
  })

  it('apagar um canal leva quem estava nele para o primeiro canal', async () => {
    const { r, host, bia, idb } = await setup()
    await host.say({ type: 'channel-create', name: 'Jogo', limit: 0 })
    const jogo = host.last('room-settings')!.settings.channels[1].id
    await bia.say({ type: 'channel-join', channelId: jogo })
    await host.say({ type: 'channel-delete', channelId: jogo })
    expect(host.last('peer-moved')).toEqual({ type: 'peer-moved', peerId: idb, channelId: 'geral' })
    const late = r.open()
    await late.say({ type: 'join', name: 'Tarde' })
    expect(late.last('welcome')!.peers.find((p) => p.peerId === idb)?.channelId).toBe('geral')
  })

  it('quem reconecta volta para o canal em que estava, se ele ainda existir', async () => {
    const { r, host } = await setup()
    await host.say({ type: 'channel-create', name: 'Jogo', limit: 0 })
    const jogo = host.last('room-settings')!.settings.channels[1].id
    const back = r.open()
    await back.say({ type: 'join', name: 'Volta', channelId: jogo })
    expect(back.last('welcome')!.channelId).toBe(jogo)
    expect(host.last('peer-joined')!.peer.channelId).toBe(jogo)
    const lost = r.open()
    await lost.say({ type: 'join', name: 'Perdido', channelId: 'sumiu' })
    expect(lost.last('welcome')!.channelId).toBe('geral')
  })

  it('canal cheio não deixa entrar; baixar o limite não tira ninguém', async () => {
    const { r, host, bia } = await setup()
    await host.say({ type: 'channel-create', name: 'Dupla', limit: 2 })
    const dupla = host.last('room-settings')!.settings.channels[1].id
    await host.say({ type: 'channel-join', channelId: dupla })
    await bia.say({ type: 'channel-join', channelId: dupla })
    const joao = r.open()
    await joao.say({ type: 'join', name: 'João' })
    await joao.say({ type: 'channel-join', channelId: dupla })
    expect(joao.last('error')!.code).toBe('channel-full')
    expect(joao.last('peer-moved')).toBeUndefined()

    await host.say({ type: 'channel-edit', channelId: dupla, name: 'Dupla', limit: 1 })
    expect(r.conns.filter((c) => c.data().channelId === dupla)).toHaveLength(2)
    await host.say({ type: 'channel-edit', channelId: dupla, name: 'Dupla', limit: 0 })
    await joao.say({ type: 'channel-join', channelId: dupla })
    expect(joao.last('peer-moved')!.channelId).toBe(dupla)
  })

  it('quem chega vai para o primeiro canal com vaga; tudo cheio, não entra (o dono entra)', async () => {
    const r = await room()
    r.config = {
      ...r.config!,
      channels: [
        { id: 'a', name: 'A', limit: 1 },
        { id: 'b', name: 'B', limit: 1 }
      ]
    }
    const p1 = r.open()
    await p1.say({ type: 'join', name: 'P1' })
    expect(p1.last('welcome')!.channelId).toBe('a')
    const p2 = r.open()
    await p2.say({ type: 'join', name: 'P2', channelId: 'a' })
    expect(p2.last('welcome')!.channelId).toBe('b')
    const p3 = r.open()
    await p3.say({ type: 'join', name: 'P3' })
    expect(p3.last('error')!.code).toBe('room-full')
    const host = r.open()
    await host.say({ type: 'join', name: 'Pedro', hostKey: HOST_KEY })
    expect(host.last('welcome')!.channelId).toBe('a')
  })

  it('sala sem limite próprio: muita gente entra (só o teto de segurança barra)', async () => {
    const r = await room()
    const many = Array.from({ length: 12 }, () => r.open())
    for (const [i, p] of many.entries()) await p.say({ type: 'join', name: `P${i}` })
    expect(many.every((p) => p.last('welcome'))).toBe(true)
  })

  it('o host entra mesmo com a sala no teto', async () => {
    const r = await room(false, 1)
    await r.open().say({ type: 'join', name: 'A' })
    const host = r.open()
    await host.say({ type: 'join', name: 'Pedro', hostKey: HOST_KEY })
    expect(host.last('welcome')!.isHost).toBe(true)
  })
})

describe('chat do canal', () => {
  it('a mensagem vai só para quem está no mesmo canal, com nome e horário', async () => {
    const r = await room()
    const host = r.open()
    await host.say({ type: 'join', name: 'Pedro', hostKey: HOST_KEY })
    const bia = r.open()
    await bia.say({ type: 'join', name: 'Bia' })
    const joao = r.open()
    await joao.say({ type: 'join', name: 'João' })
    await host.say({ type: 'channel-create', name: 'AFK', limit: 0 })
    const afk = host.last('room-settings')!.settings.channels[1].id
    await joao.say({ type: 'channel-join', channelId: afk })

    await bia.say({ type: 'chat-send', text: '  bora jogar?  ' })
    const got = host.last('chat')!
    expect(got.channelId).toBe('geral')
    expect(got.message).toMatchObject({ name: 'Bia', text: 'bora jogar?', from: bia.last('welcome')!.peerId })
    expect(typeof got.message.at).toBe('number')
    expect(bia.last('chat')!.message.id).toBe(got.message.id)
    expect(joao.last('chat')).toBeUndefined()
  })

  it('quem entra ou troca de canal recebe o histórico daquele canal', async () => {
    const r = await room()
    const host = r.open()
    await host.say({ type: 'join', name: 'Pedro', hostKey: HOST_KEY })
    expect(host.last('chat-history')).toEqual({ type: 'chat-history', channelId: 'geral', messages: [] })
    await host.say({ type: 'chat-send', text: 'oi' })
    await host.say({ type: 'channel-create', name: 'Jogo', limit: 0 })
    const jogo = host.last('room-settings')!.settings.channels[1].id

    const bia = r.open()
    await bia.say({ type: 'join', name: 'Bia' })
    expect(bia.last('chat-history')!.messages.map((m) => m.text)).toEqual(['oi'])
    await bia.say({ type: 'channel-join', channelId: jogo })
    expect(bia.last('chat-history')).toEqual({ type: 'chat-history', channelId: jogo, messages: [] })
  })

  it('guarda só as últimas 50, apaga junto com o canal e segura flood', async () => {
    let t = 0
    const saved: Record<string, unknown> = {}
    const base = await room()
    const r = new FakeRoom(base.config)
    r.core = new RoomCore({
      conns: () => r.conns.map((c) => c.view()),
      config: () => r.config,
      saveConfig: (c) => {
        r.config = c
      },
      hash: sha,
      newId: (() => {
        let n = 0
        return () => `id${++n}`
      })(),
      iceServers: async () => [],
      now: () => t,
      saveChat: (ch, msgs) => {
        if (msgs) saved[ch] = msgs
        else delete saved[ch]
      }
    })
    const host = r.open()
    await host.say({ type: 'join', name: 'Pedro', hostKey: HOST_KEY })
    for (let i = 0; i < 60; i++) {
      t += 2000 // devagar, sem cair no limite
      await host.say({ type: 'chat-send', text: `m${i}` })
    }
    const kept = saved.geral as { text: string }[]
    expect(kept).toHaveLength(50)
    expect(kept[0].text).toBe('m10')

    // flood: 8 em 10 s passa, a 9ª é barrada
    await host.say({ type: 'channel-create', name: 'Spam', limit: 0 })
    const spam = host.last('room-settings')!.settings.channels[1].id
    await host.say({ type: 'channel-join', channelId: spam })
    t += 20_000 // as mensagens anteriores saem da janela
    for (let i = 0; i < 9; i++) await host.say({ type: 'chat-send', text: `s${i}` })
    expect(host.last('error')!.code).toBe('chat-flood')
    expect((saved[spam] as unknown[]).length).toBe(8)

    await host.say({ type: 'channel-delete', channelId: spam })
    expect(saved[spam]).toBeUndefined()
  })

  it('recupera o histórico gravado (Durable Object acordou de novo)', async () => {
    const config = { hostKeyHash: await sha(HOST_KEY), requireApproval: false }
    const r = new FakeRoom(config)
    r.core = new RoomCore({
      conns: () => r.conns.map((c) => c.view()),
      config: () => r.config,
      hash: sha,
      newId: () => 'x',
      iceServers: async () => [],
      loadChat: () => ({ geral: [{ id: 'a', from: 'p', name: 'Ana', text: 'cheguei', at: 1 }] })
    })
    const c = r.open()
    await c.say({ type: 'join', name: 'Bia' })
    expect(c.last('chat-history')!.messages.map((m) => m.text)).toEqual(['cheguei'])
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
