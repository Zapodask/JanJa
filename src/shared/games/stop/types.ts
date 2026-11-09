/** Stop (adedonha): uma letra, todo mundo preenche as categorias ao mesmo tempo. */

export type StopRounds = 3 | 5 | 8 | 10
export type StopSeconds = 0 | 60 | 90 | 120 | 180
export const STOP_ROUNDS: readonly StopRounds[] = [3, 5, 8, 10]
export const STOP_SECONDS: readonly StopSeconds[] = [0, 60, 90, 120, 180]

export interface StopOptions {
  categories: string[]
  rounds: StopRounds
  /** tempo de cada rodada (0 = só para quando alguém gritar STOP) */
  seconds: StopSeconds
}

/** depois do STOP: tempo para o que os outros estavam digitando chegar */
export const GRACE_MS = 3_000
/** conferência (votar "não vale") e placar entre rodadas */
export const REVIEW_MS = 60_000
export const SCORES_MS = 8_000
export const UNIQUE_POINTS = 10
export const SHARED_POINTS = 5

export type StopPhase = 'escrevendo' | 'parando' | 'conferindo' | 'placar' | 'fim'

export type Answers = Record<string, string>

export type StopAction =
  /** guarda as respostas (a tela manda sozinha enquanto a pessoa escreve) */
  | { type: 'write'; round: number; answers: Answers }
  /** STOP! (com tudo preenchido) */
  | { type: 'stop'; round: number; answers: Answers }
  /** marcar ou desmarcar "não vale" na resposta de alguém */
  | { type: 'vote'; round: number; target: string; category: string; invalid: boolean }
  /** terminou de conferir */
  | { type: 'ready'; round: number }

export interface StopPlayerView {
  playerId: string
  name: string
  total: number
  /** quantas categorias já preencheu na rodada (as respostas mesmo ficam escondidas) */
  filled: number
  ready: boolean
  away: boolean
}

export interface ReviewEntry {
  playerId: string
  answer: string
  /** começa com a letra e não está vazia */
  fits: boolean
  /** quantas pessoas marcaram "não vale" */
  votes: number
  /** você marcou "não vale" */
  mine: boolean
  /** caiu por votos */
  invalid: boolean
  /** pontos (depois de fechar a conferência) */
  points: number | null
}

export interface StopView {
  you: { playerId: string } | null
  players: StopPlayerView[]
  categories: Array<{ id: string; name: string; hint: string }>
  round: number
  rounds: number
  letter: string
  phase: StopPhase
  until: number | null
  serverNow: number
  /** as suas respostas como o servidor guardou (para voltar depois de cair) */
  myAnswers: Answers
  stoppedBy: string | null
  /** respostas de todos: só depois do STOP */
  review: Record<string, ReviewEntry[]> | null
  /** pontos de cada um em cada rodada */
  history: Array<{ letter: string; points: Record<string, number> }>
  ranking: Array<{ playerId: string; total: number; place: number }> | null
  log: string[]
}

export type StopEvent =
  | { type: 'round'; round: number; letter: string }
  | { type: 'stop'; by: string }
  | { type: 'review'; round: number }
  | { type: 'scores'; round: number; points: Record<string, number> }
  | { type: 'end'; ranking: Array<{ playerId: string; total: number; place: number }> }
