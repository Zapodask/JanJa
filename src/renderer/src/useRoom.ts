import { useCallback, useEffect, useRef, useState } from 'react'
import { INITIAL_STATE, type PeerState } from '@shared/protocol'
import { PeerManager, type PeerView } from './rtc/PeerManager'
import { DEFAULT_PRESET, type QualityPreset } from './rtc/quality'
import { SignalingClient } from './signaling'

export type RoomStatus = 'conectando' | 'aguardando-aprovacao' | 'na-sala' | 'caiu' | 'erro'

export interface RoomState {
  status: RoomStatus
  error?: string
  selfId?: string
  peers: PeerView[]
  me: PeerState
  screen?: MediaStream
  preset: QualityPreset
  micAvailable: boolean
}

const MIC_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true
}

export function useRoom(code: string, name: string) {
  const [state, setState] = useState<RoomState>({
    status: 'conectando',
    peers: [],
    me: { ...INITIAL_STATE },
    preset: DEFAULT_PRESET,
    micAvailable: false
  })
  const signalingRef = useRef<SignalingClient>(undefined)
  const managerRef = useRef<PeerManager>(undefined)
  const micRef = useRef<MediaStream>(undefined)
  const meRef = useRef<PeerState>({ ...INITIAL_STATE })
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

  useEffect(() => {
    let disposed = false
    const signaling = new SignalingClient(code, name)
    signalingRef.current = signaling
    patch({ status: 'conectando', error: undefined, peers: [] })

    void (async () => {
      // microfone é opcional: sem permissão, a pessoa só assiste
      let mic: MediaStream | undefined
      try {
        mic = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS, video: false })
        for (const t of mic.getAudioTracks()) t.enabled = !meRef.current.micMuted
      } catch {
        mic = undefined
      }
      if (disposed) {
        mic?.getTracks().forEach((t) => t.stop())
        return
      }
      micRef.current = mic

      try {
        const welcome = await signaling.connect(() => !disposed && patch({ status: 'aguardando-aprovacao' }))
        if (disposed) return signaling.close()
        const manager = new PeerManager(signaling, welcome.peerId, welcome.iceServers)
        managerRef.current = manager
        manager.onChange(() => !disposed && patch({ peers: manager.views() }))
        manager.setMic(mic)

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
            case 'error':
              console.warn('[signaling]', msg.code, msg.message)
              break
          }
        })
        signaling.onClose((reason) => !disposed && patch({ status: 'caiu', error: reason }))

        signaling.send({ type: 'state', state: meRef.current })
        patch({ status: 'na-sala', selfId: welcome.peerId, micAvailable: !!mic, peers: manager.views() })
      } catch (err) {
        if (!disposed) patch({ status: 'erro', error: err instanceof Error ? err.message : String(err) })
      }
    })()

    return () => {
      disposed = true
      managerRef.current?.dispose()
      managerRef.current = undefined
      signaling.close()
      micRef.current?.getTracks().forEach((t) => t.stop())
      micRef.current = undefined
      meRef.current = { ...meRef.current, sharing: false, screenStreamId: undefined }
      setState((s) => ({ ...s, screen: undefined, me: meRef.current }))
    }
  }, [code, name, attempt, patch])

  const toggleMic = useCallback(() => {
    const muted = !meRef.current.micMuted
    for (const t of micRef.current?.getAudioTracks() ?? []) t.enabled = !muted
    publishState({ micMuted: muted })
  }, [publishState])

  const stopShare = useCallback(() => {
    managerRef.current?.stopScreen()
    publishState({ sharing: false, screenStreamId: undefined })
    patch({ screen: undefined })
  }, [patch, publishState])

  const startShare = useCallback(
    async (sourceId: string, withAudio: boolean, preset: QualityPreset) => {
      await window.janja.selectSource(sourceId, withAudio)
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: preset.width }, height: { ideal: preset.height }, frameRate: { ideal: preset.fps } },
        audio: withAudio
      })
      const video = stream.getVideoTracks()[0]
      if (video) {
        video.contentHint = preset.hint
        video.addEventListener('ended', () => stopShare(), { once: true })
      }
      // anuncia antes das tracks chegarem, para o receptor classificar o áudio da tela
      publishState({ sharing: true, screenStreamId: stream.id })
      managerRef.current?.startScreen(stream, preset)
      patch({ screen: stream, preset })
    },
    [patch, publishState, stopShare]
  )

  const setPreset = useCallback(
    (preset: QualityPreset) => {
      managerRef.current?.setPreset(preset)
      patch({ preset })
    },
    [patch]
  )

  const reconnect = useCallback(() => setAttempt((n) => n + 1), [])

  return { state, toggleMic, startShare, stopShare, setPreset, reconnect }
}
