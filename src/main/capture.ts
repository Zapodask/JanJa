import { desktopCapturer, ipcMain, session } from 'electron'
import type { CaptureSource } from '../preload/api'

/**
 * O renderer escolhe a fonte no seletor do próprio JanJa (`capture:select`) e depois chama
 * getDisplayMedia; este handler entrega a fonte escolhida. No Windows o áudio do sistema
 * vem por loopback.
 */
let selected: { id: string; withAudio: boolean } | null = null

export function registerCapture(): void {
  ipcMain.handle('capture:list', async (): Promise<CaptureSource[]> => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: false
    })
    return sources
      .filter((s) => !s.name.startsWith('JanJa'))
      .map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.id.startsWith('screen:') ? 'screen' : 'window',
        thumbnail: s.thumbnail.toDataURL()
      }))
  })

  ipcMain.handle('capture:select', (_e, sel: { id: string; withAudio: boolean }) => {
    selected = { id: String(sel.id), withAudio: !!sel.withAudio }
  })

  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const choice = selected
    selected = null
    if (!choice) return callback({})
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] })
    const source = sources.find((s) => s.id === choice.id)
    if (!source) return callback({})
    callback({
      video: source,
      ...(choice.withAudio && process.platform === 'win32' ? { audio: 'loopback' as const } : {})
    })
  })
}
