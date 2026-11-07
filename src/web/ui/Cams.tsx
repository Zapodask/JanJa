import { useEffect, useRef } from 'react'
import { useSpeaking } from '../audio'
import { attachStream } from '../playback'
import { Icon } from './icons'

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

/** Uma webcam: rosto, nome e o mic; a sua aparece espelhada (como num espelho). */
export function CamTile({ item }: { item: CamItem }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    // só a imagem: a voz já toca pelo áudio do mic
    return attachStream(el, item.stream, (s) => new MediaStream(s.getVideoTracks()))
  }, [item.stream])
  const speaking = useSpeaking(item.mic, !item.micMuted && !!item.mic)
  return (
    <figure className={`cam-tile ${item.local ? 'local' : ''} ${speaking ? 'speaking' : ''}`} data-cam-id={item.id}>
      <video ref={ref} autoPlay playsInline muted aria-label={`Câmera de ${item.name}`} />
      <figcaption>
        {item.micMuted && <Icon name="micOff" size={13} />}
        <span>{item.local ? `${item.name} (você)` : item.name}</span>
      </figcaption>
    </figure>
  )
}

/**
 * Webcams da sala. `palco`: ocupam o palco (ninguém compartilha tela); `faixa`: linha acima das telas;
 * `flutuante`: no canto, por cima da mesa de poker.
 */
export function CamStrip({ items, mode }: { items: CamItem[]; mode: 'palco' | 'faixa' | 'flutuante' }) {
  if (!items.length) return null
  return (
    <section className={`cams cams-${mode} n${Math.min(items.length, 6)}`} aria-label="Câmeras" data-tour="cams">
      {items.map((it) => (
        <CamTile key={it.id} item={it} />
      ))}
    </section>
  )
}
