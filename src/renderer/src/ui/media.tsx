import { useEffect, useRef, type ReactNode, type RefObject } from 'react'

function useSink(ref: RefObject<HTMLMediaElement | null>, sinkId: string) {
  useEffect(() => {
    const el = ref.current
    if (!el?.setSinkId) return
    el.setSinkId(sinkId).catch(() => undefined)
  }, [ref, sinkId])
}

/** Áudio invisível (microfone de um amigo). */
export function RemoteAudio({ stream, volume, sinkId }: { stream: MediaStream; volume: number; sinkId: string }) {
  const ref = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream
  }, [stream])
  useEffect(() => {
    if (ref.current) ref.current.volume = volume
  }, [volume])
  useSink(ref, sinkId)
  return <audio ref={ref} autoPlay />
}

interface TileProps {
  stream: MediaStream
  label: string
  /** a própria tela fica sempre muda localmente */
  local?: boolean
  volume?: number
  sinkId: string
  focused: boolean
  onToggleFocus: () => void
  footer?: ReactNode
}

export function VideoTile({ stream, label, local, volume = 1, sinkId, focused, onToggleFocus, footer }: TileProps) {
  const ref = useRef<HTMLVideoElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream
  }, [stream])
  useEffect(() => {
    if (ref.current) ref.current.volume = volume
  }, [volume])
  useSink(ref, sinkId)

  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void boxRef.current?.requestFullscreen()
  }

  return (
    <div ref={boxRef} className={`tile ${focused ? 'focused' : ''}`} onClick={onToggleFocus} onDoubleClick={fullscreen}>
      <video ref={ref} autoPlay playsInline muted={local} />
      <div className="tile-label">
        <span>{label}</span>
        {footer}
      </div>
    </div>
  )
}
