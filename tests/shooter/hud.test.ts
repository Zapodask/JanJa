import { describe, expect, it } from 'vitest'
import { DASH_COOLDOWN_TICKS, RESPAWN_TICKS, TICK_HZ, type ScoreLine } from '../../src/shared/games/shooter/types'
import { RESPAWN_S, DASH_COOLDOWN_MS, ammoText, callFor, isStreakCall, netLabel, podiumOf } from '../../src/web/game/shooter/hudLogic'
import { SHOOTER_SFX } from '../../src/web/game/contract'
import { BOT_TONES, createSfxBus, sfxGate, shooterTrack } from '../../src/web/game/shooter/sfxBus'
import { sfxDuration, sfxPlan } from '../../src/web/game/audio/sfx'

describe('textos do HUD', () => {
  it('status da rede em português simples, sem caixa alta nem seta', () => {
    expect(netLabel('p2p', 0)).toBe('Ligação direta')
    expect(netLabel('p2p', 32.4)).toBe('Ligação direta, 32 ms')
    expect(netLabel('relay', 80)).toBe('Pelo servidor, 80 ms')
    expect(netLabel('trocando-host', 0)).toBe('Trocando de host…')
    for (const n of ['conectando', 'p2p', 'relay', 'trocando-host', 'host', 'offline'] as const) {
      const t = netLabel(n, 10)
      expect(t).not.toMatch(/[→←↑↓]/)
      expect(t).not.toBe(t.toUpperCase())
    }
  })

  it('narração: duplo, triplo e sequências', () => {
    expect(callFor(1, 1)).toBeNull()
    expect(callFor(2, 2)).toBe('Duplo!')
    expect(callFor(3, 3)).toBe('Triplo!')
    expect(callFor(4, 4)).toBe('Quádruplo!')
    expect(callFor(5, 4)).toBe('Chacina de 5!')
    expect(callFor(1, 5)).toBe('Sequência de 5!')
    expect(callFor(2, 8)).toBe('Sequência de 8!')
    expect(callFor(1, 6)).toBeNull()
    expect([5, 8, 10, 15, 20].every(isStreakCall)).toBe(true)
    expect([1, 4, 6, 9, 11].some(isStreakCall)).toBe(false)
  })

  it('munição: infinito na pistola', () => {
    expect(ammoText('pistola', Infinity)).toBe('∞')
    expect(ammoText('escopeta', 6)).toBe('6')
    expect(ammoText('sub', 0)).toBe('0')
  })

  it('pódio separa os 3 primeiros do resto', () => {
    const r = Array.from({ length: 6 }, (_, i): ScoreLine => ({ id: `p${i}`, kills: 9 - i, deaths: 0, damage: 0 }))
    const { top, rest } = podiumOf(r)
    expect(top.map((x) => x.id)).toEqual(['p0', 'p1', 'p2'])
    expect(rest).toHaveLength(3)
    expect(podiumOf(r.slice(0, 2)).top).toHaveLength(2)
  })

  it('renascer e dash seguem as constantes do jogo', () => {
    expect(RESPAWN_S).toBe(RESPAWN_TICKS / TICK_HZ)
    expect(DASH_COOLDOWN_MS).toBe((DASH_COOLDOWN_TICKS / TICK_HZ) * 1000)
  })
})

describe('cores', () => {
  it('robôs têm cores próprias e diferentes', () => {
    expect(new Set(BOT_TONES).size).toBe(BOT_TONES.length)
    for (const c of BOT_TONES) expect(c).toMatch(/^#[0-9A-F]{6}$/i)
  })
})

describe('som e música do tiro', () => {
  it('todo efeito do tiro tem plano de vozes curto e audível', () => {
    expect(SHOOTER_SFX).toHaveLength(16)
    for (const n of SHOOTER_SFX) {
      const plan = sfxPlan(n)
      expect(plan.length, n).toBeGreaterThan(0)
      expect(sfxDuration(n), n).toBeLessThan(1.3)
      for (const v of plan) {
        expect(v.vel).toBeGreaterThan(0)
        expect(v.vel).toBeLessThanOrEqual(0.8)
        expect(v.dur).toBeGreaterThan(0)
      }
    }
    // a explosão é o som mais comprido e a submetralhadora o mais curto entre os tiros
    expect(sfxDuration('explosao')).toBeGreaterThan(sfxDuration('tiro-escopeta') - 0.2)
    expect(sfxDuration('tiro-sub')).toBeLessThan(sfxDuration('tiro-rifle'))
  })

  it('o limitador segura rajadas e passos, mas deixa sons diferentes passarem', () => {
    const last = new Map<string, number>()
    expect(sfxGate(last, 'tiro-sub', 1000)).toBe(true)
    expect(sfxGate(last, 'tiro-sub', 1020)).toBe(false)
    expect(sfxGate(last, 'tiro-sub', 1050)).toBe(true)
    expect(sfxGate(last, 'abate', 1051)).toBe(true)
    expect(sfxGate(last, 'passo', 2000)).toBe(true)
    expect(sfxGate(last, 'passo', 2050)).toBe(false)
  })

  it('a faixa muda no último minuto e vira fanfarra no fim', () => {
    expect(shooterTrack('aquecendo', 4000)).toBe('tiroteio')
    expect(shooterTrack('jogando', 180_000)).toBe('tiroteio')
    expect(shooterTrack('jogando', 60_001)).toBe('tiroteio')
    expect(shooterTrack('jogando', 60_000)).toBe('final')
    expect(shooterTrack('jogando', 5)).toBe('final')
    expect(shooterTrack('fim', 0)).toBe('vitoria')
  })

  it('o barramento entrega para quem assinou e deixa cancelar', () => {
    const bus = createSfxBus()
    const got: string[] = []
    const off = bus.subscribe((n, o) => got.push(`${n}:${o?.volume ?? '-'}`))
    bus.emit('abate', { volume: 0.5 })
    off()
    bus.emit('abate')
    expect(got).toEqual(['abate:0.5'])
  })
})
