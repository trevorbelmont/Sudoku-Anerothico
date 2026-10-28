# Sudoku Aneróthico PRÓ v6.2

## Execução local no Windows

1. Extraia o ZIP inteiro para uma pasta no computador.
2. Dê dois cliques em `Iniciar-Sudoku.bat`.
3. Aguarde a abertura do navegador. Mantenha a janela do terminal aberta enquanto estiver usando o jogo.
4. Para encerrar, pressione `X` no terminal ou digite `exit` e pressione Enter. Confirme com `Y` para desligar; `N` mantém o servidor ativo. Também é possível usar `Ctrl+C`. Depois da mensagem de encerramento, pressione Enter para fechar a janela.

O iniciador utiliza o Windows PowerShell, incluído no Windows, sem exigir instalação de Python ou Node.js. O servidor local escuta somente em `127.0.0.1` e não publica a pasta para outros dispositivos da rede.

**Importante:** não abra `index.html` diretamente com `file://`. A interface offline pode funcionar, mas os módulos ES do Firebase precisam ser carregados por HTTP/HTTPS. Para jogar juntos, cada pessoa inicia a própria cópia usando `Iniciar-Sudoku.bat`; ambas precisam de internet e se conectam ao mesmo Firebase.

Para abrir em outro navegador instalado neste computador, copie e cole o endereço exibido no terminal (normalmente `http://127.0.0.1:8765/`) na barra de endereços enquanto o servidor estiver ativo. Se a porta padrão estiver ocupada, o iniciador selecionará uma porta próxima e mostrará o endereço correto.

Em outros sistemas, use um servidor HTTP estático ou hospede a pasta em um serviço de hospedagem estática HTTPS.

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
- `js/multiplayer-voting.js` — propostas de novo tabuleiro, votações de recursos, monitoramento do resultado e métricas por jogador.
- `js/ui-helpers.js` — notificações toast e formatação de tempo.
- `js/ui-controller.js` — modais, temas e sincronização dos controles visuais.
- `js/app-events.js` — associação de eventos e inicialização da aplicação.
- `js/firebase-client.js` — inicialização do SDK e adaptador usado pelo jogo.
- `js/firebase-config.js` — configuração central da aplicação Firebase.

## Trocar a configuração Firebase

Altere os valores em `js/firebase-config.js` para apontar a aplicação a outro projeto Firebase. A configuração do app web fica no cliente; as regras do Realtime Database e a autenticação continuam sendo essenciais para proteger os dados.

## Arquitetura e compatibilidade

Para priorizar a continuidade de funcionamento, os arquivos de lógica ainda compartilham o escopo global clássico do navegador. A separação por arquivos já torna mais claro onde cada responsabilidade está, mas os módulos de jogo e multiplayer não são ainda componentes ES isolados com dependências injetadas. `multiplayer-service.js` e `multiplayer-voting.js` ainda dependem do estado/integração do Sudoku. Em outro projeto Firebase, a configuração de conexão pode ser reutilizada, mas reaproveitar a lógica completa de sala sem adaptações exigirá separar um serviço multiplayer genérico da camada de integração do jogo.

## Recursos da versão v6.0 (mantidos)

- O zoom fica abaixo do tabuleiro e aceita os atalhos `+`, `-` e `R` para ampliar, reduzir e restaurar 100%. O tabuleiro adapta sua largura à área visível e limita o tamanho em função da altura da janela.
- Após concluir uma partida, `🔄Xô Tentar de novo essa Bagaça!🔄` reinicia a instância com as mesmas pistas. Em uma sala multiplayer, a ação é confirmada antes de limpar o tabuleiro compartilhado.
- Ao hospedar uma sala, escolha `🤝 Prosa e Cafézin ☕` para cooperar ou `⚔️ Rinha de Galo 🐓` para comparar as contribuições. Na Rinha, a métrica em tempo real é opcional; o resumo final mostra casas atribuídas e porcentagem, incluindo empates.
- Solicitações de NASA e mudanças no erro imediato em uma sala usam um cartão de votação persistente e minimizável. A decisão exige votos favoráveis de pelo menos metade dos participantes conectados; votos contra e abstenções são contabilizados separadamente.

## Verificação

Todos os arquivos `.js` passaram na verificação sintática do Node.js. A validação de sintaxe não substitui testes funcionais em navegador, nem testes de concorrência com duas sessões Firebase reais.

## Versão 6.1 — correções e recursos adicionais

- O Modo Lápis usa slots responsivos em todas as dimensões suportadas. As notas são compartilhadas em salas cooperativas e permanecem locais no modo competitivo.
- Cada uso da NASA é registrado como uma ação `NASA` no histórico de movimentos do Firebase. A contagem é cumulativa por instância e a porcentagem é calculada separadamente das casas atribuídas aos jogadores; o preenchimento especial identifica apenas as casas ainda atribuídas à NASA.
- O modo de foco maximiza o tabuleiro e mantém um botão para restaurar a interface. Atalhos adicionais: `H` (NASA), `E` (votação/alternância do erro imediato), `I` (destacar iguais) e `F11` (modo de foco, conforme suporte do navegador).



## Versão 6.2 — ajustes de apresentação, teclado, votação e PNG

- A atribuição da NASA anima somente o brilho/cor do caractere numérico. As células não recebem preenchimento tracejado nem contorno tracejado; o estilo funciona também nos temas Rainbow e épicos.
- O atalho `N` alterna o Modo Lápis uma única vez quando uma célula está focada. A correção evita que o manipulador da célula e o atalho global invertam o estado duas vezes.
- Votações de recursos multiplayer exigem maioria estrita: mais de 50% dos jogadores conectados. Em uma sala com dois jogadores, ambos precisam aprovar.
- A exportação PNG converte os campos numéricos em elementos de texto apenas na cópia temporária do tabuleiro usada para captura. Os números aparecem na imagem sem alterar as células reais nem o estado da partida.
- Ao entrar em uma sala já criada, o modo efetivo e a opção de métricas em tempo real são carregados dos metadados da própria sala; a seleção local de modo é usada para criar salas, não para substituir as configurações da sala de destino.
