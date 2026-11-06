import { attachStream } from '../playback'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent, type RefObject } from 'react'
import type { InputMsg } from '../../shared/control'
import { useControlCapture } from '../control/useCapture'
import { Icon } from './icons'

function useSink(ref: RefObject<HTMLMediaElement | null>, sinkId: string) {
  useEffect(() => {
    const el = ref.current
    if (!el?.setSinkId) return
    el.setSinkId(sinkId).catch(() => undefined)
  }, [ref, sinkId])
}

/** Áudio invisível (microfone de um amigo). */
export function RemoteAudio({
  stream,
  volume,
  sinkId,
  audioOnly
}: {
  stream: MediaStream
  volume: number
  sinkId: string
  /** só as trilhas de áudio (som da tela: a imagem vai num <video> mudo separado) */
  audioOnly?: boolean
}) {
  const ref = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    return attachStream(el, stream, audioOnly ? (s) => new MediaStream(s.getAudioTracks()) : undefined)
  }, [stream, audioOnly])
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
      <button type="button" className="icon-btn sm" onClick={toggleMute} data-tip={value > 0 ? 'Silenciar' : 'Reativar som'} aria-label={`Silenciar ${label}`}>
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

/** Controle remoto sobre esta TV (só tiles de outras pessoas). */
export interface TileControl {
  state: 'idle' | 'pending' | 'active'
  /** mostra o botão "Pedir controle" (nenhum outro pedido em andamento) */
  canRequest: boolean
  onRequest: () => void
  /** cancela o pedido ou solta o controle */
  onRelease: () => void
  onInput: (msg: InputMsg) => void
}

interface TileProps {
  id: string
  stream: MediaStream
  /** apelido de quem compartilha */
  name: string
  /** a própria tela fica sempre muda localmente */
  local?: boolean
  volume?: number
  onVolume?: (v: number) => void
  sinkId: string
  /** outra tela está em foco: esta vira miniatura */
  /** a tela parou: roda a animação de TV desligando antes de sair */
  leaving?: boolean
  /** texto de rota/bitrate (só com estatísticas ligadas) */
  badge?: string
  control?: TileControl
}

const IDLE_MS = 2500

export function VideoTile({
  id,
  stream,
  name,
  local,
  volume = 1,
  onVolume,
  sinkId,
  leaving,
  badge,
  control
}: TileProps) {
  const ref = useRef<HTMLVideoElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [full, setFull] = useState(false)
  const [idle, setIdle] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  // imagem: sempre muda (autoplay nunca é bloqueado) e religa quando chegam trilhas novas
  useEffect(() => {
    const el = ref.current
    if (!el) return
    return attachStream(el, stream, (s) => new MediaStream(s.getVideoTracks()))
  }, [stream])

  const controlState = control?.state ?? 'idle'
  const controlling = controlState === 'active'
  useControlCapture({
    active: controlling,
    boxRef,
    videoRef: ref,
    onInput: (m) => control?.onInput(m),
    onRelease: () => control?.onRelease()
  })

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
  const who = local ? 'Você está compartilhando' : `${name} está compartilhando`

  return (
    <figure className={`cell ${leaving ? 'leaving' : ''}`}>
      <div
        ref={boxRef}
        data-tile-id={id}
        tabIndex={leaving ? -1 : 0}
        className={`tile ${full ? 'full' : ''} ${idle ? 'idle' : ''} ${controlling ? 'controlling' : ''}`}
        onDoubleClick={() => {
          if (!controlling) toggleFullscreen(boxRef.current)
        }}
        onMouseMove={full ? wake : undefined}
        aria-label={`Tela de ${name}`}
      >
        <video ref={ref} autoPlay playsInline muted />
        {/* som da tela num elemento próprio: se o navegador bloquear o som, a imagem continua */}
        {!local && <RemoteAudio stream={stream} volume={volume} sinkId={sinkId} audioOnly />}
        <span className="tile-name">{local ? `${name} (você)` : name}</span>

        {control && controlState !== 'idle' && (
          <div className="control-tag" onClick={stop} onDoubleClick={stop} role="status">
            <span>{controlling ? 'Você está controlando. Esc Esc para soltar' : `Esperando ${name}…`}</span>
            <button type="button" className="sm" onClick={control.onRelease}>
              {controlling ? 'Soltar' : 'Cancelar'}
            </button>
          </div>
        )}

        <div className="tile-bar" onClick={stop} onDoubleClick={stop}>
          {!local && control && controlState === 'idle' && control.canRequest && (
            <button
              type="button"
              className="icon-btn sm"
              onClick={control.onRequest}
              data-tip={`Pedir controle do PC de ${name}`}
              aria-label={`Pedir controle do PC de ${name}`}
            >
              <Icon name="mouse" size={16} />
            </button>
          )}
          {!local && onVolume && <VolumeSlider value={volume} onChange={onVolume} label={`Volume da tela de ${name}`} />}
          <button
            type="button"
            className="icon-btn sm"
            onClick={() => toggleFullscreen(boxRef.current)}
            data-tip={full ? 'Sair da tela cheia (F)' : 'Tela cheia (F)'}
            aria-label={full ? 'Sair da tela cheia' : 'Tela cheia'}
          >
            <Icon name={full ? 'shrink' : 'expand'} size={16} />
          </button>
        </div>
        <div className="tv-flash" aria-hidden="true" />
      </div>
      <figcaption className="caption">
        <span className="onair">
          <i /> ao vivo
        </span>
        <span className="caption-text">{who}</span>
        {badge && <span className="stats">{badge}</span>}
      </figcaption>
    </figure>
  )
}
