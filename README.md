# Sudoku Aneróthico PRÓ — versão modular

## Mapa dos arquivos

- `index.html` — conteúdo, estrutura semântica e layout responsivo.
- `css/app.css` — temas, estilos do tabuleiro, indicadores multiplayer e animações.
- `js/app-state.js` — estado da aplicação, chaves de armazenamento e constantes.
- `js/sudoku-engine.js` — validação, dimensões de blocos, solução e geração de puzzles.
- `js/board-view.js` — criação do DOM do tabuleiro e atualização visual.
- `js/input-controller.js` — teclado, entrada mobile, edição, modo lápis e teclado virtual.
- `js/gameplay.js` — progresso, verificação da solução, cronômetro e início de partidas.
- `js/game-storage.js` — salvar, listar e restaurar partidas locais.
- `js/sharing.js` — códigos de instância/estado e compartilhamento por URL.
- `js/png-export.js` — exportação de tabuleiros para PNG.
- `js/ocr-import.js` — leitura de imagens por OCR e geração de imagem de exemplo.
- `js/multiplayer-ui.js` — lista de jogadores, avatares e componentes visuais de votação.
- `js/multiplayer-service.js` — criação/entrada em salas, presença, sincronização do tabuleiro e movimentos.
- `js/multiplayer-voting.js` — propostas de novo tabuleiro, votação e monitoramento do resultado.
- `js/ui-helpers.js` — notificações toast e formatação de tempo.
- `js/ui-controller.js` — modais, temas e sincronização dos controles visuais.
- `js/app-events.js` — associação de eventos e inicialização da aplicação.
- `js/firebase-client.js` — inicialização do SDK e adaptador usado pelo jogo.
- `js/firebase-config.js` — configuração central da aplicação Firebase.

## Como executar no Windows sem instalar Python

1. Extraia a pasta inteira do ZIP para um local no computador.
2. Dê dois cliques em `Iniciar-Sudoku.bat`.
3. O navegador abrirá o Sudoku automaticamente. Mantenha a janela preta do servidor aberta durante a partida.
4. Para encerrar, feche a janela do servidor.

O iniciador usa o Windows PowerShell, que já vem instalado no Windows. O servidor escuta somente em `127.0.0.1` (este computador); ele não publica a pasta na rede local.

**Importante:** não abra `index.html` diretamente com `file://`. A interface offline pode funcionar, mas os módulos ES do Firebase precisam ser carregados por HTTP/HTTPS e falham com frequência ao abrir como arquivo local. Para jogar juntos, cada pessoa pode iniciar a própria cópia pelo arquivo `.bat`; ambas as cópias se conectam ao mesmo Firebase pela internet.

Em outros sistemas, use qualquer servidor HTTP estático ou hospede a pasta em um serviço de hospedagem estática HTTPS.

## Trocar a configuração Firebase

Altere os valores em `js/firebase-config.js` para apontar a aplicação a outro projeto Firebase. A configuração do app web fica no cliente; as regras do Realtime Database e a autenticação continuam sendo essenciais para proteger os dados.

## Arquitetura e compatibilidade

Para priorizar a continuidade de funcionamento, os arquivos de lógica ainda compartilham o escopo global clássico do navegador. A separação por arquivos já torna mais claro onde cada responsabilidade está, mas os módulos de jogo e multiplayer não são ainda componentes ES isolados com dependências injetadas. `multiplayer-service.js` e `multiplayer-voting.js` ainda dependem do estado/integração do Sudoku. Em outro projeto Firebase, a configuração de conexão pode ser reutilizada, mas reaproveitar a lógica completa de sala sem adaptações exigirá separar um serviço multiplayer genérico da camada de integração do jogo.

## Verificação

Todos os arquivos `.js` passaram na verificação sintática do Node.js. A validação de sintaxe não substitui testes funcionais em navegador, nem testes de concorrência com duas sessões Firebase reais.
