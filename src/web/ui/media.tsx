import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent, type RefObject } from 'react'
import { Avatar } from './Avatar'
import { Icon } from './icons'

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

/** Entra ou sai da tela cheia do elemento dado. */
export function toggleFullscreen(el: HTMLElement | null | undefined) {
  if (!el) return
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
  else void el.requestFullscreen?.().catch(() => undefined)
}

/** Slider de volume com botão de mudo e preenchimento. */
export function VolumeSlider({
  value,
  onChange,
  label
}: {
  value: number
  onChange: (v: number) => void
  label: string
}) {
  const before = useRef(1)
  const toggleMute = () => {
    if (value > 0) {
      before.current = value
      onChange(0)
    } else onChange(before.current || 1)
  }
  return (
    <span className="vol" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <button type="button" className="icon-btn sm" onClick={toggleMute} title={value > 0 ? 'Silenciar' : 'Reativar som'} aria-label={`Silenciar ${label}`}>
        <Icon name={value > 0 ? 'volume' : 'volume0'} size={16} />
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        style={{ '--val': `${value * 100}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
        title={label}
        aria-label={label}
      />
    </span>
  )
}

interface TileProps {
  id: string
  stream: MediaStream
  label: string
  /** a própria tela fica sempre muda localmente */
  local?: boolean
  volume?: number
  onVolume?: (v: number) => void
  sinkId: string
  focused: boolean
  /** outra tela está em foco: esta vira miniatura */
  thumb: boolean
  onFocus: () => void
  onToggleFocus: () => void
  /** texto de rota/bitrate (só com estatísticas ligadas) */
  badge?: string
  index: number
}

const IDLE_MS = 2500

export function VideoTile({
  id,
  stream,
  label,
  local,
  volume = 1,
  onVolume,
  sinkId,
  focused,
  thumb,
  onFocus,
  onToggleFocus,
  badge,
  index
}: TileProps) {
  const ref = useRef<HTMLVideoElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [full, setFull] = useState(false)
  const [idle, setIdle] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream
  }, [stream])
  useEffect(() => {
    if (ref.current) ref.current.volume = volume
  }, [volume])
  useSink(ref, sinkId)

  // acompanha a tela cheia deste tile
  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === boxRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // em tela cheia, esconde a barra e o cursor depois de um tempo parado
  const wake = useCallback(() => {
    setIdle(false)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setIdle(true), IDLE_MS)
  }, [])
  useEffect(() => {
    if (full) wake()
    else {
      window.clearTimeout(timer.current)
      setIdle(false)
    }
    return () => window.clearTimeout(timer.current)
  }, [full, wake])

  const stop = (e: MouseEvent) => e.stopPropagation()

  return (
    <div
      ref={boxRef}
      data-tile-id={id}
      tabIndex={0}
      className={`tile ${focused ? 'focused' : ''} ${thumb ? 'thumb' : ''} ${full ? 'full' : ''} ${idle ? 'idle' : ''}`}
      style={{ '--i': index } as CSSProperties}
      onClick={() => {
        if (!focused) onFocus()
      }}
      onDoubleClick={() => toggleFullscreen(boxRef.current)}
      onMouseMove={full ? wake : undefined}
      aria-label={`Tela de ${label}`}
    >
      <video ref={ref} autoPlay playsInline muted={local} />
      <div className="tile-glow" aria-hidden="true" />

      <div className="tile-top" onClick={stop} onDoubleClick={stop}>
        <span className="live">
          <i /> ao vivo
        </span>
        <span className="tile-name">
          <Avatar name={label.replace(/\s*\(você\)$/, '')} size={22} />
          {label}
        </span>
        {badge && <span className="badge">{badge}</span>}
      </div>

      <div className="tile-bar" onClick={stop} onDoubleClick={stop}>
        {!local && onVolume ? <VolumeSlider value={volume} onChange={onVolume} label={`Volume da tela de ${label}`} /> : <span />}
        <span className="tile-actions">
          {!thumb && (
            <button
              type="button"
              className="icon-btn sm"
              onClick={onToggleFocus}
              title={focused ? 'Voltar para a grade (Esc)' : 'Colocar em foco'}
              aria-label={focused ? 'Voltar para a grade' : 'Colocar em foco'}
            >
              <Icon name={focused ? 'grid' : 'focus'} size={16} />
            </button>
          )}
          <button
            type="button"
            className="icon-btn sm"
            onClick={() => toggleFullscreen(boxRef.current)}
            title={full ? 'Sair da tela cheia (F)' : 'Tela cheia (F)'}
            aria-label={full ? 'Sair da tela cheia' : 'Tela cheia'}
          >
            <Icon name={full ? 'shrink' : 'expand'} size={16} />
          </button>
        </span>
      </div>
    </div>
  )
}
