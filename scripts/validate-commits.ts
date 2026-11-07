/**
 * Valida mensagens de commit no padrão do JanJa (docs/COMMITS.md).
 *
 *   npm run validate-commits                       último commit
 *   npm run validate-commits -- --file <arquivo>   mensagem num arquivo (hook commit-msg)
 *   npm run validate-commits -- --range A..B       todos os commits de A até B (CI)
 *   npm run validate-commits -- --message "feat: x"
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { helpText, validateCommit } from './commit-rules'

interface Item {
  ref: string
  message: string
}

const git = (args: string[]) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

const exists = (ref: string): boolean => {
  try {
    git(['cat-file', '-e', `${ref}^{commit}`])
    return true
  } catch {
    return false
  }
}

/**
 * Commits do intervalo, sem merges.
 * - início só de zeros (branch nova no push): só o último commit;
 * - início que não existe mais (push forçado, histórico reescrito): o histórico inteiro até o fim.
 */
function commitsIn(range: string): Item[] {
  const [from, to] = range.split('..')
  let args: string[]
  if (!to) args = ['-1', from]
  else if (/^0+$/.test(from)) args = ['-1', to]
  else if (!exists(from)) args = [to]
  else args = [range]
  const out = git(['log', '--no-merges', '--format=%h%x00%B%x1e', ...args])
  return out
    .split('\x1e')
    .map((s) => s.replace(/^\s+/, ''))
    .filter(Boolean)
    .map((s) => {
      const [ref, message] = s.split('\x00')
      return { ref, message: message ?? '' }
    })
}

function parseArgs(argv: string[]): Item[] {
  const at = (flag: string) => {
    const i = argv.indexOf(flag)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const file = at('--file')
  if (file) return [{ ref: 'mensagem', message: readFileSync(file, 'utf8') }]
  const message = at('--message')
  if (message !== undefined) return [{ ref: 'mensagem', message }]
  const range = at('--range')
  if (range) return commitsIn(range)
  return commitsIn('HEAD')
}

function main(): number {
  let items: Item[]
  try {
    items = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(`validate-commits: não deu para ler os commits (${err instanceof Error ? err.message : String(err)})`)
    return 2
  }
  let bad = 0
  for (const it of items) {
    const r = validateCommit(it.message)
    const header = it.message.trim().split(/\r?\n/)[0] ?? ''
    if (r.ok) {
      if (items.length > 1) console.log(`ok  ${it.ref}  ${header}${r.skipped ? '  (ignorado)' : ''}`)
      continue
    }
    bad++
    console.error(`\nX   ${it.ref}  ${header}`)
    for (const e of r.errors) console.error(`    - ${e}`)
  }
  if (bad) {
    console.error(`\n${bad === 1 ? 'Mensagem de commit fora do padrão.' : `${bad} mensagens de commit fora do padrão.`}\n`)
    console.error(helpText())
    return 1
  }
  if (items.length > 1) console.log(`\n${items.length} commits no padrão.`)
  return 0
}

process.exit(main())
