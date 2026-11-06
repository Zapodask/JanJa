import { driver, type DriveStep, type Driver } from 'driver.js'
import 'driver.js/dist/driver.css'
import { setPrefs } from '../storage'
import { POSES, spriteToSvg } from './pixelData'
import { filterSteps, TOUR_VERSION, type TourStep } from './tourLogic'

interface Running {
  d: Driver
  silent: boolean
}
let current: Running | null = null

export const tourActive = (): boolean => current !== null

/** Encerra o tour. `silent` = não grava que a pessoa já viu (ex.: saiu da tela). */
export function stopTour(silent = true): void {
  if (!current) return
  current.silent = silent
  current.d.destroy()
}

function toDriveStep(s: TourStep): DriveStep {
  const description = s.jan
    ? `<div class="tour-jan">${spriteToSvg(POSES.idle.frames[0], 3)}<p>${s.text}</p></div>`
    : s.text
  return {
    element: s.selector,
    popover: { title: s.title, description, side: s.side, align: 'center' }
  }
}

/**
 * Roda o tour. Pular, fechar, Esc e Concluir gravam a versão vista; `onEnd` roda em qualquer
 * saída (inclusive silenciosa), para quem precisa restaurar algo (a barra lateral).
 */
export function startTour(kind: 'room' | 'home', steps: TourStep[], onEnd?: () => void): void {
  stopTour(true)
  const live = filterSteps(steps, (sel) => !!document.querySelector(sel))
  if (!live.length) {
    onEnd?.()
    return
  }
  const run: Running = { d: undefined as unknown as Driver, silent: false }
  run.d = driver({
    steps: live.map(toDriveStep),
    popoverClass: 'janja-tour',
    overlayColor: '#0F0B09',
    overlayOpacity: 0.72,
    stagePadding: 6,
    stageRadius: 6,
    animate: !matchMedia('(prefers-reduced-motion: reduce)').matches,
    smoothScroll: false,
    disableActiveInteraction: true,
    showProgress: true,
    progressText: '{{current}} de {{total}}',
    nextBtnText: 'Próximo',
    prevBtnText: 'Voltar',
    doneBtnText: 'Concluir',
    closeBtnLabel: 'Fechar',
    showButtons: ['next', 'previous', 'close'],
    onPopoverRender: (pop) => {
      if (pop.footer.querySelector('.janja-skip')) return
      const skip = document.createElement('button')
      skip.type = 'button'
      skip.className = 'janja-skip'
      skip.textContent = 'Pular tour'
      skip.addEventListener('click', () => run.d.destroy())
      pop.footer.prepend(skip)
    },
    onDestroyed: () => {
      if (current === run) current = null
      if (!run.silent) setPrefs(kind === 'room' ? { tourDone: TOUR_VERSION } : { homeTourDone: TOUR_VERSION })
      onEnd?.()
    }
  })
  current = run
  run.d.drive()
}
