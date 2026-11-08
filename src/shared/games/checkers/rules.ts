/**
 * Regras das damas brasileiras (8x8), sem nada da plataforma de jogos.
 *
 * - Só as casas escuras valem; a1 é escura. Brancas começam embaixo (fileiras 1 a 3) e jogam primeiro.
 * - Pedra anda uma casa na diagonal para a frente e captura para a frente e para trás.
 * - Dama anda e captura à distância ("dama voadora"), parando em qualquer casa livre depois da peça.
 * - Capturar é obrigatório e vale a lei da maioria: só valem as sequências que capturam mais peças.
 * - Na sequência, as peças capturadas só saem no fim: não dá para pular a mesma peça duas vezes
 *   e elas bloqueiam o caminho.
 * - A pedra só vira dama se terminar o lance na última fileira.
 *
 * Casa = índice 0..63, a1 = 0, h1 = 7, a8 = 56. Peças: w/b = pedra, W/B = dama, '.' = vazio.
 */

export type Side = 'w' | 'b'

export interface Position {
  board: string[]
  turn: Side
}

export interface CheckersMove {
  /** casas por onde a peça passa: origem, paradas e destino */
  path: number[]
  /** casas das peças capturadas, na ordem */
  captured: number[]
  piece: string
  /** pedra que terminou na última fileira */
  promote: boolean
}

const DIRS = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1]
]

export const other = (c: Side): Side => (c === 'w' ? 'b' : 'w')
export const sideOfPiece = (p: string): Side | null => (p === 'w' || p === 'W' ? 'w' : p === 'b' || p === 'B' ? 'b' : null)
export const isKing = (p: string): boolean => p === 'W' || p === 'B'
const fileOf = (sq: number): number => sq & 7
const rankOf = (sq: number): number => sq >> 3
const at = (f: number, r: number): number => (f >= 0 && f < 8 && r >= 0 && r < 8 ? r * 8 + f : -1)
const lastRank = (c: Side): number => (c === 'w' ? 7 : 0)

export const isDark = (sq: number): boolean => (fileOf(sq) + rankOf(sq)) % 2 === 0
export const squareName = (sq: number): string => 'abcdefgh'[fileOf(sq)] + String(rankOf(sq) + 1)
export function parseSquare(s: string): number | null {
  if (!/^[a-h][1-8]$/.test(s)) return null
  return s.charCodeAt(0) - 97 + (Number(s[1]) - 1) * 8
}

/**
 * Posição em texto: 8 linhas da fileira 8 até a 1, uma letra por casa ('.' vazio), e a vez.
 * Ex.: "b.b.b.b./.../w.w.w.w. w". Usado nos testes e no laboratório.
 */
export function fromText(text: string): Position {
  const [rows, turn = 'w'] = text.trim().split(/\s+/)
  const lines = rows.split('/')
  if (lines.length !== 8 || lines.some((l) => l.length !== 8)) throw new Error('posição inválida')
  const board: string[] = new Array(64).fill('.')
  lines.forEach((line, i) => [...line].forEach((ch, f) => (board[(7 - i) * 8 + f] = ch)))
  return { board, turn: turn === 'b' ? 'b' : 'w' }
}

export function toText(p: Position): string {
  const rows: string[] = []
  for (let r = 7; r >= 0; r--) rows.push(p.board.slice(r * 8, r * 8 + 8).join(''))
  return `${rows.join('/')} ${p.turn}`
}

export function initialPosition(): Position {
  const board: string[] = new Array(64).fill('.')
  for (let sq = 0; sq < 64; sq++) {
    if (!isDark(sq)) continue
    if (rankOf(sq) <= 2) board[sq] = 'w'
    else if (rankOf(sq) >= 5) board[sq] = 'b'
  }
  return { board, turn: 'w' }
}

/** Todas as sequências de captura da peça em `from` (cada uma até não dar para capturar mais). */
function captures(board: string[], from: number): CheckersMove[] {
  const piece = board[from]
  const me = sideOfPiece(piece) as Side
  const king = isKing(piece)
  const b = board.slice()
  b[from] = '.'
  const enemy = (sq: number) => sideOfPiece(b[sq]) === other(me)
  const out: CheckersMove[] = []
  const walk = (sq: number, path: number[], caps: number[]) => {
    let more = false
    const f = fileOf(sq)
    const r = rankOf(sq)
    for (const [df, dr] of DIRS) {
      if (!king) {
        const mid = at(f + df, r + dr)
        const land = at(f + 2 * df, r + 2 * dr)
        if (mid < 0 || land < 0 || !enemy(mid) || caps.includes(mid) || b[land] !== '.') continue
        more = true
        walk(land, [...path, land], [...caps, mid])
        continue
      }
      // dama: anda pelo vazio até achar uma peça; se for inimiga ainda não capturada, para em qualquer casa livre depois
      let k = 1
      let s = at(f + df, r + dr)
      while (s >= 0 && b[s] === '.') s = at(f + df * ++k, r + dr * k)
      if (s < 0 || !enemy(s) || caps.includes(s)) continue
      const mid = s
      for (let j = k + 1; ; j++) {
        const land = at(f + df * j, r + dr * j)
        if (land < 0 || b[land] !== '.') break
        more = true
        walk(land, [...path, land], [...caps, mid])
      }
    }
    if (!more && caps.length) out.push({ path, captured: caps, piece, promote: !king && rankOf(sq) === lastRank(me) })
  }
  walk(from, [from], [])
  return out
}

function simpleMoves(board: string[], from: number): CheckersMove[] {
  const piece = board[from]
  const me = sideOfPiece(piece) as Side
  const out: CheckersMove[] = []
  const f = fileOf(from)
  const r = rankOf(from)
  for (const [df, dr] of DIRS) {
    if (isKing(piece)) {
      for (let k = 1; ; k++) {
        const s = at(f + df * k, r + dr * k)
        if (s < 0 || board[s] !== '.') break
        out.push({ path: [from, s], captured: [], piece, promote: false })
      }
    } else if (dr === (me === 'w' ? 1 : -1)) {
      const s = at(f + df, r + dr)
      if (s >= 0 && board[s] === '.') out.push({ path: [from, s], captured: [], piece, promote: rankOf(s) === lastRank(me) })
    }
  }
  return out
}

/** Lances legais: se houver captura, só as que capturam mais peças; senão, os lances simples. */
export function legalMoves(p: Position): CheckersMove[] {
  const mine: number[] = []
  p.board.forEach((x, sq) => sideOfPiece(x) === p.turn && mine.push(sq))
  const caps = mine.flatMap((sq) => captures(p.board, sq))
  if (caps.length) {
    const most = Math.max(...caps.map((m) => m.captured.length))
    return caps.filter((m) => m.captured.length === most)
  }
  return mine.flatMap((sq) => simpleMoves(p.board, sq))
}

export function makeMove(p: Position, m: CheckersMove): Position {
  const b = p.board.slice()
  const to = m.path[m.path.length - 1]
  b[m.path[0]] = '.'
  for (const c of m.captured) b[c] = '.'
  b[to] = m.promote ? m.piece.toUpperCase() : m.piece
  return { board: b, turn: other(p.turn) }
}

/** "c3-d4", ou "c3xe5xg7" na captura */
export const notation = (m: CheckersMove): string => m.path.map(squareName).join(m.captured.length ? 'x' : '-')

export const positionKey = (p: Position): string => `${p.board.join('')} ${p.turn}`

export function perft(p: Position, depth: number): number {
  if (depth === 0) return 1
  const ms = legalMoves(p)
  if (depth === 1) return ms.length
  let n = 0
  for (const m of ms) n += perft(makeMove(p, m), depth - 1)
  return n
}

export const countPieces = (board: string[], c: Side): number => board.filter((x) => sideOfPiece(x) === c).length
