/**
 * Avaliador de mãos. `evaluate` aceita de 1 a 7 cartas (melhor mão de até 5);
 * `evaluate3` é o ranking do modo 3 cartas. `value` é comparável entre mãos do mesmo avaliador.
 */
import { makeCard, rankValue, suitOf } from './cards'
import type { Card, HandCategory, Suit } from './types'

export interface Evaluated {
  category: HandCategory
  /** inteiro comparável: maior vence, igual empata */
  value: number
  /** desempate em ordem de importância (valores 2..14). Straight: [alta] (roda = 5) */
  tb: number[]
  /** naipe, só para flush/straight flush */
  suit: Suit | null
  /** as cartas que formam a mão (até 5; 3 no modo 3 cartas) */
  cards: Card[]
}

const SUIT_LIST: Suit[] = ['c', 'd', 'h', 's']

/** maior "alta" de sequência dentro de um conjunto de valores (A vale 1 ou 14), ou 0 */
function straightHigh(present: boolean[]): number {
  for (let high = 14; high >= 5; high--) {
    let ok = true
    for (let k = 0; k < 5; k++) {
      const v = high - k === 1 ? 14 : high - k
      if (!present[v]) { ok = false; break }
    }
    if (ok) return high
  }
  return 0
}

const pack = (cat: number, tb: number[]): number => {
  let v = cat
  for (let i = 0; i < 5; i++) v = v * 16 + (tb[i] ?? 0)
  return v
}

export function evaluate(input: readonly Card[]): Evaluated {
  const cards = input
  const byRank: Card[][] = Array.from({ length: 15 }, () => [])
  const bySuit: Record<Suit, Card[]> = { c: [], d: [], h: [], s: [] }
  for (const c of cards) {
    byRank[rankValue(c)].push(c)
    bySuit[suitOf(c)].push(c)
  }
  const done = (category: HandCategory, tb: number[], picked: Card[], suit: Suit | null = null): Evaluated =>
    ({ category, value: pack(category, tb), tb, suit, cards: picked })

  // flush / straight flush
  let flushSuit: Suit | null = null
  for (const s of SUIT_LIST) if (bySuit[s].length >= 5) flushSuit = s
  if (flushSuit) {
    const pres: boolean[] = []
    for (const c of bySuit[flushSuit]) pres[rankValue(c)] = true
    const high = straightHigh(pres)
    if (high) {
      const picked: Card[] = []
      for (let k = 0; k < 5; k++) picked.push(makeCard(high - k === 1 ? 14 : high - k, flushSuit))
      return done(high === 14 ? 9 : 8, [high], picked, flushSuit)
    }
  }

  // grupos por quantidade, do maior valor para o menor
  const quads: number[] = [], trips: number[] = [], pairs: number[] = []
  for (let v = 14; v >= 2; v--) {
    const n = byRank[v].length
    if (n === 4) quads.push(v)
    else if (n === 3) trips.push(v)
    else if (n === 2) pairs.push(v)
  }
  const kickers = (exclude: number[], count: number): number[] => {
    const out: number[] = []
    for (let v = 14; v >= 2 && out.length < count; v--) if (byRank[v].length && !exclude.includes(v)) out.push(v)
    return out
  }
  const take = (v: number, n: number): Card[] => byRank[v].slice(0, n)

  if (quads.length) {
    const q = quads[0]
    const k = kickers([q], 1)
    return done(7, [q, ...k], [...take(q, 4), ...k.flatMap((v) => take(v, 1))])
  }
  // full house: trinca + melhor par (inclui outra trinca)
  if (trips.length && (trips.length > 1 || pairs.length)) {
    const t = trips[0]
    const p = trips.length > 1 ? Math.max(trips[1], pairs[0] ?? 0) : pairs[0]
    return done(6, [t, p], [...take(t, 3), ...take(p, 2)])
  }
  if (flushSuit) {
    const top = bySuit[flushSuit].map(rankValue).sort((a, b) => b - a).slice(0, 5)
    return done(5, top, top.map((v) => makeCard(v, flushSuit as Suit)), flushSuit)
  }
  const pres: boolean[] = []
  for (let v = 2; v <= 14; v++) pres[v] = byRank[v].length > 0
  const high = straightHigh(pres)
  if (high) {
    const picked: Card[] = []
    for (let k = 0; k < 5; k++) picked.push(byRank[high - k === 1 ? 14 : high - k][0])
    return done(4, [high], picked)
  }
  if (trips.length) {
    const t = trips[0]
    const k = kickers([t], 2)
    return done(3, [t, ...k], [...take(t, 3), ...k.flatMap((v) => take(v, 1))])
  }
  if (pairs.length >= 2) {
    const [a, b] = pairs
    const k = kickers([a, b], 1)
    return done(2, [a, b, ...k], [...take(a, 2), ...take(b, 2), ...k.flatMap((v) => take(v, 1))])
  }
  if (pairs.length === 1) {
    const a = pairs[0]
    const k = kickers([a], 3)
    return done(1, [a, ...k], [...take(a, 2), ...k.flatMap((v) => take(v, 1))])
  }
  const k = kickers([], 5)
  return done(0, k, k.flatMap((v) => take(v, 1)))
}

/**
 * Modo 3 cartas: straight flush > trinca > sequência > flush > par > carta alta.
 * A-2-3 é a sequência mais baixa; A-K-Q a mais alta. `category` usa o rótulo padrão
 * (3 trinca, 4 sequência, 5 flush, 8 straight flush, 9 para A-K-Q do mesmo naipe),
 * mas a ordem de força está em `value`.
 */
export function evaluate3(input: readonly Card[]): Evaluated {
  if (input.length !== 3) throw new Error('evaluate3 exige 3 cartas')
  const sorted = [...input].sort((a, b) => rankValue(b) - rankValue(a))
  const v = sorted.map(rankValue)
  const flush = suitOf(sorted[0]) === suitOf(sorted[1]) && suitOf(sorted[1]) === suitOf(sorted[2])
  let straightTop = 0
  if (v[0] - 1 === v[1] && v[1] - 1 === v[2]) straightTop = v[0]
  else if (v[0] === 14 && v[1] === 3 && v[2] === 2) straightTop = 3 // A-2-3
  const mk = (tier: number, category: HandCategory, tb: number[], picked: Card[], suit: Suit | null = null): Evaluated => {
    let val = tier
    for (let i = 0; i < 3; i++) val = val * 16 + (tb[i] ?? 0)
    return { category, value: val, tb, suit, cards: picked }
  }
  const suit = flush ? suitOf(sorted[0]) : null
  if (flush && straightTop) {
    // ordena as cartas da sequência do alto para o baixo (A-2-3: 3,2,A)
    const ordered = straightTop === 3 ? [sorted[1], sorted[2], sorted[0]] : sorted
    return mk(5, straightTop === 14 ? 9 : 8, [straightTop], ordered, suit)
  }
  if (v[0] === v[1] && v[1] === v[2]) return mk(4, 3, [v[0]], sorted)
  if (straightTop) return mk(3, 4, [straightTop], straightTop === 3 ? [sorted[1], sorted[2], sorted[0]] : sorted)
  if (flush) return mk(2, 5, v, sorted, suit)
  if (v[0] === v[1]) return mk(1, 1, [v[0], v[2]], sorted)
  if (v[1] === v[2]) return mk(1, 1, [v[1], v[0]], [sorted[1], sorted[2], sorted[0]])
  return mk(0, 0, v, sorted)
}
