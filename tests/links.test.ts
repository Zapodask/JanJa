import { describe, expect, it } from 'vitest'
import { roomCodeFromArgv, roomCodeFromDeepLink } from '../src/main/links'

const room = 'https://abc-def.trycloudflare.com/#t=XyZ_123'
const deep = `janja://join?code=${encodeURIComponent(room)}`

describe('deep link janja://', () => {
  it('extrai o link da sala, inclusive com a barra que o Chrome adiciona', () => {
    expect(roomCodeFromDeepLink(deep)).toBe(room)
    expect(roomCodeFromDeepLink(`janja://join/?code=${encodeURIComponent(room)}`)).toBe(room)
  })

  it('acha o link no argv da segunda instância (Windows)', () => {
    expect(roomCodeFromArgv(['C:\\JanJa\\JanJa.exe', '--allow-file-access', deep])).toBe(room)
    expect(roomCodeFromArgv(['JanJa.exe'])).toBeNull()
  })

  it('ignora links que não são de sala', () => {
    expect(roomCodeFromDeepLink('janja://join?code=javascript:alert(1)')).toBeNull()
    expect(roomCodeFromDeepLink('https://exemplo.com')).toBeNull()
  })
})
