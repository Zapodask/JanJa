import {
  CONTROL_CHANNEL_ID,
  CONTROL_CHANNEL_LABEL,
  encodeControl,
  parseControl,
  type ControlMsg
} from '../../shared/control'
import type { IceServer, PeerInfo, PeerState, SignalPayload } from '../../shared/protocol'
import type { SignalingClient } from '../signaling'
import { AUTO_LADDER, AUTO_START, AutoQuality, autoLevelPreset, type AutoReason, type AutoSample } from './autoQuality'
import { HISTORY_SIZE, type DiagKind, type PeerDiag, type SendDiag } from './diag'
import { DiagLog } from './diagLog'
import { applyQuality, bitrateFor, isAuto, nativeSize, pixelScale, type QualityPreset } from './quality'
import {
  fmtPct,
  readPair,
  readStats,
  type Counters,
  type InboundStats,
  type OutboundStats,
  type StatRow
} from './stats'

export type Route = 'conectando' | 'direto' | 'relay' | 'falhou'

export interface PeerView {
  id: string
  name: string
  isHost: boolean
  state: PeerState
  route: Route
  rttMs?: number
  inKbps?: number
  screen?: MediaStream
  mic?: MediaStream
  /** webcam (só vídeo; a voz vem pelo mic) */
  cam?: MediaStream
  /** recebimento da tela dessa pessoa: leitura atual e histórico */
  diag: PeerDiag
}

/** canal negociado "game" (id 8): pacotes binários do Tiro na Sala, sem ordem e sem retransmissão */
export const GAME_CHANNEL_ID = 8
export const GAME_CHANNEL_LABEL = 'game'

interface Peer {
  id: string
  name: string
  isHost: boolean
  state: PeerState
  pc: RTCPeerConnection
  /** canal negociado "control" (id 7), igual nos dois lados */
  control: RTCDataChannel
  /** canal negociado "game" (id 8) */
  game: RTCDataChannel
  polite: boolean
  makingOffer: boolean
  ignoreOffer: boolean
  settingRemoteAnswer: boolean
  /** sinais de um peer são processados em ordem, um de cada vez */
  queue: Promise<void>
  senders: Map<string, RTCRtpSender>
  streams: Map<string, MediaStream>
  route: Route
  rttMs?: number
  inKbps?: number
  /** contadores da leitura anterior do getStats (tela dessa pessoa) */
  counters?: Counters
  /** identifica as trilhas de tela lidas; se mudar, os contadores recomeçam */
  trackKey?: string
  inbound?: InboundStats
  outbound?: OutboundStats
  history: InboundStats[]
  outHistory: OutboundStats[]
  /** último momento (performance.now) de cada tipo de evento, para não poluir o diário */
  lastEvent: Map<string, number>
  lastBand?: number
  lastRoute?: Route
  /**
   * Quem já estava na sala só envia mídia depois de responder a primeira oferta de quem entrou.
   * Sem isso os dois lados oferecem ao mesmo tempo e, na colisão, candidatos ICE se perdem.
   */
  ready: boolean
  /** desde quando a conexão está parada sem conectar (para o watchdog de ICE) */
  stuckSince?: number
}

const ICE_WATCHDOG_MS = 12_000
const CAM_BITRATE = 450_000
/** no máximo um evento do mesmo tipo por pessoa neste intervalo */
const EVENT_GAP_MS = 20_000
const LOSS_EVENT_PCT = 3
const TICK_MIN_GAP_MS = 1_500

/** Faixa de altura da imagem recebida: 0 = até 480p ... 4 = 1440p ou mais. */
function heightBand(h: number): number {
  return h >= 1300 ? 4 : h >= 900 ? 3 : h >= 600 ? 2 : h >= 400 ? 1 : 0
}
const BAND_LABEL = ['360p', '480p', '720p', '1080p', '1440p']

const REASON_TEXT: Record<AutoReason, string> = {
  folga: 'sobrou banda',
  perda: 'pacotes se perdendo',
  banda: 'upload no limite',
  cpu: 'o PC não está dando conta',
  fps: 'a imagem saiu com poucos quadros'
}

/**
 * Mesh WebRTC: um RTCPeerConnection por peer remoto, com "perfect negotiation"
 * (https://w3c.github.io/webrtc-pc/#perfect-negotiation-example) para que qualquer lado
 * possa adicionar/remover a tela a qualquer momento sem colisão de ofertas.
 */
export class PeerManager {
  private readonly peers = new Map<string, Peer>()
  private readonly listeners = new Set<() => void>()
  private readonly controlListeners = new Set<(peerId: string, msg: ControlMsg) => void>()
  private readonly controlLostListeners = new Set<(peerId: string) => void>()
  private readonly gameListeners = new Set<(peerId: string, data: ArrayBuffer) => void>()
  private readonly gameStateListeners = new Set<(peerId: string, open: boolean) => void>()
  private micStream?: MediaStream
  private screenStream?: MediaStream
  private camStream?: MediaStream
  /** preset efetivo; em modo automático é montado do nível atual */
  private preset?: QualityPreset
  /** presente só no modo automático */
  private auto?: AutoQuality
  private lastTickAt = 0
  private polling = false
  private statsTimer: number
  /** diário de eventos da conexão */
  readonly log = new DiagLog()

  constructor(
    private readonly signaling: SignalingClient,
    private readonly selfId: string,
    private readonly iceServers: IceServer[]
  ) {
    this.statsTimer = window.setInterval(() => void this.pollStats(), 2000)
  }

  // ---------------- leitura para a UI ----------------

  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private emit(): void {
    for (const cb of this.listeners) cb()
  }

  views(): PeerView[] {
    return [...this.peers.values()].map((p) => {
      const streams = [...p.streams.values()].filter((s) => s.getTracks().length > 0)
      const camId = p.state.camStreamId
      const isCam = (s: MediaStream): boolean => !!camId && s.id === camId
      const isScreen = (s: MediaStream): boolean =>
        s.id === p.state.screenStreamId || (!isCam(s) && s.getVideoTracks().length > 0)
      return {
        id: p.id,
        name: p.name,
        isHost: p.isHost,
        state: p.state,
        route: p.route,
        rttMs: p.rttMs,
        inKbps: p.inKbps,
        diag: { inbound: p.inbound, history: p.history.slice() },
        screen: p.state.sharing ? streams.find(isScreen) : undefined,
        mic: streams.find((s) => !isScreen(s) && !isCam(s)),
        cam: camId ? streams.find(isCam) : undefined
      }
    })
  }

  get viewerCount(): number {
    return this.peers.size
  }

  // ---------------- ciclo de vida dos peers ----------------

  /** `initiator` = quem acabou de entrar abre um data channel, o que dispara a primeira negociação. */
  addPeer(info: PeerInfo, initiator: boolean): void {
    if (this.peers.has(info.peerId)) return
    const pc = new RTCPeerConnection({ iceServers: this.iceServers })
    const control = pc.createDataChannel(CONTROL_CHANNEL_LABEL, { negotiated: true, id: CONTROL_CHANNEL_ID, ordered: true })
    const game = pc.createDataChannel(GAME_CHANNEL_LABEL, {
      negotiated: true,
      id: GAME_CHANNEL_ID,
      ordered: false,
      maxRetransmits: 0
    })
    game.binaryType = 'arraybuffer'
    const peer: Peer = {
      id: info.peerId,
      control,
      game,
      name: info.name,
      isHost: info.isHost,
      state: info.state,
      pc,
      polite: this.selfId > info.peerId,
      makingOffer: false,
      ignoreOffer: false,
      settingRemoteAnswer: false,
      queue: Promise.resolve(),
      senders: new Map(),
      streams: new Map(),
      route: 'conectando',
      history: [],
      outHistory: [],
      lastEvent: new Map(),
      ready: initiator
    }
    this.peers.set(peer.id, peer)

    control.onmessage = (ev) => {
      const msg = parseControl(ev.data)
      if (msg) for (const cb of this.controlListeners) cb(peer.id, msg)
    }
    control.onclose = () => this.emitControlLost(peer.id)

    game.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) for (const cb of this.gameListeners) cb(peer.id, ev.data)
    }
    game.onopen = () => this.emitGameState(peer.id, true)
    game.onclose = () => this.emitGameState(peer.id, false)

    pc.onnegotiationneeded = async () => {
      // o canal "control" também dispara este evento; quem já estava na sala espera a primeira oferta
      if (!peer.ready) return
      try {
        peer.makingOffer = true
        await pc.setLocalDescription()
        // numa colisão o lado educado pode ter feito rollback enquanto esperávamos
        if (pc.localDescription?.type === 'offer') this.signal(peer.id, { description: pc.localDescription.toJSON() })
      } catch (err) {
        console.error('[rtc] negotiationneeded', err)
      } finally {
        peer.makingOffer = false
      }
    }

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.signal(peer.id, { candidate: candidate.toJSON() })
    }

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') pc.restartIce()
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') peer.route = 'falhou'
      if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
        this.emitControlLost(peer.id)
        this.emitGameState(peer.id, false)
      }
      if (pc.connectionState === 'connected') void this.pollStats()
      this.emit()
    }

    pc.onsignalingstatechange = () => {
      if (pc.signalingState === 'stable') void this.applyBitrate(peer)
    }

    pc.ontrack = (ev) => {
      const stream = ev.streams[0] ?? new MediaStream([ev.track])
      if (!peer.streams.has(stream.id)) {
        peer.streams.set(stream.id, stream)
        stream.onremovetrack = () => {
          if (stream.getTracks().length === 0) peer.streams.delete(stream.id)
          this.emit()
        }
      }
      ev.track.onunmute = () => this.emit()
      this.emit()
    }

    if (initiator) {
      // data channel + mídia ativa no mesmo tick = uma única primeira oferta
      pc.createDataChannel('janja')
      this.addActiveStreams(peer)
    }

    this.emit()
    this.reapplyAllBitrates()
  }

  removePeer(id: string): void {
    const peer = this.peers.get(id)
    if (!peer) return
    this.peers.delete(id)
    this.emitControlLost(id)
    this.emitGameState(id, false)
    peer.pc.close()
    this.emit()
    this.reapplyAllBitrates()
  }

  // ---------------- canal de controle ----------------

  /** Envia no canal "control" do peer. Só vai se o canal estiver aberto; devolve se enviou. */
  sendControl(peerId: string, msg: ControlMsg): boolean {
    const ch = this.peers.get(peerId)?.control
    if (!ch || ch.readyState !== 'open') return false
    ch.send(encodeControl(msg))
    return true
  }

  /** Mensagens válidas do canal "control" (as inválidas já foram descartadas). */
  onControl(cb: (peerId: string, msg: ControlMsg) => void): () => void {
    this.controlListeners.add(cb)
    return () => this.controlListeners.delete(cb)
  }

  /** O canal fechou ou a conexão com o peer caiu/saiu. */
  onControlLost(cb: (peerId: string) => void): () => void {
    this.controlLostListeners.add(cb)
    return () => this.controlLostListeners.delete(cb)
  }

  private emitControlLost(peerId: string): void {
    for (const cb of this.controlLostListeners) cb(peerId)
  }

  // ---------------- canal de jogo ----------------

  /** Envia um pacote no canal "game" do peer. Só vai se o canal estiver aberto; devolve se enviou. */
  sendGame(peerId: string, data: ArrayBuffer): boolean {
    const ch = this.peers.get(peerId)?.game
    if (!ch || ch.readyState !== 'open') return false
    try {
      ch.send(data)
      return true
    } catch {
      return false
    }
  }

  /** peers com o canal "game" aberto agora */
  openGamePeers(): string[] {
    return [...this.peers.values()].filter((p) => p.game.readyState === 'open').map((p) => p.id)
  }

  gameOpen(peerId: string): boolean {
    return this.peers.get(peerId)?.game.readyState === 'open'
  }

  /** Pacotes que chegam no canal "game". */
  onGame(cb: (peerId: string, data: ArrayBuffer) => void): () => void {
    this.gameListeners.add(cb)
    return () => this.gameListeners.delete(cb)
  }

  /** O canal "game" abriu ou fechou (também ao sair o peer ou cair a conexão). */
  onGameState(cb: (peerId: string, open: boolean) => void): () => void {
    this.gameStateListeners.add(cb)
    return () => this.gameStateListeners.delete(cb)
  }

  private emitGameState(peerId: string, open: boolean): void {
    for (const cb of this.gameStateListeners) cb(peerId, open)
  }

  setRemoteState(id: string, state: PeerState): void {
    const peer = this.peers.get(id)
    if (!peer) return
    if (peer.state.sharing !== state.sharing)
      this.log.push({ kind: 'tela', who: peer.name, text: `${peer.name} ${state.sharing ? 'começou a compartilhar a tela' : 'parou de compartilhar a tela'}` })
    peer.state = state
    this.emit()
  }

  handleSignal(from: string, payload: SignalPayload): Promise<void> {
    const peer = this.peers.get(from)
    if (!peer) return Promise.resolve()
    peer.queue = peer.queue.then(() => this.processSignal(peer, payload))
    return peer.queue
  }

  private async processSignal(peer: Peer, payload: SignalPayload): Promise<void> {
    const { pc } = peer
    const from = peer.id
    if (pc.signalingState === 'closed') return
    try {
      if (payload.description) {
        const description = payload.description as RTCSessionDescriptionInit
        const readyForOffer =
          !peer.makingOffer && (pc.signalingState === 'stable' || peer.settingRemoteAnswer)
        const collision = description.type === 'offer' && !readyForOffer
        peer.ignoreOffer = !peer.polite && collision
        if (peer.ignoreOffer) return
        peer.settingRemoteAnswer = description.type === 'answer'
        try {
          await pc.setRemoteDescription(description)
        } finally {
          peer.settingRemoteAnswer = false
        }
        if (description.type === 'offer') {
          await pc.setLocalDescription()
          this.signal(from, { description: pc.localDescription!.toJSON() })
          if (!peer.ready) {
            peer.ready = true
            this.addActiveStreams(peer)
          }
        }
      } else if (payload.candidate) {
        try {
          await pc.addIceCandidate(payload.candidate as RTCIceCandidateInit)
        } catch (err) {
          if (!peer.ignoreOffer) throw err
        }
      }
    } catch (err) {
      console.error('[rtc] signal', err)
    }
  }

  // ---------------- mídia local ----------------

  setMic(stream: MediaStream | undefined): void {
    if (this.micStream) for (const peer of this.peers.values()) this.removeStreamFrom(peer, this.micStream)
    this.micStream = stream
    if (stream) for (const peer of this.peers.values()) if (peer.ready) this.addStreamTo(peer, stream)
  }

  startScreen(stream: MediaStream, preset: QualityPreset): void {
    this.stopScreen()
    this.screenStream = stream
    this.useRequested(preset, stream.getVideoTracks()[0])
    if (this.auto) this.log.push({ kind: 'info', text: `Qualidade automática ligada em ${AUTO_LADDER[this.auto.level].label}` })
    for (const peer of this.peers.values()) if (peer.ready) this.addStreamTo(peer, stream)
  }

  stopScreen(): void {
    const stream = this.screenStream
    if (!stream) return
    this.screenStream = undefined
    for (const peer of this.peers.values()) {
      this.removeStreamFrom(peer, stream)
      peer.outbound = undefined
      peer.outHistory = []
    }
    for (const t of stream.getTracks()) t.stop()
  }

  /** Webcam: trilha de vídeo própria, separada da tela (as duas podem ir juntas). */
  startCamera(stream: MediaStream): void {
    if (this.camStream === stream) return
    this.stopCamera(false)
    this.camStream = stream
    for (const peer of this.peers.values()) if (peer.ready) this.addStreamTo(peer, stream)
  }

  /** Tira a câmera dos peers; `release` também desliga o dispositivo. */
  stopCamera(release = true): void {
    const stream = this.camStream
    if (!stream) return
    this.camStream = undefined
    for (const peer of this.peers.values()) this.removeStreamFrom(peer, stream)
    if (release) for (const t of stream.getTracks()) t.stop()
  }

  /** `AUTO_PRESET` liga o modo automático; um preset fixo desliga. */
  setPreset(preset: QualityPreset): void {
    const video = this.screenStream?.getVideoTracks()[0]
    this.useRequested(preset, video)
    if (video) {
      // o bitrate depende do tamanho final: aplica depois que a trilha mudou
      void applyQuality(video, this.preset!).then(() => this.reapplyAllBitrates())
      return
    }
    this.reapplyAllBitrates()
  }

  /** O que eu estou enviando (só quando compartilho a tela). */
  sendDiag(): SendDiag | undefined {
    const video = this.screenStream?.getVideoTracks()[0]
    if (!video) return undefined
    const preset = this.preset
    const levelLabel = this.auto ? AUTO_LADDER[this.auto.level].label : preset ? `${preset.height}p ${preset.fps}` : ''
    const viewers = [...this.peers.values()]
      .filter((p) => p.senders.has(video.id))
      .map((p) => ({ id: p.id, name: p.name, out: p.outbound, history: p.outHistory.slice() }))
    return { mode: this.auto ? 'auto' : 'fixo', levelLabel, viewers }
  }

  dispose(): void {
    window.clearInterval(this.statsTimer)
    this.stopScreen()
    // a câmera é do useRoom (sobrevive a reconexões): só sai dos peers
    this.stopCamera(false)
    for (const id of this.peers.keys()) {
      this.emitControlLost(id)
      this.emitGameState(id, false)
    }
    for (const peer of this.peers.values()) peer.pc.close()
    this.peers.clear()
    this.listeners.clear()
    this.controlListeners.clear()
    this.controlLostListeners.clear()
    this.gameListeners.clear()
    this.gameStateListeners.clear()
  }

  // ---------------- internos ----------------

  /** Liga ou desliga o modo automático conforme o preset pedido e define o preset efetivo. */
  private useRequested(preset: QualityPreset, video?: MediaStreamTrack): void {
    if (!isAuto(preset)) {
      this.auto = undefined
      this.preset = preset
      return
    }
    // 1440p só se a tela nativa tiver 1440 de altura ou mais
    const nativeH = video ? nativeSize(video).height ?? 0 : 0
    const maxLevel = nativeH >= 1440 ? 4 : 3
    if (this.auto) this.auto.setMaxLevel(maxLevel)
    else this.auto = new AutoQuality({ start: AUTO_START, maxLevel })
    this.lastTickAt = 0
    this.preset = autoLevelPreset(this.auto.level)
  }

  private signal(to: string, payload: SignalPayload): void {
    this.signaling.send({ type: 'signal', to, payload })
  }

  private addActiveStreams(peer: Peer): void {
    if (this.micStream) this.addStreamTo(peer, this.micStream)
    if (this.screenStream) this.addStreamTo(peer, this.screenStream)
    if (this.camStream) this.addStreamTo(peer, this.camStream)
  }

  private addStreamTo(peer: Peer, stream: MediaStream): void {
    for (const track of stream.getTracks()) {
      if (peer.senders.has(track.id)) continue
      const sender = peer.pc.addTrack(track, stream)
      peer.senders.set(track.id, sender)
      // a câmera fica com os codecs padrão do navegador (VP8 dá conta de 360p com pouca CPU)
      if (track.kind === 'video' && stream !== this.camStream) preferVideoCodecs(peer.pc, sender, this.preset?.hint ?? 'motion')
    }
  }

  private removeStreamFrom(peer: Peer, stream: MediaStream): void {
    for (const track of stream.getTracks()) {
      const sender = peer.senders.get(track.id)
      if (!sender) continue
      if (peer.pc.signalingState !== 'closed') peer.pc.removeTrack(sender)
      peer.senders.delete(track.id)
    }
  }

  private reapplyAllBitrates(): void {
    for (const peer of this.peers.values()) void this.applyBitrate(peer)
  }

  private async applyBitrate(peer: Peer): Promise<void> {
    await this.applyCamBitrate(peer)
    const preset = this.preset
    const video = this.screenStream?.getVideoTracks()[0]
    if (!preset || !video) return
    const sender = peer.senders.get(video.id)
    if (!sender) return
    const params = sender.getParameters()
    if (!params.encodings || params.encodings.length === 0) return // ainda negociando
    // bitrate proporcional aos pixels reais (ultrawide 2580×1080 precisa de mais que 1920×1080)
    const { width, height } = video.getSettings()
    params.encodings[0].maxBitrate = bitrateFor(preset, this.peers.size, pixelScale(preset, width, height))
    params.encodings[0].maxFramerate = preset.fps
    // 'balanced' em vez de 'maintain-framerate': quando a banda aperta, não derruba só a resolução (o que deixa tudo borrado)
    params.degradationPreference = preset.hint === 'detail' ? 'maintain-resolution' : 'balanced'
    try {
      await sender.setParameters(params)
    } catch (err) {
      console.warn('[rtc] setParameters', err)
    }
  }

  /** Câmera leve: ~450 kbps e até 24 fps por pessoa, para não disputar banda com a tela. */
  private async applyCamBitrate(peer: Peer): Promise<void> {
    const video = this.camStream?.getVideoTracks()[0]
    if (!video) return
    const sender = peer.senders.get(video.id)
    if (!sender) return
    const params = sender.getParameters()
    if (!params.encodings || params.encodings.length === 0) return
    params.encodings[0].maxBitrate = CAM_BITRATE
    params.encodings[0].maxFramerate = 24
    try {
      await sender.setParameters(params)
    } catch (err) {
      console.warn('[rtc] setParameters câmera', err)
    }
  }

  /** Negociação terminou mas o ICE não conecta: reinicia o ICE (gera credenciais e candidatos novos). */
  private watchdog(peer: Peer): void {
    const { pc } = peer
    const waiting =
      pc.signalingState === 'stable' &&
      !!pc.remoteDescription &&
      (pc.connectionState === 'new' || pc.connectionState === 'connecting' || pc.connectionState === 'disconnected')
    if (!waiting) {
      peer.stuckSince = undefined
      return
    }
    const now = performance.now()
    peer.stuckSince ??= now
    if (now - peer.stuckSince > ICE_WATCHDOG_MS) {
      peer.stuckSince = now
      console.warn('[rtc] ICE parado, reiniciando com', peer.name)
      pc.restartIce()
    }
  }

  /** Evento do diário, no máximo um por tipo e pessoa a cada EVENT_GAP_MS. Devolve se entrou. */
  private note(peer: Peer, key: string, kind: DiagKind, text: string, now: number): boolean {
    const k = `${key}:${peer.id}`
    const last = peer.lastEvent.get(k)
    if (last !== undefined && now - last < EVENT_GAP_MS) return false
    peer.lastEvent.set(k, now)
    this.log.push({ kind, who: peer.name, text })
    return true
  }

  private watchReceive(peer: Peer, inbound: InboundStats, now: number): void {
    if (inbound.lossPct !== undefined && inbound.lossPct >= LOSS_EVENT_PCT)
      this.note(peer, 'perda', 'perda', `Perdendo pacotes da tela de ${peer.name} (${fmtPct(inbound.lossPct)})`, now)
    if (inbound.freezes > 0) this.note(peer, 'travada', 'travada', `A imagem de ${peer.name} travou`, now)
    if (inbound.height) {
      const band = heightBand(inbound.height)
      if (peer.lastBand === undefined) peer.lastBand = band
      else if (band !== peer.lastBand) {
        const up = band > peer.lastBand
        // só atualiza a referência quando o evento entra; senão reporta depois, se continuar diferente
        if (this.note(peer, 'res', up ? 'up' : 'down', `A imagem de ${peer.name} ${up ? 'subiu' : 'desceu'} para ${BAND_LABEL[band]}`, now)) peer.lastBand = band
      }
    }
  }

  private watchRoute(peer: Peer, route: Route, now: number): void {
    const before = peer.lastRoute
    peer.lastRoute = route
    if (route === before) return
    if (route === 'relay') this.note(peer, 'rota', 'relay', `A conexão com ${peer.name} passou a usar o relay`, now)
    else if (route === 'direto') this.note(peer, 'rota', 'direto', `A conexão com ${peer.name} é direta`, now)
  }

  private watchSend(peer: Peer, out: OutboundStats, now: number): void {
    if (out.limitation === 'cpu') this.note(peer, 'cpu', 'cpu', 'Seu PC está no limite para codificar a tela', now)
    else if (out.limitation === 'bandwidth') this.note(peer, 'banda', 'banda', `Seu upload para ${peer.name} está no limite`, now)
  }

  private async pollStats(): Promise<void> {
    if (this.polling) return
    this.polling = true
    try {
      await this.readAll()
    } finally {
      this.polling = false
    }
  }

  private async readAll(): Promise<void> {
    let changed = false
    const screenTrack = this.screenStream?.getVideoTracks()[0]
    const samples: AutoSample[] = []
    for (const peer of [...this.peers.values()]) {
      this.watchdog(peer)
      if (peer.pc.connectionState !== 'connected') continue
      const report = await peer.pc.getStats()
      if (!this.peers.has(peer.id)) continue
      const rows: StatRow[] = []
      report.forEach((s) => rows.push(s as StatRow))
      const now = performance.now()

      // tela dela: a trilha de vídeo do stream de tela recebido (a câmera fica de fora)
      const inIds = new Set<string>()
      if (peer.state.sharing) {
        for (const s of this.screenStreamsOf(peer)) for (const t of s.getVideoTracks()) inIds.add(t.id)
      }
      // minha tela: a fonte de mídia da minha trilha (e o mid do transceiver, para navegadores sem media-source)
      const sender = screenTrack ? peer.senders.get(screenTrack.id) : undefined
      const sourceIds = new Set<string>()
      if (screenTrack) for (const r of rows) if (r.type === 'media-source' && r.trackIdentifier === screenTrack.id) sourceIds.add(r.id)
      const mid = sender ? peer.pc.getTransceivers().find((t) => t.sender === sender)?.mid ?? undefined : undefined
      const key = `${[...inIds].join(',')}|${sender ? (screenTrack?.id ?? '') : ''}`
      if (key !== peer.trackKey) {
        peer.trackKey = key
        peer.counters = undefined
        peer.history = []
        peer.outHistory = []
        peer.inbound = undefined
        peer.outbound = undefined
      }

      const res = readStats(rows, peer.counters, now, {
        inTrack: (r) => inIds.size > 0 && (typeof r.trackIdentifier !== 'string' || inIds.has(r.trackIdentifier)),
        outTrack: (r) => !!sender && (sourceIds.has(r.mediaSourceId as string) || (!!mid && r.mid === mid))
      })
      peer.counters = res.counters
      const pair = readPair(rows)

      if (pair.route !== peer.route || pair.rttMs !== peer.rttMs || res.inbound?.kbps !== peer.inKbps) changed = true
      peer.route = pair.route
      peer.rttMs = pair.rttMs
      peer.inKbps = res.inbound?.kbps
      this.watchRoute(peer, pair.route, now)

      peer.inbound = res.inbound
      if (res.inbound) {
        peer.history.push(res.inbound)
        if (peer.history.length > HISTORY_SIZE) peer.history.shift()
        this.watchReceive(peer, res.inbound, now)
        changed = true
      }
      // o Chrome diz "bandwidth" enquanto o encoder ainda está subindo, mesmo com banda folgada:
      // só vale como limite de verdade se a estimativa estiver abaixo de 75% do teto (mesma regra do automático)
      if (res.outbound?.limitation === 'bandwidth' && screenTrack) {
        const cap = this.capKbps(screenTrack)
        if (cap !== undefined && res.outbound.availableKbps !== undefined && res.outbound.availableKbps >= 0.75 * cap)
          res.outbound = { ...res.outbound, limitation: 'none' }
      }
      peer.outbound = res.outbound
      if (res.outbound) {
        peer.outHistory.push(res.outbound)
        if (peer.outHistory.length > HISTORY_SIZE) peer.outHistory.shift()
        this.watchSend(peer, res.outbound, now)
        const o = res.outbound
        samples.push({ availableKbps: o.availableKbps, lossPct: o.lossPct, limitation: o.limitation, fps: o.fps, kbps: o.kbps })
        changed = true
      }
    }

    this.tickAuto(samples, screenTrack)
    if (changed) this.emit()
  }

  /** Streams de tela de um peer (mesma regra de views()). */
  private screenStreamsOf(peer: Peer): MediaStream[] {
    const camId = peer.state.camStreamId
    return [...peer.streams.values()].filter(
      (s) => s.getVideoTracks().length > 0 && (s.id === peer.state.screenStreamId || !(camId && s.id === camId))
    )
  }

  /** Teto de bitrate da tela por conexão, em kbps (o mesmo que applyBitrate configura). */
  private capKbps(video: MediaStreamTrack): number | undefined {
    if (!this.preset) return undefined
    const { width, height } = video.getSettings()
    return bitrateFor(this.preset, this.peers.size, pixelScale(this.preset, width, height)) / 1000
  }

  /** Modo automático: decide o nível com a pior conexão e aplica. */
  private tickAuto(samples: AutoSample[], video?: MediaStreamTrack): void {
    const auto = this.auto
    if (!auto || !video || !this.preset) return
    const now = performance.now()
    if (now - this.lastTickAt < TICK_MIN_GAP_MS) return
    this.lastTickAt = now
    const capKbps = this.capKbps(video) ?? 0
    const d = auto.tick(samples, now, capKbps)
    if (!d.changed) return
    const preset = autoLevelPreset(d.level)
    this.preset = preset
    const label = AUTO_LADDER[d.level].label
    this.log.push({
      kind: d.dir === 'up' ? 'up' : 'down',
      text: `Qualidade ${d.dir === 'up' ? 'subiu' : 'desceu'} para ${label}: ${REASON_TEXT[d.reason ?? 'perda']}`
    })
    void applyQuality(video, preset).then(() => this.reapplyAllBitrates())
  }
}

/**
 * O Chrome usa VP8 por padrão, o codec mais fraco para tela. VP9 e AV1 entregam
 * bem mais nitidez no mesmo bitrate. Chamado logo depois do addTrack, antes da
 * negociação (que roda no próximo tick via negotiationneeded).
 */
/**
 * Movimento (jogo, vídeo): H.264 primeiro, que usa o encoder da placa de vídeo na maioria dos PCs.
 * VP9 por software trava em resolução alta com 60 fps.
 * Texto/nitidez: VP9 primeiro, mais nítido em texto e com fps baixo a CPU dá conta.
 */
const CODEC_ORDER: Record<QualityPreset['hint'], string[]> = {
  motion: ['video/H264', 'video/VP9', 'video/AV1', 'video/VP8'],
  detail: ['video/VP9', 'video/AV1', 'video/H264', 'video/VP8']
}

function preferVideoCodecs(pc: RTCPeerConnection, sender: RTCRtpSender, hint: QualityPreset['hint']): void {
  const order = CODEC_ORDER[hint]
  const transceiver = pc.getTransceivers().find((t) => t.sender === sender)
  const caps = RTCRtpReceiver.getCapabilities?.('video')
  if (!transceiver || !caps || typeof transceiver.setCodecPreferences !== 'function') return
  const rank = (mime: string) => {
    const i = order.indexOf(mime)
    return i === -1 ? order.length : i
  }
  // mantém RTX/RED/FEC (rank alto) no fim, que o navegador precisa para retransmissão
  const codecs = [...caps.codecs].sort((a, b) => rank(a.mimeType) - rank(b.mimeType))
  try {
    transceiver.setCodecPreferences(codecs)
  } catch (err) {
    console.warn('[rtc] setCodecPreferences', err)
  }
}
