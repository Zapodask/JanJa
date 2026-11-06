import { describe, expect, it } from 'vitest'
import { filterSteps, HOME_STEPS, ROOM_STEPS, shouldShowTour, TOUR_VERSION } from '../src/web/ui/tourLogic'

describe('tour: quando mostrar', () => {
  it('mostra se nunca viu', () => {
    expect(shouldShowTour(0)).toBe(true)
    expect(shouldShowTour(undefined)).toBe(true)
  })
  it('não mostra se já viu esta versão', () => {
    expect(shouldShowTour(TOUR_VERSION)).toBe(false)
  })
  it('mostra de novo se a versão subiu', () => {
    expect(shouldShowTour(1, 2)).toBe(true)
    expect(shouldShowTour(2, 2)).toBe(false)
  })
})

describe('tour: filtragem dos passos', () => {
  it('mantém passos sem elemento (boas-vindas e fim)', () => {
    const out = filterSteps(ROOM_STEPS, () => false)
    expect(out.map((s) => s.id)).toEqual(['welcome', 'done'])
  })
  it('tira passos cujo elemento não existe', () => {
    const present = new Set(['[data-tour="mic"]', '[data-tour="stage"]'])
    const out = filterSteps(ROOM_STEPS, (sel) => present.has(sel))
    expect(out.map((s) => s.id)).toEqual(['welcome', 'mic', 'stage', 'done'])
  })
  it('Home sem salas recentes tem 2 passos', () => {
    const out = filterSteps(HOME_STEPS, (sel) => !sel.includes('recents'))
    expect(out).toHaveLength(2)
  })
  it('o tour da sala tem os 10 passos do plano', () => {
    expect(ROOM_STEPS).toHaveLength(10)
  })
})
