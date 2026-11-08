import { DEFAULT_ROOM_NAME } from '../../shared/protocol'
import type { RecentRoom } from '../storage'

/** "agora", "há 5 min", "ontem"... */
export function timeAgo(at: number): string {
  const min = Math.max(0, Math.round((Date.now() - at) / 60000))
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.round(h / 24)
  return d === 1 ? 'ontem' : `há ${d} dias`
}

/** Nome da sala recente: o nome que o dono deu; sala antiga sem nome usa quem estava nela. */
export function roomTitle(r: RecentRoom): string {
  if (r.name && r.name !== DEFAULT_ROOM_NAME) return r.name
  const p = r.people
  if (p.length === 0) return `Sala ${r.roomId.slice(0, 6)}`
  if (p.length === 1) return `Sala com ${p[0]}`
  if (p.length === 2) return `Sala com ${p[0]} e ${p[1]}`
  return `Sala com ${p[0]}, ${p[1]} e mais ${p.length - 2}`
}
