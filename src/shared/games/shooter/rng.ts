/**
 * mulberry32 sobre o número guardado em `SimState.rng` (uint32). Cada chamada avança o estado.
 * Determinístico: mesmo número inicial, mesma sequência.
 */
export interface RngHolder {
  rng: number
}

/** float em [0, 1) */
export function rngNext(s: RngHolder): number {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0
  let t = s.rng
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** inteiro em [0, max) */
export function rngInt(s: RngHolder, max: number): number {
  return Math.floor(rngNext(s) * max)
}

/** float em [a, b) */
export function rngRange(s: RngHolder, a: number, b: number): number {
  return a + (b - a) * rngNext(s)
}
