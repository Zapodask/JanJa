import { ServerMessageSchema, wsUrlFor, type ClientMessage, type ServerMessage } from '../shared/protocol'

type Welcome = Extract<ServerMessage, { type: 'welcome' }>
type Handler = (msg: ServerMessage) => void

const PING_EVERY_MS = 25_000

export interface JoinOptions {
  roomId: string
  name: string
  hostKey?: string
  /** padrão: a origem da página */
  origin?: string
}

/** Cliente WebSocket da sinalização. Resolve `connect()` no `welcome`. */
export class SignalingClient {
  private ws?: WebSocket
  private readonly handlers = new Set<Handler>()
  private readonly closeHandlers = new Set<(reason: string) => void>()
  /** mensagens que chegam entre o welcome e o primeiro `on()` ficam guardadas, não se perdem */
  private backlog: ServerMessage[] = []
  private pinger?: number
  private closedByUs = false

  constructor(private readonly opts: JoinOptions) {}

  connect(onWaiting?: () => void): Promise<Welcome> {
    const { roomId, name, hostKey } = this.opts
    const url = wsUrlFor(this.opts.origin ?? location.origin, roomId)
    return new Promise((resolve, reject) => {
      let welcomed = false
      let lastError: string | undefined
      const ws = new WebSocket(url)
      this.ws = ws

      ws.onopen = () => {
        this.send({ type: 'join', name, hostKey })
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
          if (msg.type === 'error') {
            lastError = msg.message
            return
          }
        }
        if (this.handlers.size === 0) this.backlog.push(msg)
        else for (const h of this.handlers) h(msg)
      }

      ws.onclose = (ev) => {
        window.clearInterval(this.pinger)
        if (!welcomed) {
          reject(new Error(lastError ?? 'Não foi possível conectar à sala. Confira a internet e tente de novo.'))
          return
        }
        if (!this.closedByUs) for (const h of this.closeHandlers) h(lastError ?? ev.reason ?? 'A conexão com a sala caiu.')
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
