/** Nomes em português e dicas ("draws"). Tudo puro. */
import { rankName, rankPlural, rankValue, suitOf, SUIT_NAME } from './cards'
import { evaluate, evaluate3, type Evaluated } from './evaluate'
import type { Card, HandInfo, PokerMode, Suit } from './types'

/** "o 10", "a Dama": artigo para "até ..." */
const upTo = (v: number): string => `${v === 12 ? 'a' : 'o'} ${rankName(v)}`

export function handName(ev: Evaluated): string {
  const t = ev.tb
  switch (ev.category) {
    case 0: return t[0] === 12 ? 'Dama alta' : `${rankName(t[0])} alto`
    case 1: return `Par de ${rankPlural(t[0])}`
    case 2: return `Dois pares, ${rankPlural(t[0])} e ${rankPlural(t[1])}`
    case 3: return `Trinca de ${rankPlural(t[0])}`
    case 4: return `Sequência até ${upTo(t[0])}`
    case 5: return `Flush de ${SUIT_NAME[ev.suit as Suit]}`
    case 6: return `Full house, ${rankPlural(t[0])} com ${rankPlural(t[1])}`
    case 7: return `Quadra de ${rankPlural(t[0])}`
    case 8: return `Straight flush até ${upTo(t[0])}`
    default: return 'Royal flush'
  }
}

export const toHandInfo = (ev: Evaluated): HandInfo => ({ category: ev.category, name: handName(ev), cards: ev.cards })

/** nome com artigo para frases: "o Par de Reis", "a Trinca de 7", "os Dois pares, ..." */
export function handNameWithArticle(ev: Evaluated): string {
  const name = handName(ev)
  if (ev.category === 2) return `os ${name}`
  if (ev.category === 3 || ev.category === 4 || ev.category === 7) return `a ${name}`
  if (ev.category === 0 && ev.tb[0] === 12) return `a ${name}`
  return `o ${name}`
}

/** "do Pedro" / "da Bia" (heurística: nome terminado em "a" = feminino) */
export function dePessoa(name: string): string {
  return /a$/i.test(name.trim()) ? `da ${name}` : `do ${name}`
}

/** cartas que formam a combinação em si (sem as de desempate): o par, os dois pares, a trinca, a quadra; nas mãos de 5, todas */
export function coreCards(ev: Evaluated): Card[] {
  switch (ev.category) {
    case 0: return []
    case 1: return ev.cards.slice(0, 2)
    case 2: return ev.cards.slice(0, 4)
    case 3: return ev.cards.slice(0, 3)
    case 7: return ev.cards.slice(0, 4)
    default: return ev.cards
  }
}

/** a combinação está toda na mesa (vale para todo mundo)? Carta alta nunca conta como "da mesa". */
export function isOnTable(ev: Evaluated, hole: readonly Card[]): boolean {
  const core = coreCards(ev)
  return core.length > 0 && core.every((c) => !hole.includes(c))
}

/**
 * Quando as duas mãos têm o mesmo nome (ex.: os dois com Par de Valetes), o que decidiu.
 * Ex.: { rule: 'vale a carta mais alta de fora', win: 'Ás', lose: '9' }. null se os nomes diferem ou se empataram.
 */
export function tieBreak(w: Evaluated, l: Evaluated): { rule: string; win: string; lose: string } | null {
  if (w.category !== l.category || handName(w) !== handName(l) || w.value === l.value) return null
  const n = Math.max(w.tb.length, l.tb.length)
  for (let i = 0; i < n; i++) {
    const a = w.tb[i] ?? 0
    const b = l.tb[i] ?? 0
    if (a === b) continue
    const rule =
      w.category === 0
        ? i === 0
          ? 'vale a carta mais alta'
          : 'vale a próxima carta mais alta'
        : w.category === 5
          ? 'vale a carta mais alta do flush'
          : 'vale a carta mais alta de fora'
    return { rule, win: rankName(a), lose: rankName(b) }
  }
  return null
}

/** melhor mão com as cartas visíveis; null se não houver cartas */
export function bestHand(mode: PokerMode, hole: readonly Card[], board: readonly Card[]): { ev: Evaluated; info: HandInfo } | null {
  const all = [...hole, ...board]
  if (mode === 'tres') {
    if (all.length !== 3) return null
    const ev = evaluate3(all)
    return { ev, info: toHandInfo(ev) }
  }
  if (all.length < 2) return null
  const ev = evaluate(all)
  const info = toHandInfo(ev)
  if (board.length > 0 && isOnTable(ev, hole)) info.onTable = true
  return { ev, info }
}

/**
 * Dicas só do Hold'em, antes do river. Só conta se alguma carta da mão faz parte do projeto
 * (jogar só com a mesa não é um projeto da pessoa).
 */
export function drawHints(hole: readonly Card[], board: readonly Card[], category: number): string[] {
  if (board.length >= 5 || hole.length < 2) return []
  const all = [...hole, ...board]
  const out: string[] = []

  if (category < 5) {
    const counts: Record<Suit, number> = { c: 0, d: 0, h: 0, s: 0 }
    for (const c of all) counts[suitOf(c)]++
    for (const s of ['c', 'd', 'h', 's'] as Suit[]) {
      if (counts[s] === 4 && hole.some((c) => suitOf(c) === s)) { out.push('Falta 1 carta para flush'); break }
    }
  }
  if (category < 4) {
    const have: boolean[] = []
    const mine: boolean[] = []
    for (const c of all) have[rankValue(c)] = true
    for (const c of hole) mine[rankValue(c)] = true
    let found = false
    for (let high = 14; high >= 5 && !found; high--) {
      let n = 0, usesMine = false
      for (let k = 0; k < 5; k++) {
        const v = high - k === 1 ? 14 : high - k
        if (have[v]) { n++; if (mine[v]) usesMine = true }
      }
      if (n === 4 && usesMine) found = true
    }
    if (found) out.push('Falta 1 carta para sequência')
  }
  return out
}
