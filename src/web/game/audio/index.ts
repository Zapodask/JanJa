/**
 * Áudio do jogo: música chiptune (faixas originais e o Lago dos Cisnes em 8 bits) e efeitos, 100% Web Audio.
 * Uso: const audio = createGameAudio(); (depois de um gesto) audio.startMusic('calma').
 */
import { getContext } from '../../audio'
import type { GameAudio, MusicTrack, SfxName } from '../contract'
import { Engine } from './engine'
import { Sequencer } from './sequencer'

export const DEFAULT_MUSIC_VOLUME = 0.35
const TICK_MS = 25

const silent: GameAudio = {
  startMusic: () => undefined,
  stopMusic: () => undefined,
  setTrack: () => undefined,
  setMusicVolume: () => undefined,
  setDuck: () => undefined,
  sfx: () => undefined,
  dispose: () => undefined
}

export function createGameAudio(ctxArg?: AudioContext): GameAudio {
  let engine: Engine | undefined
  let seq: Sequencer | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let stopTimer: ReturnType<typeof setTimeout> | undefined
  let volume = DEFAULT_MUSIC_VOLUME
  let duck = 0
  let last: MusicTrack = 'calma'
  let disposed = false

  const ensure = (): Engine | undefined => {
    if (disposed) return undefined
    if (!engine) {
      const ctx = ctxArg ?? getContext()
      if (!ctx || ctx.state === 'closed') return undefined
      engine = new Engine(ctx, volume, duck)
      seq = new Sequencer(engine)
    }
    if (engine.ctx.state === 'suspended') void engine.ctx.resume().catch(() => undefined)
    return engine
  }

  if (typeof AudioContext === 'undefined' && !ctxArg) return silent

  return {
    startMusic(track) {
      const e = ensure()
      if (!e || !seq) return
      if (stopTimer) clearTimeout(stopTimer)
      stopTimer = undefined
      const t = track ?? last
      if (seq.running) {
        seq.setTrack(t)
      } else {
        seq.start(t)
      }
      last = t
      timer ??= setInterval(() => seq?.tick(), TICK_MS)
      seq.tick()
    },
    stopMusic() {
      if (!seq?.running) return
      seq.stop(0.4)
      stopTimer = setTimeout(() => {
        if (timer && !seq?.running) clearInterval(timer)
        timer = undefined
      }, 500)
    },
    setTrack(track) {
      last = track
      seq?.setTrack(track)
    },
    setMusicVolume(v) {
      volume = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0))
      engine?.setVolume(volume)
    },
    setDuck(level) {
      const l = Math.min(1, Math.max(0, Number.isFinite(level) ? level : 0))
      if (Math.abs(l - duck) < 0.02 && l !== 0 && duck !== 0) return
      duck = l
      engine?.setDuck(l)
    },
    sfx(name: SfxName, opts) {
      ensure()?.sfx(name, opts?.count, opts)
    },
    dispose() {
      disposed = true
      if (timer) clearInterval(timer)
      if (stopTimer) clearTimeout(stopTimer)
      timer = stopTimer = undefined
      seq?.stop(0.05)
      engine?.dispose()
      engine = seq = undefined
    }
  }
}

export type { GameAudio, MusicTrack, SfxName } from '../contract'
