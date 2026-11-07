import { describe, expect, it } from 'vitest'
import { buildGrid, findPath } from '../src/web/ui/roamGrid'

describe('Jan passeando: mapa e caminho', () => {
  it('bloqueia células onde ele encostaria no conteúdo', () => {
    // página 300×300, Jan 60, bloco de conteúdo no meio
    const g = buildGrid(300, 300, 60, [{ x: 100, y: 100, w: 100, h: 100 }])
    const at = (x: number, y: number) => g.free[Math.round(y / g.cell) * g.cols + Math.round(x / g.cell)]
    expect(at(0, 0)).toBe(1)
    expect(at(120, 120)).toBe(0)
    expect(at(60, 60)).toBe(0) // canto do Jan encostaria no bloco
    expect(at(240, 240)).toBe(1)
  })
  it('contorna o conteúdo em vez de atravessar', () => {
    const g = buildGrid(300, 300, 60, [{ x: 100, y: 0, w: 100, h: 220 }])
    const idx = (x: number, y: number) => Math.round(y / g.cell) * g.cols + Math.round(x / g.cell)
    const path = findPath(g, idx(0, 0), idx(240, 0))
    expect(path).not.toBeNull()
    // passa por baixo do bloco: alguma célula do caminho fica abaixo dele
    expect(path!.some((i) => Math.floor(i / g.cols) * g.cell >= 220)).toBe(true)
    expect(path!.every((i) => g.free[i] === 1)).toBe(true)
  })
  it('sem caminho quando o conteúdo separa as áreas', () => {
    const g = buildGrid(300, 300, 60, [{ x: 100, y: 0, w: 100, h: 300 }])
    const idx = (x: number, y: number) => Math.round(y / g.cell) * g.cols + Math.round(x / g.cell)
    expect(findPath(g, idx(0, 0), idx(240, 0))).toBeNull()
  })
})

import { regions } from '../src/web/ui/roamGrid'

describe('Jan passeando: áreas separadas', () => {
  it('identifica áreas livres que o conteúdo separa (para ele trocar pela borda)', () => {
    // conteúdo ocupando a largura toda no meio: área de cima e área de baixo
    const g = buildGrid(300, 400, 60, [{ x: 0, y: 150, w: 300, h: 80 }])
    const { sizes } = regions(g)
    expect(sizes.length).toBe(2)
    expect(sizes.every((n) => n > 0)).toBe(true)
  })
})
