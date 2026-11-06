import type { CSSProperties } from 'react'

/** Paleta fixa de tons terrosos que combinam com a base. */
const TONES = ['#D98E5F', '#C9A227', '#8FAE6B', '#5FA39A', '#C27C8E', '#B4846C', '#7E9CB5', '#D4A373']

export function toneOf(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return TONES[h % TONES.length]
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
  /** nível de voz 0..1 (o anel acompanha) */
  level?: number
  speaking?: boolean
}

export function Avatar({ name, size = 40, level = 0, speaking = false }: Props) {
  const style = {
    '--size': `${size}px`,
    '--tone': toneOf(name),
    '--ring': speaking ? 2 + Math.min(1, level * 1.6) * 4 : 0
  } as CSSProperties
  return (
    <span className={`avatar ${speaking ? 'speaking' : ''}`} style={style} aria-hidden="true">
      {initials(name)}
    </span>
  )
}
