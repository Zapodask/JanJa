import '@fontsource-variable/pixelify-sans'
import type { NavalView } from '../../shared/games/naval/types'
import { formatClock } from '../game/helpers'
import { useServerNow } from '../game/useServerNow'
import { Icon } from './icons'
import { VolumeSlider } from './media'

interface Props {
  view: NavalView
  canManage: boolean
  onPlayAgain: () => void
  onClose: () => void
  onBackToScreens: () => void
  musicOn: boolean
  musicVolume: number
  onMusicOn: (on: boolean) => void
  onMusicVolume: (v: number) => void
}

/** Barra de baixo da batalha naval: de quem é a vez, navios de pé, prazo e o fim. */
export function NavalHud(p: Props) {
  const { view } = p
  const now = useServerNow(view.serverNow, 500)
  const me = view.you?.index ?? null
  const them = me === null ? null : 1 - me
  const name = (i: number) => view.players[i]?.name ?? 'Alguém'
  const left = view.until !== null ? view.until - now : null
  const last = view.log[view.log.length - 1] ?? ''

  let title: string
  let help: string
  if (view.phase === 'posicionar') {
    const mine = me !== null && view.players[me].ready
    title = 'Posicionem as frotas'
    help =
      me === null
        ? 'Esperando as frotas.'
        : mine
          ? `Pronto! Esperando ${name(them as number)}. Ainda dá para mudar.`
          : 'Escolha um navio, clique no mar para colocar e R para girar. Ou use Aleatório.'
  } else if (view.phase === 'fim') {
    title = 'Fim da partida'
    help = view.winner === me ? 'Você afundou a frota toda!' : `${name(view.winner as number)} afundou a frota toda.`
  } else if (view.turn === me) {
    title = 'Sua vez'
    help = view.shots > 1 ? `Escolha ${view.shots} casas no mar de ${name(them as number)} e dispare.` : `Clique numa casa no mar de ${name(them as number)}. Acertou, joga de novo.`
  } else {
    title = `Vez de ${name(view.turn as number)}`
    help = last
  }

  return (
    <div className={`poker-hud nv-hud ${view.phase === 'batalha' && view.turn === me ? 'my-turn' : ''}`}>
      <div className="hud-row">
        <div className="hud-help">
          <strong className="pixel-font">{title}</strong>
          <small className="detail">{help}</small>
        </div>
        {view.phase !== 'posicionar' && (
          <div className="nv-afloat pixel-font" aria-label="Navios de pé">
            {view.players.map((pl, i) => (
              <span key={pl.playerId} className={i === me ? 'me' : ''}>
                {i === me ? 'Você' : pl.name}: <b>{view.seas[i].afloat}</b>
              </span>
            ))}
          </div>
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

      {view.phase === 'fim' && view.winner !== null && (
        <div className="nv-end pixel-font" role="status">
          <strong>{view.winner === me ? 'Você venceu!' : `${name(view.winner)} venceu`}</strong>
          <span>As duas frotas estão à mostra.</span>
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
      )}
    </div>
  )
}
