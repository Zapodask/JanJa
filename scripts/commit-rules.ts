/**
 * Padrão de commits do JanJa (Conventional Commits em português):
 *
 *   tipo(escopo): descrição
 *
 * Ex.: "feat(camera): clique para maximizar", "fix(tela): tela preta ao entrar com som".
 * Regras puras (sem git, sem fs) para o hook, o CI e os testes usarem as mesmas.
 */

export const TYPES = {
  feat: 'funcionalidade nova',
  fix: 'correção de bug',
  test: 'só testes',
  refactor: 'muda o código sem mudar o comportamento',
  style: 'visual, CSS ou formatação, sem mudar a lógica',
  perf: 'desempenho (bitrate, CPU, tamanho do bundle)',
  docs: 'documentação (README, docs/, comentários)',
  build: 'build, dependências, Vite, Wrangler, Cargo',
  ci: 'GitHub Actions, hooks, validação de commits',
  chore: 'manutenção que não entra em nenhum outro tipo',
  revert: 'desfaz um commit anterior'
} as const

export type CommitType = keyof typeof TYPES

/** Escopos opcionais: a parte do JanJa que mudou. */
export const SCOPES = {
  sala: 'entrar, aprovação, pessoas, link, reconexão',
  tela: 'compartilhar tela, qualidade, WebRTC, ultrawide',
  camera: 'webcam',
  audio: 'microfone, saída de áudio, sons de aviso',
  controle: 'controle remoto no site',
  helper: 'o app JanJa Helper (Rust)',
  jogos: 'plataforma de jogos da sala',
  poker: 'mesa de poker: regras, cena, música, HUD',
  golfe: 'mini-golfe 3D: física, mapas, cena, HUD',
  xadrez: 'xadrez: regras, relógio, tabuleiro, HUD',
  damas: 'damas: regras, tabuleiro, HUD',
  magnata: 'Magnata: regras, tabuleiro, cartas, HUD',
  tiro: 'Tiro na Sala: simulação, rede, mapas, cena, HUD',
  truco: 'truco gaudério: regras, mesa, HUD',
  naval: 'batalha naval: frota, tiros, mares, HUD',
  misterio: 'Mistério: cartas, palpites, caderno, HUD',
  sinuca: 'sinuca: física, regras da bola 8, mesa, HUD',
  stop: 'Stop (adedonha): letras, categorias, conferência, HUD',
  tour: 'tour guiado',
  jan: 'o mascote Jan',
  ui: 'visual geral, tela inicial, componentes',
  worker: 'Cloudflare Worker e Durable Object',
  deps: 'dependências',
  release: 'versões publicadas'
} as const

export const MAX_HEADER = 72

export interface CommitCheck {
  ok: boolean
  /** a mensagem foi ignorada (merge, revert automático, fixup...) */
  skipped: boolean
  errors: string[]
  type?: string
  scope?: string
}

const HEADER = /^([a-z]+)(?:\(([^()\s]*)\))?(!)?: (.*)$/

/** Linhas que o git descarta (comentários do editor) e o diff do `commit -v`. */
export function cleanMessage(raw: string): string {
  const cut = raw.split(/^# -+ >8 -+$/m)[0]
  return cut
    .split(/\r?\n/)
    .filter((l) => !l.startsWith('#'))
    .join('\n')
    .trim()
}

/** Mensagens geradas pelo git que não seguem o padrão e tudo bem. */
export function isAutomatic(header: string): boolean {
  return /^(Merge (branch|pull request|remote-tracking branch|tag|commit) |Revert ")/.test(header) || /^(fixup|squash|amend)! /.test(header)
}

export function validateCommit(raw: string): CommitCheck {
  const msg = cleanMessage(raw)
  const lines = msg.split('\n')
  const header = lines[0] ?? ''
  if (!msg) return { ok: false, skipped: false, errors: ['A mensagem está vazia.'] }
  if (isAutomatic(header)) return { ok: true, skipped: true, errors: [] }

  const errors: string[] = []
  const m = HEADER.exec(header)
  if (!m) {
    const caps = /^([A-Za-zÀ-ÿ]+)(\([^)]*\))?: /.exec(header)
    if (caps && caps[1].toLowerCase() in TYPES) errors.push(`O tipo vai em minúsculas: "${caps[1].toLowerCase()}".`)
    else if (caps) errors.push(`"${caps[1]}" não é um tipo. Comece com um destes: ${Object.keys(TYPES).join(', ')}. Ex.: "feat(camera): ..."`)
    else errors.push('O título precisa ser "tipo(escopo): descrição" ou "tipo: descrição", com dois-pontos e um espaço.')
    return { ok: false, skipped: false, errors }
  }
  const [, type, scope, , desc] = m
  if (!(type in TYPES)) errors.push(`Tipo "${type}" não existe. Use um destes: ${Object.keys(TYPES).join(', ')}.`)
  if (scope !== undefined) {
    if (scope === '') errors.push('Os parênteses do escopo estão vazios. Tire "()" ou escreva o escopo.')
    else if (!(scope in SCOPES)) errors.push(`Escopo "${scope}" não existe. Use um destes: ${Object.keys(SCOPES).join(', ')} (ou nenhum).`)
  }
  const d = desc.trim()
  if (d.length < 3) errors.push('A descrição depois de ":" está curta demais.')
  if (desc !== d) errors.push('Tire os espaços sobrando na descrição.')
  if (/[.!]$/.test(d) && !/\.\.\.$/.test(d)) errors.push('A descrição não termina com ponto.')
  if (header.length > MAX_HEADER) errors.push(`O título tem ${header.length} caracteres; o máximo é ${MAX_HEADER}. Detalhes vão no corpo, depois de uma linha em branco.`)
  if (lines.length > 1 && lines[1].trim() !== '') errors.push('Deixe uma linha em branco entre o título e o corpo.')
  return { ok: errors.length === 0, skipped: false, errors, type, scope }
}

/** Texto de ajuda que o hook e o CI mostram quando a mensagem é recusada. */
export function helpText(): string {
  const types = Object.entries(TYPES).map(([k, v]) => `  ${k.padEnd(9)}${v}`).join('\n')
  const scopes = Object.entries(SCOPES).map(([k, v]) => `  ${k.padEnd(9)}${v}`).join('\n')
  return [
    'Padrão: tipo(escopo): descrição    (o escopo é opcional)',
    '',
    'Exemplos:',
    '  feat(camera): clique para maximizar',
    '  fix(tela): tela preta para quem assiste',
    '  test(poker): desempate pela carta de fora',
    '  chore(release): helper 0.1.3',
    '',
    'Tipos:',
    types,
    '',
    'Escopos:',
    scopes,
    '',
    'Mais em docs/COMMITS.md'
  ].join('\n')
}
