import { PALETTE } from './palette'
import type { Sprite } from './palette'
import { Grid } from './grid'
import { RANKS, SUITS, cardBack, cardFace, cardMiniBack, cardSlot, highlight, CARD_W, CARD_H } from './cards'
import { CHIP_COLORS, chipSprite, chipStack, dealerButton, smallBlind, bigBlind } from './chips'
import { crop, table9, tvFrame9, tvHanger, tvLed, wallTile } from './table'
import { lamp, lightNormal, lightSpot } from './lamp'
import { avatarFrame, timerRing } from './avatar'
import { JAN_CLAP, JAN_DEAL, JAN_GIVE, JAN_GIVE_TROPHY, JAN_IDLE, JAN_SCARED, JAN_SHUFFLE } from './jan'
import { CONFETTI, podium, podiumStep, trophy } from './podium'

export { PALETTE, CARD_W, CARD_H }
export type { Sprite }

export interface Registry {
  /** nome -> sprite (ordem de inserção = ordem no preview) */
  sprites: Record<string, Sprite>
  /** nome da animação -> nomes dos quadros */
  animations: Record<string, string[]>
  /** seção de cada sprite para o preview */
  sections: Record<string, string[]>
}

export function buildRegistry(): Registry {
  const sprites: Record<string, Sprite> = {}
  const animations: Record<string, string[]> = {}
  const sections: Record<string, string[]> = {}
  const add = (section: string, name: string, s: Sprite) => {
    if (sprites[name]) throw new Error(`sprite duplicado: ${name}`)
    sprites[name] = s
    ;(sections[section] ??= []).push(name)
  }
  const addAnim = (section: string, name: string, frames: Sprite[]) => {
    const names = frames.map((f, i) => {
      const n = `${name}_${i}`
      add(section, n, f)
      return n
    })
    animations[name] = names
  }

  // cartas
  for (const suit of SUITS)
    for (const rank of RANKS) {
      const f = cardFace(rank, suit)
      add('cartas', `card_${rank}${suit}`, f)
    }
  const back = cardBack()
  add('cartas', 'card_back', back)
  add('cartas', 'card_slot', cardSlot())
  add('cartas', 'card_mini_back', cardMiniBack())
  for (const suit of SUITS)
    for (const rank of RANKS) add('cartas em destaque', `card_${rank}${suit}_hl`, highlight(cardFace(rank, suit)))
  add('cartas em destaque', 'card_back_hl', highlight(back))

  // fichas
  for (const c of Object.keys(CHIP_COLORS)) add('fichas', `chip_${c}`, chipSprite(c))
  for (const c of Object.keys(CHIP_COLORS)) for (const n of [2, 3, 5]) add('fichas', `chipstack_${c}_${n}`, chipStack(c, n))
  add('fichas', 'btn_dealer', dealerButton())
  add('fichas', 'btn_sb', smallBlind())
  add('fichas', 'btn_bb', bigBlind())

  // mesa
  const t9 = table9()
  add('mesa', 'table_9slice', t9)
  add('mesa', 'table_tl', crop(t9, 0, 0, 16, 16))
  add('mesa', 'table_t', crop(t9, 16, 0, 16, 16))
  add('mesa', 'table_tr', crop(t9, 32, 0, 16, 16))
  add('mesa', 'table_l', crop(t9, 0, 16, 16, 16))
  add('mesa', 'table_c', crop(t9, 16, 16, 16, 16))
  add('mesa', 'table_r', crop(t9, 32, 16, 16, 16))
  add('mesa', 'table_bl', crop(t9, 0, 32, 16, 16))
  add('mesa', 'table_b', crop(t9, 16, 32, 16, 16))
  add('mesa', 'table_br', crop(t9, 32, 32, 16, 16))

  // sala
  add('sala', 'wall_tile', wallTile())
  add('sala', 'tv_frame_9slice', tvFrame9())
  add('sala', 'tv_hanger', tvHanger())
  add('sala', 'tv_led_on', tvLed(true))
  add('sala', 'tv_led_off', tvLed(false))
  add('sala', 'lamp', lamp())
  add('luz', 'light_normal', lightNormal())
  add('luz', 'light_spot', lightSpot())

  // avatar
  add('avatar', 'avatar_frame', avatarFrame())
  const ring: Sprite[] = Array.from({ length: 12 }, (_, i) => timerRing(i))
  addAnim('avatar', 'timer_ring', ring)

  // Jan
  addAnim('Jan carteador', 'jan_idle', JAN_IDLE)
  addAnim('Jan carteador', 'jan_shuffle', JAN_SHUFFLE)
  addAnim('Jan carteador', 'jan_deal', JAN_DEAL)
  addAnim('Jan carteador', 'jan_clap', JAN_CLAP)
  addAnim('Jan carteador', 'jan_scared', JAN_SCARED)
  addAnim('Jan carteador', 'jan_give', JAN_GIVE)
  addAnim('Jan carteador', 'jan_give_trophy', JAN_GIVE_TROPHY)

  // pódio
  add('pódio', 'podium', podium())
  for (const p of [1, 2, 3] as const) add('pódio', `podium_${p}`, podiumStep(p))
  add('pódio', 'trophy', trophy())
  for (const [c, s] of Object.entries(CONFETTI)) add('pódio', `confetti_${c}`, s)

  return { sprites, animations, sections }
}

/** Tamanho esperado por prefixo de nome (usado pelos testes e pelo build). */
export const EXPECTED_SIZE: [RegExp, [number, number]][] = [
  [/^card_mini_/, [16, 24]],
  [/^card_/, [32, 48]],
  [/^chip_/, [12, 12]],
  [/^chipstack_.*_(\d)$/, [12, 0]], // altura = 12 + 2 * (n - 1)
  [/^btn_/, [12, 12]],
  [/^table_9slice$/, [48, 48]],
  [/^table_(tl|t|tr|l|c|r|bl|b|br)$/, [16, 16]],
  [/^wall_tile$/, [32, 32]],
  [/^tv_frame_9slice$/, [36, 36]],
  [/^tv_hanger$/, [32, 14]],
  [/^tv_led_/, [3, 3]],
  [/^lamp$/, [48, 40]],
  [/^light_normal$/, [320, 200]],
  [/^light_spot$/, [120, 200]],
  [/^avatar_frame$/, [28, 28]],
  [/^timer_ring_/, [28, 28]],
  [/^jan_/, [24, 24]],
  [/^podium$/, [96, 36]],
  [/^podium_1$/, [32, 36]],
  [/^podium_2$/, [32, 28]],
  [/^podium_3$/, [32, 20]],
  [/^trophy$/, [16, 16]],
  [/^confetti_/, [2, 2]]
]

export function expectedSize(name: string): [number, number] | null {
  for (const [re, size] of EXPECTED_SIZE) {
    const m = re.exec(name)
    if (!m) continue
    if (re.source.startsWith('^chipstack')) return [12, 12 + 2 * (Number(m[1]) - 1)]
    return size
  }
  return null
}

export { Grid }
