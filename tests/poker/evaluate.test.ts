import { describe, expect, it } from 'vitest'
import { Hand } from 'pokersolver'
import { fullDeck, parseCards } from '../../src/shared/games/poker/cards'
import { bestHand, drawHints, handName, toHandInfo } from '../../src/shared/games/poker/describe'
import { evaluate, evaluate3 } from '../../src/shared/games/poker/evaluate'
import { seededRng, shuffle } from '../../src/shared/games/types'

const ev = (s: string) => evaluate(parseCards(s))
const name = (s: string) => handName(ev(s))
const cmp = (a: string, b: string) => Math.sign(ev(a).value - ev(b).value)

describe('categorias e nomes (pt-BR)', () => {
  it('uma mão de cada categoria', () => {
    expect(ev('As Kd 7c 5h 3d 9s 2c').category).toBe(0)
    expect(name('As Kd 7c 5h 3d 9s 2c')).toBe('Ás alto')
    expect(name('Qs 8d 7c 5h 3d 9s 2c')).toBe('Dama alta')
    expect(name('Js 8d 7c 5h 3d 9s 2c')).toBe('Valete alto')
    expect(name('Ts 8d 7c 5h 3d 4s 2c')).toBe('10 alto')
    expect(ev('Ks Kd 7c 5h 3d 9s 2c').category).toBe(1)
    expect(name('Ks Kd 7c 5h 3d 9s 2c')).toBe('Par de Reis')
    expect(name('7s 7d Kc 5h 3d 9s 2c')).toBe('Par de 7')
    expect(name('As Ad Kc 5h 3d 9s 2c')).toBe('Par de Ases')
    expect(name('Qs Qd Kc 5h 3d 9s 2c')).toBe('Par de Damas')
    expect(name('Js Jd Kc 5h 3d 9s 2c')).toBe('Par de Valetes')
    expect(ev('As Ad 9c 9h 3d 4s 2c').category).toBe(2)
    expect(name('As Ad 9c 9h 3d 4s 2c')).toBe('Dois pares, Ases e 9')
    expect(name('Ks Kd Qc Qh 3d 4s 2c')).toBe('Dois pares, Reis e Damas')
    expect(ev('7s 7d 7c 5h 3d Ks 2c').category).toBe(3)
    expect(name('7s 7d 7c 5h 3d Ks 2c')).toBe('Trinca de 7')
    expect(name('Ks Kd Kc 5h 3d 8s 2c')).toBe('Trinca de Reis')
    expect(ev('6s 7d 8c 9h Td 2s Kc').category).toBe(4)
    expect(name('6s 7d 8c 9h Td 2s Kc')).toBe('Sequência até o 10')
    expect(name('Ts Jd Qc Kh Ad 2s 3c')).toBe('Sequência até o Ás')
    expect(name('8s 9d Tc Jh Qd 2s 3c')).toBe('Sequência até a Dama')
    expect(name('7s 8d 9c Th Jd 2s 3c')).toBe('Sequência até o Valete')
    expect(name('9s Td Jc Qh Kd 2s 3c')).toBe('Sequência até o Rei')
    expect(ev('2h 5h 9h Kh 3h 4s 7c').category).toBe(5)
    expect(name('2h 5h 9h Kh 3h 4s 7c')).toBe('Flush de copas')
    expect(name('2c 5c 9c Kc 3c 4s 7d')).toBe('Flush de paus')
    expect(name('2d 5d 9d Kd 3d 4s 7c')).toBe('Flush de ouros')
    expect(name('2s 5s 9s Ks 3s 4h 7c')).toBe('Flush de espadas')
    expect(ev('7s 7d 7c Kh Kd 2s 3c').category).toBe(6)
    expect(name('7s 7d 7c Kh Kd 2s 3c')).toBe('Full house, 7 com Reis')
    expect(ev('Qs Qd Qc Qh Kd 2s 3c').category).toBe(7)
    expect(name('Qs Qd Qc Qh Kd 2s 3c')).toBe('Quadra de Damas')
    expect(ev('5s 6s 7s 8s 9s 2d 3c').category).toBe(8)
    expect(name('5s 6s 7s 8s 9s 2d 3c')).toBe('Straight flush até o 9')
    expect(ev('As Ks Qs Js Ts 2d 3c').category).toBe(9)
    expect(name('As Ks Qs Js Ts 2d 3c')).toBe('Royal flush')
  })

  it('cartas que formam a mão', () => {
    expect(ev('7s 7d 7c Kh Kd 2s 3c').cards.slice().sort()).toEqual(parseCards('7s 7d 7c Kh Kd').sort())
    expect(ev('As Ad 9c 9h 3d 4s Kc').cards.length).toBe(5)
    expect(ev('As Ad 9c 9h 3d 4s Kc').cards.slice().sort()).toEqual(parseCards('As Ad 9c 9h Kc').sort())
    expect(ev('2h 5h 9h Kh 3h 4s 7c').cards.every((c) => c[1] === 'h')).toBe(true)
  })

  it('roda A-2-3-4-5 é a sequência mais baixa', () => {
    expect(name('As 2d 3c 4h 5d Ks 9c')).toBe('Sequência até o 5')
    expect(cmp('As 2d 3c 4h 5d Ks 9c', '2s 3d 4c 5h 6d Ks 9c')).toBe(-1)
    expect(name('As 2s 3s 4s 5s Kd 9c')).toBe('Straight flush até o 5')
    expect(ev('As 2s 3s 4s 5s Kd 9c').category).toBe(8)
    // K-A-2-3-4 não é sequência
    expect(ev('Ks Ad 2c 3h 4d 9s 8c').category).toBe(0)
  })

  it('seis cartas seguidas: vale a mais alta', () => {
    expect(name('3s 4d 5c 6h 7d 8s Kc')).toBe('Sequência até o 8')
  })

  it('full house com duas trincas e com três pares', () => {
    expect(name('7s 7d 7c Kh Kd Ks 3c')).toBe('Full house, Reis com 7')
    expect(name('7s 7d 7c Kh Kd 3s 3c')).toBe('Full house, 7 com Reis')
    expect(ev('As Ad Kc Kh Qd Qs 2c').tb).toEqual([14, 13, 12])
  })
})

describe('comparações, kickers e empates', () => {
  it('ordem entre categorias', () => {
    const hands = [
      'As Kd 7c 5h 3d 9s 2c',
      'Ks Kd 7c 5h 3d 9s 2c',
      'As Ad 9c 9h 3d 4s 2c',
      '7s 7d 7c 5h 3d Ks 2c',
      '6s 7d 8c 9h Td 2s Kc',
      '2h 5h 9h Kh 3h 4s 7c',
      '7s 7d 7c Kh Kd 2s 3c',
      'Qs Qd Qc Qh Kd 2s 3c',
      '5s 6s 7s 8s 9s 2d 3c',
      'As Ks Qs Js Ts 2d 3c'
    ]
    for (let i = 1; i < hands.length; i++) expect(cmp(hands[i], hands[i - 1])).toBe(1)
  })
  it('kickers decidem', () => {
    expect(cmp('As Ad Kc 5h 3d 9s 2c', 'Ah Ac Qc 5d 3s 9d 2h')).toBe(1)
    expect(cmp('As Ad Kc Qh 3d 9s 2c', 'Ah Ac Kd Jc 3s 9d 2h')).toBe(1)
    expect(cmp('Ks Kd 9c 9h As 4s 2c', 'Kh Kc 9d 9s Qs 4d 2d')).toBe(1)
    expect(cmp('Qs Qd Qc Ah 3d 4s 2c', 'Qh Qs Qd Kh 3c 4c 2d')).toBe(1)
    expect(cmp('As Kd 9c 7h 5d 3s 2c', 'Ah Kc 9d 7s 4d 3d 2d')).toBe(1)
    expect(cmp('Qs Qd Qc Qh Kd 2s 3c', 'Qs Qd Qc Qh Jd 2s 3c')).toBe(1)
  })
  it('empate exato (a mesa joga)', () => {
    expect(cmp('As Kd Qc Jh Td 2s 3c', 'Ah Kc Qd Js Th 4s 5c')).toBe(0)
    expect(cmp('2c 3d 9h Js Qs Kd Ah', '4c 5d 9h Js Qs Kd Ah')).toBe(0)
    // par igual, 5 melhores iguais; 6a e 7a cartas não contam
    expect(cmp('Ks Kd As Qh Jd 3s 2c', 'Kh Kc As Qd Jc 4s 5c')).toBe(0)
  })
  it('naipe não desempata', () => {
    expect(cmp('2h 5h 9h Kh 3h 4s 7c', '2s 5s 9s Ks 3s 4d 7d')).toBe(0)
  })
  it('flush maior vence; flush usa só as 5 maiores do naipe', () => {
    expect(cmp('2h 5h 9h Kh 3h Ah 7c', '2s 5s 9s Ks 3s Qs 7c')).toBe(1)
  })
  it('funciona com 2 a 7 cartas', () => {
    expect(evaluate(parseCards('Ks Kd')).category).toBe(1)
    expect(evaluate(parseCards('As 2d 9c')).category).toBe(0)
    expect(evaluate(parseCards('7s 7d 7c 7h')).category).toBe(7)
  })
})

describe('modo 3 cartas', () => {
  const e3 = (s: string) => evaluate3(parseCards(s))
  const order = [
    'As Kd 7c', // carta alta
    '2s 2d 3c', // par
    'Ks Kd Ac', // par maior
    '2s 7s Js', // flush
    '2h 3d 4c', // sequência
    'Ah Kd Qc', // sequência mais alta
    '5s 5d 5c', // trinca
    '4d 5d 6d' // straight flush
  ]
  it('ordem: straight flush > trinca > sequência > flush > par > carta alta', () => {
    for (let i = 1; i < order.length; i++) expect(e3(order[i]).value).toBeGreaterThan(e3(order[i - 1]).value)
  })
  it('A-2-3 é a sequência mais baixa; A-K-Q a mais alta; K-A-2 não é sequência', () => {
    expect(handName(e3('Ad 2c 3h'))).toBe('Sequência até o 3')
    expect(e3('Ad 2c 3h').value).toBeLessThan(e3('2d 3c 4h').value)
    expect(handName(e3('Ad Kc Qh'))).toBe('Sequência até o Ás')
    expect(e3('Ad Kc Qh').value).toBeGreaterThan(e3('Jd Kc Qh').value)
    expect(e3('Kd Ac 2h').category).toBe(0)
  })
  it('nomes', () => {
    expect(handName(e3('5s 5d 5c'))).toBe('Trinca de 5')
    expect(handName(e3('2s 7s Js'))).toBe('Flush de espadas')
    expect(handName(e3('4d 5d 6d'))).toBe('Straight flush até o 6')
    expect(handName(e3('As Ks Qs'))).toBe('Royal flush')
    expect(handName(e3('Ks Kd 2c'))).toBe('Par de Reis')
    expect(handName(e3('Ks 9d 2c'))).toBe('Rei alto')
  })
  it('desempates: par pelo kicker, flush pelas cartas, empate exato', () => {
    expect(e3('Ks Kd 9c').value).toBeGreaterThan(e3('Kh Kc 8d').value)
    expect(e3('Ks Qd 9c').value).toBe(e3('Kh Qc 9d').value)
    expect(e3('2s 7s Ks').value).toBeGreaterThan(e3('2h 7h Qh').value)
    expect(e3('Ah 2d 2c').value).toBe(e3('As 2h 2s').value)
  })
})

describe('melhor mão e dicas', () => {
  const hc = (s: string) => parseCards(s)
  it('best usa as cartas visíveis', () => {
    expect(bestHand('holdem', hc('As Ad'), [])?.info.name).toBe('Par de Ases')
    expect(bestHand('holdem', hc('As Kd'), hc('Ah 2c 7d'))?.info.name).toBe('Par de Ases')
    expect(bestHand('holdem', hc('As'), [])).toBeNull()
    expect(toHandInfo(ev('7s 7d 7c Kh Kd 2s 3c')).cards).toHaveLength(5)
  })
  it('flush: 4 do mesmo naipe', () => {
    expect(drawHints(hc('Ah 2h'), hc('7h 9h Kc'), 0)).toContain('Falta 1 carta para flush')
    // 4 na mesa e nenhuma na mão: não é um projeto seu
    expect(drawHints(hc('As 2d'), hc('7h 9h Kh 3h'), 0)).not.toContain('Falta 1 carta para flush')
    // já tem flush: sem dica
    expect(drawHints(hc('Ah 2h'), hc('7h 9h Kh'), 5)).toEqual([])
    // 3 do naipe: nada
    expect(drawHints(hc('Ah 2h'), hc('7h 9c Kc'), 0)).toEqual([])
  })
  it('sequência: 4 seguidas ou com 1 buraco', () => {
    expect(drawHints(hc('5s 6d'), hc('7c 8h Kd'), 0)).toContain('Falta 1 carta para sequência') // aberta
    expect(drawHints(hc('5s 6d'), hc('7c 9h Kd'), 0)).toContain('Falta 1 carta para sequência') // buraco
    expect(drawHints(hc('As 2d'), hc('3c 4h Kd'), 0)).toContain('Falta 1 carta para sequência') // roda
    expect(drawHints(hc('As Kd'), hc('Qc Jh 2d'), 0)).toContain('Falta 1 carta para sequência')
    expect(drawHints(hc('5s 6d'), hc('7c Kh 2d'), 0)).toEqual([]) // só 3
    expect(drawHints(hc('5s 6d'), hc('7c 8h 9d'), 4)).toEqual([]) // já é sequência
  })
  it('sem dicas no river', () => {
    expect(drawHints(hc('Ah 2h'), hc('7h 9h Kc 3d 4s'), 0)).toEqual([])
  })
})

describe('gabarito pokersolver', () => {
  it('7 cartas: vencedor/empate igual em 200.000 confrontos aleatórios', () => {
    const rng = seededRng(20260611)
    const deck = fullDeck()
    const toPs = (cs: string[]) => cs
    let mismatches = 0
    let ties = 0
    for (let i = 0; i < 200_000; i++) {
      // sorteio parcial de 9 cartas (mais rápido que embaralhar tudo)
      const pick: string[] = []
      const idx = new Set<number>()
      while (pick.length < 9) {
        const k = rng.int(52)
        if (!idx.has(k)) { idx.add(k); pick.push(deck[k]) }
      }
      const board = pick.slice(0, 5)
      const a = [...pick.slice(5, 7), ...board]
      const b = [...pick.slice(7, 9), ...board]
      const mine = Math.sign(evaluate(a as never).value - evaluate(b as never).value)
      const ha = Hand.solve(toPs(a))
      const hb = Hand.solve(toPs(b))
      const w = Hand.winners([ha, hb])
      const theirs = w.length === 2 ? 0 : w[0] === ha ? 1 : -1
      if (theirs === 0) ties++
      if (mine !== theirs) {
        mismatches++
        if (mismatches < 5) console.log('diferença', a.join(' '), '|', b.join(' '), mine, theirs)
      }
    }
    expect(mismatches).toBe(0)
    expect(ties).toBeGreaterThan(100)
  }, 300_000)

  it('categoria e melhor de 5 batem com a força bruta (21 combinações)', () => {
    const rng = seededRng(7)
    const deck = fullDeck()
    for (let i = 0; i < 20_000; i++) {
      const cs = shuffle(deck, rng).slice(0, 7)
      const mine = evaluate(cs)
      let best = -1
      for (let a = 0; a < 7; a++) for (let b = a + 1; b < 7; b++) {
        const five = cs.filter((_, k) => k !== a && k !== b)
        best = Math.max(best, evaluate(five).value)
      }
      expect(mine.value).toBe(best)
      // as 5 cartas devolvidas têm o mesmo valor
      expect(evaluate(mine.cards).value).toBe(mine.value)
    }
  }, 120_000)

  it('3 cartas: vencedor/empate igual ao pokersolver (threecard) em 100.000 confrontos', () => {
    const rng = seededRng(33)
    const deck = fullDeck()
    let mismatches = 0
    for (let i = 0; i < 100_000; i++) {
      const pick: string[] = []
      const idx = new Set<number>()
      while (pick.length < 6) {
        const k = rng.int(52)
        if (!idx.has(k)) { idx.add(k); pick.push(deck[k]) }
      }
      const a = pick.slice(0, 3), b = pick.slice(3)
      const mine = Math.sign(evaluate3(a as never).value - evaluate3(b as never).value)
      const ha = Hand.solve(a, 'threecard'), hb = Hand.solve(b, 'threecard')
      const w = Hand.winners([ha, hb])
      const theirs = w.length === 2 ? 0 : w[0] === ha ? 1 : -1
      if (mine !== theirs) {
        mismatches++
        if (mismatches < 5) console.log('3 cartas difere', a.join(' '), '|', b.join(' '), mine, theirs)
      }
    }
    expect(mismatches).toBe(0)
  }, 120_000)
})
