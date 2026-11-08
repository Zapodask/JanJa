/**
 * Qualidade automática da tela: sobe quando sobra banda, desce quando há perda,
 * upload no limite ou CPU no limite. Tudo puro: o tempo entra por parâmetro.
 */
import type { Limitation } from './stats'
import type { QualityPreset } from './quality'

export interface AutoLevel {
  id: string
  label: string
  width: number
  height: number
  fps: number
  bitrate: number
}

export const AUTO_LADDER: AutoLevel[] = [
  { id: '480p30', label: '480p 30', width: 854, height: 480, fps: 30, bitrate: 1_200_000 },
  { id: '720p30', label: '720p 30', width: 1280, height: 720, fps: 30, bitrate: 2_500_000 },
  { id: '1080p30', label: '1080p 30', width: 1920, height: 1080, fps: 30, bitrate: 5_000_000 },
  { id: '1080p60', label: '1080p 60', width: 1920, height: 1080, fps: 60, bitrate: 9_000_000 },
  { id: '1440p60', label: '1440p 60', width: 2560, height: 1440, fps: 60, bitrate: 14_000_000 }
]

/** Nível inicial: 1080p 30. */
export const AUTO_START = 2

/** Preset efetivo (usado por applyQuality, bitrate e codecs) montado de um nível da escada. */
export function autoLevelPreset(level: number): QualityPreset {
  const l = AUTO_LADDER[clamp(level, 0, AUTO_LADDER.length - 1)]
  return { id: 'auto', label: l.label, width: l.width, height: l.height, fps: l.fps, bitrate: l.bitrate, hint: 'motion' }
}

export interface AutoSample {
  availableKbps?: number
  lossPct?: number
  limitation: Limitation
  fps?: number
  kbps?: number
}

export type AutoReason = 'folga' | 'perda' | 'banda' | 'cpu' | 'fps'

export interface AutoDecision {
  level: number
  changed: boolean
  dir?: 'up' | 'down'
  reason?: AutoReason
}

const BAD_LOSS = 5
const GOOD_LOSS = 1
const BAD_TICKS = 2
const GOOD_TICKS = 5
/** depois de começar ou mudar de nível, a estimativa de banda ainda está subindo: banda e fps só contam passado isso */
const LEVEL_GRACE_MS = 10_000
const FPS_RATIO = 0.6
const BAND_BAD = 0.75
const BAND_GOOD = 0.85
const BACKOFF_START = 20_000
const BACKOFF_MAX = 160_000
const PINGPONG_MS = 30_000
const STABLE_MS = 120_000

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

const DOWN_PRIORITY: AutoReason[] = ['cpu', 'perda', 'banda', 'fps']

export class AutoQuality {
  private lvl: number
  private max: number
  private badTicks = 0
  private goodTicks = 0
  private badReasons = new Set<AutoReason>()
  private blockedUntil = 0
  private backoff = BACKOFF_START
  private levelSince?: number
  private lastUpAt?: number

  constructor(opts: { start?: number; maxLevel?: number } = {}) {
    this.max = clamp(opts.maxLevel ?? AUTO_LADDER.length - 1, 0, AUTO_LADDER.length - 1)
    this.lvl = clamp(opts.start ?? AUTO_START, 0, this.max)
  }

  get level(): number {
    return this.lvl
  }

  setMaxLevel(max: number): void {
    this.max = clamp(max, 0, AUTO_LADDER.length - 1)
    if (this.lvl > this.max) {
      this.lvl = this.max
      this.clearCounters()
      this.levelSince = undefined
    }
  }

  reset(level: number = AUTO_START): void {
    this.lvl = clamp(level, 0, this.max)
    this.clearCounters()
    this.blockedUntil = 0
    this.backoff = BACKOFF_START
    this.levelSince = undefined
    this.lastUpAt = undefined
  }

  private clearCounters(): void {
    this.badTicks = 0
    this.goodTicks = 0
    this.badReasons.clear()
  }

  /** Uma leitura a cada ~2 s. `capKbps` = teto de bitrate por conexão configurado agora. */
  tick(samples: AutoSample[], now: number, capKbps: number): AutoDecision {
    const stay: AutoDecision = { level: this.lvl, changed: false }
    this.levelSince ??= now
    if (samples.length === 0) return stay

    // estável por 120 s no mesmo nível: esquece o castigo
    if (now - this.levelSince >= STABLE_MS) this.backoff = BACKOFF_START

    const levelFps = AUTO_LADDER[this.lvl].fps
    const settled = now - this.levelSince >= LEVEL_GRACE_MS
    const reasons = new Set<AutoReason>()
    let allGood = true
    for (const s of samples) {
      // tela parada manda poucos quadros de propósito, e 'bandwidth' já tem regra própria:
      // fps baixo só conta quando o navegador culpa o processador (ou outro motivo)
      const fpsLow = settled && s.fps !== undefined && s.fps < FPS_RATIO * levelFps && (s.limitation === 'cpu' || s.limitation === 'other')
      if (s.limitation === 'cpu') reasons.add('cpu')
      if (s.lossPct !== undefined && s.lossPct >= BAD_LOSS) reasons.add('perda')
      if (settled && s.limitation === 'bandwidth' && s.availableKbps !== undefined && s.availableKbps < BAND_BAD * capKbps) reasons.add('banda')
      if (fpsLow) reasons.add('fps')

      const loss = s.lossPct ?? 0
      // sem estimativa de banda (Firefox): só vale como folga se o enlace carregou o teto inteiro
      const linkHolds =
        s.availableKbps !== undefined ? s.availableKbps >= BAND_GOOD * capKbps : s.kbps !== undefined && s.kbps >= 0.9 * capKbps
      if (!(loss < GOOD_LOSS && s.limitation === 'none' && linkHolds && !fpsLow)) allGood = false
    }

    if (reasons.size > 0) {
      this.goodTicks = 0
      this.badTicks++
      for (const r of reasons) this.badReasons.add(r)
      if (this.badTicks >= BAD_TICKS && this.lvl > 0) {
        const reason = DOWN_PRIORITY.find((r) => this.badReasons.has(r)) ?? 'perda'
        // desceu logo depois de uma subida: a subida não se sustentou
        if (this.lastUpAt !== undefined && now - this.lastUpAt <= PINGPONG_MS) this.backoff = Math.min(this.backoff * 2, BACKOFF_MAX)
        this.blockedUntil = now + this.backoff
        this.lvl--
        this.levelSince = now
        this.clearCounters()
        return { level: this.lvl, changed: true, dir: 'down', reason }
      }
      return stay
    }

    this.badTicks = 0
    this.badReasons.clear()
    if (!allGood) {
      this.goodTicks = 0
      return stay
    }
    this.goodTicks++
    if (this.goodTicks >= GOOD_TICKS && now >= this.blockedUntil && this.lvl < this.max) {
      this.lvl++
      this.levelSince = now
      this.lastUpAt = now
      this.clearCounters()
      return { level: this.lvl, changed: true, dir: 'up', reason: 'folga' }
    }
    return stay
  }
}
