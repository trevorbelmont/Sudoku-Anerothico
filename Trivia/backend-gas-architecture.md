# Backend GAS — Arquitetura, Nós Firebase e Guia de Operações Manuais

> Estado do código: `backup-coldstorage.js` + `master_orchestrator.js` +
> `jobs-orchestrator.json` — pós-commit feat(telemetry) de nov/2026.

---

## 1. Visão Geral

O backend é 100% serverless. Não há servidor próprio rodando em nuvem —
o runtime é o **Google Apps Script (GAS)**, ativado por um trigger temporal
interno ou por chamadas REST ao Web App publicado.

```
GitHub (config / .butIgnore)
        │  fallback
        ▼
Firebase Realtime Database  ◄──── fonte da verdade em runtime
        │
        ▼
Google Apps Script (GAS)
  ├─ master_orchestrator.js   ← despachante central
  └─ backup-coldstorage.js    ← job coldstorage_rooms + toda a telemetria
        │
        ▼
Google Drive (arquivos JSON de backup)
Google Sheets (planilha de telemetria)
```

### Arquivos GAS

| Arquivo | Responsabilidade |
|---|---|
| `master_orchestrator.js` | Trigger, lock, avaliação de schedule, flush de telemetria em lote, REST router (`doGet`/`doPost`) |
| `backup-coldstorage.js` | Job `coldstorage_rooms`, toda a lógica de telemetria (append, formatação, provisioning de planilha) |

### Script Properties necessárias (configuradas no editor GAS)

| Chave | Descrição |
|---|---|
| `CRON_TOKEN` | Token de autenticação do endpoint REST |
| `FIREBASE_URL` | URL base do Realtime Database (sem barra final) |
| `FIREBASE_SECRET` | Credencial REST do Firebase |
| `GITHUB_JOBS_CONFIG_URL` | URL Raw do `jobs-orchestrator.json` no repositório |
| `GITHUB_BUTIGNORE_URL` | URL Raw do `.butIgnore` no repositório |
| `LOG_SHEET_ID` | ID da planilha de telemetria (ou `"NULL"` para forçar nova) |
| `LOG_SHEET_FOLDER_ID` | (opcional) ID da pasta do Drive para a planilha |
| `DRIVE_FOLDER_ID` | ID da pasta do Drive para os backups JSON |

---

## 2. Regras de Segurança do Firebase Realtime Database

### 2.1 Arquivo de regras

As regras vivem em `backend/config/database.rules.json`. O arquivo usa
JSONC (JSON com comentários `//`), que o console do Firebase aceita nativamente.

Para publicar: copie o conteúdo do arquivo e cole em
**Firebase Console → Realtime Database → Rules → Publish**.

### 2.2 Política de comentários (clean-code)

Comentários ficam **sempre na linha acima** do código que descrevem.
Nunca na mesma linha que o código. Isso permite apagar um bloco de
comentário selecionando a linha inteira sem tocar no código adjacente.

### 2.3 Bug histórico — `.validate` na raiz de `$room_id` (resolvido em nov/2026)

**Sintoma:** clientes recebiam `PERMISSION_DENIED` ao tentar criar ou
atualizar salas, mesmo com `.write: true` declarado em `$room_id`.

**Causa:** havia um `.validate` na raiz do nó `$room_id` exigindo a
presença simultânea de `updatedAt`, `boardState` e `meta`:

```json
"$room_id": {
  ".write": true,
  ".validate": "newData.hasChildren(['updatedAt', 'boardState', 'meta'])"
}
```

O Firebase avalia o `.validate` do nó **pai** em toda escrita em qualquer
nó **filho**. Ou seja, ao gravar isoladamente em
`rooms/$roomId/boardState` (ex: `publishRoomBoardCell`) ou em
`rooms/$roomId/presence` (ex: `registerRoomPresence`), o Firebase
avaliava o validate do pai `$room_id` e o reprovava porque `updatedAt`
e `meta` não chegavam naquele mesmo write.

O padrão de escrita do cliente usa múltiplos `fb.set` em subnós
separados (e `fb.update` multi-path para jogadas individuais),
**não** um único `fb.set` atômico na raiz da sala. O validate da raiz
é incompatível com esse padrão.

**Correção:** o `.validate` foi removido da raiz de `$room_id`.
A validação estrutural de cada campo já existe nos próprios subnós
(`boardState`, `meta`, `moves`, etc.) e é suficiente.

**Regra para futuras implementações:** não adicione `.validate` de
estrutura na raiz de `$room_id` (nem em qualquer nó pai cujos filhos
sejam escritos de forma independente pelo cliente).

---

## 3. Mapa de Nós do Firebase (Gameplay)

```
/
├── rooms/                          ← dados de gameplay (leitura pelo job)
│   └── {roomId}/
│       └── updatedAt               ← watermark por sala (escrito pelo job)
│
├── server_config/                  ← configurações em runtime
│   ├── jobs_orchestrator.json      ← espelho do jobs-orchestrator.json
│   ├── but_ignore.json             ← espelho do .butIgnore (string INI)
│   └── log_sheet_id.json           ← ID da planilha de telemetria ativa
│
└── server_meta/                    ← estado de execução dos jobs
    ├── master_orchestrator/
    │   ├── last_attempt_at
    │   ├── last_completed_at
    │   ├── last_success_at
    │   ├── last_scheduled_at
    │   ├── last_scheduled_success_at
    │   ├── last_invocation
    │   ├── last_run_id
    │   ├── status
    │   └── duration_ms
    └── coldstorage_rooms/
        ├── last_backup_timestamp   ← watermark de janela (checkpoint-last)
        ├── last_attempt_at
        ├── last_completed_at
        ├── last_success_at
        ├── last_scheduled_at
        ├── last_scheduled_success_at
        ├── last_invocation
        ├── last_run_id
        └── last_file
```

### Qual nó apagar para quê

| Objetivo | Nó(s) a apagar | Efeito |
|---|---|---|
| Forçar releitura do `jobs-orchestrator.json` do GitHub | `/server_config/jobs_orchestrator.json` | Próxima execução usa fallback GitHub e faz auto-seed |
| Forçar releitura do `.butIgnore` do GitHub | `/server_config/but_ignore.json` | Idem para as regras do butIgnore |
| Forçar ambos (atualização completa de config) | `/server_config/jobs_orchestrator.json` + `/server_config/but_ignore.json` | Recomendado após push de mudanças nos dois |
| Forçar novo ciclo completo do coldstorage (rearquiva tudo) | `/server_meta/coldstorage_rooms/last_backup_timestamp` | Watermark vai a 0 — próximo ciclo arquiva todas as salas sem updatedAt e salas da janela desde epoch |
| Forçar nova planilha de telemetria | Setar `LOG_SHEET_ID = "NULL"` no Script Properties | **Não apagar o nó Firebase** — o Properties é a origem; o nó Firebase é fallback |

> ⚠️ **Nunca apague** `/server_config/log_sheet_id.json` sem antes
> copiar o ID — perder esse valor faz o sistema provisionar uma planilha
> nova (histórico de telemetria fica na planilha antiga, inacessível pelo job).

---

## 4. Como Atualizar Só o Firebase (sem push de código)

Use a REST API do Firebase Realtime Database diretamente. Substitua
`<FIREBASE_URL>` e `<FIREBASE_SECRET>` pelos valores reais.

### 4.1 Apagar um nó (forçar fallback)

```powershell
# Apagar jobs_orchestrator.json (força releitura do GitHub)
Invoke-RestMethod `
  -Method DELETE `
  -Uri "<FIREBASE_URL>/server_config/jobs_orchestrator.json?auth=<FIREBASE_SECRET>"

# Apagar but_ignore.json (força releitura do GitHub)
Invoke-RestMethod `
  -Method DELETE `
  -Uri "<FIREBASE_URL>/server_config/but_ignore.json?auth=<FIREBASE_SECRET>"
```

### 4.2 Gravar config diretamente (sem depender do fallback)

```powershell
# Ler o JSON local e enviar diretamente ao Firebase
$config = Get-Content "backend\config\jobs-orchestrator.json" -Raw

Invoke-RestMethod `
  -Method PUT `
  -Uri "<FIREBASE_URL>/server_config/jobs_orchestrator.json?auth=<FIREBASE_SECRET>" `
  -ContentType "application/json" `
  -Body $config
```

> O nó `jobs_orchestrator.json` guarda o JSON completo do arquivo.
> O nó `but_ignore.json` guarda o texto INI do `.butIgnore`
> **serializado como string JSON** (ou seja, o payload deve ser
> `'"conteúdo do arquivo..."'` com as aspas externas — use
> `ConvertTo-Json` para gerar isso):

```powershell
$raw = Get-Content ".butIgnore" -Raw
$payload = $raw | ConvertTo-Json   # serializa a string com escapes

Invoke-RestMethod `
  -Method PUT `
  -Uri "<FIREBASE_URL>/server_config/but_ignore.json?auth=<FIREBASE_SECRET>" `
  -ContentType "application/json" `
  -Body $payload
```

### 4.3 Ler o estado atual de um nó

```powershell
Invoke-RestMethod `
  -Uri "<FIREBASE_URL>/server_meta.json?auth=<FIREBASE_SECRET>"
```

---

## 5. Como Atualizar Firebase + Fallback (push de código + reset)

Fluxo completo recomendado quando você muda `jobs-orchestrator.json`
ou `.butIgnore` e quer garantir que o Firebase reflita a versão nova:

1. Faça o push para `main` → CI roda → CD faz deploy para o GAS.
2. Apague os dois nós de config no Firebase (seção 3.1 acima).
3. Dispare o CD manualmente pela aba **Actions → CD → Run workflow**
   se não houve mudança em `backend/GAS/**` (ou dispare via REST — veja seção 5).
4. Na primeira execução do Master após o deploy:
   - Firebase retorna `"null"` para os dois nós
   - GAS lê os arquivos do GitHub Raw (fallback)
   - GAS faz auto-seed: grava os dois nós de volta no Firebase
5. A partir daí o Firebase é a fonte da verdade novamente com a config nova.

> O cache interno do GAS (`CacheService`) tem TTL de 2h para a config
> e 4h para o butIgnore. Se quiser forçar releitura imediata sem esperar
> o TTL, é necessário apagar o cache pelo editor GAS:
> `CacheService.getScriptCache().remove('orchestratorConfig_v1_raw')`
> e `CacheService.getScriptCache().remove('butIgnoreCache_v1_coldstorage_rooms_raw')`.

---

## 6. Endpoint REST do Web App GAS

O GAS expõe um único `doPost` com roteamento por `action`. Todas as
chamadas exigem o `CRON_TOKEN` no body JSON.

### Ações disponíveis

| `action` | O que faz |
|---|---|
| `master` | Executa `runMasterOrchestrator()` (MANUAL_MASTER) — avalia schedule e despacha jobs elegíveis |
| `backup` | Executa `executeColdStorageRooms()` standalone (MANUAL_SOLO) — ignora schedule |
| `status` | Retorna `/server_meta` completo (último estado de todos os jobs) |
| `reinstall_trigger` | Apaga e recria o trigger temporal com o heartbeat atual do JSON |

### Exemplo de chamada (PowerShell)

```powershell
$body = @{
  token  = "<CRON_TOKEN>"
  action = "master"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method POST `
  -Uri "<GAS_WEBAPP_URL>" `
  -ContentType "application/json" `
  -Body $body
```

### Exemplo de chamada (servidor local `servidor-local.ps1`)

O projeto já tem um servidor local em PowerShell. Para despachar via ele,
use a mesma estrutura — o servidor local pode ser adaptado para expor
rotas que fazem proxy dessas chamadas REST para o GAS, permitindo um
painel de administração local sem expor o token diretamente no frontend.

---

## 7. Lógica Anti-Duplicata do Cold Storage

Resumo de como o job evita rearquivar dados já processados:

1. **Watermark de janela** — `/server_meta/coldstorage_rooms/last_backup_timestamp`
   delimita a janela. Só salas com `updatedAt >= last` e `< wakeUpTime` entram.
2. **Ordem de operações** — Drive grava primeiro, watermark avança depois.
   Falha entre os dois = duplicata segura no próximo ciclo (sem perda).
3. **Salas legacy** (sem `updatedAt`) — sempre incluídas na primeira vez.
   Após gravar + watermark, recebem `PATCH /rooms/{id}/updatedAt = wakeUpTime - 1`
   via `stampLegacyWatermarks()`. Nos ciclos seguintes ficam abaixo do watermark
   e são ignoradas.
4. **Política `ALL_SUCCEEDED`** — a âncora de intervalo é `last_success_at`.
   Falha não reseta o timer; próximo heartbeat (30min) reavalia e pode retry.

---

## 8. Reinstalar o Trigger (mudar o heartbeat)

O trigger temporal é instalado **uma única vez** pelo editor GAS
(`installMasterTrigger()`). Para mudar a cadência:

**Via REST (recomendado — sem abrir o editor GAS):**

```powershell
$body = @{
  token  = "<CRON_TOKEN>"
  action = "reinstall_trigger"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method POST `
  -Uri "<GAS_WEBAPP_URL>" `
  -ContentType "application/json" `
  -Body $body
```

O `reinstallMasterTrigger()` apaga todos os triggers existentes para
`runScheduledMasterOrchestrator` e recria com o heartbeat lido do
`jobs-orchestrator.json` atual (Firebase-first, fallback GitHub).

**Cadências aceitas pelo Apps Script:**
- Minutos: apenas `1`, `5`, `10`, `15` ou `30`
- Horas: qualquer inteiro (`PT1H`, `PT2H`, …)
- Dias: qualquer inteiro (`P1D`, `P2D`, …) — dispara às 03:00 America/Sao_Paulo
- Semanas: qualquer inteiro (`P1W`, …) — dispara às 03:00 America/Sao_Paulo

Durações compostas (`P1DT12H`) são rejeitadas com erro.
