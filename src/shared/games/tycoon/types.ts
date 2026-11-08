/** Magnata: jogo rápido de comprar cidades, cobrar aluguel e quebrar os outros. */

export type TycoonMinutes = 0 | 15 | 25 | 40
export const TYCOON_MINUTES: readonly TycoonMinutes[] = [0, 15, 25, 40]

export interface TycoonOptions {
  /** fim por tempo (0 = só termina por vitória ou falência) */
  minutes: TycoonMinutes
}

export const DEFAULT_TYCOON_OPTIONS: TycoonOptions = { minutes: 25 }

export const START_CASH = 1500
export const SALARY = 200
export const JAM_FINE = 100
export const FLY_FEE = 50
/** turnos presos no engarrafamento */
export const JAM_TURNS = 3
/** compra de uma cidade de outra pessoa: vezes o que ela investiu */
export const TAKEOVER_MULT = 2
/** construir na hora da compra vai só até 3 casas; o hotel vem quando cair de novo */
export const MAX_BUY_LEVEL = 3
/** tempo para rolar e para decidir; quem está fora da sala joga sozinho rápido */
export const ROLL_MS = 15_000
export const DECIDE_MS = 20_000
export const AWAY_MS = 2_500

export type TycoonAction =
  | { type: 'roll'; pay?: boolean }
  | { type: 'buy'; level: number }
  | { type: 'build'; level: number }
  | { type: 'takeover' }
  | { type: 'festival'; tile: number }
  | { type: 'fly'; tile: number }
  | { type: 'pass' }

export type TycoonPhase =
  | { kind: 'rolar' }
  | { kind: 'comprar'; tile: number }
  | { kind: 'construir'; tile: number }
  | { kind: 'tomar'; tile: number }
  | { kind: 'festival' }
  | { kind: 'voar' }
  | { kind: 'fim' }

export type TycoonEndReason = 'grupos' | 'lado' | 'praias' | 'falencia' | 'tempo'

export interface TycoonResult {
  winner: string | null
  reason: TycoonEndReason
  /** do mais rico para o mais pobre (quem quebrou fica no fim, na ordem em que saiu) */
  ranking: Array<{ playerId: string; worth: number; place: number }>
}

export interface TycoonPlayerView {
  playerId: string
  name: string
  cash: number
  /** dinheiro + o que tem investido */
  worth: number
  position: number
  /** turnos que ainda faltam presos no engarrafamento (0 = livre) */
  jam: number
  out: boolean
  away: boolean
}

/** O que a pessoa da vez pode escolher agora, com os valores já calculados. */
export type TycoonPending =
  | { kind: 'rolar'; jammed: boolean; fine: number }
  | { kind: 'comprar'; tile: number; options: Array<{ level: number; cost: number }> }
  | { kind: 'construir'; tile: number; from: number; options: Array<{ level: number; cost: number }> }
  | { kind: 'tomar'; tile: number; price: number; owner: string }
  | { kind: 'festival'; tiles: number[] }
  | { kind: 'voar'; fee: number; tiles: number[] }

export interface TycoonView {
  you: { playerId: string } | null
  players: TycoonPlayerView[]
  /** casa -> dono e nível (só as compradas) */
  props: Record<number, { owner: string; level: number }>
  /** aluguel que se paga agora em cada casa comprada (com grupo e festival) */
  rents: Record<number, number>
  festival: number | null
  turn: string | null
  pending: TycoonPending | null
  /** prazo da decisão atual (ms epoch) */
  until: number | null
  /** fim da partida por tempo (ms epoch) */
  endsAt: number | null
  serverNow: number
  dice: [number, number] | null
  /** sobe a cada rolagem (a cena anima os dados) */
  rolls: number
  log: string[]
  result: TycoonResult | null
}

export type TycoonEvent =
  | { type: 'start'; order: string[] }
  | { type: 'roll'; playerId: string; dice: [number, number] }
  | { type: 'move'; playerId: string; from: number; to: number; walk: boolean }
  | { type: 'salary'; playerId: string; amount: number }
  | { type: 'buy'; playerId: string; tile: number; level: number }
  | { type: 'build'; playerId: string; tile: number; level: number }
  | { type: 'pay'; from: string; to: string | null; amount: number; why: 'aluguel' | 'imposto' | 'multa' | 'carta' | 'voo' | 'tomada' }
  | { type: 'takeover'; playerId: string; from: string; tile: number; price: number }
  | { type: 'card'; playerId: string; text: string }
  | { type: 'jam'; playerId: string }
  | { type: 'festival'; tile: number }
  | { type: 'sell'; playerId: string; tile: number; amount: number }
  | { type: 'bankrupt'; playerId: string }
  | { type: 'end'; result: TycoonResult }

export function describeEnd(r: TycoonResult, nameOf: (id: string) => string): string {
  const w = r.winner ? nameOf(r.winner) : ''
  switch (r.reason) {
    case 'grupos':
      return `${w} fechou três grupos de cidades e venceu.`
    case 'lado':
      return `${w} comprou todas as cidades de um lado do tabuleiro e venceu.`
    case 'praias':
      return `${w} ficou com as quatro praias e venceu.`
    case 'falencia':
      return `Todo mundo quebrou, menos ${w}.`
    case 'tempo':
      return w ? `O tempo acabou. ${w} tinha mais patrimônio.` : 'O tempo acabou.'
  }
}

/** "$ 1.500" (sem Intl: o texto sai igual no Worker e no navegador) */
export function money(n: number): string {
  const v = Math.round(Math.abs(n))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${n < 0 ? '-' : ''}$ ${v}`
}
