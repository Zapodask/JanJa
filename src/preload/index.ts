import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { CaptureSource, CreateRoomOptions, JanjaApi, JoinRequest, RoomInfo } from './api'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: JanjaApi = {
  platform: process.platform,
  listSources: () => ipcRenderer.invoke('capture:list') as Promise<CaptureSource[]>,
  selectSource: (id, withAudio) => ipcRenderer.invoke('capture:select', { id, withAudio }),
  createRoom: (opts: CreateRoomOptions) => ipcRenderer.invoke('room:create', opts) as Promise<RoomInfo>,
  closeRoom: () => ipcRenderer.invoke('room:close'),
  onRoomStatus: (cb) => subscribe<string>('room:status', cb),
  onJoinRequest: (cb) => subscribe<JoinRequest>('room:join-request', cb),
  respondJoin: (requestId, approved) => ipcRenderer.send('room:join-response', { requestId, approved }),
  takePendingLink: () => ipcRenderer.invoke('app:take-pending-link') as Promise<string | null>,
  onOpenLink: (cb) => subscribe<string>('app:open-link', cb)
}

contextBridge.exposeInMainWorld('janja', api)
