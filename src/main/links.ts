import pkg from '../../package.json'

/** Esquema registrado no Windows pelo instalador: janja://join?code=<link da sala> */
export const PROTOCOL = 'janja'

/** Página de download das releases, derivada do campo `repository` do package.json. */
export function releasesUrl(): string | undefined {
  const raw = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
  const match = raw?.match(/github\.com[/:]([^/]+)\/([^/.]+)/)
  if (!match || match[1] === 'SEU_USUARIO') return undefined
  return `https://github.com/${match[1]}/${match[2]}/releases/latest`
}

/** Extrai o link da sala de um deep link, ou de um argv que contenha um. */
export function roomCodeFromDeepLink(input: string): string | null {
  if (!input.toLowerCase().startsWith(`${PROTOCOL}:`)) return null
  try {
    const url = new URL(input)
    const code = url.searchParams.get('code')
    return code && /^(https?|wss?):\/\//.test(code) ? code : null
  } catch {
    return null
  }
}

export function roomCodeFromArgv(argv: string[]): string | null {
  for (const arg of argv) {
    const code = roomCodeFromDeepLink(arg)
    if (code) return code
  }
  return null
}
