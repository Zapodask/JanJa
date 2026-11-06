import { useEffect, useState, type FormEvent } from 'react'
import { CreateRoomResponseSchema, MAX_NAME_LENGTH, parseRoomInput } from '../../shared/protocol'
import {
  cleanName,
  getPrefs,
  forgetRoom,
  recentRooms,
  saveApproval,
  savedApproval,
  saveHostKey,
  saveName,
  type RecentRoom
} from '../storage'
import { canShareScreen } from '../useRoom'
import { Avatar } from './Avatar'
import { Brand } from './Brand'
import { Icon } from './icons'
import { Jan, PixelTv } from './Pixel'
import { startTour, stopTour } from './tour'
import { HOME_STEPS, shouldAskTour, shouldAutoTour } from './tourLogic'
import { TourPrompt } from './TourPrompt'

interface Props {
  name: string
  onName: (name: string) => void
  onGo: (path: string) => void
  invalidPath: boolean
}

function timeAgo(at: number): string {
  const min = Math.max(0, Math.round((Date.now() - at) / 60000))
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.round(h / 24)
  return d === 1 ? 'ontem' : `há ${d} dias`
}

function roomTitle(r: RecentRoom): string {
  const p = r.people
  if (p.length === 0) return `Sala ${r.roomId.slice(0, 6)}`
  if (p.length === 1) return `Sala com ${p[0]}`
  if (p.length === 2) return `Sala com ${p[0]} e ${p[1]}`
  return `Sala com ${p[0]}, ${p[1]} e mais ${p.length - 2}`
}

export function Home({ name, onName, onGo, invalidPath }: Props) {
  const [draft, setDraft] = useState(name)
  const [code, setCode] = useState('')
  const [approval, setApproval] = useState(savedApproval)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(invalidPath ? 'Esse link de sala não é válido.' : '')
  const [recents, setRecents] = useState<RecentRoom[]>(recentRooms)
  // momento único ao carregar: Jan aponta o controle e a TV liga; depois ele volta a respirar
  const [pose, setPose] = useState<'remote' | 'idle'>('remote')
  const [tvOn, setTvOn] = useState(false)
  // tour curto na primeira visita, depois que o Jan terminou o número do controle remoto
  // primeira visita: pergunta se quer o tour; quem já disse sim vê o tour da Home uma vez
  const [askTour, setAskTour] = useState(false)
  useEffect(() => {
    const p = getPrefs()
    if (shouldAskTour(p.tourAnswer, p.tourDone, p.homeTourDone)) {
      const t = setTimeout(() => setAskTour(true), 1200)
      return () => clearTimeout(t)
    }
    if (!shouldAutoTour(p.tourAnswer, p.homeTourDone)) return
    const t = setTimeout(() => startTour('home', HOME_STEPS), 2500)
    return () => clearTimeout(t)
  }, [])
  useEffect(() => () => stopTour(true), [])
  useEffect(() => {
    const a = setTimeout(() => setTvOn(true), 700)
    const b = setTimeout(() => setPose('idle'), 2800)
    return () => {
      clearTimeout(a)
      clearTimeout(b)
    }
  }, [])

  const commitName = (): string | null => {
    const n = cleanName(draft)
    if (!n) {
      setError('Escolha um apelido primeiro.')
      return null
    }
    saveName(n)
    onName(n)
    return n
  }

  const create = async () => {
    if (!commitName()) return
    setError('')
    setBusy(true)
    saveApproval(approval)
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requireApproval: approval })
      })
      if (!res.ok) throw new Error(`O servidor respondeu ${res.status}.`)
      const { roomId, hostKey } = CreateRoomResponseSchema.parse(await res.json())
      saveHostKey(roomId, hostKey)
      onGo(`/r/${roomId}`)
    } catch (err) {
      setError(`Não deu para criar a sala. ${err instanceof Error ? err.message : ''}`)
      setBusy(false)
    }
  }

  const join = (e: FormEvent) => {
    e.preventDefault()
    if (!commitName()) return
    try {
      onGo(`/r/${parseRoomInput(code)}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const openRecent = (roomId: string) => {
    if (!commitName()) return
    onGo(`/r/${roomId}`)
  }

  return (
    <main className="lobby">
      <header className="hero">
        <Brand size="xl" draw />
        <h1>
          Veja a tela dos seus amigos pelo navegador. <span>Sem instalar nada.</span>
        </h1>
      </header>

      <div className="hero-pixels" aria-hidden="true">
        <Jan pose={pose} size={192} />
        <PixelTv on={tvOn} size={192} />
      </div>

      {!canShareScreen() && (
        <p className="notice">
          Este navegador não compartilha tela (no celular, por exemplo). Você ainda pode entrar e assistir.
        </p>
      )}

      <label className="field name-field" data-tour="home-name">
        <span>Seu apelido</span>
        <span className="name-input">
          <Avatar name={draft || '?'} size={36} />
          <input
            value={draft}
            maxLength={MAX_NAME_LENGTH}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Como os amigos vão te ver"
            autoFocus={!name}
          />
        </span>
      </label>

      <div className="actions" data-tour="home-actions">
        <div className="action-row">
          <button className="primary" disabled={busy} onClick={() => void create()}>
            {busy ? 'Criando...' : 'Criar sala'}
          </button>
          <span className="or">ou</span>
          <form className="join" onSubmit={join}>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Cole o link ou código"
              aria-label="Link ou código da sala"
            />
            <button type="submit" disabled={!code.trim()}>
              Entrar
            </button>
          </form>
        </div>
        <label className="check">
          <input type="checkbox" checked={approval} onChange={(e) => setApproval(e.target.checked)} />
          Pedir minha aprovação para quem entrar
        </label>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {recents.length > 0 && (
        <section className="recents" data-tour="home-recents">
          <h2>Salas recentes</h2>
          <ul>
            {recents.map((r) => (
              <li key={r.roomId}>
                <button className="recent" onClick={() => openRecent(r.roomId)}>
                  <strong>{roomTitle(r)}</strong>
                  <span className="recent-meta">
                    {r.host && <em>você criou</em>}
                    <span>{timeAgo(r.at)}</span>
                  </span>
                </button>
                <button
                  className="icon-btn"
                  data-tip="Esquecer esta sala"
                  data-tip-pos="left"
                  aria-label="Esquecer esta sala"
                  onClick={() => setRecents(forgetRoom(r.roomId))}
                >
                  <Icon name="x" size={16} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="lobby-foot">
        Funciona melhor no Chrome ou no Edge. Para enviar o som, compartilhe a tela inteira e marque
        &quot;Compartilhar áudio do sistema&quot;.{' '}
        <button type="button" className="link" onClick={() => startTour('home', HOME_STEPS)}>
          Ver o tour
        </button>
      </footer>
      {askTour && (
        <TourPrompt onYes={() => window.setTimeout(() => startTour('home', HOME_STEPS), 150)} onClose={() => setAskTour(false)} />
      )}
    </main>
  )
}
