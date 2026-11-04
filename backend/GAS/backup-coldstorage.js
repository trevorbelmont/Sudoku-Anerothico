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
      var configUrl = props.getProperty('GITHUB_JOBS_CONFIG_URL');
      if (!configUrl) throw new Error('Script Property GITHUB_JOBS_CONFIG_URL não configurada.');
      config = loadAndValidateConfig(configUrl);
    }

    if (!butIgnoreRules) {
      var butIgnoreUrl = props.getProperty('GITHUB_BUTIGNORE_URL');
      if (!butIgnoreUrl) throw new Error('Script Property GITHUB_BUTIGNORE_URL não configurada.');
      butIgnoreRules = loadAndParseButIgnore(butIgnoreUrl, COLDSTORAGE_JOB_ID);
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
          var cfgUrl2 = propsForSheet.getProperty('GITHUB_JOBS_CONFIG_URL');
          if (cfgUrl2) cfgForSheet = loadAndValidateConfig(cfgUrl2);
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
      futureDatedRoomsDeferred: futureCount,
      nodesIgnored: nodesIgnored
    },
    rooms: roomsCopy
  };

  var payloadStr = JSON.stringify(payload);

  // ── 3.6 Persistir no Drive ────────────────────────────────────────────
  var filename = generateColdStorageFilename(timezone, runId);
  var folder = DriveApp.getFolderById(folderId);
  var createdFile = folder.createFile(filename, payloadStr, MimeType.PLAIN_TEXT);
  // bytesSaved: tamanho real do arquivo persistido
  var bytesSaved = createdFile.getSize();

  metrics.itemsProcessed = Object.keys(eligibleRooms).length;
  metrics.bytesSaved = bytesSaved;
  metrics.target = filename;

  // ── 3.7 Avançar watermark SOMENTE após confirmação de persistência ────
  advanceWatermark(dbUrl, secret, wakeUpTime);

  metrics.status = 'SUCCESS';
  metrics.completedSuccessfully = true;
  metrics.notes = activationLabel +
    '\nJanela: [' + lastBackupTimestamp + ', ' + wakeUpTime + ')' +
    '\nSalas arquivadas: ' + metrics.itemsProcessed +
    ' | Legadas: ' + legacyCount +
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

function filterEligibleRooms(allRooms, lastBackupTimestamp, wakeUpTime) {
  var eligible = {};
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

    // Salas legadas: updatedAt ausente, null, undefined ou numericamente 0
    if (updatedAt === null || updatedAt === undefined || updatedAt === 0) {
      eligible[roomId] = room;
      legacyCount++;
      continue;
    }

    // Valores não numéricos: conservador — inclui como legado com aviso
    if (typeof updatedAt !== 'number' || !isFinite(updatedAt)) {
      console.warn('Sala ' + roomId + ' tem updatedAt não numérico (' + String(updatedAt) + '); tratada como legada.');
      eligible[roomId] = room;
      legacyCount++;
      continue;
    }

    // Salas futuras: updatedAt >= wakeUpTime — adiadas para o próximo ciclo
    if (updatedAt >= wakeUpTime) {
      futureCount++;
      continue;
    }

    // Salas anteriores ao watermark (exceto legadas): já cobertas por ciclo anterior
    if (updatedAt < lastBackupTimestamp) {
      continue;
    }

    // Janela elegível: updatedAt >= lastBackupTimestamp && < wakeUpTime
    eligible[roomId] = room;
  }

  return {
    eligible: eligible,
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
 * Faz download do .butIgnore e retorna as regras compiladas como RegExp[].
 * Usa CacheService com TTL. Lança exceção se não houver fonte válida.
 * NUNCA usa regras vazias como fallback silencioso.
 *
 * @param {string} url       URL Raw do .butIgnore
 * @param {string} sectionId Seção a carregar além das globais
 * @returns {RegExp[]}
 */
function loadAndParseButIgnore(url, sectionId) {
  var cache = CacheService.getScriptCache();
  var cacheKey = BUTIGNORE_CACHE_KEY + '_' + (sectionId || 'global');
  var freshText = null;

  try {
    var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (response.getResponseCode() === 200) {
      freshText = response.getContentText('UTF-8');
    }
  } catch (fetchErr) {
    console.warn('Falha ao baixar .butIgnore:', sanitizeError(fetchErr));
  }

  if (freshText !== null) {
    try {
      cache.put(cacheKey + '_raw', freshText, Math.floor(BUTIGNORE_CACHE_TTL_MS / 1000));
    } catch (_) {}
    return parseButIgnoreText(freshText, sectionId);
  }

  // Fallback: cache válido
  var cached = null;
  try { cached = cache.get(cacheKey + '_raw'); } catch (_) {}
  if (cached) {
    console.warn('.butIgnore: usando cache válido após falha de rede.');
    return parseButIgnoreText(cached, sectionId);
  }

  // Sem fonte válida nem cache: aborta — falha segura
  throw new Error(
    'Não foi possível obter .butIgnore (falha de rede + cache expirado/ausente). ' +
    'Backup abortado para não executar sem filtros de exclusão.'
  );
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
  var sheetId = props.getProperty('LOG_SHEET_ID');
  var timezone = (config && config.system && config.system.timezone) || 'America/Sao_Paulo';
  var spreadsheetName = (config && config.telemetry && config.telemetry.spreadsheet_name) ||
    'Sudoku Aneróthico PRÓ - Jobs Telemetry';
  var sheetName = (config && config.telemetry && config.telemetry.sheet_name) || 'JobsTelemetry';

  if (!sheetId || sheetId.trim() === '') {
    throw new Error(
      'LOG_SHEET_ID não configurada. Configure como "NULL" para provisionar automaticamente ' +
      'ou com um ID de planilha existente.'
    );
  }

  var ss;
  if (sheetId.trim().toUpperCase() === 'NULL') {
    ss = provisionNewSpreadsheet(props, spreadsheetName, sheetName);
  } else {
    ss = SpreadsheetApp.openById(sheetId.trim());
  }

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

    // Freeze primeira linha e wrap em coluna K
    try {
      if (sheet.getFrozenRows() < 1) sheet.setFrozenRows(1);
      sheet.getRange(nextRow, 11, rows.length, 1).setWrap(true);
    } catch (_) {}
  } finally {
    sheetLock.releaseLock();
  }
}

function provisionNewSpreadsheet(props, spreadsheetName, sheetName) {
  var ss = SpreadsheetApp.create(spreadsheetName);
  var newId = ss.getId();
  // Persistir o ID IMEDIATAMENTE antes de qualquer outra operação
  props.setProperty('LOG_SHEET_ID', newId);

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
