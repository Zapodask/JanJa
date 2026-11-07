// Liga os hooks do repositório (.githooks) no `npm install`. Fora de um repositório git (build da Cloudflare, zip) não faz nada.
import { execFileSync } from 'node:child_process'

try {
  execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' })
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' })
} catch {
  // sem git aqui: tudo bem
}
