import { useEffect, useRef, useState } from 'react'
import type { ShooterSession, ShooterSessionDeps } from '../contract'
import { createShooterSession, type ManagedShooterSession } from './session'

/**
 * Cria a sessão do Tiro na Sala quando há partida (`deps` não nulo) e a mantém enquanto for a mesma
 * partida (`view.createdAt`). Mudança de view/manager só atualiza a sessão; ela não é recriada.
 */
export function useShooterSession(deps: ShooterSessionDeps | null): ShooterSession | null {
  const [session, setSession] = useState<ManagedShooterSession | null>(null)
  const latest = useRef(deps)
  latest.current = deps
  const matchKey = deps ? `${deps.view.createdAt}|${deps.view.you ? 'j' : 'e'}` : null

  // cria/descarta ao começar ou acabar a partida
  useEffect(() => {
    const d = latest.current
    if (!matchKey || !d) {
      setSession(null)
      return
    }
    const s = createShooterSession({
      view: d.view,
      manager: d.manager,
      relay: (to, data) => latest.current?.relay(to, data),
      onRelay: (cb) => (latest.current ?? d).onRelay(cb),
      act: (a) => latest.current?.act(a)
    })
    setSession(s)
    return () => {
      s.dispose()
      setSession(null)
    }
  }, [matchKey])

  // view e manager novos: só atualiza
  const view = deps?.view
  const manager = deps?.manager
  useEffect(() => {
    if (session && view) session.update(view)
  }, [session, view])
  useEffect(() => {
    if (session) session.setManager(manager)
  }, [session, manager])

  return session
}
