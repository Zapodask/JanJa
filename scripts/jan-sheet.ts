import { writeFileSync } from 'node:fs'
import { POSES, TV_FRAMES, spriteToSvg } from '../src/web/ui/pixelData'

const cell = (svg: string, label: string) => `<figure>${svg}<figcaption>${label}</figcaption></figure>`
const rows = Object.entries(POSES)
  .map(
    ([name, def]) =>
      `<section><h2>${name} <small>${def.frames.length} quadros, ${def.ms} ms por passo, ciclo ${def.seq.join(' ')}</small></h2><div>${def.frames
        .map((f, i) => cell(spriteToSvg(f, 4), `${name} ${i}`))
        .join('')}</div></section>`
  )
  .join('')
const tv = `<section><h2>tv <small>desligada, linha, abrindo, flash, ligada</small></h2><div>${TV_FRAMES.map((f, i) => cell(spriteToSvg(f, 4), `tv ${i}`)).join('')}</div></section>`
const html = `<!doctype html><meta charset="utf-8"><title>Jan</title><style>
body{background:#221C19;color:#F3EBDD;font:15px system-ui;margin:24px}h2{font-size:15px}small{color:#B7A99A;font-weight:400}
section div{display:flex;gap:16px;flex-wrap:wrap}figure{margin:0}svg{display:block;background:#2E2622;image-rendering:pixelated}
figcaption{font-size:12px;color:#B7A99A;margin-top:4px}</style>${rows}${tv}`
writeFileSync(process.argv[2] ?? '/home/claude/shots/jan-sheet.html', html)
console.log('ok')
