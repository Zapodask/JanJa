# Padrão de commits

O JanJa usa [Conventional Commits](https://www.conventionalcommits.org/pt-br/), com a descrição em português:

```
tipo(escopo): descrição
```

- **tipo**: o que o commit faz (lista abaixo). Sempre em minúsculas.
- **escopo**: opcional, a parte do JanJa que mudou.
- **descrição**: curta, sem ponto final. O título inteiro tem no máximo 72 caracteres.
- Detalhes vão no corpo, depois de uma linha em branco.
- Mudança que quebra compatibilidade (ex.: protocolo da sala) leva `!`: `refactor(sala)!: novo formato do estado`.

```
feat(camera): clique para maximizar
fix(tela): tela preta para quem assiste
test(poker): desempate pela carta de fora
style(ui): botões com hover novo
chore(release): helper 0.1.3
```

## Tipos

| tipo | quando usar |
|---|---|
| `feat` | funcionalidade nova |
| `fix` | correção de bug |
| `test` | só testes |
| `refactor` | muda o código sem mudar o comportamento |
| `style` | visual, CSS ou formatação, sem mudar a lógica |
| `perf` | desempenho (bitrate, CPU, tamanho do bundle) |
| `docs` | documentação (README, docs/, comentários) |
| `build` | build, dependências, Vite, Wrangler, Cargo |
| `ci` | GitHub Actions, hooks, validação de commits |
| `chore` | manutenção que não entra em nenhum outro tipo |
| `revert` | desfaz um commit anterior |

## Escopos

| escopo | parte do JanJa |
|---|---|
| `sala` | entrar, aprovação, pessoas, link, reconexão |
| `tela` | compartilhar tela, qualidade, WebRTC, ultrawide |
| `camera` | webcam |
| `audio` | microfone, saída de áudio, sons de aviso |
| `controle` | controle remoto no site |
| `helper` | o app JanJa Helper (Rust) |
| `jogos` | plataforma de jogos da sala |
| `poker` | mesa de poker: regras, cena, música, HUD |
| `golfe` | mini-golfe 3D: física, mapas, cena, HUD |
| `xadrez` | xadrez: regras, relógio, tabuleiro, HUD |
| `damas` | damas: regras, tabuleiro, HUD |
| `magnata` | Magnata: regras, tabuleiro, cartas, HUD |
| `tiro` | Tiro na Sala: simulação, rede, mapas, cena, HUD |
| `truco` | truco gaudério: regras, mesa, HUD |
| `naval` | batalha naval: frota, tiros, mares, HUD |
| `misterio` | Mistério: cartas, palpites, caderno, HUD |
| `sinuca` | sinuca: física, regras da bola 8, mesa, HUD |
| `stop` | Stop (adedonha): letras, categorias, conferência, HUD |
| `tour` | tour guiado |
| `jan` | o mascote Jan |
| `ui` | visual geral, tela inicial, componentes |
| `worker` | Cloudflare Worker e Durable Object |
| `deps` | dependências |
| `release` | versões publicadas |

Escopo novo: acrescente em `scripts/commit-rules.ts` e nesta tabela no mesmo commit.

## Validação

- **No seu PC**: o hook `commit-msg` (pasta `.githooks`) recusa o commit e mostra o que corrigir. Ele é ligado sozinho no `npm install`. Numa emergência: `git commit --no-verify`.
- **No GitHub**: o workflow `commits` valida os commits de cada push e de cada pull request.
- **À mão**: `npm run validate-commits` (último commit), `npm run validate-commits -- --range origin/main..HEAD` ou `npm run validate-commits -- --message "feat: x"`.

Merges, `Revert "..."` gerado pelo git e `fixup!`/`squash!` são ignorados.

## Histórico renomeado

Os 23 primeiros commits foram feitos antes do padrão e foram renomeados em 07/11/2026 (`git filter-branch`, com push forçado). Por isso os hashes antigos abaixo não existem mais no GitHub; ficam aqui só como referência. As tags `v0.1.x` e `helper-v0.1.x` foram movidas para os commits novos.

| hash antigo | antes | depois |
|---|---|---|
| `a3ba9c0` | Camera: clique para maximizar | `feat(camera): clique para maximizar` |
| `bb2506d` | Webcam na sala: palco, faixa e canto da mesa | `feat(camera): webcam no palco, na faixa e no canto da mesa` |
| `47161f7` | Poker: selects fecham, texto nitido, sem sobreposicao na mesa | `fix(poker): selects fecham, texto nítido e sem sobreposição` |
| `f94648a` | Poker na sala: mesa em pixel art, servidor do jogo, musica e sons | `feat(poker): mesa em pixel art, servidor do jogo, música e sons` |
| `a6bbb3c` | Jan passeia por todo o espaço livre da tela inicial | `feat(jan): passeia por todo o espaço livre da tela inicial` |
| `7472107` | fix black screen | `fix(tela): tela preta para quem assiste` |
| `9154c27` | ultrawide: mantém proporção, bitrate por pixels, H.264 em movimento | `perf(tela): ultrawide nítido, bitrate por pixel e H.264` |
| `17d8941` | pergunta do tour na primeira visita | `feat(tour): pergunta na primeira visita` |
| `677cee8` | tour guiado com driver.js | `feat(tour): tour guiado com driver.js` |
| `91f27bd` | som de toc-toc no pedido de controle | `feat(audio): toc-toc no pedido de controle` |
| `58374c2` | helper 0.1.2: domínio spotlightre | `chore(release): helper 0.1.2 com domínio spotlightre` |
| `9c4e893` | helper: workflow no lugar certo, download no site | `ci(helper): workflow no lugar certo e download no site` |
| `c4a166f` | controle remoto + JanJa Helper | `feat(controle): controle remoto e JanJa Helper` |
| `5e41955` | Jan, o mascote pixel art | `feat(jan): mascote em pixel art` |
| `b49b91e` | visual v2 | `style(ui): visual v2` |
| `69191bc` | redesign: visual novo, fullscreen, mic desligado por padrão, preferências salvas | `feat(ui): visual novo, tela cheia, mic mudo e preferências salvas` |
| `87482a8` | remove restos do app desktop (Electron) | `chore: remove restos do app desktop (Electron)` |
| `7c11692` | feat transaction project to web | `feat: projeto migrado para a web` |
| `37e49a7` | 0.1.3 | `chore(release): 0.1.3` |
| `1d0e80d` | 0.1.2 | `chore(release): 0.1.2` |
| `8e3c839` | fix github | `ci: corrige o workflow do GitHub` |
| `0804a51` | 0.1.1 | `chore(release): 0.1.1` |
| `e33b9ae` | first commit | `chore: commit inicial` |
