import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { PokerAction, PokerOptions } from '../shared/games/poker/types'
import {
  DEFAULT_CHANNELS,
  INITIAL_STATE,
  type ChatMessage,
  type ClientMessage,
  type PeerInfo,
  type PeerState,
  type RoomSettings
} from '../shared/protocol'
import { gameReducer, initialGameState, isGameMsg } from './game/state'
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
  /** conexões de mídia: só quem está no mesmo canal */
  peers: PeerView[]
  /** todo mundo na sala (menos você), de todos os canais */
  roster: PeerInfo[]
  /** canais e limite de pessoas, definidos por quem criou a sala */
  settings: RoomSettings
  /** o canal onde você está */
  channelId?: string
  /** chat do seu canal (histórico + ao vivo) */
  chat: ChatMessage[]
  /** quantas mensagens de outras pessoas chegaram ao vivo (a UI conta as não lidas por aqui) */
  chatLive: number
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
  /** a própria webcam, enquanto ligada */
  camera?: MediaStream
  /** a câmera está sendo aberta (permissão do navegador) */
  cameraPending?: boolean
  /** a malha WebRTC da sala atual (o controle remoto usa o canal "control" dela) */
  manager?: PeerManager
}

const MIC_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true
}

/** mensagens de chat mantidas na tela (o servidor guarda só as últimas 50) */
const MAX_CHAT_KEPT = 200

const hasGetUserMedia = (): boolean => typeof navigator.mediaDevices?.getUserMedia === 'function'

/** Traduz o erro do getUserMedia numa mensagem para a pessoa. */
function micErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : ''
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Nenhum microfone encontrado neste dispositivo.'
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'O navegador bloqueou o microfone. Libere no cadeado da barra de endereço.'
  return 'Não foi possível acessar o microfone.'
}

/** Pedido da webcam: 360p a até 24 fps basta para rosto e economiza banda na malha. */
const CAM_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 640 },
  height: { ideal: 360 },
  frameRate: { ideal: 24, max: 30 },
  facingMode: 'user'
}

/** O navegador tem câmera aqui? (precisa de HTTPS) */
export const canUseCamera = (): boolean => window.isSecureContext && hasGetUserMedia()

/** Traduz o erro da câmera numa mensagem para a pessoa. */
export function cameraErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : ''
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Nenhuma câmera encontrada neste dispositivo.'
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'O navegador bloqueou a câmera. Libere no cadeado da barra de endereço.'
  if (name === 'NotReadableError' || name === 'AbortError')
    return 'A câmera está ocupada por outro programa (Zoom, Teams, OBS...). Feche e tente de novo.'
  return 'Não foi possível abrir a câmera.'
}

/** O navegador consegue compartilhar tela aqui? (celular e páginas sem HTTPS não conseguem) */
export const canShareScreen = (): boolean =>
  window.isSecureContext && typeof navigator.mediaDevices?.getDisplayMedia === 'function'

/**
 * Pede a tela ao navegador. O seletor é o nativo: telas, janelas e abas.
 * - systemAudio: oferece "compartilhar áudio do sistema" ao escolher a tela inteira (Chrome/Edge no Windows e no macOS recente)
 * - windowAudio 'window': ao escolher a janela de um programa (ex.: um jogo), vai só o som dela, não o do PC inteiro
 * - restrictOwnAudio: tira do áudio capturado o som que o próprio JanJa toca (a voz dos amigos), para não ter eco.
 *   No Windows o Chrome/Edge tiram o som do navegador inteiro, então `browserAudio` permite desligar isso.
 */
async function captureScreen(preset: QualityPreset, browserAudio: boolean): Promise<MediaStream> {
  const audio = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    restrictOwnAudio: !browserAudio
  } as MediaTrackConstraints
  const options = {
    video: captureConstraints(preset),
    audio,
    systemAudio: 'include',
    windowAudio: 'window',
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
    roster: [],
    chat: [],
    chatLive: 0,
    settings: { name: '', channels: DEFAULT_CHANNELS },
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
  const camRef = useRef<MediaStream>(undefined)
  /** último canal (sobrevive à reconexão: o servidor devolve a pessoa para ele) */
  const channelRef = useRef<string>(undefined)
  const mountedRef = useRef(false)
  const [attempt, setAttempt] = useState(0)

  // jogo da sala: o estado vem do servidor; a ação leva o seq da última visão
  const [game, dispatchGame] = useReducer(gameReducer, initialGameState)
  const [gameError, setGameError] = useState<{ code: string; message: string; n: number } | null>(null)
  const gameRef = useRef(game)
  gameRef.current = game
  const gameErrors = useRef(0)
  const [roomNotice, setRoomNotice] = useState<{ message: string; n: number } | null>(null)
  const roomNotices = useRef(0)

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
      camRef.current?.getTracks().forEach((t) => t.stop())
      camRef.current = undefined
    }
  }, [])

  useEffect(() => {
    let disposed = false
    const signaling = new SignalingClient({ roomId, name, hostKey, channelId: channelRef.current })
    signalingRef.current = signaling
    patch({ status: 'conectando', error: undefined, peers: [], roster: [], chat: [], requests: [] })
    dispatchGame({ type: 'reset' })

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
        // reconexão com a câmera ligada: ela continua indo para todo mundo
        if (camRef.current?.getVideoTracks().some((t) => t.readyState === 'live')) manager.startCamera(camRef.current)
        else if (meRef.current.camStreamId) meRef.current = { ...meRef.current, camStreamId: undefined }

        // lista de todos na sala (de qualquer canal); a mídia só liga quem está no mesmo canal
        const roster = new Map(welcome.peers.map((p) => [p.peerId, p]))
        let channel = welcome.channelId
        channelRef.current = channel
        const syncRoster = () => !disposed && patch({ roster: [...roster.values()], channelId: channel })

        // quem entra (ou chega no canal) inicia a conexão com todos que já estão nele
        // (antes de assinar as mensagens, para os sinais guardados acharem o peer)
        for (const peer of roster.values()) if (peer.channelId === channel) manager.addPeer(peer, true)

        signaling.on((msg) => {
          switch (msg.type) {
            case 'peer-joined':
              roster.set(msg.peer.peerId, msg.peer)
              if (msg.peer.channelId === channel) manager.addPeer(msg.peer, false)
              syncRoster()
              break
            case 'peer-left':
              roster.delete(msg.peerId)
              manager.removePeer(msg.peerId)
              syncRoster()
              break
            case 'peer-moved': {
              if (msg.peerId === welcome.peerId) {
                // eu troquei de canal: desliga o canal antigo e liga com quem está no novo
                if (msg.channelId === channel) break
                channel = msg.channelId
                channelRef.current = channel
                for (const view of manager.views()) manager.removePeer(view.id)
                for (const peer of roster.values()) if (peer.channelId === channel) manager.addPeer(peer, true)
              } else {
                const peer = roster.get(msg.peerId)
                if (!peer) break
                const moved = { ...peer, channelId: msg.channelId }
                roster.set(msg.peerId, moved)
                if (msg.channelId === channel) manager.addPeer(moved, false)
                else manager.removePeer(msg.peerId)
              }
              syncRoster()
              break
            }
            case 'room-settings':
              patch({ settings: msg.settings })
              break
            case 'chat-history':
              if (msg.channelId === channel && !disposed) patch({ chat: msg.messages })
              break
            case 'chat':
              if (msg.channelId === channel && !disposed) {
                const fromOther = msg.message.from !== welcome.peerId
                setState((s) => ({
                  ...s,
                  chat: [...s.chat, msg.message].slice(-MAX_CHAT_KEPT),
                  chatLive: s.chatLive + (fromOther ? 1 : 0)
                }))
              }
              break
            case 'signal':
              void manager.handleSignal(msg.from, msg.payload)
              break
            case 'state': {
              const peer = roster.get(msg.from)
              if (peer) roster.set(msg.from, { ...peer, state: msg.state })
              manager.setRemoteState(msg.from, msg.state)
              syncRoster()
              break
            }
            case 'join-request':
              setState((s) => ({ ...s, requests: [...s.requests, { requestId: msg.requestId, name: msg.name }] }))
              break
            case 'join-request-cancelled':
              setState((s) => ({ ...s, requests: s.requests.filter((r) => r.requestId !== msg.requestId) }))
              break
            case 'game-lobby':
            case 'game-view':
            case 'game-events':
              if (isGameMsg(msg)) dispatchGame(msg)
              break
            case 'game-error':
              setGameError({ code: msg.code, message: msg.message, n: ++gameErrors.current })
              break
            case 'error':
              // erros de canal viram aviso para a pessoa; o resto só vai para o console
              if (
                msg.code === 'not-host' ||
                msg.code === 'unknown-channel' ||
                msg.code === 'channel-limit' ||
                msg.code === 'channel-full' ||
                msg.code === 'chat-flood'
              ) {
                setRoomNotice({ message: msg.message, n: ++roomNotices.current })
              } else console.warn('[signaling]', msg.code, msg.message)
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
          roster: [...roster.values()],
          channelId: channel,
          settings: welcome.settings,
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

  const stopCamera = useCallback(() => {
    const cam = camRef.current
    camRef.current = undefined
    managerRef.current?.stopCamera()
    cam?.getTracks().forEach((t) => t.stop())
    publishState({ camStreamId: undefined })
    patch({ camera: undefined, cameraPending: false })
  }, [patch, publishState])

  /** Liga a webcam. Devolve a mensagem de erro (para o aviso) ou undefined se ligou. */
  const startCamera = useCallback(async (): Promise<string | undefined> => {
    if (camRef.current) return undefined
    patch({ cameraPending: true })
    try {
      if (!canUseCamera()) throw new DOMException('sem câmera', 'NotFoundError')
      const stream = await navigator.mediaDevices.getUserMedia({ video: CAM_CONSTRAINTS, audio: false })
      if (!mountedRef.current) {
        stream.getTracks().forEach((t) => t.stop())
        return undefined
      }
      const video = stream.getVideoTracks()[0]
      if (video) {
        video.contentHint = 'motion'
        // câmera desconectada ou tomada por outro app
        video.addEventListener('ended', () => camRef.current === stream && stopCamera(), { once: true })
      }
      camRef.current = stream
      // anuncia antes da trilha chegar, para o receptor saber que esse vídeo é câmera e não tela
      publishState({ camStreamId: stream.id })
      managerRef.current?.startCamera(stream)
      patch({ camera: stream, cameraPending: false })
      return undefined
    } catch (err) {
      patch({ cameraPending: false })
      return cameraErrorMessage(err)
    }
  }, [patch, publishState, stopCamera])

  const stopShare = useCallback(() => {
    managerRef.current?.stopScreen()
    publishState({ sharing: false, screenStreamId: undefined })
    patch({ screen: undefined })
  }, [patch, publishState])

  const startShare = useCallback(
    async (preset: QualityPreset) => {
      const stream = await captureScreen(preset, getPrefs().shareBrowserAudio)
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

  const send = useCallback((msg: ClientMessage) => signalingRef.current?.send(msg), [])
  const gameApi = useMemo(
    () => ({
      open: (options: PokerOptions) => send({ type: 'game-open', gameId: 'poker', options }),
      sit: (seat?: number) => send({ type: 'game-sit', seat }),
      stand: () => send({ type: 'game-stand' }),
      start: () => send({ type: 'game-start' }),
      close: () => send({ type: 'game-close' }),
      act: (action: PokerAction) => send({ type: 'game-action', seq: gameRef.current.viewSeq, action })
    }),
    [send]
  )

  const roomApi = useMemo(
    () => ({
      joinChannel: (channelId: string) => send({ type: 'channel-join', channelId }),
      sendChat: (text: string) => send({ type: 'chat-send', text }),
      createChannel: (name: string, limit: number) => send({ type: 'channel-create', name, limit }),
      editChannel: (channelId: string, name: string, limit: number) => send({ type: 'channel-edit', channelId, name, limit }),
      deleteChannel: (channelId: string) => send({ type: 'channel-delete', channelId }),
      renameRoom: (name: string) => send({ type: 'room-rename', name })
    }),
    [send]
  )

  return {
    state,
    toggleMic,
    startShare,
    stopShare,
    startCamera,
    stopCamera,
    setPreset,
    answerRequest,
    reconnect,
    game,
    gameApi,
    gameError,
    roomApi,
    roomNotice
  }
}
