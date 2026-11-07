import { describe, expect, it } from 'vitest'
import { bubbleText, planSteps, SeqGate, timeScale, totalMs } from '../src/web/game/scene/plan'
import type { PokerEvent } from '../src/shared/games/poker/types'

const evs: PokerEvent[] = [
  { kind: 'shuffle', handNo: 1 },
  { kind: 'deal', to: ['a', 'b'], count: 2 },
  { kind: 'blind', by: 'a', amount: 5 },
  { kind: 'act', by: 'b', action: 'call', amount: 10 },
  { kind: 'act', by: 'a', action: 'fold', amount: 0 },
  { kind: 'street', street: 'river', cards: ['As'] },
  { kind: 'win', by: 'b', amount: 15, potIndex: 0 }
]

describe('planSteps', () => {
  it('mapeia eventos em passos na ordem', () => {
    const s = planSteps(evs)
    expect(s.map((x) => x.kind)).toEqual(['shuffle', 'deal', 'chips', 'chips', 'fold', 'street', 'win'])
    expect(s.every((x) => x.ms >= 0)).toBe(true)
    expect(totalMs(s)).toBeGreaterThan(0)
  })
  it('lista vazia não gera passos', () => {
    expect(planSteps([])).toEqual([])
  })
  it('all-in vira passo próprio', () => {
    expect(planSteps([{ kind: 'act', by: 'a', action: 'allin', amount: 50 }])[0].kind).toBe('allin')
  })
})

describe('SeqGate', () => {
  const b = (seq: number) => ({ seq, events: [] }) as never
  it('o primeiro lote só é registrado, nunca animado', () => {
    const g = new SeqGate()
    expect(g.accept(b(3))).toBe(false)
  })
  it('seq repetido é ignorado e um novo é aceito uma vez', () => {
    const g = new SeqGate()
    g.accept(b(3))
    expect(g.accept(b(3))).toBe(false)
    expect(g.accept(b(4))).toBe(true)
    expect(g.accept(b(4))).toBe(false)
  })
  it('lote nulo não anima', () => {
    const g = new SeqGate()
    g.accept(null)
    expect(g.accept(null)).toBe(false)
  })
})

describe('timeScale', () => {
  it('encurta com fila longa e zera com movimento reduzido', () => {
    expect(timeScale(1000, false)).toBe(1)
    expect(timeScale(6000, false)).toBeLessThan(1)
    expect(timeScale(10000, false)).toBeLessThan(timeScale(6000, false))
    expect(timeScale(20000, false)).toBe(0)
    expect(timeScale(0, true)).toBe(0)
  })
})

describe('bubbleText', () => {
  it('textos em PT-BR', () => {
    expect(bubbleText({ kind: 'fold', by: 'a', ms: 1 })).toBe('Desistiu')
    expect(bubbleText({ kind: 'timeout', by: 'a', ms: 1 })).toBe('Tempo!')
    expect(bubbleText({ kind: 'win', by: 'a', amount: 15, potIndex: 0, ms: 1 })).toBe('Ganhou 15')
  })
})
