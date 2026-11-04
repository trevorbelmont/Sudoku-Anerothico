/**
 * SUDOKU ANERÓTHICO PRÓ — Master Orchestrator
 *
 * Despachante único de jobs assíncronos do backend serverless.
 * Coordena o Cold Storage de salas (e futuros jobs) de forma serial.
 *
 * Ambiente de execução: Google Apps Script V8 (runtime síncrono).
 * Não use require, module.exports, process.env, fs, async/await ou Promise.all.
 *
 * NOTA DE ESCOPO GLOBAL GAS:
 *   Os arquivos de um projeto Apps Script compartilham o escopo global.
 *   Este arquivo define as funções canônicas de utilidade:
 *     parseIso8601Duration, generateRunId, normalizeFirebaseUrl,
 *     buildBaseMetrics, sanitizeError, formatInvocationLabel,
 *     loadAndValidateConfig, validateOrchestratorConfig.
 *   As funções de telemetria (appendTelemetryRow, etc.) e Cold Storage estão em
 *   backup-coldstorage.js, igualmente acessíveis pelo escopo global.
 *
 * Entrypoints:
 *   runScheduledMasterOrchestrator(e)  — handler exclusivo do trigger temporal
 *   runMasterOrchestrator()            — execução manual REST ou editor
 *   installMasterTrigger()             — instalação idempotente do trigger (uma vez)
 *
 * REST Web App (único doGet/doPost do projeto — não existe outro nos demais arquivos):
 *   doGet(e)   — health check
 *   doPost(e)  — roteamento: action=master | action=backup | action=status
 *
 * Script Properties necessárias:
 *   CRON_TOKEN              — token de autenticação do Web App
 *   FIREBASE_URL            — URL base do Realtime Database
 *   FIREBASE_SECRET         — credencial REST do Firebase
 *   GITHUB_JOBS_CONFIG_URL  — URL Raw de backend/config/jobs-orchestrator.json
 *   GITHUB_BUTIGNORE_URL    — URL Raw do .butIgnore (capitalização exata)
 *   LOG_SHEET_ID            — ID da planilha ou "NULL" para provisionar
 *   LOG_SHEET_FOLDER_ID     — (opcional) pasta da planilha de telemetria
 *   DRIVE_FOLDER_ID         — pasta dos arquivos JSON de Cold Storage
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constantes do Master
// ─────────────────────────────────────────────────────────────────────────────

var MASTER_JOB_ID = 'master_orchestrator';
var SERVER_META_MASTER_PATH = '/server_meta/master_orchestrator.json';
var SERVER_META_ROOT_PATH = '/server_meta.json';
var MASTER_LOCK_TIMEOUT_MS = 25000;
var CONFIG_CACHE_KEY = 'orchestratorConfig_v1';
var CONFIG_CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 horas

// ─────────────────────────────────────────────────────────────────────────────
// Registro de handlers de jobs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mapa de jobId → função handler.
 * executeColdStorageRooms está em backup-coldstorage.js (escopo global GAS).
 * Não registre stubs de jobs futuros sem implementação real.
 */
var JOB_HANDLERS = {
  'coldstorage_rooms': executeColdStorageRooms
};

// ─────────────────────────────────────────────────────────────────────────────
// REST Web App — único doGet e doPost do projeto
// ─────────────────────────────────────────────────────────────────────────────

/** Health check via navegador */
function doGet(e) {
  return ContentService.createTextOutput('Serviço L2 Cache e Backup Operacional.');
}

/** Roteador REST centralizado — action=master | action=backup | action=status */
function doPost(e) {
  try {
    var props = PropertiesService.getScriptProperties();
    var expectedToken = props.getProperty('CRON_TOKEN');

    if (!expectedToken || !expectedToken.trim()) {
      return jsonResponse({ ok: false, error: { code: 'TOKEN_NOT_CONFIGURED', message: 'CRON_TOKEN não configurado.' } });
    }

    // Aceitar token no body JSON ou em parâmetro URL (compatibilidade legada)
    var bodyToken = null;
    var action = null;
    try {
      if (e.postData && e.postData.contents) {
        var body = JSON.parse(e.postData.contents);
        bodyToken = body.token || null;
        action = body.action || null;
      }
    } catch (_) {}

    var paramToken = (e.parameter && e.parameter.token) || null;
    var paramAction = (e.parameter && e.parameter.action) || null;
    var token = bodyToken || paramToken;
    action = action || paramAction;

    if (!token || token !== expectedToken) {
      return jsonResponse({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Token inválido ou ausente.' } });
    }

    if (action === 'master') {
      var masterResult = runMasterOrchestrator();
      return jsonResponse({ ok: true, action: 'master', runId: masterResult.runId, result: masterResult });
    }

    if (action === 'backup') {
      var backupResult = executeColdStorageRooms(false, { invocation: 'MANUAL_SOLO' });
      return jsonResponse({ ok: true, action: 'backup', runId: backupResult.runId, result: backupResult });
    }

    if (action === 'status') {
      var statusData = readServerMeta(props);
      return jsonResponse({ ok: true, action: 'status', data: statusData });
    }

    return jsonResponse({
      ok: false,
      error: { code: 'INVALID_ACTION', message: 'Ação inválida. Ações suportadas: master, backup, status.' }
    });

  } catch (err) {
    return jsonResponse({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: sanitizeError(err) }
    });
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─────────────────────────────────────────────────────────────────────────────
// Entrypoints do Master
// ─────────────────────────────────────────────────────────────────────────────

/** Handler exclusivo do trigger temporal — NÃO usar no endpoint REST */
function runScheduledMasterOrchestrator(e) {
  return runMasterCore('SCHEDULED_MASTER');
}

/** Execução manual via REST ou editor Apps Script */
function runMasterOrchestrator() {
  return runMasterCore('MANUAL_MASTER');
}

// ─────────────────────────────────────────────────────────────────────────────
// Núcleo do Master (serial, com lock)
// ─────────────────────────────────────────────────────────────────────────────

function runMasterCore(invocation) {
  var lock = LockService.getScriptLock();
  var lockAcquired = lock.tryLock(MASTER_LOCK_TIMEOUT_MS);
  if (!lockAcquired) {
    console.warn('Master Orchestrator: lock indisponível — ciclo concorrente em andamento.');
    return {
      runId: generateRunId(),
      status: 'SKIPPED',
      reason: 'Lock indisponível — execução concorrente em andamento.',
      invocation: invocation
    };
  }

  var runId = generateRunId();
  var wakeUpTime = Date.now();
  var masterMetrics = buildBaseMetrics(MASTER_JOB_ID, { runId: runId, invocation: invocation });
  masterMetrics.action = 'ORCHESTRATED';

  try {
    var props = PropertiesService.getScriptProperties();

    // ── 1. Carregar e validar configuração ─────────────────────────────
    var configUrl = props.getProperty('GITHUB_JOBS_CONFIG_URL');
    if (!configUrl) throw new Error('Script Property GITHUB_JOBS_CONFIG_URL não configurada.');
    var config = loadAndValidateConfig(configUrl);

    // ── 2. Carregar .butIgnore para coldstorage_rooms (evita download duplo) ──
    var butIgnoreUrl = props.getProperty('GITHUB_BUTIGNORE_URL');
    if (!butIgnoreUrl) throw new Error('Script Property GITHUB_BUTIGNORE_URL não configurada.');
    var coldStorageRules = loadAndParseButIgnore(butIgnoreUrl, 'coldstorage_rooms');

    // ── 3. Ler estado anterior do Firebase ──────────────────────────────
    var serverMeta = readServerMeta(props);

    // ── 4. Percorrer jobs_schedule de forma determinística ──────────────
    var jobsSchedule = config.jobs_schedule;
    var jobIds = Object.keys(jobsSchedule);
    var now = Date.now();
    var invokedJobs = [];
    var allJobMetrics = [];
    var masterFailed = false;
    masterMetrics.notes = '';

    for (var i = 0; i < jobIds.length; i++) {
      var jobId = jobIds[i];
      var jobDef = jobsSchedule[jobId];

      if (jobDef.enabled !== true) {
        masterMetrics.notes += '\nJob "' + jobId + '": desabilitado — ignorado.';
        continue;
      }

      if (!JOB_HANDLERS[jobId]) {
        masterMetrics.notes += '\nJob "' + jobId + '": habilitado mas sem handler — ignorado.';
        continue;
      }

      // Resolver política de repetição
      var repeatPolicy = (jobDef.schedule && jobDef.schedule.repeat_policy) ||
        config.system.scheduling.default_repeat_policy;
      var validPolicies = ['ALL', 'ALL_SUCCEEDED', 'SCHEDULED', 'SCHEDULED_SUCCEEDED'];
      if (validPolicies.indexOf(repeatPolicy) === -1) {
        throw new Error('repeat_policy inválido para job "' + jobId + '": ' + repeatPolicy);
      }

      // Selecionar âncora conforme política
      var jobMeta = (serverMeta && serverMeta[jobId]) || {};
      var anchorTs = selectAnchorTimestamp(repeatPolicy, jobMeta);

      // Converter intervalo ISO 8601 para ms
      var intervalMs = parseIso8601Duration(jobDef.schedule.interval);

      // Avaliar elegibilidade
      var eligible = (anchorTs === null) || (now - anchorTs >= intervalMs);
      if (!eligible) {
        var remainingMs = intervalMs - (now - anchorTs);
        masterMetrics.notes += '\nJob "' + jobId + '": intervalo não vencido (' +
          Math.round(remainingMs / 60000) + ' min restantes). Política: ' + repeatPolicy + '.';
        continue;
      }

      masterMetrics.notes += '\nJob "' + jobId + '": despachado (política=' + repeatPolicy + ').';
      invokedJobs.push(jobId);

      try {
        var jobResult = JOB_HANDLERS[jobId](true, {
          config: config,
          butIgnoreRules: coldStorageRules,
          wakeUpTime: wakeUpTime,
          runId: runId + '_' + jobId,
          invocation: invocation,
          lockAlreadyHeld: true
        });
        allJobMetrics.push(jobResult);
        if (!jobResult.completedSuccessfully) {
          masterFailed = true;
          masterMetrics.notes += '\nJob "' + jobId + '": concluído com status ' + jobResult.status + '.';
        } else {
          masterMetrics.notes += '\nJob "' + jobId + '": SUCCESS.';
        }
      } catch (jobErr) {
        masterFailed = true;
        var errTrace = sanitizeError(jobErr);
        var failMetrics = buildBaseMetrics(jobId, { invocation: invocation, runId: runId + '_' + jobId });
        failMetrics.status = 'FAILED';
        failMetrics.errorTrace = errTrace;
        failMetrics.completedSuccessfully = false;
        failMetrics.notes = formatInvocationLabel(invocation) +
          '\nExceção não tratada no handler do job "' + jobId + '": ' + errTrace;
        allJobMetrics.push(failMetrics);
        masterMetrics.notes += '\nJob "' + jobId + '": FAILED com exceção — ' + errTrace;
      }
    }

    // ── 5. Montar métricas do Master ──────────────────────────────────
    masterMetrics.itemsProcessed = invokedJobs.length;
    masterMetrics.status = masterFailed ? 'FAILED' : (invokedJobs.length > 0 ? 'SUCCESS' : 'SKIPPED');
    masterMetrics.completedSuccessfully = !masterFailed;
    masterMetrics.notes = formatInvocationLabel(invocation) +
      '\nJobs despachados: ' + (invokedJobs.length ? invokedJobs.join(', ') : 'nenhum') +
      ' | Total avaliados: ' + jobIds.length +
      masterMetrics.notes;

    // ── 6. Flush em lote (Master primeiro, jobs depois) ───────────────
    var allRows = [masterMetrics].concat(allJobMetrics);
    try {
      appendTelemetryRow(props, config, allRows);
    } catch (sheetErr) {
      console.error('Falha ao gravar telemetria do Master:', sanitizeError(sheetErr));
      masterMetrics.notes += '\nAVISO: falha de telemetria — ' + sanitizeError(sheetErr);
    }

    // ── 7. Atualizar server_meta do Master ─────────────────────────────
    persistMasterMeta(props, masterMetrics, invocation, wakeUpTime);

    return masterMetrics;

  } catch (err) {
    var errStr = sanitizeError(err);
    masterMetrics.status = 'FAILED';
    masterMetrics.completedSuccessfully = false;
    masterMetrics.errorTrace = errStr;
    masterMetrics.notes = formatInvocationLabel(invocation) +
      '\nFalha crítica do Master Orchestrator: ' + errStr;

    try {
      var propsForFallback = PropertiesService.getScriptProperties();
      appendTelemetryRow(propsForFallback, null, [masterMetrics]);
    } catch (_) {}

    try {
      var propsForMeta = PropertiesService.getScriptProperties();
      persistMasterMeta(propsForMeta, masterMetrics, invocation, wakeUpTime);
    } catch (_) {}

    return masterMetrics;

  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Avaliação do schedule (função testável isoladamente)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Avalia quais jobs devem ser despachados e executa seus handlers.
 * Separado de runMasterCore para permitir testes unitários sem GAS real.
 *
 * @param {Object} config       configuração validada
 * @param {Object} serverMeta   metadados lidos do Firebase
 * @param {number} now          Date.now() de referência
 * @param {string} invocation   tipo de invocação
 * @param {Object} handlers     mapa jobId→fn (opcional; usa JOB_HANDLERS se omitido)
 * @returns {{ invokedJobs: string[], allJobMetrics: Object[], masterFailed: boolean, notes: string }}
 */
function evaluateJobSchedule(config, serverMeta, now, invocation, handlers) {
  var jobHandlers = handlers || JOB_HANDLERS;
  var jobsSchedule = config.jobs_schedule;
  var jobIds = Object.keys(jobsSchedule);
  var invokedJobs = [];
  var allJobMetrics = [];
  var masterFailed = false;
  var notes = '';

  for (var i = 0; i < jobIds.length; i++) {
    var jobId = jobIds[i];
    var jobDef = jobsSchedule[jobId];

    if (jobDef.enabled !== true) {
      notes += '\nJob "' + jobId + '": desabilitado — ignorado.';
      continue;
    }

    if (!jobHandlers[jobId]) {
      notes += '\nJob "' + jobId + '": habilitado mas sem handler — ignorado.';
      continue;
    }

    var repeatPolicy = (jobDef.schedule && jobDef.schedule.repeat_policy) ||
      config.system.scheduling.default_repeat_policy;
    var validPolicies = ['ALL', 'ALL_SUCCEEDED', 'SCHEDULED', 'SCHEDULED_SUCCEEDED'];
    if (validPolicies.indexOf(repeatPolicy) === -1) {
      throw new Error('repeat_policy inválido para job "' + jobId + '": ' + repeatPolicy);
    }

    var jobMeta = (serverMeta && serverMeta[jobId]) || {};
    var anchorTs = selectAnchorTimestamp(repeatPolicy, jobMeta);
    var intervalMs = parseIso8601Duration(jobDef.schedule.interval);
    var eligible = (anchorTs === null) || (now - anchorTs >= intervalMs);

    if (!eligible) {
      var remainingMs = intervalMs - (now - anchorTs);
      notes += '\nJob "' + jobId + '": intervalo não vencido (' +
        Math.round(remainingMs / 60000) + ' min restantes). Política: ' + repeatPolicy + '.';
      continue;
    }

    notes += '\nJob "' + jobId + '": despachado (política=' + repeatPolicy + ').';
    invokedJobs.push(jobId);

    try {
      var jobResult = jobHandlers[jobId](true, {
        config: config,
        wakeUpTime: now,
        invocation: invocation,
        lockAlreadyHeld: true
      });
      allJobMetrics.push(jobResult);
      if (!jobResult.completedSuccessfully) {
        masterFailed = true;
        notes += '\nJob "' + jobId + '": status=' + jobResult.status + '.';
      } else {
        notes += '\nJob "' + jobId + '": SUCCESS.';
      }
    } catch (jobErr) {
      masterFailed = true;
      var errTrace = sanitizeError(jobErr);
      var failMetrics = buildBaseMetrics(jobId, { invocation: invocation });
      failMetrics.status = 'FAILED';
      failMetrics.errorTrace = errTrace;
      failMetrics.completedSuccessfully = false;
      failMetrics.notes = formatInvocationLabel(invocation) + '\nExceção: ' + errTrace;
      allJobMetrics.push(failMetrics);
      notes += '\nJob "' + jobId + '": FAILED — ' + errTrace;
    }
  }

  return { invokedJobs: invokedJobs, allJobMetrics: allJobMetrics, masterFailed: masterFailed, notes: notes };
}

// ─────────────────────────────────────────────────────────────────────────────
// Seleção de âncora por política de repetição
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retorna o timestamp de âncora (epoch ms) conforme a política, ou null
 * se não houver registro (primeira execução elegível).
 */
function selectAnchorTimestamp(repeatPolicy, jobMeta) {
  var fieldMap = {
    'ALL': 'last_completed_at',
    'ALL_SUCCEEDED': 'last_success_at',
    'SCHEDULED': 'last_scheduled_at',
    'SCHEDULED_SUCCEEDED': 'last_scheduled_success_at'
  };
  var field = fieldMap[repeatPolicy];
  if (!field) return null;
  var ts = jobMeta[field];
  if (ts === null || ts === undefined || ts === 0) return null;
  var num = Number(ts);
  return isFinite(num) && num > 0 ? num : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistência de metadados do Master no Firebase
// ─────────────────────────────────────────────────────────────────────────────

function persistMasterMeta(props, metrics, invocation, wakeUpTime) {
  var dbUrl = normalizeFirebaseUrl(props.getProperty('FIREBASE_URL'));
  var secret = props.getProperty('FIREBASE_SECRET');
  if (!dbUrl || !secret) return;

  var now = Date.now();
  var patch = {
    last_attempt_at: wakeUpTime,
    last_completed_at: now,
    last_invocation: invocation,
    last_run_id: metrics.runId,
    status: metrics.status,
    duration_ms: now - wakeUpTime
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
      dbUrl + SERVER_META_MASTER_PATH + '?auth=' + secret,
      {
        method: 'PATCH',
        contentType: 'application/json',
        payload: JSON.stringify(patch),
        muteHttpExceptions: true
      }
    );
  } catch (e) {
    console.error('Falha ao persistir metadados do Master:', sanitizeError(e));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Leitura de server_meta
// ─────────────────────────────────────────────────────────────────────────────

function readServerMeta(props) {
  var dbUrl = normalizeFirebaseUrl(props.getProperty('FIREBASE_URL'));
  var secret = props.getProperty('FIREBASE_SECRET');
  if (!dbUrl || !secret) return {};
  try {
    var resp = UrlFetchApp.fetch(
      dbUrl + SERVER_META_ROOT_PATH + '?auth=' + secret,
      { method: 'GET', muteHttpExceptions: true }
    );
    if (resp.getResponseCode() !== 200) return {};
    var data = JSON.parse(resp.getContentText('UTF-8'));
    return data && typeof data === 'object' ? data : {};
  } catch (e) {
    console.warn('Falha ao ler server_meta:', sanitizeError(e));
    return {};
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Instalação idempotente do trigger temporal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Instala o trigger para runScheduledMasterOrchestrator.
 *
 * Execute UMA ÚNICA VEZ no editor do Apps Script:
 *   Extensions → Apps Script → selecione "installMasterTrigger" → Run
 *   Autorize as permissões solicitadas na janela pop-up.
 *
 * A instalação é idempotente: não cria duplicatas e não remove triggers de
 * outras funções. Se o trigger já existir, apenas reporta.
 * Se existir trigger com cadência diferente do heartbeat configurado, reporta
 * a divergência sem remover o trigger existente.
 */
function installMasterTrigger() {
  var props = PropertiesService.getScriptProperties();
  var configUrl = props.getProperty('GITHUB_JOBS_CONFIG_URL');
  if (!configUrl) {
    throw new Error('GITHUB_JOBS_CONFIG_URL não configurada. Configure antes de instalar o trigger.');
  }
  var config = loadAndValidateConfig(configUrl);
  var heartbeat = config.system.scheduling.heartbeat_interval;
  var timezone = config.system.timezone || 'America/Sao_Paulo';
  var triggerSpec = parseTriggerSpec(heartbeat);
  var heartbeatMs = parseIso8601Duration(heartbeat);

  // Valida que o heartbeat não é mais lento que qualquer job habilitado
  var jobIds = Object.keys(config.jobs_schedule);
  for (var i = 0; i < jobIds.length; i++) {
    var jId = jobIds[i];
    var jDef = config.jobs_schedule[jId];
    if (jDef.enabled !== true) continue;
    var jobIntervalMs = parseIso8601Duration(jDef.schedule.interval);
    if (heartbeatMs > jobIntervalMs) {
      throw new Error(
        'Heartbeat (' + heartbeat + ') é mais lento que o intervalo do job "' + jId +
        '" (' + jDef.schedule.interval + '). Reduza o heartbeat antes de instalar.'
      );
    }
  }

  var handlerName = 'runScheduledMasterOrchestrator';
  var existingTriggers = ScriptApp.getProjectTriggers();
  for (var j = 0; j < existingTriggers.length; j++) {
    if (existingTriggers[j].getHandlerFunction() === handlerName) {
      console.log('Trigger para "' + handlerName + '" já existe. Nenhuma ação necessária.');
      return 'ALREADY_EXISTS';
    }
  }

  // Criar trigger com a cadência adequada
  var builder = ScriptApp.newTrigger(handlerName).timeBased();
  if (triggerSpec.unit === 'minutes') {
    builder = builder.everyMinutes(triggerSpec.value);
  } else if (triggerSpec.unit === 'hours') {
    builder = builder.everyHours(triggerSpec.value);
  } else if (triggerSpec.unit === 'days') {
    builder = builder.everyDays(triggerSpec.value).atHour(3).inTimezone(timezone);
  } else if (triggerSpec.unit === 'weeks') {
    builder = builder.everyWeeks(triggerSpec.value).atHour(3).inTimezone(timezone);
  }
  builder.create();

  console.log('Trigger criado para "' + handlerName + '" com heartbeat ' + heartbeat + '.');
  return 'CREATED';
}

/**
 * Converte duração ISO 8601 para especificação de trigger GAS.
 * Aceita somente uma ÚNICA unidade (minutos, horas, dias ou semanas).
 * Rejeita durações compostas como P1DT2H.
 * Para everyMinutes: aceita apenas 1, 5, 10, 15 ou 30.
 */
function parseTriggerSpec(duration) {
  var ms = parseIso8601Duration(duration);

  // Detecta se é duração composta (mais de uma unidade ativa):
  // decompomos a duração e verificamos que apenas uma granularidade está preenchida.
  var match = duration.match(
    /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/
  );
  var parts = [match[1], match[2], match[3], match[4], match[5]].map(function(v) { return v ? parseInt(v, 10) : 0; });
  var activeParts = parts.filter(function(v) { return v > 0; });
  if (activeParts.length > 1) {
    throw new Error(
      'Heartbeat "' + duration + '" é uma duração composta e não pode ser representado ' +
      'por um trigger recorrente do Apps Script. Use uma única unidade: ' +
      'minutos (1/5/10/15/30), horas inteiras, dias inteiros ou semanas inteiras.'
    );
  }

  // Verifica semanas primeiro (mais específico), depois dias, horas, minutos
  var weeks = ms / (7 * 24 * 60 * 60 * 1000);
  if (weeks === Math.floor(weeks) && weeks >= 1 && parts[0] > 0) {
    return { unit: 'weeks', value: weeks };
  }

  var days = ms / (24 * 60 * 60 * 1000);
  if (days === Math.floor(days) && days >= 1 && parts[1] > 0) {
    return { unit: 'days', value: days };
  }

  var hours = ms / (60 * 60 * 1000);
  if (hours === Math.floor(hours) && hours >= 1 && parts[2] > 0) {
    return { unit: 'hours', value: hours };
  }

  var validMinutes = [1, 5, 10, 15, 30];
  var minutes = ms / (60 * 1000);
  if (minutes === Math.floor(minutes) && validMinutes.indexOf(minutes) !== -1) {
    return { unit: 'minutes', value: minutes };
  }

  throw new Error(
    'Heartbeat "' + duration + '" não pode ser representado por um trigger recorrente do Apps Script. ' +
    'Use minutos (1/5/10/15/30), horas inteiras, dias inteiros ou semanas inteiras.'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Funções utilitárias canônicas (escopo global GAS — não redefinir nos outros arquivos)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converte duração ISO 8601 em milissegundos.
 * Aceita P[nW][nD][T[nH][nM][nS]].
 * Rejeita anos (Y), meses-calendário e valores zero/negativos.
 */
function parseIso8601Duration(duration) {
  if (!duration || typeof duration !== 'string') {
    throw new Error('Duração ISO 8601 inválida: ' + String(duration));
  }
  var match = duration.match(
    /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/
  );
  if (!match) {
    throw new Error(
      'Formato de duração ISO 8601 não suportado: "' + duration + '". ' +
      'Use P[nW][nD][T[nH][nM][nS]]. Anos e meses-calendário não são aceitos.'
    );
  }
  var weeks   = parseInt(match[1] || '0', 10);
  var days    = parseInt(match[2] || '0', 10);
  var hours   = parseInt(match[3] || '0', 10);
  var minutes = parseInt(match[4] || '0', 10);
  var seconds = parseInt(match[5] || '0', 10);

  var ms = (weeks * 7 * 24 * 60 * 60 * 1000) +
           (days * 24 * 60 * 60 * 1000) +
           (hours * 60 * 60 * 1000) +
           (minutes * 60 * 1000) +
           (seconds * 1000);

  if (!isFinite(ms) || ms <= 0) {
    throw new Error('Duração ISO 8601 deve ser positiva e finita: "' + duration + '".');
  }
  return ms;
}

/**
 * Carrega e valida backend/config/jobs-orchestrator.json via URL Raw.
 * Usa CacheService com TTL de 2 horas. Lança exceção se não houver fonte válida.
 */
function loadAndValidateConfig(url) {
  var cache = CacheService.getScriptCache();
  var freshText = null;

  try {
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() === 200) {
      freshText = resp.getContentText('UTF-8');
    }
  } catch (fetchErr) {
    console.warn('Falha ao baixar jobs-orchestrator.json:', sanitizeError(fetchErr));
  }

  var configText = freshText;
  if (!configText) {
    try { configText = cache.get(CONFIG_CACHE_KEY + '_raw'); } catch (_) {}
    if (!configText) {
      throw new Error('Não foi possível obter jobs-orchestrator.json (falha de rede + cache expirado/ausente).');
    }
    console.warn('jobs-orchestrator.json: usando cache válido após falha de rede.');
  } else {
    try { cache.put(CONFIG_CACHE_KEY + '_raw', configText, Math.floor(CONFIG_CACHE_TTL_MS / 1000)); } catch (_) {}
  }

  var config = JSON.parse(configText);
  validateOrchestratorConfig(config);
  return config;
}

/** Valida a estrutura essencial do jobs-orchestrator.json. */
function validateOrchestratorConfig(config) {
  if (!config || typeof config !== 'object') throw new Error('Config: não é um objeto JSON válido.');
  if (!config.system || !config.system.version) throw new Error('Config: campo system.version ausente.');
  if (!config.system.timezone) throw new Error('Config: campo system.timezone ausente.');
  if (!config.system.scheduling) throw new Error('Config: bloco system.scheduling ausente.');
  if (!config.system.scheduling.heartbeat_interval) throw new Error('Config: heartbeat_interval ausente.');
  if (!config.system.scheduling.default_repeat_policy) throw new Error('Config: default_repeat_policy ausente.');

  var validPolicies = ['ALL', 'ALL_SUCCEEDED', 'SCHEDULED', 'SCHEDULED_SUCCEEDED'];
  if (validPolicies.indexOf(config.system.scheduling.default_repeat_policy) === -1) {
    throw new Error('Config: default_repeat_policy inválido: ' + config.system.scheduling.default_repeat_policy);
  }
  parseIso8601Duration(config.system.scheduling.heartbeat_interval);

  if (!config.telemetry || !config.telemetry.spreadsheet_name || !config.telemetry.sheet_name) {
    throw new Error('Config: bloco telemetry incompleto.');
  }
  if (!config.jobs_schedule || typeof config.jobs_schedule !== 'object') {
    throw new Error('Config: jobs_schedule ausente.');
  }
  if (!config.visual_theme || !config.visual_theme.job_styles || !config.visual_theme.status_cells) {
    throw new Error('Config: visual_theme incompleto.');
  }
}

function generateRunId() {
  return 'run_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
}

function normalizeFirebaseUrl(url) {
  if (!url) return '';
  return url.replace(/\/+$/, '');
}

function buildBaseMetrics(jobId, opts) {
  opts = opts || {};
  return {
    jobId: jobId,
    runId: opts.runId || generateRunId(),
    timestamp: new Date().toISOString(),
    invocation: opts.invocation || 'MANUAL_MASTER',
    action: '',
    status: 'FAILED',
    itemsProcessed: 0,
    bytesDownloaded: 0,
    bytesSaved: 0,
    target: '',
    errorTrace: '',
    notes: '',
    completedSuccessfully: false
  };
}

function sanitizeError(err) {
  if (!err) return '';
  var msg = String(err.message || err);
  msg = msg.replace(/auth=[^&\s"']*/gi, 'auth=[REDACTED]');
  msg = msg.replace(/secret=[^&\s"']*/gi, 'secret=[REDACTED]');
  return msg.slice(0, 500);
}

function formatInvocationLabel(invocation) {
  var labels = {
    'SCHEDULED_MASTER': '[Ativação: Agendada Master]',
    'MANUAL_MASTER': '[Ativação: REST manual via Master]',
    'MANUAL_SOLO': '[Ativação: REST manual standalone]'
  };
  return labels[invocation] || '[Ativação: ' + (invocation || 'desconhecida') + ']';
}
