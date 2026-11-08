import '@fontsource-variable/pixelify-sans'
import { useEffect, useRef, useState } from 'react'
import { envidoName, trucoName, type TrucoIntent, type TrucoView } from '../../shared/games/truco/types'
import { formatClock } from '../game/helpers'
import { useServerNow } from '../game/useServerNow'
import { Icon } from './icons'
import { VolumeSlider } from './media'

interface Props {
  view: TrucoView
  canManage: boolean
  /** a SALA põe o `ref` da sua mesa */
  onAct: (action: TrucoIntent) => void
  onPlayAgain: () => void
  onClose: () => void
  onBackToScreens: () => void
  musicOn: boolean
  musicVolume: number
  onMusicOn: (on: boolean) => void
  onMusicVolume: (v: number) => void
}

/** Barra de baixo do truco: placar, o que está valendo, os botões de cantar e responder. */
export function TrucoHud(p: Props) {
  const { view } = p
  const now = useServerNow(view.serverNow, 500)
  const [sure, setSure] = useState(false)
  const c = view.can
  const m = view.mesas.find((x) => x.id === view.myMesa) ?? null
  const myTeam = view.you?.team ?? 0
  const left = m?.until != null ? m.until - now : null
  const act = useRef(p.onAct)
  act.current = p.onAct

  useEffect(() => {
    if (!sure) return
    const t = window.setTimeout(() => setSure(false), 4000)
    return () => window.clearTimeout(t)
  }, [sure])

  // teclas 1, 2, 3 jogam a carta na sua vez
  const playable = c?.play ? view.myCards : null
  useEffect(() => {
    if (!playable) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      const k = Number(e.key)
      if (k >= 1 && k <= playable.length && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        act.current({ type: 'play', card: playable[k - 1] })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [playable?.join()])

  const nameOf = (i: number) => view.players[i]?.name ?? 'Alguém'
  let help: string
  if (view.phase === 'fim') help = view.winner === myTeam ? 'Vocês ganharam a partida!' : 'A partida acabou.'
  else if (view.phase === 'intervalo') help = 'Dando as cartas de novo...'
  else if (!view.you) help = 'Você está assistindo.'
  else if (!m || m.winner !== null) help = 'Sua mão acabou. Espere os outros duelos.'
  else if (m.asking && m.answering === myTeam) {
    help =
      m.asking === 'truco'
        ? `Pediram ${trucoName(m.truco.pending ?? 2).toLowerCase()}. Quer?`
        : m.asking === 'envido'
          ? `Cantaram ${m.envido.calls.map((k) => envidoName(k).toLowerCase()).join(' + ')}. Quer?`
          : m.asking === 'flor'
            ? 'Os dois times têm flor. Cantar contra-flor (6 pontos para a maior)?'
            : 'Cantaram contra-flor. Quer?'
  } else if (m.asking) help = 'Esperando a resposta dos outros.'
  else if (c?.play) help = 'Sua vez: jogue uma carta (1, 2, 3) ou cante.'
  else help = m.turn !== null ? `Vez de ${nameOf(m.turn)}.` : ''

  const them = myTeam === 0 ? 1 : 0
  const label = view.you ? ['Nós', 'Eles'] : ['Time 1', 'Time 2']

  return (
    <div className={`poker-hud tr-hud ${c?.play || (m?.asking && m.answering === myTeam) ? 'my-turn' : ''}`}>
      <div className="hud-row">
        <div className="tr-score pixel-font" aria-label={`${label[0]} ${view.score[myTeam]}, ${label[1]} ${view.score[them]}, até ${view.target}`}>
          <span className="us">
            {label[0]} <b>{view.score[myTeam]}</b>
          </span>
          <span className="them">
            <b>{view.score[them]}</b> {label[1]}
          </span>
        </div>
        <div className="hud-help">
          <strong className="pixel-font">
            {view.phase === 'fim' ? 'Fim da partida' : m ? (m.truco.level === 1 ? 'Valendo 1' : `${trucoName(m.truco.level)}: valendo ${m.truco.level}`) : ''}
          </strong>
          <small className="detail">{help}</small>
        </div>
        {c && view.phase === 'jogando' && (
          <div className="hud-actions">
            {c.quero && (
              <button className="act primary" onClick={() => p.onAct({ type: 'quero' })}>
                Quero
              </button>
            )}
            {c.contraflor && (
              <button className="act primary" onClick={() => p.onAct({ type: 'contraflor' })}>
                Contra-flor
              </button>
            )}
            {c.naoquero && (
              <button className="act" onClick={() => p.onAct({ type: 'naoquero' })}>
                {c.contraflor ? 'Só a flor' : 'Não quero'}
              </button>
            )}
            {c.truco !== null && (
              <button className="act tr-call" onClick={() => p.onAct({ type: 'truco' })}>
                {trucoName(c.truco)}!
              </button>
            )}
            {c.envido.map((k) => (
              <button key={k} className="act tr-call" onClick={() => p.onAct({ type: 'envido', kind: k })}>
                {envidoName(k)}
              </button>
            ))}
            {c.mazo && (
              <button
                className={`act ${sure ? 'danger' : ''}`}
                onClick={() => {
                  if (!sure) return setSure(true)
                  setSure(false)
                  p.onAct({ type: 'mazo' })
                }}
              >
                {sure ? 'Confirmar: ir ao baralho' : 'Ir ao baralho'}
              </button>
            )}
          </div>
        )}
        <div className="hud-tools">
          {left !== null && view.phase === 'jogando' && <span className={`hud-clock ${left < 8000 ? 'golf-hurry' : ''}`}>{formatClock(left)}</span>}
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
        <div className="modal-backdrop">
          <div className="modal ranking pixel-font" role="dialog" aria-modal="true" aria-label="Fim da partida">
            <h2>{!view.you ? `Time ${view.winner + 1} venceu` : view.winner === myTeam ? 'Vocês venceram!' : 'Eles venceram'}</h2>
            <p className="muted">
              {label[0]} {view.score[myTeam]} x {view.score[them]} {label[1]}
            </p>
            <ol className="rank-list">
              {[view.winner, view.winner === 0 ? 1 : 0].map((t, i) => (
                <li key={t} className={t === myTeam && view.you ? 'me' : ''}>
                  <span className="rank-place">{i + 1}º</span>
                  <span className="rank-name">
                    {view.players
                      .filter((x) => x.team === t)
                      .map((x) => x.name)
                      .join(', ')}
                  </span>
                  <span className="rank-net">{view.score[t]} pontos</span>
                </li>
              ))}
            </ol>
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
