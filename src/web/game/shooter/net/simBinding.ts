/** Único ponto que liga a rede à simulação compartilhada (no Worker, na thread principal e nos testes). */
import { getMap } from '../../../../shared/games/shooter/maps'
import { sim } from '../../../../shared/games/shooter/sim'

export const simApi = sim
export { getMap }
