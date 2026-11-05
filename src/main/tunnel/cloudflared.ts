import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { install } from 'cloudflared'

// o link da sala é um subdomínio aleatório; api.trycloudflare.com aparece nos logs e não serve
const TUNNEL_URL_RE = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/i
const TUNNEL_FAILED_RE = /failed to request quick Tunnel[^\n]*/i

/** Lê a saída acumulada do cloudflared: o link da sala, um erro, ou nada ainda. */
export function parseTunnelOutput(log: string): { url: string } | { error: string } | null {
  const failed = TUNNEL_FAILED_RE.exec(log)
  if (failed) return { error: failed[0] }
  const match = TUNNEL_URL_RE.exec(log)
  return match ? { url: match[0] } : null
}

export interface QuickTunnel {
  /** https://xxxx.trycloudflare.com */
  url: string
  stop: () => void
}

/**
 * Garante o binário do cloudflared em `binDir` (baixa do GitHub da Cloudflare na primeira vez).
 * Fica fora do asar para poder ser executado.
 */
export async function ensureCloudflared(binDir: string, onStatus?: (msg: string) => void): Promise<string> {
  const exe = join(binDir, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared')
  if (existsSync(exe)) return exe
  mkdirSync(dirname(exe), { recursive: true })
  onStatus?.('Baixando o cloudflared (só na primeira vez)...')
  await install(exe)
  return exe
}

/** Sobe um Cloudflare Quick Tunnel (sem conta) apontando para o servidor local. */
export function startQuickTunnel(exe: string, localPort: number, timeoutMs = 30_000): Promise<QuickTunnel> {
  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn(
      exe,
      ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${localPort}`],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
    )
    let settled = false
    let log = ''

    const stop = (): void => {
      if (child.exitCode === null && !child.killed) child.kill()
    }

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      stop()
      reject(new Error(`O túnel não respondeu em ${timeoutMs / 1000}s.\n${log.slice(-800)}`))
    }, timeoutMs)

    const onData = (chunk: Buffer): void => {
      log += chunk.toString()
      if (settled) return
      const result = parseTunnelOutput(log)
      if (!result) return
      settled = true
      clearTimeout(timer)
      if ('url' in result) return resolve({ url: result.url, stop })
      stop()
      reject(
        new Error(`A Cloudflare não criou o túnel. Confira a internet ou use o modo Rede local/Tailscale.\n${result.error}`)
      )
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)

    child.once('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(err)
    })
    child.once('exit', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error(`cloudflared saiu com código ${code}.\n${log.slice(-800)}`))
    })
  })
}
