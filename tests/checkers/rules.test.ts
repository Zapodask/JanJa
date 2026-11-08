import { describe, expect, it } from 'vitest'
import { fromText, initialPosition, legalMoves, makeMove, notation, perft, toText } from '../../src/shared/games/checkers/rules'

/** posição em texto: fileira 8 em cima, a1 embaixo à esquerda */
const pos = (rows: string[], turn = 'w') => fromText(`${rows.join('/')} ${turn}`)
const moves = (p: ReturnType<typeof pos>) => legalMoves(p).map(notation).sort()

describe('regras das damas', () => {
  it('posição inicial: 12 peças de cada lado e as contagens de lances', () => {
    const p = initialPosition()
    expect(p.board.filter((x) => x === 'w')).toHaveLength(12)
    expect(p.board.filter((x) => x === 'b')).toHaveLength(12)
    expect(p.board[0]).toBe('w') // a1 é escura
    expect(perft(p, 1)).toBe(7)
    expect(perft(p, 2)).toBe(49)
    expect(perft(p, 3)).toBe(302)
    expect(toText(fromText(toText(p)))).toBe(toText(p))
  })

  it('capturar é obrigatório', () => {
    const p = pos(['........', '........', '........', '........', '...b....', '..w.....', '........', 'w.......'])
    expect(moves(p)).toEqual(['c3xe5'])
  })

  it('pedra captura para trás', () => {
    const p = pos(['........', '........', '........', '....w...', '...b....', '........', '........', '........'])
    expect(moves(p)).toEqual(['e5xc3'])
  })

  it('lei da maioria: só vale a sequência que captura mais', () => {
    const p = pos(['........', '........', '........', '....b...', '........', '......b.', '.b.....w', 'w.......'])
    expect(moves(p)).toEqual(['h2xf4xd6'])
  })

  it('dama voadora: captura de longe e para em qualquer casa livre depois', () => {
    const p = pos(['........', '........', '........', '........', '...b....', '........', '........', 'W.......'])
    expect(moves(p)).toEqual(['a1xe5', 'a1xf6', 'a1xg7', 'a1xh8'])
    // e anda à distância quando não há captura
    const q = pos(['........', '........', '........', '........', '........', '........', '........', 'W.......'])
    expect(moves(q)).toHaveLength(7)
  })

  it('a mesma peça não é capturada duas vezes', () => {
    // dama em a1 e uma pedra preta em c3: depois de capturar, não dá para voltar e pular de novo
    const p = pos(['........', '........', '........', '........', '........', '..b.....', '........', 'W.......'])
    for (const m of legalMoves(p)) expect(m.captured).toEqual([18])
  })

  it('a pedra só vira dama se terminar na última fileira', () => {
    const passa = pos(['...b....'.replace('b', '.'), '..b.b...', '.w......', '........', '........', '........', '........', '........'])
    const m = legalMoves(passa)
    expect(m.map(notation)).toEqual(['b6xd8xf6'])
    expect(m[0].promote).toBe(false)
    const para = pos(['........', '..b.....', '.w......', '........', '........', '........', '........', '........'])
    const [n] = legalMoves(para)
    expect(notation(n)).toBe('b6xd8')
    expect(makeMove(para, n).board[59]).toBe('W')
  })
})
