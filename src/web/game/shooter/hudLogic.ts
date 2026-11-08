/** Contas e textos do HUD do Tiro na Sala (puros, sem React nem DOM: testáveis em Node). */
import { DASH_COOLDOWN_TICKS, RESPAWN_TICKS, TICK_HZ, type WeaponId } from '../../../shared/games/shooter/types'
import type { NetStatus } from './contract'

export const RESPAWN_S = Math.round(RESPAWN_TICKS / TICK_HZ)
export const DASH_COOLDOWN_MS = Math.round((DASH_COOLDOWN_TICKS / TICK_HZ) * 1000)
export const MULTI_WINDOW_MS = 4000
export const FEED_MS = 5500
export const CALL_MS = 2600

/** texto do status da rede, curto */
export function netLabel(net: NetStatus, pingMs: number): string {
  switch (net) {
    case 'conectando':
      return 'Conectando…'
    case 'p2p':
      return pingMs > 0 ? `Ligação direta, ${Math.round(pingMs)} ms` : 'Ligação direta'
    case 'relay':
      return pingMs > 0 ? `Pelo servidor, ${Math.round(pingMs)} ms` : 'Pelo servidor'
    case 'trocando-host':
      return 'Trocando de host…'
    case 'host':
      return 'Partida no seu computador'
    case 'offline':
      return 'Sem conexão'
  }
}

/** abates seguidos sem morrer que o Jan comenta: 5, 8, 10, 15, 20... */
export const isStreakCall = (streak: number): boolean => streak === 5 || streak === 8 || (streak >= 10 && streak % 5 === 0)

/** narração do Jan: sequência marcante primeiro; senão duplo, triplo... (abates seguidos em poucos segundos) */
export function callFor(multi: number, streak: number): string | null {
  if (isStreakCall(streak)) return `Sequência de ${streak}!`
  if (multi === 2) return 'Duplo!'
  if (multi === 3) return 'Triplo!'
  if (multi === 4) return 'Quádruplo!'
  if (multi >= 5) return `Chacina de ${multi}!`
  return null
}

export function ammoText(weapon: WeaponId, ammo: number): string {
  return weapon === 'pistola' || !Number.isFinite(ammo) ? '∞' : String(ammo)
}

/** pódio: 1º, 2º e 3º, o resto em lista */
export function podiumOf<T>(ranking: readonly T[]): { top: T[]; rest: T[] } {
  return { top: ranking.slice(0, 3), rest: ranking.slice(3) }
}

