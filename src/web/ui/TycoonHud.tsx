import '@fontsource-variable/pixelify-sans'
import { useEffect, useRef } from 'react'
import { MAX_LEVEL, TILES } from '../../shared/games/tycoon/board'
import { describeEnd, money, type TycoonAction, type TycoonView } from '../../shared/games/tycoon/types'
import { formatClock } from '../game/helpers'
import { useServerNow } from '../game/useServerNow'
import { Icon } from './icons'
import { VolumeSlider } from './media'

interface Props {
  view: TycoonView
  canManage: boolean
  onAct: (action: TycoonAction) => void
  onPlayAgain: () => void
  onClose: () => void
  onBackToScreens: () => void
  musicOn: boolean
  musicVolume: number
  onMusicOn: (on: boolean) => void
  onMusicVolume: (v: number) => void
}

const levelLabel = (level: number): string =>
  level === 0 ? 'Só o terreno' : level === MAX_LEVEL ? 'Hotel' : level === 1 ? 'Com 1 casa' : `Com ${level} casas`
const buildLabel = (level: number): string => (level === MAX_LEVEL ? 'Hotel' : level === 1 ? '1 casa' : `${level} casas`)

/** Barra de baixo do Magnata: de quem é a vez, o prazo, os botões da decisão e o fim da partida. */
export function TycoonHud(p: Props) {
  const { view } = p
  const now = useServerNow(view.serverNow, 500)
  const myTurn = !!view.you && view.turn === view.you.playerId && !view.result
  const pend = myTurn ? view.pending : null
  const left = view.until !== null ? view.until - now : null
  const gameLeft = view.endsAt !== null ? view.endsAt - now : null
  const nameOf = (id: string) => view.players.find((x) => x.playerId === id)?.name ?? 'Alguém'
  const turnName = view.turn ? nameOf(view.turn) : ''
  const me = view.players.find((x) => x.playerId === view.you?.playerId)

  const actRef = useRef(p.onAct)
  actRef.current = p.onAct
  // Espaço rola os dados na sua vez (fora de campos de texto)
  useEffect(() => {
    if (pend?.kind !== 'rolar') return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName)) return
      if (e.key === ' ' && !e.repeat) {
        e.preventDefault()
        actRef.current({ type: 'roll' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pend?.kind])

  let title: string
  let help: string
  if (view.result) {
    title = 'Fim da partida'
    help = describeEnd(view.result, nameOf)
  } else if (!pend) {
    title = `Vez de ${turnName}`
    help = view.you ? (me?.out ? 'Você quebrou. Dá para continuar assistindo.' : 'Espere a sua vez.') : 'Você está assistindo.'
  } else {
    title = 'Sua vez'
    switch (pend.kind) {
      case 'rolar':
        help = pend.jammed ? 'Você está no engarrafamento: tire uma dupla para sair ou pague a multa.' : 'Role os dados (Espaço).'
        break
      case 'comprar':
        help = `${TILES[pend.tile].name} está à venda. Compre já com casas para cobrar mais aluguel.`
        break
      case 'construir':
        help = `Você está em ${TILES[pend.tile].name}. Quer construir?`
        break
      case 'tomar':
        help = `Você pode comprar ${TILES[pend.tile].name} de ${nameOf(pend.owner)}, mesmo sem ela querer vender.`
        break
      case 'festival':
        help = 'Clique numa cidade sua no tabuleiro para levar o Festival: o aluguel dobra lá.'
        break
      case 'voar':
        help = `Clique em qualquer casa do tabuleiro para voar até lá por ${money(pend.fee)}, ou fique.`
        break
    }
  }

  return (
    <div className={`poker-hud ty-hud ${myTurn ? 'my-turn' : ''}`}>
      <div className="hud-row">
        <div className="hud-help">
          <strong className="pixel-font">{title}</strong>
          <small className="detail">{help}</small>
        </div>
        {pend && (
          <div className="hud-actions">
            {pend.kind === 'rolar' && (
              <>
                <button className="act primary" onClick={() => p.onAct({ type: 'roll' })}>
                  {pend.jammed ? 'Tentar a dupla' : 'Rolar dados'}
                </button>
                {pend.jammed && (
                  <button className="act" disabled={(me?.cash ?? 0) < pend.fine} onClick={() => p.onAct({ type: 'roll', pay: true })}>
                    Pagar {money(pend.fine)} e rolar
                  </button>
                )}
              </>
            )}
            {pend.kind === 'comprar' &&
              pend.options.map((o, k) => (
                <button key={o.level} className={`act ${k === 0 ? 'primary' : ''}`} onClick={() => p.onAct({ type: 'buy', level: o.level })}>
                  {TILES[pend.tile].kind === 'beach' ? 'Comprar' : levelLabel(o.level)} · {money(o.cost)}
                </button>
              ))}
            {pend.kind === 'construir' &&
              pend.options.map((o) => (
                <button key={o.level} className="act" onClick={() => p.onAct({ type: 'build', level: o.level })}>
                  {buildLabel(o.level)} · {money(o.cost)}
                </button>
              ))}
            {pend.kind === 'tomar' && (
              <button className="act primary" onClick={() => p.onAct({ type: 'takeover' })}>
                Comprar de {nameOf(pend.owner)} · {money(pend.price)}
              </button>
            )}
            {pend.kind !== 'rolar' && (
              <button className="act" onClick={() => p.onAct({ type: 'pass' })}>
                {pend.kind === 'voar' ? 'Ficar' : 'Passar'}
              </button>
            )}
          </div>
        )}
        <div className="hud-tools">
          {left !== null && !view.result && (
            <span className={`hud-clock ${left < 5000 ? 'golf-hurry' : ''}`} aria-label={`Tempo da vez: ${formatClock(left)}`}>
              vez {formatClock(left)}
              {gameLeft !== null ? ` · partida ${formatClock(gameLeft)}` : ''}
            </span>
          )}
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

      {view.result && (
        <div className="modal-backdrop">
          <div className="modal ranking pixel-font" role="dialog" aria-modal="true" aria-label="Fim da partida">
            <h2>{view.result.winner === view.you?.playerId ? 'Você venceu!' : view.result.winner ? `${nameOf(view.result.winner)} venceu` : 'Fim da partida'}</h2>
            <p className="muted">{describeEnd(view.result, nameOf)}</p>
            <ol className="rank-list">
              {view.result.ranking.map((r) => (
                <li key={r.playerId} className={r.playerId === view.you?.playerId ? 'me' : ''}>
                  <span className="rank-place">{r.place}º</span>
                  <span className="rank-name">{nameOf(r.playerId)}</span>
                  <span className="rank-net">{r.worth > 0 ? money(r.worth) : 'quebrou'}</span>
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
