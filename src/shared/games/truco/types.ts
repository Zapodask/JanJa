import type { Card } from './cards'

/** quantas pessoas na mesa: 1x1, 2x2 ou 3x3 (times alternados: cadeiras pares x ímpares) */
export type TrucoPlayers = 2 | 4 | 6
export const TRUCO_PLAYERS: readonly TrucoPlayers[] = [2, 4, 6]

export interface TrucoOptions {
  players: TrucoPlayers
}

export const DEFAULT_TRUCO_OPTIONS: TrucoOptions = { players: 4 }

export const TARGET = 30
/** no 3x3, quando os dois times estão nesta faixa, alterna mão normal e mão de testa */
export const TESTA_FROM = 5
export const TESTA_TO = 25
export const FLOR_POINTS = 3
export const CONTRAFLOR_POINTS = 6
/** prazo para jogar ou responder; quem está fora da sala responde rápido */
export const DECIDE_MS = 30_000
export const AWAY_MS = 3_000
/** pausa mostrando a mão antes de dar as cartas de novo */
export const BREAK_MS = 4_000

export type Team = 0 | 1
export type EnvidoKind = 'envido' | 'real' | 'falta'

export type TrucoAction =
  | { type: 'play'; card: Card; ref: number }
  /** truco, retruco ou vale quatro (o próximo nível) */
  | { type: 'truco'; ref: number }
  | { type: 'envido'; kind: EnvidoKind; ref: number }
  | { type: 'quero'; ref: number }
  | { type: 'naoquero'; ref: number }
  | { type: 'contraflor'; ref: number }
  /** ir ao baralho: o time desiste da mão */
  | { type: 'mazo'; ref: number }

/** a ação sem o `ref` (a sala completa com a versão da mesa) */
export type TrucoIntent = TrucoAction extends infer A ? (A extends { ref: number } ? Omit<A, 'ref'> : never) : never

/** o que a pessoa pode fazer agora na mesa dela */
export interface TrucoCan {
  play: boolean
  /** nível que chamaria (2 truco, 3 retruco, 4 vale quatro) ou null */
  truco: number | null
  envido: EnvidoKind[]
  quero: boolean
  naoquero: boolean
  contraflor: boolean
  mazo: boolean
}

export interface TrucoPlayerView {
  playerId: string
  name: string
  index: number
  team: Team
  away: boolean
  /** cartas que ainda tem na mão (as cartas mesmo só a pessoa vê) */
  cardsLeft: number
  flor: boolean
}

export interface TrickView {
  plays: Array<{ p: number; card: Card }>
  /** time que ganhou, 'P' = parda (empate), null = em jogo */
  result: Team | 'P' | null
}

export interface MesaView {
  id: number
  /** jogadores (índices) a partir de quem é mão */
  order: number[]
  mao: number
  tricks: TrickView[]
  /** quem joga carta agora (null quando falta alguém responder) */
  turn: number | null
  /** time que tem que responder (truco, envido ou flor) */
  answering: Team | null
  /** o que está em aberto para responder */
  asking: 'truco' | 'envido' | 'flor' | 'contraflor' | null
  /** valor da mão aceito (1 sem truco) e o nível chamado esperando resposta */
  truco: { level: number; pending: number | null; owner: Team | null }
  envido: { calls: EnvidoKind[]; result: EnvidoResult | null }
  flor: { holders: number[]; result: string | null }
  winner: Team | null
  /** versão da mesa: toda ação diz qual versão viu (protege de clique atrasado) */
  ref: number
  until: number | null
}

export interface EnvidoResult {
  winner: Team
  points: number
  /** pontos cantados por quem mostrou (só depois de querido) */
  sung: Array<{ p: number; points: number }>
}

export interface TrucoView {
  you: { playerId: string; index: number; team: Team } | null
  players: TrucoPlayerView[]
  mode: TrucoPlayers
  score: [number, number]
  target: number
  dealer: number
  hand: number
  testa: boolean
  mesas: MesaView[]
  /** suas cartas (só as suas) */
  myCards: Card[]
  /** sua mesa (na testa, o seu duelo) */
  myMesa: number | null
  can: TrucoCan | null
  phase: 'jogando' | 'intervalo' | 'fim'
  until: number | null
  serverNow: number
  log: string[]
  winner: Team | null
}

export type TrucoCall = 'truco' | 'retruco' | 'vale4' | EnvidoKind | 'flor' | 'contraflor'

export type TrucoEvent =
  | { type: 'deal'; hand: number; dealer: number; testa: boolean }
  | { type: 'play'; mesa: number; p: number; card: Card }
  | { type: 'call'; mesa: number; p: number; call: TrucoCall }
  | { type: 'answer'; mesa: number; p: number; quero: boolean }
  | { type: 'mazo'; mesa: number; p: number }
  | { type: 'trick'; mesa: number; result: Team | 'P' }
  | { type: 'points'; team: Team; points: number; why: string }
  | { type: 'mesa-end'; mesa: number; winner: Team; points: number }
  | { type: 'end'; winner: Team }

export const trucoName = (level: number): string => (level <= 2 ? 'Truco' : level === 3 ? 'Retruco' : 'Vale quatro')
export const envidoName = (k: EnvidoKind): string => (k === 'envido' ? 'Envido' : k === 'real' ? 'Real envido' : 'Falta envido')
