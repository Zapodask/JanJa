/**
 * Teste ponta a ponta do mesh contra o Worker real rodando local (wrangler dev):
 * 3 abas do Chrome entram na mesma sala, compartilham, param, colidem e saem.
 *
 *   npm run test:e2e        (usa o Chrome instalado; outro caminho: CHROME_PATH=...)
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import puppeteer, { type Page } from 'puppeteer-core'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '../..')
const chromePath =
  process.env.CHROME_PATH ??
  (process.platform === 'win32'
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : '/usr/bin/google-chrome')

const WORKER_PORT = Number(process.env.E2E_PORT ?? 8799)
const origin = `http://127.0.0.1:${WORKER_PORT}`

// sobe o Worker (sinalização + Durable Objects) localmente
const worker = spawn('npx', ['wrangler', 'dev', '--port', String(WORKER_PORT), '--ip', '127.0.0.1'], {
  cwd: root,
  shell: process.platform === 'win32',
  stdio: ['ignore', 'pipe', 'pipe']
})
let workerLog = ''
worker.stdout.on('data', (d) => (workerLog += d))
worker.stderr.on('data', (d) => (workerLog += d))
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
for (let i = 0; ; i++) {
  try {
    const res = await fetch(`${origin}/api/rooms`, { method: 'POST', body: JSON.stringify({ requireApproval: false }) })
    if (res.status === 201) break
  } catch {
    /* ainda subindo */
  }
  if (i > 120) throw new Error(`wrangler dev não subiu:\n${workerLog.slice(-1500)}`)
  await wait(500)
}
const { roomId } = (await (
  await fetch(`${origin}/api/rooms`, { method: 'POST', body: JSON.stringify({ requireApproval: false }) })
).json()) as { roomId: string }

const bundle = await build({ entryPoints: [join(here, 'harness.ts')], bundle: true, write: false, format: 'esm' })
const js = bundle.outputFiles[0].text
const http = createServer((req, res) => {
  if (req.url === '/harness.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' })
    return res.end(js)
  }
  res.writeHead(200, { 'content-type': 'text/html' })
  res.end('<!doctype html><script type="module" src="/harness.js"></script>')
})
await new Promise<void>((r) => http.listen(0, '127.0.0.1', r))
const httpPort = (http.address() as { port: number }).port

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--no-sandbox'
  ]
})


async function until<T>(label: string, fn: () => Promise<T>, ok: (v: T) => boolean, timeout = 15_000): Promise<T> {
  const start = Date.now()
  let last: T | undefined
  while (Date.now() - start < timeout) {
    last = await fn()
    if (ok(last)) return last
    await wait(250)
  }
  throw new Error(`${label}: não aconteceu a tempo. Último valor: ${JSON.stringify(last)}`)
}

type View = { id: string; name: string; route: string; sharing: boolean; screenVideo: number; screenAudio: number; micAudio: number }
const views = (p: Page) => p.evaluate(() => window.harness.views()) as Promise<View[]>

try {
  const pages: Page[] = []
  const ids: string[] = []
  for (const name of ['Ana', 'Bia', 'Caio']) {
    const page = await browser.newPage()
    page.on('pageerror', (e) => console.error(`[${name}]`, e))
    page.on('console', (m) => process.env.E2E_DEBUG && console.log(`[${name}] ${m.text()}`))
    await page.goto(`http://127.0.0.1:${httpPort}/`)
    await page.waitForFunction(() => 'harness' in window)
    ids.push(await page.evaluate((o, r, n) => window.harness.join(o, r, n), origin, roomId, name))
    pages.push(page)
  }
  const [ana, bia, caio] = pages
  const [anaId, biaId] = ids

  for (const [i, p] of pages.entries()) {
    await until(`peer ${i} conectado aos outros 2`, () => views(p), (v) => v.length === 2 && v.every((x) => x.route === 'direto' && x.micAudio === 1))
  }
  console.log('ok  3 peers conectados em mesh, direto, com microfone')

  await ana.evaluate(() => window.harness.share())
  for (const p of [bia, caio]) {
    const v = await until('tela da Ana chegou', () => views(p), (v) => v.some((x) => x.id === anaId && x.sharing && x.screenVideo === 1 && x.screenAudio === 1))
    assert.equal(v.find((x) => x.id === anaId)?.micAudio, 1, 'microfone separado do áudio da tela')
    assert.ok(await p.evaluate((id) => window.harness.videoLive(id), anaId), 'frames de vídeo chegando')
  }
  console.log('ok  Ana compartilha: Bia e Caio recebem vídeo + áudio da tela, mic separado')

  await bia.evaluate(() => window.harness.share())
  await until('Caio recebe as 2 telas', () => views(caio), (v) => v.filter((x) => x.sharing && x.screenVideo === 1).length === 2)
  await until('Ana recebe a tela da Bia', () => views(ana), (v) => v.some((x) => x.id === biaId && x.screenVideo === 1))
  assert.ok(await caio.evaluate((id) => window.harness.videoLive(id), biaId))
  console.log('ok  Bia compartilha junto: duas telas simultâneas (renegociação sem colisão)')

  await ana.evaluate(() => window.harness.stop())
  await until('tela da Ana some para o Caio', () => views(caio), (v) => !v.find((x) => x.id === anaId)?.sharing && v.find((x) => x.id === biaId)?.screenVideo === 1)
  console.log('ok  Ana para: a tela dela some e a da Bia continua')

  await Promise.all([ana.evaluate(() => window.harness.share()), caio.evaluate(() => window.harness.share())])
  await until('Bia recebe as telas de Ana e Caio', () => views(bia), (v) => v.filter((x) => x.sharing && x.screenVideo === 1).length === 2)
  await until('Ana recebe Bia e Caio', () => views(ana), (v) => v.filter((x) => x.sharing && x.screenVideo === 1).length === 2)
  await until('Caio recebe Ana e Bia', () => views(caio), (v) => v.filter((x) => x.sharing && x.screenVideo === 1).length === 2)
  console.log('ok  Ana e Caio começam ao mesmo tempo: colisão de ofertas resolvida, 3 telas no ar')

  await caio.close()
  await until('Caio saiu para a Ana', () => views(ana), (v) => v.length === 1)
  console.log('ok  Caio sai: os outros removem o peer')
  console.log('\nE2E OK')
} finally {
  await browser.close()
  http.close()
  worker.kill()
}
