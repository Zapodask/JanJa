/** Utilidades de nota/frequência/onda, sem Web Audio (testáveis em Node). */

const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/** 'C4' = 60, 'F#5', 'Bb3'. */
export function noteToMidi(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name)
  if (!m) throw new Error(`nota inválida: ${name}`)
  const pc = PC[m[1]!]! + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0)
  return (Number(m[3]) + 1) * 12 + pc
}

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20)
}

/**
 * Coeficientes de Fourier de uma onda de pulso com ciclo de trabalho `duty` (0..1),
 * no formato do PeriodicWave (índice 0 = DC, sempre 0).
 */
export function pulseCoefficients(duty: number, harmonics = 48): { real: Float32Array; imag: Float32Array } {
  const real = new Float32Array(harmonics + 1)
  const imag = new Float32Array(harmonics + 1)
  for (let n = 1; n <= harmonics; n++) {
    real[n] = Math.sin(2 * Math.PI * n * duty) / (n * Math.PI)
    imag[n] = (1 - Math.cos(2 * Math.PI * n * duty)) / (n * Math.PI)
  }
  return { real, imag }
}

/** Ganho linear do ducking: level 0..1 → 0 dB .. -12 dB. */
export const DUCK_MAX_DB = -12
export function duckGain(level: number): number {
  const l = Math.min(1, Math.max(0, Number.isFinite(level) ? level : 0))
  return dbToGain(DUCK_MAX_DB * l)
}
/** Constante de tempo (s) do setTargetAtTime: ataque de 80 ms ao abaixar, soltura de 400 ms ao subir (≈95% no tempo dado). */
export const DUCK_ATTACK_S = 0.08
export const DUCK_RELEASE_S = 0.4
export function duckTimeConstant(from: number, to: number): number {
  return (to < from ? DUCK_ATTACK_S : DUCK_RELEASE_S) / 3
}

/** Volume 0..1 do controle → ganho (curva quadrática, teto baixo de propósito). */
export function volumeToGain(v: number): number {
  const x = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0))
  return x * x * 0.9
}
