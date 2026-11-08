import { MAX_NAME_LENGTH } from '../shared/protocol'

/**
 * Tudo que o JanJa lembra fica no localStorage deste navegador, com prefixo "janja.".
 * Leitura e escrita nunca quebram a página: modo anônimo ou storage cheio só fazem
 * o app esquecer.
 */
const PREFIX = 'janja.'

function load(key: string): string {
  try {
    return localStorage.getItem(PREFIX + key) ?? ''
  } catch {
    return ''
  }
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + key, value)
  } catch {
    /* armazenamento indisponível: segue sem lembrar */
  }
}

function loadJson<T>(key: string, fallback: T): T {
  const raw = load(key)
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

const saveJson = (key: string, value: unknown): void => save(key, JSON.stringify(value))

// ---------- identidade ----------

export const cleanName = (name: string): string => name.trim().slice(0, MAX_NAME_LENGTH)
export const savedName = (): string => cleanName(load('name'))
export const saveName = (name: string): void => save('name', cleanName(name))

/** A chave de host fica no navegador de quem criou a sala: recarregar a página mantém o papel. */
export const hostKeyFor = (roomId: string): string | undefined => load(`host.${roomId}`) || undefined
export const saveHostKey = (roomId: string, key: string): void => save(`host.${roomId}`, key)

// ---------- helper do controle remoto ----------

/** Token do pareamento com o JanJa Helper deste PC. Vale só neste navegador. */
export const getHelperToken = (): string | undefined => load('helperToken') || undefined
export const setHelperToken = (token: string | undefined): void => {
  try {
    if (token) localStorage.setItem(PREFIX + 'helperToken', token)
    else localStorage.removeItem(PREFIX + 'helperToken')
  } catch {
    /* sem armazenamento: pareia de novo na próxima */
  }
}

/** Identidade estável desta pessoa neste navegador: recupera a cadeira do jogo ao reconectar. */
export function clientId(): string {
  const saved = load('clientId')
  if (/^[A-Za-z0-9_-]{8,64}$/.test(saved)) return saved
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const id = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  save('clientId', id)
  return id
}

// ---------- preferências ----------

export interface Prefs {
  /** mic começa desligado até a pessoa ligar uma vez; depois vale a última escolha */
  micMuted: boolean
  presetId: string
  approval: boolean
  sinkId: string
  /** volume por pessoa, guardado pelo apelido (o id muda a cada entrada) */
  volumes: Record<string, number>
  sidebarOpen: boolean
  showStats: boolean
  /** campainha de pedido de entrada e som de tela compartilhada */
  sounds: boolean
  /** versão do tour da sala já vista (0 = nunca) */
  tourDone: number
  /** resposta à pergunta da primeira visita: 'ask' = ainda não perguntou */
  tourAnswer: 'ask' | 'yes' | 'no'
  /** versão do tour da Home já vista */
  homeTourDone: number
  /** música da mesa de jogo e o volume dela (0..1) */
  musicOn: boolean
  musicVolume: number
  /** compartilhar a tela com o som do navegador junto (tem eco: a voz dos amigos volta para eles) */
  shareBrowserAudio: boolean
  /** chat do canal aberto ao lado da tela ou recolhido */
  chatMode: 'coluna' | 'fechado'
}

const DEFAULT_PREFS: Prefs = {
  micMuted: true,
  presetId: 'auto',
  approval: false,
  sinkId: 'default',
  volumes: {},
  sidebarOpen: true,
  showStats: true,
  sounds: true,
  tourDone: 0,
  tourAnswer: 'ask',
  homeTourDone: 0,
  musicOn: true,
  musicVolume: 0.35,
  shareBrowserAudio: false,
  chatMode: 'coluna'
}

// compatibilidade com a chave antiga de aprovação
function legacy(): Partial<Prefs> {
  const approval = load('approval')
  return approval ? { approval: approval !== 'false' } : {}
}

/**
 * Migração única: antes o preset era salvo sozinho ao compartilhar (não era escolha consciente).
 * Na primeira vez com o automático, todo mundo passa para ele; depois a escolha da pessoa vale.
 */
function migrateAuto(prefs: Prefs): Prefs {
  if (load('qualityAutoV1')) return prefs
  save('qualityAutoV1', '1')
  if (prefs.presetId === 'auto') return prefs
  const next = { ...prefs, presetId: 'auto' }
  saveJson('prefs', next)
  return next
}

/**
 * Migração única: "pedir aprovação" começava ligado e era gravado sozinho ao criar a sala, então o valor salvo
 * não diz se a pessoa escolheu. Agora começa desligado; na primeira vez, todo mundo volta para desligado e
 * depois a escolha da pessoa vale.
 */
function migrateApproval(prefs: Prefs): Prefs {
  if (load('approvalOffV1')) return prefs
  save('approvalOffV1', '1')
  if (!prefs.approval) return prefs
  const next = { ...prefs, approval: false }
  saveJson('prefs', next)
  return next
}

let cache: Prefs | undefined

export function getPrefs(): Prefs {
  cache ??= migrateApproval(migrateAuto({ ...DEFAULT_PREFS, ...legacy(), ...loadJson<Partial<Prefs>>('prefs', {}) }))
  return cache
}

export function setPrefs(patch: Partial<Prefs>): Prefs {
  cache = { ...getPrefs(), ...patch }
  saveJson('prefs', cache)
  return cache
}

export const savedApproval = (): boolean => getPrefs().approval
export const saveApproval = (on: boolean): void => void setPrefs({ approval: on })

export const volumeKey = (kind: 'mic' | 'screen', name: string): string => `${kind}:${name}`

// ---------- salas recentes ----------

export interface RecentRoom {
  roomId: string
  /** nome da sala ("servidor"); salas antigas não têm */
  name?: string
  /** quem estava na sala da última vez (para reconhecer) */
  people: string[]
  host: boolean
  at: number
}

const MAX_RECENT = 6

export const recentRooms = (): RecentRoom[] => loadJson<RecentRoom[]>('recent', []).filter((r) => r && r.roomId)

export function rememberRoom(room: Omit<RecentRoom, 'at'>): void {
  const list = recentRooms().filter((r) => r.roomId !== room.roomId)
  list.unshift({ ...room, at: Date.now() })
  saveJson('recent', list.slice(0, MAX_RECENT))
}

export function forgetRoom(roomId: string): RecentRoom[] {
  const list = recentRooms().filter((r) => r.roomId !== roomId)
  saveJson('recent', list)
  return list
}
