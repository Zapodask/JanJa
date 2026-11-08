import { useLayoutEffect, useRef, type FormEvent } from 'react'
import { MAX_CHAT_TEXT, type ChatMessage } from '../../shared/protocol'
import { toneOf } from './Avatar'
import { Icon } from './icons'

/** fechado = só o botão; coluna = ao lado da tela; cheio = no lugar da tela */
export type ChatMode = 'fechado' | 'coluna' | 'cheio'

const hhmm = (at: number): string => new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

/** mensagens seguidas da mesma pessoa (até 2 min) ficam juntas, sem repetir o nome */
const GROUP_MS = 2 * 60 * 1000

interface Props {
  channelName: string
  messages: ChatMessage[]
  selfId?: string
  mode: Exclude<ChatMode, 'fechado'>
  draft: string
  onDraft: (text: string) => void
  onSend: (text: string) => void
  onClose: () => void
  /** coluna vira cheio e cheio volta para a tela */
  onToggleFull: () => void
}

/** Chat do canal, estilo Raidcall: nome colorido, hora e a mensagem. */
export function ChatPanel({ channelName, messages, selfId, mode, draft, onDraft, onSend, onClose, onToggleFull }: Props) {
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // segue as mensagens novas, a não ser que a pessoa tenha rolado para cima
  const stick = useRef(true)

  useLayoutEffect(() => {
    const el = listRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [messages, mode])

  const onScroll = () => {
    const el = listRef.current
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const text = draft.trim()
    if (!text) return
    onSend(text.slice(0, MAX_CHAT_TEXT))
    onDraft('')
    stick.current = true
    inputRef.current?.focus()
  }

  const full = mode === 'cheio'
  return (
    <aside className={`chat chat-${mode}`} aria-label={`Chat do canal ${channelName}`}>
      <header className="chat-head">
        <div className="chat-title">
          <strong>Chat</strong>
          <span>{channelName}</span>
        </div>
        {full ? (
          <button className="chat-back" onClick={onToggleFull}>
            <Icon name="screen" size={16} /> Ver a tela
          </button>
        ) : (
          <button className="icon-btn sm" onClick={onToggleFull} data-tip="Chat no lugar da tela" data-tip-pos="bottom" aria-label="Chat no lugar da tela">
            <Icon name="expand" size={16} />
          </button>
        )}
        <button className="icon-btn sm" onClick={onClose} data-tip="Fechar chat" data-tip-pos="left" aria-label="Fechar chat">
          <Icon name="x" size={16} />
        </button>
      </header>

      <div className="chat-list" ref={listRef} onScroll={onScroll} role="log" aria-live="polite">
        {messages.length === 0 ? (
          <p className="chat-empty">Ninguém escreveu nada neste canal ainda.</p>
        ) : (
          messages.map((m, i) => {
            const prev = messages[i - 1]
            const grouped = !!prev && prev.from === m.from && m.at - prev.at < GROUP_MS
            return (
              <div key={m.id} className={`chat-msg ${grouped ? 'grouped' : ''}`}>
                {!grouped && (
                  <div className="chat-meta">
                    <strong style={{ color: toneOf(m.name) }}>
                      {m.name}
                      {m.from === selfId ? ' (você)' : ''}
                    </strong>
                    <time dateTime={new Date(m.at).toISOString()}>{hhmm(m.at)}</time>
                  </div>
                )}
                <p>{m.text}</p>
              </div>
            )
          })
        )}
      </div>

      <form className="chat-form" onSubmit={submit}>
        <input
          ref={inputRef}
          value={draft}
          maxLength={MAX_CHAT_TEXT}
          placeholder={`Mensagem para ${channelName}`}
          aria-label="Mensagem"
          onChange={(e) => onDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && e.currentTarget.blur()}
        />
        <button type="submit" className="primary" disabled={!draft.trim()}>
          Enviar
        </button>
      </form>
    </aside>
  )
}
