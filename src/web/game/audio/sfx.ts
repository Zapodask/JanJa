/** Efeitos: cada um é um "plano" de vozes (puro). O motor toca o plano no Web Audio. */
import type { SfxName } from '../contract'
import { noteToMidi, midiToHz } from './notes'

export interface SfxVoice {
  kind: 'pulse' | 'tri' | 'sine' | 'noise'
  /** início (s, relativo ao disparo) */
  t: number
  dur: number
  freq?: number
  /** se houver, glissando exponencial até aqui */
  freqEnd?: number
  vel: number
  duty?: number
  filter?: { type: 'lowpass' | 'highpass' | 'bandpass'; freq: number; freqEnd?: number; q?: number }
  /** ataque (s) */
  attack?: number
}

const hz = (n: string): number => midiToHz(noteToMidi(n))
export const MAX_CHIPS = 8

function click(t: number, vel: number, freq = 3200): SfxVoice {
  return { kind: 'noise', t, dur: 0.03, vel, filter: { type: 'highpass', freq } }
}

export function sfxPlan(name: SfxName, count = 1): SfxVoice[] {
  switch (name) {
    case 'shuffle': {
      // "tlec-tlec": duas rajadas de estalos
      const v: SfxVoice[] = []
      for (let burst = 0; burst < 2; burst++) {
        for (let i = 0; i < 6; i++) {
          v.push({ kind: 'noise', t: burst * 0.3 + i * 0.038, dur: 0.028, vel: 0.5 - i * 0.04, filter: { type: 'bandpass', freq: 2200 + i * 260, q: 2.2 } })
        }
      }
      return v
    }
    case 'deal':
      return [click(0, 0.55), { kind: 'tri', t: 0, dur: 0.05, freq: 520, freqEnd: 260, vel: 0.3 }]
    case 'flip':
      return [
        { kind: 'pulse', t: 0, dur: 0.07, freq: hz('E6'), freqEnd: hz('B6'), vel: 0.22, duty: 0.25 },
        click(0, 0.2, 5000)
      ]
    case 'chip': {
      const n = Math.max(1, Math.min(MAX_CHIPS, Math.round(count)))
      const v: SfxVoice[] = []
      for (let i = 0; i < n; i++) {
        const t = i * 0.052
        const f = 2000 + ((i * 7) % 5) * 130
        v.push({ kind: 'pulse', t, dur: 0.09, freq: f, vel: 0.17, duty: 0.5 })
        v.push({ kind: 'sine', t: t + 0.012, dur: 0.12, freq: f * 1.5, vel: 0.1 })
        v.push(click(t, 0.12, 6000))
      }
      return v
    }
    case 'check':
      return [0, 0.12].flatMap((t) => [
        { kind: 'tri', t, dur: 0.07, freq: 190, freqEnd: 120, vel: 0.5 } as SfxVoice,
        { kind: 'noise', t, dur: 0.04, vel: 0.28, filter: { type: 'lowpass', freq: 1400 } } as SfxVoice
      ])
    case 'fold':
      return [{ kind: 'noise', t: 0, dur: 0.32, vel: 0.3, attack: 0.08, filter: { type: 'lowpass', freq: 1300, freqEnd: 240, q: 0.8 } }]
    case 'turn':
      return [
        { kind: 'pulse', t: 0, dur: 0.3, freq: hz('E6'), vel: 0.14, duty: 0.5 },
        { kind: 'sine', t: 0.07, dur: 0.4, freq: hz('B6'), vel: 0.1 }
      ]
    case 'allin':
      // diminuto (lá, dó, mi bemol) + baixo que sobe: tenso e curto
      return [
        { kind: 'pulse', t: 0, dur: 0.95, freq: hz('A3'), vel: 0.16, duty: 0.25, attack: 0.25 },
        { kind: 'pulse', t: 0, dur: 0.95, freq: hz('C4'), vel: 0.14, duty: 0.25, attack: 0.25 },
        { kind: 'pulse', t: 0, dur: 0.95, freq: hz('D#4'), vel: 0.14, duty: 0.25, attack: 0.25 },
        { kind: 'tri', t: 0, dur: 0.95, freq: hz('A2'), freqEnd: hz('A#2'), vel: 0.4, attack: 0.1 },
        { kind: 'noise', t: 0.05, dur: 0.8, vel: 0.12, attack: 0.5, filter: { type: 'lowpass', freq: 300, freqEnd: 900 } }
      ]
    case 'win':
      return ['C5', 'E5', 'G5', 'C6'].map((n, i) => ({ kind: 'pulse', t: i * 0.08, dur: i === 3 ? 0.4 : 0.14, freq: hz(n), vel: 0.2, duty: 0.25 }) as SfxVoice)
    case 'rebuy':
      return [
        { kind: 'pulse', t: 0, dur: 0.1, freq: 1100, freqEnd: 2600, vel: 0.14, duty: 0.125 },
        { kind: 'sine', t: 0.1, dur: 0.3, freq: hz('E7'), vel: 0.12 }
      ]
    case 'podium': {
      // ~1 s: pickup, subida e acorde final
      const v: SfxVoice[] = []
      const melody: [string, number, number][] = [['G4', 0, 0.1], ['C5', 0.11, 0.1], ['E5', 0.22, 0.1], ['G5', 0.33, 0.14], ['E5', 0.5, 0.08], ['G5', 0.6, 0.1]]
      for (const [n, t, d] of melody) v.push({ kind: 'pulse', t, dur: d, freq: hz(n), vel: 0.2, duty: 0.25 })
      for (const n of ['C5', 'E5', 'G5', 'C6']) v.push({ kind: 'pulse', t: 0.72, dur: 0.5, freq: hz(n), vel: 0.12, duty: 0.5 })
      v.push({ kind: 'tri', t: 0.72, dur: 0.5, freq: hz('C3'), vel: 0.4 })
      v.push({ kind: 'noise', t: 0.72, dur: 0.35, vel: 0.2, filter: { type: 'highpass', freq: 6000 } })
      return v
    }
  }
}

export function sfxDuration(name: SfxName, count = 1): number {
  return Math.max(...sfxPlan(name, count).map((v) => v.t + v.dur))
}
