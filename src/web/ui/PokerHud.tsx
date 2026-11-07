import '@fontsource-variable/pixelify-sans'
import { useEffect, useState } from 'react'
import type { PokerAction, PokerView } from '../../shared/games/poker/types'
import { actionButtons, describeForScreenReader, formatClock, handsTable } from '../game/helpers'
import { Icon } from './icons'
import { VolumeSlider } from './media'

interface Props {
  view: PokerView
  me: string | null
  canManage: boolean
  onAct: (a: PokerAction) => void
  onPlayAgain: () => void
  onCloseTable: () => void
  onBackToScreens: () => void
  musicOn: boolean
  musicVolume: number
  onMusicOn: (on: boolean) => void
  onMusicVolume: (v: number) => void
  handsOpen: boolean
  onHands: (open: boolean) => void
}

function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), everyMs)
    return () => window.clearInterval(t)
  }, [everyMs])
  return now
}

const signed = (n: number): string => (n > 0 ? `+${n}` : String(n))

/** Barra de baixo da mesa: ajuda ao vivo, botões da minha vez, relógio, tabela de mãos e fim de partida. */
export function PokerHud(p: Props) {
  const { view, me } = p
  const now = useNow(1000)
  const mine = view.seats.find((s) => s.playerId === me)
  const myTurn = !!me && view.toAct === me && view.legal.length > 0
  const buttons = myTurn ? actionButtons(view.legal) : []
  const turnName = view.seats.find((s) => s.playerId === view.toAct)?.name
  const secs = view.actDeadline ? Math.max(0, Math.ceil((view.actDeadline - now) / 1000)) : null
  const clock =
    view.endsAt === null
      ? 'Sem limite de tempo'
      : now >= view.endsAt && view.phase !== 'fim'
        ? 'Última mão'
        : `Tempo ${formatClock(view.endsAt - now)}`
  const over = view.phase === 'fim' && view.ranking

  let help: string
  if (!view.you) help = 'Você está assistindo.'
  else if (mine && (mine.status === 'desistiu' || mine.status === 'fora')) help = 'Você desistiu desta mão.'
  else if (view.you.best) help = `Você tem: ${view.you.best.name}`
  else help = view.you.hand.length ? 'Aguardando as cartas da mesa.' : 'Aguardando a próxima mão.'

  return (
    <div className={`poker-hud ${myTurn ? 'my-turn' : ''}`}>
      <div className="sr-only" aria-live="polite">
        {describeForScreenReader(view, me)}
      </div>

      {view.showdown && (view.phase === 'showdown' || view.phase === 'intervalo') && (
        <p className="hud-note pixel-font">{view.showdown.explanation}</p>
      )}

      <div className="hud-row">
        <div className="hud-help">
          <strong>{help}</strong>
          {view.you && view.you.draws.length > 0 && <small>{view.you.draws.join(', ')}</small>}
          {mine && (
            <small className="detail">
              Fichas {mine.stack}, {signed(mine.net)} no total
            </small>
          )}
        </div>

        <div className="hud-actions" role="group" aria-label={myTurn ? 'Sua vez' : 'Ações'}>
          {myTurn ? (
            buttons.map((b, i) => (
              <button
                key={b.action.kind}
                className={`act ${b.tone === 'primary' ? 'primary' : b.tone === 'danger' ? 'danger' : ''}`}
                style={{ animationDelay: `${i * 40}ms` }}
                onClick={() => p.onAct(b.action)}
              >
                {b.label}
                {b.key && <kbd>{b.key}</kbd>}
              </button>
            ))
          ) : (
            <span className="hud-wait">
              {turnName ? `Vez de ${turnName}${secs !== null ? `, ${secs} s` : ''}` : view.phase === 'fim' ? 'Partida encerrada' : 'Esperando a próxima mão'}
            </span>
          )}
          {myTurn && secs !== null && <span className="hud-timer">{secs} s</span>}
        </div>

        <div className="hud-tools">
          <span className="hud-clock">{clock}</span>
          <button
            className={`icon-btn ${p.musicOn ? 'on' : ''}`}
            onClick={() => p.onMusicOn(!p.musicOn)}
            data-tip={p.musicOn ? 'Desligar a música' : 'Ligar a música'}
            aria-label="Música da mesa"
            aria-pressed={p.musicOn}
          >
            <Icon name="music" size={20} />
          </button>
          {p.musicOn && <VolumeSlider value={p.musicVolume} onChange={p.onMusicVolume} label="Volume da música" />}
          <button
            className={`icon-btn ${p.handsOpen ? 'on' : ''}`}
            onClick={() => p.onHands(!p.handsOpen)}
            data-tip="Tabela de mãos (H)"
            aria-label="Tabela de mãos"
            aria-expanded={p.handsOpen}
          >
            <Icon name="help" size={20} />
          </button>
          <button className="icon-btn" onClick={p.onBackToScreens} data-tip="Voltar às telas" aria-label="Voltar às telas">
            <Icon name="grid" size={20} />
          </button>
        </div>
      </div>

      {p.handsOpen && (
        <div className="hands-table pixel-font" role="dialog" aria-label="Tabela de mãos">
          <div className="hands-head">
            <strong>Da mais forte para a mais fraca</strong>
            <button className="icon-btn sm" onClick={() => p.onHands(false)} aria-label="Fechar tabela">
              <Icon name="x" size={16} />
            </button>
          </div>
          <ol>
            {handsTable(view.mode).map((h) => (
              <li key={h.name}>
                <span className="hand-name">{h.name}</span>
                <span className="hand-ex">{h.example}</span>
                <span className="hand-hint">{h.hint}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {over && (
        <div className="modal-backdrop">
          <div className="modal ranking pixel-font" role="dialog" aria-modal="true" aria-label="Fim da partida">
            <h2>Fim da partida</h2>
            <ol className="rank-list">
              {view.ranking!.map((r) => (
                <li key={r.playerId} className={r.playerId === me ? 'me' : ''}>
                  <span className="rank-place">{r.place}º</span>
                  <span className="rank-name">{r.name}</span>
                  <span className="rank-net">{signed(r.net)}</span>
                  {r.rebuys > 0 && <small className="detail">{r.rebuys === 1 ? 'recomprou 1 vez' : `recomprou ${r.rebuys} vezes`}</small>}
                </li>
              ))}
            </ol>
            <div className="modal-actions">
              <button onClick={p.onBackToScreens}>Voltar às telas</button>
              {p.canManage && <button className="danger" onClick={p.onCloseTable}>Fechar mesa</button>}
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
