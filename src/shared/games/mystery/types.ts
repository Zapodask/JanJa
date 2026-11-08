/** um palpite ou acusação: quem, onde e com o quê (ids das cartas) */
export interface Triple {
  quem: string
  onde: string
  como: string
}

export type MysteryOptions = Record<string, never>

/** prazos: palpitar (ou acusar), mostrar carta e terminar a vez; quem saiu da sala joga rápido */
export const SUGGEST_MS = 60_000
export const SHOW_MS = 30_000
export const AFTER_MS = 30_000
export const AWAY_MS = 3_000

export type MysteryAction =
  | ({ type: 'suggest' } & Triple)
  | ({ type: 'accuse' } & Triple)
  | { type: 'show'; card: string }
  /** passar a vez (sem palpite) ou terminar depois do palpite */
  | { type: 'end' }

export type MysteryPhase = 'palpite' | 'mostrar' | 'depois' | 'fim'

export interface MysteryPlayerView {
  playerId: string
  name: string
  index: number
  cards: number
  /** errou a acusação: não joga mais, mas continua mostrando cartas */
  out: boolean
  away: boolean
}

export interface SuggestionView extends Triple {
  by: number
  /** quem mostrou (null = ninguém tinha; undefined = ainda procurando) */
  shownBy: number | null
  /** a carta mostrada: só aparece para quem palpitou e para quem mostrou */
  card?: string
}

export interface MysteryView {
  you: { playerId: string; index: number } | null
  players: MysteryPlayerView[]
  /** as suas cartas (só as suas) */
  myCards: string[]
  phase: MysteryPhase
  turn: number | null
  /** palpite em andamento */
  current: SuggestionView | null
  /** quem tem que mostrar agora */
  refuter: number | null
  /** se é você que tem que mostrar: quais das suas cartas servem */
  myChoices: string[]
  history: SuggestionView[]
  accusations: Array<Triple & { by: number; correct: boolean }>
  /** a solução: para quem errou a acusação (em segredo) e para todos no fim */
  solution: Triple | null
  winner: number | null
  until: number | null
  serverNow: number
  log: string[]
}

export type MysteryEvent =
  | { type: 'start'; first: number }
  | ({ type: 'suggest'; by: number } & Triple)
  | { type: 'shown'; by: number; to: number }
  | { type: 'none'; by: number }
  | ({ type: 'accuse'; by: number; correct: boolean } & Triple)
  | { type: 'end'; winner: number | null; solution: Triple }
