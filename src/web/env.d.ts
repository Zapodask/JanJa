declare global {
  interface HTMLMediaElement {
    setSinkId?: (sinkId: string) => Promise<void>
  }
}

export {}
