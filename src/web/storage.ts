import { MAX_NAME_LENGTH } from '../shared/protocol'

function load(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* armazenamento indisponível: segue sem lembrar */
  }
}

export const cleanName = (name: string): string => name.trim().slice(0, MAX_NAME_LENGTH)

export const savedName = (): string => cleanName(load('janja.name'))
export const saveName = (name: string): void => save('janja.name', cleanName(name))

/** A chave de host fica no navegador de quem criou a sala: recarregar a página mantém o papel. */
export const hostKeyFor = (roomId: string): string | undefined => load(`janja.host.${roomId}`) || undefined
export const saveHostKey = (roomId: string, key: string): void => save(`janja.host.${roomId}`, key)

export const savedApproval = (): boolean => load('janja.approval') !== 'false'
export const saveApproval = (on: boolean): void => save('janja.approval', String(on))
