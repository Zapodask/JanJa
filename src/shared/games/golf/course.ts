/**
 * Buraco de mini-golfe descrito em texto (ASCII) e transformado em geometria pura:
 * pisos, alturas, paredes (segmentos) e para-choques. Mesmo código no Worker, nos testes e na cena 3D.
 *
 * Coordenadas: 1 unidade = 1 ladrilho. x = coluna (cresce para a direita), z = linha (cresce para baixo).
 *
 * Legenda dos ladrilhos:
 *   ' ' vazio (borda)         '#' bloco (parede)
 *   '.' grama                 'T' saída (grama)        'O' buraco (grama)
 *   ':' areia                 '~' água (volta e +1 tacada)
 *   '>' '<' '^' 'v' ladeira; a seta aponta para onde a bola desce
 *   'R' 'L' 'U' 'D' acelerador (direita, esquerda, cima, baixo)
 *
 * Alturas: uma grade de dígitos opcional (padrão 0). Na ladeira o dígito é a ponta de baixo;
 * se o vizinho de cima da ladeira estiver 1 nível acima ela vira rampa (sobe 1), senão é só inclinada.
 */

export type Floor = 'grass' | 'sand' | 'water' | 'slope' | 'boost'

export interface Tile {
  /** null = sem piso (vazio ou bloco) */
  floor: Floor | null
  block: boolean
  /** direção (ladeira: para onde desce; acelerador: para onde empurra) */
  dx: number
  dz: number
  /** altura da ponta de baixo */
  base: number
  /** quanto a rampa sobe (0 = só inclinada) */
  rise: number
}

/** Parede de um lado só: a bola bate vindo do lado para onde `nx,nz` aponta. */
export interface Wall {
  ax: number
  az: number
  bx: number
  bz: number
  nx: number
  nz: number
}

export interface Bumper {
  x: number
  z: number
  r: number
}

export interface HoleDef {
  name: string
  par: number
  rows: string[]
  heights?: string[]
  /** [x, z, raio] em ladrilhos */
  bumpers?: Array<[number, number, number]>
}

export interface Course {
  name: string
  par: number
  w: number
  h: number
  tiles: Tile[]
  walls: Wall[]
  /** índices em `walls` por ladrilho (paredes nas bordas daquele ladrilho e dos vizinhos) */
  wallsAt: number[][]
  bumpers: Bumper[]
  tee: { x: number; z: number }
  cup: { x: number; z: number }
}

/** quanto mede, em unidades do mundo, um nível de altura (só visual) */
export const LEVEL_H = 0.4

const DIRS: Record<string, [number, number]> = {
  '>': [1, 0],
  '<': [-1, 0],
  '^': [0, -1],
  v: [0, 1],
  R: [1, 0],
  L: [-1, 0],
  U: [0, -1],
  D: [0, 1]
}

const VOID: Tile = { floor: null, block: false, dx: 0, dz: 0, base: 0, rise: 0 }

export function tileAt(c: Course, tx: number, tz: number): Tile {
  if (tx < 0 || tz < 0 || tx >= c.w || tz >= c.h) return VOID
  return c.tiles[tz * c.w + tx]
}

/** altura da borda do ladrilho do lado (sx,sz) — um de (1,0) (-1,0) (0,1) (0,-1) */
function edgeHeight(t: Tile, sx: number, sz: number): number {
  if (t.floor !== 'slope') return t.base
  if (sx === t.dx && sz === t.dz) return t.base
  if (sx === -t.dx && sz === -t.dz) return t.base + t.rise
  return t.base + t.rise / 2
}

/** altura da superfície (em níveis) no ponto, para a cena 3D */
export function surfaceLevel(c: Course, x: number, z: number): number {
  const tx = Math.floor(x)
  const tz = Math.floor(z)
  const t = tileAt(c, tx, tz)
  if (t.floor !== 'slope' || t.rise === 0) return t.base
  const fx = x - tx
  const fz = z - tz
  // fração "morro acima" dentro do ladrilho: 0 na ponta de baixo, 1 na de cima
  const up = t.dx === 1 ? 1 - fx : t.dx === -1 ? fx : t.dz === 1 ? 1 - fz : fz
  return t.base + t.rise * up
}

export const isFloor = (t: Tile): boolean => t.floor !== null

/**
 * Pode passar do ladrilho a para o vizinho na direção (sx,sz)? Igual ou descendo pode;
 * subindo degrau sem rampa não. Usado pelo teste de mapas (alcance) e para montar as paredes.
 */
export function passable(c: Course, tx: number, tz: number, sx: number, sz: number): boolean {
  const a = tileAt(c, tx, tz)
  const b = tileAt(c, tx + sx, tz + sz)
  if (!isFloor(a) || !isFloor(b)) return false
  return edgeHeight(b, -sx, -sz) <= edgeHeight(a, sx, sz) + 1e-6
}

const cache = new Map<HoleDef, Course>()

export function buildCourse(def: HoleDef): Course {
  const hit = cache.get(def)
  if (hit) return hit
  const h = def.rows.length
  const w = Math.max(...def.rows.map((r) => r.length))
  const tiles: Tile[] = []
  let tee: { x: number; z: number } | null = null
  let cup: { x: number; z: number } | null = null
  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      const ch = def.rows[z][x] ?? ' '
      const hc = def.heights?.[z]?.[x]
      const base = hc && hc >= '0' && hc <= '9' ? Number(hc) : 0
      let t: Tile
      if (ch === ' ') t = { ...VOID }
      else if (ch === '#') t = { ...VOID, block: true, base }
      else if (ch === ':') t = { floor: 'sand', block: false, dx: 0, dz: 0, base, rise: 0 }
      else if (ch === '~') t = { floor: 'water', block: false, dx: 0, dz: 0, base, rise: 0 }
      else if ('><^v'.includes(ch)) t = { floor: 'slope', block: false, dx: DIRS[ch][0], dz: DIRS[ch][1], base, rise: 0 }
      else if ('RLUD'.includes(ch)) t = { floor: 'boost', block: false, dx: DIRS[ch][0], dz: DIRS[ch][1], base, rise: 0 }
      else if (ch === '.' || ch === 'T' || ch === 'O') t = { floor: 'grass', block: false, dx: 0, dz: 0, base, rise: 0 }
      else throw new Error(`ladrilho desconhecido '${ch}' em ${def.name}`)
      if (ch === 'T') tee = { x: x + 0.5, z: z + 0.5 }
      if (ch === 'O') cup = { x: x + 0.5, z: z + 0.5 }
      tiles.push(t)
    }
  }
  if (!tee || !cup) throw new Error(`buraco ${def.name} sem saída ou sem buraco`)
  // rampa: o vizinho do lado de cima está 1 nível acima
  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      const t = tiles[z * w + x]
      if (t.floor !== 'slope') continue
      const ux = x - t.dx
      const uz = z - t.dz
      const up = ux >= 0 && uz >= 0 && ux < w && uz < h ? tiles[uz * w + ux] : VOID
      if (up.floor !== null && up.floor !== 'slope' && up.base === t.base + 1) t.rise = 1
      if (up.floor === 'slope' && up.base === t.base + 1) t.rise = 1
    }
  }
  const course: Course = {
    name: def.name,
    par: def.par,
    w,
    h,
    tiles,
    walls: [],
    wallsAt: Array.from({ length: w * h }, () => []),
    bumpers: (def.bumpers ?? []).map(([bx, bz, r]) => ({ x: bx, z: bz, r })),
    tee,
    cup
  }
  // paredes: em cada borda de ladrilho com piso onde não dá para entrar no vizinho
  const sides: Array<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1]
  ]
  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      if (!isFloor(tiles[z * w + x])) continue
      for (const [sx, sz] of sides) {
        const b = tileAt(course, x + sx, z + sz)
        // vizinho com piso e mais baixo/igual: passa (descer é cair). Vizinho mais alto ou sem piso: parede.
        if (isFloor(b) && edgeHeight(b, -sx, -sz) <= edgeHeight(tiles[z * w + x], sx, sz) + 1e-6) continue
        // segmento na borda (sx,sz) do ladrilho, normal apontando para dentro dele
        let wall: Wall
        if (sx === 1) wall = { ax: x + 1, az: z, bx: x + 1, bz: z + 1, nx: -1, nz: 0 }
        else if (sx === -1) wall = { ax: x, az: z, bx: x, bz: z + 1, nx: 1, nz: 0 }
        else if (sz === 1) wall = { ax: x, az: z + 1, bx: x + 1, bz: z + 1, nx: 0, nz: -1 }
        else wall = { ax: x, az: z, bx: x + 1, bz: z, nx: 0, nz: 1 }
        const i = course.walls.push(wall) - 1
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx
            const nz = z + dz
            if (nx >= 0 && nz >= 0 && nx < w && nz < h) course.wallsAt[nz * w + nx].push(i)
          }
        }
      }
    }
  }
  cache.set(def, course)
  return course
}
