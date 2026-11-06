// Página de teste: usa o SignalingClient e o PeerManager reais do renderer,
// com câmera falsa do Chrome no lugar da captura de tela (getDisplayMedia não é automatizável).
import { PeerManager } from '../../src/web/rtc/PeerManager'
import { DEFAULT_PRESET } from '../../src/web/rtc/quality'
import { SignalingClient } from '../../src/web/signaling'

declare global {
  interface Window {
    harness: {
      join: (origin: string, roomId: string, name: string, hostKey?: string) => Promise<string>
      share: () => Promise<void>
      stop: () => void
      views: () => unknown[]
      videoLive: (peerId: string) => Promise<boolean>
    }
  }
}

let manager: PeerManager
let signaling: SignalingClient
let state = { sharing: false, micMuted: false } as { sharing: boolean; micMuted: boolean; screenStreamId?: string }

window.harness = {
  async join(origin, roomId, name, hostKey) {
    signaling = new SignalingClient({ origin, roomId, name, hostKey })
    const welcome = await signaling.connect()
    manager = new PeerManager(signaling, welcome.peerId, welcome.iceServers)
    const mic = await navigator.mediaDevices.getUserMedia({ audio: true })
    manager.setMic(mic)
    for (const p of welcome.peers) manager.addPeer(p, true)
    signaling.on((msg) => {
      if (msg.type === 'peer-joined') manager.addPeer(msg.peer, false)
      if (msg.type === 'peer-left') manager.removePeer(msg.peerId)
      if (msg.type === 'signal') void manager.handleSignal(msg.from, msg.payload)
      if (msg.type === 'state') manager.setRemoteState(msg.from, msg.state)
    })
    return welcome.peerId
  },
  async share() {
    const screen = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360 }, audio: true })
    state = { ...state, sharing: true, screenStreamId: screen.id }
    signaling.send({ type: 'state', state })
    manager.startScreen(screen, DEFAULT_PRESET)
  },
  stop() {
    manager.stopScreen()
    state = { ...state, sharing: false, screenStreamId: undefined }
    signaling.send({ type: 'state', state })
  },
  views() {
    return manager.views().map((v) => ({
      id: v.id,
      name: v.name,
      route: v.route,
      sharing: v.state.sharing,
      screenVideo: v.screen?.getVideoTracks().length ?? 0,
      screenAudio: v.screen?.getAudioTracks().length ?? 0,
      micAudio: v.mic?.getAudioTracks().length ?? 0,
      // diagnóstico
      pc: (() => {
        const pc = (manager as unknown as { peers: Map<string, { pc: RTCPeerConnection }> }).peers.get(v.id)?.pc
        return pc
          ? `${pc.signalingState}/${pc.connectionState} tx=` +
              pc.getTransceivers().map((t) => `${t.mid}:${t.currentDirection}:${t.receiver.track.kind}:${t.receiver.track.readyState}`).join(',')
          : '-'
      })()
    }))
  },
  /** toca o vídeo recebido e confirma que chegam frames */
  async videoLive(peerId) {
    const view = manager.views().find((v) => v.id === peerId)
    if (!view?.screen) return false
    const video = document.createElement('video')
    video.muted = true
    video.srcObject = view.screen
    document.body.append(video)
    await video.play().catch(() => undefined)
    const start = performance.now()
    while (performance.now() - start < 5000) {
      if (video.videoWidth > 0 && video.currentTime > 0) {
        video.remove()
        return true
      }
      await new Promise((r) => setTimeout(r, 100))
    }
    video.remove()
    return false
  }
}
