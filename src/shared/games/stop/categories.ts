/** Categorias do Stop e as contas de texto (puras). */
export interface Category {
  id: string
  name: string
  /** exemplo curto que aparece no campo */
  hint: string
}

export const CATEGORIES: readonly Category[] = [
  { id: 'nome', name: 'Nome', hint: 'Ana, Bruno...' },
  { id: 'cep', name: 'CEP', hint: 'cidade, estado ou país' },
  { id: 'animal', name: 'Animal', hint: 'bicho de qualquer tipo' },
  { id: 'cor', name: 'Cor', hint: 'azul, bege...' },
  { id: 'fruta', name: 'Fruta', hint: 'fruta, de verdade' },
  { id: 'objeto', name: 'Objeto', hint: 'coisa que se pega' },
  { id: 'comida', name: 'Comida', hint: 'prato ou alimento' },
  { id: 'marca', name: 'Marca', hint: 'marca conhecida' },
  { id: 'profissao', name: 'Profissão', hint: 'o que alguém faz' },
  { id: 'filme', name: 'Filme ou série', hint: 'título' },
  { id: 'corpo', name: 'Parte do corpo', hint: 'braço, cotovelo...' },
  { id: 'mse', name: 'Minha sogra é...', hint: 'um adjetivo' }
]

export const DEFAULT_CATEGORIES = ['nome', 'cep', 'animal', 'cor', 'fruta', 'objeto', 'comida', 'mse']

/** letras fora do sorteio: quase não têm palavra em português */
export const SKIP_LETTERS = ['K', 'W', 'Y']
export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter((l) => !SKIP_LETTERS.includes(l))

export const MAX_ANSWER = 40

export const categoryName = (id: string): string => CATEGORIES.find((c) => c.id === id)?.name ?? id

/** para comparar respostas: sem acento, minúscula, espaços simples ("São  Paulo" = "sao paulo") */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** a resposta começa com a letra da rodada? (Ágata vale para A, Érica para E) */
export const startsWith = (answer: string, letter: string): boolean => normalize(answer).startsWith(normalize(letter))
