# Correção — `contributionEvents` fora da Yggdrasil

**Projeto:** Sudoku Aneróthico PRÓ  
**Data:** 18/11/2026  
**Base:** `Sudoku-Anerothico-Yggdrasil-implementado-gepeto.zip`

## Correção aplicada

A projeção do Cold Storage não inclui mais `contributionEvents`. Consequentemente:

1. `jianmu_projectRoomData()` não lê nem projeta esses eventos.
2. O hash SHA-256 da sala não muda quando apenas `contributionEvents` muda.
3. `ygg_buildRoomWrites()` não cria documentos na subcoleção `contribution_events`.
4. `jianmu_acknowledgeArchivedData()` não remove eventos do RTDB; a compactação posterior ao commit continua removendo apenas snapshots `history` já confirmados no Firestore.
5. `YGGDRASIL_PROJECTION_VERSION` passou de `1` para `2`, para que marcadores da projeção anterior não façam o job considerar o novo formato já sincronizado.

## O que foi preservado

- O arquivamento de instâncias anteriores em `history/{instanceNumber}` continua ativo.
- A instância corrente e as instâncias históricas continuam sendo sincronizadas para `cold_rooms/{roomId}/instances/{instanceNumber}`.
- `boardState`, `meta`, configurações aprovadas, membros e o mapa consolidado `contributions` continuam na projeção.
- A reconciliação de contribuições obsoletas continua restrita à instância corrente.
- `moves` continua fora da projeção.
- O código cliente que atualmente escreve `contributionEvents` no RTDB e as regras RTDB correspondentes não foram alterados. Portanto, esses eventos continuam no RTDB e o Cold Storage não os exporta nem os apaga. Uma eventual decisão de parar de gerá-los ou limpar registros já existentes deve ser tratada separadamente.
- Não houve alteração de UI, regras de jogo ou fluxo de multiplayer.

## Arquivos modificados

- `backend/GAS/backup-coldstorage.js` — ajuste da projeção, hash implícito, gravação Firestore e compactação; incremento da versão da projeção.
- `tests/unit/gas-yggdrasil.test.js` — testes de exclusão dos eventos, independência do hash e preservação do histórico/contribuições.
- `README.md` — esclarecimento do destino dos eventos.
- `Trivia/implementacao-migracao-coldstorage-yggdrasil.md` — atualização do documento de implementação.

Nenhum arquivo foi removido. A quantidade de arquivos permaneceu em 73, igual à do ZIP recebido. O código cliente `js/network/multiplayer-service.js` e as regras RTDB permaneceram byte a byte inalterados.

## Validação

- `node --check` nos 43 arquivos JavaScript: **PASS**.
- Parse JSON de `appsscript.json`, `package.json`, `project.json` e `tests/package.json`: **PASS**.
- Teste direto da projeção, hash canônico, plano de writes Firestore e payload de compactação: **PASS**.
- Teste integrado com mocks do `runColdStorageCore`: **PASS** — sincroniza instância atual, snapshot histórico e contribuições; não escreve nem compacta `contributionEvents`; alteração isolada de eventos não dispara novo commit.
- Suíte Jest formal: **não executada**. `npm ci --offline` não pôde instalar as dependências porque o cache local não contém o pacote `yargs-parser` exigido pelo lockfile.
- Nenhum deploy, chamada a Firebase/Firestore real ou escrita remota foi executado.

## Observação sobre dados remotos

A versão anterior não foi implantada nem usada para backfill remoto, conforme o estado da implementação registrado anteriormente. Por isso, esta correção não inclui uma rotina destrutiva para procurar e apagar documentos `contribution_events` no Firestore. Caso tenha havido alguma execução remota posterior àquele estado, eventuais documentos antigos exigiriam uma limpeza deliberada e separada.
