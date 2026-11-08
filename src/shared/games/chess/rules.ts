/**
 * Regras do xadrez, sem nada da plataforma de jogos: posição, lances legais, notação e fim de jogo.
 * Casa = índice 0..63, com a1 = 0, h1 = 7, a8 = 56 (rank * 8 + file).
 * Peças como na FEN: maiúscula = brancas, minúscula = pretas, '.' = vazio.
 */

export type Color = 'w' | 'b'
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k'
export type Promo = 'q' | 'r' | 'b' | 'n'

export interface Position {
  /** 64 casas */
  board: string[]
  turn: Color
  /** subconjunto de "KQkq" ('' = ninguém roca) */
  castling: string
  /** casa do en passant (atrás do peão que andou duas), ou null */
  ep: number | null
  /** lances desde a última captura ou lance de peão (regra dos 50 lances) */
  halfmove: number
  fullmove: number
}

export interface Move {
  from: number
  to: number
  /** peça que anda (letra FEN) */
  piece: string
  /** peça capturada (letra FEN), inclusive no en passant */
  captured?: string
  promo?: Promo
  flag?: 'ep' | 'castle' | 'double'
}

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
export const PROMOS: readonly Promo[] = ['q', 'r', 'b', 'n']

export const other = (c: Color): Color => (c === 'w' ? 'b' : 'w')
export const colorOf = (p: string): Color | null => (p === '.' ? null : p === p.toUpperCase() ? 'w' : 'b')
export const typeOf = (p: string): PieceType => p.toLowerCase() as PieceType
const fileOf = (sq: number): number => sq & 7
const rankOf = (sq: number): number => sq >> 3
const at = (f: number, r: number): number => (f >= 0 && f < 8 && r >= 0 && r < 8 ? r * 8 + f : -1)

export const squareName = (sq: number): string => 'abcdefgh'[fileOf(sq)] + String(rankOf(sq) + 1)
export function parseSquare(s: string): number | null {
  if (!/^[a-h][1-8]$/.test(s)) return null
  return s.charCodeAt(0) - 97 + (Number(s[1]) - 1) * 8
}
/** casa clara? (a1 é escura) */
export const isLight = (sq: number): boolean => (fileOf(sq) + rankOf(sq)) % 2 === 1

// ---------- FEN ----------
export function fromFen(fen: string): Position {
  const [rows, turn = 'w', castling = '-', ep = '-', half = '0', full = '1'] = fen.trim().split(/\s+/)
  const board: string[] = new Array(64).fill('.')
  const ranks = rows.split('/')
  if (ranks.length !== 8) throw new Error('FEN inválida')
  ranks.forEach((row, i) => {
    const r = 7 - i
    let f = 0
    for (const ch of row) {
      if (/[1-8]/.test(ch)) f += Number(ch)
      else board[r * 8 + f++] = ch
    }
  })
  return {
    board,
    turn: turn === 'b' ? 'b' : 'w',
    castling: castling === '-' ? '' : castling,
    ep: ep === '-' ? null : parseSquare(ep),
    halfmove: Number(half) || 0,
    fullmove: Number(full) || 1
  }
}

export function toFen(p: Position): string {
  const rows: string[] = []
  for (let r = 7; r >= 0; r--) {
    let row = ''
    let empty = 0
    for (let f = 0; f < 8; f++) {
      const x = p.board[r * 8 + f]
      if (x === '.') empty++
      else {
        if (empty) row += String(empty)
        empty = 0
        row += x
      }
    }
    rows.push(row + (empty ? String(empty) : ''))
  }
  return `${rows.join('/')} ${p.turn} ${p.castling || '-'} ${p.ep === null ? '-' : squareName(p.ep)} ${p.halfmove} ${p.fullmove}`
}

// ---------- ataque ----------
const KNIGHT = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2]
]
const KING = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1]
]
const DIAG = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1]
]
const LINE = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1]
]

const piece = (t: PieceType, c: Color): string => (c === 'w' ? t.toUpperCase() : t)

/** A casa `sq` é atacada por alguma peça da cor `by`? */
export function attacked(board: string[], sq: number, by: Color): boolean {
  const f = fileOf(sq)
  const r = rankOf(sq)
  const pawnRow = by === 'w' ? r - 1 : r + 1
  for (const df of [-1, 1]) {
    const s = at(f + df, pawnRow)
    if (s >= 0 && board[s] === piece('p', by)) return true
  }
  for (const [df, dr] of KNIGHT) {
    const s = at(f + df, r + dr)
    if (s >= 0 && board[s] === piece('n', by)) return true
  }
  for (const [df, dr] of KING) {
    const s = at(f + df, r + dr)
    if (s >= 0 && board[s] === piece('k', by)) return true
  }
  const slide = (dirs: number[][], a: PieceType): boolean => {
    for (const [df, dr] of dirs) {
      for (let k = 1; ; k++) {
        const s = at(f + df * k, r + dr * k)
        if (s < 0) break
        const x = board[s]
        if (x === '.') continue
        if (x === piece(a, by) || x === piece('q', by)) return true
        break
      }
    }
    return false
  }
  return slide(DIAG, 'b') || slide(LINE, 'r')
}

export const kingSquare = (board: string[], c: Color): number => board.indexOf(piece('k', c))

export function inCheck(p: Position, c: Color = p.turn): boolean {
  const k = kingSquare(p.board, c)
  return k >= 0 && attacked(p.board, k, other(c))
}

// ---------- lances ----------
function pseudoMoves(p: Position): Move[] {
  const out: Move[] = []
  const me = p.turn
  const b = p.board
  const add = (from: number, to: number, extra: Partial<Move> = {}) => {
    const cap = b[to]
    out.push({ from, to, piece: b[from], ...(cap !== '.' ? { captured: cap } : {}), ...extra })
  }
  const addPawn = (from: number, to: number, extra: Partial<Move> = {}) => {
    const last = me === 'w' ? 7 : 0
    if (rankOf(to) === last) for (const promo of PROMOS) add(from, to, { ...extra, promo })
    else add(from, to, extra)
  }
  for (let sq = 0; sq < 64; sq++) {
    const x = b[sq]
    if (colorOf(x) !== me) continue
    const f = fileOf(sq)
    const r = rankOf(sq)
    const t = typeOf(x)
    if (t === 'p') {
      const dir = me === 'w' ? 1 : -1
      const one = at(f, r + dir)
      if (one >= 0 && b[one] === '.') {
        addPawn(sq, one)
        const two = at(f, r + 2 * dir)
        if (r === (me === 'w' ? 1 : 6) && b[two] === '.') add(sq, two, { flag: 'double' })
      }
      for (const df of [-1, 1]) {
        const s = at(f + df, r + dir)
        if (s < 0) continue
        if (colorOf(b[s]) === other(me)) addPawn(sq, s)
        else if (s === p.ep) out.push({ from: sq, to: s, piece: x, captured: piece('p', other(me)), flag: 'ep' })
      }
    } else if (t === 'n' || t === 'k') {
      for (const [df, dr] of t === 'n' ? KNIGHT : KING) {
        const s = at(f + df, r + dr)
        if (s >= 0 && colorOf(b[s]) !== me) add(sq, s)
      }
      if (t === 'k') castles(p, sq, out)
    } else {
      const dirs = t === 'b' ? DIAG : t === 'r' ? LINE : [...DIAG, ...LINE]
      for (const [df, dr] of dirs) {
        for (let k = 1; ; k++) {
          const s = at(f + df * k, r + dr * k)
          if (s < 0) break
          const c = colorOf(b[s])
          if (c === me) break
          add(sq, s)
          if (c) break
        }
      }
    }
  }
  return out
}

function castles(p: Position, sq: number, out: Move[]): void {
  const me = p.turn
  const home = me === 'w' ? 4 : 60
  if (sq !== home) return
  const b = p.board
  const enemy = other(me)
  const king = b[sq]
  const rook = piece('r', me)
  const empty = (...s: number[]) => s.every((x) => b[x] === '.')
  const safe = (...s: number[]) => s.every((x) => !attacked(b, x, enemy))
  const [kSide, qSide] = me === 'w' ? ['K', 'Q'] : ['k', 'q']
  if (p.castling.includes(kSide) && b[home + 3] === rook && empty(home + 1, home + 2) && safe(home, home + 1, home + 2)) {
    out.push({ from: home, to: home + 2, piece: king, flag: 'castle' })
  }
  if (p.castling.includes(qSide) && b[home - 4] === rook && empty(home - 1, home - 2, home - 3) && safe(home, home - 1, home - 2)) {
    out.push({ from: home, to: home - 2, piece: king, flag: 'castle' })
  }
}

const CASTLE_RIGHT: Record<number, string> = { 0: 'Q', 7: 'K', 56: 'q', 63: 'k' }

/** Faz o lance (sem conferir se é legal). */
export function makeMove(p: Position, m: Move): Position {
  const b = p.board.slice()
  const me = p.turn
  b[m.to] = m.promo ? piece(m.promo, me) : b[m.from]
  b[m.from] = '.'
  if (m.flag === 'ep') b[m.to + (me === 'w' ? -8 : 8)] = '.'
  if (m.flag === 'castle') {
    const [rf, rt] = m.to > m.from ? [m.from + 3, m.from + 1] : [m.from - 4, m.from - 1]
    b[rt] = b[rf]
    b[rf] = '.'
  }
  let castling = p.castling
  if (typeOf(m.piece) === 'k') castling = castling.replace(me === 'w' ? /[KQ]/g : /[kq]/g, '')
  for (const s of [m.from, m.to]) if (CASTLE_RIGHT[s]) castling = castling.replace(CASTLE_RIGHT[s], '')
  return {
    board: b,
    turn: other(me),
    castling,
    ep: m.flag === 'double' ? (m.from + m.to) / 2 : null,
    halfmove: typeOf(m.piece) === 'p' || m.captured ? 0 : p.halfmove + 1,
    fullmove: me === 'b' ? p.fullmove + 1 : p.fullmove
  }
}

export function legalMoves(p: Position): Move[] {
  return pseudoMoves(p).filter((m) => !inCheck(makeMove(p, m), p.turn))
}

/** Conta as posições até `depth` (teste do gerador de lances). */
export function perft(p: Position, depth: number): number {
  if (depth === 0) return 1
  const ms = legalMoves(p)
  if (depth === 1) return ms.length
  let n = 0
  for (const m of ms) n += perft(makeMove(p, m), depth - 1)
  return n
}

// ---------- notação ----------
const LETTER: Record<PieceType, string> = { p: '', n: 'N', b: 'B', r: 'R', q: 'Q', k: 'K' }

/** Notação algébrica (SAN), ex.: "Nf3", "exd5", "O-O", "e8=Q#". `legal` = lances legais de `p`. */
export function san(p: Position, m: Move, legal: Move[] = legalMoves(p)): string {
  let s: string
  if (m.flag === 'castle') s = m.to > m.from ? 'O-O' : 'O-O-O'
  else {
    const t = typeOf(m.piece)
    const dest = squareName(m.to)
    if (t === 'p') s = (m.captured ? `${'abcdefgh'[fileOf(m.from)]}x` : '') + dest + (m.promo ? `=${LETTER[m.promo]}` : '')
    else {
      const rivals = legal.filter((x) => x.to === m.to && x.from !== m.from && x.piece === m.piece)
      let dis = ''
      if (rivals.length) {
        if (!rivals.some((x) => fileOf(x.from) === fileOf(m.from))) dis = 'abcdefgh'[fileOf(m.from)]
        else if (!rivals.some((x) => rankOf(x.from) === rankOf(m.from))) dis = String(rankOf(m.from) + 1)
        else dis = squareName(m.from)
      }
      s = LETTER[t] + dis + (m.captured ? 'x' : '') + dest
    }
  }
  const after = makeMove(p, m)
  if (inCheck(after)) s += legalMoves(after).length === 0 ? '#' : '+'
  return s
}

// ---------- fim de jogo ----------
/** Chave para repetição: peças, vez, roques e en passant só se der para capturar de verdade. */
export function positionKey(p: Position): string {
  const ep = p.ep !== null && legalMoves(p).some((m) => m.flag === 'ep') ? squareName(p.ep) : '-'
  return `${p.board.join('')} ${p.turn} ${p.castling || '-'} ${ep}`
}

/** Ninguém consegue dar mate: só reis, rei e uma peça menor, ou só bispos na mesma cor de casa. */
export function insufficientMaterial(board: string[]): boolean {
  const rest: Array<{ t: PieceType; sq: number }> = []
  board.forEach((x, sq) => {
    if (x !== '.' && typeOf(x) !== 'k') rest.push({ t: typeOf(x), sq })
  })
  if (rest.length === 0) return true
  if (rest.length === 1 && (rest[0].t === 'n' || rest[0].t === 'b')) return true
  if (rest.every((x) => x.t === 'b')) return rest.every((x) => isLight(x.sq) === isLight(rest[0].sq))
  return false
}

/** A cor só tem o rei (não consegue dar mate de jeito nenhum; usado quando o outro perde no tempo). */
export const loneKing = (board: string[], c: Color): boolean => board.every((x) => x === '.' || colorOf(x) !== c || typeOf(x) === 'k')
