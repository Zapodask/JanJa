import type { MapDef, MapId } from '../types'
import { CASA } from './casa'
import { QUINTAL } from './quintal'

export const MAPS: Record<MapId, MapDef> = { casa: CASA, quintal: QUINTAL }
export const MAP_IDS: readonly MapId[] = ['casa', 'quintal']

export const getMap = (id: MapId): MapDef => MAPS[id]
export const isMapId = (x: unknown): x is MapId => typeof x === 'string' && Object.prototype.hasOwnProperty.call(MAPS, x)

export { LEGEND, gridOf, tileAt, type MapGrid } from './legend'
