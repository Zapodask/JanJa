/** Baralho e utilidades de carta. Tudo puro. */
import { RANKS, SUITS, type Card, type Rank, type Suit } from './types'

/** valor numérico do rank: 2..14 (A=14) */
const RANK_VALUE: Record<Rank, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10, J: 11, Q: 12, K: 13, A: 14
}
const VALUE_RANK: Rank[] = [] // índice = valor
for (const r of RANKS) VALUE_RANK[RANK_VALUE[r]] = r

export const rankValue = (c: Card): number => RANK_VALUE[c[0] as Rank]
export const suitOf = (c: Card): Suit => c[1] as Suit
export const makeCard = (value: number, suit: Suit): Card => `${VALUE_RANK[value]}${suit}` as Card

/** baralho completo ordenado (52 cartas) */
export function fullDeck(): Card[] {
  const d: Card[] = []
  for (const s of SUITS) for (const r of RANKS) d.push(`${r}${s}` as Card)
  return d
}

export function isCard(x: unknown): x is Card {
  return typeof x === 'string' && x.length === 2 && x[0] in RANK_VALUE && (SUITS as readonly string[]).includes(x[1])
}

/** converte texto como 'As Kd' ou 'AsKd' em cartas; lança se inválido (útil em testes) */
export function parseCards(text: string): Card[] {
  const t = text.replace(/\s+/g, '')
  if (t.length % 2 !== 0) throw new Error(`cartas inválidas: ${text}`)
  const out: Card[] = []
  for (let i = 0; i < t.length; i += 2) {
    const c = t.slice(i, i + 2)
    if (!isCard(c)) throw new Error(`carta inválida: ${c}`)
    out.push(c)
  }
  return out
}

export const SUIT_NAME: Record<Suit, string> = { c: 'paus', d: 'ouros', h: 'copas', s: 'espadas' }

/** nome singular do valor: 2..10, Valete, Dama, Rei, Ás */
export function rankName(v: number): string {
  if (v <= 10) return String(v)
  return ['Valete', 'Dama', 'Rei', 'Ás'][v - 11]
}

/** plural para "Par de ...": figuras no plural, números como estão */
export function rankPlural(v: number): string {
  if (v <= 10) return String(v)
  return ['Valetes', 'Damas', 'Reis', 'Ases'][v - 11]
}
