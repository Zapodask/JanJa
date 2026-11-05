# JanJa

Compartilhamento de tela entre amigos, com vídeo, áudio do sistema e microfone, direto de um PC para o outro. O PC de quem cria a sala vira o servidor dela, no estilo Hamachi. Não tem nuvem paga nem anúncios.

```
[Host]  JanJa + servidor de sinalização (WebSocket) embutido
   │      exposto por Cloudflare Quick Tunnel  →  link da sala
   ├── sinalização (texto, leve) ──► [Amigo A], [Amigo B]
   └── mídia P2P direta (tela + áudio + mic), todos ↔ todos
        └─ se o NAT bloquear: relay via TURN (opcional)
```

## Rodar

Requisitos: Node 20+ e Git. O alvo principal é o Windows, porque é lá que o áudio do sistema funciona.

```bash
npm install
npm run dev
```

O `postinstall` do projeto baixa o binário do Electron, mesmo quando o npm bloqueia os scripts de instalação das dependências. Se der `Error: Electron uninstall`, rode `node node_modules/electron/install.js`.

## Como usar

1. Escolha um apelido.
2. **Criar sala**: escolha o modo e clique em *Criar sala*. Na barra lateral, use *Copiar link* e mande o link para os amigos.
   - **Pela internet**: abre um Cloudflare Quick Tunnel, sem conta e sem abrir porta no roteador. Na primeira vez o app baixa o `cloudflared` sozinho. O link muda a cada sala.
   - **Rede local ou Tailscale**: usa a porta 47800 e mostra um link por IP. Os IPs do Tailscale (100.x) aparecem primeiro. O Windows vai pedir para liberar no firewall.
3. **Entrar numa sala**: cole o link e clique em *Entrar*. Se a aprovação estiver ligada, o host vê um aviso e decide se deixa entrar.
4. Na sala, use *Compartilhar tela* e escolha a tela ou a janela, a qualidade e se quer incluir o áudio do sistema.
   - Clique numa tela para focar nela e dê dois cliques para abrir em tela cheia.
   - Cada tela e cada voz têm o próprio volume.
   - Ao lado de cada pessoa aparece a rota (`direto` ou `via relay`), a latência e o bitrate recebido.

Cabem até 5 pessoas por sala. Em mesh, quem compartilha envia a tela uma vez para cada espectador, e o seletor mostra o upload estimado.

### TURN (para CGNAT)

Se alguém aparecer como `conectando` ou `falhou`, é provável que esteja atrás de CGNAT, o que é comum em operadora móvel e em parte das fibras. Crie credenciais grátis de TURN (free tier da Cloudflare ou da Metered/Open Relay, confira os limites atuais de cada um). Depois preencha em *Criar sala → Servidor TURN*. As credenciais ficam só no PC do host e são entregues aos convidados quando eles entram.

### Áudio do sistema e eco

O áudio do sistema é capturado por loopback (só no Windows), então ele inclui o som que o próprio JanJa toca, como a voz dos amigos. Para ninguém ouvir eco, coloque a saída de áudio da sala (seletor na barra de baixo) num dispositivo diferente do padrão do Windows, por exemplo o fone.

## Distribuir para os amigos (GitHub Releases)

O workflow `.github/workflows/release.yml` gera o instalador do Windows e publica nas Releases do GitHub a cada tag `v*`. O app instalado procura atualizações nas Releases sempre que abre.

### Uma vez só

1. Crie um repositório **público** chamado `janja` no GitHub. Ele precisa ser público para os amigos baixarem e para a atualização automática funcionar sem token.
2. No `package.json`, troque `SEU_USUARIO` pelo seu usuário do GitHub em `repository.url`.
3. Envie o código:
   ```bash
   git init
   git add .
   git commit -m "JanJa"
   git branch -M main
   git remote add origin https://github.com/SEU_USUARIO/janja.git
   git push -u origin main
   ```

### A cada versão

```bash
npm version patch        # 0.1.0 -> 0.1.1, cria a tag v0.1.1
git push --follow-tags
```

Em alguns minutos aparece `JanJa-Setup-0.1.1.exe` em *Releases*. Acompanhe na aba *Actions*.

### O que mandar para os amigos

> Baixe e instale o JanJa: https://github.com/SEU_USUARIO/janja/releases/latest
> (arquivo `JanJa-Setup-x.y.z.exe`. Se o Windows avisar, clique em *Mais informações → Executar assim mesmo*.)

Depois disso, basta mandar o link da sala. Ao abrir o link no navegador, o amigo vê a página do convite e clica em **Abrir no JanJa**. O app abre já entrando na sala (na primeira vez ele pede o apelido). Quem ainda não instalou vê na mesma página o link para baixar.

O aviso do Windows aparece porque o instalador não é assinado. Um certificado de assinatura de código custa caro, e para um grupo de amigos o aviso é aceitável.

### Gerar o instalador localmente

```bash
npm run dist:win     # dist/JanJa-Setup-<versão>.exe
```

## Testes

```bash
npm run typecheck
npm test            # servidor de sinalização, código da sala, parser do túnel, deep link
npm run test:e2e    # mesh real com 3 abas do Chrome: entrar, compartilhar, 2 e 3 telas, colisão, sair
```

O e2e usa o Chrome instalado. Para outro caminho, defina `CHROME_PATH`.

## Estrutura

```
src/
  shared/protocol.ts        protocolo de sinalização (zod), código da sala
  main/                     processo main (Node)
    signaling/server.ts     servidor ws: token, aprovação, limite de pessoas, rate limit
    tunnel/cloudflared.ts   baixa e sobe o Quick Tunnel, lê o link
    room.ts                 abre e fecha a sala (servidor + túnel ou LAN)
    capture.ts              desktopCapturer + áudio por loopback
    net.ts                  IPs locais e do Tailscale
  preload/                  ponte segura (contextIsolation + sandbox)
  renderer/src/
    signaling.ts            cliente ws
    rtc/PeerManager.ts      mesh WebRTC com perfect negotiation, bitrate e estatísticas
    rtc/quality.ts          presets de qualidade
    useRoom.ts              estado da sala
    ui/                     Lobby, Room, seletor de tela, tiles
tests/                      vitest + e2e com puppeteer
```

### Decisões

- **O servidor só repassa mensagens.** Ele encaminha `signal` pelo `peerId` e nunca lê o SDP. O host entra na própria sala como um peer comum, usando um token de host.
- **Perfect negotiation** ([padrão do W3C](https://w3c.github.io/webrtc-pc/#perfect-negotiation-example)): qualquer pessoa pode começar ou parar de compartilhar a qualquer momento sem colisão de ofertas. Na entrada, quem chega oferece primeiro, e quem já estava só manda mídia depois de responder. Um watchdog reinicia o ICE se a conexão travar.
- **O token vai no fragmento do link (`#t=`)**, então não aparece em logs de servidor nem do túnel. O mesmo endereço responde com a página do convite no navegador e com o WebSocket no app.
- **`janja://join?code=<link>`** é registrado pelo instalador. Com o app aberto, o link reaproveita a mesma janela, porque o app só roda uma instância por vez.
- **Segurança do Electron**: `contextIsolation`, `sandbox`, sem `nodeIntegration`, CSP no build e permissões restritas a microfone e captura de tela.

## Limitações conhecidas

- O áudio do sistema só funciona no Windows. No macOS e no Linux dá para compartilhar a tela, mas sem o som.
- O link do Quick Tunnel muda a cada sala, e a Cloudflare não garante disponibilidade para túneis sem conta.
- Se o host sai, a sala fecha.
- Mais de 5 pessoas exigiria um SFU.
