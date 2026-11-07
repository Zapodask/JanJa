import { describe, expect, it } from 'vitest'
import { MAX_HEADER, cleanMessage, validateCommit } from '../scripts/commit-rules'

const ok = (m: string) => expect(validateCommit(m), m).toMatchObject({ ok: true })
const bad = (m: string, re: RegExp) => {
  const r = validateCommit(m)
  expect(r.ok, m).toBe(false)
  expect(r.errors.join(' | '), m).toMatch(re)
}

describe('padrão de commits', () => {
  it('aceita tipo com e sem escopo', () => {
    ok('feat(camera): clique para maximizar')
    ok('fix: tela preta para quem assiste')
    ok('test(poker): desempate pela carta de fora')
    ok('chore(release): helper 0.1.3')
    ok('refactor(tela)!: troca o formato do estado da sala')
    ok('feat(ui): Jan passeia por todo o espaço livre')
  })
  it('aceita corpo depois de uma linha em branco', () => {
    ok('fix(poker): explica o desempate\n\nAntes aparecia "Par de 8 bateu Par de 8".')
  })
  it('ignora merges, reverts do git e fixups', () => {
    for (const m of ['Merge branch \'main\' of github.com:x/y', 'Merge pull request #3 from x/y', 'Revert "feat: x"', 'fixup! feat: x'])
      expect(validateCommit(m)).toMatchObject({ ok: true, skipped: true })
  })
  it('recusa os formatos antigos do repositório', () => {
    bad('Camera: clique para maximizar', /"Camera" não é um tipo/)
    bad('fix black screen', /título precisa/)
    bad('0.1.3', /título precisa/)
    bad('first commit', /título precisa/)
    bad('feat transaction project to web', /título precisa/)
  })
  it('tipo e escopo precisam existir', () => {
    bad('feature: x y z', /Tipo "feature" não existe/)
    bad('Feat: x y z', /minúsculas: "feat"/)
    bad('feat(webcam): liga a câmera', /Escopo "webcam" não existe/)
    bad('feat(): liga a câmera', /parênteses do escopo estão vazios/)
  })
  it('formato da descrição', () => {
    bad('feat:sem espaço', /título precisa/)
    bad('feat: ok.', /curta demais|ponto/)
    bad('feat(camera): liga a câmera.', /não termina com ponto/)
    bad('feat: ' + 'a'.repeat(MAX_HEADER), /máximo é 72/)
    bad('feat: título\ncorpo colado', /linha em branco/)
    bad('', /vazia/)
  })
  it('descarta comentários do editor e o diff do commit -v', () => {
    const raw = 'feat(camera): liga a câmera\n# Please enter the commit message\n# ------------------------ >8 ------------------------\ndiff --git a b'
    expect(cleanMessage(raw)).toBe('feat(camera): liga a câmera')
    ok(raw)
  })
})
