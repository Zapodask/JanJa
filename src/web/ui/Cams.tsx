import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useSpeaking } from '../audio'
import { attachStream } from '../playback'
import { Icon } from './icons'
import { toggleFullscreen } from './media'

export interface CamItem {
  /** id da pessoa ('me' para você) */
  id: string
  name: string
  stream: MediaStream
  /** voz da pessoa: acende a borda quando ela fala */
  mic?: MediaStream
  micMuted: boolean
  local?: boolean
}

/** Liga a imagem da câmera num <video> (só o vídeo: a voz já toca pelo áudio do mic). */
function useCamVideo(stream: MediaStream) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    return attachStream(el, stream, (s) => new MediaStream(s.getVideoTracks()))
  }, [stream])
  return ref
}

const label = (it: CamItem) => (it.local ? `${it.name} (você)` : it.name)

/** Uma webcam: rosto, nome e o mic. Clique maximiza; a sua aparece espelhada. */
export function CamTile({ item, pinned, onPin }: { item: CamItem; pinned: boolean; onPin: (id: string) => void }) {
  const ref = useCamVideo(item.stream)
  const speaking = useSpeaking(item.mic, !item.micMuted && !!item.mic)
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onPin(item.id)
    }
  }
  return (
    <figure
      className={`cam-tile ${item.local ? 'local' : ''} ${speaking ? 'speaking' : ''} ${pinned ? 'pinned' : ''}`}
      data-cam-id={item.id}
      role="button"
      tabIndex={0}
      aria-pressed={pinned}
      aria-label={pinned ? `Diminuir a câmera de ${label(item)}` : `Maximizar a câmera de ${label(item)}`}
      onClick={() => onPin(item.id)}
      onKeyDown={onKey}
    >
      <video ref={ref} autoPlay playsInline muted />
      <span className="cam-hint" aria-hidden="true">
        <Icon name={pinned ? 'shrink' : 'expand'} size={16} />
      </span>
      <figcaption>
        {item.micMuted && <Icon name="micOff" size={13} />}
        <span>{label(item)}</span>
      </figcaption>
    </figure>
  )
}

/**
 * Webcams da sala. `palco`: ocupam o palco (ninguém compartilha tela); `faixa`: linha acima das telas;
 * `flutuante`: no canto, por cima da mesa de poker ou do campo de golfe.
 */
export function CamStrip({
  items,
  mode,
  pinned,
  onPin
}: {
  items: CamItem[]
  mode: 'palco' | 'faixa' | 'flutuante'
  pinned: string | null
  onPin: (id: string) => void
}) {
  if (!items.length) return null
  return (
    <section className={`cams cams-${mode} n${Math.min(items.length, 6)}`} aria-label="Câmeras" data-tour="cams">
      {items.map((it) => (
        <CamTile key={it.id} item={it} pinned={pinned === it.id} onPin={onPin} />
      ))}
    </section>
  )
}

/** A câmera maximizada: grande no palco, por cima do resto. Clique ou Esc fecha; duplo clique, tela cheia. */
export function CamFocus({ item, onClose }: { item: CamItem; onClose: () => void }) {
  const ref = useCamVideo(item.stream)
  const box = useRef<HTMLDivElement>(null)
  const [full, setFull] = useState(false)
  const speaking = useSpeaking(item.mic, !item.micMuted && !!item.mic)
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === box.current)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])
  return (
    <div
      ref={box}
      className={`cam-focus ${item.local ? 'local' : ''} ${speaking ? 'speaking' : ''} ${full ? 'full' : ''}`}
      role="dialog"
      aria-label={`Câmera de ${label(item)}`}
      onDoubleClick={() => toggleFullscreen(box.current)}
    >
      <video ref={ref} autoPlay playsInline muted />
      <div className="cam-focus-name">
        {item.micMuted && <Icon name="micOff" size={15} />}
        <span>{label(item)}</span>
      </div>
      <div className="cam-focus-bar">
        <button
          className="icon-btn"
          onClick={() => toggleFullscreen(box.current)}
          data-tip={full ? 'Sair da tela cheia' : 'Tela cheia'}
          aria-label={full ? 'Sair da tela cheia' : 'Tela cheia'}
        >
          <Icon name={full ? 'shrink' : 'expand'} size={20} />
        </button>
        <button className="icon-btn" onClick={onClose} data-tip="Diminuir (Esc)" aria-label="Diminuir a câmera">
          <Icon name="x" size={20} />
        </button>
      </div>
    </div>
  )
}
