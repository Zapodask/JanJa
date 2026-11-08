/**
 * Pixel art do Tiro na Sala, feita em código (arrays de texto com letras da paleta de palette.ts).
 * Puro: não importa Pixi nem DOM, então o HUD e os testes usam à vontade.
 */
import { Grid, flipH } from '../../art/grid'
import type { WeaponId } from '../../../../shared/games/shooter/types'
import type { Rows } from './palette'

export const CHAR = 16

export type Facing = 'baixo' | 'cima' | 'dir' | 'esq'
export const FACINGS: readonly Facing[] = ['baixo', 'cima', 'dir', 'esq']
/** quadros do boneco: 0 parado, 1 e 2 passos */
export const WALK_FRAMES = [0, 1, 2] as const

/** direção do sprite para um vetor de mira */
export function facingOf(ax: number, ay: number): Facing {
  if (Math.abs(ax) > Math.abs(ay) * 1.15) return ax >= 0 ? 'dir' : 'esq'
  return ay >= 0 ? 'baixo' : 'cima'
}

/** contorno preto em volta de tudo que não é transparente (dentro do mesmo quadro) */
function outline(g: Grid): Grid {
  const mark: [number, number][] = []
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) {
      if (g.get(x, y) !== '.') continue
      if (g.get(x - 1, y) !== '.' || g.get(x + 1, y) !== '.' || g.get(x, y - 1) !== '.' || g.get(x, y + 1) !== '.') mark.push([x, y])
    }
  for (const [x, y] of mark) g.set(x, y, 'k')
  return g
}

function head(g: Grid, f: Facing): void {
  // cabeça 8x7, cantos cortados
  g.rect(4, 1, 8, 7, 's')
  for (const [x, y] of [[4, 1], [11, 1], [4, 7], [11, 7]] as const) g.set(x, y, '.')
  if (f === 'baixo') {
    g.rect(4, 1, 8, 3, 'T')
    g.set(4, 1, '.')
    g.set(11, 1, '.')
    g.set(4, 3, 's')
    g.set(11, 3, 's')
    g.set(5, 3, 'T')
    g.set(10, 3, 'T')
    g.set(6, 5, 'k')
    g.set(9, 5, 'k')
    g.set(5, 6, 'S')
    g.set(10, 6, 'S')
  } else if (f === 'cima') {
    g.rect(4, 1, 8, 7, 'T')
    for (const [x, y] of [[4, 1], [11, 1], [4, 7], [11, 7]] as const) g.set(x, y, '.')
    g.set(6, 2, 't')
    g.set(7, 2, 't')
    g.set(7, 3, 't')
    g.set(5, 7, 's')
    g.set(10, 7, 's')
  } else {
    // olhando para a direita (esquerda é espelho)
    g.rect(4, 1, 8, 3, 'T')
    g.rect(4, 4, 4, 4, 'T')
    g.set(4, 1, '.')
    g.set(11, 1, '.')
    g.set(4, 7, '.')
    g.set(11, 3, 's')
    g.set(10, 5, 'k')
    g.set(11, 6, 'S')
    g.set(8, 3, 'T')
    g.set(7, 4, 'T')
  }
}

function torso(g: Grid, f: Facing): void {
  g.rect(4, 8, 8, 4, 't')
  g.rect(3, 8, 10, 2, 't')
  g.rect(4, 10, 8, 2, 't')
  g.rect(4, 11, 8, 1, 'T')
  g.rect(3, 9, 1, 1, 'T')
  g.rect(12, 9, 1, 1, 'T')
  if (f === 'baixo') {
    g.set(7, 8, 'T')
    g.set(8, 8, 'T')
    g.set(7, 10, 'T')
  } else if (f === 'cima') {
    g.rect(6, 9, 4, 2, 'T')
  } else {
    g.rect(4, 8, 8, 1, 't')
    g.rect(6, 9, 5, 1, 'T')
  }
  // mão livre
  if (f === 'baixo' || f === 'cima') g.set(3, 10, 's')
}

function legs(g: Grid, f: Facing, frame: number): void {
  if (f === 'baixo' || f === 'cima') {
    const l = frame === 2 ? 1 : 0 // perna que sobe
    const r = frame === 1 ? 1 : 0
    g.rect(5, 12, 2, 3 - l, 'V')
    g.rect(9, 12, 2, 3 - r, 'V')
    if (!l) g.rect(5, 14, 2, 1, 'k')
    if (!r) g.rect(9, 14, 2, 1, 'k')
  } else {
    const spread = frame === 0 ? 1 : frame === 1 ? 3 : 0
    g.rect(6 - (spread >> 1), 12, 2, 3, 'V')
    g.rect(8 + (spread - (spread >> 1)), 12, 2, 3, 'V')
    g.rect(6 - (spread >> 1), 14, 2, 1, 'k')
    g.rect(8 + (spread - (spread >> 1)), 14, 2, 1, 'k')
  }
}

const bodyCache = new Map<string, Rows>()

/** Boneco 16x16 sem o braço da arma (o motor desenha o braço girando para a mira). */
export function bodyRows(f: Facing, frame: number): Rows {
  const key = `${f}${frame}`
  const hit = bodyCache.get(key)
  if (hit) return hit
  if (f === 'esq') {
    const r = flipH(bodyRows('dir', frame))
    bodyCache.set(key, r)
    return r
  }
  const g = new Grid(CHAR, CHAR)
  legs(g, f, frame)
  torso(g, f)
  head(g, f)
  // o corpo sobe 1 px nos quadros de passo, para dar balanço
  const rows = outline(g).toSprite()
  const out = frame === 0 ? rows : [...rows.slice(1), '.'.repeat(CHAR)]
  // no passo a base fica no chão: repõe os pés
  const fixed = frame === 0 ? out : out.map((l, y) => (y === CHAR - 1 ? rows[CHAR - 1]! : l))
  bodyCache.set(key, fixed)
  return fixed
}

/** Braço que segura a arma: manga (tinta) de 4x3 + mão. Aponta para a direita; origem no ombro. */
export const ARM: Rows = ['kkkkk', 'ttTTs', 'kkkkk']

// ---------------------------------------------------------------- armas

export interface WeaponArt {
  rows: Rows
  /** onde a mão segura (px do sprite) */
  gripX: number
  gripY: number
  /** ponta do cano, para o clarão e a cápsula */
  muzzleX: number
}

function art(lines: string[]): Rows {
  const w = Math.max(...lines.map((l) => l.length))
  return lines.map((l) => l.padEnd(w, '.'))
}

export const WEAPON_ART: Record<WeaponId, WeaponArt> = {
  pistola: {
    rows: art(['.kkkkkk', 'kdDDddk', 'kkkkkkk', 'kmk....', 'kkk....']),
    gripX: 1,
    gripY: 2,
    muzzleX: 7
  },
  escopeta: {
    rows: art(['kkkkkkkkkkkk', 'kNNddddddddk', 'kMMkkkkkkkkk', '.kk.........']),
    gripX: 3,
    gripY: 1,
    muzzleX: 12
  },
  sub: {
    rows: art(['..kkkkkkkk', 'kkkDDDddkk', 'kmmkkkkkk.', '.kkkOk....', '..kOk.....']),
    gripX: 2,
    gripY: 2,
    muzzleX: 10
  },
  rifle: {
    rows: art(['kk.........kk', 'kmkkkkkkkkkkk', 'kMMddddddDDDk', '.kkkkkkkkkkkk']),
    gripX: 3,
    gripY: 2,
    muzzleX: 13
  },
  rolha: {
    rows: art(['..kkkkkkkkkk', '.kOOOOOOOOOk', 'kkooOOOOOyyk', '.kOOOOOOOOOk', '..kkkkkkkkkk']),
    gripX: 4,
    gripY: 2,
    muzzleX: 12
  }
}

// ---------------------------------------------------------------- projéteis

export type ProjectileArt = 'bala' | 'bago' | 'rifle' | 'rolha' | 'granada'
export const PROJECTILE_ART: Record<ProjectileArt, Rows> = {
  bala: ['yyyu'],
  bago: ['yu', 'yy'],
  rifle: ['.pppppu'],
  rolha: ['..NNN', 'kNNNy', '..NNN'],
  granada: ['.GG.', 'GFFy', 'GFFG', '.GG.']
}

// ---------------------------------------------------------------- caixas e kit de vida

export const PICKUP_SIZE = 14

function crate(inner: Rows, tone: 'arma' | 'vida'): Rows {
  const g = new Grid(PICKUP_SIZE, PICKUP_SIZE)
  const body = tone === 'vida' ? 'p' : 'M'
  const shade = tone === 'vida' ? 'd' : 'm'
  g.rect(0, 0, PICKUP_SIZE, PICKUP_SIZE, 'k')
  g.rect(1, 1, 12, 12, body)
  g.rect(1, 11, 12, 2, shade)
  g.rect(1, 1, 12, 1, tone === 'vida' ? 'p' : 'N')
  for (const [x, y] of [[0, 0], [13, 0], [0, 13], [13, 13]] as const) g.set(x, y, '.')
  // cantoneiras (abajur)
  for (const [x, y] of [[1, 1], [12, 1], [1, 12], [12, 12]] as const) g.set(x, y, 'y')
  g.rect(2, 3, 10, 7, tone === 'vida' ? 'P' : 'n')
  g.blit(Math.floor((PICKUP_SIZE - inner[0]!.length) / 2), 3 + Math.floor((7 - inner.length) / 2), inner)
  return g.toSprite()
}

/** ícone de cada arma dentro da caixa (cabe em 8x5) */
const BOX_ICON: Record<WeaponId, Rows> = {
  pistola: art(['.pppp...', 'pdddp...', 'pppppp..', 'pp......', '........']).map((l) => l.slice(0, 8)),
  escopeta: art(['pppppppp', 'yyddddpp', 'pp.pppp.', '........', '........']).map((l) => l.slice(0, 8)),
  sub: art(['.pppppp.', 'pdddddp.', 'ppyyppp.', '.pp.p...', '..p.....']).map((l) => l.slice(0, 8)),
  rifle: art(['pp.....p', 'ppppppp.', 'pdddddp.', '.pppppp.', '........']).map((l) => l.slice(0, 8)),
  rolha: art(['.pppppp.', 'pOOOOOyp', 'pOOOOOyp', '.pppppp.', '........']).map((l) => l.slice(0, 8))
}

const VIDA_ICON: Rows = ['..oo..', '..oo..', 'oooooo', 'oooooo', '..oo..', '..oo..'].map((l) => l)

export function pickupRows(kind: WeaponId | 'vida'): Rows {
  return kind === 'vida' ? crate(VIDA_ICON, 'vida') : crate(BOX_ICON[kind].filter((l) => l.trim() !== '........'), 'arma')
}

/** Anel de tempo em volta da caixa: `ready` 0..1 (1 = completo). Pontos (x,y) relativos ao centro, raio r. */
export function ringPoints(r: number, ready: number): [number, number][] {
  const out: [number, number][] = []
  const seen = new Set<string>()
  const steps = Math.max(24, Math.round(r * 10))
  const n = Math.max(0, Math.min(1, ready))
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2
    if (i / steps > n) break
    const x = Math.round(Math.sin(a) * r)
    const y = Math.round(-Math.cos(a) * r)
    const k = `${x},${y}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push([x, y])
  }
  return out
}

// ---------------------------------------------------------------- efeitos e interface

export const MUZZLE_FLASH: Rows = art(['..uu...', '.uyyu..', 'uyppyuu', '.uyyu..', '..uu...']).map((l) => l.padEnd(7, '.'))
export const BIG_FLASH: Rows = art(['...uu....', '..uyyu...', '.uyppyuu.', 'uyppppyuu', '.uyppyuu.', '..uyyu...', '...uu....'])

/** fantasminha de quem morreu: a tinta vira a cor do jogador */
export const GHOST: Rows = [
  '..kkkkkk..',
  '.kppppppk.',
  'kppppppppk',
  'kpkkppkkpk',
  'kpkkppkkpk',
  'kppppppppk',
  'kppppkkppk',
  'kppppppppk',
  'kpkppkppkp',
  '.k.kk.kk.k'
]

export const CROSSHAIR: Rows = [
  '.....k.....',
  '.....p.....',
  '.....p.....',
  '...........',
  '...........',
  'kpp.....ppk',
  '...........',
  '...........',
  '.....p.....',
  '.....p.....',
  '.....k.....'
]

export const HITMARKER: Rows = [
  'p.......p',
  '.p.....p.',
  '..p...p..',
  '.........',
  '.........',
  '.........',
  '..p...p..',
  '.p.....p.',
  'p.......p'
]

/** ícones de arma do HUD e do feed (a arma pronta, de lado) */
export function weaponIconRows(w: WeaponId | 'granada'): Rows {
  if (w === 'granada') return PROJECTILE_ART.granada
  return WEAPON_ART[w].rows
}

// ---------------------------------------------------------------- inventário (testes e pré-carga)

/** Todos os sprites de tamanho fixo, por nome. */
export function allSprites(): Record<string, { rows: Rows; size?: [number, number] }> {
  const out: Record<string, { rows: Rows; size?: [number, number] }> = {}
  for (const f of FACINGS) for (const fr of WALK_FRAMES) out[`boneco_${f}_${fr}`] = { rows: bodyRows(f, fr), size: [CHAR, CHAR] }
  out.braco = { rows: ARM, size: [5, 3] }
  for (const w of Object.keys(WEAPON_ART) as WeaponId[]) out[`arma_${w}`] = { rows: WEAPON_ART[w].rows }
  for (const [k, v] of Object.entries(PROJECTILE_ART)) out[`proj_${k}`] = { rows: v }
  for (const k of ['pistola', 'escopeta', 'sub', 'rifle', 'rolha', 'vida'] as const) out[`caixa_${k}`] = { rows: pickupRows(k), size: [PICKUP_SIZE, PICKUP_SIZE] }
  out.clarao = { rows: MUZZLE_FLASH, size: [7, 5] }
  out.clarao_grande = { rows: BIG_FLASH, size: [9, 7] }
  out.fantasma = { rows: GHOST, size: [10, 10] }
  out.mira = { rows: CROSSHAIR, size: [11, 11] }
  out.hitmarker = { rows: HITMARKER, size: [9, 9] }
  return out
}
