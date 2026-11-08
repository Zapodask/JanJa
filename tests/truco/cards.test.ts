import { describe, expect, it } from 'vitest'
import { cardName, DECK, envidoPoints, florPoints, power } from '../../src/shared/games/truco/cards'

describe('baralho do truco', () => {
  it('40 cartas, sem 8 e 9', () => {
    expect(DECK).toHaveLength(40)
    expect(new Set(DECK).size).toBe(40)
    expect(DECK.some((c) => c.startsWith('8') || c.startsWith('9'))).toBe(false)
  })

  it('ordem de força do gaudério', () => {
    const order = ['1e', '1b', '7e', '7o', '3c', '2o', '1c', '12e', '11b', '10o', '7c', '6e', '5b', '4o']
    for (let i = 1; i < order.length; i++) expect(power(order[i - 1]), `${order[i - 1]} > ${order[i]}`).toBeGreaterThan(power(order[i]))
    // empates: os 3 entre si, ases falsos, setes falsos
    expect(power('3e')).toBe(power('3c'))
    expect(power('1c')).toBe(power('1o'))
    expect(power('7c')).toBe(power('7b'))
    expect(power('4e')).toBe(power('4c'))
  })

  it('envido: mesmo naipe soma 20, figura vale 0; sem naipe vale a maior', () => {
    expect(envidoPoints(['7e', '6e', '1c'])).toBe(33)
    expect(envidoPoints(['12e', '11e', '5c'])).toBe(20)
    expect(envidoPoints(['7e', '12e', '5c'])).toBe(27)
    expect(envidoPoints(['7e', '6b', '5c'])).toBe(7)
    expect(envidoPoints(['12e', '11b', '10c'])).toBe(0)
    // flor também conta envido pelas duas maiores
    expect(envidoPoints(['7e', '6e', '5e'])).toBe(33)
  })

  it('flor: três do mesmo naipe', () => {
    expect(florPoints(['7e', '6e', '5e'])).toBe(38)
    expect(florPoints(['12c', '11c', '10c'])).toBe(20)
    expect(florPoints(['7e', '6e', '5c'])).toBeNull()
  })

  it('nomes', () => {
    expect(cardName('1e')).toBe('Ás de espadas')
    expect(cardName('12c')).toBe('Rei de copas')
    expect(cardName('7o')).toBe('7 de ouros')
  })
})
