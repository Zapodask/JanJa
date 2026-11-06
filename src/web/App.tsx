import { useCallback, useEffect, useState } from 'react'
import { ROOM_ID_RE } from '../shared/protocol'
import { hostKeyFor, savedName } from './storage'
import { Home } from './ui/Home'
import { NameGate } from './ui/NameGate'
import { Room } from './ui/Room'
import { ToastProvider } from './ui/Toasts'

/** Rotas: "/" = início, "/r/<id>" = sala. Sem biblioteca de rotas. */
function roomFromPath(path: string): string | null {
  const id = /^\/r\/([^/]+)\/?$/.exec(path)?.[1]
  return id && ROOM_ID_RE.test(id) ? id : null
}

export function App() {
  const [path, setPath] = useState(location.pathname)
  const [name, setName] = useState(savedName)

  useEffect(() => {
    const onPop = () => setPath(location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const go = useCallback((to: string) => {
    history.pushState(null, '', to)
    setPath(to)
  }, [])

  const roomId = roomFromPath(path)

  let screen
  if (!roomId) screen = <Home key="home" name={name} onName={setName} onGo={go} invalidPath={path !== '/'} />
  else if (!name) screen = <NameGate key="gate" roomId={roomId} onName={setName} onCancel={() => go('/')} />
  else screen = <Room key={roomId} roomId={roomId} name={name} hostKey={hostKeyFor(roomId)} onLeave={() => go('/')} />

  return (
    <ToastProvider>
      {screen}
    </ToastProvider>
  )
}
