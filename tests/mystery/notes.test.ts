import { describe, expect, it } from 'vitest'
import { autoMarks, inEnvelope, merge, nextMark, ruledOut } from '../../src/web/game/mystery/scene/notes'
import type { MysteryView } from '../../src/shared/games/mystery/types'

const base = (over: Partial<MysteryView>): MysteryView =>
  ({
    you: { playerId: 'p0', index: 0 },
    players: [0, 1, 2, 3].map((i) => ({ playerId: `p${i}`, name: `P${i}`, index: i, cards: 4, out: false, away: false })),
    myCards: ['odete', 'cozinha'],
    history: [],
    ...over
  }) as MysteryView

describe('caderno do Mistério', () => {
  it('as suas cartas: tem nas suas e não tem nas outras', () => {
    const m = autoMarks(base({}))
    expect(m.odete[0]).toBe('tem')
    expect(m.valdir[0]).toBe('nao')
  })

  it('carta mostrada para você e quem foi pulado', () => {
    const m = autoMarks(
      base({
        history: [
          { by: 0, quem: 'lia', onde: 'jardim', como: 'escada', shownBy: 2, card: 'escada' },
          // palpite da P3 que ninguém respondeu: todos os outros não têm
          { by: 3, quem: 'rafa', onde: 'porao', como: 'chaves', shownBy: null }
        ]
      })
    )
    expect(m.escada[2]).toBe('tem')
    expect(m.lia[1]).toBe('nao') // P1 foi pulada: não tem nenhuma das três
    expect(m.jardim[1]).toBe('nao')
    expect(m.lia[2]).toBeUndefined() // P2 mostrou uma, não dá para saber das outras
    expect(m.rafa[1]).toBe('nao')
    expect(m.rafa[2]).toBe('nao')
    expect(m.rafa[3]).toBeUndefined() // quem palpitou pode ter
  })

  it('descartada, envelope e ciclo das marcas', () => {
    const m = merge(autoMarks(base({})), { valdir: { 1: 'nao', 2: 'nao', 3: 'nao' }, odete: { 1: 'tem' } })
    expect(ruledOut(m, 'odete')).toBe(true)
    expect(inEnvelope(m, 'valdir', 4)).toBe(true)
    expect(m.odete[1]).toBe('nao') // o automático manda (você tem a Odete, logo P1 não)
    expect(['', 'nao', 'tem', 'talvez', ''].map((x, i, a) => (i ? nextMark(a[i - 1] as never) : x))).toEqual(['', 'nao', 'tem', 'talvez', ''])
  })
})
