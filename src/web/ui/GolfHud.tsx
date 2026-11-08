import '@fontsource-variable/pixelify-sans'
import { useEffect, useRef, useState } from 'react'
import { mapById } from '../../shared/games/golf/maps'
import type { GolfView } from '../../shared/games/golf/types'
import { formatClock } from '../game/helpers'
import { Icon } from './icons'
import { VolumeSlider } from './media'

interface Props {
  view: GolfView
  me: string | null
  colors: Record<string, string>
  canManage: boolean
  onPlayAgain: () => void
  onClose: () => void
  onBackToScreens: () => void
  musicOn: boolean
  musicVolume: number
  onMusicOn: (on: boolean) => void
  onMusicVolume: (v: number) => void
}

/** relógio do servidor estimado aqui (a visão traz `serverNow`) */
function useServerNow(view: GolfView): number {
  const offset = useRef(0)
  const lastServerNow = useRef(0)
  if (view.serverNow !== lastServerNow.current) {
    lastServerNow.current = view.serverNow
    offset.current = view.serverNow - Date.now()
  }
  const [now, setNow] = useState(() => Date.now() + offset.current)
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now() + offset.current), 500)
    return () => window.clearInterval(t)
  }, [])
  return now
}

/** "+2", "-1", "par" em relação ao par acumulado */
function relative(total: number, parSum: number): string {
  const d = total - parSum
  return d === 0 ? 'no par' : d > 0 ? `+${d}` : String(d)
}

function Scorecard({ view, me, colors }: { view: GolfView; me: string | null; colors: Record<string, string> }) {
  const map = mapById(view.mapId)
  const holes = map?.holes ?? []
  const played = Math.max(...view.players.map((p) => p.scores.length), 0)
  return (
    <div className="golf-card-wrap">
      <table className="golf-card">
        <thead>
          <tr>
            <th scope="col">Buraco</th>
            {holes.map((_, i) => (
              <th key={i} scope="col" className={i === view.hole ? 'cur' : ''}>
                {i + 1}
              </th>
            ))}
            <th scope="col">Total</th>
          </tr>
          <tr className="par">
            <th scope="row">Par</th>
            {holes.map((h, i) => (
              <td key={i}>{h.par}</td>
            ))}
            <td>{holes.reduce((a, h) => a + h.par, 0)}</td>
          </tr>
        </thead>
        <tbody>
          {view.players.map((p) => {
            const parSum = holes.slice(0, p.scores.length).reduce((a, h) => a + h.par, 0)
            return (
              <tr key={p.playerId} className={p.playerId === me ? 'me' : ''}>
                <th scope="row">
                  <i className="golf-dot" style={{ background: colors[p.playerId] }} aria-hidden="true" />
                  {p.name}
                </th>
                {holes.map((h, i) => {
                  const s = p.scores[i]
                  const tone = s === undefined ? '' : s < h.par ? 'under' : s > h.par ? 'over' : ''
                  return (
                    <td key={i} className={tone}>
                      {s ?? (i < played ? '' : '·')}
                    </td>
                  )
                })}
                <td className="tot">
                  {p.total} <small>{p.scores.length ? relative(p.total, parSum) : ''}</small>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Barra de baixo do golfe: buraco, tacadas, tempo, placar e fim de partida. */
export function GolfHud(p: Props) {
  const { view, me } = p
  const now = useServerNow(view)
  const [cardOpen, setCardOpen] = useState(false)
  const map = mapById(view.mapId)
  const hole = map?.holes[view.hole]
  const mine = view.players.find((x) => x.playerId === me)
  const left = view.until !== null ? view.until - now : null

  let help: string
  if (view.phase === 'intervalo') help = `Próximo buraco em ${Math.max(0, Math.ceil((left ?? 0) / 1000))} s.`
  else if (!mine) help = 'Você está assistindo.'
  else if (mine.done && mine.strokes >= view.cap && !view.balls.some((b) => b.playerId === me && b.mode === 'cup'))
    help = `Limite de ${view.cap} tacadas. Espere os outros terminarem.`
  else if (mine.done) help = `Acertou com ${mine.strokes} ${mine.strokes === 1 ? 'tacada' : 'tacadas'}! Espere os outros terminarem.`
  else help = 'Arraste da bola para trás e solte para tacar. No teclado: setas miram e Espaço segura a força. V mostra o buraco todo.'

  const waiting = view.players.filter((x) => !x.done && !x.away).length

  return (
    <div className="poker-hud golf-hud">
      <div className="sr-only" aria-live="polite">
        {view.phase === 'jogando' ? `Buraco ${view.hole + 1}, par ${view.par}.` : ''}
      </div>
      <div className="hud-row">
        <div className="hud-help">
          <strong className="pixel-font">
            Buraco {view.hole + 1} de {view.holeCount}
            {hole ? `: ${hole.name}` : ''} · par {view.par}
          </strong>
          <small className="detail">{help}</small>
        </div>
        {mine && view.phase === 'jogando' && (
          <div className="golf-strokes pixel-font" aria-label={`${mine.strokes} tacadas de no máximo ${view.cap}`}>
            <span className="golf-big">{mine.strokes}</span>
            <small>
              {mine.strokes === 1 ? 'tacada' : 'tacadas'}
              <br />
              limite {view.cap}
            </small>
          </div>
        )}
        <div className="hud-tools">
          {view.phase === 'jogando' && left !== null && (
            <span className={`hud-clock ${left < 15_000 ? 'golf-hurry' : ''}`}>
              {formatClock(left)}
              {waiting > 0 ? ` · ${waiting} jogando` : ''}
            </span>
          )}
          <button
            className={`icon-btn ${cardOpen ? 'on' : ''}`}
            onClick={() => setCardOpen((o) => !o)}
            data-tip="Placar"
            aria-label="Placar"
            aria-expanded={cardOpen}
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

      {(cardOpen || view.phase === 'intervalo') && view.phase !== 'fim' && (
        <div className="golf-card-pop pixel-font" role="dialog" aria-label="Placar">
          <div className="hands-head">
            <strong>{view.phase === 'intervalo' ? `Fim do buraco ${view.hole + 1}` : `Placar: ${view.mapName}`}</strong>
            {cardOpen && (
              <button className="icon-btn sm" onClick={() => setCardOpen(false)} aria-label="Fechar placar">
                <Icon name="x" size={16} />
              </button>
            )}
          </div>
          <Scorecard view={view} me={me} colors={p.colors} />
        </div>
      )}

      {view.phase === 'fim' && view.ranking && (
        <div className="modal-backdrop">
          <div className="modal ranking golf-ranking pixel-font" role="dialog" aria-modal="true" aria-label="Fim da partida">
            <h2>Fim da partida</h2>
            <ol className="rank-list">
              {view.ranking.map((r) => {
                const pl = view.players.find((x) => x.playerId === r.playerId)
                return (
                  <li key={r.playerId} className={r.playerId === me ? 'me' : ''}>
                    <span className="rank-place">{r.place}º</span>
                    <span className="rank-name">{pl?.name ?? 'Jogador'}</span>
                    <span className="rank-net">{r.total} tacadas</span>
                  </li>
                )
              })}
            </ol>
            <Scorecard view={view} me={me} colors={p.colors} />
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
