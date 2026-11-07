import { useEffect, useState } from 'react'
import { DEFAULT_OPTIONS, type PokerOptions } from '../../shared/games/poker/types'
import type { GameLobby } from '../../shared/games/protocol'
import { Avatar } from './Avatar'
import { Dropdown, type DropdownOption } from './Dropdown'
import { Icon } from './icons'

export interface GamesApi {
  open: (options: PokerOptions) => void
  sit: (seat?: number) => void
  stand: () => void
  start: () => void
  close: () => void
}

interface Props {
  lobby: GameLobby | null
  /** já existe uma partida em andamento (a mesa pode estar escondida) */
  hasView: boolean
  api: GamesApi
  onClose: () => void
  onShowTable: () => void
}

const MODES: DropdownOption[] = [
  { value: 'holdem', label: "Hold'em", sub: 'Duas cartas na mão e cinco na mesa', icon: 'cards' },
  { value: 'tres', label: 'Rápido, 3 cartas', sub: 'Uma rodada só, termina logo', icon: 'focus' }
]
const MINUTES: DropdownOption[] = [
  { value: '15', label: '15 minutos', icon: 'clock' },
  { value: '30', label: '30 minutos', sub: 'Padrão', icon: 'clock' },
  { value: '45', label: '45 minutos', icon: 'clock' },
  { value: '0', label: 'Sem limite', sub: 'Até o dono encerrar', icon: 'clock' }
]
const BUYS: DropdownOption[] = [
  { value: 'recompra', label: 'Recompra', sub: 'Quem zera recebe fichas de novo; vence quem lucra mais', icon: 'plus' },
  { value: 'torneio', label: 'Torneio', sub: 'Quem zera sai da mesa', icon: 'crown' }
]

function modeLabel(o: PokerOptions): string {
  const time = o.minutes === 0 ? 'sem limite de tempo' : `${o.minutes} minutos`
  return `${o.mode === 'tres' ? 'Rápido, 3 cartas' : "Hold'em"}, ${time}, ${o.buy === 'torneio' ? 'torneio' : 'recompra'}`
}

/** Painel dos jogos: opções para abrir a mesa e, depois, o lobby com as cadeiras. */
export function GamesPanel({ lobby, hasView, api, onClose, onShowTable }: Props) {
  const [opts, setOpts] = useState<PokerOptions>(DEFAULT_OPTIONS)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const mine = lobby?.seats.find((s) => s.you)
  const options = (lobby?.options ?? opts) as PokerOptions

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal games-panel" role="dialog" aria-modal="true" aria-labelledby="games-title">
        <div className="games-head">
          <h2 id="games-title">{lobby ? 'Mesa de Poker' : 'Jogos'}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar" data-tip="Fechar" data-tip-pos="left">
            <Icon name="x" size={20} />
          </button>
        </div>

        {!lobby ? (
          <>
            <p className="muted games-lead">
              Poker facilitado para 2 a 8 pessoas. Os botões já mostram o valor e o jogo explica quem ganhou.
            </p>
            <div className="games-options">
              <div className="games-opt">
                <span>Modo</span>
                <Dropdown
                  icon="cards"
                  ariaLabel="Modo de jogo"
                  value={opts.mode}
                  options={MODES}
                  onChange={(v) => setOpts({ ...opts, mode: v === 'tres' ? 'tres' : 'holdem' })}
                />
              </div>
              <div className="games-opt">
                <span>Duração</span>
                <Dropdown
                  icon="clock"
                  ariaLabel="Duração da partida"
                  value={String(opts.minutes)}
                  options={MINUTES}
                  onChange={(v) => setOpts({ ...opts, minutes: ([0, 15, 30, 45].includes(Number(v)) ? Number(v) : 30) as PokerOptions['minutes'] })}
                />
              </div>
              <div className="games-opt">
                <span>Fichas</span>
                <Dropdown
                  icon="plus"
                  ariaLabel="Recompra ou torneio"
                  value={opts.buy}
                  options={BUYS}
                  onChange={(v) => setOpts({ ...opts, buy: v === 'torneio' ? 'torneio' : 'recompra' })}
                />
              </div>
            </div>
            <div className="modal-actions">
              <button onClick={onClose}>Agora não</button>
              <button className="primary" onClick={() => api.open(opts)}>
                Abrir mesa
              </button>
            </div>
          </>
        ) : lobby.started ? (
          <>
            <p className="muted games-lead">
              {lobby.openedBy} abriu a mesa. Partida em andamento: {modeLabel(options)}.
            </p>
            <div className="modal-actions">
              {lobby.canManage && (
                <button className="danger" onClick={api.close}>
                  Encerrar mesa
                </button>
              )}
              {hasView && (
                <button
                  className="primary"
                  onClick={() => {
                    onShowTable()
                    onClose()
                  }}
                >
                  Ver a mesa
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="muted games-lead">
              {lobby.openedBy} abriu a mesa: {modeLabel(options)}.
            </p>
            <ul className="games-seats">
              {Array.from({ length: lobby.maxPlayers }, (_, i) => {
                const s = lobby.seats.find((x) => x.seat === i)
                return (
                  <li key={i} className={s ? 'taken' : 'free'}>
                    {s ? (
                      <>
                        <Avatar name={s.name} size={32} />
                        <span className="seat-name">
                          {s.name}
                          {s.you ? ' (você)' : ''}
                        </span>
                        {!s.present && <small className="detail">fora da sala</small>}
                      </>
                    ) : (
                      <button className="seat-free" onClick={() => api.sit(i)}>
                        <span className="seat-empty" aria-hidden="true" />
                        Cadeira {i + 1} livre
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
            {lobby.seats.length < lobby.minPlayers && (
              <p className="small muted">Precisa de pelo menos {lobby.minPlayers} pessoas sentadas para começar.</p>
            )}
            <div className="modal-actions">
              {lobby.canManage && (
                <button className="danger" onClick={api.close}>
                  Encerrar
                </button>
              )}
              {mine ? <button onClick={api.stand}>Levantar</button> : <button onClick={() => api.sit()}>Sentar</button>}
              {lobby.canManage && (
                <button className="primary" disabled={lobby.seats.length < lobby.minPlayers} onClick={api.start}>
                  Começar
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
