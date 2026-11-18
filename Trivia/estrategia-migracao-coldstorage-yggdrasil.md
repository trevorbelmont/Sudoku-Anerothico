# Estratégia de migração do Cold Storage para L1/L2 — Jianmu → Yggdrasil

**Projeto:** Sudoku Aneróthico PRÓ  
**Arquivo-alvo:** `backend/GAS/backup-coldstorage.js`  
**Objetivo deste documento:** analisar o comportamento que já existe no snapshot fornecido e definir uma estratégia segura de migração. **Não é uma implementação do código.**

---

## 1. Conclusão executiva

A migração proposta é viável, mas o prompt atual ainda não está suficientemente alinhado ao comportamento real do projeto. Não basta trocar `DriveApp.createFile()` por um POST ao Firestore. O script atual tem responsabilidades e contratos que precisam continuar funcionando, enquanto a nova arquitetura introduz problemas de modelagem, sincronização diferencial, exclusão de dados, serialização e atomicidade que o prompt ainda não resolve.

A recomendação é:

1. **Preservar a casca operacional atual:** `executeColdStorageRooms()`, os modos standalone/orquestrado, o `Script Lock`, o contrato de métricas, o wrapper REST legado e a integração com o Master.
2. **Substituir o núcleo de persistência:** sair do envelope JSON no Drive e construir documentos Firestore determinísticos, com `updateMask` e `documents:commit`.
3. **Rever o critério de elegibilidade:** manter `updatedAt` como uma das âncoras, mas não tratá-lo como um carimbo universal de todas as alterações persistentes. O próprio cliente grava alguns subnós sem atualizar o `updatedAt` da raiz.
4. **Definir a semântica de histórico:** a estrutura sugerida no prompt, se implementada literalmente, sobrescreve o estado atual de uma sala e pode sobrescrever contribuições de partidas anteriores. Isso não equivale a guardar a árvore histórica completa.
5. **Definir como tratar exclusões:** upsert não propaga automaticamente a remoção de uma contribuição no L1 para a Yggdrasil.
6. **Avançar o watermark apenas depois de confirmar todos os commits necessários:** a implementação atual não valida adequadamente os códigos HTTP de alguns PATCHes do RTDB.
7. **Atualizar o ferramental adjacente:** o `.environment`, `.environment.example` e `backend/update-secrets.js` ainda tratam `DRIVE_FOLDER_ID` como obrigatório. A configuração do OAuth do GAS também precisa ser revista.

A migração pode ficar concentrada no `backup-coldstorage.js` quanto ao núcleo de sincronização, mas **não será operacionalmente completa** sem pequenos ajustes de configuração, provisionamento de secrets e testes.

## 2. Escopo e limites da análise

A análise toma como base o arquivo concatenado enviado em 17/11/2026, incluindo o script GAS, Master Orchestrator, regras do RTDB, configuração declarativa, `.butIgnore`, helper de testes e código multiplayer.

O documento separa:

- **Comportamento observado:** algo que aparece diretamente no código do snapshot.
- **Consequência técnica:** o que esse comportamento implica para a migração.
- **Recomendação:** mudança proposta para o prompt de implementação.

Não foi feita alteração no jogo, no backend ou nos arquivos originais. Também não foi executado um deploy nem uma suíte de testes contra Firebase/Firestore reais.

**Limitação importante do snapshot:** não localizei nele uma implementação de Firestore, `PROJECT_ID`, `documents:commit`, `convertToFirestoreValue()` ou um fluxo de leitura Firestore → RTDB. Portanto, o código de Firestore descrito no prompt será uma camada nova neste conjunto de arquivos, e não a adaptação de um cliente L2 já presente no snapshot. Caso exista outra versão/branch com esses componentes, ela deve ser comparada antes da implementação.

---

## 3. O que o script atual realmente faz

### 3.1 Entrada e modos de execução

`executeColdStorageRooms(isOrchestrated, customOptions)` é o ponto de entrada do job `coldstorage_rooms`.

- No modo standalone, adquire o `Script Lock` com timeout próprio.
- No modo orquestrado, recebe do Master a configuração validada, as regras `.butIgnore` já carregadas, `wakeUpTime`, `runId`, `invocation` e a indicação de que o lock já está retido.
- Se não receber configuração/regras injetadas, carrega-as por conta própria.
- Executa `runColdStorageCore()`.
- Persiste metadados de execução no RTDB.
- Grava telemetria própria apenas no modo standalone; quando chamado pelo Master, devolve métricas para o Master gravar em lote.
- Em erro, tenta registrar métricas de falha e telemetria, sem deixar o erro secundário mascarar o resultado principal.

O wrapper `executeFirebaseBackup()` preserva a ação legada `action=backup`. Esse contrato externo deve continuar existindo durante a migração, salvo decisão explícita em contrário.

### 3.2 Configuração e regras

O script utiliza as funções compartilhadas do `master_orchestrator.js`, pois todos os arquivos GAS compartilham o escopo global.

A configuração declarativa e o `.butIgnore` seguem uma estratégia Firebase-first com fallback para GitHub Raw, cache e auto-seed quando necessário. A ausência de uma fonte válida de regras `.butIgnore` é tratada como falha segura; não é para executar o backup silenciosamente sem filtros.

Esse comportamento é valioso e deve ser preservado. A migração não precisa inventar um novo carregador de configuração.

### 3.3 Leitura e filtro diferencial atuais

O núcleo atual:

1. Lê `last_backup_timestamp` em `/server_meta/coldstorage_rooms.json`.
2. Captura/recebe `wakeUpTime` no início do ciclo.
3. Faz GET de `/rooms.json` no RTDB.
4. Calcula `bytesDownloaded` usando o conteúdo binário recebido.
5. Filtra salas pela janela `[lastBackupTimestamp, wakeUpTime)` usando `room.updatedAt`.
6. Inclui salas legadas sem `updatedAt`, com `null`, `0` ou valor inválido.
7. Adia salas com `updatedAt >= wakeUpTime` para uma execução posterior.
8. Exclui salas com `updatedAt < lastBackupTimestamp`.

A função `filterEligibleRooms()` também devolve a lista de IDs legados para uma etapa posterior.

### 3.4 Filtro `.butIgnore`

O script faz uma cópia profunda das salas elegíveis e aplica as regras antes de persistir. A travessia começa pelo prefixo `rooms`, para que as regras com caminhos completos, como `rooms/*/moves`, continuem casando.

O `.butIgnore` fornecido contém:

```ini
[coldstorage_rooms]
rooms/*/moves
rooms/*/presence
rooms/*/cursors
```

Há também uma regra global `presence`.

A implementação atual **remove somente os caminhos declarados**. Ela não implementa uma lista de permissões de campos persistentes.

### 3.5 Persistência atual e checkpoint

O destino atual é um arquivo JSON no Google Drive. O envelope contém `schemaVersion`, `jobId`, `runId`, `generatedAt`, `sourcePath`, janela de watermark, resumo e mapa de salas.

A sequência é essencial:

1. Filtra as salas.
2. Aplica `.butIgnore` em uma cópia.
3. Serializa o envelope.
4. Cria o arquivo no Drive.
5. Só depois avança `last_backup_timestamp`.
6. Em seguida, grava `updatedAt` retroativo nas salas legadas.

É uma estratégia de checkpoint-last, mas existe uma sutileza: a etapa de watermark retroativo no RTDB é um efeito colateral do sincronizador atual e não pode ser levada para a nova versão, porque o requisito novo proíbe o sincronizador de escrever no L1.

### 3.6 Metadados do Master e telemetria

Há dois estados diferentes que não devem ser confundidos:

- **Cursor dos dados:** `last_backup_timestamp`, usado para decidir que dados do RTDB devem ser sincronizados.
- **Estado do job:** `last_completed_at`, `last_success_at`, `last_scheduled_at`, `last_scheduled_success_at`, `last_run_id` e afins, usados pelo Master para decidir quando executar novamente.

O Master usa `ALL`, `ALL_SUCCEEDED`, `SCHEDULED` e `SCHEDULED_SUCCEEDED`, com âncoras diferentes. A migração do destino não exige alterar essa política.

A telemetria tem 11 colunas e é compartilhada entre Master e jobs. O `metricsToRow()` continua esperando `bytesDownloaded`, `bytesSaved`, `target`, `itemsProcessed`, `status`, `errorTrace` e `notes`.

**Recomendação:** manter o contrato de `JobMetrics`, os cabeçalhos e a lógica append-only nesta primeira migração. O atual cabeçalho `Bytes_Drive` ficará semanticamente defasado ao receber bytes enviados/gravados no Firestore. Não renomeá-lo silenciosamente nesta etapa; planejar uma migração de schema da planilha separada, ou documentar temporariamente que a coluna passa a representar bytes persistidos na L2.

---

## 4. Dependências reais fora do arquivo-alvo

Embora o trabalho principal seja substituir o núcleo de `backup-coldstorage.js`, o snapshot mostra referências externas que impedem uma migração estritamente isolada.

| Arquivo | Situação atual | Ação necessária |
|---|---|---|
| `backend/GAS/master_orchestrator.js` | Registra `executeColdStorageRooms`, despacha o job serialmente, injeta contexto e grava as métricas. A documentação ainda cita `DRIVE_FOLDER_ID`. | Preservar lógica e contratos. Atualizar apenas comentários/documentação de dependências do Drive de arquivo, se necessário. |
| `.environment` | Contém `DRIVE_FOLDER_ID` configurado. | Remover essa chave da configuração de Cold Storage e adicionar `PROJECT_ID`. Não reproduzir valores de secrets. |
| `.environment.example` | Documenta `DRIVE_FOLDER_ID` como obrigatório para o arquivo JSON. | Substituir por `PROJECT_ID`; manter `LOG_SHEET_FOLDER_ID` se a planilha de telemetria continuar usando pasta do Drive. |
| `backend/update-secrets.js` | Inclui `DRIVE_FOLDER_ID` em `REQUIRED_KEYS`, prompts e injeção de Script Properties. | Remover `DRIVE_FOLDER_ID` da lista obrigatória e acrescentar `PROJECT_ID`. |
| `backend/GAS/appsscript.json` | V8, fuso horário; não declara `oauthScopes` explicitamente. | Rever escopos e autorização para o Firestore REST. |
| `tests/helpers/gas-loader.js` | Carrega Master + Cold Storage no mesmo escopo e fornece mocks de serviços GAS, incluindo `DriveApp` e `ScriptApp`. | Adaptar os mocks para capturar headers/POST do Firestore e token OAuth. Não remover mocks do Drive às cegas: o subsistema da planilha ainda pode usar `DriveApp`. |
| `tests/unit/gas-butignore.test.js` | Testa parser, regras e filtro diferencial. | Preservar e complementar com testes de projeção e filtro. |
| `tests/unit/gas-fallback.test.js` | Testa Firebase-first, fallback, cache e auto-seed. | Preservar. |
| `tests/unit/gas-master.test.js` | Testa agendamento, políticas, lock e dispatch do Master. | Preservar como teste de regressão do contrato de job. |

### Atenção: Google Drive e telemetria

O prompt diz que o Google Drive não faz mais parte da arquitetura. Isso precisa ser interpretado como **o Drive deixa de ser o destino dos dados de Cold Storage**.

O projeto ainda usa Google Sheets para telemetria e o código de provisionamento da planilha pode usar `DriveApp` e `LOG_SHEET_FOLDER_ID` para organizar a planilha. Remover toda e qualquer referência a Drive do projeto exigiria uma mudança adicional na telemetria, que é explicitamente solicitada como preservada. A instrução de remoção deve, portanto, ser precisa: eliminar a dependência `DRIVE_FOLDER_ID`/arquivos JSON de backup, não quebrar a gestão da planilha de telemetria.

---

## 5. Incompatibilidades e riscos do prompt atual

### 5.1 `updatedAt` não representa todas as alterações persistentes

Este é o principal problema do filtro proposto.

O cliente atual atualiza `room.updatedAt` em operações de publicação do tabuleiro (`publishRoomBoardState()` e `publishRoomBoardCell()`). Isso cobre boa parte das alterações de jogo e faz com que alterações de célula também marquem a sala.

Entretanto, encontrei caminhos persistentes que não atualizam a raiz:

- `registerRoomPresence()` grava `members/{playerId}` separadamente.
- A alteração de `settings.immediateErrorCheck` grava `settings` sem atualizar `room.updatedAt`.
- `executeMultiplayerNewGame()` grava `meta`, `boardState` e limpa `contributions` separadamente, sem escrever o `updatedAt` da raiz nesse fluxo.
- A reserva transacional em `colorAssignments` não grava `updatedAt` da raiz.

Consequência: uma sala pode ter `updatedAt < lastBackupTimestamp` e ainda assim conter um `member`, `setting` ou `meta` mais recente que nunca foi sincronizado. O filtro atual a descartaria.

**Recomendação sem alteração imediata no jogo:** complementar a elegibilidade com timestamps que já existem nos subnós persistentes. Um helper conceitual como `jianmu_getPersistentRoomTimestamp(room)` pode calcular o maior timestamp entre:

- `room.updatedAt`;
- `room.meta.createdAtTimestamp`;
- `room.boardState.updatedAtTimestamp`;
- `room.settings.immediateErrorUpdatedAt`;
- `members[*].joinedAtTimestamp`;
- `contributions[*].timestamp`.

A sala será elegível quando o maior timestamp persistente estiver dentro da janela `[lastBackupTimestamp, wakeUpTime)`. Timestamps ausentes/inválidos continuam seguindo a política conservadora de legado. Essa regra precisa ser testada com cada tipo de alteração.

`colorAssignments` não possui timestamp próprio no trecho encontrado; como `members` já registra `playerColor`, recomendo inicialmente não tratá-lo como documento histórico independente, salvo se a aplicação depender dele na reidratação.

**Importante:** o cálculo acima deve usar apenas campos realmente persistidos e com semântica conhecida. Não usar timestamps efêmeros de `presence`, `players`, `proposal` ou `featureVote` para promover uma sala a dado histórico.

### 5.2 Há uma janela de corrida nas gravações de contribuição

Ao registrar uma jogada, o cliente primeiro chama `publishRoomBoardCell()` — que atualiza tabuleiro e `updatedAt` — e depois faz um `set()`/`remove()` separado em `contributions/{row}_{column}`.

Isso significa que o carimbo de raiz e a gravação de autoria não são uma única operação atômica no L1. O timestamp de contribuição pode ser ligeiramente posterior ao timestamp de raiz.

A complementação do critério diferencial com `contributions[*].timestamp`, somada à captura de `wakeUpTime` antes da leitura, reduz o risco de perder essa atualização entre ciclos. Ainda assim, o sincronizador deve selecionar pelo timestamp mais recente dos campos persistentes, e não apenas pela raiz.

### 5.3 A projeção de dados precisa ser explícita

O código atual copia a sala inteira e remove somente `moves`, `presence` e `cursors`. Isso significa que outros campos do RTDB podem entrar no arquivo JSON atual, mesmo que sejam transitórios, de sessão ou metadados de cliente.

Entre os nós encontrados no schema estão:

- `players` — participantes online;
- `privateData/{playerId}/clientMetadata` — metadados do cliente;
- `metrics` — estrutura legada;
- `proposal` e `featureVote` — estruturas temporárias;
- `colorAssignments` — reserva/atribuição de cor;
- `meta`, `boardState`, `settings`, `members` e `contributions` — dados candidatos a persistência.

As regras atuais também declaram leitura em `/rooms`, enquanto o comentário de `privateData` diz que esses metadados deveriam ser protegidos. A projeção para a Yggdrasil não deve perpetuar essa ambiguidade.

**Recomendação:** usar uma allowlist de campos L2. Como base inicial, persistir apenas `meta`, `boardState`, `settings` e os documentos de `contributions` e `members`, além de campos de controle explicitamente aprovados. Excluir `moves`, `presence`, `cursors`, `players`, `privateData`, `metrics`, `proposal` e `featureVote` por padrão. A `.butIgnore` continua sendo aplicada como defesa complementar, especialmente para `moves`, mas não substitui a allowlist.

### 5.4 A estrutura proposta não garante “histórico completo”

O prompt propõe um documento raiz mutável por sala:

`cold_rooms/{roomId}`

E subcoleções:

- `contributions/{cellKey}`;
- `members/{playerId}`.

Isso representa bem um **estado consolidado atual**. Porém, no jogo, uma nova instância de tabuleiro substitui `meta` e `boardState`, e o nó `contributions` do RTDB é limpo. Se a Yggdrasil usar apenas um documento por sala e a chave de contribuição for somente `cellKey`, os dados de uma instância anterior podem ser sobrescritos por uma posterior.

O `instanceNumber` já existe em `meta` e `boardState`, portanto há uma chave natural para separar gerações.

**Recomendação:** decidir se Yggdrasil guarda apenas o estado atual ou o histórico de instâncias. Se o objetivo é histórico, a modelagem deve ser versionada, por exemplo:

- `cold_rooms/{roomId}` para o índice/estado atual da sala;
- `cold_rooms/{roomId}/instances/{instanceNumber}` para o snapshot durável de cada tabuleiro;
- `cold_rooms/{roomId}/instances/{instanceNumber}/contributions/{cellKey}` para a autoria daquela instância;
- `cold_rooms/{roomId}/members/{playerId}` para a identidade/histórico agregado de participantes.

Isso é uma recomendação de modelagem, não uma exigência para mudar agora. Mas a afirmação “fonte de verdade absoluta com todo o histórico” não deve permanecer no prompt se a implementação continuar sobrescrevendo o único documento de sala.

### 5.5 Upsert não propaga remoções

`updateMask` controla quais campos de um documento são atualizados. Campos fora da máscara permanecem no documento; campos incluídos na máscara, mas ausentes no payload, são removidos. Isso não faz, por si só, a reconciliação das subcoleções.

O cliente remove contribuições quando uma célula é apagada e limpa todas as contribuições ao iniciar uma nova instância. Se o sincronizador só enviar upserts para os documentos encontrados no snapshot, documentos antigos de `contributions` permanecerão no Firestore.

É necessário definir uma política explícita:

1. **Estado atual:** listar os documentos existentes da subcoleção e emitir `delete` para as chaves ausentes no RTDB; ou
2. **Histórico:** preservar a autoria antiga como registro da instância anterior e versionar os caminhos, sem apagá-la; ou
3. **Tombstone:** enviar um documento de remoção lógica, com identidade da célula/instância e timestamp, para que a leitura-through diferencie dado ativo de dado removido.

A opção 2 parece mais coerente com a intenção de Yggdrasil como memória histórica. A opção 1 é mais simples se a L2 for apenas espelho do estado corrente. A opção 3 exige uma origem de tombstone ou uma forma confiável de detectar o desaparecimento.

### 5.6 `convertToFirestoreValue()` não pode converter matrizes 2D ingenuamente

O estado contém matrizes, por exemplo:

- `boardState.boardValues`;
- `boardState.pencilNotes`;
- `meta.fixedInitialGrid`;
- `meta.solutionGrid`.

A API Firestore não permite que um `arrayValue` contenha diretamente outro `arrayValue`. Uma conversão recursiva literal de array JavaScript para array Firestore produziria uma matriz inválida.

A conversão precisa de uma representação compatível para matrizes — por exemplo, array de mapas com a linha armazenada em uma propriedade `cells`, ou mapa com linhas indexadas (`row_0`, `row_1`, ...). A escolha deve ser documentada e ter conversão inversa equivalente no consumidor Read-Through.

Também devem ser definidos os casos de:

- `null` → `nullValue`;
- boolean → `booleanValue`;
- string → `stringValue`;
- inteiro seguro → `integerValue` como string int64;
- número decimal finito → `doubleValue`;
- `NaN`/`Infinity` → erro de validação, não serialização silenciosa;
- objetos → `mapValue`;
- arrays simples → `arrayValue`;
- `undefined` → política explícita de omitir ou rejeitar;
- `Date`/timestamps → conversão intencional, sem inferir automaticamente que todo campo terminado em `At` é `timestampValue`.

Os timestamps atuais do jogo são epoch milliseconds numéricos. Mantê-los como `integerValue` preserva a semântica atual; converter para `timestampValue` exigiria uma decisão de schema e ajuste no leitor.

### 5.7 `updateMask` não é, sozinho, o mecanismo de idempotência

O prompt está certo em pedir `updateMask`, mas a explicação precisa ser refinada:

- `updateMask` limita os campos alterados e protege campos que não fazem parte da sincronização;
- `updateMask` pode excluir do documento campos explicitamente incluídos na máscara que não apareçam no payload;
- a idempotência de reexecução vem principalmente de caminhos determinísticos para os documentos (`roomId`, `instanceNumber`, `cellKey`, `playerId`) e de payloads consistentes;
- ausência de uma chave no snapshot não equivale automaticamente a uma operação `delete` na subcoleção.

A estratégia de máscaras deve ser explícita por documento. Para documentos da sala, definir exatamente se `meta`, `settings` e `boardState` são substituídos como mapas completos ou atualizados por caminhos de campo. Não usar uma máscara ampla sem compreender o efeito sobre campos futuros.

### 5.8 Um único `documents:commit` não significa que o job inteiro sempre cabe em uma chamada

O método `documents:commit` aplica os writes da requisição atomicamente e em ordem. Isso é uma boa base para agrupar a raiz da sala e seus subdocumentos.

Entretanto, os limites do Firestore incluem tamanho máximo de documento de 1 MiB e tamanho máximo de requisição de API de 10 MiB. O snapshot inteiro de `/rooms` pode ser muito maior que isso, e uma sala com muitos membros/contribuições pode também produzir um lote grande.

**Recomendação:** considerar um commit por sala, contendo o documento raiz e os subdocumentos daquela sala. Assim, os dados de uma sala são aplicados atomicamente sem tentar colocar todo o conjunto de salas em um único corpo HTTP. As salas devem ser processadas serialmente.

Se uma sala exceder o limite de requisição, será necessário decidir entre reduzir/projetar os dados ou aceitar commits em partes com checkpoint por sala. Dividir uma sala em múltiplos commits elimina a atomicidade do conjunto completo daquela sala; isso não deve acontecer silenciosamente.

Com commits por sala, o watermark global só avança depois que todas as salas elegíveis da janela tiverem sido confirmadas. Se a sala 17 falhar depois de 16 terem sido gravadas, o job falha sem avançar o watermark; na próxima execução, as 16 primeiras podem ser reenviadas com segurança porque os caminhos são determinísticos e as operações são idempotentes.

### 5.9 O watermark atual possui pontos frágeis

`advanceWatermark()` usa `muteHttpExceptions: true`, mas não verifica o código HTTP retornado. Assim, uma resposta HTTP de falha pode não lançar exceção e o script pode seguir como se o checkpoint tivesse sido gravado.

`readLastBackupTimestamp()` também retorna `0` quando o GET falha ou não retorna HTTP 200. Isso é conservador em relação à perda de dados (pode provocar novo processamento amplo), mas esconde a diferença entre “primeira execução” e “não consegui ler meu checkpoint”.

`persistColdStorageMeta()` registra erros de rede, mas não verifica o código HTTP retornado pelo PATCH.

**Recomendação para a nova versão:** validar todos os códigos HTTP relevantes e diferenciar explicitamente:

- checkpoint inexistente/primeira execução;
- leitura do checkpoint malsucedida;
- commit no Firestore confirmado;
- commit recusado/falhou;
- atualização do watermark confirmada;
- atualização do watermark falhou.

Não avançar o cursor se qualquer commit da janela falhar. A persistência do estado administrativo do job e do cursor de dados deve ter resultado verificável e telemetria própria.

### 5.10 Salas legadas sem `updatedAt`

Hoje elas são arquivadas e depois recebem um `updatedAt = wakeUpTime - 1` no RTDB para não serem arquivadas repetidamente.

Essa gravação precisa desaparecer. Sem ela, salas legadas continuarão elegíveis em todas as janelas, porque não existe um timestamp de origem que as coloque antes do watermark.

Alternativas:

- aceitar re-upsert dessas poucas salas em cada execução, garantindo consistência mas gerando escritas recorrentes;
- manter controle externo de backfill/estado por sala em metadados administrativos protegidos;
- guardar `sourceFingerprint`/`sourceUpdatedAt` na Yggdrasil e comparar com o estado existente;
- fazer uma etapa de backfill inicial separada e depois usar um critério incremental validado.

**Recomendação inicial:** não inventar gravação no RTDB. Para a primeira migração, aceitar o re-upsert de salas legadas é o comportamento mais seguro até definir um ledger/hash de sincronização. Se o conjunto legado for grande, desenhar previamente o ledger de backfill no espaço administrativo (Eden), sem misturá-lo aos dados de gameplay.

---

## 6. Arquitetura recomendada para o novo núcleo

### 6.1 Responsabilidades nomeadas

- **Jianmu:** RTDB / L1 — árvore viva e mutável, onde o jogo opera.
- **Yggdrasil:** Firestore / L2 — memória consolidada e persistente.
- **Eden / Eden-Tov-Vaara:** área administrativa protegida, para metadados de orquestração, checkpoints e configuração administrativa. Usar apenas ao nomear funções/constantes que leem ou escrevem esses nós protegidos; não transformar isso em um terceiro nome genérico para os dados do jogo.

A analogia não deve alterar nomes externos já consumidos pelo Master. Por exemplo, manter `COLDSTORAGE_JOB_ID = 'coldstorage_rooms'` evita quebrar schedule, métricas, configuração e endpoints.

### 6.2 Fluxo proposto

```text
Master Orchestrator
  └─ executeColdStorageRooms(true | false, customOptions)
      ├─ lock / contexto / configuração / .butIgnore
      ├─ Eden: ler checkpoint de dados (last_backup_timestamp)
      ├─ Jianmu: GET /rooms.json
      ├─ Jianmu: calcular timestamp persistente e filtrar janela
      ├─ Jianmu: aplicar .butIgnore em cópia
      ├─ Jianmu: projetar allowlist L2 por sala/instância
      ├─ Yggdrasil: converter valores Firestore
      ├─ Yggdrasil: construir writes + updateMasks + deletes/tombstones decididos
      ├─ Yggdrasil: documents:commit por sala, serialmente
      ├─ validar cada resposta e acumular métricas
      ├─ Eden: avançar watermark somente após todos os commits confirmados
      ├─ manter persistência de metadados do job
      └─ devolver JobMetrics; telemetria continua no contrato atual
```

O script permanece síncrono no GAS V8. Não introduzir `async/await`, `Promise.all` ou concorrência paralela no backend GAS. O Master atual já despacha jobs serialmente e deve continuar assim.

### 6.3 Configuração

Novas Script Properties:

- `PROJECT_ID` — ID do projeto Google Cloud/Firebase correspondente ao Firestore.
- `FIREBASE_URL` e `FIREBASE_SECRET` — continuam necessárias para ler o RTDB e acessar o espaço administrativo que hoje usa essa credencial, enquanto essa autenticação não for migrada.
- `GITHUB_JOBS_CONFIG_URL`, `GITHUB_BUTIGNORE_URL`, `LOG_SHEET_ID` e `LOG_SHEET_FOLDER_ID` — manter conforme o uso atual.

Remover `DRIVE_FOLDER_ID` do Cold Storage e de `REQUIRED_KEYS` no tooling de secrets. Não remover `LOG_SHEET_FOLDER_ID` sem antes retirar deliberadamente a organização da planilha via Drive.

O `PROJECT_ID` deve ser validado como não vazio antes de iniciar leituras/escritas. O database ID do caminho REST pode ser uma constante explícita `'(default)'`, caso seja essa a base criada no projeto.

### 6.4 Autenticação REST do Firestore

A chamada usa `ScriptApp.getOAuthToken()` no header:

```text
Authorization: Bearer <OAuth token>
Content-Type: application/json
```

O caminho REST v1 tem a forma:

```text
POST https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/(default)/documents:commit
```

A identidade efetiva do Apps Script precisa ter permissão IAM de escrita no Firestore do projeto correto. Também é necessário garantir que o token OAuth contenha o escopo `https://www.googleapis.com/auth/datastore` (ou outro escopo permitido pela API) e que os escopos atuais de serviços do GAS continuem autorizados.

Como o manifest atual não declara `oauthScopes`, o Apps Script pode inferir os escopos de serviços conhecidos, mas não se deve presumir que o uso de `UrlFetchApp` sozinho inclua automaticamente o escopo específico de Firestore. Rever `appsscript.json`, acrescentar o escopo necessário e executar uma função manualmente para renovar a autorização antes de depender do trigger.

O token Bearer nunca deve aparecer em logs, mensagens de erro ou telemetria. O sanitizador atual já redige `auth=` e `secret=`, mas deve também proteger tokens Bearer e eventuais headers.

### 6.5 Destinos Firestore

O prompt atual sugere:

```text
projects/{PROJECT_ID}/databases/(default)/documents/cold_rooms/{roomId}
projects/{PROJECT_ID}/databases/(default)/documents/cold_rooms/{roomId}/contributions/{cellKey}
projects/{PROJECT_ID}/databases/(default)/documents/cold_rooms/{roomId}/members/{playerId}
```

A estrutura é válida como ponto de partida para estado atual. Para preservar histórico por instância, prefiro avaliar a extensão:

```text
cold_rooms/{roomId}
  instances/{instanceNumber}
    contributions/{cellKey}
  members/{playerId}
```

A decisão de versão do caminho precisa ser tomada antes de gravar dados reais, porque ela define como o futuro Read-Through encontra o estado vigente e como o histórico é preservado.

IDs de documentos devem ser validados como segmentos Firestore. Não aceitar `/` ou IDs reservados/inválidos; se IDs de sala/jogador puderem conter caracteres incompatíveis, definir codificação determinística reversível e guardar o ID original como campo do documento.

### 6.6 Conversão de dados

A função `convertToFirestoreValue()` deve ser pura e testável, sem executar chamadas HTTP. Ela deve validar valores antes de construir `mapValue`, `arrayValue`, `integerValue` etc.

Além da conversão comum de tipos, precisa tratar matrizes 2D explicitamente. Não aceitar a conversão `array → arrayValue` recursiva sem uma regra para arrays aninhados.

Também deve haver limites/validações para profundidade, tamanho do documento e tamanho do corpo do commit. Erro de conversão deve interromper a sala e impedir avanço do watermark; não descartar silenciosamente campos.

### 6.7 Construção do commit e updateMask

Separar conceitualmente:

1. `ygg_buildRoomDocument(room)` — monta o documento raiz com os campos permitidos.
2. `ygg_buildContributionDocuments(room, instanceNumber)` — monta um documento estável por célula/instância.
3. `ygg_buildMemberDocuments(room)` — monta um documento por participante.
4. `ygg_buildWrite(documentName, fields, fieldPaths)` — constrói `update` + `updateMask`.
5. `ygg_commitRoom(writes)` — executa um único `documents:commit` para a sala.
6. `ygg_validateCommitResponse(response)` — verifica HTTP, JSON e resultado do commit.

Usar nomes de documentos determinísticos. A máscara deve listar os campos realmente projetados; documentar se mapas inteiros são substituídos ou se apenas caminhos internos são atualizados. Não incluir campo na máscara se não deseja removê-lo quando ausente do payload.

Para reconciliar exclusões, escolher uma das políticas da seção 5.5. Se for estado atual, listar os documentos de contribuições existentes e montar deletes no mesmo commit; se for histórico, usar caminhos versionados por instância e não apagar contribuições históricas.

---

## 7. Proposta de nomenclatura Yggdrasil / Jianmu / Eden

Manter nomes externos e IDs de job; aplicar as analogias em símbolos internos que se referem ao domínio correspondente.

| Domínio | Constantes sugeridas | Funções/métodos sugeridos |
|---|---|---|
| Jianmu / RTDB L1 | `JIANMU_ROOMS_PATH`, `JIANMU_UPDATED_AT_FIELD` | `jianmu_readRoomsSnapshot()`, `jianmu_getPersistentRoomTimestamp()`, `jianmu_filterEligibleRooms()`, `jianmu_projectRoomData()`, `jianmu_applyButIgnoreFilter()` |
| Yggdrasil / Firestore L2 | `YGGDRASIL_PROJECT_ID`, `YGGDRASIL_DATABASE_ID`, `YGGDRASIL_COLLECTION_ROOMS` | `ygg_buildDocumentName()`, `ygg_convertToFirestoreValue()`, `ygg_buildRoomWrites()`, `ygg_buildContributionWrites()`, `ygg_buildMemberWrites()`, `ygg_commitRoom()`, `ygg_validateCommitResponse()` |
| Eden / admin | `EDEN_COLDSTORAGE_META_PATH`, `EDEN_SERVER_CONFIG_PATH` | `eden_readColdStorageCheckpoint()`, `eden_advanceColdStorageCheckpoint()`, `eden_persistJobExecutionMeta()` |

Sugestões adicionais:

- `runYggdrasilSyncCore()` para o novo núcleo de sincronização, mantendo um wrapper `runColdStorageCore()` se for necessário preservar consumidores internos/testes já existentes.
- `YGGDRASIL_SYNC_SCHEMA_VERSION` para a versão da projeção L2, independente do `COLDSTORAGE_JOB_ID`.
- `YGGDRASIL_COMMIT_MAX_BYTES` como limite operacional conservador menor que o máximo oficial da API, se houver política de margem.
- `JIANMU_LEGACY_ROOM_POLICY` ou uma função de política clara para salas sem timestamp confiável.

Não usar Yggdrasil em funções genéricas de Sheets, Master ou autenticação de cron. Não usar Eden para dados de sala normais. A analogia deve sinalizar a camada, não virar decoração indiscriminada.

---

## 8. Estratégia de implementação em fases

A sequência abaixo evita refatorar tudo de uma vez e facilita isolar regressões.

### Fase 0 — Fechar as decisões de schema

Antes do código, decidir:

- L2 é espelho do estado atual ou repositório histórico por instância?
- `contributions` removida no L1 deve virar delete, tombstone ou continuar histórica?
- O documento raiz terá `meta`, `settings`, `boardState` completos ou campos individuais?
- Como serão representadas matrizes 2D no Firestore e reconstruídas pelo Read-Through?
- Quais campos entram na allowlist? Minha base recomendada é `meta`, `boardState`, `settings`, `members` e `contributions`; `moves`, `presence`, `cursors`, `players`, `privateData`, `metrics`, `proposal` e `featureVote` ficam de fora.
- Sala legada sem `updatedAt`: re-upsert recorrente ou ledger/hash administrativo?
- Atomicidade desejada: por sala ou pelo job inteiro? Recomendo por sala.

Não escrever o sincronizador sem responder a essas perguntas no prompt, porque algumas delas mudam o schema persistente e são difíceis de corrigir depois de acumular dados.

### Fase 1 — Preparar configuração e autenticação

- Substituir `DRIVE_FOLDER_ID` por `PROJECT_ID` nos arquivos de ambiente e tooling.
- Atualizar comentários de dependências no Cold Storage e no Master.
- Rever `appsscript.json` e autorizações para `datastore`.
- Confirmar que a identidade efetiva do Web App/trigger tem IAM para escrita no Firestore.
- Não alterar `LOG_SHEET_ID`, `LOG_SHEET_FOLDER_ID` nem a lógica da planilha nesta fase.

### Fase 2 — Implementar helpers puros Yggdrasil

Começar por funções sem I/O:

- validar `PROJECT_ID`, database ID, roomId/playerId/cellKey;
- converter tipos Firestore;
- converter matriz Sudoku para representação válida;
- montar nome de documento;
- construir projeção por allowlist;
- construir `updateMask`;
- validar tamanho e profundidade.

Criar testes unitários antes de conectar o `UrlFetchApp`.

### Fase 3 — Implementar o transporte REST

- Construir URL v1 `documents:commit`.
- Usar `ScriptApp.getOAuthToken()` no header `Authorization`.
- POST JSON com `muteHttpExceptions: true`.
- Validar códigos HTTP e corpo de erro.
- Validar a resposta de commit e contabilizar os writes.
- Não logar OAuth token, payload sensível ou metadados privados.
- Manter chamadas serializadas no GAS.

### Fase 4 — Trocar o núcleo de persistência

- Preservar leitura do Jianmu, filtro e telemetria.
- Substituir o envelope JSON/Drive por projeção Firestore.
- Construir writes raiz + subcoleções para cada sala.
- Fazer commit por sala, atomicamente.
- Implementar a política escolhida para exclusão/versionamento de contribuições.
- Remover a gravação retroativa de `updatedAt` no RTDB.
- Avançar watermark somente após todas as salas elegíveis confirmadas.

### Fase 5 — Reforçar checkpoint e métricas

- Diferenciar “sem checkpoint” de “falha ao ler checkpoint”.
- Verificar HTTP no GET/PATCH do RTDB.
- Falhar o job se um commit não for confirmado.
- Falhar o avanço do cursor se o PATCH administrativo não for confirmado.
- Preservar o contrato `JobMetrics`; mapear bytes enviados ao campo legado sem alterar os cabeçalhos neste primeiro deploy.
- Descrever `target` como coleção/caminho L2 em vez de nome de arquivo.

### Fase 6 — Testes e validação operacional

Executar primeiro os testes unitários do GAS e depois integração controlada com projeto Firestore de teste/emulador quando possível. Não iniciar com produção nem com o watermark atual da produção.

### Fase 7 — Backfill e ativação

- Fazer backup/registro do valor atual de `last_backup_timestamp` antes de alterar o checkpoint.
- Executar backfill inicial controlado para as salas que já existem.
- Conferir contagem de salas, documentos raiz, subdocumentos e tamanhos.
- Conferir integridade de tabuleiro e contribuições por `instanceNumber`.
- Só depois habilitar o job agendado no Master.
- Manter um plano de rollback para voltar ao commit anterior do script e preservar o cursor antigo; não apagar o legado do Drive durante a primeira validação.

---

## 9. Plano de testes mínimo

### 9.1 Testes puros de conversão

- `null`, string, boolean, integer, double, objeto e array simples.
- epoch milliseconds como integer.
- matriz 4×4, 9×9 e 25×25 sem array aninhado diretamente.
- números não finitos rejeitados.
- strings Unicode/acentos/emojis preservadas.
- campos/IDs inválidos rejeitados sem truncamento silencioso.
- limites de profundidade e tamanho.

### 9.2 Testes de projeção e filtro Jianmu

- `updatedAt` na janela, abaixo do watermark e futuro.
- `meta.createdAtTimestamp` mais recente que o `updatedAt` da raiz.
- `boardState.updatedAtTimestamp` mais recente que a raiz.
- novo `member.joinedAtTimestamp` sem alteração da raiz.
- `settings.immediateErrorUpdatedAt` sem alteração da raiz.
- contribuição inserida/alterada e contribuição removida.
- sala legada sem timestamp, `null`, zero e timestamp inválido.
- regras `.butIgnore` continuam excluindo `moves`, `presence` e `cursors`.
- allowlist impede envio de `players`, `privateData`, `metrics`, `proposal` e `featureVote`.

### 9.3 Testes de writes e updateMask

- nomes determinísticos para sala, instância, célula e jogador.
- máscara atualiza somente os campos pretendidos.
- campos fora da máscara permanecem intactos.
- campos incluídos na máscara e ausentes no payload são removidos apenas quando isso é intencional.
- nova contribuição cria documento; repetição atualiza o mesmo documento.
- nova instância não sobrescreve a contribuição da instância anterior quando o modo histórico estiver ativo.
- delete/tombstone conforme a política escolhida.

### 9.4 Testes de integração do job

- uma sala com raiz + contribuições + membros confirmada em um único commit atômico.
- várias salas processadas serialmente.
- erro HTTP no commit impede avanço do watermark.
- falha na segunda sala não avança watermark, mesmo que a primeira tenha sido confirmada.
- reexecução após falha reenvia a primeira sala sem criar documentos duplicados.
- falha do PATCH do watermark resulta em `FAILED`.
- snapshot vazio ou janela sem salas: cursor só avança após leitura válida e conclusão bem-sucedida da varredura.
- execução standalone registra telemetria própria.
- execução orquestrada devolve métricas ao Master sem gravar linha duplicada.
- `executeFirebaseBackup()` continua funcional como wrapper legado.

### 9.5 Regressão do Master

- Master continua disparando `coldstorage_rooms` com as quatro políticas atuais.
- lock continua sendo adquirido uma única vez no ciclo do Master.
- jobs continuam sequenciais.
- a telemetria continua gravando Master primeiro e jobs depois.
- erros do job são refletidos em métricas `FAILED`, permitindo retry conforme `repeat_policy`.

**Observação sobre a cobertura atual:** os testes visíveis cobrem principalmente parser `.butIgnore`, filtro de elegibilidade, fallback de configuração e lógica do Master. Não encontrei, no snapshot, uma suíte de integração que execute o fluxo completo do `runColdStorageCore()` contra mocks do Drive e do watermark. A migração deve acrescentar essa camada, e não apenas adaptar os testes de filtro existentes.

---

## 10. Ajustes recomendados no prompt de migração

O prompt original deve receber instruções adicionais. Sugestão de adições, sem ainda transformá-lo em um prompt final fechado:

1. **Respeitar os contratos atuais:** não alterar `executeColdStorageRooms`, `executeFirebaseBackup`, `COLDSTORAGE_JOB_ID`, formato `JobMetrics`, modos standalone/orquestrado, lock, Master ou telemetria, exceto no estritamente necessário e documentado.
2. **Não alterar o jogo nesta etapa:** compensar a falta de carimbo global com os timestamps persistentes já existentes (`meta`, `boardState`, `settings`, `members`, `contributions`), e documentar qualquer caso impossível sem alteração no L1.
3. **Não gravar no RTDB:** remover `stampLegacyWatermarks()` do caminho de execução. Definir política para legado sem timestamp sem escrever no L1.
4. **Allowlist de persistência:** não serializar a sala inteira. Definir claramente os nós permitidos e excluídos.
5. **Histórico por instância:** não usar somente `{roomId}/contributions/{cellKey}` se a intenção for preservar várias partidas; incluir `instanceNumber` no caminho ou aprovar explicitamente a política de estado atual.
6. **Exclusões:** tratar contribuição removida e reset de nova instância, porque upsert não remove documento antigo automaticamente.
7. **Matrizes 2D:** implementar formato Firestore válido e compatível com o futuro decoder Read-Through.
8. **Tamanho/atomicidade:** respeitar 1 MiB por documento e 10 MiB por requisição; recomendar commit por sala, serial; se quebrar um lote, explicitar perda de atomicidade e estratégia de checkpoint.
9. **UpdateMask:** definir fieldPaths exatos e explicar os efeitos de campo ausente; não declarar que `updateMask` sozinho garante idempotência.
10. **HTTP/checkpoint:** validar status e corpo das respostas Firestore e RTDB; não avançar watermark com commit parcial/falha.
11. **OAuth/IAM:** considerar escopo `datastore`, autorização GAS e identidade efetiva do trigger/Web App.
12. **Tooling:** remover `DRIVE_FOLDER_ID` também de `backend/update-secrets.js` e `.environment.example`; acrescentar `PROJECT_ID`; preservar o Drive usado exclusivamente pela telemetria enquanto ela depender dele.
13. **Testes:** acrescentar testes puros para conversão/mapeamento e testes de integração do commit/checkpoint; preservar os testes atuais do Master e `.butIgnore`.
14. **Nomenclatura:** usar `Yggdrasil`/`ygg_` exclusivamente no domínio Firestore L2; `Jianmu`/`jianmu_` no RTDB L1; `Eden` em metadados/configuração administrativa protegidos.

---

## 11. Decisões que eu fecharia antes de pedir a implementação

| Decisão | Minha recomendação | Por quê |
|---|---|---|
| Estado atual ou histórico por instância? | Histórico por instância, se “Yggdrasil” é realmente a memória total. | Evita que um novo tabuleiro sobrescreva os anteriores. |
| Caminho de contribuições | Incluir `instanceNumber` no caminho. | `cellKey` se repete entre partidas e o RTDB limpa `contributions` na nova instância. |
| Remoção de contribuição | Preservar por instância como histórico; para estado atual, usar reconciliação/delete explícitos. | Upsert sozinho não espelha remoções. |
| Filtro | `updatedAt` + maior timestamp persistente dos subnós. | A raiz não é atualizada em todas as gravações de `members`, `settings` e `meta`. |
| Sala legada | Re-upsert idempotente inicialmente; ledger/hash posterior se o custo justificar. | Respeita a regra de não escrever no L1 e evita inventar estado no RTDB. |
| Atomicidade | Um `documents:commit` por sala. | Mantém raiz e subdocumentos de cada sala no mesmo commit sem empacotar todo o snapshot num único pedido. |
| Campos da sala | Allowlist estrita. | Evita copiar presença, votos, metadados de cliente e outros nós efêmeros/privados. |
| Matriz Sudoku | Matriz convertida para array de mapas ou mapa de linhas. | Firestore não permite array diretamente dentro de array. |
| Telemetria | Preservar cabeçalho agora; revisar `Bytes_Drive` depois. | Evita quebrar validação da planilha na mesma implantação. |

---

## 12. Alertas operacionais e de segurança

1. **Secrets no arquivo anexado:** o snapshot concatenado inclui um `.environment` com valores preenchidos para `FIREBASE_SECRET` e `CRON_TOKEN`. Não os reproduzi neste documento. Caso esses valores sejam reais/ativos, trate-os como expostos e faça rotação/revogação; depois atualize as Script Properties pelo processo seguro existente. Não inclua o `.environment` em futuras concatenações de código.
2. **Metadados de cliente:** `privateData` tem finalidade declarada de guardar metadados do cliente. Não persistir esse nó na Yggdrasil por acidente. A allowlist deve excluí-lo até haver uma decisão explícita de retenção, acesso e finalidade.
3. **Credencial RTDB vs OAuth Firestore:** a nova autenticação do Firestore não substitui automaticamente a credencial atualmente usada para ler o RTDB e escrever em `/server_meta`. São canais de acesso distintos nesta migração.
4. **Não apagar o legado no primeiro deploy:** a remoção do destino Drive e dos arquivos históricos antigos deve ser uma operação separada, posterior à validação de consistência da Yggdrasil.

---

## 13. Referências consultadas

### Código do snapshot

- `backend/GAS/backup-coldstorage.js`: entrada e núcleo atual, linhas aproximadas 880–1335; watermark e metadados, linhas 1500–1630.
- `backend/GAS/master_orchestrator.js`: handlers e REST, linhas aproximadas 2180–2320; dispatch e persistência de métricas, linhas aproximadas 2330–2460.
- `backend/update-secrets.js`: `REQUIRED_KEYS` e injeção de Script Properties, linhas aproximadas 3150–3520.
- `.environment` e `.environment.example`: linhas aproximadas 20–105.
- `backend/GAS/appsscript.json`: linhas aproximadas 867–878.
- `backend/config/database.rules.json`: `/rooms` e `privateData`, linhas aproximadas 174–480.
- `js/network/multiplayer-service.js`: gravações de estado do tabuleiro, contribuições, membros, settings e nova instância, linhas aproximadas 7688–9130.
- `tests/unit/gas-butignore.test.js`, `gas-fallback.test.js`, `gas-master.test.js` e `tests/helpers/gas-loader.js`.

### Documentação oficial Google/Firebase

- Firestore REST `documents:commit`: https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/commit
- Firestore REST `Write` e `updateMask`: https://docs.cloud.google.com/firestore/docs/reference/rest/v1/Write
- Tipos de valores Firestore e restrição de array aninhado: https://firebase.google.com/docs/firestore/reference/rest/v1/Value
- Quotas/limites Firestore (documento e requisição): https://firebase.google.com/docs/firestore/quotas
- Escopos OAuth no Apps Script: https://developers.google.com/apps-script/concepts/scopes
- `ScriptApp.getOAuthToken()`: https://developers.google.com/apps-script/reference/script/script-app
- Quotas do Apps Script: https://developers.google.com/apps-script/guides/services/quotas

---

## 14. Parecer final

O desenho geral Jianmu (L1) → Yggdrasil (L2) faz sentido para separar estado de jogo vivo de memória durável. A estrutura operacional existente — Master, lock, schedule declarativo, fallback de configuração, telemetria e métricas — é um ativo e deve ser conservada.

O prompt está correto ao remover o Drive como destino de backup, introduzir `PROJECT_ID`, usar OAuth para Firestore e exigir `documents:commit`. Mas, antes de gerar o código, precisa corrigir quatro lacunas estruturais:

1. o `updatedAt` da raiz não cobre todas as alterações persistentes;
2. a modelagem sugerida não preserva necessariamente o histórico de instâncias;
3. upserts não resolvem documentos removidos/resetados;
4. arrays de arrays do Sudoku não podem ser serializados diretamente como arrays Firestore aninhados.

Minha recomendação é usar este documento como **base de revisão do prompt**. Depois dessas decisões, o trabalho de implementação pode ficar focado no novo núcleo `ygg_*`, com as menores alterações adjacentes necessárias para configuração e testes. Não há motivo, pelo que foi observado, para reescrever o gameplay nesta etapa.
