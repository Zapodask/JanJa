import { DurableObject } from 'cloudflare:workers'
import {
  CreateRoomRequestSchema,
  MAX_MESSAGE_BYTES,
  ROOM_ID_RE,
  type CreateRoomResponse,
  type IceServer,
  type ServerMessage
} from '../shared/protocol'
import { RoomCore, type Conn, type ConnData, type RoomConfig } from './core'

export interface Env {
  ROOMS: DurableObjectNamespace<Room>
  ASSETS: Fetcher
  /** opcionais: TURN da Cloudflare (Realtime). Sem eles, só STUN. */
  TURN_KEY_ID?: string
  TURN_KEY_API_TOKEN?: string
}

const STUN: IceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }]
/** sala vazia (ou criada e nunca usada) some depois disso */
const EMPTY_ROOM_TTL_MS = 6 * 60 * 60 * 1000
const RATE = { windowMs: 10_000, max: 400 }

function randomId(bytes: number): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes))
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function turnServers(env: Env): Promise<IceServer[]> {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return STUN
  try {
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ttl: 86_400 })
      }
    )
    if (!res.ok) throw new Error(`TURN ${res.status}`)
    const { iceServers } = (await res.json()) as { iceServers: IceServer[] }
    // a porta 53 é bloqueada pelos navegadores e só gera timeout
    return iceServers.map((s) => ({
      ...s,
      urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u))
    }))
  } catch (err) {
    console.warn('[turn] sem credenciais, seguindo só com STUN', err)
    return STUN
  }
}

/** Uma instância por sala. Usa a Hibernation API: sala parada não gasta duração. */
export class Room extends DurableObject<Env> {
  private config?: RoomConfig
  private readonly core: RoomCore
  private readonly rate = new WeakMap<WebSocket, { start: number; count: number }>()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      this.config = await ctx.storage.get<RoomConfig>('config')
    })
    this.core = new RoomCore({
      conns: () => ctx.getWebSockets().map((ws) => this.conn(ws)),
      config: () => this.config,
      hash: sha256,
      newId: () => randomId(9),
      iceServers: () => turnServers(env)
    })
  }

  private conn(ws: WebSocket): Conn {
    return {
      send: (msg: ServerMessage) => {
        try {
          ws.send(JSON.stringify(msg))
        } catch {
          /* já fechou */
        }
      },
      close: (code, reason) => {
        try {
          ws.close(code, reason)
        } catch {
          /* já fechou */
        }
      },
      data: () => (ws.deserializeAttachment() as ConnData | null) ?? {},
      setData: (data: ConnData) => {
        try {
          ws.serializeAttachment(data)
        } catch {
          /* socket fechado: o estado morre com ele */
        }
      }
    }
  }

  async init(config: RoomConfig): Promise<void> {
    this.config = config
    await this.ctx.storage.put('config', config)
    await this.ctx.storage.setAlarm(Date.now() + EMPTY_ROOM_TTL_MS)
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Esperava WebSocket', { status: 426 })
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({})
    if (!this.config) {
      server.send(JSON.stringify({ type: 'error', code: 'room-not-found', message: 'Essa sala não existe ou já expirou.' }))
      server.close(4000, 'room-not-found')
    }
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const conn = this.conn(ws)
    if (typeof message !== 'string' || message.length > MAX_MESSAGE_BYTES) {
      return conn.send({ type: 'error', code: 'bad-message', message: 'Mensagem inválida.' })
    }
    const now = Date.now()
    const r = this.rate.get(ws) ?? { start: now, count: 0 }
    if (now - r.start > RATE.windowMs) Object.assign(r, { start: now, count: 0 })
    r.count += 1
    this.rate.set(ws, r)
    if (r.count > RATE.max) {
      conn.send({ type: 'error', code: 'rate-limited', message: 'Mensagens demais.' })
      return conn.close(4000, 'rate-limited')
    }
    await this.core.onMessage(conn, message)
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const left = this.core.onClose(this.conn(ws))
    if (left === 0) await this.ctx.storage.setAlarm(Date.now() + EMPTY_ROOM_TTL_MS)
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws)
  }

  async alarm(): Promise<void> {
    const active = this.ctx.getWebSockets().some((ws) => !!(ws.deserializeAttachment() as ConnData | null)?.peerId)
    if (active) {
      await this.ctx.storage.setAlarm(Date.now() + EMPTY_ROOM_TTL_MS)
      return
    }
    this.config = undefined
    await this.ctx.storage.deleteAll()
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      let body: unknown
      try {
        body = await request.json()
      } catch {
        body = {}
      }
      const parsed = CreateRoomRequestSchema.safeParse(body)
      if (!parsed.success) return json({ error: 'Pedido inválido.' }, 400)
      const roomId = randomId(16)
      const hostKey = randomId(24)
      await env.ROOMS.getByName(roomId).init({
        hostKeyHash: await sha256(hostKey),
        requireApproval: parsed.data.requireApproval
      })
      return json({ roomId, hostKey } satisfies CreateRoomResponse, 201)
    }

    const ws = /^\/ws\/([^/]+)$/.exec(url.pathname)
    if (ws) {
      if (!ROOM_ID_RE.test(ws[1])) return new Response('Sala inválida', { status: 404 })
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Esperava WebSocket', { status: 426 })
      return env.ROOMS.getByName(ws[1]).fetch(request)
    }

    if (url.pathname.startsWith('/api/')) return json({ error: 'Não encontrado.' }, 404)
    return env.ASSETS.fetch(request)
  }
} satisfies ExportedHandler<Env>
