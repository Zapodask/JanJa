import { useEffect, useState } from 'react'

/**
 * Instalar o JanJa como app (PWA). O Chrome e o Edge avisam com `beforeinstallprompt` assim que a
 * página carrega, às vezes antes da sala montar: por isso o evento é guardado aqui, no início.
 */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: InstallPromptEvent | undefined
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((cb) => cb())

/** Chamado uma vez no main.tsx. */
export function watchInstall(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // o JanJa mostra o próprio botão
    deferred = e as InstallPromptEvent
    emit()
  })
  window.addEventListener('appinstalled', () => {
    deferred = undefined
    emit()
  })
}

/** Já está aberto como app (janela própria)? */
const standalone = (): boolean => matchMedia('(display-mode: standalone)').matches

export function useInstall() {
  const [, force] = useState(0)
  useEffect(() => {
    const cb = () => force((n) => n + 1)
    listeners.add(cb)
    return () => void listeners.delete(cb)
  }, [])
  return {
    /** o navegador deixa instalar agora */
    canInstall: !!deferred,
    installed: standalone(),
    async install(): Promise<boolean> {
      const e = deferred
      if (!e) return false
      await e.prompt()
      const { outcome } = await e.userChoice
      // o mesmo evento não serve duas vezes
      deferred = undefined
      emit()
      return outcome === 'accepted'
    }
  }
}
