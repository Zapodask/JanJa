import {
  parseRoomCode,
  ServerMessageSchema,
  type ClientMessage,
  type ServerMessage
} from '@shared/protocol'

type Welcome = Extract<ServerMessage, { type: 'welcome' }>
type Handler = (msg: ServerMessage) => void

const PING_EVERY_MS = 25_000

/** Cliente WebSocket da sinalização. Resolve `connect()` no `welcome`. */
export class SignalingClient {
  private ws?: WebSocket
  private readonly handlers = new Set<Handler>()
  /** mensagens que chegam entre o welcome e o primeiro `on()` ficam guardadas, não se perdem */
  private backlog: ServerMessage[] = []
  private readonly closeHandlers = new Set<(reason: string) => void>()
  private pinger?: number
  private closedByUs = false

  constructor(
    private readonly code: string,
    private readonly name: string
  ) {}

  connect(onWaiting?: () => void): Promise<Welcome> {
    const { wsUrl, token } = parseRoomCode(this.code)
    return new Promise((resolve, reject) => {
      let welcomed = false
      const ws = new WebSocket(wsUrl)
      this.ws = ws

      ws.onopen = () => {
        this.send({ type: 'join', token, name: this.name })
        this.pinger = window.setInterval(() => this.send({ type: 'ping' }), PING_EVERY_MS)
      }

      ws.onmessage = (ev) => {
        let msg: ServerMessage
        try {
          const parsed = ServerMessageSchema.safeParse(JSON.parse(String(ev.data)))
          if (!parsed.success) return
          msg = parsed.data
        } catch {
          return
        }
        if (!welcomed) {
          if (msg.type === 'welcome') {
            welcomed = true
            resolve(msg)
            return
          }
          if (msg.type === 'waiting-approval') return onWaiting?.()
          if (msg.type === 'error') return reject(new Error(msg.message))
        }
        if (this.handlers.size === 0) this.backlog.push(msg)
        else for (const h of this.handlers) h(msg)
      }

      ws.onerror = () => {
        if (!welcomed) reject(new Error('Não foi possível conectar à sala. Confira o código e se o host está online.'))
      }

      ws.onclose = (ev) => {
        window.clearInterval(this.pinger)
        if (!welcomed) {
          reject(new Error(ev.reason ? `Conexão recusada (${ev.reason}).` : 'A conexão com a sala foi fechada.'))
          return
        }
        if (!this.closedByUs) for (const h of this.closeHandlers) h(ev.reason || 'A conexão com a sala caiu.')
      }
    })
  }

  on(handler: Handler): () => void {
    this.handlers.add(handler)
    const pending = this.backlog
    this.backlog = []
    for (const msg of pending) handler(msg)
    return () => this.handlers.delete(handler)
  }

  onClose(handler: (reason: string) => void): () => void {
    this.closeHandlers.add(handler)
    return () => this.closeHandlers.delete(handler)
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }

  close(): void {
    this.closedByUs = true
    window.clearInterval(this.pinger)
    this.ws?.close()
  }
}
