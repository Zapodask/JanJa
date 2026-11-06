import type { Monitor } from '../../shared/control'

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

/** Retângulo REAL da imagem dentro de um elemento com object-fit: contain (sem as tarjas pretas). */
export function containRect(box: Rect, videoW: number, videoH: number): Rect {
  if (!(videoW > 0) || !(videoH > 0) || !(box.width > 0) || !(box.height > 0)) return { ...box }
  const scale = Math.min(box.width / videoW, box.height / videoH)
  const width = videoW * scale
  const height = videoH * scale
  return { left: box.left + (box.width - width) / 2, top: box.top + (box.height - height) / 2, width, height }
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n)

/** Ponto da tela (clientX/Y) para 0..1 relativo à imagem, ignorando tarjas; fora da imagem fica na borda. */
export function toNormalized(
  clientX: number,
  clientY: number,
  box: Rect,
  videoW: number,
  videoH: number
): { x: number; y: number } | null {
  if (!(videoW > 0) || !(videoH > 0)) return null
  const r = containRect(box, videoW, videoH)
  if (!(r.width > 0) || !(r.height > 0)) return null
  return { x: clamp01((clientX - r.left) / r.width), y: clamp01((clientY - r.top) / r.height) }
}

/** deltaY do navegador para "notches" (-10..10). Rolagem pequena não some: vira 1 notch. */
export function wheelNotches(delta: number, deltaMode = 0): number {
  if (!delta || !Number.isFinite(delta)) return 0
  const px = deltaMode === 1 ? delta * 40 : deltaMode === 2 ? delta * 800 : delta
  let n = Math.round(px / 100)
  if (n === 0) n = px > 0 ? 1 : -1
  return Math.max(-10, Math.min(10, n))
}

export interface MonitorPick {
  /** id do monitor sugerido (undefined = sem helper pronto / lista vazia) */
  monitor?: number
  /** vários monitores e nenhum bateu: a pessoa escolhe */
  needsChoice: boolean
}

/**
 * Qual monitor está sendo compartilhado? Tamanho igual ao do vídeo capturado; como o navegador
 * pode reduzir a captura (ex. 1440p para 1080p), aceita também a mesma proporção quando só um bate.
 * Sem correspondência: o primário, e a pessoa escolhe se houver mais de um.
 */
export function pickMonitor(monitors: Monitor[], videoW?: number, videoH?: number): MonitorPick {
  if (monitors.length === 0) return { needsChoice: false }
  const primary = monitors.find((m) => m.primary) ?? monitors[0]
  if (monitors.length === 1) return { monitor: monitors[0].id, needsChoice: false }
  if (videoW && videoH) {
    const exact = monitors.filter((m) => m.w === videoW && m.h === videoH)
    if (exact.length === 1) return { monitor: exact[0].id, needsChoice: false }
    if (exact.length > 1) return { monitor: (exact.find((m) => m.primary) ?? exact[0]).id, needsChoice: true }
    const ratio = videoW / videoH
    const alike = monitors.filter((m) => Math.abs(m.w / m.h - ratio) / ratio < 0.005)
    if (alike.length === 1) return { monitor: alike[0].id, needsChoice: false }
  }
  return { monitor: primary.id, needsChoice: true }
}
