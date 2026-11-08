/**
 * Peças do xadrez em pixel art, desenhadas em código: grade 16x16, uma letra por cor.
 * k = contorno, f = corpo, s = sombra, h = brilho. Sem React (o teste importa daqui).
 */
import type { PieceType } from '../../../../shared/games/chess/rules'

export const PIECE_SIZE = 16

export const PIECES: Record<PieceType, string[]> = {
  p: [
    '................',
    '................',
    '................',
    '......kkkk......',
    '.....khfffk.....',
    '.....kfffsk.....',
    '......kssk......',
    '.....kffffk.....',
    '......kffk......',
    '......kffk......',
    '.....kffssk.....',
    '....kffffssk....',
    '...khffffffsk...',
    '...kssssssssk...',
    '...kkkkkkkkkk...',
    '................'
  ],
  r: [
    '................',
    '...kkk.kk.kkk...',
    '...khkkffkkfk...',
    '...khffffffsk...',
    '...kssssssssk...',
    '....khfffffk....',
    '....khffffsk....',
    '....khffffsk....',
    '....khffffsk....',
    '....khffffsk....',
    '...kssssssssk...',
    '..khffffffffsk..',
    '..khffffffffsk..',
    '..kssssssssssk..',
    '..kkkkkkkkkkkk..',
    '................'
  ],
  n: [
    '................',
    '.......k.k......',
    '......kfkfk.....',
    '.....khffffk....',
    '....khfkfffsk...',
    '...khffffffsk...',
    '..khffffffffsk..',
    '..kffkkkhfffsk..',
    '...kk..khffsk...',
    '......khfffsk...',
    '.....khffffsk...',
    '....kssssssssk..',
    '...khffffffffsk.',
    '...kssssssssssk.',
    '...kkkkkkkkkkkk.',
    '................'
  ],
  b: [
    '................',
    '.......kk.......',
    '......khsk......',
    '.......kk.......',
    '......khfk......',
    '.....khfkfk.....',
    '.....kfkffk.....',
    '.....khffsk.....',
    '......kfsk......',
    '......kfsk......',
    '.....kssssk.....',
    '....khffffsk....',
    '...khffffffsk...',
    '...kssssssssk...',
    '...kkkkkkkkkk...',
    '................'
  ],
  q: [
    '................',
    '..k...k..k...k..',
    '.khk.khkkhk.khk.',
    '..kk.kfkkfk.kk..',
    '..kfkkffffkkfk..',
    '..khffffffffsk..',
    '...khffffffsk...',
    '....kssssssk....',
    '.....khfssk.....',
    '.....khfssk.....',
    '....kssssssk....',
    '...khffffffsk...',
    '..khffffffffsk..',
    '..kssssssssssk..',
    '..kkkkkkkkkkkk..',
    '................'
  ],
  k: [
    '.......kk.......',
    '......khsk......',
    '.....kkfskk.....',
    '.....khffsk.....',
    '.....kkfskk.....',
    '...kkk.kk.kkk...',
    '..khffkffkffsk..',
    '..khffffffffsk..',
    '...khffffffsk...',
    '....kssssssk....',
    '.....khfssk.....',
    '....kssssssk....',
    '...khffffffsk...',
    '..khffffffffsk..',
    '..kkkkkkkkkkkk..',
    '................'
  ]
}

/** cores por lado: brancas em papel, pretas em café com brilho de abajur */
export const PIECE_PALETTE: Record<'w' | 'b', Record<string, string>> = {
  w: { k: '#0F0B09', f: '#F3EBDD', s: '#B7A99A', h: '#FFFFFF' },
  b: { k: '#0F0B09', f: '#3B312C', s: '#221C19', h: '#6E5A4E' }
}

export interface PixelRun {
  x: number
  y: number
  w: number
  fill: string
}

/** Junta pixels iguais e vizinhos na mesma linha (menos <rect> no SVG). */
export function pieceRuns(type: PieceType, color: 'w' | 'b'): PixelRun[] {
  const pal = PIECE_PALETTE[color]
  const out: PixelRun[] = []
  PIECES[type].forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const ch = row[x]
      if (ch === '.') {
        x++
        continue
      }
      let w = 1
      while (row[x + w] === ch) w++
      out.push({ x, y, w, fill: pal[ch] })
      x += w
    }
  })
  return out
}
