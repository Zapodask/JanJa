/**
 * Lugares na mesa do truco, em frações do palco (0..1). Você fica embaixo; os outros seguem
 * no sentido anti-horário (embaixo, direita, em cima, esquerda), como na mesa de verdade.
 */
export interface Spot {
  x: number
  y: number
}

/** lugar da placa de quem está `k` cadeiras depois de você, numa mesa de `n` */
export function seatSpot(k: number, n: number): Spot {
  const a = (2 * Math.PI * k) / n
  return { x: 0.5 + 0.42 * Math.sin(a), y: 0.5 + 0.38 * Math.cos(a) }
}

/** onde ficam as cartas jogadas por essa pessoa: entre a placa e o centro */
export function playSpot(k: number, n: number): Spot {
  const s = seatSpot(k, n)
  const t = k === 0 ? 0.42 : 0.5
  return { x: s.x + (0.5 - s.x) * t, y: s.y + (0.5 - s.y) * t }
}
