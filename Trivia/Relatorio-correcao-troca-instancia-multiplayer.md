# Correção — falha ao gravar novo tabuleiro após votação

**Projeto:** Sudoku Aneróthico PRÓ  
**Data:** 18/11/2026  
**Base:** ZIP recebido em 18/11/2026  
**Escopo:** `js/network/multiplayer-voting.js` e teste unitário específico.

## 1. Diagnóstico

O toast "A votação foi aprovada, mas não foi possível gravar o novo tabuleiro" era emitido para qualquer rejeição na cadeia assíncrona iniciada por `runTransaction()`. O erro não distinguia uma falha real ao publicar a nova instância de uma falha posterior ao atualizar o status da votação.

A alteração da migração que introduziu esse fluxo está em `da5d78a` (`WiP: testing migration implementation`). Antes dela, o cliente gravava `meta`, `boardState`, `moves` e `contributions` separadamente. Depois, passou a executar uma transação em `rooms/{roomId}` para arquivar a instância anterior e publicar a nova.

Há um defeito concreto no tratamento da transação: `setupRoomListeners()` registra listeners nos subnós da sala (`meta`, `boardState`, `players`, `proposal`, etc.), mas não mantém um listener na raiz `rooms/{roomId}`. O Firebase documenta que o callback de `runTransaction()` pode receber `null` na primeira chamada mesmo quando o dado existe remotamente, se ele ainda não estiver no cache local. Como o callback anterior retornava `undefined` para `null`, a transação era abortada imediatamente. No RTDB, retornar `undefined` significa explicitamente cancelar a transação.

Referências oficiais (SDK v10.14.1, a mesma versão importada por `firebase-client.js`):

- https://firebase.google.com/docs/database/web/read-and-write
- https://firebase.google.com/docs/reference/js/database
- https://github.com/firebase/firebase-js-sdk/blob/firebase%4010.14.1/packages/database/src/core/Repo.ts (implementação de `repoGetValue()` e sincronização da raiz no `serverSyncTree`)

## 2. Correção aplicada

Em `js/network/multiplayer-voting.js`:

1. Antes da transação, o cliente instala um listener temporário `fb.onValue(roomRef, ...)` na raiz completa da sala. Isso sincroniza a raiz no cache local — os listeners permanentes do jogo observam apenas subnós.
2. O listener permanece ativo durante toda a transação, para que o SDK disponha do snapshot completo e atualize o cache caso cheguem alterações concorrentes.
3. O listener é removido quando a transação termina. Se houver conflito, o callback é reexecutado pelo SDK com o estado atual do servidor; o código valida novamente a instância e aborta se ela mudou ou desapareceu. Não há fallback para um snapshot antigo que possa recriar uma sala removida.
4. A comparação da instância esperada usa `proposal.baseInstanceNumber`, confrontada também com o estado local. A transação continua abortando se `meta.instanceNumber` ou `boardState.boardInstanceNumber` divergirem.
5. A verificação que impede sobrescrever uma entrada já existente em `history/{instanceNumber}` foi preservada.
6. A gravação da nova instância continua sendo uma única transação atômica que arquiva `meta`, `boardState`, `settings` e `contributions`, incrementa a instância, limpa `moves` e reinicia `contributions`. `contributionEvents` não é removido nem alterado.
7. A execução local passa a guardar `executedProposalId`, impedindo que a mesma proposta seja executada novamente caso a atualização posterior do status falhe.
8. A finalização de `proposal.status = completed` agora tem tratamento separado. Se ela falhar depois do commit da sala, a interface informa que o novo tabuleiro já foi gravado e que somente o encerramento da votação falhou. O toast original fica reservado à falha de leitura/transação/publicação.

## 3. Testes adicionados

Novo arquivo: `tests/unit/multiplayer-newgame.test.js`.

Cenários cobertos:

- listener temporário recebe a raiz completa e permanece ativo até o commit; após a gravação, é removido;
- leitura inicial não encontra a sala: a transação não é iniciada;
- a instância já existe em `history`: a troca aborta sem sobrescrever o snapshot;
- mudança da instância no servidor entre o snapshot do listener e a tentativa transacional: o updater usa o estado recebido no retry e aborta sem arquivar a instância errada;
- falha ao finalizar a votação depois do commit: o novo tabuleiro permanece gravado e a mensagem não afirma incorretamente que a gravação falhou.

Validações executadas nesta correção:

- `node --check js/network/multiplayer-voting.js`: PASS;
- `node --check tests/unit/multiplayer-newgame.test.js`: PASS;
- execução dos cinco cenários definidos no novo arquivo de teste por harness Node com mocks: 5/5 PASS. Esse harness executa as funções de teste e asserções cobertas, mas não é o runner Jest oficial.

A suíte Jest completa não foi executada: as dependências Jest não estão instaladas no ZIP/ambiente e a tentativa de obtê-las excedeu o tempo disponível.

## 4. Relação com Yggdrasil

A gravação imediata do novo tabuleiro ocorre em Jianmu, no RTDB, em `rooms/{roomId}`. O cliente não faz uma gravação direta na Yggdrasil durante a votação. O Cold Storage sincroniza posteriormente a instância corrente e snapshots de `history` para o Firestore. Portanto, o fato de Yggdrasil atualizar o documento da sala em vez de criar outro documento raiz por partida não explica este toast.

A numeração de instâncias continua sendo incrementada no RTDB (`meta.instanceNumber` e `boardState.boardInstanceNumber`). A projeção para Yggdrasil organiza as instâncias abaixo de `cold_rooms/{roomId}/instances/{instanceNumber}`.

## 5. Risco residual a monitorar

A transação continua ocorrendo na raiz da sala. Isso preserva a atomicidade escolhida na migração, mas também faz a transação abranger os demais subnós da sala. Escritas concorrentes nesses subnós podem provocar novas tentativas da transação. Além disso, o objeto inclui `contributionEvents`, que permanece no RTDB por decisão do projeto e não é compactado pelo Cold Storage; portanto, essa árvore pode crescer e tornar a transação cada vez mais cara. O limite documentado de uma única escrita pelo SDK RTDB é 16 MB.

Esse risco não foi reestruturado nesta correção para evitar uma mudança maior no protocolo multiplayer. Se a falha persistir, o próximo dado decisivo é a exceção completa do console, especialmente erros de retry, tamanho da escrita, permissão ou abort por divergência de instância. Uma solução estrutural futura seria separar o estado transacional da sala dos logs/eventos volumosos, sem apagar `contributionEvents`.

Nenhum deploy, alteração remota no Firebase/Firestore, mudança de regras ou operação em salas reais foi executado.
