import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { Icon, type IconName } from './icons'

export type ToastKind = 'info' | 'ok' | 'warn' | 'error'

interface Toast {
  id: number
  kind: ToastKind
  text: string
  leaving: boolean
}

type Push = (text: string, kind?: ToastKind, ttlMs?: number) => void

const ToastCtx = createContext<Push>(() => undefined)
export const useToast = (): Push => useContext(ToastCtx)

const ICON: Record<ToastKind, IconName> = { info: 'info', ok: 'check', warn: 'warn', error: 'warn' }

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)))
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 260)
  }, [])

  const push = useCallback<Push>(
    (text, kind = 'info', ttlMs) => {
      const id = nextId.current++
      setToasts((list) => [...list.slice(-4), { id, kind, text, leaving: false }])
      setTimeout(() => dismiss(id), ttlMs ?? (kind === 'error' || kind === 'warn' ? 7000 : 3500))
    },
    [dismiss]
  )

  const stack = useMemo(
    () => (
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <button key={t.id} className={`toast ${t.kind} ${t.leaving ? 'leaving' : ''}`} onClick={() => dismiss(t.id)}>
            <span className="toast-icon">
              <Icon name={ICON[t.kind]} size={18} />
            </span>
            <span className="toast-text">{t.text}</span>
          </button>
        ))}
      </div>
    ),
    [toasts, dismiss]
  )

  return (
    <ToastCtx.Provider value={push}>
      {children}
      {stack}
    </ToastCtx.Provider>
  )
}
