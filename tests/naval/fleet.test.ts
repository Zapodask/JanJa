import { describe, expect, it } from 'vitest'
import { cellName, checkFleet, fits, randomFleet, shipCells, type Placement } from '../../src/shared/games/naval/fleet'
import { seededRng } from '../../src/shared/games/types'

const OK: Placement[] = [
  { id: 'porta-avioes', x: 0, y: 0, dir: 'h' },
  { id: 'encouracado', x: 0, y: 2, dir: 'h' },
  { id: 'cruzador', x: 0, y: 4, dir: 'h' },
  { id: 'submarino', x: 0, y: 6, dir: 'h' },
  { id: 'destroier', x: 0, y: 8, dir: 'h' }
]

describe('frota', () => {
  it('casas de cada navio e nomes', () => {
    expect(shipCells({ id: 'destroier', x: 3, y: 4, dir: 'v' })).toEqual([
      { x: 3, y: 4 },
      { x: 3, y: 5 }
    ])
    expect(cellName({ x: 1, y: 6 })).toBe('B7')
  })

  it('frota válida e os motivos quando não é', () => {
    expect(checkFleet(OK)).toBeNull()
    expect(checkFleet(OK.slice(1))).toContain('todos')
    expect(checkFleet([...OK.slice(0, 4), { id: 'destroier', x: 9, y: 9, dir: 'h' }])).toContain('saiu do mar')
    // encostado na diagonal também não vale
    expect(checkFleet([...OK.slice(0, 4), { id: 'destroier', x: 3, y: 7, dir: 'h' }])).toContain('encostado')
    expect(checkFleet([...OK.slice(0, 4), { id: 'cruzador', x: 5, y: 8, dir: 'h' }])).toBe('Frota inválida.')
  })

  it('não pode encostar, mas pode ficar com uma casa de folga', () => {
    expect(fits({ id: 'destroier', x: 0, y: 1, dir: 'h' }, OK.slice(0, 1))).toBe(false)
    expect(fits({ id: 'destroier', x: 6, y: 1, dir: 'h' }, OK.slice(0, 1))).toBe(true)
  })

  it('frota aleatória sempre válida', () => {
    for (let seed = 1; seed <= 200; seed++) expect(checkFleet(randomFleet(seededRng(seed))), `semente ${seed}`).toBeNull()
  })
})
