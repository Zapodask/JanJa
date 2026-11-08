import {
  CHAT_HISTORY,
  ClientMessageSchema,
  DEFAULT_CHANNELS,
  DEFAULT_ROOM_NAME,
  type ChatMessage,
  INITIAL_STATE,
  MAX_CHANNELS,
  MAX_PEERS,
  channelHasRoom,
  type Channel,
  type ClientMessage,
  type ErrorCode,
  type IceServer,
  type PeerInfo,
  type PeerState,
  type RoomSettings,
  type ServerMessage
} from '../shared/protocol'
import { cryptoRng, type Rng } from '../shared/games/types'
import type { GameRegistry } from '../shared/games/registry'
import { GameHost, isGameMessage, type GameSnapshot } from './game/host'

/**
 * Regras da sala, sem nada da Cloudflare: o Durable Object só adapta WebSockets para `Conn`.
 * Assim dá para testar tudo no Node com conexões falsas.
 */

export interface ConnData {
  peerId?: string
  name?: string
  isHost?: boolean
  /** identidade estável da pessoa nesta sala (recupera a cadeira do jogo) */
  clientId?: string
  state?: PeerState
  /** canal onde a pessoa está (a voz só liga quem está no mesmo canal) */
  channelId?: string
  /** horários das últimas mensagens de chat (contra flood) */
  chatTimes?: number[]
  /** pedido de entrada aguardando o host */
  pending?: { requestId: string; name: string; clientId?: string; channelId?: string }
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
  /** nome da sala; ausente = DEFAULT_ROOM_NAME (salas antigas) */
  name?: string
  /** canais criados pelo host, cada um com seu limite; ausente = só "Geral" */
  channels?: Channel[]
}

export interface RoomDeps {
  conns(): Conn[]
  config(): RoomConfig | undefined
  /** grava a configuração quando o host muda os canais */
  saveConfig?(config: RoomConfig): void
  /** chat: histórico gravado por canal (sem isso o chat vive só em memória) */
  loadChat?(): Record<string, ChatMessage[]> | undefined
  saveChat?(channelId: string, messages: ChatMessage[] | null): void
  hash(text: string): Promise<string>
  newId(): string
  iceServers(): Promise<IceServer[]>
  /** teto de pessoas na sala (padrão MAX_PEERS; os testes usam menor) */
  maxPeers?: number
  /** jogos: tudo opcional (sem eles o jogo vive só em memória) */
  now?(): number
  rng?(): Rng
  loadGame?(): GameSnapshot | undefined
  saveGame?(snapshot: GameSnapshot | null): void
  registry?: GameRegistry
}

const joined = (c: Conn): boolean => !!c.data().peerId

const CHAT_WINDOW_MS = 10_000
const CHAT_MAX_IN_WINDOW = 8

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

function info(c: Conn, fallbackChannel: string): PeerInfo {
  const d = c.data()
  return {
    peerId: d.peerId!,
    name: d.name!,
    state: d.state ?? INITIAL_STATE,
    isHost: !!d.isHost,
    channelId: d.channelId ?? fallbackChannel
  }
}

export class RoomCore {
  readonly game: GameHost

  constructor(private readonly deps: RoomDeps) {
    this.game = new GameHost({
      conns: () => this.peers(),
      now: () => (deps.now ?? Date.now)(),
      rng: () => (deps.rng ?? cryptoRng)(),
      newId: () => deps.newId(),
      load: () => deps.loadGame?.(),
      save: (s) => deps.saveGame?.(s),
      registry: deps.registry
    })
  }

  /** nome e canais atuais (sala antiga: nome padrão e só "Geral") */
  settings(): RoomSettings {
    const config = this.deps.config()
    return {
      name: config?.name ?? DEFAULT_ROOM_NAME,
      channels: config?.channels?.length ? config.channels : DEFAULT_CHANNELS
    }
  }

  /** teto de segurança da sala; quem limita de verdade é cada canal */
  private isFull(): boolean {
    return this.peers().length >= (this.deps.maxPeers ?? MAX_PEERS)
  }

  private fullMessage(): string {
    return 'A sala está cheia. Espere alguém sair ou peça um link de outra sala.'
  }

  /** quantas pessoas estão no canal agora */
  private countIn(channelId: string): number {
    return this.peers().filter((c) => this.info(c).channelId === channelId).length
  }

  private hasRoom(ch: Channel): boolean {
    return channelHasRoom(ch, this.countIn(ch.id))
  }

  private peers(): Conn[] {
    return this.deps.conns().filter(joined)
  }

  private info(c: Conn): PeerInfo {
    return info(c, this.settings().channels[0].id)
  }

  private updateConfig(patch: Partial<RoomConfig>): void {
    const config = this.deps.config()
    if (!config) return
    this.deps.saveConfig?.({ ...config, ...patch })
    this.broadcast({ type: 'room-settings', settings: this.settings() })
  }

  private moveTo(c: Conn, channelId: string): void {
    const d = c.data()
    if (!d.peerId || d.channelId === channelId) return
    c.setData({ ...d, channelId })
    this.broadcast({ type: 'peer-moved', peerId: d.peerId, channelId })
    this.sendHistory(c, channelId)
  }

  // ---------- chat ----------
  private chat?: Map<string, ChatMessage[]>

  private chatOf(channelId: string): ChatMessage[] {
    this.chat ??= new Map(Object.entries(this.deps.loadChat?.() ?? {}))
    return this.chat.get(channelId) ?? []
  }

  private setChat(channelId: string, messages: ChatMessage[] | null): void {
    this.chatOf(channelId) // garante o mapa carregado
    if (messages) this.chat!.set(channelId, messages)
    else this.chat!.delete(channelId)
    this.deps.saveChat?.(channelId, messages)
  }

  /** sala expirou: esquece o chat em memória (o storage já foi apagado) */
  resetChat(): void {
    this.chat = undefined
  }

  private sendHistory(c: Conn, channelId: string): void {
    c.send({ type: 'chat-history', channelId, messages: this.chatOf(channelId) })
  }

  private sendChat(conn: Conn, text: string): void {
    const me = conn.data()
    const now = (this.deps.now ?? Date.now)()
    // no máximo 8 mensagens a cada 10 s por pessoa
    const recent = (me.chatTimes ?? []).filter((t) => now - t < CHAT_WINDOW_MS)
    if (recent.length >= CHAT_MAX_IN_WINDOW) {
      return this.fail(conn, 'chat-flood', 'Muitas mensagens seguidas. Espere uns segundos.')
    }
    conn.setData({ ...me, chatTimes: [...recent, now] })
    const channelId = this.info(conn).channelId
    const message: ChatMessage = { id: this.deps.newId(), from: me.peerId!, name: me.name!, text, at: now }
    this.setChat(channelId, [...this.chatOf(channelId), message].slice(-CHAT_HISTORY))
    for (const c of this.peers()) if (this.info(c).channelId === channelId) c.send({ type: 'chat', channelId, message })
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

    if (isGameMessage(msg)) return this.game.handle(conn, msg)

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
      const { name, clientId, channelId } = guest.data().pending!
      guest.setData({ ...guest.data(), pending: undefined })
      if (!msg.approved) return this.fail(guest, 'denied', 'O host recusou a entrada.', true)
      return this.admit(guest, name, false, clientId, channelId)
    }

    if (msg.type === 'channel-join') {
      const target = this.settings().channels.find((ch) => ch.id === msg.channelId)
      if (!target) return this.fail(conn, 'unknown-channel', 'Esse canal não existe mais.')
      if (this.info(conn).channelId === target.id) return
      if (!this.hasRoom(target)) {
        return this.fail(conn, 'channel-full', `O canal ${target.name} está cheio (máx. ${target.limit}). Espere alguém sair.`)
      }
      return this.moveTo(conn, target.id)
    }

    if (msg.type === 'chat-send') return this.sendChat(conn, msg.text)

    // daqui para baixo, só quem criou a sala
    if (!me.isHost) return this.fail(conn, 'not-host', 'Só quem criou a sala pode mudar isso.')
    const { channels } = this.settings()

    if (msg.type === 'channel-create') {
      if (channels.length >= MAX_CHANNELS) {
        return this.fail(conn, 'channel-limit', `A sala já tem o máximo de ${MAX_CHANNELS} canais.`)
      }
      return this.updateConfig({ channels: [...channels, { id: this.deps.newId(), name: msg.name, limit: msg.limit }] })
    }

    if (msg.type === 'channel-edit') {
      if (!channels.some((ch) => ch.id === msg.channelId)) {
        return this.fail(conn, 'unknown-channel', 'Esse canal não existe mais.')
      }
      // baixar o limite não tira ninguém: só barra quem chegar depois
      return this.updateConfig({
        channels: channels.map((ch) => (ch.id === msg.channelId ? { ...ch, name: msg.name, limit: msg.limit } : ch))
      })
    }

    if (msg.type === 'channel-delete') {
      if (!channels.some((ch) => ch.id === msg.channelId)) {
        return this.fail(conn, 'unknown-channel', 'Esse canal não existe mais.')
      }
      if (channels.length <= 1) return this.fail(conn, 'channel-limit', 'A sala precisa de pelo menos um canal.')
      const rest = channels.filter((ch) => ch.id !== msg.channelId)
      // quem estava no canal apagado vai para o primeiro que sobrou
      for (const c of this.peers()) if (this.info(c).channelId === msg.channelId) this.moveTo(c, rest[0].id)
      this.setChat(msg.channelId, null)
      return this.updateConfig({ channels: rest })
    }

    if (msg.type === 'room-rename') return this.updateConfig({ name: msg.name })
  }

  private async join(conn: Conn, msg: Extract<ClientMessage, { type: 'join' }>): Promise<void> {
    const d = conn.data()
    if (d.peerId || d.pending) return
    const config = this.deps.config()
    if (!config) return this.fail(conn, 'room-not-found', 'Essa sala não existe ou já expirou.', true)

    const isHost = !!msg.hostKey && (await this.deps.hash(msg.hostKey)) === config.hostKeyHash
    // quem criou a sala sempre entra na própria sala, mesmo cheia
    if (!isHost && this.isFull()) return this.fail(conn, 'room-full', this.fullMessage(), true)

    if (config.requireApproval && !isHost) {
      const host = this.peers().find((c) => c.data().isHost)
      if (!host) return this.fail(conn, 'host-absent', 'Quem criou a sala não está nela agora.', true)
      const requestId = this.deps.newId()
      conn.setData({ ...d, pending: { requestId, name: msg.name, clientId: msg.clientId, channelId: msg.channelId } })
      conn.send({ type: 'waiting-approval' })
      host.send({ type: 'join-request', requestId, name: msg.name })
      return
    }

    return this.admit(conn, msg.name, isHost, msg.clientId, msg.channelId)
  }

  private async admit(conn: Conn, name: string, isHost: boolean, clientId?: string, wanted?: string): Promise<void> {
    if (!isHost && this.isFull()) return this.fail(conn, 'room-full', this.fullMessage(), true)
    const existing = this.peers().map((c) => this.info(c))
    const { channels } = this.settings()
    // o canal em que estava (reconexão), senão o primeiro com vaga; o dono entra mesmo com tudo cheio
    const asked = channels.find((ch) => ch.id === wanted)
    const target = (asked && this.hasRoom(asked) ? asked : channels.find((ch) => this.hasRoom(ch))) ?? (isHost ? channels[0] : undefined)
    if (!target) return this.fail(conn, 'room-full', 'Todos os canais da sala estão cheios. Tente de novo daqui a pouco.', true)
    const channelId = target.id
    conn.setData({ peerId: this.deps.newId(), name, isHost, clientId, state: { ...INITIAL_STATE }, channelId })
    const iceServers = await this.deps.iceServers()
    conn.send({
      type: 'welcome',
      peerId: conn.data().peerId!,
      isHost,
      peers: existing,
      iceServers,
      channelId,
      settings: this.settings()
    })
    this.sendHistory(conn, channelId)
    this.broadcast({ type: 'peer-joined', peer: this.info(conn) }, conn)
    this.game.onJoin(conn)
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
      this.game.onClose(d)
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
