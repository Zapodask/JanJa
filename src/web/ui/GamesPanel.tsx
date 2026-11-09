import { useEffect, useState } from 'react'
import { DEFAULT_CHECKERS_OPTIONS, type CheckersOptions } from '../../shared/games/checkers/types'
import { DEFAULT_CHESS_OPTIONS, type ChessMinutes, type ChessOptions } from '../../shared/games/chess/types'
import { MAPS } from '../../shared/games/golf/maps'
import { DEFAULT_GOLF_OPTIONS, type GolfOptions, type HoleSeconds } from '../../shared/games/golf/types'
import { DEFAULT_OPTIONS, type PokerOptions } from '../../shared/games/poker/types'
import { DEFAULT_NAVAL_OPTIONS, type NavalOptions } from '../../shared/games/naval/types'
import type { GameId, GameLobby } from '../../shared/games/protocol'
import { CATEGORIES, categoryName, DEFAULT_CATEGORIES } from '../../shared/games/stop/categories'
import type { StopOptions, StopRounds, StopSeconds } from '../../shared/games/stop/types'
import { DEFAULT_SHOOTER_OPTIONS, KILL_LIMITS, MATCH_MINUTES, MAX_BOTS, type ShooterOptions } from '../../shared/games/shooter/types'
import { DEFAULT_TRUCO_OPTIONS, type TrucoOptions, type TrucoPlayers } from '../../shared/games/truco/types'
import { DEFAULT_TYCOON_OPTIONS, type TycoonMinutes, type TycoonOptions } from '../../shared/games/tycoon/types'
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
  { value: 'chess', label: 'Xadrez', sub: 'Duas pessoas, com relógio', icon: 'pawn' },
  { value: 'checkers', label: 'Damas', sub: 'Duas pessoas, regras brasileiras', icon: 'checker' },
  { value: 'tycoon', label: 'Magnata', sub: 'Compre cidades e quebre os amigos, de 2 a 6', icon: 'dice' },
  { value: 'truco', label: 'Truco', sub: 'Truco gaudério: 1x1, 2x2 ou 3x3', icon: 'sword' },
  { value: 'shooter', label: 'Tiro na Sala', sub: 'Tiroteio pixel na casa, todo mundo contra todo mundo', icon: 'target' },
  { value: 'naval', label: 'Batalha naval', sub: 'Duas pessoas, cada uma com a sua frota', icon: 'anchor' },
  { value: 'mystery', label: 'Mistério', sub: 'Descubra quem roubou o quadro, de 2 a 6', icon: 'search' },
  { value: 'pool', label: 'Sinuca', sub: 'Bola 8, uma pessoa contra a outra', icon: 'eight' },
  { value: 'stop', label: 'Stop', sub: 'Adedonha: uma letra, todo mundo escreve junto', icon: 'pencil' }
]

const GAME_ICON: Record<GameId, 'cards' | 'flag' | 'pawn' | 'checker' | 'dice' | 'sword' | 'target' | 'anchor' | 'search' | 'eight' | 'pencil'> = {
  poker: 'cards',
  golf: 'flag',
  chess: 'pawn',
  checkers: 'checker',
  tycoon: 'dice',
  truco: 'sword',
  shooter: 'target',
  naval: 'anchor',
  mystery: 'search',
  pool: 'eight',
  stop: 'pencil'
}

const STOP_ROUND_OPTIONS: DropdownOption[] = [3, 5, 8, 10].map((n) => ({ value: String(n), label: `${n} rodadas`, sub: n === 5 ? 'Padrão' : undefined, icon: 'grid' }))
const STOP_TIME: DropdownOption[] = [
  { value: '60', label: '1 minuto', icon: 'clock' },
  { value: '90', label: '1 minuto e meio', icon: 'clock' },
  { value: '120', label: '2 minutos', sub: 'Padrão', icon: 'clock' },
  { value: '180', label: '3 minutos', icon: 'clock' },
  { value: '0', label: 'Sem tempo', sub: 'Só para no STOP', icon: 'clock' }
]

const NAVAL_MODES: DropdownOption[] = [
  { value: 'classico', label: 'Clássico', sub: 'Um tiro por vez; acertou, joga de novo', icon: 'focus' },
  { value: 'salva', label: 'Salva', sub: 'Um tiro por navio de pé, todos de uma vez', icon: 'grid' }
]

const SHOOTER_MAPS: DropdownOption[] = [
  { value: 'casa', label: 'A Casa', sub: 'Sala com sofá e TV, cozinha, corredor e quartos', icon: 'flag' },
  { value: 'quintal', label: 'O Quintal', sub: 'Varal, churrasqueira e uma piscina de plástico', icon: 'flag' }
]
const SHOOTER_TIME: DropdownOption[] = MATCH_MINUTES.map((m) => ({ value: String(m), label: `${m} minutos`, sub: m === 5 ? 'Padrão' : undefined, icon: 'clock' }))
const SHOOTER_KILLS: DropdownOption[] = KILL_LIMITS.map((k) => ({ value: String(k), label: `${k} abates`, sub: k === 20 ? 'Padrão' : 'Acaba antes se alguém chegar lá', icon: 'target' }))
const SHOOTER_BOTS: DropdownOption[] = Array.from({ length: MAX_BOTS + 1 }, (_, n) => ({
  value: String(n),
  label: n === 0 ? 'Sem robôs' : n === 1 ? '1 robô' : `${n} robôs`,
  sub: n === 0 ? 'Só gente de verdade' : undefined,
  icon: 'users'
}))

const TRUCO_MODES: DropdownOption[] = [
  { value: '4', label: '2x2', sub: 'Duas duplas (padrão)', icon: 'users' },
  { value: '2', label: '1x1', sub: 'Mano a mano', icon: 'users' },
  { value: '6', label: '3x3', sub: 'Com mão de testa entre 5 e 25 pontos', icon: 'users' }
]

const TYCOON_TIME: DropdownOption[] = [
  { value: '15', label: '15 minutos', sub: 'Partida curta', icon: 'clock' },
  { value: '25', label: '25 minutos', sub: 'Padrão', icon: 'clock' },
  { value: '40', label: '40 minutos', icon: 'clock' },
  { value: '0', label: 'Sem limite', sub: 'Até alguém vencer', icon: 'clock' }
]

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

function shooterLabel(o: ShooterOptions): string {
  const map = o.mapId === 'quintal' ? 'O Quintal' : 'A Casa'
  const bots = o.bots === 0 ? 'sem robôs' : o.bots === 1 ? '1 robô' : `${o.bots} robôs`
  return `${map}, ${o.minutes} minutos, ${o.killLimit} abates, ${bots}`
}

function chessLabel(o: ChessOptions): string {
  return o.minutes === 0 ? 'sem relógio' : `${o.minutes} minutos para cada um`
}

const TITLES: Record<GameId, string> = { poker: 'Mesa de Poker', golf: 'Golfe', chess: 'Xadrez', checkers: 'Damas', tycoon: 'Magnata', truco: 'Truco', shooter: 'Tiro na Sala', naval: 'Batalha naval', mystery: 'Mistério', pool: 'Sinuca', stop: 'Stop' }
export const gameTitle = (id: GameId): string => TITLES[id]

function lobbyLabel(lobby: GameLobby): string {
  if (lobby.gameId === 'golf') return golfLabel(lobby.options as GolfOptions)
  if (lobby.gameId === 'shooter') return shooterLabel(lobby.options as ShooterOptions)
  if (lobby.gameId === 'chess') return chessLabel(lobby.options as ChessOptions)
  if (lobby.gameId === 'checkers') return chessLabel(lobby.options as CheckersOptions)
  if (lobby.gameId === 'stop') {
    const o = lobby.options as StopOptions
    return `${o.rounds} rodadas, ${o.seconds ? `${o.seconds} s cada` : 'sem tempo'}: ${o.categories.map(categoryName).join(', ')}`
  }
  if (lobby.gameId === 'pool') return 'bola 8, lisas contra listradas'
  if (lobby.gameId === 'mystery') return 'o roubo do quadro no Casarão da Vila'
  if (lobby.gameId === 'naval') return (lobby.options as NavalOptions).mode === 'salva' ? 'modo salva' : 'modo clássico'
  if (lobby.gameId === 'truco') {
    const n = (lobby.options as TrucoOptions).players / 2
    return `${n}x${n}, até 30 pontos, com flor`
  }
  if (lobby.gameId === 'tycoon') {
    const m = (lobby.options as TycoonOptions).minutes
    return m ? `até ${m} minutos` : 'sem limite de tempo'
  }
  return pokerLabel(lobby.options as PokerOptions)
}

/** Painel dos jogos: escolher o jogo e as opções e, depois, o lobby com as vagas. */
export function GamesPanel({ lobby, hasView, api, onClose, onShowTable }: Props) {
  const [pick, setPick] = useState<GameId>('poker')
  const [poker, setPoker] = useState<PokerOptions>(DEFAULT_OPTIONS)
  const [golf, setGolf] = useState<GolfOptions>(DEFAULT_GOLF_OPTIONS)
  const [chess, setChess] = useState<ChessOptions>(DEFAULT_CHESS_OPTIONS)
  const [checkers, setCheckers] = useState<CheckersOptions>(DEFAULT_CHECKERS_OPTIONS)
  const [tycoon, setTycoon] = useState<TycoonOptions>(DEFAULT_TYCOON_OPTIONS)
  const [shooter, setShooter] = useState<ShooterOptions>(DEFAULT_SHOOTER_OPTIONS)
  const [truco, setTruco] = useState<TrucoOptions>(DEFAULT_TRUCO_OPTIONS)
  const [naval, setNaval] = useState<NavalOptions>(DEFAULT_NAVAL_OPTIONS)
  const [stop, setStop] = useState<StopOptions>({ categories: [...DEFAULT_CATEGORIES], rounds: 5, seconds: 120 })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const mine = lobby?.seats.find((s) => s.you)
  // golfe, Magnata e tiro falam em "entrar na partida"; os jogos de mesa, em "sentar"
  const joins = lobby?.gameId === 'golf' || lobby?.gameId === 'tycoon' || lobby?.gameId === 'shooter' || lobby?.gameId === 'stop'
  const isChess = lobby?.gameId === 'chess' || lobby?.gameId === 'checkers'
  const label = lobby ? lobbyLabel(lobby) : ''
  const where = joins || isChess ? 'a partida' : 'a mesa'

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
                  onChange={(v) => setPick(v === 'golf' || v === 'chess' || v === 'checkers' || v === 'tycoon' || v === 'truco' || v === 'shooter' || v === 'naval' || v === 'mystery' || v === 'pool' || v === 'stop' ? v : 'poker')}
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
            ) : pick === 'shooter' ? (
              <>
                <p className="muted games-lead">
                  Tiroteio em pixel art na casa, todo mundo contra todo mundo, de 1 a 8 pessoas mais robôs. Dá para entrar com a partida
                  já rolando. Ganha quem derrubar mais gente.
                </p>
                <div className="games-options">
                  <div className="games-opt">
                    <span>Mapa</span>
                    <Dropdown
                      icon="flag"
                      ariaLabel="Mapa"
                      value={shooter.mapId}
                      options={SHOOTER_MAPS}
                      onChange={(v) => setShooter({ ...shooter, mapId: v === 'quintal' ? 'quintal' : 'casa' })}
                    />
                  </div>
                  <div className="games-opt">
                    <span>Duração</span>
                    <Dropdown
                      icon="clock"
                      ariaLabel="Duração da partida"
                      value={String(shooter.minutes)}
                      options={SHOOTER_TIME}
                      onChange={(v) => setShooter({ ...shooter, minutes: (MATCH_MINUTES.find((m) => String(m) === v) ?? 5) as ShooterOptions['minutes'] })}
                    />
                  </div>
                  <div className="games-opt">
                    <span>Limite</span>
                    <Dropdown
                      icon="target"
                      ariaLabel="Limite de abates"
                      value={String(shooter.killLimit)}
                      options={SHOOTER_KILLS}
                      onChange={(v) => setShooter({ ...shooter, killLimit: (KILL_LIMITS.find((k) => String(k) === v) ?? 20) as ShooterOptions['killLimit'] })}
                    />
                  </div>
                  <div className="games-opt">
                    <span>Robôs</span>
                    <Dropdown
                      icon="users"
                      ariaLabel="Quantidade de robôs"
                      value={String(shooter.bots)}
                      options={SHOOTER_BOTS}
                      onChange={(v) => setShooter({ ...shooter, bots: Math.max(0, Math.min(MAX_BOTS, Number(v) || 0)) })}
                    />
                  </div>
                </div>
              </>
            ) : pick === 'stop' ? (
              <>
                <p className="muted games-lead">
                  Stop para 2 a 10 pessoas. Sorteia uma letra, todo mundo preenche as categorias e quem terminar grita STOP. Resposta
                  única vale 10, repetida vale 5.
                </p>
                <div className="games-options">
                  <div className="games-opt">
                    <span>Rodadas</span>
                    <Dropdown
                      icon="grid"
                      ariaLabel="Rodadas"
                      value={String(stop.rounds)}
                      options={STOP_ROUND_OPTIONS}
                      onChange={(v) => setStop({ ...stop, rounds: ([3, 5, 8, 10].includes(Number(v)) ? Number(v) : 5) as StopRounds })}
                    />
                  </div>
                  <div className="games-opt">
                    <span>Tempo</span>
                    <Dropdown
                      icon="clock"
                      ariaLabel="Tempo de cada rodada"
                      value={String(stop.seconds)}
                      options={STOP_TIME}
                      onChange={(v) => setStop({ ...stop, seconds: ([0, 60, 90, 120, 180].includes(Number(v)) ? Number(v) : 120) as StopSeconds })}
                    />
                  </div>
                </div>
                <div className="sp-cats" role="group" aria-label="Categorias">
                  {CATEGORIES.map((c) => {
                    const on = stop.categories.includes(c.id)
                    return (
                      <button
                        key={c.id}
                        type="button"
                        className={`sp-cat ${on ? 'on' : ''}`}
                        aria-pressed={on}
                        disabled={on && stop.categories.length <= 3}
                        onClick={() =>
                          setStop({ ...stop, categories: CATEGORIES.map((x) => x.id).filter((id) => (id === c.id ? !on : stop.categories.includes(id))) })
                        }
                      >
                        {c.name}
                      </button>
                    )
                  })}
                </div>
                <small className="muted">Pelo menos 3 categorias.</small>
              </>
            ) : pick === 'pool' ? (
              <p className="muted games-lead">
                Sinuca de bola 8 para duas pessoas: lisas contra listradas. Encaçapou do seu grupo, joga de novo. Limpou o grupo, escolha
                a caçapa e mate a 8. Falta dá bola na mão para o outro.
              </p>
            ) : pick === 'mystery' ? (
              <p className="muted games-lead">
                Roubaram o quadro do Casarão da Vila durante a festa. Palpite quem foi, onde e com o quê: quem tiver uma das cartas
                mostra para você em segredo. Acertou a acusação, venceu. De 2 a 6 pessoas.
              </p>
            ) : pick === 'naval' ? (
              <>
                <p className="muted games-lead">
                  Batalha naval para duas pessoas. Cada uma posiciona a frota escondida e tenta afundar a do outro primeiro.
                </p>
                <div className="games-options">
                  <div className="games-opt">
                    <span>Tiros</span>
                    <Dropdown
                      icon="focus"
                      ariaLabel="Modo de tiro"
                      value={naval.mode}
                      options={NAVAL_MODES}
                      onChange={(v) => setNaval({ mode: v === 'salva' ? 'salva' : 'classico' })}
                    />
                  </div>
                </div>
              </>
            ) : pick === 'truco' ? (
              <>
                <p className="muted games-lead">
                  Truco gaudério até 30 pontos, com flor (3) e contra-flor (6). Escolha a cadeira para escolher a dupla: cadeiras
                  ímpares jogam juntas contra as pares.
                </p>
                <div className="games-options">
                  <div className="games-opt">
                    <span>Mesa</span>
                    <Dropdown
                      icon="users"
                      ariaLabel="Quantas pessoas"
                      value={String(truco.players)}
                      options={TRUCO_MODES}
                      onChange={(v) => setTruco({ players: ([2, 4, 6].includes(Number(v)) ? Number(v) : 4) as TrucoPlayers })}
                    />
                  </div>
                </div>
              </>
            ) : pick === 'tycoon' ? (
              <>
                <p className="muted games-lead">
                  Jogo rápido de comprar cidades para 2 a 6 pessoas. Construa na hora, cobre aluguel e compre a cidade dos outros.
                  Vence quem fechar três grupos, um lado inteiro ou as quatro praias, ou quem sobrar sem quebrar.
                </p>
                <div className="games-options">
                  <div className="games-opt">
                    <span>Duração</span>
                    <Dropdown
                      icon="clock"
                      ariaLabel="Duração da partida"
                      value={String(tycoon.minutes)}
                      options={TYCOON_TIME}
                      onChange={(v) => setTycoon({ minutes: ([0, 15, 25, 40].includes(Number(v)) ? Number(v) : 25) as TycoonMinutes })}
                    />
                  </div>
                </div>
              </>
            ) : pick === 'checkers' ? (
              <>
                <p className="muted games-lead">
                  Damas para duas pessoas, com as regras brasileiras: capturar é obrigatório, vale a jogada que captura mais e a dama
                  anda longe. As cores são sorteadas.
                </p>
                <div className="games-options">
                  <div className="games-opt">
                    <span>Relógio</span>
                    <Dropdown
                      icon="clock"
                      ariaLabel="Relógio de cada jogador"
                      value={String(checkers.minutes)}
                      options={CLOCKS}
                      onChange={(v) => setCheckers({ minutes: ([0, 5, 10, 15].includes(Number(v)) ? Number(v) : 10) as ChessMinutes })}
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
              <button className="primary" onClick={() => api.open(pick, pick === 'golf' ? golf : pick === 'chess' ? chess : pick === 'checkers' ? checkers : pick === 'tycoon' ? tycoon : pick === 'truco' ? truco : pick === 'shooter' ? shooter : pick === 'naval' ? naval : pick === 'mystery' || pick === 'pool' ? {} : pick === 'stop' ? stop : poker)}>
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
                  {joins || isChess ? 'Encerrar partida' : 'Encerrar mesa'}
                </button>
              )}
              {lobby.gameId === 'shooter' && !mine && (
                <button className="primary" onClick={() => api.sit()}>
                  Entrar na partida
                </button>
              )}
              {hasView && (
                <button
                  className={lobby.gameId === 'shooter' && !mine ? '' : 'primary'}
                  onClick={() => {
                    onShowTable()
                    onClose()
                  }}
                >
                  {lobby.gameId === 'golf' ? 'Ver o campo' : lobby.gameId === 'poker' ? 'Ver a mesa' : lobby.gameId === 'shooter' ? 'Ver a partida' : 'Ver o tabuleiro'}
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
                // truco em dupla/trio: a cadeira escolhe o time (pares x ímpares)
                const team = lobby.gameId === 'truco' && lobby.maxPlayers > 2 ? ` · time ${(i % 2) + 1}` : ''
                return (
                  <li key={i} className={s ? 'taken' : 'free'}>
                    {s ? (
                      <>
                        <Avatar name={s.name} size={32} />
                        <span className="seat-name">
                          {s.name}
                          {s.you ? ' (você)' : ''}
                          {team && <small className="detail">{team}</small>}
                        </span>
                        {!s.present && <small className="detail">fora da sala</small>}
                      </>
                    ) : (
                      <button className="seat-free" onClick={() => api.sit(i)}>
                        <span className="seat-empty" aria-hidden="true" />
                        {joins ? `Vaga ${i + 1} livre` : `Cadeira ${i + 1} livre${team}`}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
            {lobby.seats.length < lobby.minPlayers && (
              <p className="small muted">
                Precisa de pelo menos {lobby.minPlayers} {lobby.minPlayers === 1 ? 'pessoa' : 'pessoas'} {joins ? 'na partida' : 'sentadas'} para começar.
              </p>
            )}
            <div className="modal-actions">
              {lobby.canManage && (
                <button className="danger" onClick={api.close}>
                  Encerrar
                </button>
              )}
              {mine ? (
                <button onClick={api.stand}>{joins ? 'Sair da partida' : 'Levantar'}</button>
              ) : (
                <button onClick={() => api.sit()}>{lobby.gameId === 'shooter' ? 'Entrar na partida' : joins ? 'Entrar' : 'Sentar'}</button>
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
