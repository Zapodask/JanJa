# CLAUDE.md

Guia para quem (humano ou IA) for mexer no JanJa. Leia antes de mudar código.

## O que é

Site para amigos compartilharem tela, voz e câmera e jogarem poker, truco, sinuca, Stop, batalha naval, Mistério, mini-golfe, xadrez, damas, Magnata e um tiroteio pixel (Tiro na Sala) juntos, direto do navegador. React 19 + Vite + TypeScript estrito no front; Cloudflare Worker com um Durable Object por sala (`Room`, Hibernation API, SQLite) no back. A mídia vai P2P em mesh WebRTC; o servidor só faz sinalização e roda os jogos. Há também o **JanJa Helper** (`helper/`, Rust, Windows) para controle remoto.

Produção: https://janja.spotlightre.workers.dev (deploy automático da Cloudflare a cada push na `main`).

## Comandos

```bash
npm run dev               # build + wrangler dev em http://localhost:8787
npx vite                  # só o front (rotas de laboratório /dev/poker, /dev/golf e /dev/audio)
npm run typecheck         # 3 tsconfigs: web, worker, testes
npm test                  # vitest (ambiente node)
npm run test:e2e          # Chrome de verdade contra o wrangler dev
npm run sprites           # regenera public/game/sprites.{png,json} a partir de src/web/game/art
npm run icons             # regenera public/icons/icon-{192,512}.png (TV) e public/favicon.svg (Jan fazendo o L) a partir de src/web/ui/pixelData.ts
npm run validate-commits  # confere a mensagem do último commit
cd helper && cargo test   # helper (em Linux a injeção de input é um stub)
```

Antes de entregar qualquer mudança: `npm run typecheck && npm test && npx vite build`.

## Mapa

| Onde | O quê |
|---|---|
| `src/shared/protocol.ts` | mensagens cliente/servidor (zod), `PeerState`, canais com limite (`RoomSettings`, `Channel.limit`), chat (`ChatMessage`), teto da sala `MAX_PEERS = 100` |
| `src/web/ui/Channels.tsx` | canais na barra lateral em árvore compacta (entrar, criar, renomear, apagar), "Outras salas" e o rodapé "Baixar" |
| `src/web/ui/ChatPanel.tsx` | chat do canal: coluna à direita, no lugar da tela (`cheio`) ou fechado com contador |
| `src/web/ui/logo.ts` | logo "JANJA" em pixel art gerada em código (letras, sombra e contorno); desenhada pelo `Brand` (`Brand.tsx`). Na sala, clicar na logo volta ao início |
| `src/web/favicon.ts` | favicon animado: troca o `<link rel="icon">` pelos quadros da pose `ell` (Jan fazendo o L); parado com "reduzir movimento" |
| `src/web/install.ts` | instalar o JanJa como app (PWA): guarda o `beforeinstallprompt`; manifesto em `public/manifest.webmanifest` |
| `src/shared/control.ts` | protocolo do controle remoto (canal de dados id 7) |
| `src/shared/games/` | plataforma de jogos (`types.ts`, `protocol.ts`, `registry.ts`) e o poker (`poker/engine.ts`, `evaluate.ts`, `describe.ts`) |
| `src/shared/games/golf/` | mini-golfe: buraco em ASCII (`course.ts`), física determinística (`physics.ts`), motor simultâneo (`engine.ts`) e mapas (`maps/`) |
| `src/web/game/golf/scene/` | cena 3D do golfe em Three.js (`engine.ts`) e geometria pura do buraco (`geometry.ts`); HUD em `src/web/ui/GolfHud.tsx` |
| `src/shared/games/chess/` | xadrez: regras puras (`rules.ts`: lances, SAN, FEN, perft), motor da sala com relógio (`engine.ts`) |
| `src/web/game/chess/scene/` | tabuleiro do xadrez em SVG (`ChessScene.tsx`) e peças em pixel art (`pieces.ts`); HUD em `src/web/ui/ChessHud.tsx` |
| `src/shared/games/checkers/` | damas brasileiras: regras puras (`rules.ts`) e motor da sala (`engine.ts`); tabuleiro em `src/web/game/checkers/scene/`, HUD em `src/web/ui/CheckersHud.tsx` |
| `src/shared/games/tycoon/` | Magnata (jogo rápido de comprar cidades): tabuleiro e contas (`board.ts`), cartas Surpresa (`cards.ts`), motor (`engine.ts`); tabuleiro na tela em `src/web/game/tycoon/scene/` (geometria em `layout.ts`, pixel art em `pixel.ts`), HUD em `src/web/ui/TycoonHud.tsx` |
| `src/shared/games/shooter/` | Tiro na Sala: contrato (`types.ts`), simulação de 40 Hz (`sim.ts`), robôs (`bots.ts`), mapas em ASCII (`maps/`, legenda em `maps/legend.ts`), coordenador no Durable Object (`engine.ts`) e pacotes binários (`codec.ts`) |
| `src/web/game/shooter/` | Tiro no navegador: rede (`net/`: canal P2P "game", repasse, host num Web Worker, predição), cena Pixi (`scene/`), contrato (`contract.ts`); sala em `src/web/ui/ShooterStage.tsx` e HUD em `src/web/ui/ShooterHud.tsx` |
| `src/shared/games/truco/` | truco gaudério: baralho espanhol e contas de envido/flor (`cards.ts`), motor com mesas, truco, envido, flor e testa (`engine.ts`); mesa na tela em `src/web/game/truco/scene/`, HUD em `src/web/ui/TrucoHud.tsx` |
| `src/shared/games/naval/` | batalha naval: mar e frota (`fleet.ts`: casas, encaixe, frota aleatória) e motor (`engine.ts`); mares na tela em `src/web/game/naval/scene/` (navios gerados por tamanho em `pixel.ts`), HUD em `src/web/ui/NavalHud.tsx` |
| `src/shared/games/mystery/` | Mistério (dedução): cartas e textos (`cards.ts`), motor (`engine.ts`), bot que deduz (`bot.ts`, laboratório e testes); tela em `src/web/game/mystery/scene/` (caderno em `notes.ts`, retratos e ícones em `pixel.ts`), HUD em `src/web/ui/MysteryHud.tsx` |
| `src/shared/games/pool/` | sinuca (bola 8): física determinística (`physics.ts`, com a linha de mira), armação e grupos (`rules.ts`), regras e faltas (`engine.ts`); mesa em canvas pixel art em `src/web/game/pool/scene/` (`engine.ts`), HUD em `src/web/ui/PoolHud.tsx` |
| `src/shared/games/stop/` | Stop (adedonha): categorias e comparação de respostas (`categories.ts`), motor (`engine.ts`); tela em `src/web/game/stop/scene/StopScene.tsx` (salva as respostas sozinha), HUD em `src/web/ui/StopHud.tsx` |
| `src/shared/games/duel.ts` | o que xadrez e damas têm em comum: cores sorteadas, relógio, empate, desistência, quem sai da sala. No front: `src/web/game/duel/DuelFrame.tsx` (placas e relógios) e `src/web/ui/DuelHud.tsx` |
| `src/worker/index.ts` | rotas e o Durable Object; **um único alarme** = o menor entre o prazo do jogo e o TTL da sala vazia |
| `src/worker/core.ts` | regras da sala sem Cloudflare (testável); delega `game-*` para `game/host.ts` |
| `src/web/rtc/PeerManager.ts` | mesh com perfect negotiation, codecs, bitrate, estatísticas, watchdog de ICE |
| `src/web/useRoom.ts` | estado da sala, mic, tela (`getDisplayMedia`) e câmera |
| `src/web/ui/Room.tsx` | a sala: barra lateral, palco, câmeras, mesa, barra de baixo, atalhos |
| `src/web/ui/Cams.tsx` | webcams (palco, faixa, flutuante) e a câmera maximizada |
| `src/web/game/scene/` | cena da mesa em PixiJS 8 (`engine.ts`), geometria (`layout.ts`), fila de animações (`plan.ts`) |
| `src/web/game/art/` | toda a pixel art, desenhada em código |
| `src/web/game/audio/` | música chiptune (sequenciador próprio) e efeitos; a música de fundo reveza `calma` e `cisnes` (Lago dos Cisnes em 8 bits) pelo campo `rotate` |
| `src/web/storage.ts` | preferências no `localStorage` (mic, volumes, qualidade, música, tour...) |
| `src/web/ui/tourLogic.ts` | passos do tour (driver.js); o teste confere a quantidade |
| `scripts/commit-rules.ts` | tipos e escopos aceitos nos commits |

## Regras de produto e de texto

- Todo texto de interface em **português do Brasil**, frases curtas e simples. Sem CAIXA ALTA, sem setas "→", sem jargão.
- Visual "a TV da sala": fundo café `#221C19`, abajur `#FFC94A`, papel `#F3EBDD`, poeira `#B7A99A`; fontes Archivo (interface) e Pixelify Sans (pixel). Tokens em `src/web/styles.css` (`:root`). Nada de gradiente chamativo nem cara de template.
- Pixel art é sempre gerada por código (`src/web/game/art`, `src/web/ui/pixelData.ts`). Não adicione imagens prontas.
- Mic começa **mudo** e a câmera começa **desligada**. Escolhas da pessoa vão para `storage.ts`.
- Erros para a pessoa dizem o que fazer ("Libere no cadeado da barra de endereço"), nunca só o nome técnico.

## Restrições técnicas que já morderam

- **CSP** em `public/_headers`: sem `eval`, sem worker de `blob:`, conexões só para `'self'`, `wss:` e `ws://127.0.0.1:47800` (helper). Por isso:
  - o Pixi importa `pixi.js/unsafe-eval` primeiro e usa `Assets.setPreferences({ preferWorkers: false })`;
  - qualquer lib nova precisa funcionar com essa CSP (teste no build servido pelo wrangler, não só no `vite`).
- **Pixi só no chunk da mesa, Three só no do golfe.** Os tabuleiros do xadrez, das damas e do Magnata são HTML/SVG puro, sem biblioteca, e também carrega por `import()`. As cenas e o áudio carregam por `import()` em `src/web/game/loaders.ts`. Não importe `pixi.js` nem `gsap` fora de `src/web/game/scene`, `src/web/game/shooter/scene` e `audio`, nem `three` fora de `src/web/game/golf/scene`.
- **Tela x câmera x mic no receptor** são separados pelo `PeerState`: `screenStreamId` e `camStreamId`. Publique o estado **antes** de adicionar a trilha (`publishState` e depois `manager.startX`), senão o vídeo chega sem classificação.
- **Jogos são puros.** Motor recebe `GameCtx { now, rng }`; nunca use `Date.now()` ou `Math.random()` dentro de `src/shared/games`. Cada conexão recebe só a própria `view`: nunca coloque cartas de outra pessoa na visão fora do showdown.
- **Golfe é simultâneo e determinístico.** O jogo tem `concurrent: true`: o `GameHost` aceita `seq` antigo e o motor recusa tacada repetida pelo `stroke`. A física (`physics.ts`) roda igual no Worker e no navegador: passo fixo de `STEP_MS`, e dentro do laço só `+ - * / sqrt` (nada de `Math.sin`, `Math.hypot`, `Math.random`). O estado guarda um retrato do mundo (`t0` + bolas) e o alarme acorda no próximo instante em que alguma bola muda de estado (`nextChange`). Mapa novo: arquivo em `src/shared/games/golf/maps/` (legenda no topo de `course.ts`), 6 a 12 buracos; o teste `tests/golf/maps.test.ts` confere que dá para chegar no buraco.
- **O tiro é o único jogo em tempo real e não roda no servidor.** O Durable Object só coordena (`engine.ts`: quem é o host da simulação, `epoch`, placar, resultado e prazo de segurança). A simulação roda no navegador do host (`net/hostWorker.ts`, Web Worker de módulo: a CSP não aceita worker de `blob:`), a 40 Hz; entradas e snapshots vão pelo canal negociado "game" (id 8, sem ordem e sem retransmissão) e, sem P2P com o host (outro canal de voz, NAT), pelo repasse `game-relay` do servidor (só repassa, limite `RELAY_MAX_PER_SEC`). Se o host sai, o coordenador escolhe outro, sobe o `epoch` e o novo host continua do último snapshot. Dá para entrar no meio (`addPlayer` no `GameDefinition`). `movePlayer` é a mesma função no host e na predição do cliente. A pistola tem `ammo: Infinity`: estado que passar por JSON precisa de `reviveState`. Laboratório: `/dev/shooter?map=quintal&bots=3` (`window.__tiro`).
- **Xadrez e damas são de duas pessoas, uma de cada vez**, e dividem relógio, empate, desistência e abandono em `duel.ts` (jogo novo assim: reuse em vez de copiar).
- **Xadrez.** Cores sorteadas no `setup` (`ctx.rng`). O relógio desconta na hora do lance (`turnStart` + `clock`) e o alarme acorda quando o tempo de quem joga acaba; lance que chega depois disso vira derrota por tempo. Quem sai da sala perde depois de `ABANDON_MS`. Fim automático: mate, afogado, repetição tripla, 50 lances e material insuficiente. O teste `tests/chess/rules.test.ts` confere o gerador de lances com perft; mexeu em `rules.ts`, rode ele.
- **Damas são as brasileiras.** Pedra captura para trás, dama voadora, captura obrigatória com lei da maioria, peças capturadas só saem no fim do lance (não dá para pular duas vezes) e a pedra só vira dama se terminar na última fileira. O lance é o caminho inteiro (`path`), porque com dama mais de um caminho pode chegar na mesma casa. Empate: repetição tripla ou 20 lances de cada lado só com damas e sem captura.
- **Truco é o gaudério, do jeito da nossa mesa.** Baralho espanhol de 40 com manilhas fixas, partida até 30, envido (envido/real/falta, e a falta vale o que falta para o líder chegar a 30), "o envido está primeiro", flor obrigatória (o jogo canta sozinho, vale 3) e contra-flor (6), sem "ao resto". Times pela cadeira (pares x ímpares); quem dá as cartas é sorteado e a vez anda no sentido anti-horário (índice seguinte). 1x1, 2x2 e 3x3; no 3x3, entre 5 e 25 pontos dos dois times, alterna mão normal com mão de "testa" (três duelos 1x1 simultâneos contra quem está na frente). Por causa da testa o jogo é `concurrent` e toda ação leva o `ref` da mesa. Cartas dos outros nunca vão na visão. As cadeiras exatas vêm de `GameDefinition.seats(options)`. Mexeu no motor, rode `tests/truco/property.test.ts`.
- **Batalha naval**: 1x1, mar 10x10, frota de 5 (porta-aviões 5, encouraçado 4, cruzador 3, submarino 3, destróier 2), navios não encostam nem na diagonal. Os dois posicionam ao mesmo tempo (o jogo é `concurrent`; o tiro leva o `ref` = tiros já dados). Modo clássico (um tiro; acertou, joga de novo) ou salva (um tiro por navio de pé, numa rajada). A frota do outro nunca vai na visão: só tiros e navios afundados; no fim mostra as duas. Prazo: posiciona sozinho em `PLACE_MS` e atira sozinho em `SHOT_MS`.
- **Sinuca (bola 8) é física determinística, como o golfe.** Passo fixo (`HZ`) e só `+ - * / sqrt` no laço; a tacada chega como vetor (sem seno/cosseno). O servidor simula a tacada inteira de uma vez e guarda o "antes" (`shot.before`); o navegador anima a mesma simulação e, no fim, encaixa nas posições do servidor. Regras: mesa aberta depois da quebra, grupo definido pela primeira bola encaçapada sem falta, faltas (branca na caçapa, não tocar, tocar primeiro na bola errada, nenhuma bola na tabela depois do toque) dão bola na mão, e a 8 só vale na caçapa escolhida (`pocket`). A tacada leva o `ref` (tacadas já dadas). Mexeu na física, rode `tests/pool/` (inclui partidas inteiras aleatórias). Não use o nome nem o visual de "8 Ball Pool".
- **Stop é simultâneo e com respostas escondidas.** O jogo é `concurrent`; as ações levam o número da rodada. Enquanto escrevem, a visão só leva as suas respostas e quantas categorias cada um preencheu; as dos outros só depois do STOP. STOP só com tudo preenchido com a letra; depois tem `GRACE_MS` para as últimas respostas chegarem (a tela manda o que está escrito na hora). Conferência: "não vale" cai com a maioria dos outros; pontos 10 (única), 5 (repetida, comparando sem acento nem maiúscula), 0. Letras sem K, W, Y e sem repetir.
- **Mistério é nosso, não cópia.** Mecânica de dedução (palpite, alguém mostra uma carta em segredo, acusação), mas o tema (roubo do quadro no Casarão da Vila), suspeitos, lugares, objetos e arte são próprios: não use nomes, personagens, cômodos ou armas de Detetive/Clue. Sem tabuleiro: na vez, palpita qualquer combinação. Quem mostra é o próximo da roda que tiver alguma; com uma só, o jogo mostra sozinho. A carta mostrada só vai na visão de quem palpitou e de quem mostrou. Errou a acusação: sai, vê a solução em segredo e continua mostrando cartas. O caderno (`notes.ts`) marca sozinho o que dá para deduzir pela visão; o resto fica no `localStorage`.
- **Magnata é nosso, não cópia.** Mecânica de jogo de imóveis, mas nome, tabuleiro (cidades brasileiras), cartas e arte são próprios: não use nomes, casas, cartas ou visual de Monopoly, Banco Imobiliário ou Business Tour. Para ser rápido: constrói na compra (até 3 casas; hotel quando cair de novo), pode comprar a cidade dos outros por 2x o investido (menos com hotel), vitória na hora com 3 grupos, um lado inteiro ou as 4 praias, e toda vez tem prazo (`ROLL_MS`/`DECIDE_MS`): estourou, o servidor rola ou passa por você. Dívida vende sozinha as cidades mais baratas pela metade. O teste `tests/tycoon/property.test.ts` joga partidas aleatórias inteiras conferindo as regras; mexeu no motor, rode ele.
- **Canais e limite.** A sala tem canais (padrão: só "Geral", sem limite) que o host cria, edita e apaga; **cada canal tem o seu limite** (`Channel.limit`, `0`/ausente = sem limite, escolhido ao criar e editável pelo lápis; baixar não tira ninguém), gravados no `RoomConfig`. Canal cheio recusa `channel-join` (`channel-full`); quem chega cai no primeiro canal com vaga, e se todos estiverem cheios não entra (o host entra). A sala em si não tem limite visível: só o teto de segurança `MAX_PEERS = 100`. A mídia continua P2P **dentro do canal**: o `useRoom` só chama `manager.addPeer` para quem está no mesmo canal e refaz as conexões no `peer-moved`. Acima de `HEAVY_CHANNEL` (8) pessoas num canal a malha pesa e a interface avisa; mais que isso só com servidor de mídia (SFU). O host sempre entra, mesmo com a sala cheia. Os jogos são da sala inteira (Stop aceita até 10; poker, golfe e tiro, até 8; Magnata e Mistério, 6; truco, 2, 4 ou 6 exatos; xadrez, damas, batalha naval e sinuca, 2).
- **Nome da sala ("servidor").** Escolhido na Home ao criar (vazio = "Sala de <apelido>"), mostrado no topo da barra lateral (`ServerCard`) e no título da aba; só o dono troca (`room-rename`). Fica em `RoomConfig.name` e vai em `RoomSettings.name`; sala antiga sem nome usa `DEFAULT_ROOM_NAME`. "Outros servidores" lista as salas recentes pelo nome (`RecentRoom.name`).
- **Chat do canal** passa pelo servidor (`chat-send` / `chat` / `chat-history`), só para quem está no canal. O Durable Object guarda as últimas `CHAT_HISTORY` (50) por canal em `chat:<canal>`; apagar o canal apaga o chat; limite de 8 mensagens a cada 10 s por pessoa (`chat-flood`).
- Mudou a arte? Rode `npm run sprites` e versione `public/game/sprites.*`.

## Pegadinhas de UI conhecidas

- **Campo de texto livre leva `{...noAutofill('nome')}`** (`src/web/ui/noAutofill.ts`) e o `<form>` leva `autoComplete="off"`. Sem isso o Chrome oferece Google Pay ou cartão salvo no chat e nos nomes.
- **Não coloque o `Dropdown` dentro de `<label>`**: o clique na opção é repassado ao botão e a lista reabre. Use `<div>`.
- **Classes CSS curtas colidem.** `.cam` é o botão da barra; o quadro de câmera é `.cam-tile`. O estado do mic é `.is-muted`/`.is-live` (não `.muted`, que é texto apagado).
- Botões são estilizados por variáveis (`--bg`, `--bg-h`, `--bd`, `--bd-h`, `--fg`). Para um botão novo, troque as variáveis em vez de sobrescrever `background`, senão o hover quebra.
- Texto dentro do canvas do poker usa `PxText` em alta resolução (`TEXT_RES`); posições continuam em pixels da cena.
- A barra de baixo encolhe rótulos com `@container` antes de quebrar linha; botão novo na barra precisa caber em 1440 px com a barra lateral aberta.

## Testes e verificação visual

- Unitários em `tests/` (vitest, ambiente node). Regras de mãos são comparadas com `pokersolver` (devDependency, só oráculo de teste).
- Headless (puppeteer-core + `/usr/bin/google-chrome`): o canvas WebGL sai em branco em screenshot. Defina `localStorage['janja.debug.renderer'] = 'canvas'` para o Pixi usar Canvas2D.
- Flags úteis: `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --autoplay-policy=no-user-gesture-required`; substitua `navigator.mediaDevices.getDisplayMedia` por `getUserMedia` para simular a tela.
- `/dev/poker` (laboratório da mesa, com `window.__lab.newHand()`, `flop()`, `showdown()`...), `/dev/golf` (motor do golfe local com bots; `?map=montanha&hole=3&bots=0`, `window.__golf.hole(n)` e `.shoot(angulo, forca)`), `/dev/chess` (motor do xadrez local; `?fen=...&min=5&bot=0`, `window.__chess.move('e2', 'e4')` e `.fen()`), `/dev/checkers` (damas locais; `?pos=...&bot=0`, `window.__damas.move('c3', 'd4')` e `.pos()`), `/dev/tycoon` (Magnata com bots; `?bots=3&min=15`, `window.__magnata.give(casa)` e `.place(casa)`), `/dev/truco` (truco com bots; `?n=2|4|6`, `window.__truco.hands([...])`, `.score(a, b)` e `.next()`), `/dev/shooter` (tiro com robôs; `?map=quintal&bots=3`, `window.__tiro`), `/dev/naval` (contra um bot; `?mode=salva`, `window.__naval.ready()`), `/dev/mystery` (Mistério com bots; `?n=4`), `/dev/pool` (sinuca contra um bot; `?bot=0` joga dos dois lados), `/dev/stop` (Stop com bots; `?n=3&s=60`) e `/dev/audio` só existem com `npx vite` (modo dev); não entram no build.
- Golfe no headless: use `--use-angle=swiftshader --enable-unsafe-swiftshader` para o WebGL desenhar. Em dev o canvas expõe a posição da sua bola em `data-ball` (para arrastar a tacada).

## Commits

Padrão `tipo(escopo): descrição` em português, sem ponto final, título até 72 caracteres. Tipos: `feat fix test refactor style perf docs build ci chore revert`. Escopos: `sala tela camera audio controle helper jogos poker golfe xadrez damas magnata truco tiro naval misterio sinuca stop tour jan ui worker deps release`. Detalhes em `docs/COMMITS.md`. O hook `.githooks/commit-msg` e o workflow `commits` recusam mensagens fora do padrão. Escopo novo: atualize `scripts/commit-rules.ts` e a tabela do doc no mesmo commit.

## Fluxo de trabalho

- O Pedro roda `git`, `npm install` e o push no PC dele (Windows, Git Bash ou PowerShell). Dê os comandos prontos.
- Arquivos em `.github/workflows/` às vezes precisam ser copiados à mão para o lugar certo; confira se chegaram ao GitHub.
- Release do helper: tag `helper-vX.Y.Z` dispara `.github/workflows/helper.yml`, que publica o `.exe` e o `.sha256`. As origens liberadas por padrão ficam em `helper/src/config.rs` (`DEFAULT_ORIGINS`).
- Mudanças grandes: planeje primeiro (contratos de tipos, divisão em partes), implemente, rode a verificação completa e só então entregue.
