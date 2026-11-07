<p align="center">
  <img src="docs/readme/banner.gif" alt="JanJa: o Jan entra andando, liga a TV e acena" width="960">
</p>

<p align="center">
  <b>Tela, voz, câmera e poker com os amigos, direto do navegador.</b><br>
  Ninguém instala nada. O vídeo vai de um PC para o outro (P2P) e a nuvem só apresenta as pessoas.<br>
  Custo zero, no plano grátis da Cloudflare.
</p>

<p align="center">
  <a href="https://janja.spotlightre.workers.dev"><b>Abrir o JanJa</b></a>
  &nbsp;·&nbsp;
  <a href="#como-usar">Como usar</a>
  &nbsp;·&nbsp;
  <a href="#rodar-no-seu-pc">Rodar no seu PC</a>
  &nbsp;·&nbsp;
  <a href="docs/COMMITS.md">Padrão de commits</a>
</p>

---

## O que dá para fazer

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/readme/sala.png" alt="Sala com a tela de código do Pedro e as câmeras de todos em cima">
      <h3>Compartilhar a tela, com som</h3>
      Tela inteira, janela ou aba, com o áudio do sistema. Cinco presets de qualidade, de texto nítido a jogo em 60 fps, e suporte a monitor ultrawide sem borrar.
    </td>
    <td width="50%" valign="top">
      <img src="docs/readme/cams.png" alt="Quatro webcams no palco, cada uma com um Jan de camisa diferente">
      <h3>Webcam, com um clique para maximizar</h3>
      Sem ninguém compartilhando, as câmeras viram o palco. Com tela, ficam numa faixa em cima. Um clique abre a câmera de alguém em tamanho grande, como no Teams.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/readme/mesa.png" alt="Mesa de poker em pixel art com a tela compartilhada pendurada na parede">
      <h3>Poker na sala</h3>
      Texas Hold'em facilitado, com modo rápido de 3 cartas. A mesa ocupa o palco e as telas compartilhadas viram TVs penduradas na parede.
    </td>
    <td width="50%" valign="top">
      <img src="docs/readme/home.png" alt="Tela inicial do JanJa com o Jan e a TV">
      <h3>Entrar é só abrir um link</h3>
      Crie a sala, mande o link e pronto. Dá para pedir sua aprovação antes de alguém entrar, e dá até para <a href="#controle-remoto-e-o-janja-helper">controlar o PC</a> de quem compartilha, com permissão.
    </td>
  </tr>
</table>

### A mesa de poker

<p align="center">
  <img src="docs/readme/poker.gif" alt="Uma mão de poker: cartas sendo distribuídas, flop, turn, river e o vencedor levando o pote" width="960">
</p>

- **Feita para quem não sabe jogar.** Os botões já mostram o valor ("Pagar 10", "Aumentar para 20"), a barra diz qual mão você tem e, no fim, o jogo explica quem ganhou e por quê, inclusive quando o desempate é pela carta mais alta.
- **Fichas de mentira.** Cada um começa com 1000. Por padrão quem zera recebe fichas de novo e o ranking é pelo saldo; no modo torneio quem zera sai.
- **A partida acaba por tempo** (15, 30 ou 45 minutos, ou sem limite) e termina com um pódio.
- **O servidor é o crupiê.** O embaralhamento e as regras rodam no Durable Object da sala, e cada pessoa só recebe as próprias cartas.
- **Música chiptune original**, em três faixas que mudam com o jogo e abaixam sozinhas quando alguém fala.
- **Atalhos:** `P` passa ou paga, `A` aumenta, `D` desiste, `H` mostra a tabela de mãos, `G` destaca uma TV.

### Tudo desenhado em código

<p align="center">
  <img src="docs/readme/arte.gif" alt="Royal flush de copas, fichas, botão de dealer, troféu e o Jan embaralhando" width="960">
</p>

Não há nenhuma imagem de banco: as cartas, as fichas, a mesa, a lâmpada e o Jan são pixel art gerada por código (`npm run sprites`), em uma única folha de sprites desenhada com PixiJS.

## Como usar

1. Abra o site, escolha um apelido e clique em **Criar sala**.
2. Clique em **Copiar link da sala** e mande o link para os amigos.
3. Quem abrir o link escolhe um apelido e entra. Se a aprovação estiver ligada, a campainha toca, aparece "Fulano quer entrar" e você decide.
4. Clique em **Compartilhar tela** e escolha no seletor do navegador:
   - **Tela inteira** com **"Compartilhar áudio do sistema"** marcado, para enviar o som do PC (jogo, música, vídeo).
   - **Uma aba** com **"Compartilhar áudio da aba"**, para mostrar um vídeo do navegador.
   - **Uma janela**: vai sem som, porque o navegador não captura o áudio de janelas avulsas no Windows.
5. Para jogar, clique em **Jogos**, abra a mesa e espere os amigos sentarem.

O JanJa tira do áudio capturado o som que ele mesmo toca, ou seja, a voz dos amigos. Assim ninguém ouve o próprio eco (`restrictOwnAudio`, no Chrome e no Edge para Windows e Mac).

| Atalho | O que faz |
|---|---|
| `M` | liga e desliga o microfone (ele começa desligado) |
| `C` | liga e desliga a câmera |
| `F` ou duplo clique | tela cheia na tela compartilhada |
| `Esc` | diminui a câmera maximizada |

Mais detalhes:
- Cada tela e cada voz têm o próprio volume, e a saída de áudio pode ser trocada.
- Na primeira visita o JanJa oferece um tour guiado, que pode ser visto de novo no botão de ajuda.
- Ao lado de cada pessoa aparece a rota (`direto` ou `via relay`), a latência e o bitrate recebido.
- O que você escolhe (mic, qualidade, volumes, som da mesa) fica salvo no navegador.
- Cabem até 5 pessoas por sala. Em mesh, quem compartilha envia a tela uma vez para cada espectador.

**Navegadores:** no PC, Chrome e Edge fazem tudo. Firefox e Safari compartilham a tela, mas sem o áudio do sistema. No celular dá para assistir, falar, usar a câmera e jogar.

### Controle remoto e o JanJa Helper

Para alguém controlar o seu PC, você precisa do **JanJa Helper**, um `.exe` pequeno para Windows, sem instalador. Só quem vai ser controlado precisa dele: quem controla usa só o navegador.

1. Baixe o `janja-helper.exe` em [Releases](https://github.com/pedrohhope/JanJa/releases) ou pelo próprio site, na barra lateral da sala.
2. Abra o helper e clique em **Conectar ao helper** no site. Na primeira vez, digite o código de 6 dígitos que aparece no console.
3. Quando alguém pedir o controle, um toc-toc avisa e você decide se permite.

O helper só escuta em `127.0.0.1`, só aceita o site do JanJa e ignora tudo sem uma sessão que você permitiu. Detalhes em [helper/README.md](helper/README.md).

## Rodar no seu PC

Precisa de Node 20 ou mais novo.

```bash
npm install
npm run dev        # http://localhost:8787
```

Para testar sozinho, abra duas janelas, uma delas anônima, já que o navegador guarda quem é o host da sala. Em `localhost` o navegador libera tela, câmera e microfone mesmo sem HTTPS.

Com `npx vite`, as rotas de laboratório `/dev/poker` (a mesa com eventos de mentira) e `/dev/audio` (as músicas e os sons) ajudam a mexer na cena e no som sem abrir uma sala.

## Publicar na web (grátis)

Você precisa de uma conta grátis na Cloudflare. O plano grátis cobre a sinalização: 100 mil requisições por dia nos Durable Objects, e o vídeo não passa por lá.

```bash
npx wrangler login     # abre o navegador para autorizar
npm run deploy         # build + deploy
```

O site fica em `https://janja.<seu-subdominio>.workers.dev`. Esse é o endereço para mandar aos amigos.

### Deploy automático a cada push

No painel da Cloudflare, abra **Workers & Pages → janja → Settings → Builds → Connect** e conecte o repositório do GitHub. Use estas configurações:
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`

Depois disso, cada `git push` na `main` publica sozinho.

### TURN (para quem não conecta)

Se alguém ficar em `conectando` ou `falhou`, a pessoa provavelmente está atrás de CGNAT, o que é comum no 4G e em parte das fibras. O Worker gera credenciais temporárias de TURN da Cloudflare quando estes dois segredos existem:

```bash
npx wrangler secret put TURN_KEY_ID
npx wrangler secret put TURN_KEY_API_TOKEN
```

Crie a chave no painel em **Realtime → TURN Server**. O TURN da Cloudflare tem 1.000 GB grátis por mês, e depois disso é cobrado por GB. Só passa pelo TURN o tráfego de quem não conseguiu conexão direta. Sem os segredos, o JanJa usa só STUN e funciona para a maioria das pessoas.

## Como funciona

```
[Navegador do Pedro] ──┐                         ┌── [Navegador da Bia]
                       ├── sinalização + jogo ───┤
                       │   Cloudflare Worker +   │
                       │   1 Durable Object/sala │
                       │                         │
                       └── tela, câmera, voz: direto (WebRTC P2P) ──┘
                           (se o NAT bloquear: relay via TURN, opcional)
```

- **Uma sala é um Durable Object.** Ele apresenta os participantes, repassa as mensagens `signal` sem ler o SDP e roda o jogo. Com a Hibernation API, uma sala parada não consome duração. Uma sala vazia some depois de 6 horas.
- **O host é quem criou a sala.** A chave de host fica no navegador dele (o servidor guarda só o hash), então recarregar a página mantém o papel.
- **Perfect negotiation** ([padrão do W3C](https://w3c.github.io/webrtc-pc/#perfect-negotiation-example)): qualquer pessoa pode ligar ou desligar tela e câmera a qualquer momento sem colisão.
- **Tela e câmera são trilhas separadas.** A tela usa H.264 ou VP9 conforme o preset e bitrate proporcional aos pixels; a câmera vai em 360p a cerca de 450 kbps para não disputar banda.
- **Jogos são funções puras.** Cada jogo implementa `GameDefinition` (setup, apply, view, tick) com tempo e sorteio injetados, então dá para testar uma partida inteira no Node.
- **Segurança:** o ID da sala tem 128 bits aleatórios. Há CSP estrita, sem `eval` (o Pixi roda com o módulo `pixi.js/unsafe-eval`, que dispensa `eval` no navegador), limite de mensagens por conexão e validação com zod em tudo que chega.

## Testes

```bash
npm run typecheck
npm test            # sala, regras do poker, cena, música, controle remoto, tour, commits
npm run test:e2e    # 3 abas do Chrome contra o Worker local: mesh, 2 e 3 telas, colisão, saída
```

As regras de mãos do poker são comparadas com a biblioteca `pokersolver` em centenas de milhares de confrontos. O e2e usa o Chrome instalado; para outro caminho, defina `CHROME_PATH`.

## Commits

As mensagens seguem `tipo(escopo): descrição`, por exemplo `feat(camera): clique para maximizar`. O padrão completo está em [docs/COMMITS.md](docs/COMMITS.md). Um hook recusa o commit fora do padrão no seu PC (ligado no `npm install`), e o GitHub valida cada push. Para conferir à mão: `npm run validate-commits`.

## Estrutura

```
src/
  shared/
    protocol.ts          protocolo da sala (zod), links
    control.ts           protocolo do controle remoto
    games/               plataforma de jogos + poker (motor, avaliador de mãos, textos)
  worker/
    index.ts             rotas (/api/rooms, /ws/:sala) + Durable Object Room
    core.ts              regras da sala, sem nada da Cloudflare (testável no Node)
    game/host.ts         roda o jogo da sala e manda a visão de cada pessoa
  web/
    rtc/                 mesh WebRTC (PeerManager) e presets de qualidade
    useRoom.ts           estado da sala, mic, tela e câmera
    control/             controle remoto: captura, máquina de estados, cliente do helper
    game/                cena em PixiJS, arte em código, música e sons, laboratórios de dev
    ui/                  telas, sala, câmeras, HUD do poker, tour
helper/                  JanJa Helper (Rust, Windows)
scripts/                 sprites, validação de commits
tests/                   vitest + e2e com puppeteer contra o wrangler dev
docs/                    padrão de commits e imagens deste README
```

## Limitações

- A rede local sem internet não funciona, porque a sinalização está na nuvem. Com internet, a mídia vai direto pela rede local de qualquer forma.
- O áudio de uma janela avulsa não é capturado no Windows. Use a tela inteira ou uma aba.
- Mais de 5 pessoas exigiria um SFU.
- O JanJa Helper existe só para Windows.

## Licença

[MIT](LICENSE)
