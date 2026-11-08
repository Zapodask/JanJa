/**
 * Mar e frota da batalha naval (regras puras, sem estado da partida).
 * Mar de 10x10; casa = {x, y} com x = coluna (0..9, A..J) e y = linha (0..9, 1..10).
 * Os navios ficam na horizontal ou na vertical e não podem encostar, nem na diagonal.
 */
import type { Rng } from '../types'

export const SIZE = 10

export interface ShipDef {
  id: string
  name: string
  size: number
}

export const FLEET: readonly ShipDef[] = [
  { id: 'porta-avioes', name: 'Porta-aviões', size: 5 },
  { id: 'encouracado', name: 'Encouraçado', size: 4 },
  { id: 'cruzador', name: 'Cruzador', size: 3 },
  { id: 'submarino', name: 'Submarino', size: 3 },
  { id: 'destroier', name: 'Destróier', size: 2 }
]

export type Dir = 'h' | 'v'

export interface Placement {
  id: string
  x: number
  y: number
  dir: Dir
}

export interface Cell {
  x: number
  y: number
}

export const shipDef = (id: string): ShipDef | undefined => FLEET.find((s) => s.id === id)

export function shipCells(p: Placement): Cell[] {
  const size = shipDef(p.id)?.size ?? 0
  return Array.from({ length: size }, (_, k) => (p.dir === 'h' ? { x: p.x + k, y: p.y } : { x: p.x, y: p.y + k }))
}

export const inside = (c: Cell): boolean => c.x >= 0 && c.y >= 0 && c.x < SIZE && c.y < SIZE
export const key = (c: Cell): string => `${c.x},${c.y}`
/** "B7" */
export const cellName = (c: Cell): string => `${'ABCDEFGHIJ'[c.x]}${c.y + 1}`

/** Pode colocar `p` junto dos `others`? (dentro do mar, sem sobrepor e sem encostar) */
export function fits(p: Placement, others: readonly Placement[]): boolean {
  const cells = shipCells(p)
  if (!cells.length || !cells.every(inside)) return false
  const near = new Set<string>()
  for (const o of others) {
    if (o.id === p.id) continue
    for (const c of shipCells(o)) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) near.add(key({ x: c.x + dx, y: c.y + dy }))
  }
  return cells.every((c) => !near.has(key(c)))
}

/** Frota completa e válida: cada navio uma vez, todos cabendo. Devolve o motivo se não for. */
export function checkFleet(ships: readonly Placement[]): string | null {
  if (ships.length !== FLEET.length) return 'Coloque todos os navios.'
  const ids = new Set(ships.map((s) => s.id))
  if (ids.size !== FLEET.length || !FLEET.every((d) => ids.has(d.id))) return 'Frota inválida.'
  for (const s of ships) {
    if (!Number.isInteger(s.x) || !Number.isInteger(s.y) || (s.dir !== 'h' && s.dir !== 'v')) return 'Posição inválida.'
    if (!shipCells(s).every(inside)) return `${shipDef(s.id)?.name} saiu do mar.`
    if (!fits(s, ships)) return `${shipDef(s.id)?.name} está encostado em outro navio.`
  }
  return null
}

/** Frota aleatória válida (os maiores primeiro). */
export function randomFleet(rng: Rng): Placement[] {
  for (;;) {
    const ships: Placement[] = []
    for (const d of FLEET) {
      let placed = false
      for (let tries = 0; tries < 200 && !placed; tries++) {
        const dir: Dir = rng.int(2) === 0 ? 'h' : 'v'
        const p = { id: d.id, x: rng.int(SIZE), y: rng.int(SIZE), dir }
        if (fits(p, ships)) {
          ships.push(p)
          placed = true
        }
      }
      if (!placed) break
    }
    if (ships.length === FLEET.length) return ships
  }
}
