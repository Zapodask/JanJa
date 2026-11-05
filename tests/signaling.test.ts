import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { buildRoomCode, parseRoomCode, type ServerMessage } from '@shared/protocol'
import { SignalingServer, type SignalingOptions } from '../src/main/signaling/server'

const TOKEN = 'token-da-sala'
const HOST_TOKEN = 'token-do-host'

let server: SignalingServer | undefined
const sockets: WebSocket[] = []

afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate()
  await server?.stop()
  server = undefined
})

async function start(extra: Partial<SignalingOptions> = {}): Promise<number> {
  server = new SignalingServer({ host: '127.0.0.1', port: 0, token: TOKEN, hostToken: HOST_TOKEN, iceServers: [], ...extra })
  return server.start()
}

class Client {
  readonly inbox: ServerMessage[] = []
  private waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = []
  closed?: { code: number; reason: string }

  constructor(readonly ws: WebSocket) {
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as ServerMessage
      const i = this.waiters.findIndex((w) => w.pred(msg))
      if (i >= 0) this.waiters.splice(i, 1)[0].resolve(msg)
      else this.inbox.push(msg)
    })
    ws.on('close', (code, reason) => (this.closed = { code, reason: reason.toString() }))
  }

  static async open(port: number): Promise<Client> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    sockets.push(ws)
    await new Promise((resolve, reject) => {
      ws.once('open', resolve)
      ws.once('error', reject)
    })
    return new Client(ws)
  }

  send(msg: unknown): void {
    this.ws.send(JSON.stringify(msg))
  }

  next<T extends ServerMessage['type']>(type: T, timeout = 2000): Promise<Extract<ServerMessage, { type: T }>> {
    const idx = this.inbox.findIndex((m) => m.type === type)
    if (idx >= 0) return Promise.resolve(this.inbox.splice(idx, 1)[0] as Extract<ServerMessage, { type: T }>)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout esperando ${type}`)), timeout)
      this.waiters.push({
        pred: (m) => m.type === type,
        resolve: (m) => {
          clearTimeout(timer)
          resolve(m as Extract<ServerMessage, { type: T }>)
        }
      })
    })
  }

  async join(name: string, token = TOKEN) {
    this.send({ type: 'join', token, name })
    return this.next('welcome')
  }
}

describe('SignalingServer', () => {
  it('apresenta os peers e avisa os outros quando alguém entra e sai', async () => {
    const port = await start()
    const a = await Client.open(port)
    const wa = await a.join('Ana')
    expect(wa.peers).toEqual([])

    const b = await Client.open(port)
    const wb = await b.join('Bia')
    expect(wb.peers.map((p) => p.name)).toEqual(['Ana'])

    const joined = await a.next('peer-joined')
    expect(joined.peer).toMatchObject({ peerId: wb.peerId, name: 'Bia' })

    b.ws.close()
    const left = await a.next('peer-left')
    expect(left.peerId).toBe(wb.peerId)
  })

  it('repassa signal só para o destinatário, com o remetente', async () => {
    const port = await start()
    const a = await Client.open(port)
    const wa = await a.join('Ana')
    const b = await Client.open(port)
    const wb = await b.join('Bia')
    const c = await Client.open(port)
    await c.join('Caio')

    const payload = { description: { type: 'offer', sdp: 'v=0' } }
    b.send({ type: 'signal', to: wa.peerId, payload })
    const got = await a.next('signal')
    expect(got).toEqual({ type: 'signal', from: wb.peerId, payload })
    await new Promise((r) => setTimeout(r, 50))
    expect(c.inbox.some((m) => m.type === 'signal')).toBe(false)
  })

  it('propaga o estado de compartilhamento para os outros', async () => {
    const port = await start()
    const a = await Client.open(port)
    await a.join('Ana')
    const b = await Client.open(port)
    const wb = await b.join('Bia')
    b.send({ type: 'state', state: { sharing: true, micMuted: true, screenStreamId: 'abc' } })
    const st = await a.next('state')
    expect(st).toEqual({ type: 'state', from: wb.peerId, state: { sharing: true, micMuted: true, screenStreamId: 'abc' } })

    const c = await Client.open(port)
    const wc = await c.join('Caio')
    expect(wc.peers.find((p) => p.peerId === wb.peerId)?.state.sharing).toBe(true)
  })

  it('recusa token errado e fecha a conexão', async () => {
    const port = await start()
    const a = await Client.open(port)
    a.send({ type: 'join', token: 'errado', name: 'Intruso' })
    const err = await a.next('error')
    expect(err.code).toBe('bad-token')
  })

  it('recusa quando a sala está cheia', async () => {
    const port = await start({ maxPeers: 2 })
    await (await Client.open(port)).join('A')
    await (await Client.open(port)).join('B')
    const c = await Client.open(port)
    c.send({ type: 'join', token: TOKEN, name: 'C' })
    expect((await c.next('error')).code).toBe('room-full')
  })

  it('ignora mensagens fora do protocolo e exige join antes de sinalizar', async () => {
    const port = await start()
    const a = await Client.open(port)
    a.ws.send('isso não é json')
    expect((await a.next('error')).code).toBe('bad-message')
    a.send({ type: 'signal', to: 'x', payload: {} })
    expect((await a.next('error')).code).toBe('not-joined')
  })

  it('com aprovação: aguarda o host, aceita ou recusa; o host entra direto', async () => {
    const decisions: string[] = []
    const port = await start({
      onJoinRequest: async (name) => {
        decisions.push(name)
        return name !== 'Intruso'
      }
    })
    const host = await Client.open(port)
    await host.join('Host', HOST_TOKEN)
    expect(decisions).toEqual([])

    const ok = await Client.open(port)
    ok.send({ type: 'join', token: TOKEN, name: 'Amigo' })
    await ok.next('waiting-approval')
    await ok.next('welcome')

    const no = await Client.open(port)
    no.send({ type: 'join', token: TOKEN, name: 'Intruso' })
    await no.next('waiting-approval')
    expect((await no.next('error')).code).toBe('denied')
    expect(decisions).toEqual(['Amigo', 'Intruso'])
  })

  it('derruba quem não entra a tempo e quem manda mensagens demais', async () => {
    const port = await start({ joinTimeoutMs: 100, rateLimit: { windowMs: 10_000, max: 5 } })
    const slow = await Client.open(port)
    expect((await slow.next('error', 1000)).code).toBe('join-timeout')

    const spam = await Client.open(port)
    await spam.join('Spam')
    for (let i = 0; i < 10; i++) spam.send({ type: 'ping' })
    expect((await spam.next('error')).code).toBe('rate-limited')
  })
})

describe('página do link', () => {
  it('quem abre o link no navegador vê instruções, e o WebSocket segue no mesmo endereço', async () => {
    const port = await start()
    const res = await fetch(`http://127.0.0.1:${port}/`)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(await res.text()).toContain('Entrar numa sala')
    const a = await Client.open(port)
    expect((await a.join('Ana')).peers).toEqual([])
  })
})

describe('código da sala', () => {
  it('ida e volta com token no fragmento', () => {
    const code = buildRoomCode('wss://abc-def.trycloudflare.com/', 'XyZ_123')
    expect(code).toBe('wss://abc-def.trycloudflare.com/#t=XyZ_123')
    expect(parseRoomCode(code)).toEqual({ wsUrl: 'wss://abc-def.trycloudflare.com/', token: 'XyZ_123' })
  })

  it('aceita https colado por engano e rejeita sem token', () => {
    expect(parseRoomCode('https://a.trycloudflare.com/#t=k').wsUrl).toBe('wss://a.trycloudflare.com/')
    expect(() => parseRoomCode('wss://a.trycloudflare.com/')).toThrow()
    expect(() => parseRoomCode('não é url')).toThrow()
  })
})
