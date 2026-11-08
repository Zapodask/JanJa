import { MAPS } from '../../src/shared/games/shooter/maps'
import { createSim, step } from '../../src/shared/games/shooter/sim'
import { EMPTY_INPUT, TILE, type Input, type MapDef, type ShooterOptions, type SimEvent, type SimPlayer, type SimState } from '../../src/shared/games/shooter/types'

export const OPTS: ShooterOptions = { mapId: 'casa', minutes: 3, killLimit: 10, bots: 0 }

/** Arena pequena para testes: 20x12, parede de 3 tiles no meio, mureta e água. */
export const ARENA: MapDef = {
  id: 'casa',
  name: 'Arena de teste',
  w: 20,
  h: 12,
  rows: [
    '####################',
    '#..................#',
    '#..................#',
    '#.......#..........#',
    '#.......#..........#',
    '#.......#...~~.....#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#.......mm.........#',
    '#..................#',
    '####################'
  ],
  spawns: [
    [2, 1], [17, 1], [2, 10], [17, 10], [10, 1], [10, 10], [2, 6], [17, 6], [5, 2], [14, 9], [5, 9], [14, 2]
  ].map(([x, y]) => ({ x: x * TILE + 8, y: y * TILE + 8 })),
  pickups: [
    { kind: 'escopeta', x: 4 * TILE + 8, y: 6 * TILE + 8 },
    { kind: 'vida', x: 15 * TILE + 8, y: 6 * TILE + 8 }
  ]
}

const original = { casa: MAPS.casa, quintal: MAPS.quintal }
/** Troca o mapa 'casa' pela arena; chame restoreMaps() no afterEach. */
export function useArena(): void {
  MAPS.casa = ARENA
}
export function restoreMaps(): void {
  MAPS.casa = original.casa
  MAPS.quintal = original.quintal
}

export function mk(n = 2, opts: ShooterOptions = OPTS, seed = 1): SimState {
  const refs = Array.from({ length: n }, (_, i) => ({ slot: i, id: `p${i}`, bot: false }))
  return createSim(refs, opts, seed)
}

export const px = (t: number): number => t * TILE + 8

/** Põe o jogador no centro do tile, sem invulnerabilidade. */
export function place(s: SimState, slot: number, tx: number, ty: number): SimPlayer {
  const p = s.players.find((q) => q.slot === slot)!
  p.x = px(tx)
  p.y = px(ty)
  p.kx = 0
  p.ky = 0
  p.invulnUntil = 0
  return p
}

/** Pula o aquecimento (a fase vira 'jogando' no primeiro step). */
export function startPlaying(s: SimState): void {
  s.tick = s.warmupEndTick
  step(s, new Map())
}

let seqs = new Map<string, number>()
export function inp(p: Partial<Input> = {}): Input {
  return { ...EMPTY_INPUT, ...p }
}

export function run(s: SimState, ticks: number, inputs: (tick: number) => Map<number, Input> | Record<number, Partial<Input>>): SimEvent[] {
  const all: SimEvent[] = []
  for (let i = 0; i < ticks; i++) {
    const raw = inputs(s.tick)
    const m = new Map<number, Input>()
    const entries = raw instanceof Map ? [...raw.entries()] : Object.entries(raw).map(([k, v]) => [Number(k), v] as [number, Partial<Input>])
    for (const [slot, v] of entries) {
      const k = `${slot}`
      const seq = (seqs.get(k) ?? 0) + 1
      seqs.set(k, seq)
      m.set(slot, { ...EMPTY_INPUT, ...v, seq })
    }
    all.push(...step(s, m))
  }
  return all
}
export const resetSeqs = (): void => {
  seqs = new Map()
}

/** PRNG simples dos testes (independente do RNG da simulação). */
export function testRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
