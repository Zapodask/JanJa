import { randomUUID } from 'node:crypto'
import { buildRoomCode, IceServerSchema } from '@shared/protocol'
import type { CreateRoomOptions, RoomInfo } from '../preload/api'
import { localAddresses } from './net'
import { newToken, SignalingServer } from './signaling/server'
import { ensureCloudflared, startQuickTunnel, type QuickTunnel } from './tunnel/cloudflared'

const DEFAULT_ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }]
const DEFAULT_LAN_PORT = 47800
const APPROVAL_TIMEOUT_MS = 60_000

export interface RoomHooks {
  binDir: string
  downloadUrl?: string
  status: (msg: string) => void
  askApproval: (requestId: string, name: string) => void
}

/** Uma sala por vez: servidor de sinalização + (opcional) túnel. */
export class RoomManager {
  private server?: SignalingServer
  private tunnel?: QuickTunnel
  private readonly pending = new Map<string, (ok: boolean) => void>()

  constructor(private readonly hooks: RoomHooks) {}

  get isOpen(): boolean {
    return !!this.server
  }

  async create(opts: CreateRoomOptions): Promise<RoomInfo> {
    await this.close()
    const iceServers = [
      ...DEFAULT_ICE,
      ...opts.iceServers.filter((s) => IceServerSchema.safeParse(s).success)
    ]
    const token = newToken()
    const hostToken = newToken()
    const lan = opts.mode === 'lan'

    const server = new SignalingServer({
      host: lan ? '0.0.0.0' : '127.0.0.1',
      port: lan ? (opts.lanPort ?? DEFAULT_LAN_PORT) : 0,
      token,
      hostToken,
      iceServers,
      downloadUrl: this.hooks.downloadUrl,
      onJoinRequest: opts.requireApproval ? (name) => this.requestApproval(name) : undefined
    })

    this.hooks.status('Iniciando o servidor da sala...')
    const port = await server.start()
    this.server = server
    const hostCode = buildRoomCode(`ws://127.0.0.1:${port}/`, hostToken)

    try {
      if (lan) {
        const codes = localAddresses().map((a) => ({
          label: `${a.kind === 'tailscale' ? 'Tailscale' : 'Rede local'} (${a.iface})`,
          code: buildRoomCode(`http://${a.address}:${port}/`, token)
        }))
        this.hooks.status('Sala aberta na rede local.')
        return { mode: 'lan', codes, hostCode }
      }

      const exe = await ensureCloudflared(this.hooks.binDir, this.hooks.status)
      this.hooks.status('Abrindo o túnel da Cloudflare...')
      this.tunnel = await startQuickTunnel(exe, port)
      this.hooks.status('Sala aberta.')
      // link https: no navegador abre uma página explicando; no JanJa vira wss://
      return { mode: 'tunnel', codes: [{ label: 'Link da sala', code: buildRoomCode(`${this.tunnel.url}/`, token) }], hostCode }
    } catch (err) {
      await this.close()
      throw err
    }
  }

  async close(): Promise<void> {
    for (const resolve of this.pending.values()) resolve(false)
    this.pending.clear()
    this.tunnel?.stop()
    this.tunnel = undefined
    const server = this.server
    this.server = undefined
    await server?.stop()
  }

  respond(requestId: string, approved: boolean): void {
    this.pending.get(requestId)?.(approved)
  }

  private requestApproval(name: string): Promise<boolean> {
    return new Promise((resolve) => {
      const requestId = randomUUID()
      const timer = setTimeout(() => finish(false), APPROVAL_TIMEOUT_MS)
      const finish = (ok: boolean): void => {
        clearTimeout(timer)
        this.pending.delete(requestId)
        resolve(ok)
      }
      this.pending.set(requestId, finish)
      this.hooks.askApproval(requestId, name)
    })
  }
}
