# Sudoku Aneróthico PRÓ v6.8

## Execução local no Windows

1. Extraia o ZIP inteiro para uma pasta no computador.
2. Dê dois cliques em `Iniciar-Sudoku.bat`.
3. Aguarde a abertura do navegador. Mantenha a janela do terminal aberta enquanto estiver usando o jogo.
4. Para encerrar, pressione `X` no terminal ou digite `exit` e pressione Enter. Confirme com `Y` para desligar; `N` mantém o servidor ativo. Também é possível usar `Ctrl+C`. Depois da mensagem de encerramento, pressione Enter para fechar a janela.

O iniciador utiliza o Windows PowerShell, incluído no Windows, sem exigir instalação de Python ou Node.js. O servidor local escuta somente em `127.0.0.1` e não publica a pasta para outros dispositivos da rede.

**Importante:** não abra `index.html` diretamente com `file://`. A interface offline pode funcionar, mas os módulos ES do Firebase precisam ser carregados por HTTP/HTTPS. Para jogar juntos, cada pessoa inicia a própria cópia usando `Iniciar-Sudoku.bat`; ambas precisam de internet e se conectam ao mesmo Firebase.

Para abrir em outro navegador instalado neste computador, copie e cole o endereço exibido no terminal (normalmente `http://127.0.0.1:8765/`) na barra de endereços enquanto o servidor estiver ativo. Se a porta padrão estiver ocupada, o iniciador selecionará uma porta próxima e mostrará o endereço correto.

Em outros sistemas, use um servidor HTTP estático ou hospede a pasta em um serviço de hospedagem estática HTTPS.

## Comandos do terminal (servidor local)

Enquanto o servidor estiver ativo, digite um comando no terminal e pressione Enter. Os comandos de teste exigem o Node.js/npm instalado.

- `help` — mostra os endereços do jogo e os comandos disponíveis.
- `install` — abre uma nova janela do Prompt de Comando e executa `npm install` na pasta `tests/`, instalando o Jest e as dependências de desenvolvimento.
- `test` — abre uma nova janela e roda todos os testes (`npm run test:all`) na pasta `tests/`.
- `test unit` — roda apenas os testes unitários (`npm run test:unit`).
- `test integration` — roda apenas os testes de integração (`npm run test:integration`).
- `clean` (ou `limpar`) — pede confirmação [Y/N] e, se confirmado, remove `tests/node_modules`, `tests/coverage` e `tests/.nyc_output`. Útil para forçar uma reinstalação limpa das dependências de teste.
- `reset storage` — pede confirmação [Y/N] e, se confirmado, abre o navegador em `http://localhost:8765/dev-clean-storage`, uma rota fantasma do servidor que executa `localStorage.clear()` no navegador e volta ao jogo. Apaga partidas salvas, configurações e estados locais do navegador atual.
- `exit` (ou `X` / `Ctrl+C`) — solicita o encerramento com confirmação [Y/N].

Os comandos `install` e `test*` abrem uma janela separada do Prompt de Comando, mantendo o servidor do jogo ativo. É necessário instalar o Node.js LTS; ele já inclui `npm` e `npx`. O comando `install` usa `npm install` (não é necessário executar `npx npm`). Depois da instalação, `test` executa diretamente os scripts npm definidos em `tests/package.json`. Se o Jest ainda não estiver instalado, o servidor orienta a executar `install` primeiro. Os comandos `clean` e `reset storage` são destrutivos e sempre pedem confirmação. A porta exibida no terminal é usada na rota fantasma (normalmente 8765).

## Mapa dos arquivos

- `index.html` — conteúdo, estrutura semântica e layout responsivo.
- `css/app.css` — temas, estilos do tabuleiro, indicadores multiplayer e animações.
- `js/core/config.js` — central de configuração (APP_CONFIG — Single Source of Truth).
- `js/core/app-state.js` — estado da aplicação, chaves de armazenamento e constantes.
- `js/core/sudoku-engine.js` — validação, dimensões de blocos, solução e geração de puzzles.
- `js/core/gameplay.js` — progresso, verificação da solução, cronômetro e início de partidas.
- `js/ui/board-view.js` — criação do DOM do tabuleiro e atualização visual.
- `js/ui/ui-helpers.js` — notificações toast e formatação de tempo.
- `js/ui/ui-controller.js` — modais, temas e sincronização dos controles visuais.
- `js/ui/app-events.js` — associação de eventos e inicialização da aplicação.
- `js/ui/panel-system.js` — painel lateral redimensionável e recolhível.
- `js/ui/dev-mode.js` — modo desenvolvedor e ferramentas de limpeza de armazenamento.
- `js/network/firebase-config.js` — configuração central da aplicação Firebase.
- `js/network/firebase-client.js` — inicialização do SDK e adaptador usado pelo jogo.
- `js/network/multiplayer-ui.js` — lista de jogadores, avatares e componentes visuais de votação.
- `js/network/multiplayer-service.js` — criação/entrada em salas, presença, sincronização do tabuleiro e movimentos.
- `js/network/multiplayer-voting.js` — propostas de novo tabuleiro, votações de recursos, monitoramento do resultado e métricas por jogador.
- `js/services/input-controller.js` — teclado, entrada mobile, edição, modo lápis e teclado virtual.
- `js/services/game-storage.js` — salvar, listar e restaurar partidas locais.
- `js/services/sharing.js` — códigos de instância/estado e compartilhamento por URL.
- `js/services/png-export.js` — exportação de tabuleiros para PNG.
- `js/services/ocr-import.js` — leitura de imagens por OCR e geração de imagem de exemplo.

## Trocar a configuração Firebase

Altere os valores em `js/network/firebase-config.js` para apontar a aplicação a outro projeto Firebase. A configuração do app web fica no cliente; as regras do Realtime Database e a autenticação continuam sendo essenciais para proteger os dados.

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


## Versão 6.4 — seleção inteligente de cores multiplayer

- Ao entrar em uma sala, a seleção compara uma paleta ampliada com as cores atribuídas a participantes online, registros históricos e reservas existentes, usando distância perceptual OKLab para maximizar a distância até a cor já utilizada mais próxima.
- A cor escolhida é registrada em `rooms/{roomId}/colorAssignments/{playerId}` por uma transação Firebase, evitando colisões de atribuição em entradas simultâneas quando as regras do banco permitem a gravação. A cor válida já associada ao mesmo identificador é preservada, inclusive em reconexões.
- A lógica mantém compatibilidade com registros de salas anteriores sem reservas, preserva cores válidas já existentes e continua alimentando avatares, contribuições e contornos da v6.3. Nenhuma regra ou mecânica do Sudoku foi alterada.

## Versão 6.3 — atribuição visual multiplayer

- Na ⚔️ Rinha de Galo 🐓, quando **Métricas em tempo real** está ligada, o contorno dos números atribuídos a jogadores usa a cor do avatar responsável. O preenchimento do caractere e os demais indicadores de tema permanecem intactos; pistas, casas vazias e contribuições da NASA ficam fora dessa regra.
- A partir desta versão, o código passou a capturar métricas de gameplay nas salas multiplayer.


## Versão 6.5 — privacidade, anti-cheat, proteção de sala e robustez

- **Metadados de sala:** as dimensões de tela e viewport foram removidas dos metadados enviados por jogador. Os metadados restantes são gravados em um nó privado separado do nó de presença compartilhado, não visível para os demais participantes da sala.
- **Anti-cheat — células corretas:** em salas multiplayer, uma célula que já contém o valor correto da solução não pode ser apagada por nenhum jogador (nem local nem remoto). Células erradas continuam apagáveis.
- **Cursor multiplayer sem inflação de log:** a posição do cursor/foco de cada jogador é publicada em um nó mutável por jogador (`cursors/{playerId}`), em vez de ser anexada ao log de movimentos a cada evento de foco.
- **Votações com tempo máximo de 45 s:** todas as votações (novo tabuleiro e recursos como NASA e erro imediato) são automaticamente canceladas se a maioria não for atingida em 45 segundos.
- **Votações — atalho solo:** se o jogador está sozinho na sala ao propor uma votação, a ação é tomada imediatamente sem abrir votação.
- **Votações em tela cheia:** o modal de votação de novo tabuleiro e o painel de votação de recursos aparecem na frente do tabuleiro no modo tela cheia (F11).
- **IDs de sala com melhor entropia:** o identificador de sala gerado automaticamente usa `crypto.getRandomValues` em vez de `Math.random`.
- **Solução não exposta no Firebase:** a grade de solução não é mais publicada nos metadados da sala; cada cliente re-deriva a solução localmente via solver.
- **Robustez — localStorage:** acessos ao `localStorage` sem tratamento de erro passaram a ser protegidos com `try/catch`.
- **Proteção de sala contra sobrescrita:** ao tentar criar uma sala com nome personalizado já existente, o sistema verifica o estado da sala. Salas com jogadores ativos ou usadas nos últimos 2 dias (`ROOM_PROTECTION_DAYS`) são protegidas; toda presença renova o marcador de atividade.

## Versão 6.6 — identidade luminosa, animações, configurações visuais e CI/CD

- **Identidade luminosa do jogador:** células preenchidas pelo próprio jogador em salas multiplayer recebem um glow de fundo com cor harmônica ao tema ativo, com variáveis CSS próprias para cada um dos 9 temas.
- **Animação de inserção de número:** ao inserir um dígito, o número recebe uma transição pop sutil e contida na célula.
- **Modal de Configurações Visuais:** novo botão de engrenagem na barra superior abre um painel com controles deslizantes para intensidade das luzes e velocidade das animações. "Off" na velocidade torna o glow estático; "Off" na intensidade remove completamente o glow. Configurações persistidas no `localStorage`.
- **Botões de dificuldade compactos:** as métricas dinâmicas de pistas e porcentagem foram movidas para a linha de baixo dentro de cada botão de dificuldade.
- **Fix — botão Modo Lápis:** corrigido o layout flexbox do botão para que ícone, texto e badge OFF/ON fiquem sempre contidos e alinhados.
- **Persistência de identidade multiplayer:** o `playerId` é gerado com `crypto.getRandomValues` e persistido no `localStorage`, preservando cor, titularidade de células e histórico de contribuição em recargas e reconexões.
- **Otimização de tráfego Firebase — moves:** o listener do log de jogadas migrou de `onValue` (baixa o nó completo a cada novo move) para `onChildAdded` (recebe apenas a jogada individual). A contagem de NASA calls é inicializada via `get()` único na entrada da sala.
- **Timestamp atômico:** os payloads de jogadas usam `serverTimestamp()` do Firebase como campo `timestamp`, com `clientTimestamp` como fallback de ordenação imediata.
- **Workflow de CI/CD:** workflow do GitHub Actions com verificação sintática (`node --check`) de todos os arquivos JavaScript. Verificação sintática também integrada ao servidor local.
- **Tema Dark Overlord:** novo tema adicionado à paleta, com refinamentos de contraste e animação.

## Versão 6.7 — CLI do servidor, configuração centralizada e correções

- **CLI interativa do servidor local:** o terminal do PowerShell (`servidor-local.ps1`) ganhou comandos de automação: `install` (npm install), `test`, `test unit`, `test integration`, `clean` (remove `node_modules` e caches), `reset storage` (rota fantasma que limpa o `localStorage` do navegador), e `help`.
- **Rota fantasma de reset:** o comando `reset storage` abre o navegador em `http://localhost:8765/dev-clean-storage`, uma rota especial que executa `localStorage.clear()` e redireciona de volta ao jogo.
- **Scripts centralizados:** o `tests/package.json` passa a expor `test:all`, `test:unit`, `test:integration` e `clean`.
- **Central de configuração (APP_CONFIG):** `js/core/config.js` reúne todos os "magic numbers" e "magic strings" anteriormente espalhados pelos módulos. A versão canônica da aplicação parte daqui; `servidor-local.ps1` e `Iniciar-Sudoku.bat` também lêem `APP_VERSION` deste arquivo.
- **Correções:** sublinhado das pistas (hint numbers) restaurado; tamanho inicial do tabuleiro corrigido em abas/recarregamentos.
- **Backend:** adição de `.butIgnore` (regras de exclusão para backup de salas) e `.environment.example` (modelo de variáveis de ambiente).

## Versão 6.8 — reorganização modular, modo desenvolvedor e backend GAS

- **Reorganização modular:** arquivos JavaScript reorganizados em subdiretórios por responsabilidade — `js/core/` (motor, estado, configuração), `js/ui/` (visual, eventos, painel, modo dev), `js/network/` (Firebase, multiplayer) e `js/services/` (input, storage, exportação, OCR, compartilhamento). O mapa de arquivos acima foi atualizado para refletir a nova estrutura.
- **Easter Egg — Modo Desenvolvedor:** clicar rapidamente 9 vezes no logo "9" do cabeçalho (em até 4 s) ativa o Modo Desenvolvedor, confirmado por um toast discreto. A ativação dura a sessão da aba.
- **Limpeza de memória no front-end:** o modal de Configurações Visuais exibe (apenas com o Modo Desenvolvedor ativo) uma seção com três botões — Resetar Configurações Visuais, Apagar Todo o Histórico de Jogos Salvos e Nuclear (Reset de Fábrica Completo), cada um com confirmação nativa antes de remover as chaves exatas do `localStorage`.
- **Backend GAS — Master Orchestrator e Cold Storage:** `master_orchestrator.js` despacha jobs declarativos; o job `coldstorage_rooms` faz backup diferencial de `rooms` para Google Drive baseado em watermark `updatedAt`, com configuração declarativa versionada e telemetria padronizada.
- **Ferramentas Clasp/secrets:** tooling para deploy e gerenciamento do projeto Google Apps Script.
- **`updatedAt` no Firebase:** campo adicionado aos nós do Firebase para servir de watermark de backup diferencial.
