/**
 * Monta a geometria do buraco a partir do Course (puro, sem Three): listas de triângulos com cor.
 * Separado do engine para dar para testar sem WebGL.
 */
import { isFloor, LEVEL_H, passable, tileAt, type Course, type Tile } from '../../../../shared/games/golf/course'

export type RGB = [number, number, number]

export interface MeshData {
  /** x,y,z por vértice (triângulos soltos, sem índice: sombreamento chapado) */
  pos: number[]
  /** r,g,b por vértice (0..1) */
  col: number[]
}

export interface HoleMeshes {
  floor: MeshData
  water: MeshData
  rails: MeshData
  marks: MeshData
}

export const hex = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

export const COLORS = {
  grassA: hex('#4E8A3E'),
  grassB: hex('#589546'),
  sand: hex('#D9B979'),
  water: hex('#3B7BA8'),
  boost: hex('#E0703A'),
  slope: hex('#4A8040'),
  tee: hex('#D9CDB6'),
  skirt: hex('#5A4234'),
  skirtDark: hex('#3A2E28'),
  rail: hex('#8A5A3B'),
  railTop: hex('#B7A99A'),
  block: hex('#6B4E3D'),
  blockTop: hex('#8A6A55'),
  arrow: hex('#FFC94A'),
  cup: hex('#151110')
}

/** fundo da ilha (onde as bordas acabam) em níveis */
const FLOOR_BOTTOM = -1.5
const RAIL_H = 0.2
const RAIL_T = 0.1
const BLOCK_H = 1.4

const shade = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k]

/** nível da superfície num ponto local (fx,fz em 0..1) do ladrilho */
export function localLevel(t: Tile, fx: number, fz: number): number {
  if (t.floor !== 'slope' || t.rise === 0) return t.base
  const up = t.dx === 1 ? 1 - fx : t.dx === -1 ? fx : t.dz === 1 ? 1 - fz : fz
  return t.base + t.rise * up
}

function tri(m: MeshData, a: number[], b: number[], c: number[], col: RGB): void {
  m.pos.push(...a, ...b, ...c)
  for (let i = 0; i < 3; i++) m.col.push(...col)
}

/** quadrilátero a-b-c-d (anti-horário visto de fora) */
function quad(m: MeshData, a: number[], b: number[], c: number[], d: number[], col: RGB): void {
  tri(m, a, b, c, col)
  tri(m, a, c, d, col)
}

/** caixa alinhada aos eixos */
function box(m: MeshData, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, side: RGB, top: RGB): void {
  quad(m, [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], top)
  quad(m, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], side)
  quad(m, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], shade(side, 0.8))
  quad(m, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], shade(side, 0.9))
  quad(m, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], shade(side, 0.9))
}

const SIDES: Array<{ sx: number; sz: number; a: [number, number]; b: [number, number] }> = [
  // borda do lado (sx,sz): cantos a e b em coordenadas locais, em ordem para a face olhar para fora
  { sx: 1, sz: 0, a: [1, 1], b: [1, 0] },
  { sx: -1, sz: 0, a: [0, 0], b: [0, 1] },
  { sx: 0, sz: 1, a: [0, 1], b: [1, 1] },
  { sx: 0, sz: -1, a: [1, 0], b: [0, 0] }
]

function floorColor(t: Tile, x: number, z: number, isTee: boolean): RGB {
  if (isTee) return COLORS.tee
  switch (t.floor) {
    case 'sand':
      return (x + z) % 2 ? COLORS.sand : shade(COLORS.sand, 0.95)
    case 'boost':
      return COLORS.boost
    case 'slope':
      return (x + z) % 2 ? COLORS.slope : shade(COLORS.slope, 0.94)
    default:
      return (x + z) % 2 ? COLORS.grassA : COLORS.grassB
  }
}

/** seta (chevron) deitada sobre o ladrilho, apontando para (dx,dz) */
function chevron(m: MeshData, c: Course, x: number, z: number, t: Tile, col: RGB): void {
  const L = (fx: number, fz: number) => localLevel(t, fx, fz) * LEVEL_H + 0.012
  // pontos num sistema onde a seta aponta para +u; u = (dx,dz), v = perpendicular
  const pts = (u: number, v: number): number[] => {
    const fx = 0.5 + u * t.dx - v * t.dz
    const fz = 0.5 + u * t.dz + v * t.dx
    return [x + fx, L(fx, fz), z + fz]
  }
  for (const off of [-0.18, 0.12]) {
    const tip = pts(off + 0.2, 0)
    const l0 = pts(off, 0.22)
    const l1 = pts(off - 0.08, 0.22)
    const r0 = pts(off, -0.22)
    const r1 = pts(off - 0.08, -0.22)
    const tip1 = pts(off + 0.12, 0)
    quad(m, l1, l0, tip, tip1, col)
    quad(m, tip1, tip, r0, r1, col)
  }
  void c
}

export function buildHoleMeshes(c: Course): HoleMeshes {
  const floor: MeshData = { pos: [], col: [] }
  const water: MeshData = { pos: [], col: [] }
  const rails: MeshData = { pos: [], col: [] }
  const marks: MeshData = { pos: [], col: [] }
  const teeX = Math.floor(c.tee.x)
  const teeZ = Math.floor(c.tee.z)
  for (let z = 0; z < c.h; z++) {
    for (let x = 0; x < c.w; x++) {
      const t = tileAt(c, x, z)
      if (t.block) {
        box(rails, x, FLOOR_BOTTOM * LEVEL_H, z, x + 1, t.base * LEVEL_H + BLOCK_H * LEVEL_H, z + 1, COLORS.block, COLORS.blockTop)
        continue
      }
      if (!isFloor(t)) continue
      const y = (fx: number, fz: number) => localLevel(t, fx, fz) * LEVEL_H
      const target = t.floor === 'water' ? water : floor
      const col = t.floor === 'water' ? COLORS.water : floorColor(t, x, z, x === teeX && z === teeZ)
      quad(target, [x, y(0, 0), z], [x, y(0, 1), z + 1], [x + 1, y(1, 1), z + 1], [x + 1, y(1, 0), z], col)
      if (t.floor === 'water') {
        // fundo da água um pouco abaixo, para a borda aparecer
        quad(floor, [x, y(0, 0) - 0.12, z], [x, y(0, 1) - 0.12, z + 1], [x + 1, y(1, 1) - 0.12, z + 1], [x + 1, y(1, 0) - 0.12, z], shade(COLORS.water, 0.5))
      }
      if (t.floor === 'slope' || t.floor === 'boost') chevron(marks, c, x, z, t, t.floor === 'boost' ? COLORS.arrow : shade(COLORS.slope, 1.25))
      // laterais: descem até o vizinho (ou até o fundo da ilha)
      for (const s of SIDES) {
        const n = tileAt(c, x + s.sx, z + s.sz)
        const ya = y(s.a[0], s.a[1])
        const yb = y(s.b[0], s.b[1])
        let na = FLOOR_BOTTOM * LEVEL_H
        let nb = FLOOR_BOTTOM * LEVEL_H
        if (isFloor(n)) {
          // canto equivalente do vizinho (do outro lado da borda)
          const map = (fx: number, fz: number): [number, number] => [s.sx ? 1 - fx : fx, s.sz ? 1 - fz : fz]
          na = localLevel(n, ...map(s.a[0], s.a[1])) * LEVEL_H
          nb = localLevel(n, ...map(s.b[0], s.b[1])) * LEVEL_H
        }
        if (na >= ya - 1e-6 && nb >= yb - 1e-6) continue
        const ax = x + s.a[0]
        const az = z + s.a[1]
        const bx = x + s.b[0]
        const bz = z + s.b[1]
        const skirt = s.sz === 1 || s.sx === 1 ? COLORS.skirt : COLORS.skirtDark
        quad(floor, [ax, Math.min(na, ya), az], [bx, Math.min(nb, yb), bz], [bx, yb, bz], [ax, ya, az], skirt)
        // corrimão de madeira onde a bola cairia para fora do campo
        if (!isFloor(n) && !n.block) {
          const ox = s.sx * RAIL_T
          const oz = s.sz * RAIL_T
          const top = (yy: number) => yy + RAIL_H
          const A = [ax, ya, az]
          const B = [bx, yb, bz]
          const A2 = [ax + ox, ya, az + oz]
          const B2 = [bx + ox, yb, bz + oz]
          quad(rails, [ax, top(ya), az], [bx, top(yb), bz], [bx + ox, top(yb), bz + oz], [ax + ox, top(ya), az + oz], COLORS.railTop)
          // face de dentro (vira para o campo) e a de fora
          quad(rails, [bx, yb, bz], [ax, ya, az], [ax, top(ya), az], [bx, top(yb), bz], COLORS.rail)
          quad(rails, [A2[0], FLOOR_BOTTOM * LEVEL_H, A2[2]], [B2[0], FLOOR_BOTTOM * LEVEL_H, B2[2]], [B2[0], top(yb), B2[2]], [A2[0], top(ya), A2[2]], shade(COLORS.rail, 0.7))
          void A
          void B
        }
      }
    }
  }
  // para-choques: prismas de 8 lados
  for (const b of c.bumpers) {
    const yb = localLevel(tileAt(c, Math.floor(b.x), Math.floor(b.z)), b.x % 1, b.z % 1) * LEVEL_H
    const n = 10
    const h = 0.32
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2
      const a1 = ((i + 1) / n) * Math.PI * 2
      const p0 = [b.x + Math.cos(a0) * b.r, b.z + Math.sin(a0) * b.r]
      const p1 = [b.x + Math.cos(a1) * b.r, b.z + Math.sin(a1) * b.r]
      quad(rails, [p1[0], yb, p1[1]], [p0[0], yb, p0[1]], [p0[0], yb + h, p0[1]], [p1[0], yb + h, p1[1]], i % 2 ? hex('#C8443A') : hex('#F3EBDD'))
      tri(rails, [b.x, yb + h, b.z], [p1[0], yb + h, p1[1]], [p0[0], yb + h, p0[1]], COLORS.arrow)
    }
  }
  // buraco: disco escuro
  const cl = localLevel(tileAt(c, Math.floor(c.cup.x), Math.floor(c.cup.z)), 0.5, 0.5) * LEVEL_H + 0.006
  const n = 14
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2
    const a1 = ((i + 1) / n) * Math.PI * 2
    const r = 0.19
    tri(marks, [c.cup.x, cl, c.cup.z], [c.cup.x + Math.cos(a1) * r, cl, c.cup.z + Math.sin(a1) * r], [c.cup.x + Math.cos(a0) * r, cl, c.cup.z + Math.sin(a0) * r], COLORS.cup)
  }
  return { floor, water, rails, marks }
}

/** ponto onde a linha de mira bate na primeira parede (ou acaba) */
export function aimEnd(c: Course, x: number, z: number, angle: number, len: number): { x: number; z: number } {
  const dx = Math.cos(angle)
  const dz = Math.sin(angle)
  let px = x
  let pz = z
  let tx = Math.floor(x)
  let tz = Math.floor(z)
  const stepLen = 0.05
  for (let d = 0; d < len; d += stepLen) {
    const nx = px + dx * stepLen
    const nz = pz + dz * stepLen
    const ntx = Math.floor(nx)
    const ntz = Math.floor(nz)
    if (ntx !== tx || ntz !== tz) {
      const sx = Math.sign(ntx - tx)
      const sz = Math.sign(ntz - tz)
      // muda de ladrilho: só segue se não houver parede (borda ou degrau para cima)
      if (sx && sz) {
        const viaX = passable(c, tx, tz, sx, 0) && passable(c, tx + sx, tz, 0, sz)
        const viaZ = passable(c, tx, tz, 0, sz) && passable(c, tx, tz + sz, sx, 0)
        if (!viaX && !viaZ) break
      } else if (!passable(c, tx, tz, sx, sz)) break
      tx = ntx
      tz = ntz
    }
    px = nx
    pz = nz
  }
  return { x: px, z: pz }
}
