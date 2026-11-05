/**
 * Teste ponta a ponta do mesh: 3 abas do Chrome entram numa sala real (SignalingServer),
 * uma compartilha, as outras recebem; depois uma segunda compartilha junto, e a primeira para.
 *
 *   npm run test:e2e            (usa o Chrome instalado; outro caminho: CHROME_PATH=...)
 */
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import puppeteer, { type Page } from 'puppeteer-core'
import { buildRoomCode } from '../../src/shared/protocol'
import { SignalingServer } from '../../src/main/signaling/server'

const here = dirname(fileURLToPath(import.meta.url))
const chromePath =
  process.env.CHROME_PATH ??
  (process.platform === 'win32'
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : '/usr/bin/google-chrome')

const bundle = await build({
  entryPoints: [join(here, 'harness.ts')],
  bundle: true,
  write: false,
  format: 'esm',
  alias: { '@shared': join(here, '../../src/shared') }
})
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

const signaling = new SignalingServer({ host: '127.0.0.1', port: 0, token: 'e2e', iceServers: [] })
const wsPort = await signaling.start()
const code = buildRoomCode(`ws://127.0.0.1:${wsPort}/`, 'e2e')

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

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

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
    ids.push(await page.evaluate((c, n) => window.harness.join(c, n), code, name))
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
  await signaling.stop()
  http.close()
}
