# Implementação — Cold Storage Jianmu (L1) → Yggdrasil (L2)

**Projeto:** Sudoku Aneróthico PRÓ  
**Estado deste artefato:** implementação local concluída; ainda não implantada em serviços reais.  
**Data da implementação:** 18/11/2026

Este documento complementa `Trivia/estrategia-migracao-coldstorage-yggdrasil.md`. A estratégia original foi preservada integralmente; este arquivo registra o que foi efetivamente implementado no snapshot do projeto.

## 1. Resultado arquitetural

O destino ativo do job `coldstorage_rooms` passa a ser Cloud Firestore. O Firebase Realtime Database permanece como fonte viva Jianmu/L1. O ledger individual de sincronização e o checkpoint administrativo continuam no RTDB, nos caminhos de backend protegidos, com funções e constantes identificadas pelo domínio Eden.

O contrato público `executeColdStorageRooms(isOrchestrated, customOptions)`, o wrapper `executeFirebaseBackup()`, o identificador `coldstorage_rooms`, a integração com o Master, o lock, os modos standalone/orquestrado e a telemetria de 11 colunas foram preservados.

A antiga persistência em Drive foi mantida na função `runColdStorageDriveLegacyCore()` para referência e rollback por restauração controlada do código. Ela não é chamada pelo fluxo ativo. Arquivos JSON já existentes no Drive não são apagados. O Drive continua necessário para os fluxos de planilha/telemetria.

## 2. Modelo Firestore

A coleção raiz é `cold_rooms/{encodedRoomId}`. Os IDs são codificados deterministicamente como hexadecimal de unidades UTF-16, com prefixo `id_`, e a função inversa está disponível para reconstrução do identificador original.

Estrutura persistida:

```text
cold_rooms/{roomId}
  roomId, schemaVersion, projectionVersion, currentInstanceNumber,
  sourceUpdatedAt, lastSyncedHash, synchronizedAt

  instances/{instanceNumber}
    roomId, instanceNumber, meta, boardState, settings,
    archivedAtTimestamp, isCurrent

    contributions/{cellKey}
      roomId, instanceNumber, cellKey, contribution

  members/{playerId}
    roomId, playerId, member
```

As instâncias arquivadas são preservadas no Firestore. A reconciliação de deletes de contribuições ocorre somente na subcoleção de contribuições da instância corrente. Não há exclusão automática de instâncias ou de salas ausentes no snapshot L1. Após o commit Firestore e a gravação do marcador Eden, o GAS remove do RTDB somente as chaves de `history` incluídas no snapshot confirmado. `contributionEvents` não integra a projeção nem o hash, não gera documentos Firestore e não é removido por esta compactação. Se a compactação de `history` falhar, a execução é marcada como incompleta; em nova varredura, o hash/marker permite repetir a operação sem perder a cópia confirmada.

## 3. Projeção e privacidade

A projeção é uma allowlist explícita em `jianmu_projectRoomData()` e `jianmu_projectInstanceSnapshot()`.

Campos persistentes incluídos:

- `meta`: metadados necessários à reconstrução/descrição da instância, incluindo `fixedInitialGrid`, mas não `solutionGrid`;
- `boardState`: estado publicado do tabuleiro e dados associados;
- `settings`: configurações persistentes atualmente usadas pelo jogo;
- `members`: identificador, nome, cor e horário de entrada;
- `contributions`: autoria persistente por célula;
- `history`: snapshots das instâncias anteriores.

Por allowlist, ficam fora do L2 `solutionGrid`, `privateData`, `clientMetadata`, `players`, `presence`, `moves`, `cursors`, `contributionEvents`, `proposal`, `featureVote` e demais dados que não foram explicitamente incluídos. `.butIgnore` continua sendo aplicado como filtro complementar.

O código não altera as regras de leitura pública existentes em `/rooms`; portanto, o fato de `privateData` ser excluído da L2 não deve ser confundido com uma correção da exposição no L1. **A regra `.read: true` em `/rooms` alcança os descendentes**, inclusive `/privateData/{playerId}/clientMetadata`, que o cliente atual grava. Assim, esses metadados podem ser lidos por qualquer cliente capaz de consultar o RTDB, apesar do nome `privateData`. Essa exposição preexistente não foi corrigida nesta migração porque o código atual consome a sala por listeners e uma restrição no nó raiz exigiria decompor esses listeners e revisar as permissões de cada subnó. É um risco de privacidade real que deve ser tratado antes de publicar/usar dados pessoais em produção.

## 4. Hash e controle de sincronização

Cada varredura válida lê `/rooms.json`, aplica `.butIgnore`, constrói a projeção persistente e calcula um SHA-256 de JSON canônico. A canonicalização ordena chaves de objetos, preserva ordem de arrays e rejeita valores numéricos não finitos e elementos `undefined` em arrays.

O estado por sala é armazenado em:

```text
/eden/coldstorage_rooms/room_sync/{roomId}
```

O marcador contém schema/projection version, hash confirmado, status, timestamp, identificação da execução, instância e timestamp de origem. O marcador só é gravado depois da confirmação do commit Firestore.

- marcador ausente: sincronização inicial;
- hash/versão iguais: sala ignorada;
- hash ou versão divergentes: sincronização;
- falha ao ler marcador: falha, não equivale a marcador ausente;
- falha no commit: não grava marcador;
- commit confirmado e marcador falho: repetição idempotente no próximo ciclo.

A comparação é feita para todas as salas em cada varredura. `updatedAt` é diagnóstico/telemetria, não é o filtro exclusivo. Isso detecta alterações persistentes em subnós que não atualizem o timestamp da raiz.

O checkpoint global em `/server_meta/coldstorage_rooms.json` é avançado somente depois de todas as salas da varredura terem sido confirmadas ou reconhecidas como inalteradas. A rotina ativa não chama `stampLegacyWatermarks()` e não escreve timestamps artificiais nas salas L1.

## 5. Histórico de partidas e eventos

A troca de instância no cliente agora usa `runTransaction()` Firebase na raiz da sala. A transação captura o estado corrente de `meta`, `boardState`, `settings` e `contributions`, cria `history/{instanceNumber}` se ainda não existir e publica o novo `meta`, o novo tabuleiro e contribuições vazias em uma única operação transacional. Se o SDK não oferecer transações, ou se `meta.instanceNumber`/`boardState.boardInstanceNumber` não corresponderem à instância esperada, a operação é abortada para não descartar o estado anterior. Se o estado corrente não corresponder à instância esperada, a transação é abortada em vez de sobrescrever dados de uma instância concorrente.

As jogadas que alteram autoria de célula atualizam em um único multipath update a célula do tabuleiro, a contribuição corrente (SET ou remoção) e o sidecar `contributionEvents/{instanceNumber}/{eventId}` que o cliente já registra no RTDB. Esse sidecar permanece no RTDB, mas é deliberadamente ignorado pelo Cold Storage: não participa da projeção nem do hash, não gera documentos em Yggdrasil e não é removido pela compactação. A informação necessária para retomar a instância é o snapshot do tabuleiro (`boardState`) e o mapa consolidado de autoria (`contributions`), não a sequência de eventos. A versão da projeção foi incrementada para 2 para forçar a reconciliação do novo formato L2.

## 6. Firestore REST e limites

O GAS utiliza `ScriptApp.getOAuthToken()` para `documents:commit` e `listDocuments`. Os documentos são atualizados com `updateMask` explícita e IDs determinísticos. A conversão trata `null`, boolean, string, integer, double, mapas e arrays; matrizes aninhadas são codificadas por mapas de linha com marcador interno versionado e podem ser reconstruídas pela função inversa.

Limites operacionais conservadores definidos no script:

- 900 KiB por documento;
- 9 MiB por request;
- 450 writes por commit;
- paginação de listagem de até 1000 documentos por página.

Exceder esses limites provoca falha explícita da sala, sem truncamento nem checkpoint de sucesso. Um commit é feito por sala; deletes obsoletos são calculados somente para contribuições da instância corrente.

## 7. Configuração necessária no ambiente

Script Properties necessárias ao novo caminho:

- `FIREBASE_URL`;
- `FIREBASE_SECRET`;
- `PROJECT_ID`;
- URLs declarativas de configuração/regras;
- variáveis da telemetria conforme o funcionamento atual.

`DRIVE_FOLDER_ID` deixa de ser obrigatório para o destino ativo do Cold Storage; permanece opcional/depreciado para compatibilidade com a implementação legada. `LOG_SHEET_FOLDER_ID` e dependências de Drive/Sheets da telemetria foram mantidas.

O manifesto GAS declara os escopos de Firestore Datastore, chamadas externas, gerenciamento de triggers, armazenamento de script properties, Sheets e Drive. A conta que executa o script ainda precisa de IAM adequado para leitura/listagem e escrita no Firestore do projeto indicado em `PROJECT_ID`.

As regras RTDB incluem uma negação explícita para `/eden`, além do bloqueio geral de clientes. O GAS usa a credencial administrativa existente para operar os metadados. A semântica e disponibilidade real dessa credencial não foram testadas contra o projeto remoto nesta implementação local.

**Limitações de segurança herdadas:** `/rooms` continua com `.read: true` e cada `/rooms/$room_id` mantém `.write: true`. A leitura pública em `/rooms` inclui `privateData/clientMetadata`, que o código atual grava apesar do nome sugerir privacidade. A escrita no nó da sala também alcança os descendentes. Como permissões RTDB concedidas em um ancestral se propagam aos descendentes, regras `.read: false`/`.write: false` em `history`, `contributionEvents` ou `privateData` não revogariam o acesso concedido no ancestral. Portanto, os eventos são append-only pelo comportamento normal do cliente, mas não são invioláveis contra um cliente malicioso: ele ainda poderia alterar/apagar entradas dentro da sala. As regras não foram estreitadas nesta migração para evitar quebrar os listeners e o multiplayer existentes. Antes de publicação, é necessária uma migração específica de autorização: separar os listeners públicos dos metadados pessoais e mover a gravação/leitura privada para um caminho cuja identidade possa ser validada por regras confiáveis. Para auditoria antifraude/imutável, a emissão/verificação dos eventos também deverá passar por componente confiável de servidor.

**Concorrência e custo:** a troca de instância usa uma transação na raiz da sala para capturar um snapshot consistente, evitando perder jogadas concorrentes entre leituras separadas e o reset do tabuleiro. Isso faz a operação transacional ler/escrever o objeto atual da sala e pode elevar tráfego/contenção em salas grandes; ela ocorre apenas na troca de partida. A compactação pós-backup reduz o crescimento de snapshots/eventos no RTDB, mas a primeira varredura após a compactação pode exigir uma sincronização adicional para atualizar o hash da projeção compactada.

## 8. Verificações executadas

Executado localmente:

- `node --check` em `backup-coldstorage.js`;
- `node --check` em `multiplayer-service.js`;
- `node --check` em `multiplayer-voting.js`;
- `node --check` em `update-secrets.js`;
- `node --check` nos helpers e testes novos;
- parse JSON do `appsscript.json`;
- harness Node com mocks para: sincronização inicial de sala legada, skip em ciclo inalterado, detecção de mudança em membro sem mudança no `updatedAt` raiz, ignorar alteração isolada do watermark da raiz, falha HTTP do commit sem marcador/checkpoint, round-trip de matriz 25×25, rejeição de inteiros fora da precisão segura e IDs que coincidem com nomes de propriedades de protótipo;
- teste adicional da compactação pós-commit, verificando que históricos/eventos são removidos do L1 apenas após confirmação e permanecem representados nos writes Firestore;
- validação fail-closed de sala e snapshot histórico sem a estrutura mínima de instância.

Resultado do harness manual: aprovado nos cenários executados. Os testes automatizados Jest foram adicionados em `tests/unit/gas-yggdrasil.test.js`, mas a suíte Jest completa não foi executada: a instalação das dependências não pôde ser concluída neste ambiente (dependência ausente do cache offline e tentativa online expirada). Os testes existentes foram preservados.

Não foram executados deploy GAS, publicação de regras RTDB, habilitação/configuração remota do Firestore, backfill real ou escrita em serviços de produção.

## 9. Checklist antes da ativação

1. Conferir `PROJECT_ID` em Script Properties e confirmar que ele identifica o projeto Firestore pretendido.
2. Habilitar a API Cloud Firestore e criar/confirmar o banco `(default)` na região escolhida.
3. Conceder ao principal efetivo do GAS a permissão IAM necessária para obter/listar/gravar documentos.
4. Publicar as alterações de `backend/GAS/appsscript.json` e autorizar os novos escopos na conta correta.
5. Revisar e publicar `backend/config/database.rules.json` em ambiente de teste antes de produção.
6. Conferir acesso administrativo do GAS a `/server_meta` e `/eden`, sem expor o segredo ao cliente.
7. Executar canário com poucas salas e comparar contagens, instâncias, matrizes, membros e contribuições.
8. Executar um segundo ciclo sem alterações e confirmar que o Firestore não recebe novos commits para essas salas.
9. Alterar um subnó persistente sem alterar `updatedAt` da raiz e confirmar nova sincronização.
10. Só então habilitar o trigger Master para o fluxo L2.

Não apagar os backups JSON anteriores do Drive durante a ativação nem como parte do rollback.
