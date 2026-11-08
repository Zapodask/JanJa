/**
 * Câmera do Tiro na Sala (pura, sem Pixi). A cena é desenhada num quadro interno de 480x270 pixels do mundo e o
 * navegador amplia por um número inteiro (nitidez de pixel). Telas pequenas (celular) usam um quadro interno
 * menor, com escala 1, em vez de uma escala quebrada.
 */
export const BASE_W = 480
export const BASE_H = 270
/** o quadro interno pode crescer até aqui (telas largas ou altas veem um pouco mais) */
export const MAX_VIEW_W = 560
export const MAX_VIEW_H = 560
export const MIN_VIEW = 160
/** quanto a câmera avança na direção da mira (px do mundo) */
export const LOOK_AHEAD = 30
/** a câmera alcança o alvo (meia-vida em ms) */
export const CAM_HALF_LIFE_MS = 90

export interface ViewSize {
  /** ampliação inteira do quadro interno na tela */
  scale: number
  /** tamanho do quadro interno (px do mundo) */
  viewW: number
  viewH: number
  /** tamanho do canvas na tela (px CSS) = view * scale */
  cssW: number
  cssH: number
  /** onde o canvas fica dentro do palco (sobras viram tarja) */
  offX: number
  offY: number
}

export function computeView(hostW: number, hostH: number): ViewSize {
  const w = Math.max(1, Math.floor(hostW))
  const h = Math.max(1, Math.floor(hostH))
  // escala inteira que deixa o quadro interno mais perto de 480x270; o quadro cresce ou encolhe
  // para encher o palco (sem tarja grande quando o palco é pequeno, nunca escala quebrada)
  const scale = Math.max(1, Math.round(Math.min(w / BASE_W, h / BASE_H)))
  const viewW = Math.max(MIN_VIEW, Math.min(MAX_VIEW_W, Math.floor(w / scale)))
  const viewH = Math.max(MIN_VIEW, Math.min(MAX_VIEW_H, Math.floor(h / scale)))
  const cssW = viewW * scale
  const cssH = viewH * scale
  return { scale, viewW, viewH, cssW, cssH, offX: Math.floor((w - cssW) / 2), offY: Math.floor((h - cssH) / 2) }
}

export interface Cam {
  /** canto de cima à esquerda, em px do mundo */
  x: number
  y: number
}

/** Onde a câmera quer estar: jogador + avanço na mira, preso aos limites do mapa (mapa menor que a tela fica centralizado). */
export function cameraTarget(
  px: number,
  py: number,
  ax: number,
  ay: number,
  viewW: number,
  viewH: number,
  mapW: number,
  mapH: number,
  look = LOOK_AHEAD
): Cam {
  const len = Math.hypot(ax, ay)
  const lx = len > 0 ? (ax / len) * look : 0
  const ly = len > 0 ? (ay / len) * look : 0
  const clamp = (v: number, size: number, map: number) => (map <= size ? (map - size) / 2 : Math.max(0, Math.min(map - size, v)))
  return { x: clamp(px + lx - viewW / 2, viewW, mapW), y: clamp(py + ly - viewH / 2, viewH, mapH) }
}

/** Passo suave até o alvo, independente da taxa de quadros. Longe demais: pula. */
export function stepCamera(cur: Cam, target: Cam, dtMs: number, halfLifeMs = CAM_HALF_LIFE_MS): Cam {
  const dx = target.x - cur.x
  const dy = target.y - cur.y
  if (Math.hypot(dx, dy) > 260) return { x: target.x, y: target.y }
  const k = 1 - Math.pow(0.5, Math.max(0, dtMs) / halfLifeMs)
  return { x: cur.x + dx * k, y: cur.y + dy * k }
}

/** posição de tela (px do quadro interno) de um ponto do mundo */
export function worldToView(wx: number, wy: number, cam: Cam): { x: number; y: number } {
  return { x: wx - cam.x, y: wy - cam.y }
}

/**
 * Ponto do mundo sob o ponteiro. `cssX/cssY` em relação ao canto do palco (mesmo referencial de ViewSize.offX/offY).
 */
export function screenToWorld(cssX: number, cssY: number, cam: Cam, view: Pick<ViewSize, 'scale' | 'offX' | 'offY'>): { x: number; y: number } {
  return { x: (cssX - view.offX) / view.scale + cam.x, y: (cssY - view.offY) / view.scale + cam.y }
}

/** Tremida sem Math.random (determinística por semente), em pixels inteiros. */
export function shakeOffset(mag: number, seed: number): { x: number; y: number } {
  if (mag <= 0.01) return { x: 0, y: 0 }
  const h = (n: number) => {
    const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453
    return s - Math.floor(s)
  }
  const m = Math.max(1, Math.round(mag))
  return { x: Math.round((h(seed) * 2 - 1) * m), y: Math.round((h(seed + 7.3) * 2 - 1) * m) }
}
