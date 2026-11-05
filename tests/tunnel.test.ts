import { describe, expect, it } from 'vitest'
import { parseTunnelOutput } from '../src/main/tunnel/cloudflared'

describe('parseTunnelOutput', () => {
  it('acha o link da sala no quadro que o cloudflared imprime', () => {
    const log = [
      'INF Requesting new quick Tunnel on trycloudflare.com...',
      'INF +--------------------------------------------------------------------------------------------+',
      'INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |',
      'INF |  https://brave-lion-pages-ten.trycloudflare.com                                            |'
    ].join('\n')
    expect(parseTunnelOutput(log)).toEqual({ url: 'https://brave-lion-pages-ten.trycloudflare.com' })
  })

  it('não confunde api.trycloudflare.com com o link e reporta a falha', () => {
    const log =
      'INF Requesting new quick Tunnel on trycloudflare.com...\n' +
      'failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": dial tcp: no such host'
    const result = parseTunnelOutput(log)
    expect(result && 'error' in result && result.error).toMatch(/^failed to request quick Tunnel/)
  })

  it('retorna null enquanto não há nada conclusivo', () => {
    expect(parseTunnelOutput('INF Requesting new quick Tunnel on trycloudflare.com...')).toBeNull()
  })
})
