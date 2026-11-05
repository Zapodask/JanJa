import type { JanjaApi } from '../../preload/api'

declare global {
  interface Window {
    janja: JanjaApi
  }
  interface HTMLMediaElement {
    setSinkId?: (sinkId: string) => Promise<void>
  }
}

export {}
