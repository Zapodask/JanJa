# JanJa

Compartilhamento de tela entre amigos, com vídeo, áudio e microfone, direto do navegador. Ninguém instala nada. A tela vai direto de um PC para o outro (P2P), e a nuvem só apresenta os participantes. Custo zero, no plano grátis da Cloudflare.

```
[Navegador do Pedro] ──┐                         ┌── [Navegador da Bia]
                       ├── sinalização (texto) ──┤
                       │   Cloudflare Worker +   │
                       │   1 Durable Object/sala │
                       │                         │
                       └──── tela + áudio + mic, direto (WebRTC P2P) ────┘
                             (se o NAT bloquear: relay via TURN, opcional)
```

## Como usar

1. Abra o site, escolha um apelido e clique em **Criar sala**.
2. Clique em **Copiar link da sala** e mande o link para os amigos.
3. Quem abrir o link escolhe um apelido e entra. Se a aprovação estiver ligada, você vê "Fulano quer entrar" e decide.
4. Clique em **Compartilhar tela** e escolha no seletor do navegador:
   - **Tela inteira** com **"Compartilhar áudio do sistema"** marcado, para enviar o som do PC (jogo, música, vídeo).
   - **Uma aba** com **"Compartilhar áudio da aba"**, para mostrar um vídeo do navegador.
   - **Uma janela**: vai sem som, porque o navegador não captura o áudio de janelas avulsas no Windows.

O JanJa tira do áudio capturado o som que ele mesmo toca, ou seja, a voz dos amigos. Assim ninguém ouve o próprio eco (`restrictOwnAudio`, no Chrome e no Edge para Windows e Mac).

Mais detalhes:
- Clique numa tela para focar nela e dê dois cliques para abrir em tela cheia.
- Cada tela e cada voz têm o próprio volume.
- Ao lado de cada pessoa aparece a rota (`direto` ou `via relay`), a latência e o bitrate recebido.
- Cabem até 5 pessoas por sala. Em mesh, quem compartilha envia a tela uma vez para cada espectador.

**Navegadores:** no PC, Chrome e Edge fazem tudo. Firefox e Safari compartilham a tela, mas sem o áudio do sistema. No celular dá só para assistir e falar.

## Rodar no seu PC

Precisa de Node 20 ou mais novo.

```bash
npm install
npm run dev        # http://localhost:8787
```

Para testar sozinho, abra duas janelas, uma delas anônima, já que o navegador guarda quem é o host da sala. Em `localhost` o navegador libera tela e microfone mesmo sem HTTPS.

## Publicar na web (grátis)

Você precisa de uma conta grátis na Cloudflare. O plano grátis cobre a sinalização: 100 mil requisições por dia nos Durable Objects, e o vídeo não passa por lá.

```bash
npx wrangler login     # abre o navegador para autorizar
npm run deploy         # build + deploy
```

O site fica em `https://janja.<seu-subdominio>.workers.dev`. Esse é o endereço para mandar aos amigos.

### Deploy automático a cada push (opcional)

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

## Testes

```bash
npm run typecheck
npm test            # regras da sala: entrada, aprovação, host, limites, repasse
npm run test:e2e    # 3 abas do Chrome contra o Worker local: mesh, 2 e 3 telas, colisão, saída
```

O e2e usa o Chrome instalado. Para outro caminho, defina `CHROME_PATH`.

## Commits

As mensagens seguem `tipo(escopo): descrição`, por exemplo `feat(camera): clique para maximizar`. O padrão completo está em [docs/COMMITS.md](docs/COMMITS.md). Um hook recusa o commit fora do padrão no seu PC (ligado no `npm install`), e o GitHub valida cada push. Para conferir à mão: `npm run validate-commits`.

## Estrutura

```
src/
  shared/protocol.ts     protocolo (zod), links de sala
  worker/
    index.ts             rotas (/api/rooms, /ws/:sala) + Durable Object Room (Hibernation API)
    core.ts              regras da sala, sem nada da Cloudflare (testável no Node)
  web/
    signaling.ts         cliente WebSocket
    rtc/PeerManager.ts   mesh WebRTC: perfect negotiation, bitrate, estatísticas, watchdog de ICE
    rtc/quality.ts       presets de qualidade
    useRoom.ts           estado da sala + captura (getDisplayMedia)
    ui/                  Home, NameGate, Room, tiles
tests/                   vitest + e2e com puppeteer contra o wrangler dev
wrangler.jsonc           Worker + assets + Durable Object (SQLite, plano grátis)
```

### Decisões

- **Uma sala é um Durable Object.** Ele só apresenta os participantes e repassa mensagens `signal`, sem ler o SDP. Com a Hibernation API, uma sala parada não consome duração. Uma sala vazia some depois de 6 horas.
- **O host é quem criou a sala.** A chave de host fica no navegador dele (o servidor guarda só o hash), então recarregar a página mantém o papel. Sem o host na sala, ninguém entra numa sala que exige aprovação.
- **Perfect negotiation** ([padrão do W3C](https://w3c.github.io/webrtc-pc/#perfect-negotiation-example)): qualquer pessoa pode começar ou parar de compartilhar a qualquer momento sem colisão. Na entrada, quem chega oferece primeiro.
- **Segurança:** o ID da sala tem 128 bits aleatórios e não dá para adivinhar. Há CSP e limite de mensagens por conexão.

## Limitações

- A rede local sem internet não funciona, porque a sinalização está na nuvem. Com internet, a mídia vai direto pela rede local de qualquer forma.
- O áudio de uma janela avulsa não é capturado no Windows. Use a tela inteira ou uma aba.
- Mais de 5 pessoas exigiria um SFU.
