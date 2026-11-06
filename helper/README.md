# JanJa Helper

Programa local (Windows) que deixa quem assiste controlar o mouse e o teclado do seu PC no JanJa. Sem instalador: um único `janja-helper.exe`. Assistir continua sem instalar nada; o helper só é necessário para quem vai ser controlado.

## Usar

1. Baixe `janja-helper.exe` em Releases e abra (um console aparece).
2. Para usar com o seu site publicado, libere a origem uma vez e reinicie o helper:
   `janja-helper.exe --allow https://seu-site.workers.dev`
   (já vêm liberados `http://localhost:8787` e `http://127.0.0.1:8787`)
3. Na primeira conexão o console mostra um código de 6 dígitos; digite-o na página. O token gerado fica no navegador; o helper guarda só o hash.
4. Quando alguém pedir controle e você permitir, o título do console mostra "CONTROLE ATIVO".

## Segurança

- Escuta só em `127.0.0.1:47800`; aceita só WebSocket com `Origin` da lista; uma página por vez.
- Pareamento com código de 6 dígitos; 5 erros bloqueiam o pareamento por 60 s.
- Sem sessão ativa (confirmada por você na página), todo input é ignorado.
- Pânico: `Ctrl+Alt+Shift+P` corta o controle na hora. Se o atalho não puder ser registrado, o helper recusa sessões.
- Ao encerrar a sessão, desconectar, acionar o pânico ou fechar o console, todas as teclas e botões pressionados são soltos.

## Configuração

`%APPDATA%\JanJa\helper.json`: `{ "origins": [...], "tokens": ["sha256hex", ...] }`. Para despareiar tudo, apague `tokens`. A variável `JANJA_HELPER_CONFIG` troca o caminho.

## Desenvolver

```
cargo test            # roda em Linux e Windows (em Linux a entrada é um stub que não injeta nada)
cargo build --release # janja-helper.exe pequeno (LTO, strip, opt-level z)
```

Entrada por scancode (posição física da tecla; o layout do PC controlado define o caractere), coordenadas absolutas no monitor escolhido, processo DPI-aware (pixels físicos). Release: tag `helper-vX.Y.Z` dispara o workflow `helper.yml`.
