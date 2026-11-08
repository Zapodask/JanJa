import { describe, expect, it } from 'vitest'
import { ALL_CARDS, tripleText } from '../../src/shared/games/mystery/cards'
import { apply, nextDeadline, setPresence, setup, tick, view, type MysteryState } from '../../src/shared/games/mystery/engine'
import { AWAY_MS, SHOW_MS, SUGGEST_MS, type MysteryAction, type Triple } from '../../src/shared/games/mystery/types'
import { isGameError, seededRng, type GameCtx } from '../../src/shared/games/types'

const T0 = 1_000_000
const ctx = (now = T0): GameCtx => ({ now, rng: seededRng(4) })
const players = (n: number) => ['Ana', 'Bia', 'Caio', 'Duda'].slice(0, n).map((name, i) => ({ playerId: `p${i}`, name }))
const SOL: Triple = { quem: 'bene', onde: 'porao', como: 'lanterna' }

/** mesa combinada: Ana começa, mãos e solução fixas */
function table(hands: string[][]): MysteryState {
  const s = setup(players(hands.length), {}, ctx()).state
  s.hands = hands
  s.solution = { ...SOL }
  s.turn = 0
  return s
}
function act(s: MysteryState, p: number, a: MysteryAction, now = T0): MysteryState {
  const r = apply(s, `p${p}`, a, ctx(now))
  if (isGameError(r)) throw new Error(r.message)
  return r.state
}
const suggest = (s: MysteryState, p: number, t: Triple) => act(s, p, { type: 'suggest', ...t })

describe('Mistério', () => {
  it('uma de cada no envelope e o resto distribuído, sem repetir', () => {
    for (const n of [2, 3, 4, 5, 6]) {
      const s = setup(
        Array.from({ length: n }, (_, i) => ({ playerId: `p${i}`, name: `P${i}` })),
        {},
        ctx()
      ).state
      const dealt = s.hands.flat()
      expect(dealt).toHaveLength(ALL_CARDS.length - 3)
      expect(new Set([...dealt, s.solution.quem, s.solution.onde, s.solution.como]).size).toBe(ALL_CARDS.length)
      const sizes = s.hands.map((h) => h.length)
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1)
    }
  })

  it('texto do palpite com as preposições certas', () => {
    expect(tripleText({ quem: 'bene', onde: 'porao', como: 'lanterna' })).toBe('Tio Bené, no Porão, com a Lanterna')
    expect(tripleText({ quem: 'odete', onde: 'cozinha', como: 'pe-de-cabra' })).toBe('Dona Odete, na Cozinha, com o Pé de cabra')
  })

  it('quem mostra é o próximo da roda que tem alguma; com uma só, o jogo mostra sozinho', () => {
    let s = table([['odete'], ['valdir'], ['cozinha'], ['lia']])
    s = suggest(s, 0, { quem: 'lia', onde: 'cozinha', como: 'escada' })
    // Bia não tem nenhuma; Caio tem a Cozinha (uma só): mostra sozinho, antes da Duda
    expect(s.phase).toBe('depois')
    expect(s.history[0]).toMatchObject({ shownBy: 2, card: 'cozinha' })
  })

  it('a carta mostrada só aparece para quem palpitou e para quem mostrou', () => {
    let s = table([['odete'], ['cozinha'], ['valdir']])
    s = suggest(s, 0, { quem: 'lia', onde: 'cozinha', como: 'escada' })
    expect(view(s, 'p0', T0).history[0].card).toBe('cozinha')
    expect(view(s, 'p1', T0).history[0].card).toBe('cozinha')
    expect(view(s, 'p2', T0).history[0].card).toBeUndefined()
    expect(view(s, 'p2', T0).history[0].shownBy).toBe(1)
    expect(view(s, null, T0).history[0].card).toBeUndefined()
    expect(JSON.stringify(view(s, 'p2', T0).players)).not.toContain('cozinha')
    expect(view(s, 'p2', T0).solution).toBeNull()
  })

  it('com mais de uma, quem mostra escolhe (e só entre as que servem)', () => {
    let s = table([['odete'], ['lia', 'cozinha', 'tesoura']])
    s = suggest(s, 0, { quem: 'lia', onde: 'cozinha', como: 'escada' })
    expect(s.phase).toBe('mostrar')
    expect(view(s, 'p1', T0).myChoices).toEqual(['lia', 'cozinha'])
    expect(view(s, 'p0', T0).myChoices).toEqual([])
    expect(isGameError(apply(s, 'p1', { type: 'show', card: 'tesoura' }, ctx()))).toBe(true)
    expect(isGameError(apply(s, 'p0', { type: 'show', card: 'odete' }, ctx()))).toBe(true)
    s = act(s, 1, { type: 'show', card: 'lia' })
    expect(view(s, 'p0', T0).history[0].card).toBe('lia')
    // depois do palpite: acusa ou termina a vez
    s = act(s, 0, { type: 'end' })
    expect(s.turn).toBe(1)
  })

  it('ninguém tem: fica registrado e quem palpitou segue', () => {
    let s = table([['odete'], ['valdir']])
    s = suggest(s, 0, SOL)
    expect(s.history[0].shownBy).toBeNull()
    expect(s.phase).toBe('depois')
  })

  it('acusação certa vence; errada sai, vê a solução e continua mostrando cartas', () => {
    let s = table([['odete'], ['valdir'], ['lia']])
    s = act(s, 0, { type: 'accuse', quem: 'rafa', onde: 'porao', como: 'lanterna' })
    expect(s.players[0].out).toBe(true)
    expect(view(s, 'p0', T0).solution).toEqual(SOL)
    expect(view(s, 'p1', T0).solution).toBeNull()
    expect(s.turn).toBe(1)
    // quem saiu ainda mostra carta
    s = suggest(s, 1, { quem: 'lia', onde: 'jardim', como: 'escada' })
    s = act(s, 1, { type: 'end' })
    expect(s.turn).toBe(2) // Ana saiu: não joga mais
    s = act(s, 2, { type: 'accuse', ...SOL })
    expect(s.phase).toBe('fim')
    expect(s.winner).toBe(2)
    expect(view(s, 'p1', T0).solution).toEqual(SOL)
  })

  it('sobrou um no jogo: ele vence', () => {
    let s = table([['odete'], ['valdir']])
    s = act(s, 0, { type: 'accuse', quem: 'rafa', onde: 'porao', como: 'lanterna' })
    expect(s.phase).toBe('fim')
    expect(s.winner).toBe(1)
  })

  it('não dá para palpitar duas vezes nem jogar fora da vez', () => {
    let s = table([['odete'], ['valdir']])
    expect(isGameError(apply(s, 'p1', { type: 'suggest', ...SOL }, ctx()))).toBe(true)
    s = suggest(s, 0, SOL)
    expect(isGameError(apply(s, 'p0', { type: 'suggest', ...SOL }, ctx()))).toBe(true)
  })

  it('prazos: passa a vez sozinho e mostra a primeira carta que servir', () => {
    let s = table([['odete'], ['lia', 'cozinha']])
    expect(nextDeadline(s)).toBe(T0 + SUGGEST_MS)
    s = tick(s, ctx(T0 + SUGGEST_MS)).state
    expect(s.turn).toBe(1)
    s = table([['odete'], ['lia', 'cozinha']])
    s = suggest(s, 0, { quem: 'lia', onde: 'cozinha', como: 'escada' })
    s = tick(s, ctx(T0 + SHOW_MS)).state
    expect(s.history[0]).toMatchObject({ shownBy: 1, card: 'lia' })
  })

  it('quem sai da sala na vez dele joga rápido', () => {
    const s = table([['odete'], ['valdir']])
    expect(setPresence(s, 'p0', false, ctx(T0 + 5)).state.until).toBe(T0 + 5 + AWAY_MS)
  })
})
