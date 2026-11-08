/** Cartas da casa Surpresa. O efeito de cada uma fica no motor (engine.ts), pelo `id`. */
export const CARDS = [
  { id: 'rifa', text: 'Ganhou a rifa do bairro: receba $ 100.' },
  { id: 'multa', text: 'Multa de trânsito: pague $ 50.' },
  { id: 'aniversario', text: 'É seu aniversário: cada um te dá $ 20.' },
  { id: 'pizza', text: 'A pizza é por sua conta: pague $ 25 para cada um.' },
  { id: 'partida', text: 'Volte para a Partida e receba o salário.' },
  { id: 'aeroporto', text: 'Corra para o Aeroporto.' },
  { id: 'festival', text: 'Fuja para o Festival.' },
  { id: 'engarrafamento', text: 'Engarrafamento! Vá direto para lá.' },
  { id: 'volta3', text: 'Esqueceu a carteira: volte 3 casas.' },
  { id: 'reforma', text: 'Reforma geral: pague $ 25 por nível construído.' },
  { id: 'restituicao', text: 'Restituição do imposto: receba $ 150.' },
  { id: 'praia', text: 'Férias! Ande até a próxima praia.' }
] as const

export type CardId = (typeof CARDS)[number]['id']
