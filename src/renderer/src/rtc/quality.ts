export interface QualityPreset {
  id: string
  label: string
  width: number
  height: number
  fps: number
  /** bitrate alvo para 1 espectador, em bps */
  bitrate: number
  hint: 'detail' | 'motion'
}

export const PRESETS: QualityPreset[] = [
  { id: 'texto', label: 'Texto e código (1080p, 15 fps)', width: 1920, height: 1080, fps: 15, bitrate: 3_000_000, hint: 'detail' },
  { id: 'equilibrado', label: 'Equilibrado (720p, 30 fps)', width: 1280, height: 720, fps: 30, bitrate: 2_500_000, hint: 'motion' },
  { id: 'jogo', label: 'Jogo e vídeo (1080p, 30 fps)', width: 1920, height: 1080, fps: 30, bitrate: 4_500_000, hint: 'motion' },
  { id: 'jogo60', label: 'Jogo fluido (1080p, 60 fps)', width: 1920, height: 1080, fps: 60, bitrate: 6_000_000, hint: 'motion' }
]

export const DEFAULT_PRESET = PRESETS[1]

export function presetById(id: string): QualityPreset {
  return PRESETS.find((p) => p.id === id) ?? DEFAULT_PRESET
}

/**
 * Em mesh, a tela sai uma vez por espectador: o upload total cresce com a sala.
 * Reduz o bitrate por conexão conforme o número de espectadores.
 */
export function bitrateFor(preset: QualityPreset, viewers: number): number {
  const factor = viewers <= 1 ? 1 : viewers === 2 ? 0.8 : viewers === 3 ? 0.65 : 0.5
  return Math.round(preset.bitrate * factor)
}

export function uploadEstimateMbps(preset: QualityPreset, viewers: number): number {
  return (bitrateFor(preset, viewers) * Math.max(viewers, 1)) / 1_000_000
}
