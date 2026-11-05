import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocketServer, WebSocket, type RawData } from 'ws'
import {
  ClientMessageSchema,
  INITIAL_STATE,
  MAX_MESSAGE_BYTES,
  MAX_PEERS,
  type ErrorCode,
  type IceServer,
  type PeerInfo,
  type PeerState,
  type ServerMessage
} from '@shared/protocol'

export interface SignalingOptions {
  /** 127.0.0.1 no modo túnel; 0.0.0.0 no modo LAN/Tailscale */
  host: string
  /** 0 = porta livre qualquer */
  port: number
  token: string
  iceServers: IceServer[]
  maxPeers?: number
  /** Quando definido, cada entrada precisa ser aprovada pelo host (o próprio host entra com `hostToken`). */
  onJoinRequest?: (name: string) => Promise<boolean>
  /** Token extra só do host, para ele não precisar se aprovar. */
  hostToken?: string
  joinTimeoutMs?: number
  rateLimit?: { windowMs: number; max: number }
  /** link de download mostrado na página do convite */
  downloadUrl?: string
}

interface Peer {
  id: string
  name: string
  state: PeerState
  socket: WebSocket
}

interface ConnState {
  peerId?: string
  joining: boolean
  windowStart: number
  count: number
  joinTimer?: NodeJS.Timeout
}

/**
 * Quem abre o link da sala no navegador cai aqui (o WebSocket usa o mesmo endereço).
 * O botão abre o JanJa já entrando na sala, pelo esquema janja:// que o instalador registra.
 */
function landingHtml(downloadUrl?: string): string {
  const download = downloadUrl
    ? `<p class="m">Ainda não tem o JanJa? <a href="${downloadUrl}">Baixe o instalador para Windows</a>, instale e volte aqui.</p>`
    : ''
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Sala do JanJa</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,sans-serif;background:#14141a;color:#ececf1;display:grid;place-items:center;min-height:100vh;margin:0}
main{max-width:520px;padding:24px}h1{color:#7c6cff;margin:0 0 8px}a{color:#a99cff}.m{color:#9a9aa8}
code{display:block;word-break:break-all;background:#1d1d25;border:1px solid #34343f;border-radius:8px;padding:10px;margin:12px 0;font-size:12px}
.b{display:inline-block;background:#7c6cff;color:#fff;border:0;border-radius:8px;padding:12px 18px;font:inherit;font-weight:600;cursor:pointer;text-decoration:none;margin-right:8px}
.s{background:#262630;border:1px solid #34343f;font-weight:400}</style></head>
<body><main><h1>Você foi convidado para uma sala do JanJa</h1>
<p><a id="o" class="b" href="#">Abrir no JanJa</a></p>
${download}
<p class="m">Se o botão não abrir o app: abra o JanJa, vá em <b>Entrar numa sala</b> e cole o link abaixo.</p>
<code id="l"></code><button id="c" class="b s">Copiar link</button></main>
<script>var h=location.href;document.getElementById('l').textContent=h;
document.getElementById('o').href='janja://join?code='+encodeURIComponent(h);
document.getElementById('c').onclick=function(){navigator.clipboard.writeText(h);this.textContent='Copiado!'}</script>
</body></html>`
}

export function newToken(bytes = 16): string {
  return randomBytes(bytes).toString('base64url')
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

export class SignalingServer {
  private wss?: WebSocketServer
  private http?: Server
  private readonly peers = new Map<string, Peer>()
  private readonly opts: Required<Omit<SignalingOptions, 'onJoinRequest' | 'hostToken' | 'downloadUrl'>> &
    Pick<SignalingOptions, 'onJoinRequest' | 'hostToken' | 'downloadUrl'>

  constructor(options: SignalingOptions) {
    this.opts = {
      maxPeers: MAX_PEERS,
      joinTimeoutMs: 10_000,
      rateLimit: { windowMs: 10_000, max: 400 },
      ...options
    }
  }

  get peerCount(): number {
    return this.peers.size
  }

  listPeers(): PeerInfo[] {
    return [...this.peers.values()].map((p) => ({ peerId: p.id, name: p.name, state: p.state }))
  }

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      const http = createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end(landingHtml(this.opts.downloadUrl))
      })
      const wss = new WebSocketServer({ server: http, maxPayload: MAX_MESSAGE_BYTES })
      this.http = http
      this.wss = wss
      wss.on('error', (err) => console.error('[signaling]', err))
      wss.on('connection', (socket) => this.onConnection(socket))
      http.once('error', reject)
      http.listen(this.opts.port, this.opts.host, () => {
        http.off('error', reject)
        resolve((http.address() as AddressInfo).port)
      })
    })
  }

  async stop(): Promise<void> {
    const wss = this.wss
    const http = this.http
    if (!wss || !http) return
    this.wss = undefined
    this.http = undefined
    for (const client of wss.clients) client.close(1001, 'room closed')
    this.peers.clear()
    await new Promise<void>((resolve) => wss.close(() => resolve()))
    http.closeAllConnections()
    await new Promise<void>((resolve) => http.close(() => resolve()))
  }

  private send(socket: WebSocket, msg: ServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg))
  }

  private fail(socket: WebSocket, code: ErrorCode, message: string, close = false): void {
    this.send(socket, { type: 'error', code, message })
    if (close) socket.close(4000, code)
  }

  private broadcast(msg: ServerMessage, exceptId?: string): void {
    for (const peer of this.peers.values()) if (peer.id !== exceptId) this.send(peer.socket, msg)
  }

  private onConnection(socket: WebSocket): void {
    const conn: ConnState = { joining: false, windowStart: Date.now(), count: 0 }
    conn.joinTimer = setTimeout(() => {
      if (!conn.peerId && !conn.joining) this.fail(socket, 'join-timeout', 'Tempo para entrar esgotado.', true)
    }, this.opts.joinTimeoutMs)

    socket.on('message', (data, isBinary) => {
      if (isBinary) return this.fail(socket, 'bad-message', 'Mensagens binárias não são aceitas.')
      if (!this.allow(conn)) return this.fail(socket, 'rate-limited', 'Mensagens demais.', true)
      void this.onMessage(socket, conn, data)
    })
    socket.on('close', () => {
      clearTimeout(conn.joinTimer)
      if (conn.peerId && this.peers.get(conn.peerId)?.socket === socket) {
        this.peers.delete(conn.peerId)
        this.broadcast({ type: 'peer-left', peerId: conn.peerId })
      }
    })
    socket.on('error', () => socket.terminate())
  }

  private allow(conn: ConnState): boolean {
    const now = Date.now()
    if (now - conn.windowStart > this.opts.rateLimit.windowMs) {
      conn.windowStart = now
      conn.count = 0
    }
    conn.count += 1
    return conn.count <= this.opts.rateLimit.max
  }

  private async onMessage(socket: WebSocket, conn: ConnState, data: RawData): Promise<void> {
    let raw: unknown
    try {
      raw = JSON.parse(data.toString())
    } catch {
      return this.fail(socket, 'bad-message', 'JSON inválido.')
    }
    const parsed = ClientMessageSchema.safeParse(raw)
    if (!parsed.success) return this.fail(socket, 'bad-message', 'Mensagem fora do protocolo.')
    const msg = parsed.data

    if (msg.type === 'ping') return this.send(socket, { type: 'pong' })

    if (msg.type === 'join') {
      if (conn.peerId || conn.joining) return
      const isHost = !!this.opts.hostToken && safeEqual(msg.token, this.opts.hostToken)
      if (!isHost && !safeEqual(msg.token, this.opts.token)) {
        return this.fail(socket, 'bad-token', 'Token de sala inválido.', true)
      }
      if (this.peers.size >= this.opts.maxPeers) {
        return this.fail(socket, 'room-full', `A sala está cheia (máx. ${this.opts.maxPeers}).`, true)
      }
      if (!isHost && this.opts.onJoinRequest) {
        conn.joining = true
        clearTimeout(conn.joinTimer)
        this.send(socket, { type: 'waiting-approval' })
        let approved = false
        try {
          approved = await this.opts.onJoinRequest(msg.name)
        } catch {
          approved = false
        }
        conn.joining = false
        if (socket.readyState !== WebSocket.OPEN) return
        if (!approved) return this.fail(socket, 'denied', 'O host recusou a entrada.', true)
        if (this.peers.size >= this.opts.maxPeers) {
          return this.fail(socket, 'room-full', `A sala está cheia (máx. ${this.opts.maxPeers}).`, true)
        }
      }
      clearTimeout(conn.joinTimer)
      const peer: Peer = { id: newToken(8), name: msg.name, state: { ...INITIAL_STATE }, socket }
      const existing = this.listPeers()
      this.peers.set(peer.id, peer)
      conn.peerId = peer.id
      this.send(socket, { type: 'welcome', peerId: peer.id, peers: existing, iceServers: this.opts.iceServers })
      this.broadcast(
        { type: 'peer-joined', peer: { peerId: peer.id, name: peer.name, state: peer.state } },
        peer.id
      )
      return
    }

    const me = conn.peerId ? this.peers.get(conn.peerId) : undefined
    if (!me) return this.fail(socket, 'not-joined', 'Entre na sala antes.')

    if (msg.type === 'signal') {
      const target = this.peers.get(msg.to)
      if (!target) return this.fail(socket, 'unknown-peer', 'Peer não encontrado.')
      return this.send(target.socket, { type: 'signal', from: me.id, payload: msg.payload })
    }

    if (msg.type === 'state') {
      me.state = msg.state
      this.broadcast({ type: 'state', from: me.id, state: msg.state }, me.id)
    }
  }
}
