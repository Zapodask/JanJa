/**
 * As 3 faixas ORIGINAIS do poker (chiptune lo-fi), escritas como dados.
 * Grade de semicolcheias: 16 passos por compasso (4/4). Tudo é determinístico.
 *
 *  calma   Dó maior, 92 BPM, swing leve, 32 compassos (A, A', ponte, A'' esparso)
 *  cisnes  Lá menor, 96 BPM, 16 compassos: o tema do Lago dos Cisnes (Tchaikovsky, 1876, domínio
 *          público) em 8 bits. Reveza com a calma como música de fundo (`rotate`)
 *  tensao  Lá menor, 120 BPM, 16 compassos (dominante E7 com sol sustenido)
 *  vitoria Dó maior, 128 BPM, 16 compassos, toca 1 vez e volta para a calma
 *  tiroteio Ré menor harmônico, 150 BPM, 16 compassos (Tiro na Sala: partida rolando)
 *  final    Mi menor harmônico, 176 BPM, 16 compassos (Tiro na Sala: último minuto)
 */
import type { MusicTrack } from '../contract'
import { noteToMidi } from './notes'

export const STEPS_PER_BAR = 16

export type Channel = 'lead' | 'arp' | 'bass' | 'kick' | 'snare' | 'hat'

/** Uma nota/golpe numa posição da grade. `midi` só nos canais melódicos. */
export interface StepNote {
  ch: Channel
  midi?: number
  /** duração em passos (nos tambores: tamanho do decaimento) */
  steps: number
  /** 0..1 */
  vel: number
}

export interface Chord {
  name: string
  /** baixo (nota grave do acorde) */
  bass: number
  /** classes de altura (0..11) das notas do acorde */
  pcs: number[]
  /** notas para arpejo/stabs, em ordem crescente */
  voicing: number[]
}

export interface TrackDef {
  id: MusicTrack
  bpm: number
  /** atraso (fração de um passo) dos passos ímpares */
  swing: number
  bars: number
  /** toca uma vez e segue para `next` */
  once?: boolean
  next?: MusicTrack
  /** música de fundo em revezamento: no fim de cada volta, passa para esta faixa (em vez de repetir) */
  rotate?: MusicTrack
  /** classes de altura da escala usada (inclui notas de passagem permitidas) */
  scale: number[]
  duty: { lead: number; arp: number }
  /** corte do passa-baixa da faixa (Hz): o "lo-fi" */
  cutoff: number
  /** ganho da faixa */
  gain: number
  chords: Chord[] // um por compasso
  /** eventos por passo (bars * 16 listas) */
  steps: StepNote[][]
  /** o texto fonte da melodia, por compasso (para conferência) */
  leadText: string[]
}

// ---------------- acordes ----------------

const QUAL = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  m7: [0, 3, 7, 10],
  M7: [0, 4, 7, 11],
  d7: [0, 4, 7, 10]
}

function chord(name: string, bass: string, q: keyof typeof QUAL, voicing: string[]): Chord {
  const b = noteToMidi(bass)
  return { name, bass: b, pcs: QUAL[q].map((i) => (b + i) % 12), voicing: voicing.map(noteToMidi) }
}

const CH = {
  FM7: chord('FM7', 'F2', 'M7', ['A3', 'C4', 'E4', 'A4']),
  Em7: chord('Em7', 'E2', 'm7', ['G3', 'B3', 'D4', 'G4']),
  Dm7: chord('Dm7', 'D2', 'm7', ['F3', 'A3', 'C4', 'F4']),
  CM7: chord('CM7', 'C2', 'M7', ['E3', 'G3', 'B3', 'E4']),
  Am7: chord('Am7', 'A2', 'm7', ['A3', 'C4', 'E4', 'G4']),
  G7: chord('G7', 'G2', 'd7', ['B3', 'D4', 'F4', 'G4']),
  E7: chord('E7', 'E2', 'd7', ['G#3', 'B3', 'D4', 'E4']),
  // tiroteio (Ré menor) e final (Mi menor)
  BbM7: chord('BbM7', 'A#2', 'M7', ['D4', 'F4', 'A4', 'D5']),
  C7: chord('C7', 'C3', 'd7', ['E4', 'G4', 'A#4', 'C5']),
  A7: chord('A7', 'A2', 'd7', ['C#4', 'E4', 'G4', 'A4']),
  B7: chord('B7', 'B2', 'd7', ['D#4', 'F#4', 'A4', 'B4']),
  // vitória: tríades, baixo uma oitava acima
  C: chord('C', 'C3', 'maj', ['E4', 'G4', 'C5', 'E5']),
  G: chord('G', 'G2', 'maj', ['D4', 'G4', 'B4', 'D5']),
  Am: chord('Am', 'A2', 'min', ['C4', 'E4', 'A4', 'C5']),
  F: chord('F', 'F2', 'maj', ['C4', 'F4', 'A4', 'C5'])
} satisfies Record<string, Chord>
export type ChordId = keyof typeof CH
export const CHORDS = CH

// ---------------- notação de melodia ----------------

export interface LeadNote {
  start: number
  midi: number
  steps: number
}

/** 'E5/4 -/2 C5/10': nota/duração em passos; '-' é pausa. Cada compasso soma 16. */
export function parseBar(text: string): LeadNote[] {
  const out: LeadNote[] = []
  let pos = 0
  for (const tok of text.trim().split(/\s+/)) {
    const [name, d] = tok.split('/')
    const dur = Number(d)
    if (!name || !Number.isInteger(dur) || dur < 1) throw new Error(`token inválido: ${tok}`)
    if (name !== '-') out.push({ start: pos, midi: noteToMidi(name), steps: dur })
    pos += dur
  }
  if (pos !== STEPS_PER_BAR) throw new Error(`compasso soma ${pos}, esperado 16: ${text}`)
  return out
}

// ---------------- padrões ----------------

/** índice no voicing, lista (acorde junto) ou -1 */
type ArpPat = (number | number[])[]
type BassDeg = 'R' | '5' | '8'
type BassPat = [step: number, deg: BassDeg, steps: number][]
interface DrumPat {
  kick: number[]
  snare: number[]
  hat: number[]
  /** passos de decaimento do chimbal por posição (padrão 1) */
  hatLen?: number[]
}

const R = -1
const ARP_PLUCK: ArpPat = [R, R, 0, R, R, R, 1, R, R, R, 2, R, R, R, 1, R]
const ARP_EIGHTH: ArpPat = [0, R, 1, R, 2, R, 3, R, 2, R, 1, R, 2, R, 1, R]
const ARP_PAD: ArpPat = [[0, 1, 2], R, R, R, R, R, R, R, R, R, R, R, R, R, R, R]
const ARP_SPARSE: ArpPat = [R, R, R, R, R, R, 2, R, R, R, R, R, 3, R, R, R]
const ARP_STAB: ArpPat = [R, R, [0, 1, 2], R, R, R, [0, 1, 2], R, R, R, [0, 1, 2], R, R, R, [0, 1, 2], R]
const ARP_STAB_SPARSE: ArpPat = [R, R, R, R, R, R, [0, 1, 2], R, R, R, R, R, R, R, [0, 1, 2], R]
const ARP_SIXTEENTH: ArpPat = [0, 1, 2, 3, 2, 1, 2, 1, 0, 1, 2, 3, 2, 1, 2, 3]

const BASS_A: BassPat = [[0, 'R', 6], [8, '5', 4], [12, 'R', 3]]
const BASS_B: BassPat = [[0, 'R', 5], [6, '8', 2], [8, 'R', 4], [12, '5', 3]]
const BASS_LONG: BassPat = [[0, 'R', 8], [8, '5', 6]]
const BASS_SOFT: BassPat = [[0, 'R', 8], [10, '5', 4]]
const BASS_DRIVE: BassPat = [[0, 'R', 2], [2, 'R', 2], [4, 'R', 2], [6, '8', 2], [8, 'R', 2], [10, 'R', 2], [12, 'R', 2], [14, '5', 2]]
const BASS_SYNC: BassPat = [[0, 'R', 3], [3, 'R', 3], [6, 'R', 2], [8, 'R', 3], [11, 'R', 3], [14, '8', 2]]
const BASS_BOUNCE: BassPat = [[0, 'R', 2], [2, '8', 2], [4, 'R', 2], [6, '8', 2], [8, 'R', 2], [10, '8', 2], [12, 'R', 2], [14, '5', 2]]
const BASS_PARTY: BassPat = [[0, 'R', 4], [6, '5', 2], [8, 'R', 4], [14, '8', 2]]

const z = (...pos: [number, number][]): number[] => {
  const a = new Array<number>(16).fill(0)
  for (const [i, v] of pos) a[i] = v
  return a
}
const HAT_LOFI = [0.42, 0.1, 0.26, 0.1, 0.36, 0.1, 0.26, 0.1, 0.42, 0.1, 0.26, 0.1, 0.36, 0.1, 0.26, 0.14]
const HAT_8TH = z([0, 0.4], [2, 0.26], [4, 0.36], [6, 0.26], [8, 0.4], [10, 0.26], [12, 0.36], [14, 0.26])
const HAT_8TH_SOFT = z([0, 0.26], [2, 0.18], [4, 0.24], [6, 0.18], [8, 0.26], [10, 0.18], [12, 0.24], [14, 0.18])
const HAT_16 = [0.5, 0.2, 0.34, 0.2, 0.44, 0.2, 0.34, 0.2, 0.5, 0.2, 0.34, 0.2, 0.44, 0.2, 0.34, 0.3]

const D_LOFI: DrumPat = { kick: z([0, 1], [7, 0.35], [10, 0.8]), snare: z([4, 0.55], [12, 0.6]), hat: HAT_LOFI }
const D_LOFI_LIGHT: DrumPat = { kick: z([0, 0.9], [10, 0.6]), snare: z([4, 0.4], [12, 0.45]), hat: HAT_8TH }
const D_BRIDGE: DrumPat = { kick: z([0, 0.7]), snare: z([12, 0.3]), hat: HAT_8TH_SOFT }
const D_LOFI_FILL: DrumPat = { kick: z([0, 1], [10, 0.8]), snare: z([4, 0.55], [12, 0.5], [13, 0.22], [14, 0.4], [15, 0.5]), hat: HAT_LOFI }

const D_TENSE: DrumPat = { kick: z([0, 1], [3, 0.7], [8, 1], [11, 0.7]), snare: z([4, 0.7], [12, 0.75]), hat: HAT_8TH }
const D_TENSE_HARD: DrumPat = { kick: z([0, 1], [3, 0.7], [8, 1], [10, 0.6], [11, 0.7]), snare: z([4, 0.75], [12, 0.8]), hat: HAT_16 }
const D_TENSE_FILL: DrumPat = {
  kick: z([0, 1], [3, 0.7]),
  snare: z([4, 0.7], [8, 0.35], [9, 0.4], [10, 0.5], [11, 0.55], [12, 0.65], [13, 0.75], [14, 0.85], [15, 1]),
  hat: HAT_8TH
}

const D_WIN: DrumPat = { kick: z([0, 1], [4, 0.9], [8, 1], [12, 0.9]), snare: z([4, 0.6], [12, 0.65]), hat: HAT_8TH }
const D_WIN_OPEN: DrumPat = { ...D_WIN, hat: HAT_8TH, hatLen: [4, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] }
const D_WIN_PARTY: DrumPat = { kick: z([0, 0.9], [8, 0.8]), snare: z([4, 0.4], [12, 0.45]), hat: HAT_8TH_SOFT }
const D_WIN_END: DrumPat = { kick: z([0, 1]), snare: z(), hat: z([0, 0.7]), hatLen: [10, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] }

// ---------------- construção ----------------

interface Section {
  chords: ChordId[]
  lead: string[]
  leadVel?: number
  arp: ArpPat
  arpLen: number
  arpVel: number
  bass: BassPat
  drums: DrumPat
  /** compasso final da seção */
  fill?: DrumPat
  /** compasso a compasso, sobrepõe `drums` (índice da seção) */
  drumsByBar?: Record<number, DrumPat>
}

const DEG: Record<BassDeg, number> = { R: 0, '5': 7, '8': 12 }

/** variação mínima e fixa de volume: o loop não soa "de máquina" */
function human(g: number): number {
  return 1 + 0.07 * Math.sin(g * 1.7) + 0.04 * Math.sin(g * 0.41 + 1)
}

function build(def: Omit<TrackDef, 'bars' | 'chords' | 'steps' | 'leadText'>, sections: Section[]): TrackDef {
  const chords: Chord[] = []
  const steps: StepNote[][] = []
  const leadText: string[] = []
  let g = 0
  for (const sec of sections) {
    const nb = sec.chords.length
    if (sec.lead.length !== nb) throw new Error(`${def.id}: seção com ${nb} compassos e ${sec.lead.length} melodias`)
    for (let b = 0; b < nb; b++) {
      const ch = CH[sec.chords[b]!]
      chords.push(ch)
      leadText.push(sec.lead[b]!)
      const bar: StepNote[][] = Array.from({ length: STEPS_PER_BAR }, () => [])
      for (const n of parseBar(sec.lead[b]!)) {
        bar[n.start]!.push({ ch: 'lead', midi: n.midi, steps: n.steps, vel: (sec.leadVel ?? 0.8) * human(g + n.start) })
      }
      sec.arp.forEach((e, s) => {
        if (e === R) return
        for (const idx of Array.isArray(e) ? e : [e]) {
          bar[s]!.push({ ch: 'arp', midi: ch.voicing[idx]!, steps: sec.arpLen, vel: sec.arpVel * human(g + s + 3) })
        }
      })
      for (const [s, deg, n] of sec.bass) {
        bar[s]!.push({ ch: 'bass', midi: ch.bass + DEG[deg], steps: n, vel: 0.9 * human(g + s + 7) })
      }
      const dr = sec.drumsByBar?.[b] ?? (b === nb - 1 && sec.fill ? sec.fill : sec.drums)
      for (let s = 0; s < STEPS_PER_BAR; s++) {
        if (dr.kick[s]) bar[s]!.push({ ch: 'kick', steps: 2, vel: dr.kick[s]! })
        if (dr.snare[s]) bar[s]!.push({ ch: 'snare', steps: 2, vel: dr.snare[s]! * human(g + s) })
        if (dr.hat[s]) bar[s]!.push({ ch: 'hat', steps: dr.hatLen?.[s] ?? 1, vel: dr.hat[s]! * human(g + s + 5) })
      }
      steps.push(...bar)
      g += STEPS_PER_BAR
    }
  }
  return { ...def, bars: chords.length, chords, steps, leadText }
}

const PCS_C_MAJOR = [0, 2, 4, 5, 7, 9, 11]
const PCS_A_MINOR_HARM = [9, 11, 0, 2, 4, 5, 7, 8] // lá menor natural + sol sustenido

// ----- calma: Dó maior, 92 BPM. Fmaj7-Em7-Dm7-Cmaj7 (e a ponte Am7-Dm7-G7) -----
const calma = build(
  { id: 'calma', bpm: 92, swing: 0.28, rotate: 'cisnes', scale: PCS_C_MAJOR, duty: { lead: 0.25, arp: 0.125 }, cutoff: 4200, gain: 1 },
  [
    // A: pergunta (4 compassos) e resposta que termina no dominante
    {
      chords: ['FM7', 'Em7', 'Dm7', 'CM7', 'FM7', 'Em7', 'Dm7', 'G7'],
      lead: [
        'C5/6 A4/2 -/2 C5/2 E5/4',
        '-/2 B4/2 G4/4 -/4 D5/4',
        'A4/4 C5/2 -/2 D5/6 -/2',
        'E5/4 G5/2 E5/2 C5/6 -/2',
        '-/4 A4/2 C5/2 F5/4 E5/2 C5/2',
        'G5/4 -/2 E5/2 D5/4 -/2 B4/2',
        'A4/2 C5/2 D5/4 F5/6 -/2',
        'B4/2 D5/2 G5/4 -/4 F5/2 D5/2'
      ],
      arp: ARP_PLUCK,
      arpLen: 2,
      arpVel: 0.42,
      bass: BASS_A,
      drums: D_LOFI,
      fill: D_LOFI_FILL
    },
    // A': mesma harmonia, melodia mais alta e movimentada; fecha na tônica
    {
      chords: ['FM7', 'Em7', 'Dm7', 'CM7', 'FM7', 'Em7', 'Dm7', 'CM7'],
      lead: [
        'C5/2 E5/2 A5/4 -/4 G5/2 E5/2',
        'G5/4 B5/2 -/2 G5/4 -/2 D5/2',
        'F5/4 D5/4 -/4 C5/2 A4/2',
        'G4/2 C5/2 E5/4 G5/6 -/2',
        '-/4 A4/2 C5/2 F5/4 E5/2 C5/2',
        'G5/4 -/2 E5/2 D5/4 -/2 B4/2',
        'A4/2 C5/2 D5/4 F5/4 -/4',
        'E5/4 D5/2 C5/2 G4/6 -/2'
      ],
      arp: ARP_EIGHTH,
      arpLen: 2,
      arpVel: 0.34,
      bass: BASS_B,
      drums: D_LOFI_LIGHT,
      fill: D_LOFI_FILL
    },
    // ponte: respira. Sem bumbo constante, notas longas, termina em G7 (si → dó)
    {
      chords: ['Am7', 'Dm7', 'G7', 'CM7', 'Am7', 'Dm7', 'G7', 'G7'],
      lead: [
        'E5/6 -/2 C5/4 E5/2 -/2',
        'D5/4 F5/4 A4/6 -/2',
        'B4/4 D5/4 G5/4 -/4',
        'E5/8 -/4 G5/2 E5/2',
        'A4/4 C5/4 E5/4 G5/2 -/2',
        'F5/6 E5/2 D5/2 -/6',
        'D5/4 F5/2 D5/2 B4/6 -/2',
        '-/4 D5/4 B4/8'
      ],
      leadVel: 0.7,
      arp: ARP_PAD,
      arpLen: 14,
      arpVel: 0.3,
      bass: BASS_LONG,
      drums: D_BRIDGE
    },
    // A'': esparso, volta pra casa e deixa o loop respirar
    {
      chords: ['FM7', 'Em7', 'Dm7', 'CM7', 'FM7', 'Em7', 'Dm7', 'CM7'],
      lead: [
        'C5/4 A4/4 F5/4 -/4',
        'G5/6 -/4 E5/2 B4/4',
        'A4/4 D5/4 F5/4 -/4',
        'G5/4 E5/4 C5/6 -/2',
        '-/8 A4/4 C5/4',
        'E5/8 -/8',
        '-/4 F5/4 D5/8',
        'E5/4 -/4 C5/8'
      ],
      leadVel: 0.72,
      arp: ARP_SPARSE,
      arpLen: 3,
      arpVel: 0.4,
      bass: BASS_SOFT,
      drums: D_LOFI_LIGHT,
      drumsByBar: { 4: D_BRIDGE, 5: D_BRIDGE, 6: D_BRIDGE, 7: D_BRIDGE }
    }
  ]
)

// ----- tensão: Lá menor, 120 BPM. Am-F-Dm-E7 (V com sol sustenido) -----
const tensao = build(
  { id: 'tensao', bpm: 120, swing: 0, scale: PCS_A_MINOR_HARM, duty: { lead: 0.25, arp: 0.125 }, cutoff: 6500, gain: 1 },
  [
    // 2 compassos por acorde: harmonia lenta, ritmo nervoso
    {
      chords: ['Am7', 'Am7', 'FM7', 'FM7', 'Dm7', 'Dm7', 'E7', 'E7'],
      lead: [
        'A4/2 -/2 A4/2 C5/2 E5/6 -/2',
        'E5/2 -/2 E5/2 D5/2 C5/4 -/4',
        'F5/2 -/2 F5/2 E5/2 C5/6 -/2',
        'A4/2 C5/2 F5/4 C5/4 A4/4',
        'D5/2 -/2 D5/2 F5/2 A5/6 -/2',
        'F5/2 E5/2 D5/4 C5/2 D5/2 A4/4',
        'E5/2 -/2 E5/2 G#5/2 B5/6 -/2',
        'D5/2 -/2 B4/2 G#4/2 E5/8'
      ],
      leadVel: 0.78,
      arp: ARP_STAB_SPARSE,
      arpLen: 1,
      arpVel: 0.34,
      bass: BASS_DRIVE,
      drums: D_TENSE,
      fill: D_TENSE_FILL
    },
    // sobe a oitava e acelera; o último E7 deixa o loop pedindo Lá menor
    {
      chords: ['Am7', 'FM7', 'Dm7', 'E7', 'Am7', 'FM7', 'E7', 'E7'],
      lead: [
        'A5/2 E5/2 C5/2 E5/2 A5/2 E5/2 C5/2 E5/2',
        'A5/2 F5/2 C5/2 F5/2 A5/2 F5/2 C5/2 F5/2',
        'A5/2 F5/2 D5/2 F5/2 A5/2 F5/2 D5/2 F5/2',
        'B5/2 G#5/2 E5/2 G#5/2 B5/2 G#5/2 D5/2 G#5/2',
        'A5/4 -/2 E5/2 C5/4 -/2 A4/2',
        'F5/4 -/2 C5/2 A4/4 -/2 C5/2',
        'B5/4 -/2 G#5/2 E5/4 -/4',
        'D5/2 B4/2 G#4/2 B4/2 E5/8'
      ],
      leadVel: 0.74,
      arp: ARP_STAB,
      arpLen: 1,
      arpVel: 0.3,
      bass: BASS_SYNC,
      drums: D_TENSE_HARD,
      fill: D_TENSE_FILL
    }
  ]
)

// ----- vitória: Dó maior, 128 BPM. Fanfarra (8) + comemoração (8), toca uma vez -----
const vitoria = build(
  { id: 'vitoria', bpm: 128, swing: 0.1, once: true, next: 'calma', scale: PCS_C_MAJOR, duty: { lead: 0.5, arp: 0.125 }, cutoff: 7000, gain: 0.95 },
  [
    {
      chords: ['C', 'G', 'Am', 'F', 'C', 'F', 'G', 'C'],
      lead: [
        'C5/2 E5/2 G5/4 C6/4 -/2 G5/2',
        'B5/4 G5/4 D5/4 G5/4',
        'A5/2 -/2 E5/2 C5/2 E5/4 A5/4',
        'F5/4 A5/4 C6/6 -/2',
        'E5/2 G5/2 C6/4 G5/4 E5/2 -/2',
        'A5/2 C6/2 F6/4 C6/4 A5/2 -/2',
        'D5/2 G5/2 B5/4 D6/4 B5/2 G5/2',
        'G5/4 E5/4 C6/6 -/2'
      ],
      leadVel: 0.74,
      arp: ARP_SIXTEENTH,
      arpLen: 1,
      arpVel: 0.22,
      bass: BASS_BOUNCE,
      drums: D_WIN,
      drumsByBar: { 0: D_WIN_OPEN, 4: D_WIN_OPEN },
      fill: { ...D_WIN, snare: z([4, 0.6], [10, 0.4], [11, 0.5], [12, 0.65], [13, 0.5], [14, 0.8], [15, 0.9]) }
    },
    {
      chords: ['C', 'Am', 'F', 'G', 'C', 'F', 'G', 'C'],
      lead: [
        'E5/2 -/2 G5/2 E5/2 C5/2 -/2 E5/4',
        'A5/4 E5/2 C5/2 A4/4 -/4',
        'F5/2 A5/2 C6/2 A5/2 F5/4 -/4',
        'D5/4 G5/2 B5/2 D6/4 -/4',
        'G5/2 -/2 E5/2 G5/2 C6/4 G5/4',
        'C6/4 A5/4 F5/6 -/2',
        'B5/4 G5/4 D5/2 -/4 B4/2',
        'E5/4 G5/4 C6/6 -/2'
      ],
      leadVel: 0.62,
      arp: ARP_STAB,
      arpLen: 1,
      arpVel: 0.26,
      bass: BASS_PARTY,
      drums: D_WIN_PARTY,
      drumsByBar: { 7: D_WIN_END }
    }
  ]
)

// ----- tiroteio: Ré menor harmônico, 150 BPM. Dm7-BbM7-C7-A7 (dois compassos por acorde) -----
const PCS_D_MINOR_HARM = [2, 4, 5, 7, 9, 10, 1, 0] // ré menor + dó sustenido (A7) e dó natural (C7)
const tiroteio = build(
  { id: 'tiroteio', bpm: 150, swing: 0, scale: PCS_D_MINOR_HARM, duty: { lead: 0.25, arp: 0.125 }, cutoff: 7000, gain: 1 },
  [
    {
      chords: ['Dm7', 'Dm7', 'BbM7', 'BbM7', 'C7', 'C7', 'A7', 'A7'],
      lead: [
        'D5/2 -/2 D5/2 F5/2 A5/4 F5/2 D5/2',
        'F5/2 E5/2 D5/4 F5/4 A5/4',
        'A#4/2 D5/2 F5/4 A5/4 F5/2 D5/2',
        'D5/4 F5/2 A5/2 F5/4 D5/2 -/2',
        'G5/2 -/2 E5/2 G5/2 C6/4 G5/2 E5/2',
        'E5/2 G5/2 A#5/4 G5/2 E5/2 C5/4',
        'A5/2 -/2 E5/2 G5/2 C#6/4 A5/2 E5/2',
        'G5/2 E5/2 C#5/4 E5/2 G5/2 A5/4'
      ],
      leadVel: 0.78,
      arp: ARP_STAB_SPARSE,
      arpLen: 1,
      arpVel: 0.32,
      bass: BASS_DRIVE,
      drums: D_TENSE,
      fill: D_TENSE_FILL
    },
    {
      chords: ['Dm7', 'Dm7', 'BbM7', 'BbM7', 'C7', 'C7', 'A7', 'A7'],
      lead: [
        'A5/2 F5/2 D5/2 F5/2 A5/2 C6/2 D6/4',
        'C6/4 A5/2 F5/2 D5/4 F5/2 A5/2',
        'D6/4 A5/2 F5/2 D5/4 F5/4',
        'A#5/2 A5/2 F5/4 D5/4 -/4',
        'G5/2 C6/2 E6/4 C6/2 G5/2 E5/4',
        'A#5/4 G5/2 E5/2 G5/4 A#5/4',
        'E6/2 C#6/2 A5/4 G5/2 E5/2 C#5/4',
        'A5/4 -/2 E5/2 G5/4 A5/4'
      ],
      leadVel: 0.74,
      arp: ARP_STAB,
      arpLen: 1,
      arpVel: 0.28,
      bass: BASS_SYNC,
      drums: D_TENSE_HARD,
      fill: D_TENSE_FILL
    }
  ]
)

// ----- final: Mi menor harmônico, 176 BPM. Em7-CM7-Am7-B7, arpejo em semicolcheias, para o último minuto -----
const PCS_E_MINOR_HARM = [4, 6, 7, 9, 11, 0, 3, 2] // mi menor + ré sustenido (B7) e ré natural (Em7)
const final = build(
  { id: 'final', bpm: 176, swing: 0, scale: PCS_E_MINOR_HARM, duty: { lead: 0.25, arp: 0.125 }, cutoff: 7600, gain: 1 },
  [
    {
      chords: ['Em7', 'Em7', 'CM7', 'CM7', 'Am7', 'Am7', 'B7', 'B7'],
      lead: [
        'E5/2 B5/2 G5/2 B5/2 E5/2 B5/2 G5/2 B5/2',
        'E6/2 D6/2 B5/2 G5/2 B5/4 D6/4',
        'C6/2 G5/2 E5/2 G5/2 C6/2 G5/2 E5/2 G5/2',
        'B5/2 C6/2 E6/4 G5/2 E5/2 C5/4',
        'A5/2 E5/2 C5/2 E5/2 A5/2 E5/2 C5/2 E5/2',
        'A5/4 C6/2 E6/2 C6/4 A5/2 G5/2',
        'B5/2 F#5/2 D#5/2 F#5/2 B5/2 F#5/2 D#5/2 F#5/2',
        'D#6/4 B5/2 A5/2 F#5/4 D#5/2 B4/2'
      ],
      leadVel: 0.74,
      arp: ARP_SIXTEENTH,
      arpLen: 1,
      arpVel: 0.2,
      bass: BASS_BOUNCE,
      drums: D_TENSE_HARD,
      fill: D_TENSE_FILL
    },
    {
      chords: ['Em7', 'Em7', 'CM7', 'CM7', 'Am7', 'Am7', 'B7', 'B7'],
      lead: [
        'B5/2 G5/2 E5/2 G5/2 B5/2 E6/2 D6/2 B5/2',
        'E6/4 D6/2 B5/2 G5/4 B5/2 D6/2',
        'E6/2 C6/2 G5/2 C6/2 E6/2 C6/2 G5/2 B5/2',
        'E6/4 C6/2 B5/2 G5/4 E5/4',
        'C6/2 E6/2 A5/2 E6/2 C6/2 E6/2 A5/2 E5/2',
        'A5/4 G5/2 E5/2 C5/4 E5/4',
        'D#6/2 B5/2 F#5/2 B5/2 D#6/2 B5/2 F#5/2 A5/2',
        'B5/4 A5/2 F#5/2 D#5/4 -/4'
      ],
      leadVel: 0.72,
      arp: ARP_SIXTEENTH,
      arpLen: 1,
      arpVel: 0.22,
      bass: BASS_DRIVE,
      drums: D_TENSE_HARD,
      fill: D_TENSE_FILL
    }
  ]
)

// ----- cisnes: o tema do Lago dos Cisnes (Ato II), de si menor para lá menor, 96 BPM -----
// O oboé vira pulso 50%; o tremolo das cordas vira arpejo de semicolcheias. Forma A A' B A''.
const THEME = [
  'E5/8 A4/2 B4/2 C5/2 D5/2', // fá#———, si dó# ré mi (no original)
  'E5/5 -/1 C5/2 E5/5 -/1 C5/2',
  'E5/6 A4/2 C5/2 A4/2 F4/2 C5/2'
]
const cisnes = build(
  { id: 'cisnes', bpm: 96, swing: 0, rotate: 'calma', scale: PCS_A_MINOR_HARM, duty: { lead: 0.5, arp: 0.125 }, cutoff: 5200, gain: 0.95 },
  [
    // A: o tema sozinho sobre o tremolo, quase sem bateria
    {
      chords: ['Am', 'Am', 'FM7', 'Am'],
      lead: [...THEME, 'A4/12 -/4'],
      leadVel: 0.72,
      arp: ARP_SIXTEENTH,
      arpLen: 1,
      arpVel: 0.2,
      bass: BASS_LONG,
      drums: D_BRIDGE
    },
    // A': de novo, com bumbo e caixa; termina no mi para abrir a parte B
    {
      chords: ['Am', 'Am', 'FM7', 'Am'],
      lead: [...THEME, 'A4/8 -/4 E4/4'],
      leadVel: 0.78,
      arp: ARP_SIXTEENTH,
      arpLen: 1,
      arpVel: 0.24,
      bass: BASS_A,
      drums: D_LOFI_LIGHT
    },
    // B: sobe pela escala e cai no dominante (E7, com sol sustenido)
    {
      chords: ['Dm7', 'C', 'Dm7', 'E7'],
      lead: ['D5/2 E5/2 F5/2 G5/2 A5/6 -/2', 'G5/2 F5/2 E5/4 C5/4 A4/2 -/2', 'F5/2 E5/2 D5/4 A4/2 B4/2 C5/2 D5/2', 'E5/8 -/2 B4/2 G#4/4'],
      leadVel: 0.8,
      arp: ARP_SIXTEENTH,
      arpLen: 1,
      arpVel: 0.26,
      bass: BASS_B,
      drums: D_TENSE,
      fill: D_TENSE_FILL
    },
    // A'': o tema volta forte e fecha em lá
    {
      chords: ['Am', 'Am', 'FM7', 'Am'],
      lead: [...THEME, 'A4/12 -/4'],
      leadVel: 0.82,
      arp: ARP_SIXTEENTH,
      arpLen: 1,
      arpVel: 0.26,
      bass: BASS_A,
      drums: D_LOFI_LIGHT,
      fill: D_WIN_END
    }
  ]
)

export const TRACKS: Record<MusicTrack, TrackDef> = { calma, cisnes, tensao, vitoria, tiroteio, final }

// ---------------- derivados ----------------

export function stepSeconds(t: Pick<TrackDef, 'bpm'>): number {
  return 60 / t.bpm / 4
}
export function barSeconds(t: Pick<TrackDef, 'bpm'>): number {
  return stepSeconds(t) * STEPS_PER_BAR
}
export function trackSeconds(t: TrackDef): number {
  return barSeconds(t) * t.bars
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
export function midiToName(m: number): string {
  return `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`
}

/** "Partitura" em texto: um compasso por linha, com acorde e melodia. */
export function scoreText(t: TrackDef): string {
  const lines = [`${t.id}: ${t.bpm} BPM, ${t.bars} compassos, ${trackSeconds(t).toFixed(1)} s${t.once ? ' (uma vez)' : ' (loop)'}`]
  for (let b = 0; b < t.bars; b++) {
    const notes = parseBar(t.leadText[b]!).map((n) => `${midiToName(n.midi)}@${n.start}/${n.steps}`)
    lines.push(`${String(b + 1).padStart(2)} ${t.chords[b]!.name.padEnd(5)} ${notes.join(' ')}`)
  }
  return lines.join('\n')
}
