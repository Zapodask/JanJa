import { useEffect, useState, type FormEvent } from 'react'
import { MAX_NAME_LENGTH, parseRoomCode, type IceServer } from '@shared/protocol'
import type { RoomMode } from '../../../preload/api'
import type { Session } from '../App'

const STORE = {
  name: 'janja.name',
  turn: 'janja.turn',
  mode: 'janja.mode',
  approval: 'janja.approval'
}

function load(key: string, fallback = ''): string {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* armazenamento indisponível: ignora */
  }
}

export function savedName(): string {
  return load(STORE.name).trim().slice(0, MAX_NAME_LENGTH)
}

interface TurnForm {
  urls: string
  username: string
  credential: string
}

function parseTurn(raw: string): TurnForm {
  try {
    return { urls: '', username: '', credential: '', ...JSON.parse(raw) }
  } catch {
    return { urls: '', username: '', credential: '' }
  }
}

export function Lobby({ onEnter, initialCode }: { onEnter: (s: Session) => void; initialCode?: string }) {
  const [name, setName] = useState(() => load(STORE.name))
  const [code, setCode] = useState(initialCode ?? '')
  const [mode, setMode] = useState<RoomMode>(() => (load(STORE.mode, 'tunnel') as RoomMode) || 'tunnel')
  const [approval, setApproval] = useState(() => load(STORE.approval, 'true') === 'true')
  const [turn, setTurn] = useState<TurnForm>(() => parseTurn(load(STORE.turn)))
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  useEffect(() => window.janja.onRoomStatus(setStatus), [])

  const cleanName = name.trim().slice(0, MAX_NAME_LENGTH)

  const create = async () => {
    if (!cleanName) return setError('Escolha um apelido primeiro.')
    setError('')
    setBusy(true)
    save(STORE.name, cleanName)
    save(STORE.mode, mode)
    save(STORE.approval, String(approval))
    save(STORE.turn, JSON.stringify(turn))
    try {
      const iceServers: IceServer[] = turn.urls.trim()
        ? [
            {
              urls: turn.urls.split(/[\s,]+/).filter(Boolean),
              username: turn.username || undefined,
              credential: turn.credential || undefined
            }
          ]
        : []
      const hosted = await window.janja.createRoom({ mode, requireApproval: approval, iceServers })
      onEnter({ name: cleanName, code: hosted.hostCode, hosted })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      setStatus('')
    }
  }

  const join = (e: FormEvent) => {
    e.preventDefault()
    if (!cleanName) return setError('Escolha um apelido primeiro.')
    try {
      parseRoomCode(code)
    } catch (err) {
      return setError(err instanceof Error ? err.message : String(err))
    }
    save(STORE.name, cleanName)
    onEnter({ name: cleanName, code: code.trim() })
  }

  return (
    <main className="lobby">
      <header className="lobby-head">
        <h1>JanJa</h1>
        <p>Compartilhe a tela com os amigos, direto de um PC para o outro.</p>
      </header>

      <label className="field">
        <span>Seu apelido</span>
        <input
          value={name}
          maxLength={MAX_NAME_LENGTH}
          onChange={(e) => setName(e.target.value)}
          placeholder="Como os amigos vão te ver"
          autoFocus
        />
      </label>

      <div className="lobby-cards">
        <section className="card">
          <h2>Criar sala</h2>
          <p className="muted">Seu PC vira o servidor da sala. Os amigos entram pelo link.</p>

          <fieldset className="radio-group">
            <label>
              <input type="radio" checked={mode === 'tunnel'} onChange={() => setMode('tunnel')} />
              <span>
                <strong>Pela internet</strong>
                <small>Link via Cloudflare Quick Tunnel, sem abrir porta no roteador</small>
              </span>
            </label>
            <label>
              <input type="radio" checked={mode === 'lan'} onChange={() => setMode('lan')} />
              <span>
                <strong>Rede local ou Tailscale</strong>
                <small>Todos na mesma rede ou na mesma tailnet (porta 47800)</small>
              </span>
            </label>
          </fieldset>

          <label className="check">
            <input type="checkbox" checked={approval} onChange={(e) => setApproval(e.target.checked)} />
            Aprovar cada pessoa que entrar
          </label>

          <details className="advanced">
            <summary>Servidor TURN (recomendado para CGNAT)</summary>
            <p className="muted">
              Use as credenciais do free tier de TURN da Cloudflare ou da Metered. Ficam só no seu PC e são
              entregues aos convidados ao entrar.
            </p>
            <label className="field">
              <span>URLs</span>
              <input
                value={turn.urls}
                onChange={(e) => setTurn({ ...turn, urls: e.target.value })}
                placeholder="turn:turn.exemplo.com:3478, turns:turn.exemplo.com:443"
              />
            </label>
            <div className="row">
              <label className="field">
                <span>Usuário</span>
                <input value={turn.username} onChange={(e) => setTurn({ ...turn, username: e.target.value })} />
              </label>
              <label className="field">
                <span>Senha</span>
                <input
                  type="password"
                  value={turn.credential}
                  onChange={(e) => setTurn({ ...turn, credential: e.target.value })}
                />
              </label>
            </div>
          </details>

          <button className="primary" disabled={busy} onClick={() => void create()}>
            {busy ? 'Abrindo sala...' : 'Criar sala'}
          </button>
          {status && <p className="muted">{status}</p>}
        </section>

        <form className="card" onSubmit={join}>
          <h2>Entrar numa sala</h2>
          <p className="muted">Cole o link que o host te mandou.</p>
          <label className="field">
            <span>Link da sala</span>
            <textarea
              rows={3}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="https://algo.trycloudflare.com/#t=..."
            />
          </label>
          <button className="primary" type="submit" disabled={!code.trim()}>
            Entrar
          </button>
        </form>
      </div>

      {initialCode && !error && (
        <p className="muted">Você abriu um convite. Escolha um apelido e clique em Entrar.</p>
      )}
      {error && <p className="error">{error}</p>}
    </main>
  )
}
