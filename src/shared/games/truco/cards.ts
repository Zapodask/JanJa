/**
 * Baralho espanhol de 40 cartas (sem 8, 9 e coringas) e as contas do truco gaudério.
 * Carta = número + naipe: "1e" (ás de espadas), "12c" (rei de copas).
 * Naipes: e = espadas, b = paus (bastos), o = ouros, c = copas.
 */
export type Suit = 'e' | 'b' | 'o' | 'c'
export type Card = string

export const SUITS: readonly Suit[] = ['e', 'b', 'o', 'c']
export const RANKS = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12] as const
export const DECK: readonly Card[] = SUITS.flatMap((s) => RANKS.map((r) => `${r}${s}`))

export const rankOf = (c: Card): number => Number(c.slice(0, -1))
export const suitOf = (c: Card): Suit => c.slice(-1) as Suit

/**
 * Força no truco (maior ganha): espadão, bastião, 7 de espadas, 7 de ouros, os 3, os 2,
 * ases falsos (copas e ouros), reis, cavalos, sotas, setes falsos (copas e paus), 6, 5, 4.
 */
export function power(c: Card): number {
  switch (c) {
    case '1e':
      return 14
    case '1b':
      return 13
    case '7e':
      return 12
    case '7o':
      return 11
  }
  const r = rankOf(c)
  if (r === 3) return 10
  if (r === 2) return 9
  if (r === 1) return 8
  if (r === 12) return 7
  if (r === 11) return 6
  if (r === 10) return 5
  if (r === 7) return 4
  return r - 3 // 6 -> 3, 5 -> 2, 4 -> 1
}

/** valor da carta no envido e na flor: figuras (10, 11, 12) valem 0 */
export const envidoValue = (c: Card): number => (rankOf(c) >= 10 ? 0 : rankOf(c))

/** Pontos de envido: duas do mesmo naipe = 20 + as duas maiores; senão, a maior carta. */
export function envidoPoints(cards: readonly Card[]): number {
  let best = Math.max(0, ...cards.map(envidoValue))
  for (const s of SUITS) {
    const vals = cards
      .filter((c) => suitOf(c) === s)
      .map(envidoValue)
      .sort((a, b) => b - a)
    if (vals.length >= 2) best = Math.max(best, 20 + vals[0] + vals[1])
  }
  return best
}

/** Flor: as três do mesmo naipe. Vale 20 + a soma das três (para comparar flores). */
export function florPoints(cards: readonly Card[]): number | null {
  if (cards.length !== 3 || !cards.every((c) => suitOf(c) === suitOf(cards[0]))) return null
  return 20 + cards.reduce((a, c) => a + envidoValue(c), 0)
}

const SUIT_NAME: Record<Suit, string> = { e: 'espadas', b: 'paus', o: 'ouros', c: 'copas' }
const RANK_NAME: Record<number, string> = { 1: 'Ás', 10: 'Sota', 11: 'Cavalo', 12: 'Rei' }

/** "7 de espadas", "Ás de paus", "Rei de copas" */
export function cardName(c: Card): string {
  const r = rankOf(c)
  return `${RANK_NAME[r] ?? String(r)} de ${SUIT_NAME[suitOf(c)]}`
}
