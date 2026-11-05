import { useCallback, useEffect, useRef, useState } from 'react'
import type { RoomInfo } from '../../preload/api'
import { Lobby, savedName } from './ui/Lobby'
import { Room } from './ui/Room'

export interface Session {
  name: string
  /** código usado para conectar (o host usa o código local dele) */
  code: string
  /** só existe para o host */
  hosted?: RoomInfo
}

export function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [linkCode, setLinkCode] = useState<string>()
  const sessionRef = useRef(session)
  sessionRef.current = session

  const leave = useCallback(async () => {
    if (sessionRef.current?.hosted) await window.janja.closeRoom()
    setSession(null)
  }, [])

  /** Link janja:// clicado no navegador: entra direto se já tem apelido salvo. */
  const openLink = useCallback(
    async (code: string) => {
      const current = sessionRef.current
      if (current) {
        if (current.code === code) return
        if (!window.confirm('Sair da sala atual e entrar na sala do link?')) return
        await leave()
      }
      const name = savedName()
      if (name) setSession({ name, code })
      else setLinkCode(code)
    },
    [leave]
  )

  useEffect(() => {
    void window.janja.takePendingLink().then((code) => {
      if (code) void openLink(code)
    })
    return window.janja.onOpenLink((code) => void openLink(code))
  }, [openLink])

  return session ? (
    <Room session={session} onLeave={leave} />
  ) : (
    <Lobby key={linkCode} initialCode={linkCode} onEnter={setSession} />
  )
}
