import { describe, expect, it } from 'vitest'
import { STEPS_PER_BAR, TRACKS, parseBar, scoreText, trackSeconds } from '../../src/web/game/audio/songs'
import { noteToMidi } from '../../src/web/game/audio/notes'

const ids = ['tiroteio', 'final'] as const

describe.each(ids)('faixa %s', (id) => {
  const t = TRACKS[id]
  const lead = t.leadText.map(parseBar)

  it('tem 16 compassos, andamento rápido e loop', () => {
    expect(t.id).toBe(id)
    expect(t.bars).toBe(16)
    expect(t.steps).toHaveLength(16 * STEPS_PER_BAR)
    expect(t.chords).toHaveLength(16)
    expect(t.bpm).toBeGreaterThanOrEqual(144)
    expect(t.once).toBeUndefined()
    expect(trackSeconds(t)).toBeGreaterThan(20)
    expect(trackSeconds(t)).toBeLessThan(90)
  })

  it('melodia na escala e na região, tempos fortes em notas do acorde', () => {
    lead.forEach((bar, b) => {
      for (const n of bar) {
        expect(t.scale, `${id} compasso ${b + 1}`).toContain(n.midi % 12)
        expect(n.midi).toBeGreaterThanOrEqual(noteToMidi('G3'))
        expect(n.midi).toBeLessThanOrEqual(noteToMidi('F6'))
        if (n.start === 0 || n.start === 8) expect(t.chords[b]!.pcs, `${id} compasso ${b + 1} passo ${n.start}`).toContain(n.midi % 12)
      }
    })
  })

  it('arpejo e baixo só usam notas do acorde', () => {
    t.steps.forEach((evs, i) => {
      const pcs = t.chords[Math.floor(i / STEPS_PER_BAR)]!.pcs
      for (const e of evs) if (e.ch === 'arp' || e.ch === 'bass') expect(pcs).toContain(e.midi! % 12)
    })
  })

  it('frases fecham em nota do acorde e o loop pede o começo (dominante no fim)', () => {
    for (let b = 3; b < 16; b += 4) {
      const last = lead[b]!.at(-1)!
      expect(t.chords[b]!.pcs).toContain(last.midi % 12)
    }
    expect(['A7', 'B7']).toContain(t.chords.at(-1)!.name)
  })

  it('a partitura em texto cobre todos os compassos', () => {
    expect(scoreText(t).split('\n')).toHaveLength(17)
  })
})

describe('as duas faixas são diferentes entre si e das do poker', () => {
  it('andamento e harmonia próprios', () => {
    expect(TRACKS.final.bpm).toBeGreaterThan(TRACKS.tiroteio.bpm)
    expect(TRACKS.tiroteio.chords[0]!.name).toBe('Dm7')
    expect(TRACKS.final.chords[0]!.name).toBe('Em7')
    const texts = new Set([TRACKS.tiroteio, TRACKS.final, TRACKS.tensao, TRACKS.calma].map((x) => x.leadText.join('|')))
    expect(texts.size).toBe(4)
  })
})
