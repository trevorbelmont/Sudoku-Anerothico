# Relatório de implementação — Cold Storage Jianmu → Yggdrasil

**Projeto:** Sudoku Aneróthico PRÓ  
**Data:** 18/11/2026  
**Base:** arquivo `Sudoku-Anerothico.zip` enviado nesta conversa  
**Resultado:** implementação local realizada; não implantada em serviços remotos.

## 1. O que foi implementado

- O destino ativo de `coldstorage_rooms` foi alterado para Cloud Firestore via REST API, mantendo `executeColdStorageRooms`, `executeFirebaseBackup`, `COLDSTORAGE_JOB_ID`, o contrato `JobMetrics`, os modos standalone/orquestrado, o lock e a integração sequencial com o Master.
- A gravação antiga em Google Drive foi preservada como `runColdStorageDriveLegacyCore()` e não é chamada pelo caminho ativo. Os consumidores de Drive/Sheets da telemetria foram mantidos.
- A leitura do Jianmu é uma varredura completa. Cada sala passa por allowlist, `.butIgnore`, canonicalização e SHA-256. O ledger individual fica em `/eden/coldstorage_rooms/room_sync/{roomId}`. O watermark global deixou de ser filtro de elegibilidade e só avança após uma varredura completa.
- Salas antigas sem `updatedAt`/marcador são sincronizadas inicialmente. Hash idêntico e versão de projeção iguais permitem skip posterior. Erro de leitura do ledger não é tratado como marcador ausente. Salas e snapshots históricos sem estrutura mínima ou com `instanceNumber` inconsistente falham fechados, sem serem marcados como sincronizados.
- O schema L2 preserva instâncias por `instanceNumber`, contribuições em subcoleções e eventos SET/DELETE. A reconciliação de contribuições obsoletas fica limitada à instância corrente; não remove instâncias históricas.
- Matrizes 2D são convertidas para uma estrutura Firestore válida e existe conversor inverso para testar round-trip. Valores numéricos fora da precisão segura e tipos não suportados são rejeitados.
- Cada sala usa um commit atômico, com validação conservadora de tamanho, quantidade de writes e resposta HTTP. Falha no commit impede marcador e checkpoint.
- Após o commit Firestore e o marcador Eden, o GAS compacta somente as entradas de histórico e eventos efetivamente incluídas no snapshot confirmado. Os documentos L2 não são apagados. Se a compactação falhar, o job reporta falha; a repetição é segura.
- A troca de partida passou a arquivar a instância atual via transação na raiz da sala, antes de publicar a próxima instância. A operação aborta em estado inconsistente ou quando não consegue usar transação.
- Atualizações de célula, contribuição e evento histórico são enviadas por um único multipath update no RTDB.
- `PROJECT_ID` foi adicionado à configuração e ao provisionamento de Script Properties. `DRIVE_FOLDER_ID` deixou de ser obrigatório para o novo fluxo, permanecendo opcional para rollback legado. Os escopos OAuth foram acrescentados sem substituir os serviços atuais.
- O caminho `/eden` recebeu negação explícita de leitura e escrita nas regras RTDB.

## 2. Arquivos modificados

1. `.environment.example`
2. `README.md` (seção de migração acrescentada ao final; histórico anterior mantido)
3. `backend/update-secrets.js`
4. `backend/GAS/appsscript.json`
5. `backend/GAS/backup-coldstorage.js`
6. `backend/GAS/master_orchestrator.js` (comentários de configuração/destino; lógica de dispatch preservada)
7. `backend/config/database.rules.json`
8. `tests/helpers/gas-loader.js`
9. `js/network/multiplayer-voting.js`
10. `js/network/multiplayer-service.js`

## 3. Arquivos adicionados

- `Trivia/implementacao-migracao-coldstorage-yggdrasil.md` — documentação técnica da implementação, limitações e ativação.
- `tests/unit/gas-yggdrasil.test.js` — testes unitários e de integração mockada do hash, projeção, conversão, histórico, ledger e falhas.

Nenhum arquivo preexistente foi removido da cópia de trabalho. Foram encontrados 73 arquivos preexistentes no baseline e todos continuam presentes na cópia de trabalho.

## 4. Verificações executadas

- `node --check` executado sobre todos os arquivos `.js` do projeto, excluindo `node_modules`: aprovado.
- Parse JSON do `backend/GAS/appsscript.json`: aprovado.
- Parse JSON5 de `backend/config/database.rules.json`: aprovado.
- Inspeção estrutural confirmando `.read: false` e `.write: false` em `/eden`: aprovado localmente.
- Harness Node com mocks: aprovado para sincronização inicial de sala legada, skip por hash inalterado, detecção de alteração em membro sem alteração do `updatedAt` raiz, ignorar alteração isolada do watermark, round-trip de matriz 25×25, rejeição de inteiro fora da precisão segura, IDs semelhantes a propriedades de protótipo, compactação pós-commit, validação estrutural de salas e falha HTTP do commit sem marcador/checkpoint.
- Os testes Jest foram adicionados, mas a suíte Jest completa não foi executada porque as dependências não estavam disponíveis no cache offline e a tentativa de instalação online expirou. Não estou declarando a suíte completa como aprovada.

## 5. Limitações e riscos que permanecem

### Segurança do RTDB — requer atenção antes de produção

As regras atuais mantêm `.read: true` em `/rooms` e `.write: true` em cada `/rooms/$room_id`. Essas permissões alcançam os nós descendentes. Como consequência:

- `privateData/{playerId}/clientMetadata`, apesar do nome, pode ser lido por clientes que consultem `/rooms`;
- `history` e `contributionEvents` podem ser alterados/apagados por clientes que tenham acesso de escrita na sala;
- regras `.read: false`/`.write: false` nos descendentes não revogariam uma permissão concedida no ancestral.

Não estreitei essas permissões nesta migração para não quebrar os listeners e o fluxo multiplayer existentes. A allowlist protege o conteúdo enviado à L2, mas não corrige essa exposição no L1. Antes de publicar, recomendo uma migração específica de autorização: separar listeners públicos dos metadados pessoais e mover a gravação/leitura privada para caminho com identidade validável. Para trilha antifraude imutável, os eventos precisam ser produzidos/verificados por um componente confiável de servidor; o registro atual no cliente é apenas append-only por convenção.

### Ambiente e serviços remotos

Não foram executados deploy do GAS, publicação de regras, configuração IAM, habilitação remota do Firestore, backfill real nem escrita em produção. O projeto Google Cloud e a conta efetiva do GAS precisam ter Firestore habilitado e permissões IAM compatíveis; os novos escopos precisam ser autorizados.

### Concorrência e volume

A transação de troca de partida opera na raiz da sala e pode ler/escrever um objeto grande; ocorre apenas ao iniciar uma nova instância. A compactação pós-backup reduz o crescimento do RTDB, mas, após remover histórico/eventos já confirmados, a primeira varredura seguinte pode produzir um commit adicional para normalizar o hash do snapshot compactado.

## 6. Arquivos locais que não foram incluídos no ZIP de entrega

Por segurança, o ZIP exportado não inclui:

- `.environment` — contém valores reais preenchidos para credenciais/tokens;
- `backend/GAS/.clasp.json` — configuração local de vínculo com o projeto Clasp;
- `tests/node_modules` — dependências instaladas/parciais da máquina.

O arquivo `misc/concat_v0_9-antes migração.txt` foi incluído com os valores de credenciais coincidentes com `.environment` substituídos por `[REDACTED]`. O original permaneceu intacto na cópia de trabalho. O `.environment.example` está incluído.

O pacote ZIP contém 73 arquivos e foi comparado com a cópia de trabalho; a única alteração de conteúdo de arquivo dentro do pacote é a substituição dos valores secretos no arquivo concatenado. O `.environment` original foi preservado sem alterações na cópia de trabalho. Como o ZIP enviado continha credenciais reais também reproduzidas no arquivo concatenado, recomendo rotacionar `FIREBASE_SECRET` e `CRON_TOKEN` caso esses valores ainda estejam ativos ou tenham sido compartilhados fora de um ambiente privado.

## 7. Próximos passos de ativação

1. Recolocar localmente `.environment` e `.clasp.json` a partir de suas cópias privadas.
2. Conferir `PROJECT_ID` no Console Firebase/Google Cloud; o exemplo foi preenchido com `sudoku-anerothico`, derivado da configuração Firebase encontrada no projeto.
3. Habilitar Cloud Firestore `(default)` e conceder IAM de leitura/listagem/escrita à identidade que executa o GAS.
4. Fazer deploy do GAS e autorizar os escopos; revisar o resultado de `clasp push` antes de atualizar o trigger.
5. Validar as regras RTDB num projeto de teste e corrigir a exposição de `privateData`/escrita ampla antes de publicar para usuários.
6. Executar um canário com poucas salas, comparar dados e executar um segundo ciclo para comprovar skip/compactação.
7. Só então habilitar o trigger Master para a nova rota L2.

Os backups JSON antigos no Drive devem permanecer intactos durante o canário e o período de rollback.
