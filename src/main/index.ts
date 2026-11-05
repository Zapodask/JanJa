import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, session, shell } from 'electron'
import electronUpdater from 'electron-updater'
import type { CreateRoomOptions } from '../preload/api'
import { registerCapture } from './capture'
import { PROTOCOL, releasesUrl, roomCodeFromArgv, roomCodeFromDeepLink } from './links'
import { RoomManager } from './room'

let win: BrowserWindow | null = null
/** link de sala recebido antes da janela estar pronta para ouvir */
let pendingLink: string | null = roomCodeFromArgv(process.argv)

// Uma instância só: clicar num link janja:// com o app aberto reaproveita a janela.
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

function send(channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

function openLink(code: string | null): void {
  if (!code) return
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    win.focus()
    send('app:open-link', code)
  } else {
    pendingLink = code
  }
}

const room = new RoomManager({
  binDir: join(app.getPath('userData'), 'bin'),
  downloadUrl: releasesUrl(),
  status: (msg) => send('room:status', msg),
  askApproval: (requestId, name) => {
    send('room:join-request', { requestId, name })
    if (win && !win.isFocused()) win.flashFrame(true)
  }
})

function createWindow(): void {
  win = new BrowserWindow({
    title: 'JanJa',
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#14141a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  // links externos abrem no navegador, nunca dentro do app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win?.webContents.getURL()) e.preventDefault()
  })

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))

  win.on('closed', () => {
    win = null
  })
}

// Windows/Linux: o link chega como argumento de uma segunda instância
app.on('second-instance', (_e, argv) => openLink(roomCodeFromArgv(argv)))
// macOS: o link chega por evento
app.on('open-url', (e, url) => {
  e.preventDefault()
  openLink(roomCodeFromDeepLink(url))
})

app.whenReady().then(() => {
  // em dev não registra, para não apontar o janja:// para o Electron de desenvolvimento
  if (app.isPackaged) app.setAsDefaultProtocolClient(PROTOCOL)

  // só microfone e captura de tela; o resto é negado
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media' || permission === 'display-capture' || permission === 'clipboard-sanitized-write')
  })

  registerCapture()

  ipcMain.handle('room:create', (_e, opts: CreateRoomOptions) => room.create(opts))
  ipcMain.handle('room:close', () => room.close())
  ipcMain.on('room:join-response', (_e, res: { requestId: string; approved: boolean }) => {
    room.respond(String(res.requestId), !!res.approved)
  })
  ipcMain.handle('app:take-pending-link', () => {
    const code = pendingLink
    pendingLink = null
    return code
  })

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  // atualização automática pelas releases do GitHub (só no app instalado)
  if (app.isPackaged) {
    const { autoUpdater } = electronUpdater
    autoUpdater.checkForUpdatesAndNotify().catch((err: unknown) => console.warn('[update]', err))
  }
})

app.on('window-all-closed', () => {
  void room.close().finally(() => {
    if (process.platform !== 'darwin') app.quit()
  })
})

app.on('before-quit', () => {
  void room.close()
})
