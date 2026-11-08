import { describe, expect, it } from 'vitest'
import { circleBlocked } from '../../src/shared/games/shooter/geom'
import { getMap, gridOf, LEGEND, MAPS, tileAt } from '../../src/shared/games/shooter/maps'
import { PLAYER_RADIUS, TILE, type MapDef } from '../../src/shared/games/shooter/types'

const ids = Object.keys(MAPS) as (keyof typeof MAPS)[]

/** Espalha-se pelo mapa em passos de 4 px com o círculo do jogador; devolve os pontos alcançados. */
function reach(map: MapDef, sx: number, sy: number): Set<number> {
  const g = gridOf(map)
  const S = 4
  const W = (map.w * TILE) / S
  const H = (map.h * TILE) / S
  const seen = new Set<number>()
  const key = (i: number, j: number): number => j * W + i
  const stack = [[sx / S, sy / S]]
  seen.add(key(sx / S, sy / S))
  while (stack.length) {
    const [i, j] = stack.pop()!
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di
      const nj = j + dj
      if (ni < 0 || nj < 0 || ni >= W || nj >= H || seen.has(key(ni, nj))) continue
      if (circleBlocked(g, ni * S, nj * S, PLAYER_RADIUS)) continue
      seen.add(key(ni, nj))
      stack.push([ni, nj])
    }
  }
  return seen
}

describe.each(ids)('mapa %s', (id) => {
  const map = getMap(id)

  it('dimensões batem e todo caractere está na legenda', () => {
    expect(map.id).toBe(id)
    expect(map.rows).toHaveLength(map.h)
    map.rows.forEach((r, y) => {
      expect(r.length, `linha ${y}`).toBe(map.w)
      for (const ch of r) expect(LEGEND[ch], `caractere '${ch}' na linha ${y}`).toBeDefined()
    })
  })

  it('bordas fechadas por parede', () => {
    for (let x = 0; x < map.w; x++) {
      expect(map.rows[0][x]).toBe('#')
      expect(map.rows[map.h - 1][x]).toBe('#')
    }
    for (let y = 0; y < map.h; y++) {
      expect(map.rows[y][0]).toBe('#')
      expect(map.rows[y][map.w - 1]).toBe('#')
    }
    expect(tileAt(map, -1, 3).solid).toBe(true)
    expect(tileAt(map, 3, map.h).blocksShot).toBe(true)
  })

  it('todo piso andável fica numa região só (com o raio do jogador)', () => {
    const first = map.spawns[0]
    const seen = reach(map, Math.round(first.x / 4) * 4, Math.round(first.y / 4) * 4)
    const W = (map.w * TILE) / 4
    const g = gridOf(map)
    let walkable = 0
    for (let ty = 0; ty < map.h; ty++) {
      for (let tx = 0; tx < map.w; tx++) {
        if (g.solid[ty * map.w + tx]) continue
        const cx = tx * TILE + 8
        const cy = ty * TILE + 8
        if (circleBlocked(g, cx, cy, PLAYER_RADIUS)) continue
        walkable++
        expect(seen.has((cy / 4) * W + cx / 4), `tile ${tx},${ty} (${map.rows[ty][tx]}) isolado`).toBe(true)
      }
    }
    expect(walkable).toBeGreaterThan(map.w * map.h * 0.5)
  })

  it('spawns e pickups em tiles andáveis e alcançáveis', () => {
    expect(map.spawns.length).toBeGreaterThanOrEqual(12)
    const g = gridOf(map)
    const first = map.spawns[0]
    const seen = reach(map, Math.round(first.x / 4) * 4, Math.round(first.y / 4) * 4)
    const W = (map.w * TILE) / 4
    for (const p of [...map.spawns, ...map.pickups]) {
      expect(p.x % TILE).toBe(8)
      expect(p.y % TILE).toBe(8)
      const tx = Math.floor(p.x / TILE)
      const ty = Math.floor(p.y / TILE)
      expect(tileAt(map, tx, ty).solid, `(${tx},${ty})`).toBe(false)
      expect(circleBlocked(g, p.x, p.y, PLAYER_RADIUS)).toBe(false)
      expect(seen.has((p.y / 4) * W + p.x / 4), `(${tx},${ty}) inalcançável`).toBe(true)
    }
    // spawns distintos
    expect(new Set(map.spawns.map((s) => `${s.x},${s.y}`)).size).toBe(map.spawns.length)
  })

  it('pickups: armas e vidas na quantidade pedida', () => {
    const count = (k: string): number => map.pickups.filter((p) => p.kind === k).length
    expect(count('escopeta')).toBe(2)
    expect(count('sub')).toBe(2)
    expect(count('rifle')).toBe(id === 'quintal' ? 2 : 1)
    expect(count('rolha')).toBe(1)
    expect(count('vida')).toBeGreaterThanOrEqual(3)
    expect(count('vida')).toBeLessThanOrEqual(4)
  })
})

describe('legenda', () => {
  it('móveis têm chave de arte própria e as regras certas', () => {
    expect(LEGEND['#']).toMatchObject({ solid: true, blocksShot: true })
    expect(LEGEND['~']).toMatchObject({ solid: false, slow: true, art: 'agua' })
    expect(LEGEND.m).toMatchObject({ solid: true, blocksShot: false, art: 'mureta' })
    expect(LEGEND.v).toMatchObject({ solid: false, blocksShot: false, art: 'varal' })
    expect(LEGEND.S.blocksShot).toBe(true)
    const arts = Object.values(LEGEND).map((t) => t.art)
    expect(new Set(arts).size).toBe(arts.length)
    for (const art of ['piso-madeira', 'piso-ceramica', 'tapete', 'grama', 'terra', 'parede', 'agua', 'sofa', 'tv', 'balcao', 'mesa-centro', 'cama', 'guarda-roupa', 'geladeira', 'fogao', 'vaso', 'mureta', 'varal', 'churrasqueira', 'arvore', 'cerca']) {
      expect(arts).toContain(art)
    }
  })

  it('a bazuca da casa fica perto da mesa de centro, no meio do mapa', () => {
    const casa = getMap('casa')
    const r = casa.pickups.find((p) => p.kind === 'rolha')!
    expect(Math.abs(r.x - (casa.w * TILE) / 2)).toBeLessThan(5 * TILE)
    const near = [-2, -1, 0, 1, 2].some((d) => [-2, -1, 0, 1, 2].some((e) => tileAt(casa, Math.floor(r.x / TILE) + d, Math.floor(r.y / TILE) + e).art === 'mesa-centro'))
    expect(near).toBe(true)
  })
})
