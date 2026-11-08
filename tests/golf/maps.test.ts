import { describe, expect, it } from 'vitest'
import { buildCourse, passable, tileAt, type Course } from '../../src/shared/games/golf/course'
import { MAPS } from '../../src/shared/games/golf/maps'

/** busca em largura pelos ladrilhos (sem água), respeitando degraus */
function reachable(c: Course): boolean {
  const key = (x: number, z: number) => z * c.w + x
  const start: [number, number] = [Math.floor(c.tee.x), Math.floor(c.tee.z)]
  const goal = key(Math.floor(c.cup.x), Math.floor(c.cup.z))
  const seen = new Set([key(...start)])
  const queue = [start]
  while (queue.length) {
    const [x, z] = queue.shift()!
    if (key(x, z) === goal) return true
    for (const [sx, sz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ] as const) {
      const nx = x + sx
      const nz = z + sz
      if (!passable(c, x, z, sx, sz) || tileAt(c, nx, nz).floor === 'water' || seen.has(key(nx, nz))) continue
      seen.add(key(nx, nz))
      queue.push([nx, nz])
    }
  }
  return false
}

describe('mapas do golfe', () => {
  it('cada mapa tem de 6 a 12 buracos e ids únicos', () => {
    expect(new Set(MAPS.map((m) => m.id)).size).toBe(MAPS.length)
    for (const m of MAPS) {
      expect(m.holes.length).toBeGreaterThanOrEqual(6)
      expect(m.holes.length).toBeLessThanOrEqual(12)
    }
  })

  for (const m of MAPS) {
    for (const [i, def] of m.holes.entries()) {
      it(`${m.name} ${i + 1} (${def.name}) é válido e dá para chegar ao buraco`, () => {
        const c = buildCourse(def)
        expect(def.rows.join('').split('T').length - 1).toBe(1)
        expect(def.rows.join('').split('O').length - 1).toBe(1)
        expect(def.par).toBeGreaterThanOrEqual(2)
        expect(def.par).toBeLessThanOrEqual(5)
        if (def.heights) expect(def.heights.length).toBe(def.rows.length)
        expect(tileAt(c, Math.floor(c.cup.x), Math.floor(c.cup.z)).floor).toBe('grass')
        expect(reachable(c)).toBe(true)
        for (const b of c.bumpers) {
          const dx = b.x - c.cup.x
          const dz = b.z - c.cup.z
          expect(Math.sqrt(dx * dx + dz * dz)).toBeGreaterThan(b.r + 0.3)
        }
      })
    }
  }

  it('rampa sobe quando o vizinho de cima está 1 nível acima', () => {
    const c = buildCourse(MAPS.find((m) => m.id === 'montanha')!.holes[0])
    expect(tileAt(c, 1, 3).floor).toBe('slope')
    expect(tileAt(c, 1, 3).rise).toBe(1)
    // de baixo sobe pela rampa; de cima do degrau dá para cair
    expect(passable(c, 1, 4, 0, -1)).toBe(true)
  })
})
