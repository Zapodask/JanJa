import type { CSSProperties } from 'react'

/** Cor estável derivada do apelido. */
export function hueOf(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return h
}

function initials(name: string): string {
  const parts: string[] = name.match(/[\p{L}\p{N}]+/gu) ?? []
  if (!parts.length) return '?'
  const a = parts[0][0] ?? ''
  const b = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : (parts[0][1] ?? '')
  return (a + b).toUpperCase()
}

interface Props {
  name: string
  size?: number
  /** nível de voz 0..1 (anima a aura) */
  level?: number
  speaking?: boolean
}

export function Avatar({ name, size = 40, level = 0, speaking = false }: Props) {
  const hue = hueOf(name)
  const style = {
    '--size': `${size}px`,
    '--h': hue,
    '--lvl': speaking ? Math.min(1, 0.25 + level * 1.5) : 0
  } as CSSProperties
  return (
    <span className={`avatar ${speaking ? 'speaking' : ''}`} style={style} aria-hidden="true">
      <span className="avatar-face">{initials(name)}</span>
    </span>
  )
}
