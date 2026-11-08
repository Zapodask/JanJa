/**
 * Pixel art da sinuca, gerada em código. Sem DOM: o teste importa daqui.
 * Escala: 4 pixels por unidade da mesa, então a bola (raio 1,12) vira um disco de 9 pixels.
 */
export const PX = 4
export const BALL_PX = 9

/** cores das bolas 1..7 (as listradas 9..15 repetem com faixa branca) */
export const BALL_COLORS = ['#FFC94A', '#4F7FD9', '#E05A4A', '#9A6AD0', '#F08A3C', '#4FB07A', '#A8432E']

export const TABLE_COLORS = {
  felt: '#2F6B4C',
  feltDark: '#285D42',
  cushion: '#24543B',
  wood: '#6E4A36',
  woodDark: '#4E3426',
  woodLight: '#8A5E44',
  pocket: '#0F0B09',
  diamond: '#F3EBDD',
  line: '#3E7D5C'
}

const colorOf = (id: number): string => (id === 0 ? '#F3EBDD' : id === 8 ? '#221C19' : BALL_COLORS[(id > 8 ? id - 8 : id) - 1])

/**
 * Bola como grade (uma letra por pixel): k contorno, c cor, w branco, h brilho, '.' fora.
 * Listradas: branco em cima e embaixo, cor no meio.
 */
export function ballGrid(id: number): string[] {
  const n = BALL_PX
  const c = (n - 1) / 2
  const inside = (x: number, y: number) => (x - c) * (x - c) + (y - c) * (y - c) <= 4.6 * 4.6
  const rows: string[] = []
  for (let y = 0; y < n; y++) {
    let row = ''
    for (let x = 0; x < n; x++) {
      if (!inside(x, y)) {
        row += '.'
        continue
      }
      const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)
      if (edge) row += 'k'
      else if (x === 3 && y === 2) row += 'h'
      else if (id >= 9 && (y <= 2 || y >= 6)) row += 'w'
      else row += 'c'
    }
    rows.push(row)
  }
  return rows
}

export function ballFill(id: number, ch: string): string {
  if (ch === 'k') return id === 8 ? '#0F0B09' : '#1A1411'
  if (ch === 'h') return '#FFFFFF'
  if (ch === 'w') return '#F3EBDD'
  return colorOf(id)
}

export const ballColor = colorOf
