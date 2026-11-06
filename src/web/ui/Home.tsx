import { useState, type FormEvent } from 'react'
import { CreateRoomResponseSchema, MAX_NAME_LENGTH, parseRoomInput } from '../../shared/protocol'
import {
  cleanName,
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

interface Props {
  name: string
  onName: (name: string) => void
  onGo: (path: string) => void
  invalidPath: boolean
}

function timeAgo(at: number): string {
  const min = Math.max(0, Math.round((Date.now() - at) / 60000))
  if (min < 1) return 'agora há pouco'
  if (min < 60) return `há ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.round(h / 24)
  return d === 1 ? 'ontem' : `há ${d} dias`
}

export function Home({ name, onName, onGo, invalidPath }: Props) {
  const [draft, setDraft] = useState(name)
  const [code, setCode] = useState('')
  const [approval, setApproval] = useState(savedApproval)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(invalidPath ? 'Esse link de sala não é válido.' : '')
  const [recents, setRecents] = useState<RecentRoom[]>(recentRooms)

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
      <header className="hero enter">
        <Brand size="lg" />
        <h1>
          Sua tela, <em>ao vivo</em> com os amigos.
        </h1>
        <p>Direto do navegador, de PC para PC. Sem instalar nada, sem pagar nada.</p>
      </header>

      {!canShareScreen() && (
        <p className="notice enter" style={{ animationDelay: '.08s' }}>
          <Icon name="info" size={18} />
          <span>Este navegador não compartilha tela (no celular, por exemplo). Você ainda pode entrar e assistir.</span>
        </p>
      )}

      <div className="name-box card enter" style={{ animationDelay: '.1s' }}>
        <Avatar name={draft || '?'} size={52} />
        <label className="field grow">
          <span>Seu apelido</span>
          <input
            value={draft}
            maxLength={MAX_NAME_LENGTH}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Como os amigos vão te ver"
            autoFocus={!name}
          />
        </label>
      </div>

      <div className="lobby-cards">
        <section className="card hover-lift enter" style={{ animationDelay: '.16s' }}>
          <div className="card-icon">
            <Icon name="spark" size={22} />
          </div>
          <h2>Criar sala</h2>
          <p className="muted">Você recebe um link para mandar aos amigos. A tela vai direto do seu PC para o deles.</p>
          <label className="switch">
            <input type="checkbox" checked={approval} onChange={(e) => setApproval(e.target.checked)} />
            <span className="track" />
            <span>Aprovar cada pessoa que entrar</span>
          </label>
          <button className="primary big" disabled={busy} onClick={() => void create()}>
            {busy ? 'Criando...' : 'Criar sala'} {!busy && <Icon name="arrow" size={18} />}
          </button>
        </section>

        <form className="card hover-lift enter" style={{ animationDelay: '.22s' }} onSubmit={join}>
          <div className="card-icon alt">
            <Icon name="link" size={22} />
          </div>
          <h2>Entrar numa sala</h2>
          <p className="muted">Recebeu um link? É só abrir. Ou cole aqui o link ou o código.</p>
          <label className="field">
            <span>Link ou código</span>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="https://.../r/..." />
          </label>
          <button className="primary big" type="submit" disabled={!code.trim()}>
            Entrar <Icon name="arrow" size={18} />
          </button>
        </form>
      </div>

      {error && (
        <p className="error shake" role="alert">
          {error}
        </p>
      )}

      {recents.length > 0 && (
        <section className="recents enter" style={{ animationDelay: '.3s' }}>
          <h3>
            <Icon name="clock" size={16} /> Salas recentes
          </h3>
          <ul>
            {recents.map((r, i) => (
              <li key={r.roomId} style={{ animationDelay: `${0.34 + i * 0.05}s` }}>
                <button className="recent" onClick={() => openRecent(r.roomId)}>
                  <span className="avatars">
                    {r.people.slice(0, 3).map((p) => (
                      <Avatar key={p} name={p} size={32} />
                    ))}
                    {r.people.length === 0 && <Avatar name="?" size={32} />}
                  </span>
                  <span className="recent-info">
                    <strong>
                      {r.people.length ? r.people.slice(0, 3).join(', ') + (r.people.length > 3 ? ` +${r.people.length - 3}` : '') : 'Sala vazia'}
                    </strong>
                    <small className="muted">
                      {timeAgo(r.at)} · {r.roomId.slice(0, 6)}…
                    </small>
                  </span>
                  {r.host && (
                    <span className="tag">
                      <Icon name="crown" size={12} /> host
                    </span>
                  )}
                  <Icon name="arrow" size={18} />
                </button>
                <button
                  className="icon-btn sm forget"
                  title="Esquecer esta sala"
                  aria-label="Esquecer esta sala"
                  onClick={() => setRecents(forgetRoom(r.roomId))}
                >
                  <Icon name="x" size={14} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="lobby-foot muted small">
        Funciona melhor no Chrome ou no Edge. Para enviar o som, compartilhe a tela inteira e marque
        &quot;Compartilhar áudio do sistema&quot;.
      </footer>
    </main>
  )
}
