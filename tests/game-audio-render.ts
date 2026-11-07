/**
 * Renderiza 20 s de cada faixa para WAV (/tmp/janja-audio) com um sintetizador mínimo em Node
 * (mesmas notas, envelopes e ganhos do motor) e imprime métricas: pico, RMS, saturação, partitura.
 * Uso: npx tsx tests/game-audio-render.ts [segundos]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { midiToHz, volumeToGain } from '../src/web/game/audio/notes'
import { noteSeconds } from '../src/web/game/audio/sequencer'
import { TRACKS, scoreText, stepSeconds, trackSeconds, type TrackDef } from '../src/web/game/audio/songs'

const SR = 32000
const SECONDS = Number(process.argv[2] ?? 20)
const out = '/tmp/janja-audio'
mkdirSync(out, { recursive: true })

function render(t: TrackDef, seconds: number): Float32Array {
  const buf = new Float32Array(Math.floor(seconds * SR))
  const sd = stepSeconds(t)
  let seed = 12345
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) | 0) >>> 8) / 8388608 - 1
  const total = t.steps.length
  for (let i = 0; ; i++) {
    const step = i % total
    const when = i * sd + (i % 2 === 1 ? t.swing * sd : 0)
    if (when >= seconds) break
    if (t.once && i >= total) break
    for (const ev of t.steps[step]!) {
      const dur = noteSeconds(t, ev)
      const vel = ev.vel * t.gain
      const voice = (len: number, lvl: number, sus: number, gen: (tt: number, ph: number) => number, freq: (tt: number) => number, att = 0.005) => {
        const n = Math.floor((len + 0.04) * SR)
        const s0 = Math.floor(when * SR)
        let ph = 0
        for (let k = 0; k < n && s0 + k < buf.length; k++) {
          const tt = k / SR
          const env = tt < att ? tt / att : tt < len ? 1 + (sus - 1) * ((tt - att) / (len - att)) : sus * Math.max(0, 1 - (tt - len) / 0.04)
          ph += freq(tt) / SR
          buf[s0 + k]! += gen(tt, ph % 1) * env * lvl
        }
      }
      const pulse = (d: number) => (_: number, ph: number) => (ph < d ? 1 : -1) * 0.8
      const tri = (_: number, ph: number) => (ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph)
      const f = ev.midi !== undefined ? midiToHz(ev.midi) : 0
      if (ev.ch === 'lead') voice(dur, vel * 0.17, 0.65, pulse(t.duty.lead), () => f, 0.006)
      else if (ev.ch === 'arp') voice(dur, vel * 0.1, dur > 0.3 ? 0.7 : 0.15, pulse(t.duty.arp), () => f, 0.003)
      else if (ev.ch === 'bass') voice(dur, vel * 0.32, 0.8, tri, () => f, 0.008)
      else if (ev.ch === 'kick') voice(0.16, vel * 0.62, 0.1, tri, (tt) => 46 + 104 * Math.exp(-tt * 28))
      else if (ev.ch === 'snare') {
        voice(0.12, vel * 0.2, 0.05, () => rnd(), () => 0, 0.001)
        voice(0.07, vel * 0.2, 0.1, tri, () => 170, 0.001)
      } else voice(ev.steps >= 4 ? 0.2 : 0.035, vel * 0.1, 0.05, () => rnd(), () => 0, 0.001)
    }
  }
  // passa-baixa simples (o "lo-fi") e ganho de volume padrão 0.35
  const a = 1 - Math.exp((-2 * Math.PI * t.cutoff) / SR)
  let y = 0
  const g = volumeToGain(0.35)
  for (let i = 0; i < buf.length; i++) {
    y += a * (buf[i]! - y)
    buf[i] = y * g
  }
  return buf
}

function wav(samples: Float32Array): Buffer {
  const data = Buffer.alloc(samples.length * 2)
  samples.forEach((v, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), i * 2))
  const h = Buffer.alloc(44)
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + data.length, 4)
  h.write('WAVEfmt ', 8)
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20)
  h.writeUInt16LE(1, 22)
  h.writeUInt32LE(SR, 24)
  h.writeUInt32LE(SR * 2, 28)
  h.writeUInt16LE(2, 32)
  h.writeUInt16LE(16, 34)
  h.write('data', 36)
  h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}

for (const t of Object.values(TRACKS)) {
  const pcm = render(t, Math.min(SECONDS, trackSeconds(t)))
  let peak = 0
  let sum = 0
  let dc = 0
  for (const v of pcm) {
    peak = Math.max(peak, Math.abs(v))
    sum += v * v
    dc += v
    if (!Number.isFinite(v)) throw new Error('NaN no áudio')
  }
  const rms = Math.sqrt(sum / pcm.length)
  // RMS por segundo: procura buracos e picos
  const per: number[] = []
  for (let s = 0; s + SR <= pcm.length; s += SR) {
    let q = 0
    for (let k = s; k < s + SR; k++) q += pcm[k]! * pcm[k]!
    per.push(Math.sqrt(q / SR))
  }
  writeFileSync(`${out}/${t.id}.wav`, wav(pcm))
  console.log(`${t.id}: pico ${peak.toFixed(3)} (${(20 * Math.log10(peak)).toFixed(1)} dBFS), rms ${(20 * Math.log10(rms)).toFixed(1)} dBFS, dc ${(dc / pcm.length).toExponential(1)}`)
  console.log(`  rms/s (dBFS): ${per.map((r) => (20 * Math.log10(r + 1e-9)).toFixed(0)).join(' ')}`)
  console.log(scoreText(t).split('\n').slice(0, 9).join('\n'))
}
console.log(`WAVs em ${out}`)
