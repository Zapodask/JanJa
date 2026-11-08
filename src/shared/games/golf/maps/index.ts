import type { HoleDef } from '../course'
import { FLIPERAMA } from './fliperama'
import { MONTANHA } from './montanha'
import { QUINTAL } from './quintal'

export interface GolfMap {
  id: string
  name: string
  holes: HoleDef[]
}

/** Mapas do golfe (6 a 12 buracos cada). Para um mapa novo: crie o arquivo e adicione aqui. */
export const MAPS: GolfMap[] = [
  { id: 'quintal', name: 'Quintal', holes: QUINTAL },
  { id: 'fliperama', name: 'Fliperama', holes: FLIPERAMA },
  { id: 'montanha', name: 'Montanha', holes: MONTANHA }
]

export const mapById = (id: string): GolfMap | undefined => MAPS.find((m) => m.id === id)
