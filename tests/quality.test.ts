import { describe, expect, it } from 'vitest'
import { bitrateFor, captureConstraints, fitConstraints, pixelScale, presetById } from '../src/web/rtc/quality'

describe('qualidade: captura mantém a proporção da tela', () => {
  it('pede a tela no tamanho nativo (só o fps)', () => {
    const c = captureConstraints(presetById('jogo'))
    expect(c.width).toBeUndefined()
    expect(c.height).toBeUndefined()
    expect(c.frameRate).toEqual({ ideal: 30, max: 30 })
  })
  it('ultrawide 3440×1440 vira 2580×1080, não 1920×1080', () => {
    const c = fitConstraints(presetById('jogo'), 3440, 1440)
    expect(c.width).toEqual({ ideal: 2580, max: 2580 })
    expect(c.height).toEqual({ ideal: 1080, max: 1080 })
  })
  it('16:10 e telas menores que o teto mantêm proporção e não aumentam', () => {
    expect(fitConstraints(presetById('jogo'), 1920, 1200).width).toEqual({ ideal: 1728, max: 1728 })
    const small = fitConstraints(presetById('nitido'), 1920, 1080)
    expect(small.width).toEqual({ ideal: 1920, max: 1920 })
    expect(small.height).toEqual({ ideal: 1080, max: 1080 })
  })
  it('ultrawide 2580×1080 ganha ~34% de bitrate; 16:9 fica igual', () => {
    const jogo = presetById('jogo')
    expect(pixelScale(jogo, 1920, 1080)).toBeCloseTo(1)
    expect(pixelScale(jogo, 2580, 1080)).toBeCloseTo(1.34, 2)
    expect(bitrateFor(jogo, 1, pixelScale(jogo, 2580, 1080))).toBeGreaterThan(10_000_000)
  })
  it('limita a escala entre 0,5 e 1,8 e ignora tamanho desconhecido', () => {
    const jogo = presetById('jogo')
    expect(pixelScale(jogo, 7680, 2160)).toBe(1.8)
    expect(pixelScale(jogo, 640, 360)).toBe(0.5)
    expect(pixelScale(jogo)).toBe(1)
  })
})
