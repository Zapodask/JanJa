import '@fontsource-variable/pixelify-sans'
import { useEffect, useState, type ReactNode } from 'react'
import type { DuelAction, DuelView, Side } from '../../shared/games/duel'
import { formatClock } from '../game/helpers'
import { useServerNow } from '../game/useServerNow'
import { Icon } from './icons'
import { VolumeSlider } from './media'

export interface DuelHudCommon {
  canManage: boolean
  onPlayAgain: () => void
  onClose: () => void
  onBackToScreens: () => void
  musicOn: boolean
  musicVolume: number
  onMusicOn: (on: boolean) => void
  onMusicVolume: (v: number) => void
}

interface Props extends DuelHudCommon {
  view: DuelView & { you: { color: Side } | null; turn: Side }
  /** linha de cima (lance atual, último lance) */
  title: string
  /** o que fazer na sua vez (o jogo explica as regras dele) */
  yourTurn: string
  /** frase do fim da partida */
  resultText: string | null
  /** lista de lances (no painel e no fim) */
  moves: ReactNode
  /** aviso para leitor de tela quando entra um lance */
  live: string
  onAct: (action: DuelAction) => void
}

/** Barra de baixo dos jogos de tabuleiro para dois: vez, empate, desistir, lances e fim de partida. */
export function DuelHud(p: Props) {
  const { view } = p
  const now = useServerNow(view.serverNow, 1000)
  const [movesOpen, setMovesOpen] = useState(false)
  const [sure, setSure] = useState(false)
  const me = view.you?.color ?? null
  const name = (c: Side) => (c === 'w' ? view.white.name : view.black.name)
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
  if (view.result) help = p.resultText ?? 'Fim da partida.'
  else if (!me) help = `Você está assistindo. Vez de ${name(view.turn)} (${view.turn === 'w' ? 'brancas' : 'pretas'}).`
  else if (myTurn) help = p.yourTurn
  else help = `Vez de ${name(view.turn)}.`
  if (playing && rival?.awayUntil) help += ` ${rival.name} saiu da sala. Se não voltar em ${formatClock(rival.awayUntil - now)}, você vence.`

  return (
    <div className={`poker-hud chess-hud ${myTurn ? 'my-turn' : ''}`}>
      <div className="sr-only" aria-live="polite">
        {p.live}
      </div>
      <div className="hud-row">
        <div className="hud-help">
          <strong className="pixel-font">{view.result ? 'Fim da partida' : p.title}</strong>
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
          {p.moves}
        </div>
      )}

      {view.result && (
        <div className="modal-backdrop">
          <div className="modal ranking chess-end pixel-font" role="dialog" aria-modal="true" aria-label="Fim da partida">
            <h2>{view.result.winner === null ? 'Empate' : view.result.winner === me ? 'Você venceu!' : `${name(view.result.winner)} venceu`}</h2>
            <p className="muted">{p.resultText}</p>
            {p.moves}
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

/** lances em pares: "1. e4 e5" */
export function MoveList({ moves }: { moves: string[] }) {
  const pairs: Array<[number, string, string | undefined]> = []
  for (let i = 0; i < moves.length; i += 2) pairs.push([i / 2 + 1, moves[i], moves[i + 1]])
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
