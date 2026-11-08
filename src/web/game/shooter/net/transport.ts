/**
 * Transporte do Tiro na Sala: por jogador (playerId), vai pelo canal P2P "game" quando ele está
 * aberto e o HELLO já ligou peerId a playerId; senão, pelo repasse do servidor (base64).
 * Sem DOM: o PeerManager entra por uma interface mínima (`GameLink`).
 */
import { decodePacket, encodeHello, fromBase64, MAX_PACKET_BYTES, packetType, PKT_HELLO, toBase64 } from '../../../../shared/games/shooter/codec'

export interface GameLink {
  sendGame(peerId: string, data: ArrayBuffer): boolean
  onGame(cb: (peerId: string, data: ArrayBuffer) => void): () => void
  gameOpen(peerId: string): boolean
  onGameState(cb: (peerId: string, open: boolean) => void): () => void
  /** canais já abertos quando a sessão começou */
  openGamePeers?(): string[]
}

export interface TransportDeps {
  /** meu playerId (espectador: um id sintético `espectador-xxxx`) */
  selfId: string
  epoch(): number
  /** canal P2P; pode faltar ou mudar (reconexão) */
  link(): GameLink | undefined
  relay(to: string, data: string): void
  onRelay(cb: (from: string, data: string) => void): () => void
  /** outros jogadores humanos sentados e presentes (destino do '*' pelo servidor) */
  others(): string[]
}

export type Route = 'p2p' | 'relay'

/** de quanto em quanto tempo repete o HELLO enquanto o outro lado não respondeu (ms) */
export const HELLO_RETRY_MS = 1000

export class Transport {
  private readonly peerToPlayer = new Map<string, string>()
  private readonly playerToPeer = new Map<string, string>()
  private readonly listeners = new Set<(from: string, data: ArrayBuffer) => void>()
  private readonly offs: (() => void)[] = []
  private link: GameLink | undefined
  private lastHelloAt = -Infinity
  /** os peers que já abriram o canal e ainda não deram HELLO */
  private readonly waiting = new Set<string>()

  constructor(private readonly deps: TransportDeps) {
    this.offs.push(deps.onRelay((from, data) => this.onRelayed(from, data)))
    this.attach()
  }

  /** (Re)liga ao PeerManager atual. Chame quando o manager mudar. */
  attach(): void {
    const next = this.deps.link()
    if (next === this.link) return
    for (const off of this.linkOffs.splice(0)) off()
    this.link = next
    this.peerToPlayer.clear()
    this.playerToPeer.clear()
    this.waiting.clear()
    if (!next) return
    for (const peer of next.openGamePeers?.() ?? []) this.onState(peer, true)
    this.linkOffs.push(
      next.onGame((peer, data) => this.onP2P(peer, data)),
      next.onGameState((peer, open) => this.onState(peer, open))
    )
  }
  private readonly linkOffs: (() => void)[] = []

  onPacket(cb: (from: string, data: ArrayBuffer) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  routeTo(playerId: string): Route {
    return this.p2pPeer(playerId) ? 'p2p' : 'relay'
  }

  private p2pPeer(playerId: string): string | undefined {
    const peer = this.playerToPeer.get(playerId)
    return peer !== undefined && this.link?.gameOpen(peer) ? peer : undefined
  }

  /** `to` = playerId ou '*' (todos os outros). */
  send(to: string | '*', data: ArrayBuffer): void {
    if (data.byteLength > MAX_PACKET_BYTES) return
    if (to !== '*') {
      const peer = this.p2pPeer(to)
      if (peer && this.link?.sendGame(peer, data)) return
      this.deps.relay(to, toBase64(data))
      return
    }
    let needRelay = false
    const done = new Set<string>()
    // P2P para todos que já disseram quem são (inclui espectadores); servidor para os sentados sem canal
    for (const [player, peer] of this.playerToPeer) {
      if (this.link?.gameOpen(peer) && this.link.sendGame(peer, data)) done.add(player)
    }
    for (const p of this.deps.others()) if (!done.has(p)) needRelay = true
    if (needRelay) this.deps.relay('*', toBase64(data))
  }

  // ---------- HELLO ----------

  /** Diz quem sou a todos os canais abertos (ao abrir e quando o epoch muda). */
  announce(): void {
    const link = this.link
    if (!link) return
    const hello = encodeHello(this.deps.selfId, this.deps.epoch())
    for (const peer of this.openPeers()) link.sendGame(peer, hello)
  }

  /** Chame ~1x por segundo: repete o HELLO para quem ainda não se apresentou. */
  tick(now: number): void {
    if (now - this.lastHelloAt < HELLO_RETRY_MS) return
    this.lastHelloAt = now
    const link = this.link
    if (!link) return
    const hello = encodeHello(this.deps.selfId, this.deps.epoch())
    for (const peer of this.waiting) {
      if (link.gameOpen(peer) && !this.peerToPlayer.has(peer)) link.sendGame(peer, hello)
      else if (!link.gameOpen(peer)) this.waiting.delete(peer)
    }
  }

  private openPeers(): string[] {
    return [...this.waiting, ...this.peerToPlayer.keys()].filter((p, i, a) => a.indexOf(p) === i && this.link?.gameOpen(p))
  }

  private onState(peer: string, open: boolean): void {
    if (open) {
      this.waiting.add(peer)
      this.link?.sendGame(peer, encodeHello(this.deps.selfId, this.deps.epoch()))
    } else {
      this.waiting.delete(peer)
      this.forget(peer)
    }
  }

  private forget(peer: string): void {
    const player = this.peerToPlayer.get(peer)
    this.peerToPlayer.delete(peer)
    if (player !== undefined && this.playerToPeer.get(player) === peer) this.playerToPeer.delete(player)
  }

  private onP2P(peer: string, data: ArrayBuffer): void {
    if (packetType(data) === PKT_HELLO) {
      const h = decodePacket(data)
      if (h?.t !== 'hello' || h.playerId === this.deps.selfId) return
      const old = this.playerToPeer.get(h.playerId)
      if (old && old !== peer) this.peerToPlayer.delete(old)
      this.forget(peer)
      this.peerToPlayer.set(peer, h.playerId)
      this.playerToPeer.set(h.playerId, peer)
      this.waiting.delete(peer)
      if (!h.reply) this.link?.sendGame(peer, encodeHello(this.deps.selfId, this.deps.epoch(), true))
      return
    }
    const from = this.peerToPlayer.get(peer)
    if (from === undefined) return
    for (const cb of this.listeners) cb(from, data)
  }

  private onRelayed(from: string, text: string): void {
    const data = fromBase64(text)
    if (!data || data.byteLength > MAX_PACKET_BYTES || packetType(data) === PKT_HELLO) return
    for (const cb of this.listeners) cb(from, data)
  }

  dispose(): void {
    for (const off of this.offs.splice(0)) off()
    for (const off of this.linkOffs.splice(0)) off()
    this.listeners.clear()
  }
}
