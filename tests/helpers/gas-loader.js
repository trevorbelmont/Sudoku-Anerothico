/**
 * helpers/gas-loader.js
 *
 * Carrega e expõe funções puras dos scripts GAS (backend/GAS/) sem
 * exigir os serviços reais do Google (LockService, UrlFetchApp, DriveApp,
 * SpreadsheetApp, CacheService, ScriptApp, PropertiesService, etc.).
 *
 * Estratégia:
 *   - Lê os fontes como texto.
 *   - Injeta stubs mínimos dos serviços GAS como variáveis globais do escopo.
 *   - Avalia em new Function() isolado.
 *   - Exporta as funções testáveis via objeto _exports.
 *
 * Os mocks provam apenas a lógica local dos módulos.
 * Não provam: autorização real, deploy, permissões de Drive/Sheets,
 * trigger real, comportamento da instância Firebase, quota de API.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const GAS = p => fs.readFileSync(
  path.resolve(__dirname, '../../backend/GAS', p), 'utf8'
);

// ─────────────────────────────────────────────────────────────────────────────
// Stubs de serviços GAS
// ─────────────────────────────────────────────────────────────────────────────

function makeLockStub(acquires) {
  return {
    getScriptLock: () => ({
      tryLock: () => acquires !== false,
      waitLock: () => {},
      releaseLock: () => {}
    })
  };
}

function makeUrlFetchStub(responses) {
  return {
    fetch: (url, opts) => {
      if (responses && typeof responses === 'function') return responses(url, opts);
      return {
        getResponseCode: () => 200,
        getContentText: () => 'null',
        getContent: () => []
      };
    }
  };
}

function makeCacheStub() {
  const store = {};
  return {
    getScriptCache: () => ({
      get: (k) => store[k] || null,
      put: (k, v) => { store[k] = v; }
    })
  };
}

function makePropertiesStub(props) {
  const data = Object.assign({}, props || {});
  return {
    getScriptProperties: () => ({
      getProperty: (k) => data[k] || null,
      setProperty: (k, v) => { data[k] = v; }
    })
  };
}

function makeUtilitiesStub() {
  return {
    formatDate: (date, tz, fmt) => date.toISOString().slice(0, 19).replace('T', ' ')
  };
}

function makeContentServiceStub() {
  const TextOutput = (text) => ({
    setMimeType: () => ({ _text: text }),
    _text: text
  });
  return {
    createTextOutput: (text) => TextOutput(text),
    MimeType: { JSON: 'application/json', PLAIN_TEXT: 'text/plain' }
  };
}

function makeDriveAppStub() {
  return {
    getFolderById: () => ({
      createFile: (name, content) => ({
        getSize: () => Buffer.byteLength(content, 'utf8')
      }),
      addFile: () => {}
    }),
    getFileById: () => ({ getId: () => 'FILE_ID' }),
    getRootFolder: () => ({ removeFile: () => {} })
  };
}

function makeSpreadsheetAppStub() {
  const rows = [];
  const sheet = {
    getName: () => 'JobsTelemetry',
    getLastRow: () => rows.length,
    getRange: (r, c, nr, nc) => ({
      setValues: (vals) => { vals.forEach(v => rows.push(v)); },
      getValues: () => [Array(11).fill('').map((_, i) => [
        'JOB_ID','Timestamp','Invocation','Action','Status',
        'Items_Processed','Bytes_Down','Bytes_Drive','Target','Errors','Notes'
      ][i] || '')],
      setBackground: () => {},
      setFontColor: () => {},
      setWrap: () => {}
    }),
    setFrozenRows: () => {},
    insertSheet: () => sheet,
    _rows: rows
  };
  const ss = {
    getId: () => 'SHEET_ID_CREATED',
    getSheets: () => [sheet],
    getSheetByName: (name) => name === 'JobsTelemetry' ? sheet : null,
    insertSheet: () => sheet
  };
  return {
    create: () => ss,
    openById: () => ss,
    _rows: rows,
    _sheet: sheet
  };
}

function makeScriptAppStub() {
  const triggers = [];
  const TriggerBuilder = {
    timeBased: () => ({
      everyHours: (n) => ({ create: () => triggers.push({ unit: 'hours', value: n }) }),
      everyMinutes: (n) => ({ create: () => triggers.push({ unit: 'minutes', value: n }) }),
      everyDays: (n) => ({ atHour: () => ({ inTimezone: () => ({ create: () => triggers.push({ unit: 'days', value: n }) }) }) }),
      everyWeeks: (n) => ({ atHour: () => ({ inTimezone: () => ({ create: () => triggers.push({ unit: 'weeks', value: n }) }) }) })
    })
  };
  return {
    getProjectTriggers: () => triggers.map(t => ({ getHandlerFunction: () => 'runScheduledMasterOrchestrator' })).slice(0, 0),
    newTrigger: () => TriggerBuilder,
    _triggers: triggers
  };
}

function makeMimeTypeStub() {
  return { PLAIN_TEXT: 'text/plain', JSON: 'application/json' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Loader do Cold Storage (backup-coldstorage.js)
// ─────────────────────────────────────────────────────────────────────────────

function loadGASColdStorage(options) {
  options = options || {};

  // O master_orchestrator.js define as funções utilitárias canônicas.
  // backup-coldstorage.js depende delas via escopo global GAS.
  // Aqui carregamos ambos em conjunto num único escopo.
  var masterSrc = GAS('master_orchestrator.js');
  var coldSrc   = GAS('backup-coldstorage.js');

  var exports = {};
  var lockStub = makeLockStub(options.lockAcquires);
  var cacheStub = makeCacheStub();
  var propsStub = makePropertiesStub(options.props || {});
  var urlFetchStub = makeUrlFetchStub(options.urlFetch);

  var ctx = {
    LockService: lockStub,
    CacheService: cacheStub,
    PropertiesService: propsStub,
    UrlFetchApp: urlFetchStub,
    DriveApp: makeDriveAppStub(),
    SpreadsheetApp: makeSpreadsheetAppStub(),
    Utilities: makeUtilitiesStub(),
    ContentService: makeContentServiceStub(),
    MimeType: makeMimeTypeStub(),
    ScriptApp: makeScriptAppStub(),
    console: { log: () => {}, warn: () => {}, error: () => {} },
    _exports: exports
  };

  // JOB_HANDLERS referencia executeColdStorageRooms que será definida no cold storage
  // Precisamos de um placeholder para o master não falhar ao declarar JOB_HANDLERS
  ctx.executeColdStorageRooms = function() { return {}; };

  var wrapper = masterSrc + '\n' + coldSrc + '\n' +
    '_exports.parseButIgnoreText       = parseButIgnoreText;\n' +
    '_exports.compileButIgnoreRule      = compileButIgnoreRule;\n' +
    '_exports.applyButIgnoreFilter      = applyButIgnoreFilter;\n' +
    '_exports.filterEligibleRooms       = filterEligibleRooms;\n' +
    '_exports.filterObjectByRules       = filterObjectByRules;\n' +
    '_exports.loadAndParseButIgnore     = loadAndParseButIgnore;\n' +
    '_exports.coldStorageDeepCopy       = coldStorageDeepCopy;\n' +
    '_exports.executeColdStorageRooms   = executeColdStorageRooms;\n' +
    '_exports.executeFirebaseBackup     = executeFirebaseBackup;\n' +
    '_exports.runColdStorageCore        = runColdStorageCore;\n' +
    '_exports.COLDSTORAGE_JOB_ID        = COLDSTORAGE_JOB_ID;\n' +
    '_exports.TELEMETRY_HEADERS         = TELEMETRY_HEADERS;\n';

  var keys = Object.keys(ctx);
  var vals = keys.map(k => ctx[k]);
  // eslint-disable-next-line no-new-func
  new Function(...keys, wrapper)(...vals);
  return exports;
}

// ─────────────────────────────────────────────────────────────────────────────
// Loader do Master Orchestrator
// ─────────────────────────────────────────────────────────────────────────────

function loadGASMaster(options) {
  options = options || {};

  var masterSrc = GAS('master_orchestrator.js');
  var coldSrc   = GAS('backup-coldstorage.js');

  var exports = {};
  var lockStub = makeLockStub(options.lockAcquires);
  var cacheStub = makeCacheStub();
  var propsStub = makePropertiesStub(options.props || {});
  var urlFetchStub = makeUrlFetchStub(options.urlFetch);

  var ctx = {
    LockService: lockStub,
    CacheService: cacheStub,
    PropertiesService: propsStub,
    UrlFetchApp: urlFetchStub,
    DriveApp: makeDriveAppStub(),
    SpreadsheetApp: makeSpreadsheetAppStub(),
    Utilities: makeUtilitiesStub(),
    ContentService: makeContentServiceStub(),
    MimeType: makeMimeTypeStub(),
    ScriptApp: makeScriptAppStub(),
    console: { log: () => {}, warn: () => {}, error: () => {} },
    _exports: exports
  };

  // placeholder para evitar erro de referência ao declarar JOB_HANDLERS
  ctx.executeColdStorageRooms = function() { return {}; };

  var wrapper = masterSrc + '\n' + coldSrc + '\n' +
    '_exports.parseIso8601Duration      = parseIso8601Duration;\n' +
    '_exports.selectAnchorTimestamp     = selectAnchorTimestamp;\n' +
    '_exports.validateOrchestratorConfig = validateOrchestratorConfig;\n' +
    '_exports.loadAndValidateConfig     = loadAndValidateConfig;\n' +
    '_exports.parseTriggerSpec          = parseTriggerSpec;\n' +
    '_exports.evaluateJobSchedule       = evaluateJobSchedule;\n' +
    '_exports.buildBaseMetrics          = buildBaseMetrics;\n' +
    '_exports.sanitizeError             = sanitizeError;\n' +
    '_exports.formatInvocationLabel     = formatInvocationLabel;\n' +
    '_exports.generateRunId             = generateRunId;\n' +
    '_exports.normalizeFirebaseUrl      = normalizeFirebaseUrl;\n';

  var keys = Object.keys(ctx);
  var vals = keys.map(k => ctx[k]);
  // eslint-disable-next-line no-new-func
  new Function(...keys, wrapper)(...vals);
  return exports;
}

module.exports = {
  loadGASColdStorage,
  loadGASMaster,
  makeLockStub,
  makeUrlFetchStub,
  makeCacheStub,
  makePropertiesStub,
  makeDriveAppStub,
  makeSpreadsheetAppStub
};
