import { useEffect, useRef, useState } from 'react'

/** Relógio do servidor estimado aqui, a partir do `serverNow` da última visão. Atualiza a cada `everyMs`. */
export function useServerNow(serverNow: number, everyMs = 500): number {
  const offset = useRef(0)
  const last = useRef(0)
  if (serverNow !== last.current) {
    last.current = serverNow
    offset.current = serverNow - Date.now()
  }
  const [now, setNow] = useState(() => Date.now() + offset.current)
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now() + offset.current), everyMs)
    return () => window.clearInterval(t)
  }, [everyMs])
  return now
}
