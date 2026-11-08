import { describe, expect, it } from 'vitest'
import {
  fromFen,
  insufficientMaterial,
  legalMoves,
  makeMove,
  parseSquare,
  perft,
  positionKey,
  san,
  START_FEN,
  toFen,
  type Position
} from '../../src/shared/games/chess/rules'

/** Contagens de referência (chessprogramming.org/Perft_Results): pegam erro em roque, en passant, promoção e cravada. */
const PERFT: Array<[string, string, number[]]> = [
  ['inicial', START_FEN, [20, 400, 8902]],
  ['kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
  ['posição 3', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
  ['posição 4', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
  ['posição 5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]]
]

/** joga lances em SAN a partir de uma posição */
function play(p: Position, ...sans: string[]): Position {
  for (const s of sans) {
    const legal = legalMoves(p)
    const m = legal.find((x) => san(p, x, legal).replace(/[+#]$/, '') === s.replace(/[+#]$/, ''))
    if (!m) throw new Error(`lance ${s} não encontrado em ${toFen(p)}`)
    p = makeMove(p, m)
  }
  return p
}

describe('regras do xadrez', () => {
  for (const [name, fen, counts] of PERFT) {
    it(`perft ${name}`, () => {
      const p = fromFen(fen)
      counts.forEach((n, i) => expect(perft(p, i + 1)).toBe(n))
    })
  }

  it('FEN vai e volta', () => {
    for (const [, fen] of PERFT) expect(toFen(fromFen(fen))).toBe(fen)
  })

  it('casas', () => {
    expect(parseSquare('a1')).toBe(0)
    expect(parseSquare('h8')).toBe(63)
    expect(parseSquare('i9')).toBeNull()
  })

  it('notação: roque, desambiguação, promoção e mate', () => {
    const k = fromFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1')
    const sans = legalMoves(k).map((m) => san(k, m))
    expect(sans).toContain('O-O')
    expect(sans).toContain('O-O-O')
    expect(sans).toContain('Nxf7')
    const rooks = fromFen('4k3/8/8/8/8/8/4K3/R6R w - - 0 1')
    expect(legalMoves(rooks).map((m) => san(rooks, m))).toEqual(expect.arrayContaining(['Rad1', 'Rhd1', 'Rab1']))
    const promo = fromFen('8/P7/8/8/8/8/8/k1K5 w - - 0 1')
    expect(legalMoves(promo).map((m) => san(promo, m))).toEqual(expect.arrayContaining(['a8=Q#', 'a8=N']))
    const fool = play(fromFen(START_FEN), 'f3', 'e5', 'g4')
    const mate = legalMoves(fool).find((m) => san(fool, m) === 'Qh4#')
    expect(mate).toBeDefined()
    expect(legalMoves(makeMove(fool, mate!))).toHaveLength(0)
  })

  it('en passant só conta na repetição quando dá para capturar', () => {
    const a = play(fromFen(START_FEN), 'e4')
    expect(a.ep).toBe(parseSquare('e3'))
    expect(positionKey(a).endsWith(' -')).toBe(true)
    const b = play(fromFen(START_FEN), 'e4', 'a6', 'e5', 'd5')
    expect(positionKey(b).endsWith(' d6')).toBe(true)
  })

  it('material insuficiente', () => {
    expect(insufficientMaterial(fromFen('8/8/8/4k3/8/8/8/4K3 w - - 0 1').board)).toBe(true)
    expect(insufficientMaterial(fromFen('8/8/8/4k3/8/8/8/3NK3 w - - 0 1').board)).toBe(true)
    expect(insufficientMaterial(fromFen('8/8/8/2b1k3/8/8/8/2B1K3 w - - 0 1').board)).toBe(true)
    expect(insufficientMaterial(fromFen('8/8/8/1b2k3/8/8/8/2B1K3 w - - 0 1').board)).toBe(false)
    expect(insufficientMaterial(fromFen('8/8/8/4k3/8/8/8/3RK3 w - - 0 1').board)).toBe(false)
  })
})
