import { useState, type FormEvent } from 'react'
import { MAX_NAME_LENGTH } from '../../shared/protocol'
import { cleanName, saveName } from '../storage'
import { Avatar } from './Avatar'
import { Brand } from './Brand'

/** Quem abre o link da sala pela primeira vez escolhe o apelido antes de entrar. */
export function NameGate({
  roomId,
  onName,
  onCancel
}: {
  roomId: string
  onName: (name: string) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState('')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const n = cleanName(draft)
    if (!n) return
    saveName(n)
    onName(n)
  }

  return (
    <main className="center">
      <form className="panel narrow" onSubmit={submit}>
        <Brand />
        <h1>Você foi convidado para uma sala</h1>
        <p className="room-code">
          Código <code>{roomId}</code>
        </p>
        <label className="field">
          <span>Seu apelido</span>
          <span className="name-input">
            <Avatar name={draft || '?'} size={36} />
            <input
              value={draft}
              maxLength={MAX_NAME_LENGTH}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Como os amigos vão te ver"
              autoFocus
            />
          </span>
        </label>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Voltar
          </button>
          <button className="primary" type="submit" disabled={!cleanName(draft)}>
            Entrar na sala
          </button>
        </div>
      </form>
    </main>
  )
}
