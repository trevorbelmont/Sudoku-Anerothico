# Proteção de autoria das células corretas no multiplayer

## Regra implementada

Em qualquer sala multiplayer, tanto **Prosa e Cafézin (coop)** quanto **Rinha de Galo (versus)**, uma célula preenchida corretamente fica vinculada ao jogador que a acertou. Somente esse jogador pode alterá-la enquanto ela permanecer correta. O singleplayer não usa essa restrição.

O próprio autor pode substituir a resposta correta por uma errada ou apagá-la. Ao deixar de ser uma resposta correta, a célula perde o bloqueio e volta a poder ser editada pelos participantes. Respostas reveladas pela NASA permanecem protegidas contra alteração por jogadores.

## Como foi implementado

- `js/services/input-controller.js`: uma verificação única acontece antes de alterar o tabuleiro. Ela cobre as rotas compartilhadas de digitação, numpad, toque, lápis e apagamento.
- `js/network/multiplayer-service.js`: o `boardState` da Jianmu guarda `cellLocks` (autor por célula correta) e `cellLastUpdatedByPlayerIdByCell` (autor da última alteração daquela célula). As duas informações são publicadas junto com a alteração da célula. O cliente também valida atualizações recebidas e rejeita a alteração de uma resposta correta quando o editor por célula não é seu autor.
- `js/core/app-state.js`: inicializa o mapa local de bloqueios.
- `js/network/multiplayer-voting.js`: limpa os bloqueios quando uma nova instância é criada.
- `tests/unit/multiplayer-cell-protection.test.js`: cobre coop, versus, singleplayer, edição pelo autor, bloqueio de terceiros, células erradas/vazias e a política de merge das atualizações recebidas.

Salas antigas que não tenham autoria recuperável para uma célula correta ficam bloqueadas para todos (fail-safe), em vez de atribuir a autoria arbitrariamente ao anfitrião. Quando o nó `contributions` contém a autoria daquela célula, ela é usada para hidratar o bloqueio legado.

## Persistência e escopo

Os novos campos são metadados operacionais do `boardState` na Jianmu (Firebase Realtime Database). A allowlist do Cold Storage em `backend/GAS/backup-coldstorage.js` continua selecionando apenas `boardInstanceNumber`, `boardValues`, `pencilNotes`, `elapsedSeconds`, `isCompleted`, `gameName`, `lastUpdatedByPlayerId` e `updatedAtTimestamp`; portanto `cellLocks` e `cellLastUpdatedByPlayerIdByCell` não são projetados para a Yggdrasil. Não houve alteração no esquema nem nos jobs do Cold Storage.

A lógica existente de `contributions` foi preservada. Esta alteração também não muda a política de `contributionEvents`.

## Limite de segurança

Esta proteção atua no cliente e no protocolo cooperativo entre clientes atualizados: ela impede as operações normais da interface e faz os outros clientes rejeitarem atualizações incompatíveis. Não é uma garantia anti-cheat contra um cliente deliberadamente modificado que escreva diretamente no RTDB. A aplicação continua dependendo das regras atuais do Firebase; uma garantia autoritativa exigiria validação confiável no servidor ou regras de segurança que imponham a autoria por célula.

## Validação executada

- `node --check` em todos os arquivos JavaScript de `js/` e `tests/`: aprovado.
- Harness Node com 21 assertions (incluindo 3 cenários de merge remoto de `boardState`): aprovado.
- A suíte Jest oficial não foi executada neste ambiente porque `tests/node_modules` não está instalado.
- Não foram executados deploy, `clasp push`, commit ou testes contra um Firebase remoto.
