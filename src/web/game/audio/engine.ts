/** Motor Web Audio: vozes (pulso/triângulo/ruído), barramentos, mixagem, ducking. */
import type { SeqHost } from './sequencer'
import { duckGain, duckTimeConstant, midiToHz, pulseCoefficients, volumeToGain } from './notes'
import { sfxPlan, type SfxVoice } from './sfx'
import { stepSeconds, type StepNote, type TrackDef } from './songs'
import type { SfxName } from '../contract'

interface Bus {
  gain: GainNode
  filter: BiquadFilterNode
  track?: string
}

const waves = new WeakMap<BaseAudioContext, Map<number, PeriodicWave>>()
function pulseWave(ctx: BaseAudioContext, duty: number): PeriodicWave {
  let m = waves.get(ctx)
  if (!m) waves.set(ctx, (m = new Map()))
  let w = m.get(duty)
  if (!w) {
    const { real, imag } = pulseCoefficients(duty)
    m.set(duty, (w = ctx.createPeriodicWave(real, imag)))
  }
  return w
}

interface VoiceOpts {
  kind: 'pulse' | 'tri' | 'sine' | 'noise'
  when: number
  dur: number
  freq?: number
  freqEnd?: number
  vel: number
  duty?: number
  filter?: SfxVoice['filter']
  attack?: number
  /** fração do volume no fim da nota */
  sustain?: number
  release?: number
  vibrato?: AudioNode
}

export class Engine implements SeqHost {
  readonly out: GainNode // entrada do compressor (música + efeitos)
  private comp: DynamicsCompressorNode
  private sfxBus: GainNode
  private musicVol: GainNode
  private duck: GainNode
  private duckNow = 1
  private noise: AudioBuffer
  private noiseCount = 0
  private lfo: OscillatorNode
  private lfoDepth: GainNode
  private buses = new Map<number, Bus>()
  private timers = new Set<ReturnType<typeof setTimeout>>()

  constructor(readonly ctx: AudioContext, volume: number, duck: number) {
    this.out = ctx.createGain()
    this.comp = ctx.createDynamicsCompressor()
    this.comp.threshold.value = -20
    this.comp.knee.value = 24
    this.comp.ratio.value = 3
    this.comp.attack.value = 0.01
    this.comp.release.value = 0.25
    this.out.connect(this.comp).connect(ctx.destination)

    this.sfxBus = ctx.createGain()
    this.sfxBus.gain.value = 0.9
    this.sfxBus.connect(this.out)

    this.musicVol = ctx.createGain()
    this.musicVol.gain.value = volumeToGain(volume)
    this.musicVol.connect(this.out)
    this.duck = ctx.createGain()
    this.duckNow = duckGain(duck)
    this.duck.gain.value = this.duckNow
    this.duck.connect(this.musicVol)

    // vibrato sutil, compartilhado pelas notas longas da melodia (em centésimos de semitom)
    this.lfo = ctx.createOscillator()
    this.lfo.frequency.value = 5.3
    this.lfoDepth = ctx.createGain()
    this.lfoDepth.gain.value = 7
    this.lfo.connect(this.lfoDepth)
    this.lfo.start()

    const len = Math.floor(ctx.sampleRate * 1.5)
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = this.noise.getChannelData(0)
    let seed = 22695477
    for (let i = 0; i < len; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0
      d[i] = (seed >>> 8) / 8388608 - 1
    }
  }

  setVolume(v: number): void {
    this.musicVol.gain.setTargetAtTime(volumeToGain(v), this.ctx.currentTime, 0.03)
  }

  setDuck(level: number): void {
    const target = duckGain(level)
    const now = this.ctx.currentTime
    const tc = duckTimeConstant(this.duckNow, target)
    this.duck.gain.cancelScheduledValues(now)
    this.duck.gain.setTargetAtTime(target, now, tc)
    this.duckNow = target
  }

  // ---- SeqHost ----
  now(): number {
    return this.ctx.currentTime
  }
  lookahead(): number {
    // aba em segundo plano: os timers atrasam, agenda mais à frente
    return typeof document !== 'undefined' && document.hidden ? 1.2 : 0.1
  }

  private bus(layer: number): Bus {
    let b = this.buses.get(layer)
    if (!b) {
      const gain = this.ctx.createGain()
      gain.gain.value = 0
      const filter = this.ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = 5000
      filter.Q.value = 0.5
      gain.connect(filter).connect(this.duck)
      this.buses.set(layer, (b = { gain, filter }))
    }
    return b
  }

  fade(layer: number, from: number, to: number, start: number, end: number): void {
    const g = this.bus(layer).gain.gain
    g.cancelScheduledValues(start)
    g.setValueAtTime(from, start)
    g.linearRampToValueAtTime(to, Math.max(end, start + 0.001))
  }

  release(layer: number, at: number): void {
    const b = this.buses.get(layer)
    if (!b) return
    const ms = Math.max(0, (at - this.ctx.currentTime) * 1000) + 300
    const id = setTimeout(() => {
      this.timers.delete(id)
      b.gain.disconnect()
      b.filter.disconnect()
      this.buses.delete(layer)
    }, ms)
    this.timers.add(id)
  }

  note(layer: number, track: TrackDef, ev: StepNote, when: number, dur: number): void {
    const bus = this.bus(layer)
    if (bus.track !== track.id) {
      bus.track = track.id
      bus.filter.frequency.value = track.cutoff
    }
    const vel = ev.vel * track.gain
    const dest = bus.gain
    const f = ev.midi !== undefined ? midiToHz(ev.midi) : 0
    switch (ev.ch) {
      case 'lead':
        this.voice(dest, { kind: 'pulse', when, dur, freq: f, vel: vel * 0.17, duty: track.duty.lead, attack: 0.006, sustain: 0.65, release: 0.05, vibrato: ev.steps >= 4 ? this.lfoDepth : undefined })
        break
      case 'arp':
        this.voice(dest, { kind: 'pulse', when, dur, freq: f, vel: vel * 0.1, duty: track.duty.arp, attack: 0.003, sustain: dur > 0.3 ? 0.7 : 0.15, release: 0.04 })
        break
      case 'bass':
        this.voice(dest, { kind: 'tri', when, dur, freq: f, vel: vel * 0.32, attack: 0.008, sustain: 0.8, release: 0.06 })
        break
      case 'kick':
        this.voice(dest, { kind: 'tri', when, dur: 0.16, freq: 150, freqEnd: 46, vel: vel * 0.62, attack: 0.002, sustain: 0.1, release: 0.03 })
        break
      case 'snare':
        this.voice(dest, { kind: 'noise', when, dur: 0.12, vel: vel * 0.2, attack: 0.001, sustain: 0.05, release: 0.03, filter: { type: 'bandpass', freq: 1900, q: 0.8 } })
        this.voice(dest, { kind: 'tri', when, dur: 0.07, freq: 200, freqEnd: 140, vel: vel * 0.2, attack: 0.001, sustain: 0.1, release: 0.02 })
        break
      case 'hat': {
        const open = ev.steps >= 4
        const d = open ? Math.min(0.4, ev.steps * stepSeconds(track) * 0.5) : 0.035
        this.voice(dest, { kind: 'noise', when, dur: d, vel: vel * 0.1, attack: 0.001, sustain: 0.05, release: 0.02, filter: { type: 'highpass', freq: 7200, q: 0.7 } })
        break
      }
    }
  }

  // ---- efeitos ----
  sfx(name: SfxName, count?: number): void {
    const t0 = this.ctx.currentTime + 0.01
    for (const v of sfxPlan(name, count)) {
      this.voice(this.sfxBus, { kind: v.kind, when: t0 + v.t, dur: v.dur, freq: v.freq, freqEnd: v.freqEnd, vel: v.vel, duty: v.duty, filter: v.filter, attack: v.attack ?? 0.003, sustain: 0.05, release: 0.03 })
    }
  }

  // ---- voz genérica ----
  private voice(dest: AudioNode, o: VoiceOpts): void {
    const ctx = this.ctx
    const rel = o.release ?? 0.04
    const end = o.when + o.dur + rel
    const env = ctx.createGain()
    const a = Math.min(o.attack ?? 0.004, o.dur * 0.5)
    env.gain.setValueAtTime(0, o.when)
    env.gain.linearRampToValueAtTime(o.vel, o.when + a)
    env.gain.linearRampToValueAtTime(o.vel * (o.sustain ?? 0.7), o.when + o.dur)
    env.gain.linearRampToValueAtTime(0, end)
    env.connect(dest)

    let src: AudioScheduledSourceNode
    let tail: AudioNode = env
    if (o.kind === 'noise') {
      const s = ctx.createBufferSource()
      s.buffer = this.noise
      const f = ctx.createBiquadFilter()
      f.type = o.filter?.type ?? 'highpass'
      f.frequency.setValueAtTime(o.filter?.freq ?? 4000, o.when)
      if (o.filter?.freqEnd) f.frequency.exponentialRampToValueAtTime(o.filter.freqEnd, o.when + o.dur)
      f.Q.value = o.filter?.q ?? 0.7
      s.connect(f).connect(env)
      s.start(o.when, ((this.noiseCount++ * 0.137) % 1) + 0.01)
      s.stop(end + 0.01)
      src = s
      tail = f
    } else {
      const osc = ctx.createOscillator()
      if (o.kind === 'pulse') osc.setPeriodicWave(pulseWave(ctx, o.duty ?? 0.5))
      else osc.type = o.kind === 'tri' ? 'triangle' : 'sine'
      const fr = Math.max(20, o.freq ?? 440)
      osc.frequency.setValueAtTime(fr, o.when)
      if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqEnd), o.when + Math.min(o.dur, 0.12))
      if (o.vibrato) o.vibrato.connect(osc.detune)
      osc.connect(env)
      osc.start(o.when)
      osc.stop(end + 0.01)
      src = osc
      if (o.vibrato) {
        const lfoOut = o.vibrato
        src.addEventListener('ended', () => lfoOut.disconnect(osc.detune))
      }
    }
    src.addEventListener('ended', () => {
      src.disconnect()
      tail.disconnect()
      env.disconnect()
    })
  }

  dispose(): void {
    for (const id of this.timers) clearTimeout(id)
    this.timers.clear()
    for (const b of this.buses.values()) {
      b.gain.disconnect()
      b.filter.disconnect()
    }
    this.buses.clear()
    try {
      this.lfo.stop()
    } catch {
      /* já parado */
    }
    this.lfo.disconnect()
    this.lfoDepth.disconnect()
    this.sfxBus.disconnect()
    this.duck.disconnect()
    this.musicVol.disconnect()
    this.out.disconnect()
    this.comp.disconnect()
  }
}

