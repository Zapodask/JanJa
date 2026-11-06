import {
  ClientMessageSchema,
  INITIAL_STATE,
  MAX_PEERS,
  type ClientMessage,
  type ErrorCode,
  type IceServer,
  type PeerInfo,
  type PeerState,
  type ServerMessage
} from '../shared/protocol'

/**
 * Regras da sala, sem nada da Cloudflare: o Durable Object só adapta WebSockets para `Conn`.
 * Assim dá para testar tudo no Node com conexões falsas.
 */

export interface ConnData {
  peerId?: string
  name?: string
  isHost?: boolean
  state?: PeerState
  /** pedido de entrada aguardando o host */
  pending?: { requestId: string; name: string }
}

export interface Conn {
  send(msg: ServerMessage): void
  close(code: number, reason: string): void
  data(): ConnData
  setData(data: ConnData): void
}

export interface RoomConfig {
  hostKeyHash: string
  requireApproval: boolean
}

export interface RoomDeps {
  conns(): Conn[]
  config(): RoomConfig | undefined
  hash(text: string): Promise<string>
  newId(): string
  iceServers(): Promise<IceServer[]>
  maxPeers?: number
}

const joined = (c: Conn): boolean => !!c.data().peerId

/**
 * No Durable Object cada `conns()` cria objetos novos para os mesmos sockets,
 * então "é a mesma conexão" é comparado pelo peerId, nunca por identidade.
 */
const same = (a: Conn, b: Conn | undefined): boolean => {
  if (!b) return false
  if (a === b) return true
  const id = a.data().peerId
  return !!id && id === b.data().peerId
}

function info(c: Conn): PeerInfo {
  const d = c.data()
  return { peerId: d.peerId!, name: d.name!, state: d.state ?? INITIAL_STATE, isHost: !!d.isHost }
}

export class RoomCore {
  constructor(private readonly deps: RoomDeps) {}

  private get maxPeers(): number {
    return this.deps.maxPeers ?? MAX_PEERS
  }

  private peers(): Conn[] {
    return this.deps.conns().filter(joined)
  }

  private fail(conn: Conn, code: ErrorCode, message: string, close = false): void {
    conn.send({ type: 'error', code, message })
    if (close) conn.close(4000, code)
  }

  private broadcast(msg: ServerMessage, except?: Conn): void {
    for (const c of this.peers()) if (!same(c, except)) c.send(msg)
  }

  async onMessage(conn: Conn, raw: string): Promise<void> {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return this.fail(conn, 'bad-message', 'JSON inválido.')
    }
    const result = ClientMessageSchema.safeParse(parsed)
    if (!result.success) return this.fail(conn, 'bad-message', 'Mensagem fora do protocolo.')
    const msg = result.data

    if (msg.type === 'ping') return conn.send({ type: 'pong' })
    if (msg.type === 'join') return this.join(conn, msg)

    const me = conn.data()
    if (!me.peerId) return this.fail(conn, 'not-joined', 'Entre na sala antes.')

    if (msg.type === 'signal') {
      const target = this.peers().find((c) => c.data().peerId === msg.to)
      if (!target) return this.fail(conn, 'unknown-peer', 'Participante não encontrado.')
      return target.send({ type: 'signal', from: me.peerId, payload: msg.payload })
    }

    if (msg.type === 'state') {
      conn.setData({ ...me, state: msg.state })
      return this.broadcast({ type: 'state', from: me.peerId, state: msg.state }, conn)
    }

    if (msg.type === 'join-response') {
      if (!me.isHost) return
      const guest = this.deps.conns().find((c) => c.data().pending?.requestId === msg.requestId)
      if (!guest) return
      const { name } = guest.data().pending!
      guest.setData({ ...guest.data(), pending: undefined })
      if (!msg.approved) return this.fail(guest, 'denied', 'O host recusou a entrada.', true)
      return this.admit(guest, name, false)
    }
  }

  private async join(conn: Conn, msg: Extract<ClientMessage, { type: 'join' }>): Promise<void> {
    const d = conn.data()
    if (d.peerId || d.pending) return
    const config = this.deps.config()
    if (!config) return this.fail(conn, 'room-not-found', 'Essa sala não existe ou já expirou.', true)

    const isHost = !!msg.hostKey && (await this.deps.hash(msg.hostKey)) === config.hostKeyHash
    if (this.peers().length >= this.maxPeers) {
      return this.fail(conn, 'room-full', `A sala está cheia (máx. ${this.maxPeers}).`, true)
    }

    if (config.requireApproval && !isHost) {
      const host = this.peers().find((c) => c.data().isHost)
      if (!host) return this.fail(conn, 'host-absent', 'Quem criou a sala não está nela agora.', true)
      const requestId = this.deps.newId()
      conn.setData({ ...d, pending: { requestId, name: msg.name } })
      conn.send({ type: 'waiting-approval' })
      host.send({ type: 'join-request', requestId, name: msg.name })
      return
    }

    return this.admit(conn, msg.name, isHost)
  }

  private async admit(conn: Conn, name: string, isHost: boolean): Promise<void> {
    if (this.peers().length >= this.maxPeers) {
      return this.fail(conn, 'room-full', `A sala está cheia (máx. ${this.maxPeers}).`, true)
    }
    const existing = this.peers().map(info)
    conn.setData({ peerId: this.deps.newId(), name, isHost, state: { ...INITIAL_STATE } })
    const iceServers = await this.deps.iceServers()
    conn.send({ type: 'welcome', peerId: conn.data().peerId!, isHost, peers: existing, iceServers })
    this.broadcast({ type: 'peer-joined', peer: info(conn) }, conn)
  }

  /** Chamado quando a conexão fecha. Retorna quantos participantes ainda estão na sala. */
  onClose(conn: Conn): number {
    const d = conn.data()
    if (d.pending) {
      const host = this.peers().find((c) => c.data().isHost)
      host?.send({ type: 'join-request-cancelled', requestId: d.pending.requestId })
    }
    if (d.peerId) {
      conn.setData({})
      this.broadcast({ type: 'peer-left', peerId: d.peerId }, conn)
      if (d.isHost) {
        // sem host, ninguém aprova: avisa quem estava esperando
        for (const c of this.deps.conns()) {
          if (c.data().pending) this.fail(c, 'host-absent', 'Quem criou a sala saiu.', true)
        }
      }
    }
    return this.peers().length
  }
}
