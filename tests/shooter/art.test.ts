import { describe, expect, it } from 'vitest'
import { LEGEND } from '../../src/shared/games/shooter/maps'
import { MAPS } from '../../src/shared/games/shooter/maps'
import { SPAL, SPAL_KEYS } from '../../src/web/game/shooter/scene/palette'
import { tileContext } from '../../src/web/game/shooter/scene/mapart'
import { TILE_ART, TILE_LIGHT, TILE_PX, fallbackPixel, hasTileArt, tileRows } from '../../src/web/game/shooter/scene/tiles'
import { allSprites, CHAR, FACINGS, WALK_FRAMES, WEAPON_ART, bodyRows, facingOf, pickupRows, ringPoints } from '../../src/web/game/shooter/scene/sprites'

const baseCtx = { tx: 3, ty: 4, bx: 0, by: 0, bw: 1, bh: 1, nl: false, nr: false, nu: false, nd: false, wallAbove: false, variant: 0 }

describe('arte dos tiles', () => {
  it('toda chave de arte da LEGEND tem desenho', () => {
    const keys = new Set<string>()
    for (const t of Object.values(LEGEND)) {
      keys.add(t.art)
      if (t.floor) keys.add(t.floor)
    }
    expect(keys.size).toBeGreaterThan(15)
    for (const k of keys) expect(hasTileArt(k), `falta arte para "${k}"`).toBe(true)
  })

  it('não sobra arte sem uso na legenda', () => {
    const used = new Set<string>()
    for (const t of Object.values(LEGEND)) {
      used.add(t.art)
      if (t.floor) used.add(t.floor)
    }
    for (const k of Object.keys(TILE_ART)) expect(used.has(k), `arte "${k}" não aparece na legenda`).toBe(true)
  })

  it('todo tile sai 16x16 e só com letras da paleta, em vários contextos', () => {
    for (const [ch, info] of Object.entries(LEGEND)) {
      for (const ctx of [baseCtx, { ...baseCtx, bx: 1, bw: 3, nl: true, nr: true }, { ...baseCtx, by: 2, bh: 5, nu: true, nd: true }, { ...baseCtx, wallAbove: true }, { ...baseCtx, bw: 11, bx: 5, nl: true, nr: true }]) {
        const rows = tileRows(info.art, ctx, info.floor)
        expect(rows, ch).toHaveLength(TILE_PX)
        for (const line of rows) {
          expect(line.length, `${info.art} largura`).toBe(TILE_PX)
          for (const c of line) expect(SPAL_KEYS.has(c), `${info.art}: "${c}"`).toBe(true)
        }
      }
    }
  })

  it('móvel com piso embaixo não deixa buraco transparente', () => {
    for (const info of Object.values(LEGEND)) {
      if (!info.floor) continue
      const rows = tileRows(info.art, baseCtx, info.floor)
      expect(rows.join('').includes('.'), `${info.art} sobre ${info.floor}`).toBe(false)
    }
  })

  it('chave desconhecida vira um tile visível (xadrez coral), não buraco', () => {
    const rows = tileRows('nao-existe', baseCtx, undefined)
    expect(rows.join('').includes('.')).toBe(false)
    expect(new Set(rows.join('')).has('o')).toBe(true)
    expect(fallbackPixel(0, 0, baseCtx)).not.toBe('.')
    expect(hasTileArt('nao-existe')).toBe(false)
  })

  it('todos os mapas desenham sem caractere fora da legenda', () => {
    for (const map of Object.values(MAPS)) {
      for (let ty = 0; ty < map.h; ty++)
        for (let tx = 0; tx < map.w; tx++) {
          const { ref } = tileContext(map, tx, ty)
          expect(ref.art, `${map.id} ${tx},${ty}`).not.toBe('?')
          expect(hasTileArt(ref.art)).toBe(true)
        }
    }
  })

  it('o contexto acha o bloco retangular do móvel', () => {
    const casa = MAPS.casa
    // o sofá 'SSSSSSSSSSS' da linha 8 começa na coluna 9
    const first = tileContext(casa, 9, 8).ctx
    const mid = tileContext(casa, 12, 8).ctx
    expect(first.bx).toBe(0)
    expect(first.bw).toBeGreaterThanOrEqual(11)
    expect(mid.bx).toBe(3)
    expect(mid.nl && mid.nr).toBe(true)
  })

  it('luzes só em chaves que existem', () => {
    for (const k of Object.keys(TILE_LIGHT)) expect(hasTileArt(k)).toBe(true)
  })
})

describe('sprites do tiro', () => {
  it('os bonecos são 16x16 nas 4 direções e 3 quadros', () => {
    for (const f of FACINGS)
      for (const fr of WALK_FRAMES) {
        const r = bodyRows(f, fr)
        expect(r, `${f}${fr}`).toHaveLength(CHAR)
        for (const l of r) expect(l.length).toBe(CHAR)
      }
  })

  it('o boneco da esquerda é o espelho do da direita', () => {
    for (const fr of WALK_FRAMES) expect(bodyRows('esq', fr)).toEqual(bodyRows('dir', fr).map((l) => [...l].reverse().join('')))
  })

  it('os quadros de passo mudam o desenho e usam a tinta do apelido', () => {
    for (const f of FACINGS) {
      expect(bodyRows(f, 1).join('|')).not.toBe(bodyRows(f, 0).join('|'))
      expect(bodyRows(f, 2).join('|')).not.toBe(bodyRows(f, 1).join('|'))
      expect(bodyRows(f, 0).join('')).toMatch(/t/)
    }
  })

  it('todo sprite tem linhas do mesmo tamanho, tamanho esperado e só letras da paleta', () => {
    for (const [name, s] of Object.entries(allSprites())) {
      expect(s.rows.length, name).toBeGreaterThan(0)
      const w = s.rows[0]!.length
      if (s.size) {
        expect(w, `${name} largura`).toBe(s.size[0])
        expect(s.rows.length, `${name} altura`).toBe(s.size[1])
      }
      for (const line of s.rows) {
        expect(line.length, `${name}: linhas desiguais`).toBe(w)
        for (const c of line) expect(SPAL_KEYS.has(c), `${name}: "${c}"`).toBe(true)
      }
    }
  })

  it('cada arma tem sprite, empunhadura e ponta do cano dentro dele', () => {
    for (const [id, w] of Object.entries(WEAPON_ART)) {
      expect(w.rows[0]!.length, id).toBeGreaterThanOrEqual(w.muzzleX - 1)
      expect(w.gripY, id).toBeLessThan(w.rows.length)
      expect(w.gripX, id).toBeLessThan(w.rows[0]!.length)
    }
    expect(Object.keys(WEAPON_ART).sort()).toEqual(['escopeta', 'pistola', 'rifle', 'rolha', 'sub'])
  })

  it('caixas das 5 armas e do kit de vida são diferentes entre si', () => {
    const kinds = ['pistola', 'escopeta', 'sub', 'rifle', 'rolha', 'vida'] as const
    const seen = new Set(kinds.map((k) => pickupRows(k).join('|')))
    expect(seen.size).toBe(kinds.length)
  })

  it('o anel de tempo cresce com o progresso', () => {
    expect(ringPoints(10, 0).length).toBeLessThanOrEqual(1)
    expect(ringPoints(10, 0.5).length).toBeGreaterThan(ringPoints(10, 0.2).length)
    expect(ringPoints(10, 1).length).toBeGreaterThan(ringPoints(10, 0.5).length)
    for (const [x, y] of ringPoints(10, 1)) expect(Math.abs(Math.hypot(x, y) - 10)).toBeLessThan(1)
  })

  it('a direção do sprite segue a mira', () => {
    expect(facingOf(1, 0)).toBe('dir')
    expect(facingOf(-1, 0.1)).toBe('esq')
    expect(facingOf(0, 1)).toBe('baixo')
    expect(facingOf(0.1, -1)).toBe('cima')
  })

  it('a paleta tem as cores da casa à noite', () => {
    expect(SPAL.w!.toLowerCase()).toBe('#221c19')
    expect(SPAL.y!.toLowerCase()).toBe('#ffc94a')
    expect(SPAL.p!.toLowerCase()).toBe('#f3ebdd')
    expect(SPAL.d!.toLowerCase()).toBe('#b7a99a')
  })
})
