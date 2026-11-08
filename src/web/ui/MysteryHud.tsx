import '@fontsource-variable/pixelify-sans'
import { tripleText } from '../../shared/games/mystery/cards'
import type { MysteryView } from '../../shared/games/mystery/types'
import { MysteryCardTile } from '../game/mystery/scene/MysteryScene'
import { formatClock } from '../game/helpers'
import { useServerNow } from '../game/useServerNow'
import { Icon } from './icons'
import { VolumeSlider } from './media'

interface Props {
  view: MysteryView
  canManage: boolean
  onPlayAgain: () => void
  onClose: () => void
  onBackToScreens: () => void
  musicOn: boolean
  musicVolume: number
  onMusicOn: (on: boolean) => void
  onMusicVolume: (v: number) => void
}

/** Barra de baixo do Mistério: de quem é a vez, o prazo e, no fim, a solução. */
export function MysteryHud(p: Props) {
  const { view } = p
  const now = useServerNow(view.serverNow, 500)
  const me = view.you?.index ?? null
  const name = (i: number) => (i === me ? 'Você' : view.players[i]?.name ?? 'Alguém')
  const left = view.until !== null ? view.until - now : null
  const out = me !== null && view.players[me].out

  let title: string
  let help: string
  if (view.phase === 'fim') {
    title = 'Mistério resolvido'
    help = view.solution ? `Foi ${tripleText(view.solution)}.` : ''
  } else if (view.phase === 'mostrar' && view.refuter === me) {
    title = 'Mostre uma carta'
    help = `Escolha qual carta mostrar para ${name(view.current?.by ?? 0)}. Só ela vê.`
  } else if (view.turn === me) {
    title = 'Sua vez'
    help = view.phase === 'palpite' ? 'Escolha quem, onde e com o quê e palpite. Ou acuse, se tiver certeza.' : 'Acuse se tiver certeza, ou termine a vez.'
  } else {
    title = `Vez de ${name(view.turn ?? 0)}`
    help = out ? 'Você errou a acusação: agora só mostra cartas.' : (view.log[view.log.length - 1] ?? '')
  }

  return (
    <div className={`poker-hud my-hud ${view.turn === me || view.refuter === me ? 'my-turn' : ''}`}>
      <div className="hud-row">
        <div className="hud-help">
          <strong className="pixel-font">{title}</strong>
          <small className="detail">{help}</small>
        </div>
        {out && view.solution && view.phase !== 'fim' && (
          <span className="my-secret" data-tip="Só você vê">
            Solução: {tripleText(view.solution)}
          </span>
        )}
        <div className="hud-tools">
          {left !== null && view.phase !== 'fim' && <span className={`hud-clock ${left < 8000 ? 'golf-hurry' : ''}`}>{formatClock(left)}</span>}
          <button
            className={`icon-btn ${p.musicOn ? 'on' : ''}`}
            onClick={() => p.onMusicOn(!p.musicOn)}
            data-tip={p.musicOn ? 'Desligar a música' : 'Ligar a música'}
            aria-label="Música"
            aria-pressed={p.musicOn}
          >
            <Icon name="music" size={20} />
          </button>
          {p.musicOn && <VolumeSlider value={p.musicVolume} onChange={p.onMusicVolume} label="Volume da música" />}
          <button className="icon-btn" onClick={p.onBackToScreens} data-tip="Voltar às telas" aria-label="Voltar às telas">
            <Icon name="grid" size={20} />
          </button>
        </div>
      </div>

      {view.phase === 'fim' && view.solution && (
        <div className="modal-backdrop">
          <div className="modal ranking my-end pixel-font" role="dialog" aria-modal="true" aria-label="Mistério resolvido">
            <h2>{view.winner === null ? 'Ninguém resolveu' : view.winner === me ? 'Você resolveu o mistério!' : `${name(view.winner)} resolveu o mistério`}</h2>
            <div className="my-row">
              {[view.solution.quem, view.solution.onde, view.solution.como].map((id) => (
                <MysteryCardTile key={id} id={id} />
              ))}
            </div>
            <p className="muted">Foi {tripleText(view.solution)}.</p>
            <div className="modal-actions">
              <button onClick={p.onBackToScreens}>Voltar às telas</button>
              {p.canManage && (
                <button className="danger" onClick={p.onClose}>
                  Encerrar
                </button>
              )}
              {p.canManage && (
                <button className="primary" onClick={p.onPlayAgain}>
                  Jogar de novo
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
