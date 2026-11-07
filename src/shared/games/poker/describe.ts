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
  return { ev, info: toHandInfo(ev) }
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
