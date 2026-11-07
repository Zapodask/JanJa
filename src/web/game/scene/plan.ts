/**
 * Eventos do servidor -> fila de passos de animação (puro, sem Pixi nem GSAP).
 * O mesmo `seq` nunca anima duas vezes; a primeira montagem só desenha o estado.
 */
import type { Card, PokerEvent, RankingEntry, Street } from '../../../shared/games/poker/types'
import type { EventBatch } from '../contract'

export type Step =
  | { kind: 'shuffle'; ms: number }
  | { kind: 'deal'; to: string[]; count: number; ms: number }
  | { kind: 'street'; street: Street; cards: Card[]; ms: number }
  | { kind: 'chips'; by: string; amount: number; cause: 'blind' | 'ante' | 'call' | 'raise'; ms: number }
  | { kind: 'check'; by: string; ms: number }
  | { kind: 'fold'; by: string; ms: number }
  | { kind: 'allin'; by: string; amount: number; ms: number }
  | { kind: 'timeout'; by: string; ms: number }
  | { kind: 'reveal'; by: string; cards: Card[]; ms: number }
  | { kind: 'win'; by: string; amount: number; potIndex: number; ms: number }
  | { kind: 'rebuy'; by: string; amount: number; ms: number }
  | { kind: 'end'; ranking: RankingEntry[]; ms: number }

/** Duração nominal de cada passo (ms) antes do ajuste de velocidade. */
export function nominalMs(ev: Step['kind'], p: { cards?: number; to?: number; river?: boolean } = {}): number {
  switch (ev) {
    case 'shuffle':
      return 900
    case 'deal':
      return (p.to ?? 2) * (p.cards ?? 2) * 110 + 320
    case 'street':
      return (p.cards ?? 1) * 230 + 280 + (p.river ? 520 : 0)
    case 'chips':
      return 420
    case 'check':
      return 300
    case 'fold':
      return 380
    case 'allin':
      return 1500
    case 'timeout':
      return 600
    case 'reveal':
      return 460
    case 'win':
      return 1100
    case 'rebuy':
      return 800
    case 'end':
      return 2200
  }
}

export function planSteps(events: PokerEvent[]): Step[] {
  const steps: Step[] = []
  for (const e of events) {
    switch (e.kind) {
      case 'shuffle':
        steps.push({ kind: 'shuffle', ms: nominalMs('shuffle') })
        break
      case 'deal':
        if (e.to.length && e.count > 0) steps.push({ kind: 'deal', to: e.to, count: e.count, ms: nominalMs('deal', { to: e.to.length, cards: e.count }) })
        break
      case 'street':
        steps.push({ kind: 'street', street: e.street, cards: e.cards, ms: nominalMs('street', { cards: e.cards.length, river: e.street === 'river' }) })
        break
      case 'blind':
        steps.push({ kind: 'chips', by: e.by, amount: e.amount, cause: 'blind', ms: nominalMs('chips') })
        break
      case 'ante':
        steps.push({ kind: 'chips', by: e.by, amount: e.amount, cause: 'ante', ms: nominalMs('chips') })
        break
      case 'act':
        if (e.action === 'check') steps.push({ kind: 'check', by: e.by, ms: nominalMs('check') })
        else if (e.action === 'fold') steps.push({ kind: 'fold', by: e.by, ms: nominalMs('fold') })
        else if (e.action === 'allin') steps.push({ kind: 'allin', by: e.by, amount: e.amount, ms: nominalMs('allin') })
        else steps.push({ kind: 'chips', by: e.by, amount: e.amount, cause: e.action === 'call' ? 'call' : 'raise', ms: nominalMs('chips') })
        break
      case 'timeout':
        steps.push({ kind: 'timeout', by: e.by, ms: nominalMs('timeout') })
        break
      case 'reveal':
        steps.push({ kind: 'reveal', by: e.by, cards: e.cards, ms: nominalMs('reveal') })
        break
      case 'win':
        steps.push({ kind: 'win', by: e.by, amount: e.amount, potIndex: e.potIndex, ms: nominalMs('win') })
        break
      case 'rebuy':
        steps.push({ kind: 'rebuy', by: e.by, amount: e.amount, ms: nominalMs('rebuy') })
        break
      case 'end':
        steps.push({ kind: 'end', ranking: e.ranking, ms: nominalMs('end') })
        break
      case 'away':
        break
    }
  }
  return steps
}

export const totalMs = (steps: Step[]) => steps.reduce((a, s) => a + s.ms, 0)

/**
 * Porta do seq: a primeira vez só registra (montagem = desenhar o estado);
 * depois cada seq novo anima uma vez.
 */
export class SeqGate {
  private last: number | null | undefined = undefined
  accept(batch: EventBatch | null): boolean {
    if (this.last === undefined) {
      this.last = batch ? batch.seq : null
      return false
    }
    if (!batch || batch.seq === this.last) return false
    this.last = batch.seq
    return true
  }
}

/** Multiplicador de duração conforme o acúmulo na fila (0 = cortes secos). */
export function timeScale(backlogMs: number, reduced: boolean): number {
  if (reduced) return 0
  if (backlogMs <= 4500) return 1
  if (backlogMs <= 8000) return 0.6
  if (backlogMs <= 14000) return 0.35
  return 0
}

/** Texto do balão (sem caixa alta). null = sem balão. */
export function bubbleText(s: Step): string | null {
  switch (s.kind) {
    case 'chips':
      if (s.cause === 'blind') return `Blind ${s.amount}`
      if (s.cause === 'ante') return `Ante ${s.amount}`
      return s.cause === 'call' ? `Pagou ${s.amount}` : `Apostou ${s.amount}`
    case 'check':
      return 'Passou'
    case 'fold':
      return 'Desistiu'
    case 'allin':
      return `Tudo! ${s.amount}`
    case 'timeout':
      return 'Tempo!'
    case 'win':
      return `Ganhou ${s.amount}`
    case 'rebuy':
      return `Recomprou ${s.amount}`
    default:
      return null
  }
}
