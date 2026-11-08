/** Barramento minúsculo de efeitos do tiro: a cena emite (nome, volume, pan) e o GameAudioDriver toca. Sem React. */
export interface ShooterSfxOpts {
  volume?: number
  pan?: number
}

export interface SfxBus {
  emit(name: string, opts?: ShooterSfxOpts): void
  subscribe(cb: (name: string, opts?: ShooterSfxOpts) => void): () => void
}

export function createSfxBus(): SfxBus {
  const subs = new Set<(name: string, opts?: ShooterSfxOpts) => void>()
  return {
    emit(name, opts) {
      for (const cb of subs) cb(name, opts)
    },
    subscribe(cb) {
      subs.add(cb)
      return () => subs.delete(cb)
    }
  }
}

/** intervalo mínimo entre dois efeitos iguais (ms): rajada de submetralhadora e passos não viram ruído */
export const SFX_MIN_GAP_MS: Record<string, number> = {
  'tiro-sub': 45,
  passo: 90,
  hitmarker: 40,
  dano: 70,
  'tiro-pistola': 30,
  'tiro-escopeta': 40,
  explosao: 60
}
export const SFX_DEFAULT_GAP_MS = 25

/** devolve true se o efeito pode tocar agora (e marca o instante) */
export function sfxGate(last: Map<string, number>, name: string, now: number): boolean {
  const gap = SFX_MIN_GAP_MS[name] ?? SFX_DEFAULT_GAP_MS
  const prev = last.get(name)
  if (prev !== undefined && now - prev < gap) return false
  last.set(name, now)
  return true
}

/** música do tiro: partida rolando, último minuto e fim */
export function shooterTrack(phase: 'aquecendo' | 'jogando' | 'fim', timeLeftMs: number): 'tiroteio' | 'final' | 'vitoria' {
  if (phase === 'fim') return 'vitoria'
  if (phase === 'jogando' && timeLeftMs <= 60_000) return 'final'
  return 'tiroteio'
}

/** cor dos robôs (o humano usa a cor do apelido) */
export const BOT_TONES = ['#7E9CB5', '#C27C8E', '#8FAE6B', '#D4A373']
