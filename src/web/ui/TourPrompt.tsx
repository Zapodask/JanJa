import { useEffect, useRef } from 'react'
import { setPrefs } from '../storage'
import { Jan } from './Pixel'
import { TOUR_VERSION } from './tourLogic'

interface Props {
  /** respondeu sim: a tela que mostrou a pergunta começa o tour dela */
  onYes: () => void
  onClose: () => void
}

/** Pergunta da primeira visita. A resposta vale para o tour da Home e o da sala. */
export function TourPrompt({ onYes, onClose }: Props) {
  const yesRef = useRef<HTMLButtonElement>(null)

  const no = () => {
    setPrefs({ tourAnswer: 'no', tourDone: TOUR_VERSION, homeTourDone: TOUR_VERSION })
    onClose()
  }
  const yes = () => {
    setPrefs({ tourAnswer: 'yes' })
    onClose()
    onYes()
  }

  useEffect(() => {
    yesRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        no()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="modal-backdrop">
      <div className="modal tour-prompt" role="dialog" aria-modal="true" aria-labelledby="tour-prompt-title" aria-describedby="tour-prompt-text">
        <div className="tour-prompt-jan" aria-hidden="true">
          <Jan pose="wave" size={96} />
        </div>
        <h2 id="tour-prompt-title">Primeira vez no JanJa?</h2>
        <p id="tour-prompt-text" className="muted">
          Um tour rápido mostra onde fica cada coisa: convidar amigos, compartilhar a tela com som e até controlar o PC
          de um amigo. Leva um minuto.
        </p>
        <div className="modal-actions">
          <button type="button" onClick={no}>
            Agora não
          </button>
          <button type="button" className="primary" ref={yesRef} onClick={yes}>
            Fazer o tour
          </button>
        </div>
        <p className="tour-prompt-hint">Dá para ver depois no botão ? da sala.</p>
      </div>
    </div>
  )
}
