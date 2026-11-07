/**
 * Paleta do poker do JanJa: a mesma do Jan (pixelData) mais madeira, feltro e tons intermediários.
 * Uma letra = uma cor. `.` é transparente. Sprites são arrays de strings (uma string por linha).
 */
export type Sprite = string[]

export const PALETTE: Record<string, string> = {
  // contorno e parede
  k: '#0F0B09', // contorno
  w: '#221C19', // parede
  W: '#2E2622', // parede clara
  r: '#3B312C', // tijolo / moldura
  b: '#3B312C', // calça e moldura do Jan (igual a `r`)
  // papel
  p: '#F3EBDD', // papel / carta / brilho
  P: '#D9CCB8', // sombra da carta
  d: '#B7A99A', // sombra funda do papel
  // abajur e coral
  y: '#FFC94A', // abajur / ouro
  Y: '#E0A92E', // sombra do ouro
  o: '#FF7A6B', // coral
  O: '#D9594B', // sombra do coral
  R: '#A8392F', // vermelho profundo (texto e contorno dos naipes vermelhos)
  // verdes
  g: '#6FD49B', // verde claro (LED, ficha)
  G: '#3FA070', // sombra do verde claro
  f: '#1E3A2C', // feltro escuro
  F: '#26493A', // feltro
  h: '#2F5A47', // feltro realçado
  // madeira
  m: '#6B4428',
  M: '#8A5A34',
  n: '#4A2E1B',
  // pele (Jan e retratos)
  s: '#E8B48A',
  S: '#C98E66',
  // confete
  c: '#7FB7E6', // azul-céu
  // tinta (o runtime multiplica pela cor do jogador): branco e cinza claro
  t: '#FFFFFF',
  T: '#B4B4B4'
}

export const PALETTE_KEYS = new Set(['.', ...Object.keys(PALETTE)])

export function rgba(ch: string): [number, number, number, number] {
  if (ch === '.') return [0, 0, 0, 0]
  const hex = PALETTE[ch]
  if (!hex) throw new Error(`chave fora da paleta: "${ch}"`)
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 255]
}
