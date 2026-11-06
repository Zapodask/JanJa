import { useState, type FormEvent } from 'react'
import { MAX_NAME_LENGTH } from '../../shared/protocol'
import { cleanName, saveName } from '../storage'
import { Avatar } from './Avatar'
import { Brand } from './Brand'
import { Icon } from './icons'

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
      <form className="card narrow enter" onSubmit={submit}>
        <Brand />
        <h2>Você foi convidado para uma sala</h2>
        <p className="room-code">
          <Icon name="link" size={14} /> <code>{roomId}</code>
        </p>
        <div className="name-row">
          <Avatar name={draft || '?'} size={48} />
          <label className="field grow">
            <span>Seu apelido</span>
            <input
              value={draft}
              maxLength={MAX_NAME_LENGTH}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Como os amigos vão te ver"
              autoFocus
            />
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Voltar
          </button>
          <button className="primary" type="submit" disabled={!cleanName(draft)}>
            Entrar na sala <Icon name="arrow" size={16} />
          </button>
        </div>
      </form>
    </main>
  )
}
