/**
 * Sequenciador: puro (sem Web Audio). Agenda notas com lookahead e troca de faixa no compasso,
 * com crossfade de 1 compasso. Quem toca de verdade é o `SeqHost`.
 */
import type { MusicTrack } from '../contract'
import { STEPS_PER_BAR, TRACKS, barSeconds, stepSeconds, type StepNote, type TrackDef } from './songs'

export interface SeqHost {
  now(): number
  /** quanto à frente agendar (s) */
  lookahead(): number
  /** agenda uma nota da camada */
  note(layer: number, track: TrackDef, ev: StepNote, when: number, dur: number): void
  /** rampa linear do ganho da camada */
  fade(layer: number, from: number, to: number, start: number, end: number): void
  /** a camada acabou: pode soltar os nós depois de `at` */
  release(layer: number, at: number): void
  /** a faixa ativa mudou (início real da nova faixa) */
  changed?(track: MusicTrack, at: number): void
}

interface Layer {
  id: number
  track: TrackDef
  /** instante do passo 0 da volta atual */
  startTime: number
  cursor: number
  /** a partir daqui não agenda mais (camada em fade-out) */
  stopAt?: number
  done: boolean
}

const START_DELAY = 0.06
const LATE_TOLERANCE = 0.04

export function stepTime(l: Pick<Layer, 'track' | 'startTime'>, idx: number): number {
  const sd = stepSeconds(l.track)
  return l.startTime + idx * sd + (idx % 2 === 1 ? l.track.swing * sd : 0)
}

/** duração tocada de uma nota (s) */
export function noteSeconds(track: TrackDef, ev: StepNote): number {
  const sd = stepSeconds(track)
  if (ev.ch === 'lead') return ev.steps * sd * 0.92
  if (ev.ch === 'arp') return ev.steps * sd * 0.85
  if (ev.ch === 'bass') return ev.steps * sd * 0.95
  return ev.steps * sd
}

export class Sequencer {
  private layers: Layer[] = []
  private active: Layer | undefined
  private pending: MusicTrack | undefined
  private nextId = 1
  running = false

  constructor(
    private host: SeqHost,
    private tracks: Record<MusicTrack, TrackDef> = TRACKS
  ) {}

  get current(): MusicTrack | undefined {
    return this.active?.track.id
  }
  get queued(): MusicTrack | undefined {
    return this.pending
  }

  start(id: MusicTrack, fadeIn = 0.3): void {
    this.stopNow()
    const now = this.host.now()
    const layer = this.addLayer(id, now + START_DELAY)
    this.host.fade(layer.id, 0, 1, layer.startTime, layer.startTime + fadeIn)
    this.running = true
    this.host.changed?.(id, layer.startTime)
  }

  /**
   * Troca no próximo compasso (a camada atual segue 1 compasso em fade-out).
   * Pedir uma música de fundo (calma) enquanto outra do revezamento toca (cisnes) não troca:
   * os jogos pedem a calma a cada rodada e o revezamento seguiria interrompido.
   */
  setTrack(id: MusicTrack): void {
    if (!this.running || !this.active) return
    const cur = this.active.track
    const bothBackground = cur.rotate !== undefined && this.tracks[id].rotate !== undefined
    this.pending = id === cur.id || bothBackground ? undefined : id
  }

  stop(fadeOut = 0.4): void {
    if (!this.running) return
    const now = this.host.now()
    for (const l of this.layers) {
      if (l.done) continue
      this.host.fade(l.id, 1, 0, now, now + fadeOut)
      l.stopAt = now + fadeOut
      l.done = true
      this.host.release(l.id, now + fadeOut)
    }
    this.layers = []
    this.active = undefined
    this.pending = undefined
    this.running = false
  }

  private stopNow(): void {
    this.stop(0.05)
  }

  private addLayer(id: MusicTrack, startTime: number): Layer {
    const layer: Layer = { id: this.nextId++, track: this.tracks[id], startTime, cursor: 0, done: false }
    this.layers.push(layer)
    this.active = layer
    return layer
  }

  /** troca para `id` exatamente em `t` (limite de compasso) */
  private switchAt(id: MusicTrack, t: number, from: Layer): void {
    const old = from
    const bar = barSeconds(old.track)
    if (!old.done && (old.cursor < old.track.steps.length)) {
      // fade-out de 1 compasso, a camada segue tocando até lá
      this.host.fade(old.id, 1, 0, t, t + bar)
      old.stopAt = t + bar
    } else {
      old.stopAt = t
    }
    const layer = this.addLayer(id, t)
    this.host.fade(layer.id, 0, 1, t, t + barSeconds(layer.track))
    this.pending = undefined
    this.host.changed?.(id, t)
  }

  /** chamar a cada ~25 ms */
  tick(): void {
    if (!this.running) return
    const now = this.host.now()
    const horizon = now + this.host.lookahead()
    // laço por índice: switchAt acrescenta camadas durante a varredura
    for (let i = 0; i < this.layers.length; i++) {
      const l = this.layers[i]!
      if (l.done) continue
      const n = l.track.steps.length
      for (;;) {
        // fim de uma faixa que toca uma vez (ou que reveza): segue para a próxima no instante exato
        const after = l.track.once ? (l.track.next ?? 'calma') : l.track.rotate
        if (l.cursor >= n && after) {
          const tEnd = l.startTime + n * stepSeconds(l.track)
          if (tEnd >= horizon) break
          if (l === this.active) this.switchAt(after, tEnd, l)
          l.done = true
          this.host.release(l.id, tEnd + 0.5)
          break
        }
        if (l.cursor >= n) {
          l.cursor = 0
          l.startTime += n * stepSeconds(l.track)
        }
        const t = stepTime(l, l.cursor)
        if (t >= horizon) break
        if (l.stopAt !== undefined && t >= l.stopAt) {
          l.done = true
          this.host.release(l.id, l.stopAt + 0.3)
          break
        }
        // troca pedida: vale no primeiro início de compasso ainda não agendado da camada ativa
        if (l === this.active && this.pending && l.cursor % STEPS_PER_BAR === 0 && t >= now) {
          this.switchAt(this.pending, t, l)
          // a camada nova (no fim do vetor) é varrida em seguida; esta segue em fade-out
        }
        if (l.stopAt === undefined || t < l.stopAt) {
          if (t >= now - LATE_TOLERANCE) {
            for (const ev of l.track.steps[l.cursor]!) this.host.note(l.id, l.track, ev, Math.max(t, now), noteSeconds(l.track, ev))
          }
        }
        l.cursor++
      }
    }
    this.layers = this.layers.filter((l) => !l.done)
  }
}
