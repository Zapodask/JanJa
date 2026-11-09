import '@fontsource-variable/pixelify-sans'
import type { StopView } from '../../shared/games/stop/types'
import { formatClock } from '../game/helpers'
import { useServerNow } from '../game/useServerNow'
import { Icon } from './icons'
import { VolumeSlider } from './media'

interface Props {
  view: StopView
  canManage: boolean
  onPlayAgain: () => void
  onClose: () => void
  onBackToScreens: () => void
  musicOn: boolean
  musicVolume: number
  onMusicOn: (on: boolean) => void
  onMusicVolume: (v: number) => void
}

const TITLE: Record<StopView['phase'], string> = {
  escrevendo: 'Escrevendo',
  parando: 'STOP!',
  conferindo: 'Conferência',
  placar: 'Placar da rodada',
  fim: 'Fim da partida'
}

/** Barra de baixo do Stop: a fase, o relógio e, no fim, o ranking com os pontos de cada rodada. */
export function StopHud(p: Props) {
  const { view } = p
  const now = useServerNow(view.serverNow, 500)
  const left = view.until !== null ? view.until - now : null
  const me = view.you?.playerId ?? null
  const name = (id: string) => (id === me ? 'Você' : view.players.find((x) => x.playerId === id)?.name ?? 'Alguém')

  let help: string
  switch (view.phase) {
    case 'escrevendo':
      help = `Letra ${view.letter}. Preencha tudo e grite STOP (Enter no último campo).`
      break
    case 'parando':
      help = 'Últimas respostas chegando...'
      break
    case 'conferindo':
      help = 'Confira as respostas. Resposta repetida vale 5, única vale 10.'
      break
    case 'placar':
      help = 'Próxima letra já vem.'
      break
    default:
      help = view.ranking ? `${name(view.ranking[0].playerId)} venceu com ${view.ranking[0].total} pontos.` : ''
  }

  return (
    <div className={`poker-hud sp-hud ${view.phase === 'escrevendo' ? 'my-turn' : ''}`}>
      <div className="hud-row">
        <div className="hud-help">
          <strong className="pixel-font">
            {TITLE[view.phase]} · rodada {view.round} de {view.rounds}
          </strong>
          <small className="detail">{help}</small>
        </div>
        <div className="hud-tools">
          {left !== null && view.phase !== 'fim' && <span className={`hud-clock ${left < 10_000 ? 'golf-hurry' : ''}`}>{formatClock(left)}</span>}
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

      {view.phase === 'fim' && view.ranking && (
        <div className="modal-backdrop">
          <div className="modal ranking pixel-font" role="dialog" aria-modal="true" aria-label="Fim da partida">
            <h2>{view.ranking[0].playerId === me ? 'Você venceu!' : `${name(view.ranking[0].playerId)} venceu`}</h2>
            <ol className="rank-list">
              {view.ranking.map((r) => (
                <li key={r.playerId} className={r.playerId === me ? 'me' : ''}>
                  <span className="rank-place">{r.place}º</span>
                  <span className="rank-name">{name(r.playerId)}</span>
                  <span className="rank-net">{r.total} pontos</span>
                </li>
              ))}
            </ol>
            <p className="muted">Letras: {view.history.map((h) => h.letter).join(', ')}</p>
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
