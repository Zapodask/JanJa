import { iconSvg, POSES } from './ui/pixelData'

/** Quadro parado do favicon (o L), usado também em public/favicon.svg. */
export const FAVICON_STILL = 0

const toUrl = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`

/**
 * Favicon animado: Jan fazendo o L. Navegadores não animam SVG/GIF na aba (só o Firefox anima GIF),
 * então trocamos o href do <link rel="icon"> a cada passo da pose `ell`.
 * Com "reduzir movimento" fica parado no L. Em aba de fundo o navegador desacelera o timer (~1 Hz).
 */
export function animateFavicon(): void {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (!link) return
  const { frames, seq, ms } = POSES.ell
  const urls = frames.map((f) => toUrl(iconSvg(f)))
  link.type = 'image/svg+xml'
  const reduce = matchMedia('(prefers-reduced-motion: reduce)')
  let step = 0
  let timer: number | undefined
  const tick = () => {
    link.href = urls[seq[step]]
    step = (step + 1) % seq.length
  }
  const apply = () => {
    clearInterval(timer)
    timer = undefined
    if (reduce.matches) link.href = urls[FAVICON_STILL]
    else timer = window.setInterval(tick, ms)
  }
  reduce.addEventListener('change', apply)
  apply()
}
