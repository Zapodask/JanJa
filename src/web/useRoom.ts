import { useCallback, useEffect, useRef, useState } from 'react'
import { INITIAL_STATE, type PeerState } from '../shared/protocol'
import { PeerManager, type PeerView } from './rtc/PeerManager'
import { applyQuality, captureConstraints, presetById, type QualityPreset } from './rtc/quality'
import { SignalingClient } from './signaling'
import { getPrefs, setPrefs } from './storage'

export type RoomStatus = 'conectando' | 'aguardando-aprovacao' | 'na-sala' | 'caiu' | 'erro'

export interface JoinRequest {
  requestId: string
  name: string
}

export interface RoomState {
  status: RoomStatus
  error?: string
  selfId?: string
  isHost: boolean
  peers: PeerView[]
  me: PeerState
  screen?: MediaStream
  preset: QualityPreset
  /** o próprio mic (para indicador de fala local) */
  micStream?: MediaStream
  /** mensagem amigável se o mic foi negado / não existe */
  micError?: string
  /** navegador tem getUserMedia e a permissão não foi negada nesta sessão */
  micAvailable: boolean
  requests: JoinRequest[]
  /** a malha WebRTC da sala atual (o controle remoto usa o canal "control" dela) */
  manager?: PeerManager
}

const MIC_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true
}

const hasGetUserMedia = (): boolean => typeof navigator.mediaDevices?.getUserMedia === 'function'

/** Traduz o erro do getUserMedia numa mensagem para a pessoa. */
function micErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : ''
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Nenhum microfone encontrado neste dispositivo.'
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'O navegador bloqueou o microfone. Libere no cadeado da barra de endereço.'
  return 'Não foi possível acessar o microfone.'
}

/** O navegador consegue compartilhar tela aqui? (celular e páginas sem HTTPS não conseguem) */
export const canShareScreen = (): boolean =>
  window.isSecureContext && typeof navigator.mediaDevices?.getDisplayMedia === 'function'

/**
 * Pede a tela ao navegador. O seletor é o nativo: telas, janelas e abas.
 * - systemAudio: oferece "compartilhar áudio do sistema" (Chrome/Edge no Windows e no macOS recente)
 * - restrictOwnAudio: tira do áudio capturado o som que o próprio JanJa toca (a voz dos amigos) → sem eco
 */
async function captureScreen(preset: QualityPreset): Promise<MediaStream> {
  const audio = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    restrictOwnAudio: true
  } as MediaTrackConstraints
  const options = {
    video: captureConstraints(preset),
    audio,
    systemAudio: 'include',
    windowAudio: 'system',
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include'
  } as DisplayMediaStreamOptions
  return navigator.mediaDevices.getDisplayMedia(options)
}

export function useRoom(roomId: string, name: string, hostKey?: string) {
  const [state, setState] = useState<RoomState>({
    status: 'conectando',
    isHost: false,
    peers: [],
    // mic começa mudo, salvo se a pessoa já escolheu ligar da última vez
    me: { ...INITIAL_STATE, micMuted: getPrefs().micMuted },
    preset: presetById(getPrefs().presetId),
    micAvailable: hasGetUserMedia(),
    requests: []
  })
  const signalingRef = useRef<SignalingClient>(undefined)
  const managerRef = useRef<PeerManager>(undefined)
  const micRef = useRef<MediaStream>(undefined)
  const meRef = useRef<PeerState>({ ...INITIAL_STATE, micMuted: getPrefs().micMuted })
  const micPendingRef = useRef<Promise<MediaStream | undefined>>(undefined)
  const mountedRef = useRef(false)
  const [attempt, setAttempt] = useState(0)

  const patch = useCallback((p: Partial<RoomState>) => setState((s) => ({ ...s, ...p })), [])

  const publishState = useCallback(
    (next: Partial<PeerState>) => {
      meRef.current = { ...meRef.current, ...next }
      signalingRef.current?.send({ type: 'state', state: meRef.current })
      patch({ me: meRef.current })
    },
    [patch]
  )

  /** Pede o mic (ou reaproveita o que está vivo). Em caso de falha preenche micError e devolve undefined. */
  const acquireMic = useCallback((): Promise<MediaStream | undefined> => {
    const current = micRef.current
    if (current?.getAudioTracks().some((t) => t.readyState === 'live')) return Promise.resolve(current)
    if (micPendingRef.current) return micPendingRef.current
    const pending = (async () => {
      try {
        if (!hasGetUserMedia()) throw new DOMException('sem getUserMedia', 'NotFoundError')
        const stream = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS, video: false })
        if (!mountedRef.current) {
          stream.getTracks().forEach((t) => t.stop())
          return undefined
        }
        micRef.current = stream
        patch({ micStream: stream, micError: undefined, micAvailable: true })
        return stream
      } catch (err) {
        if (mountedRef.current) patch({ micStream: undefined, micError: micErrorMessage(err), micAvailable: false })
        return undefined
      } finally {
        micPendingRef.current = undefined
      }
    })()
    micPendingRef.current = pending
    return pending
  }, [patch])

  // ao desmontar de vez, solta o device do mic (reconectar reaproveita)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      micRef.current?.getTracks().forEach((t) => t.stop())
      micRef.current = undefined
    }
  }, [])

  useEffect(() => {
    let disposed = false
    const signaling = new SignalingClient({ roomId, name, hostKey })
    signalingRef.current = signaling
    patch({ status: 'conectando', error: undefined, peers: [], requests: [] })

    void (async () => {
      // microfone preguiçoso: se a última escolha foi mudo, nem pede permissão agora
      if (!meRef.current.micMuted) {
        const mic = await acquireMic()
        if (mic) {
          for (const t of mic.getAudioTracks()) t.enabled = true
        } else {
          // falhou: entra mudo, mas não sobrescreve a preferência salva
          meRef.current = { ...meRef.current, micMuted: true }
        }
      }
      if (disposed) return

      try {
        const welcome = await signaling.connect(() => !disposed && patch({ status: 'aguardando-aprovacao' }))
        if (disposed) return signaling.close()
        const manager = new PeerManager(signaling, welcome.peerId, welcome.iceServers)
        managerRef.current = manager
        manager.onChange(() => !disposed && patch({ peers: manager.views() }))
        manager.setMic(micRef.current)

        // quem entra inicia a conexão com todos que já estão na sala
        // (antes de assinar as mensagens, para os sinais guardados acharem o peer)
        for (const peer of welcome.peers) manager.addPeer(peer, true)

        signaling.on((msg) => {
          switch (msg.type) {
            case 'peer-joined':
              manager.addPeer(msg.peer, false)
              break
            case 'peer-left':
              manager.removePeer(msg.peerId)
              break
            case 'signal':
              void manager.handleSignal(msg.from, msg.payload)
              break
            case 'state':
              manager.setRemoteState(msg.from, msg.state)
              break
            case 'join-request':
              setState((s) => ({ ...s, requests: [...s.requests, { requestId: msg.requestId, name: msg.name }] }))
              break
            case 'join-request-cancelled':
              setState((s) => ({ ...s, requests: s.requests.filter((r) => r.requestId !== msg.requestId) }))
              break
            case 'error':
              console.warn('[signaling]', msg.code, msg.message)
              break
          }
        })
        signaling.onClose((reason) => !disposed && patch({ status: 'caiu', error: reason }))

        signaling.send({ type: 'state', state: meRef.current })
        patch({
          status: 'na-sala',
          selfId: welcome.peerId,
          isHost: welcome.isHost,
          me: meRef.current,
          micStream: micRef.current,
          peers: manager.views(),
          manager
        })
      } catch (err) {
        if (!disposed) patch({ status: 'erro', error: err instanceof Error ? err.message : String(err) })
      }
    })()

    return () => {
      disposed = true
      managerRef.current?.dispose()
      managerRef.current = undefined
      signaling.close()
      meRef.current = { ...meRef.current, sharing: false, screenStreamId: undefined }
      setState((s) => ({ ...s, screen: undefined, me: meRef.current, manager: undefined }))
    }
  }, [roomId, name, hostKey, attempt, patch, acquireMic])

  const toggleMic = useCallback(async () => {
    if (!meRef.current.micMuted) {
      // mutar: só desliga a trilha, o device continua aberto para religar rápido
      for (const t of micRef.current?.getAudioTracks() ?? []) t.enabled = false
      publishState({ micMuted: true })
      setPrefs({ micMuted: true })
      return
    }
    // ligar: pede o mic na primeira vez (ou se o device morreu)
    const hadMic = micRef.current
    const mic = await acquireMic()
    if (!mic) return // permissão negada: segue mudo, micError já está no estado
    if (mic !== hadMic) managerRef.current?.setMic(mic)
    for (const t of mic.getAudioTracks()) t.enabled = true
    publishState({ micMuted: false })
    setPrefs({ micMuted: false })
  }, [acquireMic, publishState])

  const stopShare = useCallback(() => {
    managerRef.current?.stopScreen()
    publishState({ sharing: false, screenStreamId: undefined })
    patch({ screen: undefined })
  }, [patch, publishState])

  const startShare = useCallback(
    async (preset: QualityPreset) => {
      const stream = await captureScreen(preset)
      const video = stream.getVideoTracks()[0]
      if (video) {
        // veio no tamanho nativo: reduz para o preset mantendo a proporção (ultrawide continua 21:9)
        await applyQuality(video, preset)
        video.addEventListener('ended', () => stopShare(), { once: true })
      }
      // anuncia antes das tracks chegarem, para o receptor classificar o áudio da tela
      publishState({ sharing: true, screenStreamId: stream.id })
      managerRef.current?.startScreen(stream, preset)
      setPrefs({ presetId: preset.id })
      patch({ screen: stream, preset })
      return { hasAudio: stream.getAudioTracks().length > 0 }
    },
    [patch, publishState, stopShare]
  )

  const setPreset = useCallback(
    (preset: QualityPreset) => {
      managerRef.current?.setPreset(preset)
      setPrefs({ presetId: preset.id })
      patch({ preset })
    },
    [patch]
  )

  const answerRequest = useCallback((requestId: string, approved: boolean) => {
    signalingRef.current?.send({ type: 'join-response', requestId, approved })
    setState((s) => ({ ...s, requests: s.requests.filter((r) => r.requestId !== requestId) }))
  }, [])

  const reconnect = useCallback(() => setAttempt((n) => n + 1), [])

  return { state, toggleMic, startShare, stopShare, setPreset, answerRequest, reconnect }
}
