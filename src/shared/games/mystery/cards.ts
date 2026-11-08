/**
 * Mistério: o roubo do quadro no Casarão da Vila. Personagens, lugares e objetos são nossos
 * (não use nomes, personagens ou cômodos de Detetive/Clue).
 * Três tipos de carta: quem roubou, onde e com o quê. Uma de cada fica no envelope.
 */
export type Kind = 'quem' | 'onde' | 'como'

export interface MysteryCard {
  id: string
  kind: Kind
  name: string
  /** quem: o papel na festa */
  role?: string
  /** cor do cartão (e da roupa, no retrato) */
  color: string
}

export const SUSPECTS: readonly MysteryCard[] = [
  { id: 'odete', kind: 'quem', name: 'Dona Odete', role: 'a governanta', color: '#9A86D9' },
  { id: 'valdir', kind: 'quem', name: 'Seu Valdir', role: 'o jardineiro', color: '#6FD49B' },
  { id: 'lia', kind: 'quem', name: 'Doutora Lia', role: 'a sobrinha', color: '#6FA3C7' },
  { id: 'bene', kind: 'quem', name: 'Tio Bené', role: 'o músico', color: '#E05A4A' },
  { id: 'cleo', kind: 'quem', name: 'Madame Cléo', role: 'a vidente', color: '#E07A9A' },
  { id: 'rafa', kind: 'quem', name: 'Rafa', role: 'o motorista', color: '#E8C547' }
]

export const PLACES: readonly MysteryCard[] = [
  { id: 'varanda', kind: 'onde', name: 'Varanda', color: '#B7A99A' },
  { id: 'cozinha', kind: 'onde', name: 'Cozinha', color: '#B7A99A' },
  { id: 'biblioteca', kind: 'onde', name: 'Biblioteca', color: '#B7A99A' },
  { id: 'porao', kind: 'onde', name: 'Porão', color: '#B7A99A' },
  { id: 'sotao', kind: 'onde', name: 'Sótão', color: '#B7A99A' },
  { id: 'jardim', kind: 'onde', name: 'Jardim', color: '#B7A99A' },
  { id: 'garagem', kind: 'onde', name: 'Garagem', color: '#B7A99A' },
  { id: 'adega', kind: 'onde', name: 'Adega', color: '#B7A99A' }
]

export const TOOLS: readonly MysteryCard[] = [
  { id: 'pe-de-cabra', kind: 'como', name: 'Pé de cabra', color: '#FFC94A' },
  { id: 'guarda-chuva', kind: 'como', name: 'Guarda-chuva', color: '#FFC94A' },
  { id: 'escada', kind: 'como', name: 'Escada', color: '#FFC94A' },
  { id: 'lanterna', kind: 'como', name: 'Lanterna', color: '#FFC94A' },
  { id: 'chaves', kind: 'como', name: 'Molho de chaves', color: '#FFC94A' },
  { id: 'tesoura', kind: 'como', name: 'Tesoura de poda', color: '#FFC94A' }
]

export const ALL_CARDS: readonly MysteryCard[] = [...SUSPECTS, ...PLACES, ...TOOLS]
export const cardById = (id: string): MysteryCard | undefined => ALL_CARDS.find((c) => c.id === id)
export const cardName = (id: string): string => cardById(id)?.name ?? id

/** "Tio Bené, no Porão, com a Lanterna" */
export function tripleText(t: { quem: string; onde: string; como: string }): string {
  const tool = cardName(t.como)
  const art = /^(Escada|Lanterna|Tesoura)/.test(tool) ? 'a' : 'o'
  return `${cardName(t.quem)}, ${prep(t.onde)} ${cardName(t.onde)}, com ${art} ${tool}`
}

const prep = (onde: string): string => (['varanda', 'cozinha', 'biblioteca', 'garagem', 'adega'].includes(onde) ? 'na' : 'no')
