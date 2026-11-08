import '@fontsource-variable/pixelify-sans'
import { useEffect, useState } from 'react'
import { describeResult, type ChessAction, type ChessView } from '../../shared/games/chess/types'
import { formatClock } from '../game/helpers'
import { useServerNow } from '../game/useServerNow'
import { Icon } from './icons'
import { VolumeSlider } from './media'

interface Props {
  view: ChessView
  canManage: boolean
  onAct: (action: ChessAction) => void
  onPlayAgain: () => void
  onClose: () => void
  onBackToScreens: () => void
  musicOn: boolean
  musicVolume: number
  onMusicOn: (on: boolean) => void
  onMusicVolume: (v: number) => void
}

/** lances em pares: "1. e4 e5" */
function MoveList({ view }: { view: ChessView }) {
  const pairs: Array<[number, string, string | undefined]> = []
  for (let i = 0; i < view.moves.length; i += 2) pairs.push([i / 2 + 1, view.moves[i].san, view.moves[i + 1]?.san])
  if (!pairs.length) return <p className="small muted">Nenhum lance ainda.</p>
  return (
    <ol className="chess-moves pixel-font">
      {pairs.map(([n, a, b]) => (
        <li key={n}>
          <span className="chess-move-n">{n}.</span>
          <span>{a}</span>
          <span>{b ?? ''}</span>
        </li>
      ))}
    </ol>
  )
}

/** Barra de baixo do xadrez: de quem é a vez, empate, desistir, lances e fim de partida. */
export function ChessHud(p: Props) {
  const { view } = p
  const now = useServerNow(view.serverNow, 1000)
  const [movesOpen, setMovesOpen] = useState(false)
  const [sure, setSure] = useState(false)
  const me = view.you?.color ?? null
  const name = (c: 'w' | 'b') => (c === 'w' ? view.white.name : view.black.name)
  const playing = !!me && !view.result
  const myTurn = playing && view.turn === me
  const theirOffer = playing && view.drawOffer !== null && view.drawOffer !== me
  const myOffer = playing && view.drawOffer === me
  const rival = me ? (me === 'w' ? view.black : view.white) : null

  useEffect(() => {
    if (!sure) return
    const t = window.setTimeout(() => setSure(false), 4000)
    return () => window.clearTimeout(t)
  }, [sure])

  let help: string
  if (view.result) help = describeResult(view.result, view.white.name, view.black.name)
  else if (!me) help = `Você está assistindo. Vez de ${name(view.turn)} (${view.turn === 'w' ? 'brancas' : 'pretas'}).`
  else if (myTurn) help = view.check ? 'Seu rei está em xeque! Tire ele do ataque.' : 'Sua vez. Arraste a peça ou clique nela e depois na casa.'
  else help = `Vez de ${name(view.turn)}.`
  if (playing && rival?.awayUntil) help += ` ${rival.name} saiu da sala. Se não voltar em ${formatClock(rival.awayUntil - now)}, você vence.`

  const last = view.moves[view.moves.length - 1]
  const n = view.moves.length

  return (
    <div className={`poker-hud chess-hud ${myTurn ? 'my-turn' : ''}`}>
      <div className="sr-only" aria-live="polite">
        {last ? `${view.turn === 'w' ? 'Pretas' : 'Brancas'} jogaram ${last.san}.` : ''}
        {view.check && !view.result ? ' Xeque.' : ''}
      </div>
      <div className="hud-row">
        <div className="hud-help">
          <strong className="pixel-font">
            {view.result ? 'Fim da partida' : n === 0 ? 'Começo da partida' : `Lance ${Math.floor(n / 2) + 1}${last ? ` · último: ${last.san}` : ''}`}
          </strong>
          <small className="detail">{help}</small>
        </div>
        {playing && (
          <div className="hud-actions">
            {theirOffer ? (
              <>
                <span className="hud-note">{rival?.name} ofereceu empate.</span>
                <button className="act primary" onClick={() => p.onAct({ type: 'draw' })}>
                  Aceitar empate
                </button>
                <button className="act" onClick={() => p.onAct({ type: 'decline' })}>
                  Recusar
                </button>
              </>
            ) : (
              <button className="act" disabled={myOffer} onClick={() => p.onAct({ type: 'draw' })}>
                {myOffer ? 'Empate oferecido' : 'Oferecer empate'}
              </button>
            )}
            <button
              className={`act ${sure ? 'danger' : ''}`}
              onClick={() => {
                if (!sure) return setSure(true)
                setSure(false)
                p.onAct({ type: 'resign' })
              }}
            >
              {sure ? 'Confirmar: desistir' : 'Desistir'}
            </button>
          </div>
        )}
        <div className="hud-tools">
          <button
            className={`icon-btn ${movesOpen ? 'on' : ''}`}
            onClick={() => setMovesOpen((o) => !o)}
            data-tip="Lances"
            aria-label="Lances"
            aria-expanded={movesOpen}
          >
            <Icon name="chart" size={20} />
          </button>
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

      {movesOpen && !view.result && (
        <div className="hands-table chess-moves-pop" role="dialog" aria-label="Lances">
          <div className="hands-head">
            <strong className="pixel-font">Lances</strong>
            <button className="icon-btn sm" onClick={() => setMovesOpen(false)} aria-label="Fechar lances">
              <Icon name="x" size={16} />
            </button>
          </div>
          <MoveList view={view} />
        </div>
      )}

      {view.result && (
        <div className="modal-backdrop">
          <div className="modal ranking chess-end pixel-font" role="dialog" aria-modal="true" aria-label="Fim da partida">
            <h2>{view.result.winner === null ? 'Empate' : view.result.winner === me ? 'Você venceu!' : `${name(view.result.winner)} venceu`}</h2>
            <p className="muted">{describeResult(view.result, view.white.name, view.black.name)}</p>
            <MoveList view={view} />
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
