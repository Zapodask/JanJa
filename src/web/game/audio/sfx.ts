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
    // ---------- golfe ----------
    case 'putt':
      // "toc" do taco na bola
      return [
        { kind: 'tri', t: 0, dur: 0.06, freq: 900, freqEnd: 420, vel: 0.45 },
        { kind: 'noise', t: 0, dur: 0.025, vel: 0.35, filter: { type: 'bandpass', freq: 2600, q: 3 } }
      ]
    case 'cup':
      // bola caindo no copo e um "plim"
      return [
        { kind: 'tri', t: 0, dur: 0.05, freq: 300, freqEnd: 150, vel: 0.4 },
        { kind: 'tri', t: 0.09, dur: 0.04, freq: 260, freqEnd: 140, vel: 0.3 },
        { kind: 'pulse', t: 0.18, dur: 0.12, freq: hz('G5'), vel: 0.16, duty: 0.25 },
        { kind: 'pulse', t: 0.28, dur: 0.3, freq: hz('C6'), vel: 0.16, duty: 0.25 }
      ]
    case 'splash':
      return [
        { kind: 'noise', t: 0, dur: 0.4, vel: 0.35, attack: 0.02, filter: { type: 'lowpass', freq: 2400, freqEnd: 500, q: 1 } },
        { kind: 'sine', t: 0, dur: 0.18, freq: 500, freqEnd: 180, vel: 0.2 }
      ]
    case 'bounce':
      return [click(0, 0.3, 1800), { kind: 'tri', t: 0, dur: 0.04, freq: 340, freqEnd: 220, vel: 0.25 }]
    // ---------- tiro na sala ----------
    case 'tiro-pistola':
      return [
        { kind: 'pulse', t: 0, dur: 0.09, freq: 1500, freqEnd: 170, vel: 0.2, duty: 0.125 },
        { kind: 'noise', t: 0, dur: 0.04, vel: 0.26, filter: { type: 'bandpass', freq: 2600, q: 1.2 } }
      ]
    case 'tiro-escopeta':
      return [
        { kind: 'noise', t: 0, dur: 0.26, vel: 0.5, attack: 0.002, filter: { type: 'lowpass', freq: 3200, freqEnd: 260, q: 0.9 } },
        { kind: 'tri', t: 0, dur: 0.16, freq: 150, freqEnd: 48, vel: 0.55 },
        { kind: 'pulse', t: 0, dur: 0.1, freq: 700, freqEnd: 90, vel: 0.16, duty: 0.25 },
        click(0.32, 0.18, 1400),
        { kind: 'tri', t: 0.34, dur: 0.05, freq: 220, freqEnd: 150, vel: 0.2 }
      ]
    case 'tiro-sub':
      return [
        { kind: 'pulse', t: 0, dur: 0.05, freq: 1150, freqEnd: 320, vel: 0.14, duty: 0.25 },
        { kind: 'noise', t: 0, dur: 0.03, vel: 0.2, filter: { type: 'highpass', freq: 3000 } }
      ]
    case 'tiro-rifle':
      return [
        { kind: 'pulse', t: 0, dur: 0.18, freq: 2600, freqEnd: 110, vel: 0.26, duty: 0.125 },
        { kind: 'noise', t: 0, dur: 0.12, vel: 0.4, filter: { type: 'highpass', freq: 1800 } },
        { kind: 'sine', t: 0.05, dur: 0.3, freq: 880, freqEnd: 180, vel: 0.16 },
        { kind: 'noise', t: 0.12, dur: 0.3, vel: 0.1, attack: 0.05, filter: { type: 'bandpass', freq: 900, q: 1 } }
      ]
    case 'tiro-rolha':
      // "pop" de rolha de espumante e um chiado do foguete
      return [
        { kind: 'sine', t: 0, dur: 0.12, freq: 420, freqEnd: 70, vel: 0.5 },
        { kind: 'noise', t: 0, dur: 0.06, vel: 0.4, filter: { type: 'bandpass', freq: 1100, q: 2 } },
        { kind: 'noise', t: 0.05, dur: 0.35, vel: 0.14, attack: 0.05, filter: { type: 'bandpass', freq: 700, freqEnd: 2400, q: 1.5 } }
      ]
    case 'explosao':
      return [
        { kind: 'noise', t: 0, dur: 0.75, vel: 0.7, attack: 0.004, filter: { type: 'lowpass', freq: 2600, freqEnd: 110, q: 0.9 } },
        { kind: 'tri', t: 0, dur: 0.5, freq: 100, freqEnd: 26, vel: 0.75 },
        { kind: 'pulse', t: 0, dur: 0.18, freq: 300, freqEnd: 40, vel: 0.2, duty: 0.5 },
        { kind: 'noise', t: 0.1, dur: 0.5, vel: 0.12, filter: { type: 'highpass', freq: 5000 } }
      ]
    case 'granada':
      // a granada quicando no chão: tink metálico duas vezes
      return [0, 0.11].flatMap((t, i) => [
        { kind: 'pulse', t, dur: 0.05, freq: 1900 - i * 400, freqEnd: 900, vel: 0.14, duty: 0.5 } as SfxVoice,
        { kind: 'tri', t, dur: 0.05, freq: 240, freqEnd: 140, vel: 0.28 } as SfxVoice,
        click(t, 0.12, 2400)
      ])
    case 'hitmarker':
      return [
        { kind: 'pulse', t: 0, dur: 0.035, freq: 2400, vel: 0.2, duty: 0.5 },
        { kind: 'pulse', t: 0.045, dur: 0.045, freq: 3200, vel: 0.16, duty: 0.5 }
      ]
    case 'dano':
      return [
        { kind: 'tri', t: 0, dur: 0.18, freq: 230, freqEnd: 80, vel: 0.5 },
        { kind: 'noise', t: 0, dur: 0.12, vel: 0.3, filter: { type: 'lowpass', freq: 1600, freqEnd: 300 } }
      ]
    case 'abate':
      return [
        { kind: 'pulse', t: 0, dur: 0.09, freq: hz('E5'), vel: 0.2, duty: 0.25 },
        { kind: 'pulse', t: 0.08, dur: 0.22, freq: hz('B5'), vel: 0.2, duty: 0.25 },
        { kind: 'sine', t: 0.08, dur: 0.3, freq: hz('B6'), vel: 0.08 }
      ]
    case 'passo':
      return [
        { kind: 'noise', t: 0, dur: 0.045, vel: 0.2, filter: { type: 'lowpass', freq: 900, freqEnd: 400 } },
        { kind: 'tri', t: 0, dur: 0.04, freq: 120, freqEnd: 80, vel: 0.22 }
      ]
    case 'dash':
      return [{ kind: 'noise', t: 0, dur: 0.18, vel: 0.28, attack: 0.03, filter: { type: 'bandpass', freq: 500, freqEnd: 3200, q: 1.2 } }]
    case 'pegar-arma':
      return ['C5', 'E5', 'G5'].map((n, i) => ({ kind: 'pulse', t: i * 0.05, dur: i === 2 ? 0.14 : 0.06, freq: hz(n), vel: 0.18, duty: 0.25 }) as SfxVoice).concat(click(0, 0.2, 2000))
    case 'pegar-vida':
      return [
        { kind: 'sine', t: 0, dur: 0.1, freq: hz('G5'), vel: 0.2 },
        { kind: 'sine', t: 0.08, dur: 0.1, freq: hz('C6'), vel: 0.2 },
        { kind: 'pulse', t: 0.16, dur: 0.26, freq: hz('E6'), vel: 0.12, duty: 0.5 }
      ]
    case 'renascer':
      return [
        { kind: 'pulse', t: 0, dur: 0.22, freq: 220, freqEnd: 1300, vel: 0.14, duty: 0.25 },
        { kind: 'sine', t: 0.18, dur: 0.25, freq: hz('E6'), vel: 0.12 }
      ]
    case 'contagem':
      return [{ kind: 'pulse', t: 0, dur: 0.09, freq: hz('A5'), vel: 0.16, duty: 0.5 }]
  }
}

export function sfxDuration(name: SfxName, count = 1): number {
  return Math.max(...sfxPlan(name, count).map((v) => v.t + v.dur))
}
