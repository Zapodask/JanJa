import { useEffect, useState } from 'react'
import { DEFAULT_CHESS_OPTIONS, type ChessMinutes, type ChessOptions } from '../../shared/games/chess/types'
import { MAPS } from '../../shared/games/golf/maps'
import { DEFAULT_GOLF_OPTIONS, type GolfOptions, type HoleSeconds } from '../../shared/games/golf/types'
import { DEFAULT_OPTIONS, type PokerOptions } from '../../shared/games/poker/types'
import type { GameId, GameLobby } from '../../shared/games/protocol'
import { Avatar } from './Avatar'
import { Dropdown, type DropdownOption } from './Dropdown'
import { Icon } from './icons'

export interface GamesApi {
  open: (gameId: GameId, options: unknown) => void
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

const GAMES: DropdownOption[] = [
  { value: 'poker', label: 'Poker', sub: 'De 2 a 8 pessoas, uma de cada vez', icon: 'cards' },
  { value: 'golf', label: 'Golfe', sub: 'Mini-golfe em 3D, todo mundo joga junto', icon: 'flag' },
  { value: 'chess', label: 'Xadrez', sub: 'Duas pessoas, com relógio', icon: 'pawn' }
]

const GAME_ICON: Record<GameId, 'cards' | 'flag' | 'pawn'> = { poker: 'cards', golf: 'flag', chess: 'pawn' }

const CLOCKS: DropdownOption[] = [
  { value: '5', label: '5 minutos', sub: 'Para cada um, rápido', icon: 'clock' },
  { value: '10', label: '10 minutos', sub: 'Padrão', icon: 'clock' },
  { value: '15', label: '15 minutos', icon: 'clock' },
  { value: '0', label: 'Sem relógio', sub: 'Pensem com calma', icon: 'clock' }
]

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

const MAP_OPTIONS: DropdownOption[] = MAPS.map((m) => ({
  value: m.id,
  label: m.name,
  sub: `${m.holes.length} buracos`,
  icon: 'flag'
}))
const COLLISIONS: DropdownOption[] = [
  { value: 'sim', label: 'Bolas batem', sub: 'Dá para empurrar a bola dos outros', icon: 'users' },
  { value: 'nao', label: 'Bolas passam', sub: 'Cada um joga sem atrapalhar', icon: 'focus' }
]
const HOLE_TIME: DropdownOption[] = [
  { value: '60', label: '1 minuto', icon: 'clock' },
  { value: '90', label: '1 minuto e meio', sub: 'Padrão', icon: 'clock' },
  { value: '120', label: '2 minutos', icon: 'clock' }
]

function pokerLabel(o: PokerOptions): string {
  const time = o.minutes === 0 ? 'sem limite de tempo' : `${o.minutes} minutos`
  return `${o.mode === 'tres' ? 'Rápido, 3 cartas' : "Hold'em"}, ${time}, ${o.buy === 'torneio' ? 'torneio' : 'recompra'}`
}

function golfLabel(o: GolfOptions): string {
  const map = MAPS.find((m) => m.id === o.mapId)
  const holes = map ? `${map.name} (${map.holes.length} buracos)` : 'mapa'
  return `${holes}, ${o.collisions ? 'bolas batem' : 'bolas passam'}, ${o.holeSeconds} s por buraco`
}

function chessLabel(o: ChessOptions): string {
  return o.minutes === 0 ? 'sem relógio' : `${o.minutes} minutos para cada um`
}

export const gameTitle = (id: GameId): string => (id === 'golf' ? 'Golfe' : id === 'chess' ? 'Xadrez' : 'Mesa de Poker')

function lobbyLabel(lobby: GameLobby): string {
  if (lobby.gameId === 'golf') return golfLabel(lobby.options as GolfOptions)
  if (lobby.gameId === 'chess') return chessLabel(lobby.options as ChessOptions)
  return pokerLabel(lobby.options as PokerOptions)
}

/** Painel dos jogos: escolher o jogo e as opções e, depois, o lobby com as vagas. */
export function GamesPanel({ lobby, hasView, api, onClose, onShowTable }: Props) {
  const [pick, setPick] = useState<GameId>('poker')
  const [poker, setPoker] = useState<PokerOptions>(DEFAULT_OPTIONS)
  const [golf, setGolf] = useState<GolfOptions>(DEFAULT_GOLF_OPTIONS)
  const [chess, setChess] = useState<ChessOptions>(DEFAULT_CHESS_OPTIONS)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const mine = lobby?.seats.find((s) => s.you)
  const isGolf = lobby?.gameId === 'golf'
  const isChess = lobby?.gameId === 'chess'
  const label = lobby ? lobbyLabel(lobby) : ''
  const where = isGolf || isChess ? 'a partida' : 'a mesa'

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal games-panel" role="dialog" aria-modal="true" aria-labelledby="games-title">
        <div className="games-head">
          <h2 id="games-title">{lobby ? gameTitle(lobby.gameId) : 'Jogos'}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar" data-tip="Fechar" data-tip-pos="left">
            <Icon name="x" size={20} />
          </button>
        </div>

        {!lobby ? (
          <>
            <div className="games-options">
              <div className="games-opt">
                <span>Jogo</span>
                <Dropdown
                  icon={GAME_ICON[pick]}
                  ariaLabel="Jogo"
                  value={pick}
                  options={GAMES}
                  onChange={(v) => setPick(v === 'golf' || v === 'chess' ? v : 'poker')}
                />
              </div>
            </div>
            {pick === 'poker' ? (
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
                      value={poker.mode}
                      options={MODES}
                      onChange={(v) => setPoker({ ...poker, mode: v === 'tres' ? 'tres' : 'holdem' })}
                    />
                  </div>
                  <div className="games-opt">
                    <span>Duração</span>
                    <Dropdown
                      icon="clock"
                      ariaLabel="Duração da partida"
                      value={String(poker.minutes)}
                      options={MINUTES}
                      onChange={(v) =>
                        setPoker({ ...poker, minutes: ([0, 15, 30, 45].includes(Number(v)) ? Number(v) : 30) as PokerOptions['minutes'] })
                      }
                    />
                  </div>
                  <div className="games-opt">
                    <span>Fichas</span>
                    <Dropdown
                      icon="plus"
                      ariaLabel="Recompra ou torneio"
                      value={poker.buy}
                      options={BUYS}
                      onChange={(v) => setPoker({ ...poker, buy: v === 'torneio' ? 'torneio' : 'recompra' })}
                    />
                  </div>
                </div>
              </>
            ) : pick === 'chess' ? (
              <>
                <p className="muted games-lead">
                  Xadrez para duas pessoas. As cores são sorteadas. O jogo mostra os lances que valem e avisa xeque, mate e empate.
                </p>
                <div className="games-options">
                  <div className="games-opt">
                    <span>Relógio</span>
                    <Dropdown
                      icon="clock"
                      ariaLabel="Relógio de cada jogador"
                      value={String(chess.minutes)}
                      options={CLOCKS}
                      onChange={(v) => setChess({ minutes: ([0, 5, 10, 15].includes(Number(v)) ? Number(v) : 10) as ChessMinutes })}
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
                <p className="muted games-lead">
                  Mini-golfe para 1 a 8 pessoas, todo mundo no mesmo buraco ao mesmo tempo. Ganha quem somar menos tacadas.
                </p>
                <div className="games-options">
                  <div className="games-opt">
                    <span>Mapa</span>
                    <Dropdown icon="flag" ariaLabel="Mapa" value={golf.mapId} options={MAP_OPTIONS} onChange={(v) => setGolf({ ...golf, mapId: v })} />
                  </div>
                  <div className="games-opt">
                    <span>Bolas</span>
                    <Dropdown
                      icon="users"
                      ariaLabel="Colisão entre bolas"
                      value={golf.collisions ? 'sim' : 'nao'}
                      options={COLLISIONS}
                      onChange={(v) => setGolf({ ...golf, collisions: v === 'sim' })}
                    />
                  </div>
                  <div className="games-opt">
                    <span>Tempo</span>
                    <Dropdown
                      icon="clock"
                      ariaLabel="Tempo por buraco"
                      value={String(golf.holeSeconds)}
                      options={HOLE_TIME}
                      onChange={(v) => setGolf({ ...golf, holeSeconds: ([60, 90, 120].includes(Number(v)) ? Number(v) : 90) as HoleSeconds })}
                    />
                  </div>
                </div>
              </>
            )}
            <div className="modal-actions">
              <button onClick={onClose}>Agora não</button>
              <button className="primary" onClick={() => api.open(pick, pick === 'golf' ? golf : pick === 'chess' ? chess : poker)}>
                {pick === 'poker' ? 'Abrir mesa' : 'Abrir partida'}
              </button>
            </div>
          </>
        ) : lobby.started ? (
          <>
            <p className="muted games-lead">
              {lobby.openedBy} abriu {where}. Partida em andamento: {label}.
            </p>
            <div className="modal-actions">
              {lobby.canManage && (
                <button className="danger" onClick={api.close}>
                  {isGolf || isChess ? 'Encerrar partida' : 'Encerrar mesa'}
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
                  {isGolf ? 'Ver o campo' : isChess ? 'Ver o tabuleiro' : 'Ver a mesa'}
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="muted games-lead">
              {lobby.openedBy} abriu {where}: {label}.
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
                        {isGolf ? `Vaga ${i + 1} livre` : `Cadeira ${i + 1} livre`}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
            {lobby.seats.length < lobby.minPlayers && (
              <p className="small muted">
                Precisa de pelo menos {lobby.minPlayers} {lobby.minPlayers === 1 ? 'pessoa' : 'pessoas'} {isGolf ? 'na partida' : 'sentadas'} para começar.
              </p>
            )}
            <div className="modal-actions">
              {lobby.canManage && (
                <button className="danger" onClick={api.close}>
                  Encerrar
                </button>
              )}
              {mine ? (
                <button onClick={api.stand}>{isGolf ? 'Sair da partida' : 'Levantar'}</button>
              ) : (
                <button onClick={() => api.sit()}>{isGolf ? 'Entrar' : 'Sentar'}</button>
              )}
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
