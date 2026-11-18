# Relatório técnico — remoção de `contributionEvents` e fair play somente na sessão multiplayer

**Projeto:** Sudoku Aneróthico PRÓ
**Data:** 18/11/2026
**Base analisada:** `atual.zip`, fornecido nesta conversa
**Escopo:** cliente multiplayer, estado de contribuições, saída para continuidade offline e regras de exclusão do Cold Storage.

## 1. Resumo executivo

A alteração remove a geração de `contributionEvents` pelo cliente atual e mantém `contributions` como fonte consolidada de autoria por célula. Os registros legados de `contributionEvents` são removidos de forma oportunista quando uma sala é aberta por um cliente atualizado ou reutilizada após expirar.

A proteção de fair play continua ativa em qualquer sala multiplayer (`coop`, `versus` e demais modos de sala que usem o mesmo fluxo), mas deixa de restringir o tabuleiro local quando o jogador sai explicitamente da sala. A saída não apaga `contributions`; apenas encerra a sessão local, libera os bloqueios locais e impede que um callback de listener já enfileirado sobrescreva o tabuleiro offline.

O nó `moves`, o histórico de instâncias, a projeção Yggdrasil e o formato persistido de `contributions` foram preservados.

## 2. Decisões confirmadas a partir do código atual

### 2.1 `contributions` é o estado consolidado necessário

O código usa `contributions/{row_column}` para representar a autoria corrente de cada célula. Esse mapa é utilizado na apresentação/contabilização de contribuições e na recuperação da autoria de respostas corretas.

O cliente continua atualizando a célula, `boardState/cellLocks`, `boardState/cellLastUpdatedByPlayerIdByCell` e `contributions/{cellKey}` no mesmo multipath update. Ao apagar ou retirar a autoria, a entrada consolidada continua sendo removida por `null`.

Não foi alterado o formato dos objetos de contribuição nem a regra de pontuação.

### 2.2 `contributionEvents` não tinha consumidor operacional no cliente

A busca por referências no código da aplicação não encontrou leitura, replay, reconstrução ou recuperação baseada em `contributionEvents`. O uso de runtime encontrado era sua criação em `multiplayer-service.js`. Referências restantes são regras, filtros, testes e documentação.

A nova versão deixa de gerar eventos `SET`/`DELETE`/`NASA` nesse nó. A autoria corrente permanece em `contributions`.

### 2.3 `moves` é independente e foi preservado

A inspeção de `multiplayer-voting.js` confirmou que a troca de instância arquiva `meta`, `boardState`, `settings` e `contributions` em `history/{instanceNumber}` e limpa o nó de sala `moves` ao iniciar a nova instância. Os snapshots anteriores não recebem um subnó `moves`.

`moves` continua fora da projeção Yggdrasil e excluído pelo `.butIgnore`. Nenhuma alteração foi feita no log de movimentos, em sua gravação, limpeza ou consumo. O replay da instância corrente continua dependendo do log ainda disponível antes da troca de tabuleiro.

## 3. Alterações implementadas

### 3.1 `js/network/multiplayer-service.js`

- Removida a criação do ID e do payload append-only de `contributionEvents` dentro de `publishRoomBoardCell()`.
- Preservado o multipath update da célula, dos metadados de autoria/fair play e do mapa `contributions`.
- Simplificado o contrato interno de `contributionChange` para transportar somente a contribuição consolidada.
- Adicionada `clearDeprecatedContributionEvents(roomId)`, que remove a subárvore legada se existir e registra aviso se a limpeza falhar.
- A limpeza é disparada sem bloquear o fluxo de entrada ou criação/reutilização da sala.

A limpeza acontece quando um cliente atualizado entra numa sala ou quando o anfitrião reutiliza uma sala expirada. Salas antigas que permaneçam dormentes não são varridas globalmente por esta alteração; seus registros legados serão removidos quando forem abertas/reutilizadas novamente.

### 3.2 `js/services/input-controller.js` e `js/ui/app-events.js`

- A verificação de fair play exige sessão multiplayer ativa e `roomId` presente. Sem sessão de sala, o bloqueio local não é aplicado.
- Ao desconectar, o cliente primeiro marca a sessão como inativa, zera `roomId` e limpa somente `cellLocks` locais.
- `contributions` é preservado no estado local para a continuação offline na mesma sessão do navegador.
- O listener da sala é removido e a presença do jogador é retirada como antes.

### 3.3 `applyRoomBoardState()` — proteção contra callback atrasado

Um callback de `boardState` que já estivesse enfileirado no momento da saída poderia executar depois do `unsubscribe`. Foi acrescentada uma guarda no início de `applyRoomBoardState()` para ignorar snapshots quando não existir sessão multiplayer ativa com `roomId`.

Isso evita que um snapshot antigo da Jianmu substitua o tabuleiro que o jogador decidiu continuar offline.

### 3.4 `.butIgnore` e projeção Yggdrasil

Foi acrescentada a regra `rooms/*/contributionEvents` à seção `[coldstorage_rooms]`, como defesa adicional contra dados legados.

A allowlist da projeção Yggdrasil já excluía `contributionEvents`; portanto, não foi necessário alterar `backend/GAS/backup-coldstorage.js`, o hash da projeção ou `YGGDRASIL_PROJECTION_VERSION`. A versão permanece `2`, pois o formato persistido no Firestore não mudou.

O validador RTDB legado de `contributionEvents` foi mantido em `backend/config/database.rules.json`, sem alteração. Isso preserva compatibilidade de validação para clientes antigos ainda abertos; o cliente atualizado deixa de escrever nesse nó. As regras atuais ainda permitem escrita na raiz da sala, então um cliente antigo ou modificado ainda poderia recriar o caminho.

**Configuração operacional:** o GAS consulta primeiro `/server_config/but_ignore.json` no RTDB e usa CacheService com TTL de até 4 horas; GitHub Raw é fallback. Logo, adicionar a linha ao arquivo local `.butIgnore` não atualiza sozinho o espelho operacional. Para ativar também essa regra adicional no runtime GAS, o espelho RTDB deve ser atualizado e o cache deve expirar/ser limpo. Isso não afeta a exclusão de `contributionEvents` da Yggdrasil, porque a allowlist da projeção já o omite.

## 4. Comportamento esperado

| Cenário | Resultado esperado |
|---|---|
| Jogador permanece em sala coop | Fair play ativo |
| Jogador permanece em sala versus | Fair play ativo |
| Jogador sai explicitamente da sala | Bloqueios locais liberados |
| Jogador continua o mesmo tabuleiro offline | `contributions` local permanece; edição não fica travada |
| Outro jogador continua na sala | Os bloqueios compartilhados da sala permanecem para os participantes conectados |
| Jogador retorna à mesma sala | A Jianmu volta a ser a fonte; listeners sincronizam tabuleiro e contribuições da sala |
| Nova jogada em cliente atualizado | Não cria `contributionEvents` |
| Entrada/reutilização de sala com eventos legados | Limpeza assíncrona tenta remover a subárvore antiga |
| Cold Storage/Yggdrasil | `contributions` continua; `contributionEvents` e `moves` continuam fora da projeção |

A preservação local de `contributions` após a saída vale para a continuação na sessão corrente do navegador. Esta alteração não introduz novo mecanismo de persistência local dessa autoria após fechar/recarregar o navegador; a cópia autoritativa da sala continua na Jianmu.

## 5. Arquivos incluídos no patch

**Modificados:**

- `.butIgnore`
- `js/network/multiplayer-service.js`
- `js/services/input-controller.js`
- `js/ui/app-events.js`
- `tests/helpers/engine-loader.js`
- `tests/unit/gas-butignore.test.js`
- `tests/unit/multiplayer-cell-protection.test.js`
- `Trivia/implementacao-migracao-coldstorage-yggdrasil.md`

**Adicionado:**

- `tests/unit/multiplayer-contribution-events.test.js`

Não foram alterados `moves`, a transação de troca de instância, a estrutura de `history`, os documentos Firestore, os scripts GAS, os cálculos de pontuação ou o formato de `contributions`.

## 6. Validação executada

- `node --check` em todos os arquivos JavaScript `.js` e `.gs` sob `js/`, `tests/` e `backend/GAS/`: **PASS**.
- `git diff --check` (tratando CRLF dos arquivos originais): **PASS**.
- Teste mockado de publicação consolidada: **PASS** — `boardState`, locks e `contributions` são escritos sem caminho `contributionEvents`.
- Teste mockado de limpeza legada: **PASS** — remove `rooms/{roomId}/contributionEvents`.
- Teste mockado de saída offline: **PASS** — limpa sessão/locks locais e preserva `contributions`.
- Testes mockados de fair play: **PASS** — bloqueio em coop/versus, liberação offline e rejeição de callback atrasado.
- Teste mockado do filtro `.butIgnore`: **PASS** — remove `contributionEvents` e preserva `contributions`.

**Total:** 8 verificações mockadas direcionadas aprovadas, além das verificações de sintaxe e whitespace.

A suíte Jest oficial **não foi executada**: `tests/node_modules` não estava presente no ZIP e a tentativa de instalar dependências não terminou dentro do ambiente disponível. Os mocks não substituem a suíte Jest nem uma validação integrada com Firebase real.

## 7. Limites e operações não realizadas

- Nenhum deploy foi executado.
- Nenhuma gravação, remoção ou leitura foi feita no Firebase remoto.
- Nenhuma regra foi publicada no RTDB.
- O espelho operacional `/server_config/but_ignore.json` não foi alterado.
- A limpeza de eventos legados é oportunista por sala; não existe uma varredura global das salas dormentes.
- A proteção continua sendo lógica de cliente. Com `.write: true` na raiz da sala, não é uma barreira autoritativa contra clientes deliberadamente adulterados.

## 8. Aplicação

Na raiz do repositório, primeiro validar a base:

```powershell
git status
git apply --check .\remocao-contributionEvents-fairplay-offline.patch
```

Se a verificação passar:

```powershell
git apply .\remocao-contributionEvents-fairplay-offline.patch
```

Depois, instalar dependências de teste se necessário e executar:

```powershell
cd tests
npm install
npm run test:unit
```

O patch foi gerado contra o conteúdo de `atual.zip`. Caso sua branch tenha alterações diferentes nos mesmos trechos, `git apply --check` poderá rejeitar a aplicação; nesse caso, não force, pois será necessário adaptar o patch à sua versão atual.
