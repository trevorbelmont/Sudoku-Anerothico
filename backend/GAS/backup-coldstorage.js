/**
 * SUDOKU ANERÓTHICO PRÓ — Cold Storage de Salas (Job: coldstorage_rooms)
 *  
 * Responsabilidade: backup diferencial de `rooms` do Firebase Realtime Database
 * para arquivos JSON no Google Drive, com watermark, exclusão de caminhos
 * voláteis via .butIgnore e telemetria padronizada de 11 colunas.
 * MIGRACAO (caminho ativo): Jianmu/RTDB → Yggdrasil/Cloud Firestore, com
 * ledger SHA-256 por sala no Eden. A implementação Drive permanece preservada
 * em runColdStorageDriveLegacyCore() para compatibilidade/rollback; não é
 * executada pelo ponto de entrada ativo. O Drive segue disponível à telemetria.
 *
 * Ambiente de execução: Google Apps Script V8 (runtime síncrono).
 * Não use require, module.exports, process.env, fs, async/await ou Promise.all.
 *
 * NOTA DE ESCOPO GLOBAL GAS:
 *   Os arquivos de um projeto Apps Script compartilham o escopo global.
 *   As funções utilitárias canônicas (parseIso8601Duration, loadAndValidateConfig,
 *   validateOrchestratorConfig, normalizeFirebaseUrl, buildBaseMetrics,
 *   sanitizeError, formatInvocationLabel, generateRunId) estão definidas
 *   em master_orchestrator.js e estão acessíveis aqui sem redefinição.
 *   A telemetria (appendTelemetryRow e auxiliares) também está definida aqui
 *   e é usada pelo Master.
 *
 * Modos de execução:
 *   - Standalone (isOrchestrated = false): adquire lock, carrega configs, persiste
 *     backup, grava linha de telemetria.
 *   - Orquestrado (isOrchestrated = true): recebe contexto injetado pelo Master,
 *     retorna JobMetrics sem gravar linha própria na planilha.
 *
 * Compatibilidade:
 *   - A função pública executeFirebaseBackup() é mantida como wrapper de
 *     compatibilidade REST (action=backup legacy), delegando para o modo standalone.
 *
 * Script Properties necessárias:
 *   FIREBASE_URL          — URL base do Realtime Database (sem barra final)
 *   FIREBASE_SECRET       — Credencial de acesso REST ao Firebase
 *   GITHUB_BUTIGNORE_URL  — URL Raw do .butIgnore (capitalização exata)
 *   LOG_SHEET_ID          — ID da planilha de telemetria (ou "NULL" para provisionar)
 *   LOG_SHEET_FOLDER_ID   — (opcional) pasta onde criar a planilha de telemetria
 *   PROJECT_ID            — ID do projeto Google Cloud com Cloud Firestore
 *   DRIVE_FOLDER_ID       — legado/opcional; usado apenas pelo núcleo antigo preservado
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constantes do Cold Storage
// ─────────────────────────────────────────────────────────────────────────────

var COLDSTORAGE_JOB_ID = 'coldstorage_rooms';
var COLDSTORAGE_ROOMS_PATH = '/rooms.json';
var SERVER_META_COLDSTORAGE_PATH = '/server_meta/coldstorage_rooms.json';
var COLDSTORAGE_SCHEMA_VERSION = 1;
var COLDSTORAGE_LOCK_TIMEOUT_MS = 25000;
var BUTIGNORE_CACHE_KEY = 'butIgnoreCache_v1';
var BUTIGNORE_CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 horas


// ─────────────────────────────────────────────────────────────────────────────
// Jianmu (L1), Yggdrasil (L2) e Eden (metadados administrativos)
// ─────────────────────────────────────────────────────────────────────────────
// Os identificadores legados acima permanecem disponíveis para compatibilidade.
var JIANMU_ROOMS_PATH = COLDSTORAGE_ROOMS_PATH;
var EDEN_COLDSTORAGE_CHECKPOINT_PATH = SERVER_META_COLDSTORAGE_PATH;
var EDEN_ROOM_SYNC_PATH = '/eden/coldstorage_rooms/room_sync';
var YGGDRASIL_COLLECTION_ROOMS = 'cold_rooms';
var YGGDRASIL_DATABASE_ID = '(default)';
var YGGDRASIL_SYNC_SCHEMA_VERSION = 1;
var YGGDRASIL_PROJECTION_VERSION = 2; // v2 deixa contributionEvents fora do snapshot L2
var YGGDRASIL_MAX_DOCUMENT_BYTES = 900 * 1024;
var YGGDRASIL_MAX_COMMIT_BYTES = 9 * 1024 * 1024;
var YGGDRASIL_MAX_WRITES_PER_COMMIT = 450;
var YGGDRASIL_MAX_LIST_PAGE_SIZE = 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Constantes da telemetria (definidas aqui, usadas pelo Master via escopo global)
// ─────────────────────────────────────────────────────────────────────────────

var TELEMETRY_HEADERS = [
  'JOB_ID', 'Timestamp', 'Invocation', 'Action', 'Status',
  'Items_Processed', 'Bytes_Down', 'Bytes_Drive', 'Target', 'Errors', 'Notes'
];

// Resolução da planilha de telemetria (Properties → Cache → Firebase → provisiona nova)
var LOG_SHEET_ID_CACHE_KEY = 'logSheetId_v1';
var LOG_SHEET_ID_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — segura as pontas se o Properties sumir
var SERVER_CONFIG_LOG_SHEET_PATH = '/server_config/log_sheet_id.json';

// ─────────────────────────────────────────────────────────────────────────────
// Ponto de entrada público: modo standalone e compatibilidade legacy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Executa o Cold Storage de salas.
 *
 * @param {boolean} isOrchestrated  true = chamado pelo Master; false = standalone
 * @param {Object}  customOptions   contexto injetado pelo Master:
 *   {Object}  config           - configuração validada do orchestrator
 *   {Array}   butIgnoreRules   - regras parseadas (já carregadas pelo Master)
 *   {number}  wakeUpTime       - Date.now() capturado no início do ciclo
 *   {string}  runId            - identificador único do ciclo
 *   {string}  invocation       - 'SCHEDULED_MASTER' | 'MANUAL_MASTER' | 'MANUAL_SOLO'
 *   {boolean} lockAlreadyHeld  - true = Master já tem o Script Lock
 * @returns {Object} JobMetrics
 */
function executeColdStorageRooms(isOrchestrated, customOptions) {
  isOrchestrated = isOrchestrated === true;
  customOptions = customOptions || {};

  var lock = null;
  var lockAcquired = false;

  try {
    // ── 1. Script Lock (somente standalone) ──────────────────────────────
    if (!isOrchestrated && !customOptions.lockAlreadyHeld) {
      lock = LockService.getScriptLock();
      lockAcquired = lock.tryLock(COLDSTORAGE_LOCK_TIMEOUT_MS);
      if (!lockAcquired) {
        var skippedMetrics = buildBaseMetrics(COLDSTORAGE_JOB_ID, customOptions);
        skippedMetrics.status = 'SKIPPED';
        skippedMetrics.notes = '[Ativação: REST manual standalone]\nSkip: lock indisponível — execução concorrente em andamento.';
        skippedMetrics.completedSuccessfully = false;
        return skippedMetrics;
      }
    }

    // ── 2. Carregar configuração e regras (se não injetadas) ──────────────
    var props = PropertiesService.getScriptProperties();
    var config = customOptions.config || null;
    var butIgnoreRules = customOptions.butIgnoreRules || null;
    var wakeUpTime = typeof customOptions.wakeUpTime === 'number' ? customOptions.wakeUpTime : Date.now();
    var runId = customOptions.runId || generateRunId();
    var invocation = customOptions.invocation || 'MANUAL_SOLO';

    if (!config) {
      // Configuração via Firebase-first (fallback GitHub) — ver loadAndValidateConfig().
      config = loadAndValidateConfig();
    }

    if (!butIgnoreRules) {
      // Regras via Firebase-first (fallback GitHub) — ver loadAndParseButIgnore().
      butIgnoreRules = loadAndParseButIgnore(COLDSTORAGE_JOB_ID);
    }

    // ── 3. Executar núcleo de backup ──────────────────────────────────────
    var metrics = runColdStorageCore(props, config, butIgnoreRules, wakeUpTime, runId, invocation);

    // ── 4. Persistir metadados no Firebase ────────────────────────────────
    persistColdStorageMeta(props, metrics, invocation);

    // ── 5. Telemetria (somente standalone) ────────────────────────────────
    if (!isOrchestrated) {
      appendTelemetryRow(props, config, [metrics]);
    }

    return metrics;

  } catch (err) {
    var failedMetrics = buildBaseMetrics(COLDSTORAGE_JOB_ID, customOptions);
    failedMetrics.status = 'FAILED';
    failedMetrics.errorTrace = sanitizeError(err);
    failedMetrics.completedSuccessfully = false;
    failedMetrics.notes = formatInvocationLabel(customOptions.invocation || 'MANUAL_SOLO') +
      '\nFalha na execução do Cold Storage: ' + failedMetrics.errorTrace;

    try {
      var propsForMeta = PropertiesService.getScriptProperties();
      persistColdStorageMeta(propsForMeta, failedMetrics, customOptions.invocation || 'MANUAL_SOLO');
    } catch (metaErr) {
      console.error('Falha ao registrar metadados após erro do Cold Storage:', sanitizeError(metaErr));
    }

    if (!isOrchestrated) {
      try {
        var propsForSheet = PropertiesService.getScriptProperties();
        var cfgForSheet = null;
        try {
          // Firebase-first: se ambas as fontes falharem, cfgForSheet fica null e a
          // telemetria usa defaults (timezone/nome da planilha).
          cfgForSheet = loadAndValidateConfig();
        } catch (_) {}
        appendTelemetryRow(propsForSheet, cfgForSheet, [failedMetrics]);
      } catch (sheetErr) {
        console.error('Falha ao registrar telemetria de erro do Cold Storage:', sanitizeError(sheetErr));
      }
    }

    return failedMetrics;

  } finally {
    if (lock && lockAcquired) {
      try { lock.releaseLock(); } catch (_) {}
    }
  }
}

/**
 * Wrapper de compatibilidade com a ação REST `action=backup` legada.
 * Preserva o contrato externo preexistente.
 */
function executeFirebaseBackup() {
  return executeColdStorageRooms(false, { invocation: 'MANUAL_SOLO' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Núcleo do backup (checkpoint-last)
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Núcleo ativo: Jianmu → Yggdrasil, com ledger diferencial no Eden
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Executa uma varredura completa do Jianmu e sincroniza somente as projeções
 * persistentes cujo hash diverge do ledger administrativo no Eden.
 *
 * O checkpoint global é avançado somente depois de todas as salas terem sido
 * verificadas e todos os commits/markers necessários terem sido confirmados.
 * O hash de cada sala representa exatamente o snapshot enviado ao Firestore.
 */
function runColdStorageCore(props, config, butIgnoreRules, wakeUpTime, runId, invocation) {
  var metrics = buildBaseMetrics(COLDSTORAGE_JOB_ID, { invocation: invocation, runId: runId });
  var activationLabel = formatInvocationLabel(invocation);
  metrics.action = 'BACKUP';
  metrics.target = 'Yggdrasil / Firestore';

  var dbUrl = normalizeFirebaseUrl(props.getProperty('FIREBASE_URL'));
  var secret = props.getProperty('FIREBASE_SECRET');
  var projectId = props.getProperty('PROJECT_ID');
  var timezone = (config && config.system && config.system.timezone) || 'America/Sao_Paulo';
  if (!dbUrl || !secret || !projectId) {
    throw new Error('Script Properties obrigatórias ausentes: FIREBASE_URL, FIREBASE_SECRET ou PROJECT_ID.');
  }

  ygg_validateProjectId(projectId);
  var scanStartedAt = wakeUpTime;
  var checkpoint = eden_readColdStorageCheckpoint(dbUrl, secret);
  var roomsSnapshot = jianmu_readRoomsSnapshot(dbUrl, secret);
  metrics.bytesDownloaded = roomsSnapshot.bytes;

  // A varredura é completa: updatedAt e o watermark não podem impedir a
  // detecção de mudanças em subnós persistentes que não atualizam a raiz.
  var roomsCopy = coldStorageDeepCopy(roomsSnapshot.rooms);
  var nodesIgnored = applyButIgnoreFilter(roomsCopy, butIgnoreRules);
  var roomIds = Object.keys(roomsCopy).sort();
  var roomsUnchanged = 0;
  var roomsSynced = 0;
  var roomsLegacyInitialized = 0;
  var documentsWritten = 0;
  var bytesSent = 0;
  var failures = [];

  for (var i = 0; i < roomIds.length; i++) {
    var roomId = roomIds[i];
    var room = roomsCopy[roomId];

    try {
      var projection = jianmu_projectRoomData(roomId, room);
      // updatedAt é conservado como diagnóstico no documento raiz, mas não
      // faz parte da identidade do conteúdo persistente: o hash deve reagir
      // a dados reais, não a uma simples atualização do watermark.
      var hashProjection = coldStorageDeepCopy(projection);
      delete hashProjection.updatedAt;
      var hashInput = {
        schemaVersion: YGGDRASIL_SYNC_SCHEMA_VERSION,
        projectionVersion: YGGDRASIL_PROJECTION_VERSION,
        room: hashProjection
      };
      var canonical = jianmu_canonicalize(hashInput);
      var roomHash = jianmu_calculateSha256(canonical);
      var marker = eden_readRoomSyncState(dbUrl, secret, roomId);

      if (marker && marker.lastSyncedHash === roomHash &&
          Number(marker.schemaVersion) === YGGDRASIL_SYNC_SCHEMA_VERSION &&
          Number(marker.projectionVersion) === YGGDRASIL_PROJECTION_VERSION &&
          marker.syncStatus === 'SUCCESS') {
        // Se a cópia já está confirmada no L2, é seguro retirar do Jianmu
        // somente os snapshots históricos exatos presentes nesta projeção.
        // contributionEvents não participa desta projeção nem é compactado.
        // Se uma tentativa anterior falhou parcialmente, a operação é idempotente.
        jianmu_acknowledgeArchivedData(dbUrl, secret, roomId, projection);
        roomsUnchanged++;
        continue;
      }

      var isLegacyInitial = !marker;
      var writePlan = ygg_buildRoomWrites(projectId, projection, roomHash, scanStartedAt);
      var existingContributionDocs = ygg_listCurrentContributionDocuments(projectId, writePlan.currentContributionCollectionPath);
      var staleDeletes = ygg_buildStaleContributionDeletes(
        writePlan.currentContributionCollectionPath,
        existingContributionDocs,
        writePlan.currentContributionDocumentIds
      );
      var writes = writePlan.writes.concat(staleDeletes);
      ygg_validateRoomWritePlan(writes);
      var commitBytes = ygg_commitRoom(projectId, writes);
      documentsWritten += writes.length;
      bytesSent += commitBytes;

      // Este marker é deliberadamente posterior ao commit. Se falhar, o commit
      // determinístico será repetido no próximo ciclo, sem perda de dados.
      eden_writeRoomSyncState(dbUrl, secret, roomId, {
        schemaVersion: YGGDRASIL_SYNC_SCHEMA_VERSION,
        projectionVersion: YGGDRASIL_PROJECTION_VERSION,
        syncStatus: 'SUCCESS',
        lastSyncedAt: Date.now(),
        snapshotCapturedAt: scanStartedAt,
        sourceUpdatedAt: projection.updatedAt || null,
        lastSyncedHash: roomHash,
        lastSyncedInstanceNumber: projection.currentInstanceNumber,
        lastRunId: runId,
        lastTarget: 'yggdrasil'
      });

      // A partir daqui, o snapshot histórico está durável na Yggdrasil.
      // A compactação do history é posterior ao commit e ao marcador; falha
      // nela deixa a execução incompleta e será repetida sem perda da cópia.
      jianmu_acknowledgeArchivedData(dbUrl, secret, roomId, projection);
      roomsSynced++;
      if (isLegacyInitial) roomsLegacyInitialized++;
    } catch (roomError) {
      failures.push('Sala ' + String(roomId).slice(0, 100) + ': ' + sanitizeError(roomError));
      console.error('Falha ao sincronizar sala ' + String(roomId).slice(0, 100) + ': ' + sanitizeError(roomError));
    }
  }

  metrics.itemsProcessed = roomsSynced;
  metrics.bytesSaved = bytesSent;
  metrics.target = 'Firestore: ' + YGGDRASIL_COLLECTION_ROOMS + ' (' + projectId + ')';

  if (failures.length > 0) {
    metrics.status = 'FAILED';
    metrics.completedSuccessfully = false;
    metrics.errorTrace = failures.join('\n').slice(0, 8000);
    metrics.notes = activationLabel +
      '\nVarredura incompleta; checkpoint global NÃO avançado.' +
      '\nSalas examinadas: ' + roomIds.length +
      ' | Sincronizadas: ' + roomsSynced +
      ' | Inalteradas: ' + roomsUnchanged +
      ' | Legadas inicializadas: ' + roomsLegacyInitialized +
      ' | Documentos confirmados: ' + documentsWritten +
      ' | Bytes enviados: ' + bytesSent +
      ' | Nós ignorados por .butIgnore: ' + nodesIgnored +
      '\nFalhas: ' + failures.length +
      '\nCheckpoint anterior: ' + checkpoint.timestamp;
    return metrics;
  }

  eden_advanceColdStorageCheckpoint(dbUrl, secret, scanStartedAt);
  metrics.status = roomsSynced === 0 ? 'SKIPPED' : 'SUCCESS';
  metrics.completedSuccessfully = true;
  metrics.notes = activationLabel +
    '\nVarredura completa do Jianmu confirmada.' +
    '\nSalas examinadas: ' + roomIds.length +
    ' | Sincronizadas: ' + roomsSynced +
    ' | Inalteradas: ' + roomsUnchanged +
    ' | Legadas inicializadas: ' + roomsLegacyInitialized +
    ' | Documentos confirmados: ' + documentsWritten +
    ' | Bytes enviados: ' + bytesSent +
    ' | Nós ignorados por .butIgnore: ' + nodesIgnored +
    '\nCheckpoint anterior: ' + checkpoint.timestamp +
    ' | Novo checkpoint: ' + scanStartedAt +
    '\nFuso de telemetria: ' + timezone +
    '\nPolítica de repetição efetiva: ' + (
      config && config.jobs_schedule && config.jobs_schedule[COLDSTORAGE_JOB_ID] &&
      config.jobs_schedule[COLDSTORAGE_JOB_ID].schedule &&
      config.jobs_schedule[COLDSTORAGE_JOB_ID].schedule.repeat_policy
        ? config.jobs_schedule[COLDSTORAGE_JOB_ID].schedule.repeat_policy
        : 'ALL_SUCCEEDED'
    );
  return metrics;
}

// ─────────────────────────────────────────────────────────────────────────────
// Jianmu: leitura, allowlist e projeção persistente
// ─────────────────────────────────────────────────────────────────────────────

function jianmu_readRoomsSnapshot(dbUrl, secret) {
  var url = dbUrl + JIANMU_ROOMS_PATH + '?auth=' + encodeURIComponent(secret);
  var response = UrlFetchApp.fetch(url, { method: 'GET', muteHttpExceptions: true });
  var code = response.getResponseCode();
  if (code < 200 || code >= 300) throw new Error('Jianmu GET /rooms falhou com HTTP ' + code + '.');
  var raw = response.getContent ? response.getContent() : [];
  var text = response.getContentText('UTF-8');
  var parsed;
  try { parsed = text === 'null' || text === '' ? null : JSON.parse(text); }
  catch (e) { throw new Error('Jianmu /rooms retornou JSON inválido: ' + sanitizeError(e)); }
  if (parsed === null) return { rooms: {}, bytes: raw ? raw.length : 0 };
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Jianmu /rooms retornou uma estrutura diferente do mapa roomId → sala.');
  }
  return { rooms: parsed, bytes: raw ? raw.length : 0 };
}

function jianmu_pickFields(source, allowedFields) {
  var result = {};
  if (!source || typeof source !== 'object' || Array.isArray(source)) return result;
  for (var i = 0; i < allowedFields.length; i++) {
    var key = allowedFields[i];
    if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined) {
      result[key] = coldStorageDeepCopy(source[key]);
    }
  }
  return result;
}

function jianmu_projectContributionMap(source) {
  var result = Object.create(null);
  if (!source || typeof source !== 'object' || Array.isArray(source)) return result;
  var keys = Object.keys(source);
  var allowed = ['kind', 'action', 'playerId', 'playerName', 'playerColor', 'timestamp'];
  for (var i = 0; i < keys.length; i++) {
    var item = source[keys[i]];
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    result[keys[i]] = jianmu_pickFields(item, allowed);
  }
  return result;
}

function jianmu_projectMembers(source) {
  var result = Object.create(null);
  if (!source || typeof source !== 'object' || Array.isArray(source)) return result;
  var keys = Object.keys(source);
  var allowed = ['playerId', 'playerName', 'playerColor', 'joinedAtTimestamp'];
  for (var i = 0; i < keys.length; i++) {
    var member = source[keys[i]];
    if (!member || typeof member !== 'object' || Array.isArray(member)) continue;
    result[keys[i]] = jianmu_pickFields(member, allowed);
  }
  return result;
}

function jianmu_projectInstanceSnapshot(snapshot, fallbackInstanceNumber) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) ||
      !snapshot.meta || typeof snapshot.meta !== 'object' ||
      !snapshot.boardState || typeof snapshot.boardState !== 'object' ||
      !Array.isArray(snapshot.boardState.boardValues)) {
    throw new Error('Snapshot histórico inválido: meta e boardState.boardValues são obrigatórios.');
  }
  var meta = jianmu_pickFields(snapshot.meta, [
    'createdAtTimestamp', 'ownerPlayerId', 'instanceNumber', 'gameMode', 'difficultyLevel',
    'minimumSymbolValue', 'maximumSymbolValue', 'includesZeroValue', 'boardDimension',
    'blockRowCount', 'blockColumnCount', 'symbolValues', 'fixedInitialGrid', 'roomMode', 'realtimeMetrics'
  ]);
  var boardState = jianmu_pickFields(snapshot.boardState, [
    'boardInstanceNumber', 'boardValues', 'pencilNotes', 'elapsedSeconds', 'isCompleted',
    'gameName', 'lastUpdatedByPlayerId', 'updatedAtTimestamp'
  ]);
  var instanceNumber = jianmu_resolveInstanceNumber(meta, boardState, fallbackInstanceNumber);
  if (instanceNumber === 'legacy-unknown') throw new Error('Snapshot histórico sem instanceNumber confiável.');
  var metaInstance = Number(meta.instanceNumber);
  var boardInstance = Number(boardState.boardInstanceNumber);
  var fallbackInstance = Number(fallbackInstanceNumber);
  if (meta.instanceNumber !== undefined && isFinite(metaInstance) &&
      boardState.boardInstanceNumber !== undefined && isFinite(boardInstance) && metaInstance !== boardInstance) {
    throw new Error('Snapshot histórico contém instanceNumber divergente entre meta e boardState.');
  }
  if (fallbackInstanceNumber !== null && fallbackInstanceNumber !== undefined &&
      fallbackInstanceNumber !== '' && isFinite(fallbackInstance) && fallbackInstance !== Number(instanceNumber)) {
    throw new Error('Chave do snapshot histórico diverge do instanceNumber interno.');
  }
  return {
    instanceNumber: instanceNumber,
    meta: meta,
    boardState: boardState,
    settings: jianmu_pickFields(snapshot.settings, ['immediateErrorCheck', 'immediateErrorUpdatedAt', 'immediateErrorUpdatedBy']),
    contributions: jianmu_projectContributionMap(snapshot.contributions),
    archivedAtTimestamp: snapshot.archivedAtTimestamp || null
  };
}

function jianmu_resolveInstanceNumber(meta, boardState, fallback) {
  var candidates = [meta && meta.instanceNumber, boardState && boardState.boardInstanceNumber, fallback];
  for (var i = 0; i < candidates.length; i++) {
    var value = Number(candidates[i]);
    if (candidates[i] !== null && candidates[i] !== undefined && candidates[i] !== '' && isFinite(value) && value >= 0) {
      return String(Math.floor(value));
    }
  }
  return 'legacy-unknown';
}

function jianmu_projectRoomData(roomId, room) {
  if (!room || typeof room !== 'object' || Array.isArray(room) ||
      !room.meta || typeof room.meta !== 'object' ||
      !room.boardState || typeof room.boardState !== 'object' ||
      !Array.isArray(room.boardState.boardValues)) {
    throw new Error('Sala inválida: meta e boardState.boardValues são obrigatórios para o Cold Storage.');
  }
  var meta = jianmu_pickFields(room.meta, [
    'createdAtTimestamp', 'ownerPlayerId', 'instanceNumber', 'gameMode', 'difficultyLevel',
    'minimumSymbolValue', 'maximumSymbolValue', 'includesZeroValue', 'boardDimension',
    'blockRowCount', 'blockColumnCount', 'symbolValues', 'fixedInitialGrid', 'roomMode', 'realtimeMetrics'
  ]);
  // solutionGrid é excluído explicitamente mesmo se aparecer em uma sala legada.
  var boardState = jianmu_pickFields(room.boardState, [
    'boardInstanceNumber', 'boardValues', 'pencilNotes', 'elapsedSeconds', 'isCompleted',
    'gameName', 'lastUpdatedByPlayerId', 'updatedAtTimestamp'
  ]);
  var history = Object.create(null);
  if (room.history && typeof room.history === 'object' && !Array.isArray(room.history)) {
    var historyKeys = Object.keys(room.history);
    for (var h = 0; h < historyKeys.length; h++) {
      var archived = jianmu_projectInstanceSnapshot(room.history[historyKeys[h]], historyKeys[h]);
      if (archived) history[archived.instanceNumber] = archived;
    }
  }
  var currentInstanceNumber = jianmu_resolveInstanceNumber(meta, boardState, null);
  if (currentInstanceNumber === 'legacy-unknown') throw new Error('Sala sem instanceNumber confiável no meta/boardState.');
  var currentMetaInstance = Number(meta.instanceNumber);
  var currentBoardInstance = Number(boardState.boardInstanceNumber);
  if (meta.instanceNumber !== undefined && isFinite(currentMetaInstance) &&
      boardState.boardInstanceNumber !== undefined && isFinite(currentBoardInstance) &&
      currentMetaInstance !== currentBoardInstance) {
    throw new Error('Sala contém instanceNumber divergente entre meta e boardState.');
  }
  var updatedAt = jianmu_getPersistentRoomTimestamp(room);
  return {
    roomId: String(roomId),
    updatedAt: updatedAt || null,
    currentInstanceNumber: currentInstanceNumber,
    meta: meta,
    boardState: boardState,
    settings: jianmu_pickFields(room.settings, ['immediateErrorCheck', 'immediateErrorUpdatedAt', 'immediateErrorUpdatedBy']),
    contributions: jianmu_projectContributionMap(room.contributions),
    members: jianmu_projectMembers(room.members),
    history: history
  };
}

/**
 * Remove do Jianmu somente os snapshots históricos incluídos em uma projeção
 * que já foi confirmada na Yggdrasil. As instâncias L2 não são apagadas.
 * contributionEvents permanece fora da projeção, do hash, do Firestore e desta
 * compactação; o Cold Storage não consome nem remove esses registros do RTDB.
 * A remoção dos snapshots por chave é idempotente e não toca dados correntes.
 *
 * O método trabalha em lotes para evitar uma PATCH excessiva. Se uma chamada
 * falhar após lotes anteriores, a próxima varredura recalcula o hash do estado
 * remanescente e repete a sincronização/compactação de forma segura.
 */
function jianmu_acknowledgeArchivedData(dbUrl, secret, roomId, projection) {
  var operations = [];
  var historyKeys = Object.keys(projection.history || {}).sort();
  for (var h = 0; h < historyKeys.length; h++) {
    operations.push({ path: 'history/' + historyKeys[h], value: null });
  }
  if (!operations.length) return 0;

  var baseUrl = dbUrl + '/rooms/' + encodeURIComponent(String(roomId));
  var batchSize = 400;
  var removed = 0;
  for (var start = 0; start < operations.length; start += batchSize) {
    var patch = Object.create(null);
    for (var j = start; j < Math.min(start + batchSize, operations.length); j++) {
      patch[operations[j].path] = null;
    }
    var response = UrlFetchApp.fetch(baseUrl + '.json?auth=' + encodeURIComponent(secret), {
      method: 'PATCH',
      contentType: 'application/json',
      payload: JSON.stringify(patch),
      muteHttpExceptions: true
    });
    var code = response.getResponseCode();
    if (code < 200 || code >= 300) {
      throw new Error('Jianmu não confirmou a compactação dos snapshots históricos da sala (HTTP ' + code + ').');
    }
    removed += Math.min(batchSize, operations.length - start);
  }
  return removed;
}

function jianmu_getPersistentRoomTimestamp(room) {
  var timestamps = [];
  function add(value) {
    var n = Number(value);
    if (value !== null && value !== undefined && value !== '' && isFinite(n) && n > 0) timestamps.push(n);
  }
  add(room && room.updatedAt);
  add(room && room.meta && room.meta.createdAtTimestamp);
  add(room && room.boardState && room.boardState.updatedAtTimestamp);
  add(room && room.settings && room.settings.immediateErrorUpdatedAt);
  ['members', 'contributions'].forEach(function(key) {
    var group = room && room[key];
    if (!group || typeof group !== 'object') return;
    Object.keys(group).forEach(function(id) { add(group[id] && group[id].joinedAtTimestamp); add(group[id] && group[id].timestamp); });
  });
  return timestamps.length ? Math.max.apply(Math, timestamps) : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonicalização SHA-256: determinística, sem dependência da ordem das chaves
// ─────────────────────────────────────────────────────────────────────────────

function jianmu_canonicalize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!isFinite(value)) throw new Error('Valor numérico não finito na projeção do hash.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    var parts = [];
    for (var i = 0; i < value.length; i++) {
      if (value[i] === undefined) throw new Error('Elemento undefined não permitido em array da projeção.');
      parts.push(jianmu_canonicalize(value[i]));
    }
    return '[' + parts.join(',') + ']';
  }
  if (value && typeof value === 'object') {
    var keys = Object.keys(value).filter(function(key) { return value[key] !== undefined; }).sort();
    var pairs = [];
    for (var j = 0; j < keys.length; j++) {
      pairs.push(JSON.stringify(keys[j]) + ':' + jianmu_canonicalize(value[keys[j]]));
    }
    return '{' + pairs.join(',') + '}';
  }
  throw new Error('Tipo não suportado na canonicalização: ' + typeof value);
}

function jianmu_calculateSha256(canonicalText) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, canonicalText, Utilities.Charset.UTF_8);
  var hex = [];
  for (var i = 0; i < digest.length; i++) hex.push(('0' + ((digest[i] + 256) % 256).toString(16)).slice(-2));
  return 'sha256:' + hex.join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// Eden: checkpoint global e ledger administrativo por sala
// ─────────────────────────────────────────────────────────────────────────────

function eden_fetchJson(dbUrl, secret, path, method, payload) {
  var options = { method: method || 'GET', muteHttpExceptions: true };
  if (payload !== undefined) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(payload);
  }
  var response = UrlFetchApp.fetch(dbUrl + path + '?auth=' + encodeURIComponent(secret), options);
  var code = response.getResponseCode();
  var body = response.getContentText('UTF-8');
  if (code < 200 || code >= 300) throw new Error('Eden/RTDB ' + method + ' falhou com HTTP ' + code + '.');
  if (method === 'GET') {
    if (body === '' || body === 'null') return null;
    try { return JSON.parse(body); }
    catch (e) { throw new Error('Eden/RTDB retornou JSON inválido: ' + sanitizeError(e)); }
  }
  return body;
}

function eden_readColdStorageCheckpoint(dbUrl, secret) {
  var data = eden_fetchJson(dbUrl, secret, EDEN_COLDSTORAGE_CHECKPOINT_PATH, 'GET');
  if (data === null) return { exists: false, timestamp: 0 };
  if (typeof data !== 'object' || Array.isArray(data)) throw new Error('Checkpoint global do Cold Storage possui formato inválido.');
  var timestamp = Number(data.last_backup_timestamp || 0);
  if (!isFinite(timestamp) || timestamp < 0) throw new Error('last_backup_timestamp do checkpoint global é inválido.');
  return { exists: true, timestamp: timestamp };
}

function eden_advanceColdStorageCheckpoint(dbUrl, secret, wakeUpTime) {
  if (!isFinite(Number(wakeUpTime)) || Number(wakeUpTime) <= 0) throw new Error('Checkpoint global inválido.');
  eden_fetchJson(dbUrl, secret, EDEN_COLDSTORAGE_CHECKPOINT_PATH, 'PATCH', { last_backup_timestamp: Number(wakeUpTime) });
}

function eden_readRoomSyncState(dbUrl, secret, roomId) {
  var path = EDEN_ROOM_SYNC_PATH + '/' + encodeURIComponent(String(roomId)) + '.json';
  var data = eden_fetchJson(dbUrl, secret, path, 'GET');
  if (data === null) return null;
  if (typeof data !== 'object' || Array.isArray(data)) throw new Error('Ledger Eden da sala possui formato inválido.');
  return data;
}

function eden_writeRoomSyncState(dbUrl, secret, roomId, marker) {
  var path = EDEN_ROOM_SYNC_PATH + '/' + encodeURIComponent(String(roomId)) + '.json';
  eden_fetchJson(dbUrl, secret, path, 'PUT', marker);
}

// ─────────────────────────────────────────────────────────────────────────────
// Yggdrasil: IDs, serialização Firestore, writes e REST
// ─────────────────────────────────────────────────────────────────────────────

function ygg_validateProjectId(projectId) {
  if (typeof projectId !== 'string' || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) {
    throw new Error('PROJECT_ID ausente ou inválido; informe o ID do projeto Google Cloud/Firestore.');
  }
}

function ygg_encodeDocumentId(value) {
  var text = String(value);
  if (!text.length) throw new Error('ID de documento Firestore vazio.');
  var encoded = 'id_' + Array.prototype.map.call(text, function(ch) {
    return ch.charCodeAt(0).toString(16).padStart(4, '0');
  }).join('');
  if (encoded.length > 1500) throw new Error('ID excede o limite do Firestore após codificação.');
  return encoded;
}

function ygg_decodeDocumentId(encoded) {
  if (typeof encoded !== 'string' || encoded.indexOf('id_') !== 0 || (encoded.length - 3) % 4 !== 0) {
    throw new Error('ID Firestore codificado inválido.');
  }
  var result = '';
  for (var i = 3; i < encoded.length; i += 4) result += String.fromCharCode(parseInt(encoded.slice(i, i + 4), 16));
  return result;
}

function ygg_convertToFirestoreValue(value, depth) {
  depth = depth || 0;
  if (depth > 30) throw new Error('Profundidade máxima excedida na conversão Firestore.');
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    if (!isFinite(value)) throw new Error('Firestore não aceita NaN ou Infinity.');
    if (Number.isInteger(value)) {
      if (!Number.isSafeInteger(value)) throw new Error('Inteiro excede a precisão segura de Number; não é possível serializar sem perda.');
      return { integerValue: String(value) };
    }
    return { doubleValue: value };
  }
  if (Array.isArray(value)) {
    var values = [];
    for (var i = 0; i < value.length; i++) {
      if (value[i] === undefined) throw new Error('undefined não é permitido em arrays Firestore.');
      if (Array.isArray(value[i])) {
        // Firestore não aceita arrayValue diretamente dentro de arrayValue.
        values.push({ mapValue: { fields: {
          __ygg_internal_array_container_v1: { booleanValue: true },
          values: ygg_convertToFirestoreValue(value[i], depth + 1)
        } } });
      } else {
        values.push(ygg_convertToFirestoreValue(value[i], depth + 1));
      }
    }
    return { arrayValue: { values: values } };
  }
  if (value && typeof value === 'object') {
    if (Object.prototype.toString.call(value) === '[object Date]') throw new Error('Date deve ser convertido explicitamente para epoch milliseconds antes do Firestore.');
    var fields = Object.create(null);
    var keys = Object.keys(value);
    for (var j = 0; j < keys.length; j++) {
      if (value[keys[j]] === undefined) continue; // undefined em mapas é omitido deliberadamente.
      fields[keys[j]] = ygg_convertToFirestoreValue(value[keys[j]], depth + 1);
    }
    return { mapValue: { fields: fields } };
  }
  throw new Error('Tipo não suportado pelo Firestore: ' + typeof value);
}

function ygg_decodeFirestoreValue(value) {
  if (!value || typeof value !== 'object') throw new Error('Valor Firestore malformado.');
  if (Object.prototype.hasOwnProperty.call(value, 'nullValue')) return null;
  if (Object.prototype.hasOwnProperty.call(value, 'stringValue')) return value.stringValue;
  if (Object.prototype.hasOwnProperty.call(value, 'booleanValue')) return value.booleanValue;
  if (Object.prototype.hasOwnProperty.call(value, 'integerValue')) {
    var decodedInteger = Number(value.integerValue);
    if (!Number.isSafeInteger(decodedInteger)) throw new Error('integerValue excede a precisão segura de Number na reconstrução.');
    return decodedInteger;
  }
  if (Object.prototype.hasOwnProperty.call(value, 'doubleValue')) return Number(value.doubleValue);
  if (Object.prototype.hasOwnProperty.call(value, 'arrayValue')) {
    var values = value.arrayValue.values || [];
    return values.map(function(item) {
      if (item && item.mapValue && item.mapValue.fields &&
          item.mapValue.fields.__ygg_internal_array_container_v1 &&
          item.mapValue.fields.__ygg_internal_array_container_v1.booleanValue === true) {
        return ygg_decodeFirestoreValue(item.mapValue.fields.values);
      }
      return ygg_decodeFirestoreValue(item);
    });
  }
  if (Object.prototype.hasOwnProperty.call(value, 'mapValue')) {
    var source = value.mapValue.fields || {};
    var result = Object.create(null);
    Object.keys(source).forEach(function(key) { result[key] = ygg_decodeFirestoreValue(source[key]); });
    return result;
  }
  throw new Error('Tipo de valor Firestore desconhecido.');
}

function ygg_firestoreDocumentName(projectId, path) {
  return 'projects/' + encodeURIComponent(projectId) + '/databases/' + YGGDRASIL_DATABASE_ID + '/documents/' + path;
}

function ygg_buildUpdateWrite(documentName, data) {
  var fields = {};
  var fieldPaths = [];
  Object.keys(data).forEach(function(key) {
    if (data[key] === undefined) return;
    fields[key] = ygg_convertToFirestoreValue(data[key]);
    fieldPaths.push(key);
  });
  if (!fieldPaths.length) throw new Error('Write Firestore sem campos.');
  return {
    update: { name: documentName, fields: fields },
    updateMask: { fieldPaths: fieldPaths }
  };
}

function ygg_buildRoomWrites(projectId, projection, roomHash, syncTimestamp) {
  var roomDocId = ygg_encodeDocumentId(projection.roomId);
  var roomPath = YGGDRASIL_COLLECTION_ROOMS + '/' + roomDocId;
  var currentNo = String(projection.currentInstanceNumber || 'legacy-unknown');
  var root = {
    roomId: projection.roomId,
    schemaVersion: YGGDRASIL_SYNC_SCHEMA_VERSION,
    projectionVersion: YGGDRASIL_PROJECTION_VERSION,
    currentInstanceNumber: currentNo,
    sourceUpdatedAt: projection.updatedAt || null,
    lastSyncedHash: roomHash,
    synchronizedAt: syncTimestamp
  };
  var writes = [ygg_buildUpdateWrite(ygg_firestoreDocumentName(projectId, roomPath), root)];
  var currentCollectionPath = roomPath + '/instances/' + ygg_encodeDocumentId(currentNo) + '/contributions';
  var currentContributionDocumentIds = [];
  var instanceMap = Object.create(null);
  var historyKeys = Object.keys(projection.history || {});
  for (var h = 0; h < historyKeys.length; h++) {
    if (String(historyKeys[h]) === currentNo) {
      throw new Error('A instância corrente também aparece em history; a migração não sobrescreverá o snapshot histórico.');
    }
    instanceMap[String(historyKeys[h])] = projection.history[historyKeys[h]];
  }
  instanceMap[currentNo] = {
    instanceNumber: currentNo,
    meta: projection.meta,
    boardState: projection.boardState,
    settings: projection.settings,
    contributions: projection.contributions,
    archivedAtTimestamp: null,
    isCurrent: true
  };

  var instanceNumbers = Object.keys(instanceMap).sort(function(a, b) {
    var an = Number(a), bn = Number(b);
    if (isFinite(an) && isFinite(bn)) return an - bn;
    return a.localeCompare(b);
  });
  for (var i = 0; i < instanceNumbers.length; i++) {
    var instanceNo = String(instanceNumbers[i]);
    var instance = instanceMap[instanceNo];
    var instancePath = roomPath + '/instances/' + ygg_encodeDocumentId(instanceNo);
    var instanceData = {
      roomId: projection.roomId,
      instanceNumber: instanceNo,
      meta: instance.meta || {},
      boardState: instance.boardState || {},
      settings: instance.settings || {},
      archivedAtTimestamp: instance.archivedAtTimestamp || null,
      isCurrent: instanceNo === currentNo
    };
    writes.push(ygg_buildUpdateWrite(ygg_firestoreDocumentName(projectId, instancePath), instanceData));

    var contributionKeys = Object.keys(instance.contributions || {}).sort();
    for (var c = 0; c < contributionKeys.length; c++) {
      var cellKey = contributionKeys[c];
      var contribution = instance.contributions[cellKey];
      var contributionPath = instancePath + '/contributions/' + ygg_encodeDocumentId(cellKey);
      writes.push(ygg_buildUpdateWrite(ygg_firestoreDocumentName(projectId, contributionPath), {
        roomId: projection.roomId,
        instanceNumber: instanceNo,
        cellKey: cellKey,
        contribution: contribution
      }));
      if (instanceNo === currentNo) currentContributionDocumentIds.push(ygg_encodeDocumentId(cellKey));
    }
  }

  var memberKeys = Object.keys(projection.members || {}).sort();
  for (var m = 0; m < memberKeys.length; m++) {
    var playerId = memberKeys[m];
    var memberPath = roomPath + '/members/' + ygg_encodeDocumentId(playerId);
    writes.push(ygg_buildUpdateWrite(ygg_firestoreDocumentName(projectId, memberPath), {
      roomId: projection.roomId,
      playerId: playerId,
      member: projection.members[playerId]
    }));
  }

  return {
    writes: writes,
    currentContributionCollectionPath: currentCollectionPath,
    currentContributionDocumentIds: currentContributionDocumentIds
  };
}

function ygg_listDocuments(projectId, collectionPath) {
  var token = ScriptApp.getOAuthToken();
  if (!token) throw new Error('OAuth token indisponível para listar documentos Firestore.');
  var results = [];
  var pageToken = '';
  do {
    var url = 'https://firestore.googleapis.com/v1/' + ygg_firestoreDocumentName(projectId, collectionPath) +
      '?pageSize=' + YGGDRASIL_MAX_LIST_PAGE_SIZE + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
    var response = UrlFetchApp.fetch(url, {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });
    var code = response.getResponseCode();
    var body = response.getContentText('UTF-8');
    if (code < 200 || code >= 300) throw new Error('Firestore listDocuments falhou com HTTP ' + code + '.');
    var parsed;
    try { parsed = body ? JSON.parse(body) : {}; }
    catch (e) { throw new Error('Firestore listDocuments retornou JSON inválido: ' + sanitizeError(e)); }
    if (parsed.documents && Array.isArray(parsed.documents)) results = results.concat(parsed.documents);
    pageToken = parsed.nextPageToken || '';
  } while (pageToken);
  return results;
}

function ygg_listCurrentContributionDocuments(projectId, collectionPath) {
  var docs = ygg_listDocuments(projectId, collectionPath);
  return docs.map(function(doc) {
    if (!doc || typeof doc.name !== 'string') throw new Error('Firestore listDocuments retornou documento sem name.');
    return doc.name;
  });
}

function ygg_buildStaleContributionDeletes(collectionPath, existingDocumentNames, desiredIds) {
  var desired = Object.create(null);
  desiredIds.forEach(function(id) { desired[id] = true; });
  var deletes = [];
  for (var i = 0; i < existingDocumentNames.length; i++) {
    var name = existingDocumentNames[i];
    var id = name.slice(name.lastIndexOf('/') + 1);
    if (!desired[id]) deletes.push({ delete: name });
  }
  return deletes;
}

function ygg_utf8ByteLength(text) {
  return Utilities.newBlob(String(text), 'text/plain; charset=UTF-8').getBytes().length;
}

function ygg_validateRoomWritePlan(writes) {
  if (!Array.isArray(writes) || !writes.length) throw new Error('Plano de gravação Firestore vazio.');
  if (writes.length > YGGDRASIL_MAX_WRITES_PER_COMMIT) {
    throw new Error('Sala excede o limite operacional de writes por commit (' + writes.length + '/' + YGGDRASIL_MAX_WRITES_PER_COMMIT + ').');
  }
  for (var i = 0; i < writes.length; i++) {
    if (!writes[i].update) continue;
    var bytes = ygg_utf8ByteLength(JSON.stringify(writes[i].update.fields));
    if (bytes > YGGDRASIL_MAX_DOCUMENT_BYTES) {
      throw new Error('Documento Firestore excede o limite operacional de tamanho (' + bytes + ' bytes).');
    }
  }
  var requestBytes = ygg_utf8ByteLength(JSON.stringify({ writes: writes }));
  if (requestBytes > YGGDRASIL_MAX_COMMIT_BYTES) {
    throw new Error('Commit Firestore excede o limite operacional de tamanho (' + requestBytes + ' bytes).');
  }
}

function ygg_commitRoom(projectId, writes) {
  ygg_validateProjectId(projectId);
  ygg_validateRoomWritePlan(writes);
  var token = ScriptApp.getOAuthToken();
  if (!token) throw new Error('OAuth token indisponível para gravar no Firestore.');
  var url = 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(projectId) +
    '/databases/' + YGGDRASIL_DATABASE_ID + '/documents:commit';
  var payload = JSON.stringify({ writes: writes });
  var response = UrlFetchApp.fetch(url, {
    method: 'POST',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: payload,
    muteHttpExceptions: true
  });
  var code = response.getResponseCode();
  var body = response.getContentText('UTF-8');
  if (code < 200 || code >= 300) {
    var detail = '';
    try {
      var errorBody = JSON.parse(body);
      detail = errorBody.error && errorBody.error.message ? String(errorBody.error.message).slice(0, 500) : '';
    } catch (_) {}
    throw new Error('Firestore documents:commit falhou com HTTP ' + code + (detail ? ': ' + detail : '.') );
  }
  var result;
  try { result = JSON.parse(body); }
  catch (e) { throw new Error('Firestore commit retornou resposta JSON inválida.'); }
  if (!result || !Array.isArray(result.writeResults) || result.writeResults.length !== writes.length) {
    throw new Error('Firestore commit não confirmou todos os writes (' + (result && result.writeResults ? result.writeResults.length : 0) + '/' + writes.length + ').');
  }
  return ygg_utf8ByteLength(payload);
}

function runColdStorageDriveLegacyCore(props, config, butIgnoreRules, wakeUpTime, runId, invocation) {
  var metrics = buildBaseMetrics(COLDSTORAGE_JOB_ID, { invocation: invocation, runId: runId });
  var activationLabel = formatInvocationLabel(invocation);
  metrics.action = 'BACKUP';
  metrics.target = '';

  var dbUrl = normalizeFirebaseUrl(props.getProperty('FIREBASE_URL'));
  var secret = props.getProperty('FIREBASE_SECRET');
  var folderId = props.getProperty('DRIVE_FOLDER_ID');
  var timezone = (config && config.system && config.system.timezone) || 'America/Sao_Paulo';

  if (!dbUrl || !secret || !folderId) {
    throw new Error('Script Properties obrigatórias ausentes: FIREBASE_URL, FIREBASE_SECRET ou DRIVE_FOLDER_ID.');
  }

  // ── 3.1 Ler last_backup_timestamp do Firebase ─────────────────────────
  var lastBackupTimestamp = readLastBackupTimestamp(dbUrl, secret);

  // ── 3.2 Ler /rooms.json (NUNCA /.json) ────────────────────────────────
  var roomsResponse = UrlFetchApp.fetch(
    dbUrl + COLDSTORAGE_ROOMS_PATH + '?auth=' + secret,
    { method: 'GET', muteHttpExceptions: true }
  );
  var roomsHttpCode = roomsResponse.getResponseCode();
  if (roomsHttpCode < 200 || roomsHttpCode >= 300) {
    throw new Error('Firebase GET /rooms falhou com HTTP ' + roomsHttpCode + '.');
  }

  // bytesDownloaded: conteúdo binário real, não length da string
  var roomsRawContent = roomsResponse.getContent();
  metrics.bytesDownloaded = roomsRawContent ? roomsRawContent.length : 0;

  var roomsText = roomsResponse.getContentText('UTF-8');
  var allRooms = JSON.parse(roomsText);

  if (!allRooms || typeof allRooms !== 'object') {
    metrics.status = 'SKIPPED';
    metrics.completedSuccessfully = true;
    advanceWatermark(dbUrl, secret, wakeUpTime);
    metrics.notes = activationLabel + '\nBanco de dados rooms vazio. Watermark avançado para ' + wakeUpTime + '.';
    return metrics;
  }

  // ── 3.3 Filtrar salas elegíveis por updatedAt ─────────────────────────
  var filterResult = filterEligibleRooms(allRooms, lastBackupTimestamp, wakeUpTime);
  var eligibleRooms = filterResult.eligible;
  var legacyRoomIds = filterResult.legacyRoomIds;
  var legacyCount = filterResult.legacyCount;
  var futureCount = filterResult.futureCount;
  var totalRooms = filterResult.totalRooms;

  if (Object.keys(eligibleRooms).length === 0) {
    metrics.status = 'SKIPPED';
    metrics.itemsProcessed = 0;
    metrics.completedSuccessfully = true;
    advanceWatermark(dbUrl, secret, wakeUpTime);
    metrics.notes = activationLabel +
      '\nNenhuma sala elegível nesta janela (last=' + lastBackupTimestamp +
      ', wakeUp=' + wakeUpTime + ').' +
      '\nTotal de salas: ' + totalRooms +
      ' | Legadas: ' + legacyCount +
      ' | Futuras adiadas: ' + futureCount +
      '\nWatermark avançado.';
    return metrics;
  }

  // ── 3.4 Aplicar filtro de caminhos (.butIgnore) — sobre cópia ────────
  var roomsCopy = coldStorageDeepCopy(eligibleRooms);
  var nodesIgnored = applyButIgnoreFilter(roomsCopy, butIgnoreRules);

  // ── 3.5 Serializar envelope versionado ───────────────────────────────
  var payload = {
    schemaVersion: COLDSTORAGE_SCHEMA_VERSION,
    jobId: COLDSTORAGE_JOB_ID,
    runId: runId,
    generatedAt: new Date().toISOString(),
    sourcePath: '/rooms',
    watermark: {
      from: lastBackupTimestamp,
      through: wakeUpTime
    },
    summary: {
      roomsArchived: Object.keys(eligibleRooms).length,
      legacyRooms: legacyCount,
      legacyRoomsWatermarked: 0, // atualizado após o PATCH retroativo
      futureDatedRoomsDeferred: futureCount,
      nodesIgnored: nodesIgnored
    },
    rooms: roomsCopy
  };

  // ── 3.6 Serializar e persistir no Drive com UTF-8 explícito ──────────
  // Usa Utilities.newBlob com charset 'UTF-8' para garantir que caracteres
  // não-ASCII (acentos, emojis, ideogramas) sejam preservados exatamente
  // como estão no Firebase, independente do ambiente de execução do GAS.
  // MimeType.PLAIN_TEXT sem charset explícito pode variar entre versões do runtime.
  var payloadStr = JSON.stringify(payload);
  var filename = generateColdStorageFilename(timezone, runId);
  var folder = DriveApp.getFolderById(folderId);
  var blob = Utilities.newBlob(payloadStr, 'text/plain; charset=UTF-8', filename);
  var createdFile = folder.createFile(blob);
  // bytesSaved: tamanho real do arquivo persistido
  var bytesSaved = createdFile.getSize();

  metrics.itemsProcessed = Object.keys(eligibleRooms).length;
  metrics.bytesSaved = bytesSaved;
  metrics.target = filename;

  // ── 3.7 Avançar watermark SOMENTE após confirmação de persistência ────
  advanceWatermark(dbUrl, secret, wakeUpTime);

  // ── 3.8 Estampar watermark retroativo nas salas legacy ────────────────
  // Após confirmar que o backup foi persistido (3.6) e o watermark avançou
  // (3.7), escreve updatedAt nas salas que nunca tiveram esse campo.
  // O valor usado é (wakeUpTime - 1) para que nos próximos ciclos essas salas
  // caiam na condição "updatedAt < lastBackupTimestamp" e sejam excluídas,
  // eliminando o rearquivamento redundante sem alterar dados de gameplay.
  var legacyWatermarked = 0;
  if (legacyRoomIds.length > 0) {
    legacyWatermarked = stampLegacyWatermarks(dbUrl, secret, legacyRoomIds, wakeUpTime - 1);
  }

  // Atualizar o summary com o resultado real do PATCH retroativo
  payload.summary.legacyRoomsWatermarked = legacyWatermarked;

  metrics.status = 'SUCCESS';
  metrics.completedSuccessfully = true;
  metrics.notes = activationLabel +
    '\nJanela: [' + lastBackupTimestamp + ', ' + wakeUpTime + ')' +
    '\nSalas arquivadas: ' + metrics.itemsProcessed +
    ' | Legadas: ' + legacyCount +
    ' | Watermark retroativo aplicado: ' + legacyWatermarked +
    ' | Futuras adiadas: ' + futureCount +
    ' | Nós ignorados: ' + nodesIgnored +
    '\nArquivo: ' + filename +
    '\nPolítica de repetição efetiva: ' + (
      config && config.jobs_schedule &&
      config.jobs_schedule[COLDSTORAGE_JOB_ID] &&
      config.jobs_schedule[COLDSTORAGE_JOB_ID].schedule &&
      config.jobs_schedule[COLDSTORAGE_JOB_ID].schedule.repeat_policy
        ? config.jobs_schedule[COLDSTORAGE_JOB_ID].schedule.repeat_policy
        : 'ALL_SUCCEEDED'
    );

  return metrics;
}

// ─────────────────────────────────────────────────────────────────────────────
// Filtragem de salas elegíveis
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Filtra as salas que devem entrar no backup desta janela.
 *
 * Salas legacy (updatedAt ausente/nulo/0 na raiz da sala) são incluídas e
 * retornadas também em `legacyRoomIds` para que o chamador possa estampar
 * o watermark nelas após confirmar a persistência, evitando rearquivamento
 * redundante nos ciclos seguintes.
 *
 * @param {Object} allRooms             — mapa roomId → objeto sala do Firebase
 * @param {number} lastBackupTimestamp  — marca d'água do último ciclo (epoch ms)
 * @param {number} wakeUpTime           — início deste ciclo (epoch ms)
 * @returns {{
 *   eligible: Object,
 *   legacyRoomIds: string[],
 *   legacyCount: number,
 *   futureCount: number,
 *   totalRooms: number
 * }}
 */
function filterEligibleRooms(allRooms, lastBackupTimestamp, wakeUpTime) {
  var eligible = {};
  var legacyRoomIds = [];
  var legacyCount = 0;
  var futureCount = 0;
  var totalRooms = 0;

  var roomIds = Object.keys(allRooms);
  for (var i = 0; i < roomIds.length; i++) {
    var roomId = roomIds[i];
    var room = allRooms[roomId];
    totalRooms++;

    if (!room || typeof room !== 'object') continue;

    var updatedAt = room.updatedAt;

    // Salas legadas: updatedAt ausente, null, undefined ou numericamente 0.
    // São incluídas no backup e marcadas para receber o watermark retroativo
    // após a persistência, eliminando rearquivamentos redundantes futuros.
    if (updatedAt === null || updatedAt === undefined || updatedAt === 0) {
      eligible[roomId] = room;
      legacyRoomIds.push(roomId);
      legacyCount++;
      continue;
    }

    // Valores não numéricos: conservador — inclui como legado com aviso.
    if (typeof updatedAt !== 'number' || !isFinite(updatedAt)) {
      console.warn('Sala ' + roomId + ' tem updatedAt não numérico (' + String(updatedAt) + '); tratada como legada.');
      eligible[roomId] = room;
      legacyRoomIds.push(roomId);
      legacyCount++;
      continue;
    }

    // Salas futuras: updatedAt >= wakeUpTime — adiadas para o próximo ciclo.
    if (updatedAt >= wakeUpTime) {
      futureCount++;
      continue;
    }

    // Salas anteriores ao watermark (exceto legadas): já cobertas por ciclo anterior.
    if (updatedAt < lastBackupTimestamp) {
      continue;
    }

    // Janela elegível: updatedAt >= lastBackupTimestamp && < wakeUpTime.
    eligible[roomId] = room;
  }

  return {
    eligible: eligible,
    legacyRoomIds: legacyRoomIds,
    legacyCount: legacyCount,
    futureCount: futureCount,
    totalRooms: totalRooms
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Filtro de caminhos via regras .butIgnore
// ─────────────────────────────────────────────────────────────────────────────

function applyButIgnoreFilter(roomsObj, rules) {
  if (!rules || !rules.length) return 0;
  // O objeto recebido é a subárvore extraída de /rooms.json; suas chaves de
  // primeiro nível são os roomIds (ex: "SALA_01"). As regras do .butIgnore usam
  // caminhos Firebase completos (ex: rooms/*/moves), portanto iniciamos a
  // traversal com 'rooms' para que o caminho composto seja 'rooms/SALA_01/moves'
  // e case corretamente com a regex compilada.
  return filterObjectByRules(roomsObj, 'rooms', rules);
}

function filterObjectByRules(obj, currentPath, rules) {
  if (typeof obj !== 'object' || obj === null) return 0;
  var ignoredCount = 0;
  var keys = Object.keys(obj);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
    var nodePath = currentPath ? currentPath + '/' + key : key;
    var shouldIgnore = false;
    for (var j = 0; j < rules.length; j++) {
      if (rules[j].test(nodePath)) {
        shouldIgnore = true;
        break;
      }
    }
    if (shouldIgnore) {
      delete obj[key];
      ignoredCount++;
    } else {
      ignoredCount += filterObjectByRules(obj[key], nodePath, rules);
    }
  }
  return ignoredCount;
}

// ─────────────────────────────────────────────────────────────────────────────
// Parser .butIgnore com suporte a seções INI
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Carrega e compila as regras do .butIgnore como RegExp[].
 *
 * Estratégia de fonte da verdade com fallback (igual à loadAndValidateConfig):
 *   1. Tenta ler do Firebase Realtime Database (server_config/but_ignore.json)
 *      — fonte da verdade.
 *   2. Em caso de falha ou nó inexistente, cai para o GitHub Raw
 *      (Script Property GITHUB_BUTIGNORE_URL) como repositório padrão.
 *   3. Se usou o fallback, reescreve (seed) o nó no Firebase (auto-seed).
 *   4. Tudo é memoizado em CacheService (TTL de BUTIGNORE_CACHE_TTL_MS).
 *
 * NÃO recebe mais a URL por parâmetro — lê todas as fontes das Script Properties.
 * Embute a flag _usedFallback no array retornado (arrays são objetos em JS; a
 * iteração nas regras permanece inalterada para todos os consumidores).
 * NUNCA usa regras vazias como fallback silencioso.
 *
 * @param {string} sectionId Seção a carregar além das globais
 * @returns {RegExp[]} regras compiladas (com _usedFallback anexado se aplicável)
 */
function loadAndParseButIgnore(sectionId) {
  var cache = CacheService.getScriptCache();
  var props = PropertiesService.getScriptProperties();
  var cacheKey = BUTIGNORE_CACHE_KEY + '_' + (sectionId || 'global');

  // Tenta ler do cache primeiro
  var cachedText = null;
  try { cachedText = cache.get(cacheKey + '_raw'); } catch (_) {}

  if (cachedText) {
    return parseButIgnoreText(cachedText, sectionId);
  }

  var dbUrl = normalizeFirebaseUrl(props.getProperty('FIREBASE_URL'));
  var secret = props.getProperty('FIREBASE_SECRET');
  var fallbackUrl = props.getProperty('GITHUB_BUTIGNORE_URL');

  var butIgnoreText = null;
  var usedFallback = false;

  // 1. TENTA LER DO FIREBASE PRIMEIRO (Fonte da Verdade)
  if (dbUrl && secret) {
    try {
      var fbResp = UrlFetchApp.fetch(
        dbUrl + '/server_config/but_ignore.json?auth=' + secret,
        { muteHttpExceptions: true }
      );
      if (fbResp.getResponseCode() === 200) {
        var fbData = fbResp.getContentText('UTF-8');
        // Firebase retorna "null" em string se o nó não existir
        if (fbData && fbData !== "null") {
          // O nó guarda o .butIgnore como string JSON (é texto INI, não um objeto
          // JSON como o jobs-orchestrator). O round-trip é feito via JSON.
          var parsed = JSON.parse(fbData);
          if (typeof parsed === 'string') butIgnoreText = parsed;
        }
      }
    } catch (e) {
      console.warn('Falha ao ler .butIgnore do Firebase:', sanitizeError(e));
    }
  }

  // 2. FALLBACK PARA O GITHUB
  if (!butIgnoreText && fallbackUrl) {
    try {
      var ghResp = UrlFetchApp.fetch(fallbackUrl, { muteHttpExceptions: true });
      if (ghResp.getResponseCode() === 200) {
        butIgnoreText = ghResp.getContentText('UTF-8');
        usedFallback = true;
      }
    } catch (e) {
      console.warn('Falha ao ler .butIgnore do GitHub:', sanitizeError(e));
    }
  }

  if (!butIgnoreText) {
    // Sem fonte válida: aborta — falha segura (nunca roda backup sem filtros)
    throw new Error(
      'Não foi possível obter .butIgnore (Firebase e GitHub falharam). ' +
      'Backup abortado para não executar sem filtros de exclusão.'
    );
  }

  // 3. SE USOU O FALLBACK, SEMEAR O FIREBASE PARA EVITAR NOVA FALHA
  if (usedFallback && dbUrl && secret) {
    try {
      UrlFetchApp.fetch(
        dbUrl + '/server_config/but_ignore.json?auth=' + secret,
        {
          method: 'PUT',
          contentType: 'application/json',
          payload: JSON.stringify(butIgnoreText),
          muteHttpExceptions: true
        }
      );
      console.warn('Aviso: Regras butIgnore restauradas do repositório padrão (Fallback).');
    } catch (e) {
      console.warn('Falha ao reescrever .butIgnore no Firebase:', sanitizeError(e));
    }
  }

  // Grava no cache e compila as regras
  try { cache.put(cacheKey + '_raw', butIgnoreText, Math.floor(BUTIGNORE_CACHE_TTL_MS / 1000)); } catch (_) {}

  var rules = parseButIgnoreText(butIgnoreText, sectionId);

  // Embute a flag no array para que o chamador (runMasterCore) saiba que rolou
  // um fallback e adicione aos notes. Arrays são objetos: a propriedade não
  // interfere na iteração das regras pelos consumidores (applyButIgnoreFilter etc.).
  if (usedFallback) {
    rules._usedFallback = true;
  }

  return rules;
}

/**
 * Analisa o texto do .butIgnore com suporte a seções INI.
 * Regras fora de seção são globais. Regras em [sectionId] são aplicadas ao job.
 */
function parseButIgnoreText(text, sectionId) {
  var lines = text.split('\n');
  var globalRules = [];
  var sectionRules = [];
  var currentSection = null;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line || line.charAt(0) === '#') continue;
    if (line.charAt(0) === '[' && line.charAt(line.length - 1) === ']') {
      currentSection = line.slice(1, -1).trim();
      continue;
    }
    if (currentSection === null) {
      globalRules.push(line);
    } else if (sectionId && currentSection === sectionId) {
      sectionRules.push(line);
    }
  }

  var allRuleStrings = globalRules.concat(sectionRules);
  return allRuleStrings.map(function(rule) {
    return compileButIgnoreRule(rule);
  });
}

/**
 * Compila uma regra de caminho em RegExp.
 * '*' representa exatamente um segmento (não percorre múltiplos níveis).
 */
function compileButIgnoreRule(rule) {
  // Escapa todos os chars especiais de regex (exceto '*')
  var escaped = rule.replace(/([.+^${}()|[\]\\])/g, '\\$1');
  // Substitui '*' por um segmento sem '/'
  var regexStr = '^' + escaped.replace(/\*/g, '[^/]+') + '(/.*)?$';
  return new RegExp(regexStr);
}

// ─────────────────────────────────────────────────────────────────────────────
// Watermark e metadados do Firebase
// ─────────────────────────────────────────────────────────────────────────────

function readLastBackupTimestamp(dbUrl, secret) {
  try {
    var resp = UrlFetchApp.fetch(
      dbUrl + SERVER_META_COLDSTORAGE_PATH + '?auth=' + secret,
      { method: 'GET', muteHttpExceptions: true }
    );
    if (resp.getResponseCode() !== 200) return 0;
    var data = JSON.parse(resp.getContentText('UTF-8'));
    if (!data || typeof data !== 'object') return 0;
    var ts = Number(data.last_backup_timestamp);
    return isFinite(ts) && ts > 0 ? ts : 0;
  } catch (e) {
    console.warn('Falha ao ler last_backup_timestamp; assumindo primeira execução:', sanitizeError(e));
    return 0;
  }
}

function advanceWatermark(dbUrl, secret, wakeUpTime) {
  try {
    UrlFetchApp.fetch(
      dbUrl + SERVER_META_COLDSTORAGE_PATH + '?auth=' + secret,
      {
        method: 'PATCH',
        contentType: 'application/json',
        payload: JSON.stringify({ last_backup_timestamp: wakeUpTime }),
        muteHttpExceptions: true
      }
    );
  } catch (e) {
    console.error('Falha ao avançar watermark:', sanitizeError(e));
    throw e; // relança para que o chamador saiba que o checkpoint falhou
  }
}

/**
 * Estampa retroativamente `updatedAt` nas salas legacy que nunca tiveram esse
 * campo, usando um PATCH individual por sala em /rooms/{roomId}/updatedAt.
 *
 * O valor gravado é (retroactiveMark) — tipicamente wakeUpTime - 1 —
 * que fica abaixo do watermark atual, excluindo essas salas de ciclos futuros
 * sem interferir com dados de gameplay (updatedAt é a marca d'água do cold
 * storage na raiz da sala, não é lido pelo frontend para lógica de jogo).
 *
 * Estratégia de falha: falhas individuais são logadas mas não interrompem o
 * loop — o chamador recebe a contagem de PATCHes bem-sucedidos. Uma sala que
 * falhou continuará sendo rearquivada no próximo ciclo (comportamento seguro).
 *
 * @param {string}   dbUrl            — URL base do Firebase (sem barra final)
 * @param {string}   secret           — credencial REST do Firebase
 * @param {string[]} legacyRoomIds    — IDs das salas a receber o watermark
 * @param {number}   retroactiveMark  — valor epoch ms a gravar (wakeUpTime - 1)
 * @returns {number} quantidade de salas efetivamente marcadas
 */
function stampLegacyWatermarks(dbUrl, secret, legacyRoomIds, retroactiveMark) {
  var successCount = 0;
  for (var i = 0; i < legacyRoomIds.length; i++) {
    var roomId = legacyRoomIds[i];
    try {
      var resp = UrlFetchApp.fetch(
        dbUrl + '/rooms/' + encodeURIComponent(roomId) + '/updatedAt.json?auth=' + secret,
        {
          method: 'PUT',
          contentType: 'application/json',
          payload: JSON.stringify(retroactiveMark),
          muteHttpExceptions: true
        }
      );
      var code = resp.getResponseCode();
      if (code >= 200 && code < 300) {
        successCount++;
      } else {
        console.warn(
          'stampLegacyWatermarks: PATCH de sala "' + roomId +
          '" retornou HTTP ' + code + '. Será rearquivada no próximo ciclo.'
        );
      }
    } catch (e) {
      console.warn(
        'stampLegacyWatermarks: falha de rede ao marcar sala "' + roomId +
        '": ' + sanitizeError(e) + '. Será rearquivada no próximo ciclo.'
      );
    }
  }
  console.log(
    'stampLegacyWatermarks: ' + successCount + '/' + legacyRoomIds.length +
    ' salas marcadas com updatedAt=' + retroactiveMark + '.'
  );
  return successCount;
}

function persistColdStorageMeta(props, metrics, invocation) {
  var dbUrl = normalizeFirebaseUrl(props.getProperty('FIREBASE_URL'));
  var secret = props.getProperty('FIREBASE_SECRET');
  if (!dbUrl || !secret) return;

  var now = Date.now();
  var patch = {
    last_completed_at: now,
    last_attempt_at: now,
    last_invocation: invocation,
    last_run_id: metrics.runId,
    last_file: metrics.target || null
  };

  if (metrics.completedSuccessfully) {
    patch.last_success_at = now;
  }
  if (invocation === 'SCHEDULED_MASTER') {
    patch.last_scheduled_at = now;
    if (metrics.completedSuccessfully) {
      patch.last_scheduled_success_at = now;
    }
  }

  try {
    var response = UrlFetchApp.fetch(
      dbUrl + SERVER_META_COLDSTORAGE_PATH + '?auth=' + encodeURIComponent(secret),
      {
        method: 'PATCH',
        contentType: 'application/json',
        payload: JSON.stringify(patch),
        muteHttpExceptions: true
      }
    );
    var responseCode = response.getResponseCode();
    if (responseCode < 200 || responseCode >= 300) {
      console.error('Falha HTTP ao persistir metadados do Cold Storage: HTTP ' + responseCode + '.');
    }
  } catch (e) {
    console.error('Falha ao persistir metadados do Cold Storage:', sanitizeError(e));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Telemetria — Google Sheets (usada também pelo Master via escopo global)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Grava uma ou mais linhas na planilha de telemetria (append-only).
 * NUNCA edita, sobrescreve, reordena ou limpa linhas já gravadas.
 *
 * @param {Object} props   Script Properties
 * @param {Object} config  configuração validada (pode ser null em fallback)
 * @param {Array}  rows    array de JobMetrics
 */
function appendTelemetryRow(props, config, rows) {
  var timezone = (config && config.system && config.system.timezone) || 'America/Sao_Paulo';
  var spreadsheetName = (config && config.telemetry && config.telemetry.spreadsheet_name) ||
    'Sudoku Aneróthico PRÓ - Jobs Telemetry';
  var sheetName = (config && config.telemetry && config.telemetry.sheet_name) || 'JobsTelemetry';

  // Resolve a planilha de telemetria com fallback em camadas:
  //   Properties LOG_SHEET_ID → CacheService → Firebase (ground of truth) → provisiona nova.
  //   "NULL"  = comando humano forçando planilha nova (arquivar a velha / novo ciclo).
  //   ausente = máquina: recupera a última usada; só cria nova como last resort.
  var ss = resolveTelemetrySpreadsheet(props, spreadsheetName, sheetName);

  var sheet = getOrCreateSheet(ss, sheetName);
  validateOrInitSheetHeader(sheet);

  var sheetLock = LockService.getScriptLock();
  sheetLock.waitLock(15000);
  try {
    var nextRow = sheet.getLastRow() + 1;
    var values = rows.map(function(metrics) {
      return metricsToRow(metrics, timezone, config);
    });
    sheet.getRange(nextRow, 1, values.length, TELEMETRY_HEADERS.length).setValues(values);

    // Formatar em lote
    for (var i = 0; i < rows.length; i++) {
      applyRowFormatting(sheet, nextRow + i, rows[i], config);
    }

    // Freeze primeira linha
    try {
      if (sheet.getFrozenRows() < 1) sheet.setFrozenRows(1);
    } catch (_) {}

    // Bracket de ciclo: borda superior do Master + borda inferior do último job
    // do batch, com identidade separada (border_top e cycle_end_border).
    // Só aplica quando o primeiro row é o Master (flush orquestrado). Configurável
    // no JSON/Firebase — sem bordas chumbadas no código. A borda inferior por-job
    // (separador claro) é aplicada por applyRowFormatting; este bracket prevalece
    // sobre o fundo do último row do batch para fechar o ciclo visualmente.
    try {
      var firstIsMaster = (
        rows.length > 0 &&
        rows[0].jobId === MASTER_JOB_ID
      );

      var masterStyle = (
        config &&
        config.visual_theme &&
        config.visual_theme.job_styles
      )
        ? config.visual_theme.job_styles[MASTER_JOB_ID]
        : null;

      if (firstIsMaster && masterStyle) {

        // ── INÍCIO DO CICLO: borda superior do Master ────────────────

        var startBorder = masterStyle.border_top || null;

        if (startBorder) {
          var startColor = startBorder.color || null;

          var startStyle = startBorder.style
            ? SpreadsheetApp.BorderStyle[startBorder.style]
            : null;

          sheet.getRange(nextRow, 1, 1, TELEMETRY_HEADERS.length)
            .setBorder(
              true, null, null, null, null, null,
              startColor, startStyle
            );
        }

        // ── FIM DO CICLO: borda inferior do último job ──────────────

        // Compatibilidade: se cycle_end_border não existir,
        // reutiliza border_top como no comportamento anterior.

        var endBorder = (
          masterStyle.cycle_end_border ||
          masterStyle.border_top ||
          null
        );

        if (endBorder) {
          var endColor = endBorder.color || null;

          var endStyle = endBorder.style
            ? SpreadsheetApp.BorderStyle[endBorder.style]
            : null;

          sheet.getRange(
            nextRow + rows.length - 1,
            1,
            1,
            TELEMETRY_HEADERS.length
          ).setBorder(
            null, null, true, null, null, null,
            endColor, endStyle
          );
        }
      }

    } catch (e) {
      console.warn(
        'Falha ao aplicar bordas de ciclo:',
        sanitizeError(e)
      );
    }
  } finally {
    sheetLock.releaseLock();
  }
}

function provisionNewSpreadsheet(props, spreadsheetName, sheetName) {
  var ss = SpreadsheetApp.create(spreadsheetName);
  var newId = ss.getId();
  // Persistir o ID IMEDIATAMENTE antes de qualquer outra operação
  props.setProperty('LOG_SHEET_ID', newId);
  // Registra o novo ID nas fontes de fallback (Cache + Firebase ground of truth),
  // para que futuras execuções (mesmo sem o Properties) encontrem esta planilha.
  recordLogSheetIdFallbackSources(props, newId);

  var folderIdProp = props.getProperty('LOG_SHEET_FOLDER_ID');
  if (folderIdProp && folderIdProp.trim() && folderIdProp.trim().toUpperCase() !== 'NULL') {
    try {
      var folder = DriveApp.getFolderById(folderIdProp.trim());
      var file = DriveApp.getFileById(newId);
      folder.addFile(file);
      DriveApp.getRootFolder().removeFile(file);
    } catch (e) {
      console.warn('Não foi possível mover a planilha para LOG_SHEET_FOLDER_ID:', sanitizeError(e));
    }
  }

  var firstSheet = ss.getSheets()[0];
  firstSheet.setName(sheetName);
  initSheetHeader(firstSheet);
  return ss;
}

/**
 * Resolve a planilha de telemetria com fallback em camadas:
 *   Properties LOG_SHEET_ID → CacheService → Firebase (ground of truth) → provisiona nova.
 *   "NULL"  = comando humano forçando planilha nova (arquivar a velha / novo ciclo).
 *   ausente = máquina: recupera a última usada; só cria nova como last resort.
 */
function resolveTelemetrySpreadsheet(props, spreadsheetName, sheetName) {
  var sheetId = props.getProperty('LOG_SHEET_ID');

  // (1) "NULL" explícito = comando humano forçando planilha nova do zero
  if (sheetId && sheetId.trim().toUpperCase() === 'NULL') {
    return provisionNewSpreadsheet(props, spreadsheetName, sheetName);
  }

  // (2) ID real no Properties → tenta abrir
  if (sheetId && sheetId.trim() !== '') {
    try {
      return SpreadsheetApp.openById(sheetId.trim());
    } catch (e) {
      console.warn('LOG_SHEET_ID do Properties inacessível (' + sanitizeError(e) + '); tentando recuperar via fallback.');
    }
  }

  // (3) Properties ausente/vazio (ou ID que não abriu) → CacheService → Firebase
  var cache = CacheService.getScriptCache();
  var recoveredId = null;
  try { recoveredId = cache.get(LOG_SHEET_ID_CACHE_KEY); } catch (_) {}

  if (!recoveredId) {
    // Cache miss → Firebase (ground of truth). Payload microscópico: só a string do ID.
    recoveredId = readLogSheetIdFromFirebase(props);
    if (recoveredId) {
      try { cache.put(LOG_SHEET_ID_CACHE_KEY, recoveredId, Math.floor(LOG_SHEET_ID_CACHE_TTL_MS / 1000)); } catch (_) {}
    }
  }

  if (recoveredId) {
    try {
      var ss = SpreadsheetApp.openById(recoveredId);
      // Re-hidrata o Properties: próximas execuções usam o Properties direto, sem rede.
      try { props.setProperty('LOG_SHEET_ID', recoveredId); } catch (_) {}
      return ss;
    } catch (e) {
      console.warn('LOG_SHEET_ID recuperado (' + recoveredId + ') inacessível: ' + sanitizeError(e) + '. Provisionando nova como último recurso.');
    }
  }

  // (4) Last resort: nenhuma fonte válida → cria nova e registra em todos os níveis
  return provisionNewSpreadsheet(props, spreadsheetName, sheetName);
}

/** Lê o ID da planilha do Firebase (server_config/log_sheet_id.json). Retorna string ou null. */
function readLogSheetIdFromFirebase(props) {
  var dbUrl = normalizeFirebaseUrl(props.getProperty('FIREBASE_URL'));
  var secret = props.getProperty('FIREBASE_SECRET');
  if (!dbUrl || !secret) return null;
  try {
    var resp = UrlFetchApp.fetch(
      dbUrl + SERVER_CONFIG_LOG_SHEET_PATH + '?auth=' + secret,
      { method: 'GET', muteHttpExceptions: true }
    );
    if (resp.getResponseCode() !== 200) return null;
    var data = resp.getContentText('UTF-8');
    if (!data || data === 'null') return null;
    // O nó guarda APENAS a string do ID (payload microscópico).
    var parsed = JSON.parse(data);
    return (typeof parsed === 'string' && parsed.trim() !== '') ? parsed.trim() : null;
  } catch (e) {
    console.warn('Falha ao ler log_sheet_id do Firebase:', sanitizeError(e));
    return null;
  }
}

/** Grava o ID da planilha no Firebase (auto-seed) — payload microscópico: só a string. */
function writeLogSheetIdToFirebase(props, sheetId) {
  var dbUrl = normalizeFirebaseUrl(props.getProperty('FIREBASE_URL'));
  var secret = props.getProperty('FIREBASE_SECRET');
  if (!dbUrl || !secret) return;
  try {
    UrlFetchApp.fetch(
      dbUrl + SERVER_CONFIG_LOG_SHEET_PATH + '?auth=' + secret,
      {
        method: 'PUT',
        contentType: 'application/json',
        payload: JSON.stringify(sheetId),
        muteHttpExceptions: true
      }
    );
  } catch (e) {
    console.warn('Falha ao gravar log_sheet_id no Firebase:', sanitizeError(e));
  }
}

/** Registra o ID nas fontes de fallback (Cache + Firebase). Chamado após provisionar nova. */
function recordLogSheetIdFallbackSources(props, sheetId) {
  var cache = CacheService.getScriptCache();
  try { cache.put(LOG_SHEET_ID_CACHE_KEY, sheetId, Math.floor(LOG_SHEET_ID_CACHE_TTL_MS / 1000)); } catch (_) {}
  writeLogSheetIdToFirebase(props, sheetId);
}

function getOrCreateSheet(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    initSheetHeader(sheet);
  }
  return sheet;
}

function initSheetHeader(sheet) {
  sheet.getRange(1, 1, 1, TELEMETRY_HEADERS.length).setValues([TELEMETRY_HEADERS]);
  try { sheet.setFrozenRows(1); } catch (_) {}
}

function validateOrInitSheetHeader(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow === 0) {
    initSheetHeader(sheet);
    return;
  }
  var existing = sheet.getRange(1, 1, 1, TELEMETRY_HEADERS.length).getValues()[0];
  for (var i = 0; i < TELEMETRY_HEADERS.length; i++) {
    if (String(existing[i]) !== TELEMETRY_HEADERS[i]) {
      throw new Error(
        'Cabeçalho da planilha incompatível na coluna ' + (i + 1) +
        '. Esperado: "' + TELEMETRY_HEADERS[i] + '", encontrado: "' + String(existing[i]) + '".'
      );
    }
  }
}

function metricsToRow(metrics, timezone, config) {
  var label = getJobLabel(metrics.jobId, config);
  var timestampStr = '';
  try {
    timestampStr = Utilities.formatDate(new Date(metrics.timestamp), timezone, 'yyyy-MM-dd HH:mm:ss');
  } catch (_) {
    timestampStr = metrics.timestamp || '';
  }
  return [
    label,
    timestampStr,
    metrics.invocation || '',
    metrics.action || '',
    metrics.status || '',
    metrics.itemsProcessed || 0,
    metrics.bytesDownloaded || 0,
    metrics.bytesSaved || 0,
    metrics.target || '',
    metrics.errorTrace || '',
    metrics.notes || ''
  ];
}

function getJobLabel(jobId, config) {
  if (config && config.visual_theme && config.visual_theme.job_styles) {
    if (config.visual_theme.job_styles[jobId]) {
      return config.visual_theme.job_styles[jobId].label;
    }
    if (config.visual_theme.job_styles['default']) {
      return config.visual_theme.job_styles['default'].label;
    }
  }
  return (jobId || 'UNKNOWN').toUpperCase();
}

/**
 * Converte uma cor HEX (#RRGGBB) em componentes RGB.
 * Retorna null se a cor for inválida.
 */
function parseTelemetryHexColor(hex) {
  var value = String(hex || '').trim().replace(/^#/, '');

  if (!/^[0-9a-fA-F]{6}$/.test(value)) return null;

  return {
    r: parseInt(value.substring(0, 2), 16),
    g: parseInt(value.substring(2, 4), 16),
    b: parseInt(value.substring(4, 6), 16)
  };
}

/**
 * Gera um degradê horizontal por interpolação RGB.
 *
 * @param {Object} gradient Configuração row_gradient.
 * @param {number} count Quantidade de células.
 * @returns {string[]|null} Array de cores HEX ou null se inválido.
 */
function buildTelemetryGradientColors(gradient, count) {
  if (!gradient || !gradient.from || !gradient.to || count < 1) {
    return null;
  }

  var from = parseTelemetryHexColor(gradient.from);
  var to = parseTelemetryHexColor(gradient.to);

  if (!from || !to) return null;

  var reverse = String(gradient.direction || 'LEFT_TO_RIGHT')
    .toUpperCase() === 'RIGHT_TO_LEFT';

  var colors = [];

  for (var i = 0; i < count; i++) {
    var ratio = count === 1 ? 0 : i / (count - 1);

    if (reverse) ratio = 1 - ratio;

    var r = Math.round(from.r + (to.r - from.r) * ratio);
    var g = Math.round(from.g + (to.g - from.g) * ratio);
    var b = Math.round(from.b + (to.b - from.b) * ratio);

    var hex = '#' +
      ('0' + r.toString(16)).slice(-2) +
      ('0' + g.toString(16)).slice(-2) +
      ('0' + b.toString(16)).slice(-2);

    colors.push(hex);
  }

  return colors;
}

function applyRowFormatting(sheet, rowIndex, metrics, config) {
  if (!config || !config.visual_theme) return;

  var theme = config.visual_theme;
  var jobId = metrics.jobId;

  var jobStyle = (
    theme.job_styles &&
    (theme.job_styles[jobId] || theme.job_styles['default'])
  ) || {};

  var statusStyle = (
    theme.status_cells &&
    theme.status_cells[metrics.status]
  ) || {};

  var errorTrace = metrics.errorTrace == null
    ? ''
    : String(metrics.errorTrace);

  var hasError = errorTrace.trim() !== '';

  var errorColStyle = hasError
    ? (theme.error_column && theme.error_column.has_exception)
    : (theme.error_column && theme.error_column.default_clean);

  errorColStyle = errorColStyle || {};

  try {
    var columnCount = TELEMETRY_HEADERS.length;
    var rowRange = sheet.getRange(rowIndex, 1, 1, columnCount);

    // ── 1. Fundo padrão da linha: degradê ou cor sólida ─────────────

    var gradientColors = jobStyle.row_gradient
      ? buildTelemetryGradientColors(
          jobStyle.row_gradient,
          columnCount
        )
      : null;

    if (gradientColors) {
      rowRange.setBackgrounds([gradientColors]);
    } else if (jobStyle.row_background) {
      rowRange.setBackground(jobStyle.row_background);
    }

    // Fonte geral da linha
    if (jobStyle.row_font_color) {
      rowRange.setFontColor(jobStyle.row_font_color);
    }

    // ── 2. JOB_ID (coluna A) ───────────────────────────────────────

    if (jobStyle.job_id_cell) {
      var cellA = sheet.getRange(rowIndex, 1);

      if (jobStyle.job_id_cell.bg) {
        cellA.setBackground(jobStyle.job_id_cell.bg);
      }

      if (jobStyle.job_id_cell.fg) {
        cellA.setFontColor(jobStyle.job_id_cell.fg);
      }
    }

    // ── 3. Invocation (coluna C) ──────────────────────────────────
    // Modifica SOMENTE a cor da fonte.
    // O fundo continua sendo o degradê original do job.

    var invocationStyle = (
      theme.invocation_cells &&
      theme.invocation_cells[metrics.invocation]
    ) || null;

    if (invocationStyle) {
      var isMasterJob = jobId === MASTER_JOB_ID;

      var invocationFontColor = (
        (isMasterJob && invocationStyle.master_fg) ||
        invocationStyle.fg
      );

      if (invocationFontColor) {
        sheet.getRange(rowIndex, 3)
          .setFontColor(invocationFontColor);
      }
    }

    // ── 4. Status (coluna E) ──────────────────────────────────────

    if (statusStyle.bg || statusStyle.fg) {
      var cellE = sheet.getRange(rowIndex, 5);

      if (statusStyle.bg) {
        cellE.setBackground(statusStyle.bg);
      }

      if (statusStyle.fg) {
        cellE.setFontColor(statusStyle.fg);
      }
    }

    // ── 5. Errors (coluna J) ──────────────────────────────────────

    if (errorColStyle.bg || errorColStyle.fg) {
      var cellJ = sheet.getRange(rowIndex, 10);

      if (errorColStyle.bg) {
        cellJ.setBackground(errorColStyle.bg);
      }

      if (errorColStyle.fg) {
        cellJ.setFontColor(errorColStyle.fg);
      }
    }

    // ── 6. Borda inferior individual do job ───────────────────────

    // O bracket de ciclo é aplicado posteriormente em
    // appendTelemetryRow(), prevalecendo sobre esta borda.

    if (jobStyle.border_bottom) {
      var bbColor = jobStyle.border_bottom.color || null;

      var bbStyle = jobStyle.border_bottom.style
        ? SpreadsheetApp.BorderStyle[jobStyle.border_bottom.style]
        : null;

      rowRange.setBorder(
        null, null, true, null, null, null,
        bbColor, bbStyle
      );
    }

  } catch (e) {
    console.warn(
      'Falha ao aplicar formatação na linha ' + rowIndex + ':',
      sanitizeError(e)
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilitários exclusivos do Cold Storage
// ─────────────────────────────────────────────────────────────────────────────

function generateColdStorageFilename(timezone, runId) {
  var now = new Date();
  var formatted = '';
  try {
    formatted = Utilities.formatDate(now, timezone, 'yyyy-MM-dd_HH-mm-ss');
  } catch (_) {
    formatted = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  }
  var shortId = String(runId || '').slice(0, 8) || Math.random().toString(36).slice(2, 10);
  return 'sudoku_backup_rooms_' + formatted + '_' + shortId + '.json';
}

/**
 * Cópia profunda via JSON (segura para objetos serializáveis sem referências circulares).
 * Usada para não destruir o objeto original nas contagens/diagnósticos.
 */
function coldStorageDeepCopy(obj) {
  return JSON.parse(JSON.stringify(obj));
}
