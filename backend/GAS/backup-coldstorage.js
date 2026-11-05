/**
 * SUDOKU ANERÓTHICO PRÓ — Cold Storage de Salas (Job: coldstorage_rooms)
 *  
 * Responsabilidade: backup diferencial de `rooms` do Firebase Realtime Database
 * para arquivos JSON no Google Drive, com watermark, exclusão de caminhos
 * voláteis via .butIgnore e telemetria padronizada de 11 colunas.
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
 *   DRIVE_FOLDER_ID       — pasta onde gravar os arquivos JSON de Cold Storage
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

function runColdStorageCore(props, config, butIgnoreRules, wakeUpTime, runId, invocation) {
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
    UrlFetchApp.fetch(
      dbUrl + SERVER_META_COLDSTORAGE_PATH + '?auth=' + secret,
      {
        method: 'PATCH',
        contentType: 'application/json',
        payload: JSON.stringify(patch),
        muteHttpExceptions: true
      }
    );
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
    // do batch, com a MESMA identidade (visual_theme.job_styles[master].border_top).
    // Só aplica quando o primeiro row é o Master (flush orquestrado). Configurável
    // no JSON/Firebase — sem bordas chumbadas no código. A borda inferior por-job
    // (separador claro) é aplicada por applyRowFormatting; este bracket sobrepõe
    // o fundo do último row do batch para fechar o ciclo visualmente.
    try {
      var firstIsMaster = rows.length > 0 && rows[0].jobId === MASTER_JOB_ID;
      var masterStyle = (config && config.visual_theme && config.visual_theme.job_styles)
        ? config.visual_theme.job_styles[MASTER_JOB_ID] : null;
      if (firstIsMaster && masterStyle && masterStyle.border_top) {
        var bt = masterStyle.border_top;
        var bColor = bt.color || null;
        var bStyle = bt.style ? SpreadsheetApp.BorderStyle[bt.style] : null;
        // Topo do Master = início do ciclo
        sheet.getRange(nextRow, 1, 1, TELEMETRY_HEADERS.length)
             .setBorder(true, null, null, null, null, null, bColor, bStyle);
        // Fundo do último job do batch = fim do ciclo (mesma identidade)
        sheet.getRange(nextRow + rows.length - 1, 1, 1, TELEMETRY_HEADERS.length)
             .setBorder(null, null, true, null, null, null, bColor, bStyle);
      }
    } catch (e) {
      console.warn('Falha ao aplicar bordas de ciclo:', sanitizeError(e));
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

function applyRowFormatting(sheet, rowIndex, metrics, config) {
  if (!config || !config.visual_theme) return;
  var theme = config.visual_theme;
  var jobId = metrics.jobId;
  var jobStyle = (theme.job_styles && (theme.job_styles[jobId] || theme.job_styles['default'])) || {};
  var statusStyle = (theme.status_cells && theme.status_cells[metrics.status]) || {};
  var hasError = !!(metrics.errorTrace && metrics.errorTrace.trim());
  var errorColStyle = hasError
    ? (theme.error_column && theme.error_column.has_exception)
    : (theme.error_column && theme.error_column.default_clean);
  errorColStyle = errorColStyle || {};

  try {
    var rowRange = sheet.getRange(rowIndex, 1, 1, TELEMETRY_HEADERS.length);
    if (jobStyle.row_background) rowRange.setBackground(jobStyle.row_background);
    if (jobStyle.row_font_color) rowRange.setFontColor(jobStyle.row_font_color);

    if (jobStyle.job_id_cell) {
      var cellA = sheet.getRange(rowIndex, 1);
      if (jobStyle.job_id_cell.bg) cellA.setBackground(jobStyle.job_id_cell.bg);
      if (jobStyle.job_id_cell.fg) cellA.setFontColor(jobStyle.job_id_cell.fg);
    }

    if (statusStyle.bg || statusStyle.fg) {
      var cellE = sheet.getRange(rowIndex, 5);
      if (statusStyle.bg) cellE.setBackground(statusStyle.bg);
      if (statusStyle.fg) cellE.setFontColor(statusStyle.fg);
    }

    if (errorColStyle.bg || errorColStyle.fg) {
      var cellJ = sheet.getRange(rowIndex, 10);
      if (errorColStyle.bg) cellJ.setBackground(errorColStyle.bg);
      if (errorColStyle.fg) cellJ.setFontColor(errorColStyle.fg);
    }

    // Borda inferior por-job (separador entre linhas) — vinda do JSON/Firebase.
    // O bracket de ciclo (topo do Master / fundo do último job) é aplicado em
    // appendTelemetryRow e sobrepõe o fundo do último row do batch.
    if (jobStyle.border_bottom) {
      var bbColor = jobStyle.border_bottom.color || null;
      var bbStyle = jobStyle.border_bottom.style
        ? SpreadsheetApp.BorderStyle[jobStyle.border_bottom.style]
        : null;
      rowRange.setBorder(null, null, true, null, null, null, bbColor, bbStyle);
    }
  } catch (e) {
    console.warn('Falha ao aplicar formatação na linha ' + rowIndex + ':', sanitizeError(e));
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
