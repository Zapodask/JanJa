import '@fontsource-variable/pixelify-sans'
import { ballsOf } from '../../shared/games/pool/rules'
import type { PoolView } from '../../shared/games/pool/types'
import { ballFill, ballGrid } from '../game/pool/scene/sprites'
import { formatClock } from '../game/helpers'
import { useServerNow } from '../game/useServerNow'
import { Icon } from './icons'
import { VolumeSlider } from './media'

interface Props {
  view: PoolView
  canManage: boolean
  onPlayAgain: () => void
  onClose: () => void
  onBackToScreens: () => void
  musicOn: boolean
  musicVolume: number
  onMusicOn: (on: boolean) => void
  onMusicVolume: (v: number) => void
}

function Ball({ id, dim }: { id: number; dim?: boolean }) {
  return (
    <svg viewBox="0 0 9 9" width={16} height={16} shapeRendering="crispEdges" aria-hidden="true" style={{ opacity: dim ? 0.25 : 1 }}>
      {ballGrid(id).flatMap((row, y) => [...row].map((ch, x) => (ch === '.' ? null : <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={ballFill(id, ch)} />)))}
    </svg>
  )
}

/** Barra de baixo da sinuca: de quem é a vez, o grupo de cada um, falta, prazo e o fim. */
export function PoolHud(p: Props) {
  const { view } = p
  const now = useServerNow(view.serverNow, 500)
  const me = view.you?.index ?? null
  const name = (i: number) => (i === me ? 'Você' : view.players[i]?.name ?? 'Alguém')
  const left = view.until !== null ? view.until - now : null
  const myTurn = me !== null && view.turn === me
  const onTable = new Set(view.balls.filter((b) => !b.in).map((b) => b.id))

  let help: string
  if (view.winner !== null) help = view.log[view.log.length - 1] ?? ''
  else if (myTurn) {
    help = view.behindLine
      ? 'Quebra: clique atrás da linha para pôr a branca, mire e segure para dar força.'
      : view.ballInHand
        ? 'Bola na mão: clique onde a branca vai ficar, mire e tacada.'
        : view.onEight
          ? 'Agora é a 8: escolha a caçapa e mate a 8 nela.'
          : 'Mire com o mouse (ou setas), segure o clique (ou Espaço) para dar força e solte.'
  } else help = view.result ?? `Vez de ${name(view.turn ?? 0)}.`

  return (
    <div className={`poker-hud pl-hud ${myTurn ? 'my-turn' : ''}`}>
      <div className="hud-row">
        <div className="hud-help">
          <strong className="pixel-font">{view.winner !== null ? 'Fim da partida' : myTurn ? 'Sua vez' : `Vez de ${name(view.turn ?? 0)}`}</strong>
          <small className="detail">
            {view.foul && !myTurn && view.winner === null ? `Falta! ${view.foul} ` : ''}
            {help}
          </small>
        </div>
        <div className="pl-players">
          {view.players.map((pl, i) => (
            <div key={pl.playerId} className={`pl-player ${view.turn === i ? 'turn' : ''}`}>
              <span>
                {name(i)}
                <small>{pl.group ? ` · ${pl.group}` : ' · mesa aberta'}</small>
              </span>
              {pl.group && (
                <span className="pl-balls" aria-label={`${pl.left} bolas na mesa`}>
                  {ballsOf(pl.group).map((id) => (
                    <Ball key={id} id={id} dim={!onTable.has(id)} />
                  ))}
                  {pl.left === 0 && <Ball id={8} />}
                </span>
              )}
            </div>
          ))}
        </div>
        <div className="hud-tools">
          {left !== null && view.winner === null && <span className={`hud-clock ${left < 10_000 ? 'golf-hurry' : ''}`}>{formatClock(left)}</span>}
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

      {view.winner !== null && (
        <div className="modal-backdrop">
          <div className="modal ranking pixel-font" role="dialog" aria-modal="true" aria-label="Fim da partida">
            <h2>{view.winner === me ? 'Você venceu!' : `${name(view.winner)} venceu`}</h2>
            <p className="muted">{view.log[view.log.length - 1]}</p>
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
