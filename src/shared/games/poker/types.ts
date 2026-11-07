/**
 * Tipos públicos do Poker facilitado. Contrato entre: motor (shared/games/poker), servidor e mesa (web/game).
 * Mudanças aqui afetam os três: combine com o planejador.
 */

// ---------- cartas ----------
/** Valor: 2..9, T=10, J, Q, K, A */
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A'
/** Naipe: c=paus, d=ouros, h=copas, s=espadas */
export type Suit = 'c' | 'd' | 'h' | 's'
/** Carta como texto curto: valor + naipe. Ex.: 'As' (Ás de espadas), 'Td' (10 de ouros) */
export type Card = `${Rank}${Suit}`

export const RANKS: readonly Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']
export const SUITS: readonly Suit[] = ['c', 'd', 'h', 's']

// ---------- opções da mesa ----------
export type PokerMode = 'holdem' | 'tres' // Texas Hold'em facilitado | Poker de 3 cartas (rápido)
export type BuyMode = 'recompra' | 'torneio'

export interface PokerOptions {
  mode: PokerMode
  /** duração da partida em minutos; 0 = sem limite */
  minutes: 0 | 15 | 30 | 45
  buy: BuyMode
}

export const DEFAULT_OPTIONS: PokerOptions = { mode: 'holdem', minutes: 30, buy: 'recompra' }

/** Números fixos da mesa (facilitado: nada disso muda durante a partida). */
export const TABLE = {
  startStack: 1000,
  smallBlind: 5,
  bigBlind: 10,
  /** limit: aposta/aumento fixo por rodada (pré-flop e flop = small bet; turn e river = big bet) */
  smallBet: 10,
  bigBet: 20,
  /** máximo de apostas+aumentos por rodada (bet + 3 raises) */
  capPerStreet: 4,
  /** modo 3 cartas: ante de todos e aposta fixa da única rodada */
  tresAnte: 10,
  tresBet: 20,
  /** tempo por decisão */
  actMs: 30_000,
  /** pausa entre o fim de uma mão (showdown) e a próxima */
  betweenHandsMs: 6_000,
  /** ausente por mais que isso: sai das próximas mãos até voltar */
  awayGraceMs: 60_000,
  maxPlayers: 8,
  minPlayers: 2
} as const

// ---------- ações (cliente -> servidor) ----------
/**
 * Facilitado: o cliente só diz a intenção; o valor é sempre calculado pelo servidor.
 * - check: passar (sem aposta pra pagar)
 * - call: pagar a aposta atual
 * - raise: apostar/aumentar o valor fixo da rodada
 * - allin: só é legal quando a pessoa não tem fichas para pagar/aumentar o valor fixo
 * - fold: desistir
 */
export type PokerAction = { kind: 'check' } | { kind: 'call' } | { kind: 'raise' } | { kind: 'allin' } | { kind: 'fold' }

/** O que a pessoa pode fazer agora, com valores já calculados para os botões. */
export type LegalAction =
  | { kind: 'check' }
  | { kind: 'call'; amount: number }
  | { kind: 'raise'; amount: number; to: number } // amount = fichas que saem agora; to = aposta total na rodada
  | { kind: 'allin'; amount: number }
  | { kind: 'fold' }

// ---------- avaliação de mão ----------
/** 0 carta alta ... 9 royal flush */
export type HandCategory = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

export interface HandInfo {
  category: HandCategory
  /** nome em português, pronto para a tela. Ex.: 'Par de Reis', 'Trinca de 7', 'Sequência até o 10', 'Flush de copas' */
  name: string
  /** as cartas que formam a mão (5 no Hold'em, 3 no modo 3 cartas), para acender na mesa */
  cards: Card[]
  /** a combinação (o par, a trinca, a sequência...) está inteira na mesa e vale para todos; só aparece na sua mão */
  onTable?: boolean
}

// ---------- visão (servidor -> cada pessoa) ----------
export type Street = 'preflop' | 'flop' | 'turn' | 'river'
export type Phase = Street | 'showdown' | 'intervalo' | 'fim'
export type SeatStatus = 'jogando' | 'desistiu' | 'allin' | 'zerado' | 'ausente' | 'fora'

export interface SeatView {
  playerId: string
  name: string
  seat: number // 0..7, posição na mesa
  stack: number
  /** aposta nesta rodada */
  bet: number
  status: SeatStatus
  dealer: boolean
  smallBlind: boolean
  bigBlind: boolean
  /** cartas visíveis para quem recebe a visão: as próprias, ou as de todos no showdown. null = viradas para baixo */
  cards: Card[] | null
  cardCount: number
  rebuys: number
  /** fichas atuais - (inicial + recompras). Base do ranking. */
  net: number
  lastAction: { kind: PokerAction['kind'] | 'blind' | 'ante'; amount: number } | null
  present: boolean
}

export interface PotView {
  amount: number
  /** quem disputa este pote */
  eligible: string[]
}

export interface ShowdownView {
  winners: { playerId: string; amount: number; hand: HandInfo | null }[]
  /** explicação pronta: 'Bia ganhou com Trinca de 7 (bateu o Par de Reis do Pedro)'. Sem hand quando todos desistiram. */
  explanation: string
}

export interface RankingEntry {
  playerId: string
  name: string
  net: number
  rebuys: number
  place: number
}

export interface PokerView {
  mode: PokerMode
  options: PokerOptions
  phase: Phase
  handNo: number
  /** fim da partida por tempo (ms epoch) ou null */
  endsAt: number | null
  seats: SeatView[]
  board: Card[]
  pots: PotView[]
  /** de quem é a vez e até quando */
  toAct: string | null
  actDeadline: number | null
  /** só para quem recebe a visão e só na vez dela */
  legal: LegalAction[]
  /** dados privados de quem recebe a visão (null para espectador ou quem não está na mão) */
  you: {
    playerId: string
    hand: Card[]
    /** melhor mão atual com as cartas visíveis (null antes de haver o suficiente) */
    best: HandInfo | null
    /** dicas: 'Falta 1 carta para sequência', 'Falta 1 carta para flush' */
    draws: string[]
  } | null
  showdown: ShowdownView | null
  /** só quando phase === 'fim' */
  ranking: RankingEntry[] | null
}

// ---------- eventos (servidor -> todos, para animação e som) ----------
export type PokerEvent =
  | { kind: 'shuffle'; handNo: number }
  | { kind: 'deal'; to: string[]; count: number } // cartas fechadas para cada um (sem revelar quais)
  | { kind: 'street'; street: Street; cards: Card[] } // cartas comunitárias reveladas
  | { kind: 'blind'; by: string; amount: number }
  | { kind: 'ante'; by: string; amount: number }
  | { kind: 'act'; by: string; action: PokerAction['kind']; amount: number }
  | { kind: 'timeout'; by: string }
  | { kind: 'reveal'; by: string; cards: Card[] }
  | { kind: 'win'; by: string; amount: number; potIndex: number }
  | { kind: 'rebuy'; by: string; amount: number }
  | { kind: 'away'; by: string; away: boolean }
  | { kind: 'end'; ranking: RankingEntry[] }
