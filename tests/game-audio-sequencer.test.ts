import { describe, expect, it } from 'vitest'
import { Sequencer, stepTime, type SeqHost } from '../src/web/game/audio/sequencer'
import { MAX_CHIPS, sfxDuration, sfxPlan } from '../src/web/game/audio/sfx'
import { TRACKS, barSeconds, stepSeconds, type StepNote, type TrackDef } from '../src/web/game/audio/songs'
import type { SfxName } from '../src/web/game/contract'

interface Rec {
  layer: number
  track: string
  ev: StepNote
  when: number
  dur: number
}

class FakeHost implements SeqHost {
  t = 0
  look = 0.1
  notes: Rec[] = []
  fades: { layer: number; from: number; to: number; start: number; end: number }[] = []
  released: { layer: number; at: number }[] = []
  changes: { track: string; at: number }[] = []
  now() {
    return this.t
  }
  lookahead() {
    return this.look
  }
  note(layer: number, track: TrackDef, ev: StepNote, when: number, dur: number) {
    this.notes.push({ layer, track: track.id, ev, when, dur })
  }
  fade(layer: number, from: number, to: number, start: number, end: number) {
    this.fades.push({ layer, from, to, start, end })
  }
  release(layer: number, at: number) {
    this.released.push({ layer, at })
  }
  changed(track: string, at: number) {
    this.changes.push({ track, at })
  }
}

/** avança o relógio em passos de 25 ms, chamando tick, como o setInterval */
function run(seq: Sequencer, host: FakeHost, seconds: number) {
  const end = host.t + seconds
  while (host.t < end - 1e-9) {
    host.t += 0.025
    seq.tick()
  }
}

describe('sequenciador', () => {
  it('agenda no ritmo certo, sem duplicar nem atrasar notas', () => {
    const h = new FakeHost()
    const s = new Sequencer(h)
    s.start('calma')
    run(s, h, 4)
    const t = TRACKS.calma
    const start = h.changes[0]!.at
    const first = h.notes.filter((n) => n.layer === 1)
    // a grade tem swing: passos ímpares atrasam
    const sd = stepSeconds(t)
    expect(sd).toBeCloseTo(60 / 92 / 4)
    const hats = first.filter((n) => n.ev.ch === 'hat').map((n) => n.when - start)
    expect(hats[0]).toBeCloseTo(0, 5)
    expect(hats[1]).toBeCloseTo(sd + t.swing * sd, 5)
    // nenhuma nota no passado nem duplicada
    for (const n of first) expect(n.when).toBeGreaterThanOrEqual(start - 1e-9)
    const keys = new Set(first.map((n) => `${n.when.toFixed(5)}-${n.ev.ch}-${n.ev.midi}`))
    expect(keys.size).toBe(first.length)
    // agenda só até o horizonte (lookahead 100 ms)
    expect(Math.max(...first.map((n) => n.when))).toBeLessThanOrEqual(h.t + h.look + 1e-9)
    // quantidade de notas bate com a partitura do trecho tocado
    const stepsPlayed = Math.floor((h.t + h.look - start) / sd) + 1
    expect(first.length).toBeGreaterThanOrEqual(stepsPlayed)
  })

  it('o loop dá a volta sem emenda (compasso 33 = compasso 1)', () => {
    const h = new FakeHost()
    const s = new Sequencer(h)
    s.start('tensao')
    const t = TRACKS.tensao
    const loop = barSeconds(t) * t.bars
    run(s, h, loop + 2)
    const start = h.changes[0]!.at
    const firstKicks = h.notes.filter((n) => n.ev.ch === 'kick').map((n) => n.when - start)
    expect(firstKicks.some((w) => Math.abs(w - loop) < 1e-6)).toBe(true)
    expect(h.notes.some((n) => n.when - start > loop - 0.5 && n.when - start < loop - 1e-6)).toBe(true)
  })

  it('troca de faixa só no próximo compasso, com crossfade de 1 compasso', () => {
    const h = new FakeHost()
    const s = new Sequencer(h)
    s.start('calma')
    run(s, h, 3.1)
    const start = h.changes[0]!.at
    const bar = barSeconds(TRACKS.calma)
    s.setTrack('tensao')
    expect(s.queued).toBe('tensao')
    expect(s.current).toBe('calma')
    run(s, h, bar * 2)
    expect(s.current).toBe('tensao')
    const sw = h.changes[1]!
    expect(sw.track).toBe('tensao')
    // cai exatamente num limite de compasso da faixa antiga
    const bars = (sw.at - start) / bar
    expect(bars).toBeCloseTo(Math.round(bars), 6)
    expect(sw.at).toBeGreaterThanOrEqual(3.1 - 0.001)
    // fade-out da antiga e fade-in da nova, 1 compasso cada
    const out = h.fades.find((f) => f.layer === 1 && f.to === 0)!
    const inn = h.fades.find((f) => f.layer === 2 && f.to === 1)!
    expect(out.start).toBeCloseTo(sw.at)
    expect(out.end - out.start).toBeCloseTo(bar)
    expect(inn.start).toBeCloseTo(sw.at)
    expect(inn.end - inn.start).toBeCloseTo(barSeconds(TRACKS.tensao))
    // durante o crossfade as duas tocam; depois a antiga cala
    const old = h.notes.filter((n) => n.layer === 1)
    const lastOld = Math.max(...old.map((n) => n.when))
    expect(lastOld).toBeGreaterThanOrEqual(sw.at)
    expect(lastOld).toBeLessThan(sw.at + bar)
    expect(h.notes.filter((n) => n.layer === 2).every((n) => n.when >= sw.at - 1e-9)).toBe(true)
    expect(h.released.some((r) => r.layer === 1)).toBe(true)
    // a nova começa do compasso 1 dela
    const firstNew = h.notes.filter((n) => n.layer === 2 && n.ev.ch === 'kick')[0]!
    expect(firstNew.when).toBeCloseTo(sw.at)
  })

  it('pedir a faixa que já toca não troca; pedir antes de iniciar é ignorado', () => {
    const h = new FakeHost()
    const s = new Sequencer(h)
    s.setTrack('tensao')
    expect(s.running).toBe(false)
    s.start('calma')
    s.setTrack('calma')
    run(s, h, 6)
    expect(h.changes).toHaveLength(1)
  })

  it('vitória toca uma vez e volta sozinha para a calma no fim exato', () => {
    const h = new FakeHost()
    const s = new Sequencer(h)
    s.start('vitoria')
    const v = TRACKS.vitoria
    const dur = barSeconds(v) * v.bars
    run(s, h, dur + 2)
    expect(h.changes.map((c) => c.track)).toEqual(['vitoria', 'calma'])
    expect(h.changes[1]!.at - h.changes[0]!.at).toBeCloseTo(dur, 6)
    expect(s.current).toBe('calma')
    // a vitória não repete
    const vNotes = h.notes.filter((n) => n.track === 'vitoria')
    expect(Math.max(...vNotes.map((n) => n.when))).toBeLessThan(h.changes[1]!.at)
  })

  it('música de fundo reveza: calma inteira, depois cisnes inteira, depois calma de novo', () => {
    const h = new FakeHost()
    const s = new Sequencer(h)
    s.start('calma')
    const c = TRACKS.calma
    const w = TRACKS.cisnes
    const dc = barSeconds(c) * c.bars
    const dw = barSeconds(w) * w.bars
    run(s, h, dc + dw + 2)
    expect(h.changes.map((x) => x.track)).toEqual(['calma', 'cisnes', 'calma'])
    expect(h.changes[1]!.at - h.changes[0]!.at).toBeCloseTo(dc, 6)
    expect(h.changes[2]!.at - h.changes[1]!.at).toBeCloseTo(dw, 6)
    // a calma não dá uma segunda volta antes dos cisnes
    const calmaNotes = h.notes.filter((n) => n.track === 'calma' && n.when < h.changes[2]!.at)
    expect(Math.max(...calmaNotes.map((n) => n.when))).toBeLessThan(h.changes[1]!.at)
  })

  it('pedir a calma com os cisnes tocando não interrompe; pedir a tensão troca', () => {
    const h = new FakeHost()
    const s = new Sequencer(h)
    s.start('cisnes')
    run(s, h, 2)
    s.setTrack('calma')
    expect(s.queued).toBeUndefined()
    run(s, h, barSeconds(TRACKS.cisnes) * 2)
    expect(s.current).toBe('cisnes')
    s.setTrack('tensao')
    expect(s.queued).toBe('tensao')
    run(s, h, barSeconds(TRACKS.cisnes) * 2)
    expect(s.current).toBe('tensao')
  })

  it('stop faz fade e silencia; start de novo recomeça', () => {
    const h = new FakeHost()
    const s = new Sequencer(h)
    s.start('calma')
    run(s, h, 1)
    s.stop(0.4)
    expect(s.running).toBe(false)
    const n = h.notes.length
    run(s, h, 1)
    expect(h.notes.length).toBe(n)
    expect(h.fades.at(-1)!.to).toBe(0)
    expect(h.released).toHaveLength(1)
    s.start('tensao')
    run(s, h, 1)
    expect(h.notes.length).toBeGreaterThan(n)
  })

  it('descarta passos muito atrasados (aba em segundo plano) em vez de rajada', () => {
    const h = new FakeHost()
    const s = new Sequencer(h)
    s.start('calma')
    run(s, h, 1)
    const n = h.notes.length
    h.t += 5 // timer congelado por 5 s
    s.tick()
    const burst = h.notes.slice(n)
    expect(burst.every((x) => x.when >= h.t - 1e-9)).toBe(true)
    expect(burst.length).toBeLessThan(40)
  })

  it('lookahead maior (aba oculta) agenda mais à frente', () => {
    const h = new FakeHost()
    h.look = 1.2
    const s = new Sequencer(h)
    s.start('calma')
    s.tick()
    expect(Math.max(...h.notes.map((n) => n.when))).toBeGreaterThan(1)
  })

  it('stepTime aplica o swing só nos passos ímpares', () => {
    const l = { track: TRACKS.calma, startTime: 10 }
    const sd = stepSeconds(TRACKS.calma)
    expect(stepTime(l, 2)).toBeCloseTo(10 + 2 * sd)
    expect(stepTime(l, 3)).toBeCloseTo(10 + 3 * sd + TRACKS.calma.swing * sd)
  })
})

describe('efeitos', () => {
  const names: SfxName[] = ['shuffle', 'deal', 'flip', 'chip', 'check', 'fold', 'turn', 'allin', 'win', 'rebuy', 'podium', 'putt', 'cup', 'splash', 'bounce']
  it.each(names)('%s tem plano válido e curto', (n) => {
    const plan = sfxPlan(n)
    expect(plan.length).toBeGreaterThan(0)
    for (const v of plan) {
      expect(v.t).toBeGreaterThanOrEqual(0)
      expect(v.dur).toBeGreaterThan(0)
      expect(v.vel).toBeGreaterThan(0)
      expect(v.vel).toBeLessThanOrEqual(0.6)
      if (v.kind !== 'noise') expect(v.freq).toBeGreaterThan(20)
    }
    expect(sfxDuration(n)).toBeLessThan(1.6)
  })
  it('podium dura cerca de 1 s e chip escala com count', () => {
    expect(sfxDuration('podium')).toBeGreaterThan(1)
    expect(sfxDuration('podium')).toBeLessThan(1.4)
    expect(sfxPlan('chip', 4).length).toBe(4 * sfxPlan('chip', 1).length)
    expect(sfxPlan('chip', 99).length).toBe(MAX_CHIPS * sfxPlan('chip', 1).length)
    expect(sfxPlan('chip', 0).length).toBe(sfxPlan('chip', 1).length)
  })
})
