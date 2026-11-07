import {
  CONTROL_CHANNEL_ID,
  CONTROL_CHANNEL_LABEL,
  encodeControl,
  parseControl,
  type ControlMsg
} from '../../shared/control'
import type { IceServer, PeerInfo, PeerState, SignalPayload } from '../../shared/protocol'
import type { SignalingClient } from '../signaling'
import { applyQuality, bitrateFor, pixelScale, type QualityPreset } from './quality'

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
}

interface Peer {
  id: string
  name: string
  isHost: boolean
  state: PeerState
  pc: RTCPeerConnection
  /** canal negociado "control" (id 7), igual nos dois lados */
  control: RTCDataChannel
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
  lastBytes?: { bytes: number; at: number }
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
  private micStream?: MediaStream
  private screenStream?: MediaStream
  private camStream?: MediaStream
  private preset?: QualityPreset
  private statsTimer: number

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
    const peer: Peer = {
      id: info.peerId,
      control,
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
      ready: initiator
    }
    this.peers.set(peer.id, peer)

    control.onmessage = (ev) => {
      const msg = parseControl(ev.data)
      if (msg) for (const cb of this.controlListeners) cb(peer.id, msg)
    }
    control.onclose = () => this.emitControlLost(peer.id)

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
      if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) this.emitControlLost(peer.id)
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

  setRemoteState(id: string, state: PeerState): void {
    const peer = this.peers.get(id)
    if (!peer) return
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
    this.preset = preset
    for (const peer of this.peers.values()) if (peer.ready) this.addStreamTo(peer, stream)
  }

  stopScreen(): void {
    const stream = this.screenStream
    if (!stream) return
    this.screenStream = undefined
    for (const peer of this.peers.values()) this.removeStreamFrom(peer, stream)
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

  setPreset(preset: QualityPreset): void {
    this.preset = preset
    const video = this.screenStream?.getVideoTracks()[0]
    if (video) {
      // o bitrate depende do tamanho final: aplica depois que a trilha mudou
      void applyQuality(video, preset).then(() => this.reapplyAllBitrates())
      return
    }
    this.reapplyAllBitrates()
  }

  dispose(): void {
    window.clearInterval(this.statsTimer)
    this.stopScreen()
    // a câmera é do useRoom (sobrevive a reconexões): só sai dos peers
    this.stopCamera(false)
    for (const id of this.peers.keys()) this.emitControlLost(id)
    for (const peer of this.peers.values()) peer.pc.close()
    this.peers.clear()
    this.listeners.clear()
    this.controlListeners.clear()
    this.controlLostListeners.clear()
  }

  // ---------------- internos ----------------

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

  private async pollStats(): Promise<void> {
    let changed = false
    for (const peer of this.peers.values()) {
      this.watchdog(peer)
      if (peer.pc.connectionState !== 'connected') continue
      const report = await peer.pc.getStats()
      let pairId: string | undefined
      let inBytes = 0
      report.forEach((s) => {
        if (s.type === 'transport' && s.selectedCandidatePairId) pairId = s.selectedCandidatePairId
        if (s.type === 'inbound-rtp' && s.kind === 'video') inBytes += s.bytesReceived ?? 0
      })
      if (!pairId) {
        report.forEach((s) => {
          if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') pairId = s.id
        })
      }
      const pair = pairId ? report.get(pairId) : undefined
      const local = pair ? report.get(pair.localCandidateId) : undefined
      const remote = pair ? report.get(pair.remoteCandidateId) : undefined
      const route: Route =
        local?.candidateType === 'relay' || remote?.candidateType === 'relay' ? 'relay' : pair ? 'direto' : 'conectando'
      const rtt = pair?.currentRoundTripTime !== undefined ? Math.round(pair.currentRoundTripTime * 1000) : undefined

      const now = performance.now()
      let kbps: number | undefined
      if (peer.lastBytes && inBytes >= peer.lastBytes.bytes) {
        kbps = Math.round(((inBytes - peer.lastBytes.bytes) * 8) / (now - peer.lastBytes.at))
      }
      peer.lastBytes = { bytes: inBytes, at: now }

      if (route !== peer.route || rtt !== peer.rttMs || kbps !== peer.inKbps) {
        peer.route = route
        peer.rttMs = rtt
        peer.inKbps = inBytes > 0 ? kbps : undefined
        changed = true
      }
    }
    if (changed) this.emit()
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
