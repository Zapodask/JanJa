import { describe, expect, it } from 'vitest'
import { pokerGame } from '../../src/shared/games/poker'
import { buildPots, legalActions } from '../../src/shared/games/poker/engine'
import { TABLE } from '../../src/shared/games/poker/types'
import { isGameError } from '../../src/shared/games/types'
import { act, actor, aggressive, ctxAt, ids, kinds, legalOf, passive, playOut, rig, setStack, stackOf, start, tickAt, total, tryAct, viewOf, type Ctr } from './helpers'

const seatOf = (c: Ctr, id: string) => viewOf(c, null).seats.find((s) => s.playerId === id)!

describe('opções e ações', () => {
  it('parseOptions valida e aplica padrões', () => {
    expect(pokerGame.parseOptions(undefined)).toEqual({ mode: 'holdem', minutes: 30, buy: 'recompra' })
    expect(pokerGame.parseOptions({ mode: 'tres', minutes: 15, buy: 'torneio' })).toEqual({ mode: 'tres', minutes: 15, buy: 'torneio' })
    expect(isGameError(pokerGame.parseOptions({ mode: 'omaha' }))).toBe(true)
    expect(isGameError(pokerGame.parseOptions({ minutes: 20 }))).toBe(true)
    expect(isGameError(pokerGame.parseOptions('x'))).toBe(true)
  })
  it('parseAction', () => {
    expect(pokerGame.parseAction({ kind: 'raise' })).toEqual({ kind: 'raise' })
    expect(isGameError(pokerGame.parseAction({ kind: 'bet', amount: 5 }))).toBe(true)
    expect(isGameError(pokerGame.parseAction(null))).toBe(true)
  })
  it('estado é JSON puro', () => {
    const c = start(4)
    expect(JSON.parse(JSON.stringify(c.state))).toEqual(c.state)
  })
})

describe('mão: blinds, ordem e ações legais', () => {
  it('3 jogadores: blinds 5/10, UTG fala primeiro, botão gira', () => {
    const c = start(3, {}, 0)
    expect(seatOf(c, 'p0').dealer).toBe(true)
    expect(seatOf(c, 'p1')).toMatchObject({ smallBlind: true, bet: 5, stack: 995 })
    expect(seatOf(c, 'p2')).toMatchObject({ bigBlind: true, bet: 10, stack: 990 })
    expect(actor(c)).toBe('p0')
    expect(legalOf(c, 'p0')).toEqual([{ kind: 'fold' }, { kind: 'call', amount: 10 }, { kind: 'raise', amount: 20, to: 20 }])
    expect(legalActions(c.state, 1)).toEqual([{ kind: 'fold' }, { kind: 'call', amount: 5 }, { kind: 'raise', amount: 15, to: 20 }])
  })
  it('legal só aparece para quem tem a vez', () => {
    const c = start(3, {}, 0)
    expect(viewOf(c, 'p1').legal).toEqual([])
    expect(viewOf(c, null).legal).toEqual([])
    expect(viewOf(c, 'p0').legal.length).toBeGreaterThan(0)
  })
  it('fora da vez / ação ilegal são recusadas', () => {
    const c = start(3, {}, 0)
    const e1 = tryAct(c, 'p1', 'call')
    expect(isGameError(e1) && e1.error).toBe('nao-e-sua-vez')
    const e2 = tryAct(c, 'p0', 'check')
    expect(isGameError(e2) && e2.error).toBe('acao-invalida')
    const e3 = tryAct(c, 'p0', 'allin')
    expect(isGameError(e3) && e3.error).toBe('acao-invalida')
    const e4 = tryAct(c, 'zz', 'call')
    expect(isGameError(e4)).toBe(true)
  })
  it('BB tem a opção de aumentar; fold sem aposta para pagar é recusado', () => {
    let c = start(3, {}, 0)
    c = act(c, 'p0', 'call')
    c = act(c, 'p1', 'call')
    expect(actor(c)).toBe('p2')
    expect(kinds(legalOf(c, 'p2'))).toEqual(['check', 'raise'])
    c = act(c, 'p2', 'check')
    expect(viewOf(c, null).phase).toBe('flop')
    expect(viewOf(c, null).board).toHaveLength(3)
  })
  it('aposta fixa: 10 no flop, 20 no turn e river', () => {
    let c = start(3, {}, 0)
    c = act(c, 'p0', 'call'); c = act(c, 'p1', 'call'); c = act(c, 'p2', 'check')
    expect(actor(c)).toBe('p1') // à esquerda do botão
    expect(legalOf(c, 'p1')).toEqual([{ kind: 'check' }, { kind: 'raise', amount: 10, to: 10 }])
    for (const id of ['p1', 'p2', 'p0']) c = act(c, id, 'check')
    expect(viewOf(c, null).phase).toBe('turn')
    expect(legalOf(c, 'p1')).toEqual([{ kind: 'check' }, { kind: 'raise', amount: 20, to: 20 }])
    for (const id of ['p1', 'p2', 'p0']) c = act(c, id, 'check')
    expect(viewOf(c, null).phase).toBe('river')
    c = act(c, 'p1', 'raise')
    expect(legalOf(c, 'p2')).toEqual([{ kind: 'fold' }, { kind: 'call', amount: 20 }, { kind: 'raise', amount: 40, to: 40 }])
  })
  it('cap de 4 apostas por rodada (BB conta como a primeira no pré-flop)', () => {
    let c = start(3, {}, 0)
    c = act(c, 'p0', 'raise') // 20
    c = act(c, 'p1', 'raise') // 30
    c = act(c, 'p2', 'raise') // 40 = 4ª aposta
    expect(kinds(legalOf(c, 'p0'))).toEqual(['fold', 'call'])
    const e = tryAct(c, 'p0', 'raise')
    expect(isGameError(e)).toBe(true)
    c = act(c, 'p0', 'call'); c = act(c, 'p1', 'call')
    expect(viewOf(c, null).phase).toBe('flop')
    // flop: bet + 3 aumentos
    c = act(c, 'p1', 'raise'); c = act(c, 'p2', 'raise'); c = act(c, 'p0', 'raise'); c = act(c, 'p1', 'raise')
    expect(kinds(legalOf(c, 'p2'))).toEqual(['fold', 'call'])
  })
  it('pote só soma o que já foi recolhido; bets ficam em seat.bet', () => {
    let c = start(3, {}, 0)
    expect(viewOf(c, null).pots).toEqual([])
    c = act(c, 'p0', 'call'); c = act(c, 'p1', 'call'); c = act(c, 'p2', 'check')
    expect(viewOf(c, null).pots).toEqual([{ amount: 30, eligible: ['p0', 'p1', 'p2'] }])
  })
})

describe('heads-up', () => {
  it('dealer é o small blind, fala primeiro no pré-flop e por último depois', () => {
    let c = start(2, {}, 0)
    expect(seatOf(c, 'p0')).toMatchObject({ dealer: true, smallBlind: true, bet: 5 })
    expect(seatOf(c, 'p1')).toMatchObject({ bigBlind: true, bet: 10 })
    expect(actor(c)).toBe('p0')
    c = act(c, 'p0', 'call')
    expect(actor(c)).toBe('p1')
    c = act(c, 'p1', 'check')
    expect(viewOf(c, null).phase).toBe('flop')
    expect(actor(c)).toBe('p1')
    c = act(c, 'p1', 'check')
    expect(actor(c)).toBe('p0')
  })
  it('botão gira a cada mão', () => {
    let c = start(3, {}, 0)
    c = act(c, 'p0', 'fold'); c = act(c, 'p1', 'fold')
    expect(c.state.phase).toBe('intervalo')
    c = tickAt(c, 6000)
    expect(c.state.handNo).toBe(2)
    expect(seatOf(c, 'p1').dealer).toBe(true)
    expect(seatOf(c, 'p2')).toMatchObject({ smallBlind: true })
    expect(seatOf(c, 'p0')).toMatchObject({ bigBlind: true })
  })
})

describe('fim de mão e explicações', () => {
  it('todos desistiram', () => {
    let c = start(3, { }, 0, [{ playerId: 'p0', name: 'Pedro' }, { playerId: 'p1', name: 'Caio' }, { playerId: 'p2', name: 'Bia' }])
    c = act(c, 'p0', 'fold'); c = act(c, 'p1', 'fold')
    const v = viewOf(c, null)
    expect(v.showdown?.explanation).toBe('Bia levou o pote (todos desistiram)')
    expect(v.showdown?.winners).toEqual([{ playerId: 'p2', amount: 15, hand: null }])
    expect(stackOf(c, 'p2')).toBe(1005)
    // quem ganhou sem showdown não mostra
    expect(v.seats.every((s) => s.cards === null)).toBe(true)
    expect(c.events.find((e) => e.kind === 'win')).toEqual({ kind: 'win', by: 'p2', amount: 15, potIndex: 0 })
    expect(c.events.some((e) => e.kind === 'reveal')).toBe(false)
  })
  it('showdown: explicação em português e cartas reveladas só de quem chegou', () => {
    let c = start(3, {}, 0, [{ playerId: 'p0', name: 'Bia' }, { playerId: 'p1', name: 'Pedro' }, { playerId: 'p2', name: 'Caio' }])
    c.state = rig(c.state, { p0: '7s7d', p1: 'KdQh', p2: '2c3d' }, 'Kc7h9s4c2h')
    c = act(c, 'p0', 'call'); c = act(c, 'p1', 'call'); c = act(c, 'p2', 'check')
    // flop: p1 aposta, p2 desiste, p0 paga
    c = act(c, 'p1', 'raise'); c = act(c, 'p2', 'fold'); c = act(c, 'p0', 'call')
    c = act(c, 'p1', 'check'); c = act(c, 'p0', 'check')
    c = act(c, 'p1', 'check'); c = act(c, 'p0', 'check')
    const v = viewOf(c, 'p2')
    expect(v.phase).toBe('intervalo')
    expect(v.showdown?.explanation).toBe('Bia ganhou com Trinca de 7 (bateu o Par de Reis do Pedro)')
    expect(v.seats.find((s) => s.playerId === 'p0')?.cards).toEqual(['7s', '7d'])
    expect(v.seats.find((s) => s.playerId === 'p1')?.cards).toEqual(['Kd', 'Qh'])
    expect(v.seats.find((s) => s.playerId === 'p2')?.cards).toEqual(['2c', '3d']) // as próprias
    expect(viewOf(c, 'p0').seats.find((s) => s.playerId === 'p2')?.cards).toBeNull() // desistiu: não mostra
    expect(c.events.filter((e) => e.kind === 'reveal')).toHaveLength(2)
    expect(v.showdown?.winners[0]).toMatchObject({ playerId: 'p0', amount: 50 })
    expect(v.showdown?.winners[0].hand?.name).toBe('Trinca de 7')
  })
  it('nome feminino usa "da"', () => {
    let c = start(2, {}, 0, [{ playerId: 'p0', name: 'Pedro' }, { playerId: 'p1', name: 'Bia' }])
    c.state = rig(c.state, { p0: 'AsAd', p1: 'KsKd' }, '2c5h9sJd3c')
    c = playOut(c)
    expect(viewOf(c, null).showdown?.explanation).toBe('Pedro ganhou com Par de Ases (bateu o Par de Reis da Bia)')
  })
  it('empate: dividem o pote', () => {
    let c = start(2, {}, 0, [{ playerId: 'p0', name: 'Bia' }, { playerId: 'p1', name: 'Pedro' }])
    c.state = rig(c.state, { p0: '2c3d', p1: '4c5d' }, 'AsKsQsJsTs')
    c = playOut(c)
    expect(viewOf(c, null).showdown?.explanation).toBe('Pedro e Bia dividiram o pote com Royal flush')
    expect(stackOf(c, 'p0')).toBe(1000)
    expect(stackOf(c, 'p1')).toBe(1000)
  })
})

describe('ficha ímpar', () => {
  it('vai para o primeiro vencedor à esquerda do botão', () => {
    // 3 jogadores, botão p0: p0 paga, SB (p1) desiste (pote 25 = 10+10+5), p0 e p2 empatam na mesa
    let c = start(3, {}, 0)
    c.state = rig(c.state, { p0: '2c3d', p1: '4c5d', p2: '6c7d' }, 'AsKsQsJsTs')
    c = act(c, 'p0', 'call'); c = act(c, 'p1', 'fold'); c = act(c, 'p2', 'check')
    c = act(c, 'p2', 'check'); c = act(c, 'p0', 'check')
    c = act(c, 'p2', 'check'); c = act(c, 'p0', 'check')
    c = act(c, 'p2', 'check'); c = act(c, 'p0', 'check')
    expect(c.state.phase).toBe('intervalo')
    expect(stackOf(c, 'p2')).toBe(990 + 13) // p2 é o primeiro à esquerda do botão (p1 desistiu)
    expect(stackOf(c, 'p0')).toBe(990 + 12)
    expect(stackOf(c, 'p1')).toBe(995)
  })
  it('com o botão em p2 o primeiro à esquerda é p0', () => {
    let c = start(3, {}, 2) // SB p0, BB p1, UTG p2
    c.state = rig(c.state, { p0: '2c3d', p1: '4c5d', p2: '6c7d' }, 'AsKsQsJsTs')
    c = act(c, 'p2', 'call'); c = act(c, 'p0', 'fold'); c = act(c, 'p1', 'check')
    while (c.state.phase !== 'intervalo') c = passive(c)
    expect(stackOf(c, 'p1')).toBe(990 + 13) // p1 e p2 empatam; p0 (à esquerda do botão) desistiu, então p1 leva a ímpar
    expect(stackOf(c, 'p2')).toBe(990 + 12)
  })
})

describe('side pots', () => {
  it('buildPots: camadas, desistentes e união de camadas iguais', () => {
    expect(
      buildPots([
        { id: 'a', contrib: 15, folded: false },
        { id: 'b', contrib: 25, folded: false },
        { id: 'c', contrib: 40, folded: false },
        { id: 'd', contrib: 40, folded: false }
      ])
    ).toEqual([
      { amount: 60, eligible: ['a', 'b', 'c', 'd'] },
      { amount: 30, eligible: ['b', 'c', 'd'] },
      { amount: 30, eligible: ['c', 'd'] }
    ])
    // quem desistiu deixa dinheiro mas não disputa
    expect(
      buildPots([
        { id: 'a', contrib: 10, folded: true },
        { id: 'b', contrib: 30, folded: false },
        { id: 'c', contrib: 30, folded: false }
      ])
    ).toEqual([{ amount: 70, eligible: ['b', 'c'] }])
    expect(buildPots([])).toEqual([])
  })

  it('3 all-ins diferentes + um com pilha grande: cada pote vai para o melhor elegível', () => {
    const players = [
      { playerId: 'p0', name: 'Ana' }, { playerId: 'p1', name: 'Bia' },
      { playerId: 'p2', name: 'Caio' }, { playerId: 'p3', name: 'Davi' }
    ]
    let c = start(4, {}, 0, players)
    // stacks (após blinds): p0 dealer 15, p1 SB 25 (bet 5), p2 BB 40 (bet 10), p3 UTG 1000
    c.state = setStack(c.state, 'p0', 15)
    c.state = setStack(c.state, 'p1', 20)
    c.state = setStack(c.state, 'p2', 30)
    // p3 é o UTG: age primeiro; p0 é o botão
    c.state = rig(c.state, { p0: 'AsAd', p1: 'KsKd', p2: 'QsQd', p3: '2c3d' }, 'Jh8c4s9h5d')
    const before = c.state.players.reduce((s, p) => s + p.stack + p.contrib, 0)
    c = playOut(c, aggressive)
    // contribuições: p0 15, p1 25, p2 40, p3 40 (excedente devolvido)
    expect(stackOf(c, 'p0')).toBe(60)
    expect(stackOf(c, 'p1')).toBe(30)
    expect(stackOf(c, 'p2')).toBe(30)
    expect(stackOf(c, 'p3')).toBe(960)
    expect(c.state.players.reduce((s, p) => s + p.stack, 0)).toBe(before)
    const sentences = viewOf(c, null).showdown!.explanation.split('. ')
    expect(sentences).toHaveLength(3)
    expect(sentences[0]).toBe('Ana ganhou com Par de Ases (bateu o Par de Reis da Bia)'.replace('da Bia', 'da Bia'))
    expect(sentences[1]).toContain('Bia ganhou com Par de Reis')
    expect(sentences[2]).toContain('Caio ganhou com Par de Damas')
    // eventos de vitória por pote
    expect(c.events.filter((e) => e.kind === 'win').map((e) => (e.kind === 'win' ? [e.by, e.amount, e.potIndex] : []))).toEqual([
      ['p0', 60, 0], ['p1', 30, 1], ['p2', 30, 2]
    ])
  })

  it('parte não igualada volta para quem apostou', () => {
    let c = start(3, {}, 0)
    c = setStackAfter(c, 'p2', 6) // BB all-in com apenas 6
    c.state = rig(c.state, { p0: 'AsAd', p1: '2c3d', p2: 'KsKd' }, 'Jh8c4s9h5d')
    const before = total(c)
    c = act(c, 'p0', 'call'); c = act(c, 'p1', 'fold')
    expect(c.state.phase).toBe('intervalo')
    expect(total(c)).toBe(before)
    // p0 pôs 10, p2 6: devolve 4; pote = 6 + 6 + 5
    expect(stackOf(c, 'p0')).toBe(990 + 4 + 17)
    expect(stackOf(c, 'p1')).toBe(995)
    expect(stackOf(c, 'p2')).toBe(0)
    expect(viewOf(c, null).showdown?.winners).toMatchObject([{ playerId: 'p0', amount: 17 }])
  })
})

function setStackAfter(c: Ctr, id: string, bet: number): Ctr {
  const st = structuredClone(c.state)
  const p = st.players.find((x) => x.playerId === id)!
  p.stack = 0
  p.bet = bet
  p.contrib = bet
  p.status = 'allin'
  return { state: st, events: [] }
}

describe('all-in parcial', () => {
  it('não reabre as apostas para quem já agiu', () => {
    // 4 jogadores, botão p0: SB p1, BB p2, UTG p3
    let c = start(4, {}, 0)
    c.state = setStack(c.state, 'p0', 25)
    c = act(c, 'p3', 'raise') // para 20
    expect(legalOf(c, 'p0').map((l) => l.kind)).toEqual(['fold', 'call', 'allin']) // 25 < 30 para aumentar
    c = act(c, 'p0', 'allin') // vai a 25: aumento incompleto
    c = act(c, 'p1', 'call')
    c = act(c, 'p2', 'call')
    // p3 já agiu: só paga ou desiste
    expect(actor(c)).toBe('p3')
    expect(legalOf(c, 'p3')).toEqual([{ kind: 'fold' }, { kind: 'call', amount: 5 }])
    const e = tryAct(c, 'p3', 'raise')
    expect(isGameError(e)).toBe(true)
    c = act(c, 'p3', 'call')
    expect(viewOf(c, null).phase).toBe('flop')
  })
  it('quem ainda não agiu pode aumentar; o aumento sobe do valor do all-in', () => {
    let c = start(4, {}, 0)
    c.state = setStack(c.state, 'p0', 25)
    c = act(c, 'p3', 'raise')
    c = act(c, 'p0', 'allin') // 25
    expect(legalOf(c, 'p1')).toEqual([{ kind: 'fold' }, { kind: 'call', amount: 20 }, { kind: 'raise', amount: 30, to: 35 }])
  })
  it('all-in menor que o valor a pagar não muda o valor a igualar', () => {
    let c = start(4, {}, 0)
    c.state = setStack(c.state, 'p0', 12)
    c = act(c, 'p3', 'raise') // 20
    expect(legalOf(c, 'p0')).toEqual([{ kind: 'fold' }, { kind: 'allin', amount: 12 }])
    c = act(c, 'p0', 'allin')
    expect(c.state.currentBet).toBe(20)
    expect(seatOf(c, 'p0').status).toBe('allin')
  })
  it('allin só aparece quando não dá para pagar/aumentar o valor fixo', () => {
    const c = start(3, {}, 0)
    for (const id of ['p0', 'p1', 'p2']) expect(kinds(legalOf({ ...c, state: c.state }, id)).includes('allin')).toBe(false)
  })
  it('aposta parcial all-in numa rodada sem aposta (check passa a ter aposta)', () => {
    let c = start(3, {}, 0)
    c = act(c, 'p0', 'call'); c = act(c, 'p1', 'call'); c = act(c, 'p2', 'check')
    c.state = setStack(c.state, 'p1', 6)
    expect(legalOf(c, 'p1')).toEqual([{ kind: 'check' }, { kind: 'allin', amount: 6 }])
    c = act(c, 'p1', 'allin')
    expect(legalOf(c, 'p2')).toEqual([{ kind: 'fold' }, { kind: 'call', amount: 6 }, { kind: 'raise', amount: 16, to: 16 }])
  })
})

describe('timeouts', () => {
  it('estourou a vez: check se puder, senão fold', () => {
    let c = start(3, {}, 0)
    expect(viewOf(c, null).actDeadline).toBe(TABLE.actMs)
    // nada acontece antes
    expect(tickAt(c, TABLE.actMs - 1).events).toEqual([])
    c = tickAt(c, TABLE.actMs) // p0 enfrenta aposta: fold
    expect(c.events).toEqual([{ kind: 'timeout', by: 'p0' }, { kind: 'act', by: 'p0', action: 'fold', amount: 0 }])
    expect(seatOf(c, 'p0').status).toBe('desistiu')
    expect(viewOf(c, null).actDeadline).toBe(TABLE.actMs * 2)
    c = act(c, 'p1', 'call', TABLE.actMs)
    // BB pode dar check: timeout vira check
    c = tickAt(c, TABLE.actMs * 2 + 5)
    expect(c.events[1]).toMatchObject({ kind: 'act', by: 'p2', action: 'check' })
    expect(viewOf(c, null).phase).toBe('flop')
  })
  it('nextDeadline acompanha a vez, o intervalo e a espera', () => {
    let c = start(3, { minutes: 15 }, 0)
    expect(pokerGame.nextDeadline(c.state)).toBe(TABLE.actMs)
    c = act(c, 'p0', 'fold', 100); c = act(c, 'p1', 'fold', 100)
    expect(pokerGame.nextDeadline(c.state)).toBe(100 + TABLE.betweenHandsMs)
  })
})

describe('recompra e torneio', () => {
  function bust(buy: 'recompra' | 'torneio') {
    let c = start(2, { buy }, 0)
    c.state = setStack(c.state, 'p1', 30)
    c.state = rig(c.state, { p0: 'AsAd', p1: '2c7d' }, 'KhKd9s4c3h')
    c = playOut(c, aggressive)
    return c
  }
  it('recompra: quem zera ganha +1000 no início da próxima mão', () => {
    let c = bust('recompra')
    expect(stackOf(c, 'p1')).toBe(0)
    expect(seatOf(c, 'p1').status).toBe('zerado')
    expect(seatOf(c, 'p1').net).toBe(-1000)
    const before = c.state.players.reduce((s, p) => s + p.stack, 0)
    c = tickAt(c, 10_000)
    expect(c.events).toContainEqual({ kind: 'rebuy', by: 'p1', amount: 1000 })
    expect(seatOf(c, 'p1')).toMatchObject({ rebuys: 1, stack: 1000 - 5, net: 1000 - 5 - 2000 })
    expect(c.state.players.reduce((s, p) => s + p.stack + p.contrib, 0)).toBe(before + 1000)
    expect(c.state.phase).toBe('preflop')
  })
  it('torneio: quem zera fica fora e a partida acaba com 1', () => {
    const c = bust('torneio')
    expect(c.state.phase).toBe('fim')
    expect(pokerGame.isOver(c.state)).toBe(true)
    expect(seatOf(c, 'p1').status).toBe('fora')
    const v = viewOf(c, null)
    expect(v.ranking?.map((r) => [r.playerId, r.place])).toEqual([['p0', 1], ['p1', 2]])
    expect(c.events.some((e) => e.kind === 'end')).toBe(true)
    expect(pokerGame.nextDeadline(c.state)).toBeNull()
    const e = tryAct(c, 'p0', 'check')
    expect(isGameError(e) && e.error).toBe('partida-encerrada')
  })
  it('torneio com 3: continua com 2 e o eliminado não recebe cartas', () => {
    let c = start(3, { buy: 'torneio' }, 0)
    c.state = setStack(c.state, 'p0', 10) // UTG curto
    c.state = rig(c.state, { p0: '2c7d', p1: 'AsAd', p2: 'KsKd' }, 'Jh8c4s9h5d')
    c = act(c, 'p0', 'call'); c = act(c, 'p1', 'call'); c = act(c, 'p2', 'check')
    c = playOut(c, passive)
    expect(seatOf(c, 'p0').status).toBe('fora')
    expect(c.state.phase).toBe('intervalo')
    c = tickAt(c, 10_000)
    expect(c.state.handNo).toBe(2)
    expect(viewOf(c, 'p0').you).toBeNull()
    expect(seatOf(c, 'p0').cardCount).toBe(0)
  })
})

describe('fim por tempo', () => {
  it('endsAt = início + minutos; a mão em curso termina e então a partida acaba', () => {
    const t0 = 1_000_000
    let c = start(3, { minutes: 15 }, 0, ids(3), t0)
    expect(viewOf(c, null).endsAt).toBe(t0 + 15 * 60_000)
    const late = t0 + 15 * 60_000 - 10_000
    c = act(c, 'p0', 'call', late)
    // passou do horário no meio da mão: nada muda
    c = tickAt(c, t0 + 15 * 60_000 + 1)
    expect(c.state.phase).toBe('preflop')
    c = tickAt(c, late + TABLE.actMs) // timeout de p1 (SB): fold
    expect(c.state.phase).not.toBe('fim')
    c = act(c, 'p2', 'check', late + TABLE.actMs)
    while (c.state.phase !== 'fim') c = passive(c, late + TABLE.actMs)
    const v = viewOf(c, null)
    expect(v.phase).toBe('fim')
    expect(v.ranking).toHaveLength(3)
    expect(v.ranking!.map((r) => r.place)).toEqual([1, 2, 3])
    expect(pokerGame.isOver(c.state)).toBe(true)
  })
  it('acaba no tick do intervalo se o tempo passou durante ele', () => {
    const t0 = 0
    let c = start(3, { minutes: 15 }, 0)
    const end = t0 + 15 * 60_000
    c = act(c, 'p0', 'fold', end - 1000); c = act(c, 'p1', 'fold', end - 1000)
    expect(c.state.phase).toBe('intervalo')
    c = tickAt(c, end - 1000 + TABLE.betweenHandsMs)
    expect(c.state.phase).toBe('fim')
  })
  it('minutes=0: sem limite', () => {
    const c = start(3, { minutes: 0 }, 0)
    expect(viewOf(c, null).endsAt).toBeNull()
  })
  it('desempate: net, fichas, ordem da mesa', () => {
    let c = start(3, { minutes: 15 }, 0)
    c = act(c, 'p0', 'fold', 900_000); c = act(c, 'p1', 'fold', 900_000)
    // p2 ganhou 15 (net +5); p0 net 0; p1 net -5
    c = tickAt(c, 900_000 + TABLE.betweenHandsMs)
    expect(viewOf(c, null).ranking!.map((r) => [r.playerId, r.net])).toEqual([['p2', 5], ['p0', 0], ['p1', -5]])
  })
})

describe('presença e ausência', () => {
  it('quem cai e a vez chega: o timeout age', () => {
    let c = start(3, {}, 0)
    const s = pokerGame.setPresence(c.state, 'p0', false, ctxAt(1000))
    expect(s.events).toEqual([{ kind: 'away', by: 'p0', away: true }])
    c = { state: s.state, events: [] }
    expect(seatOf(c, 'p0').present).toBe(false)
    c = tickAt(c, TABLE.actMs)
    expect(c.events[0]).toEqual({ kind: 'timeout', by: 'p0' })
  })
  it('ausente há mais de 60 s no início da mão: fica de fora, sem cartas', () => {
    let c = start(3, {}, 0)
    c = { state: pokerGame.setPresence(c.state, 'p2', false, ctxAt(0)).state, events: [] }
    c = act(c, 'p0', 'fold'); c = act(c, 'p1', 'fold') // p2 ganha
    // volta a ser contado só se estiver há <= 60 s; aqui mão nova começa aos 61 s
    c = tickAt({ ...c, state: { ...c.state, nextHandAt: 0 } }, 61_000)
    expect(c.state.handNo).toBe(2)
    expect(seatOf(c, 'p2')).toMatchObject({ status: 'ausente', cardCount: 0, cards: null })
    expect(viewOf(c, 'p2').you).toBeNull()
    // sobraram 2: heads-up
    expect(viewOf(c, null).seats.filter((s) => s.dealer || s.smallBlind || s.bigBlind)).toHaveLength(2)
  })
  it('ausente há menos de 60 s ainda recebe cartas (a vez dele estoura em timeout)', () => {
    let c = start(3, {}, 0)
    c = { state: pokerGame.setPresence(c.state, 'p2', false, ctxAt(10_000)).state, events: [] }
    c = act(c, 'p0', 'fold', 10_000); c = act(c, 'p1', 'fold', 10_000)
    c = tickAt(c, 10_000 + 6000)
    expect(seatOf(c, 'p2').status).toBe('jogando')
  })
  it('menos de 2 aptos: espera sem prazo de mão até alguém voltar', () => {
    let c = start(3, {}, 0)
    c = { state: pokerGame.setPresence(c.state, 'p1', false, ctxAt(0)).state, events: [] }
    c = { state: pokerGame.setPresence(c.state, 'p2', false, ctxAt(0)).state, events: [] }
    c = act(c, 'p0', 'raise', 0) // p0 aumenta... todos os outros precisam agir: usa timeout
    c = tickAt(c, TABLE.actMs) // p1 folda
    c = tickAt(c, TABLE.actMs * 2) // p2 folda
    expect(c.state.phase).toBe('intervalo')
    c = tickAt(c, 200_000) // início da mão nova: p1 e p2 ausentes -> espera
    expect(c.state.phase).toBe('intervalo')
    expect(c.state.handNo).toBe(1)
    expect(pokerGame.nextDeadline(c.state)).toBeNull()
    expect(seatOf(c, 'p1').status).toBe('ausente')
    const r = pokerGame.setPresence(c.state, 'p1', true, ctxAt(300_000))
    expect(r.events[0]).toEqual({ kind: 'away', by: 'p1', away: false })
    expect(r.state.handNo).toBe(2)
    expect(r.state.phase).toBe('preflop')
    expect(r.events.some((e) => e.kind === 'deal')).toBe(true)
  })
  it('na espera o relógio da partida ainda vale', () => {
    let c = start(2, { minutes: 15 }, 0)
    c = { state: pokerGame.setPresence(c.state, 'p1', false, ctxAt(0)).state, events: [] }
    c = tickAt(c, TABLE.actMs) // p0 é SB e age primeiro... p0 fold por timeout
    expect(c.state.phase).toBe('intervalo')
    c = tickAt(c, TABLE.actMs + TABLE.betweenHandsMs + 70_000)
    expect(pokerGame.nextDeadline(c.state)).toBe(15 * 60_000)
    c = tickAt(c, 15 * 60_000)
    expect(c.state.phase).toBe('fim')
  })
  it('presença repetida não gera evento', () => {
    const c = start(3, {}, 0)
    expect(pokerGame.setPresence(c.state, 'p0', true, ctxAt(5)).events).toEqual([])
    expect(pokerGame.setPresence(c.state, 'nada', false, ctxAt(5)).events).toEqual([])
  })
})

describe('modo 3 cartas', () => {
  it('ante de 10, 3 cartas, uma rodada de 20 com cap 3, showdown', () => {
    let c = start(3, { mode: 'tres' }, 0)
    expect(c.events.filter((e) => e.kind === 'ante')).toHaveLength(3)
    expect(viewOf(c, 'p0').you?.hand).toHaveLength(3)
    expect(seatOf(c, 'p1').cardCount).toBe(3)
    expect(viewOf(c, null).pots).toEqual([{ amount: 30, eligible: ['p0', 'p1', 'p2'] }])
    expect(actor(c)).toBe('p1')
    expect(legalOf(c, 'p1')).toEqual([{ kind: 'check' }, { kind: 'raise', amount: 20, to: 20 }])
    c = act(c, 'p1', 'raise'); c = act(c, 'p2', 'raise'); c = act(c, 'p0', 'raise')
    expect(kinds(legalOf(c, 'p1'))).toEqual(['fold', 'call']) // cap 3
    c.state = rig(c.state, { p0: '5s5d5c', p1: 'AsKdQc', p2: '2s2d3c' }, '')
    c = act(c, 'p1', 'call'); c = act(c, 'p2', 'call')
    expect(c.state.phase).toBe('intervalo')
    expect(viewOf(c, null).showdown?.winners[0]).toMatchObject({ playerId: 'p0', amount: 30 + 3 * 60 })
    expect(viewOf(c, null).showdown?.explanation).toBe('J0 ganhou com Trinca de 5 (bateu a Sequência até o Ás do J1)')
    expect(viewOf(c, null).board).toEqual([])
  })
  it('best usa as 3 cartas; sem dicas', () => {
    const c = start(3, { mode: 'tres' }, 0)
    const y = viewOf(c, 'p0').you!
    expect(y.best).not.toBeNull()
    expect(y.draws).toEqual([])
  })
  it('heads-up 3 cartas: o primeiro a falar é o não-dealer', () => {
    const c = start(2, { mode: 'tres' }, 0)
    expect(actor(c)).toBe('p1')
  })
  it('ante com pouca ficha vira all-in e a mão corre sozinha até o showdown', () => {
    let c = start(3, { mode: 'tres' }, 0)
    c.state = rig(setStack(c.state, 'p0', 0), { p0: 'AsAdAc', p1: '2c3d9h', p2: '4c5d8h' }, '')
    // p0 sem fichas depois do ante: simula all-in pelo ante
    c.state.players[0].status = 'allin'
    c.state.players[0].contrib = 4
    c = act(c, 'p1', 'check'); c = act(c, 'p2', 'check')
    expect(c.state.phase).toBe('intervalo')
    // p0 só disputa o pote principal (3 x 4 = 12); p1 leva o lateral (2 x 6 = 12)
    expect(viewOf(c, null).showdown?.winners.map((w) => [w.playerId, w.amount])).toEqual([['p0', 12], ['p1', 12]])
  })
})

describe('você: melhor mão e dicas', () => {
  it('Hold\'em: best e draws na vez dele', () => {
    let c = start(2, {}, 0)
    c.state = rig(c.state, { p0: 'Ah2h', p1: 'KsQd' }, '7h9hKc3d4s')
    c = act(c, 'p0', 'call'); c = act(c, 'p1', 'check')
    const y = viewOf(c, 'p0').you!
    expect(y.hand).toEqual(['Ah', '2h'])
    expect(y.best?.name).toBe('Ás alto')
    expect(y.draws).toContain('Falta 1 carta para flush')
    const y1 = viewOf(c, 'p1').you!
    expect(y1.best?.name).toBe('Par de Reis')
    expect(viewOf(c, null).you).toBeNull()
  })
})

describe('segurança da visão', () => {
  it('nunca tem baralho nem cartas alheias antes do showdown', () => {
    let c = start(4, {}, 0)
    c = act(c, 'p3', 'call'); c = act(c, 'p0', 'call')
    for (const viewer of ['p0', 'p1', null] as const) {
      const v = viewOf(c, viewer)
      const json = JSON.stringify(v)
      expect(json).not.toContain('deck')
      for (const p of c.state.players) {
        if (p.playerId === viewer) continue
        for (const card of p.hole) {
          // a carta pode aparecer na mão de quem vê só se for a dele (impossível: baralho único)
          expect(json.includes(`"${card}"`)).toBe(false)
        }
      }
    }
  })
})
