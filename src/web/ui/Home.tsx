import { useState, type FormEvent } from 'react'
import { CreateRoomResponseSchema, MAX_NAME_LENGTH, parseRoomInput } from '../../shared/protocol'
import { cleanName, saveApproval, savedApproval, saveHostKey, saveName } from '../storage'
import { canShareScreen } from '../useRoom'

interface Props {
  name: string
  onName: (name: string) => void
  onGo: (path: string) => void
  invalidPath: boolean
}

export function Home({ name, onName, onGo, invalidPath }: Props) {
  const [draft, setDraft] = useState(name)
  const [code, setCode] = useState('')
  const [approval, setApproval] = useState(savedApproval)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(invalidPath ? 'Esse link de sala não é válido.' : '')

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

  return (
    <main className="lobby">
      <header className="lobby-head">
        <h1>JanJa</h1>
        <p>Compartilhe a tela com os amigos, direto do navegador. Sem instalar nada.</p>
      </header>

      {!canShareScreen() && (
        <p className="notice">
          Este navegador não compartilha tela (no celular, por exemplo). Você ainda pode entrar e assistir.
        </p>
      )}

      <label className="field">
        <span>Seu apelido</span>
        <input
          value={draft}
          maxLength={MAX_NAME_LENGTH}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Como os amigos vão te ver"
          autoFocus={!name}
        />
      </label>

      <div className="lobby-cards">
        <section className="card">
          <h2>Criar sala</h2>
          <p className="muted">Você recebe um link para mandar aos amigos. A tela vai direto do seu PC para o deles.</p>
          <label className="check">
            <input type="checkbox" checked={approval} onChange={(e) => setApproval(e.target.checked)} />
            Aprovar cada pessoa que entrar
          </label>
          <button className="primary" disabled={busy} onClick={() => void create()}>
            {busy ? 'Criando...' : 'Criar sala'}
          </button>
        </section>

        <form className="card" onSubmit={join}>
          <h2>Entrar numa sala</h2>
          <p className="muted">Recebeu um link? É só abrir. Ou cole aqui o link ou o código.</p>
          <label className="field">
            <span>Link ou código</span>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="https://.../r/..." />
          </label>
          <button className="primary" type="submit" disabled={!code.trim()}>
            Entrar
          </button>
        </form>
      </div>

      {error && <p className="error">{error}</p>}

      <footer className="lobby-foot muted small">
        Funciona melhor no Chrome ou no Edge. Para enviar o som, compartilhe a tela inteira e marque
        &quot;Compartilhar áudio do sistema&quot;.
      </footer>
    </main>
  )
}
