import { useSyncExternalStore } from 'react'

/**
 * Tocar mídia remota sem ficar preso no bloqueio de autoplay.
 * - Vídeo sempre mudo: navegador nunca bloqueia, então a imagem aparece mesmo sem clique.
 * - Áudio que for bloqueado fica numa lista e toca de novo no primeiro clique/tecla da página.
 */
const blocked = new Set<HTMLMediaElement>()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

function retryAll(): void {
  for (const el of [...blocked]) {
    el.play()
      .then(() => {
        blocked.delete(el)
        emit()
      })
      .catch(() => undefined)
  }
}

let armed = false
function arm(): void {
  if (armed || typeof window === 'undefined') return
  armed = true
  window.addEventListener('pointerdown', retryAll, true)
  window.addEventListener('keydown', retryAll, true)
}

/** play() que não estoura: se o navegador bloquear o som, guarda para tentar no próximo gesto. */
export function safePlay(el: HTMLMediaElement): void {
  arm()
  el.play()
    .then(() => {
      if (blocked.delete(el)) emit()
    })
    .catch((err: unknown) => {
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        blocked.add(el)
        emit()
      }
      // AbortError (troca de srcObject no meio) é normal: o próximo attach toca
    })
}

/** Sai da lista (elemento desmontado). */
export function forget(el: HTMLMediaElement): void {
  if (blocked.delete(el)) emit()
}

/**
 * Liga um MediaStream a um elemento e religa quando chegam ou saem trilhas.
 * O Chrome nem sempre começa a mostrar um vídeo que entra depois no mesmo stream
 * (ex.: áudio da tela chegou antes da imagem) — por isso reatribui o srcObject.
 */
export function attachStream(el: HTMLMediaElement, stream: MediaStream, pick?: (s: MediaStream) => MediaStream): () => void {
  const attach = () => {
    el.srcObject = null
    el.srcObject = pick ? pick(stream) : stream
    safePlay(el)
  }
  attach()
  stream.addEventListener('addtrack', attach)
  stream.addEventListener('removetrack', attach)
  return () => {
    stream.removeEventListener('addtrack', attach)
    stream.removeEventListener('removetrack', attach)
    forget(el)
  }
}

/** true enquanto algum som da sala estiver bloqueado esperando um clique. */
export function useAudioBlocked(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => blocked.size > 0,
    () => false
  )
}
