import { describe, expect, it } from 'vitest'
import { CHORDS, STEPS_PER_BAR, TRACKS, parseBar, scoreText, trackSeconds, type TrackDef } from '../src/web/game/audio/songs'
import { duckGain, duckTimeConstant, midiToHz, noteToMidi, pulseCoefficients, volumeToGain } from '../src/web/game/audio/notes'

const ids = ['calma', 'cisnes', 'tensao', 'vitoria'] as const
/** tônica de cada faixa que fecha em repouso (classe de altura) */
const TONIC: Record<string, number> = { calma: 0, vitoria: 0, cisnes: 9 }

/** semitom entre classes de altura (0..6) */
const ic = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 12
  return Math.min(d, 12 - d)
}

function leadByBar(t: TrackDef) {
  return t.leadText.map(parseBar)
}

describe('notas e ondas', () => {
  it('converte nota e frequência', () => {
    expect(noteToMidi('C4')).toBe(60)
    expect(noteToMidi('A4')).toBe(69)
    expect(noteToMidi('G#3')).toBe(56)
    expect(midiToHz(69)).toBeCloseTo(440)
    expect(() => noteToMidi('H4')).toThrow()
  })
  it('pulso 50% tem só harmônicos ímpares; duty 25% tem pares', () => {
    const sq = pulseCoefficients(0.5, 8)
    expect(Math.abs(sq.real[1]!)).toBeLessThan(1e-6)
    expect(sq.imag[1]!).toBeCloseTo(2 / Math.PI, 5)
    expect(Math.abs(sq.imag[2]!)).toBeLessThan(1e-6)
    expect(sq.imag[3]!).toBeCloseTo(2 / (3 * Math.PI), 5)
    const q = pulseCoefficients(0.25, 8)
    expect(Math.hypot(q.real[2]!, q.imag[2]!)).toBeGreaterThan(0.1)
    expect(q.real[0]).toBe(0)
  })
  it('ducking: 0 dB a -12 dB, ataque rápido e soltura lenta', () => {
    expect(duckGain(0)).toBe(1)
    expect(duckGain(1)).toBeCloseTo(0.2512, 3)
    expect(duckGain(5)).toBe(duckGain(1))
    expect(duckGain(NaN)).toBe(1)
    expect(duckTimeConstant(1, 0.25) * 3).toBeCloseTo(0.08)
    expect(duckTimeConstant(0.25, 1) * 3).toBeCloseTo(0.4)
  })
  it('volume tem curva e limites', () => {
    expect(volumeToGain(0)).toBe(0)
    expect(volumeToGain(2)).toBeCloseTo(0.9)
    expect(volumeToGain(0.35)).toBeLessThan(0.15)
  })
})

describe.each(ids)('faixa %s', (id) => {
  const t = TRACKS[id]
  const lead = leadByBar(t)

  it('tem tamanho e andamento do plano', () => {
    expect(t.id).toBe(id)
    expect(t.bars).toBeGreaterThanOrEqual(16)
    expect(t.bars).toBeLessThanOrEqual(32)
    expect(t.steps).toHaveLength(t.bars * STEPS_PER_BAR)
    expect(t.chords).toHaveLength(t.bars)
    expect(trackSeconds(t)).toBeGreaterThan(20)
  })

  it('melodia dentro da escala e da região', () => {
    for (const bar of lead) {
      for (const n of bar) {
        expect(t.scale, `${id} ${n.midi}`).toContain(n.midi % 12)
        expect(n.midi).toBeGreaterThanOrEqual(noteToMidi('G3'))
        expect(n.midi).toBeLessThanOrEqual(noteToMidi('F6'))
      }
    }
  })

  it('tempos fortes caem em notas do acorde; tempos 2 e 4 sem choque de semitom', () => {
    lead.forEach((bar, b) => {
      const pcs = t.chords[b]!.pcs
      for (const n of bar) {
        const pc = n.midi % 12
        const isChordTone = pcs.includes(pc)
        if (n.start === 0 || n.start === 8) expect(isChordTone, `${id} compasso ${b + 1} passo ${n.start}`).toBe(true)
        if (n.start === 4 || n.start === 12) {
          const clash = !isChordTone && pcs.some((c) => ic(c, pc) === 1)
          expect(clash, `${id} compasso ${b + 1} passo ${n.start}`).toBe(false)
        }
      }
    })
  })

  it('arpejos e baixo só usam notas do acorde, baixo grave', () => {
    t.steps.forEach((evs, i) => {
      const b = Math.floor(i / STEPS_PER_BAR)
      const pcs = t.chords[b]!.pcs
      for (const e of evs) {
        if (e.ch === 'arp' || e.ch === 'bass') {
          expect(pcs, `${id} compasso ${b + 1}`).toContain(e.midi! % 12)
        }
        if (e.ch === 'bass') {
          expect(e.midi).toBeGreaterThanOrEqual(noteToMidi('A1'))
          expect(e.midi).toBeLessThanOrEqual(noteToMidi('C4'))
        }
        expect(e.vel).toBeGreaterThan(0)
        expect(e.vel).toBeLessThanOrEqual(1.2)
      }
    })
  })

  it('melodia sem saltos maiores que uma oitava e com respiros', () => {
    let prev: number | undefined
    for (const bar of lead) {
      for (const n of bar) {
        if (prev !== undefined) expect(Math.abs(n.midi - prev)).toBeLessThanOrEqual(12)
        prev = n.midi
      }
    }
    // densidade máxima da melodia: janelas de 4 compassos (8 na tensão, que é um ostinato)
    const win = id === 'tensao' ? 8 : 4
    const max = id === 'calma' ? 0.8 : 0.92
    for (let b = 0; b + win <= t.bars; b += win) {
      let sounding = 0
      for (const bar of lead.slice(b, b + win)) {
        const used = new Set<number>()
        for (const n of bar) for (let s = n.start; s < n.start + n.steps; s++) used.add(s)
        sounding += used.size
      }
      expect(sounding / (win * STEPS_PER_BAR), `${id} compassos ${b + 1}-${b + win}`).toBeLessThanOrEqual(max)
    }
  })

  it('frases terminam resolvendo (nota do acorde, em nota longa ou na tônica)', () => {
    for (let b = 3; b < t.bars; b += 4) {
      const last = lead[b]!.at(-1)!
      expect(t.chords[b]!.pcs, `${id} fim de frase no compasso ${b + 1}`).toContain(last.midi % 12)
      // a última nota da frase não é uma nota rápida solta
      if (id !== 'tensao') expect(last.steps).toBeGreaterThanOrEqual(2)
    }
  })

  it('compasso final: calma/vitória/cisnes fecham na tônica; tensão pede a tônica (dominante)', () => {
    const c = t.chords[t.bars - 1]!
    if (id === 'tensao') expect(c.name).toBe('E7')
    else expect(c.bass % 12).toBe(TONIC[id])
    const last = lead[t.bars - 1]!.at(-1)!
    expect(c.pcs).toContain(last.midi % 12)
  })
})

describe('forma', () => {
  it('calma: 32 compassos, 92 BPM, e as seções não repetem a melodia', () => {
    const t = TRACKS.calma
    expect(t.bars).toBe(32)
    expect(t.bpm).toBe(92)
    expect(t.swing).toBeGreaterThan(0)
    const sec = [0, 8, 16, 24].map((s) => t.leadText.slice(s, s + 8).join('|'))
    expect(new Set(sec).size).toBe(4)
    // progressão principal do plano
    expect(t.chords.slice(0, 4).map((c) => c.name)).toEqual(['FM7', 'Em7', 'Dm7', 'CM7'])
    // a ponte respira: sem bumbo na maior parte
    const kicks = (from: number, to: number) => t.steps.slice(from * 16, to * 16).flat().filter((e) => e.ch === 'kick').length
    expect(kicks(16, 24)).toBeLessThan(kicks(0, 8) / 2)
  })
  it('tensão: 120 BPM, usa o sol sustenido do E7', () => {
    const t = TRACKS.tensao
    expect(t.bpm).toBe(120)
    expect(t.chords.some((c) => c.name === 'E7')).toBe(true)
    expect(t.leadText.join(' ')).toContain('G#')
  })
  it('vitória: toca uma vez e volta para a calma; começa e termina na tônica', () => {
    const t = TRACKS.vitoria
    expect(t.once).toBe(true)
    expect(t.next).toBe('calma')
    expect(t.chords[0]!.name).toBe('C')
    expect(t.chords.at(-1)!.name).toBe('C')
  })
  it('cisnes: o tema do Lago dos Cisnes em lá menor, revezando com a calma', () => {
    const t = TRACKS.cisnes
    expect(t.rotate).toBe('calma')
    expect(TRACKS.calma.rotate).toBe('cisnes')
    expect(t.once).toBeFalsy()
    // a abertura do tema: mi longo, depois lá si dó ré subindo
    expect(parseBar(t.leadText[0]!).map((n) => n.midi)).toEqual(['E5', 'A4', 'B4', 'C5', 'D5'].map(noteToMidi))
    expect(parseBar(t.leadText[0]!)[0]!.steps).toBe(8)
    // o tema volta três vezes (A, A', A'')
    expect(t.leadText[0]).toBe(t.leadText[4])
    expect(t.leadText[0]).toBe(t.leadText[12])
    expect(t.chords[0]!.name).toBe('Am')
    expect(t.chords.some((c) => c.name === 'E7')).toBe(true)
  })
  it('partitura em texto cobre todos os compassos', () => {
    for (const id of ids) expect(scoreText(TRACKS[id]).split('\n')).toHaveLength(TRACKS[id].bars + 1)
  })
  it('parseBar valida a soma', () => {
    expect(() => parseBar('C5/4 -/4')).toThrow()
    expect(parseBar('C5/8 -/8')).toEqual([{ start: 0, midi: 72, steps: 8 }])
    expect(Object.keys(CHORDS).length).toBeGreaterThan(8)
  })
})
