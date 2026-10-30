/**
 * helpers/engine-loader.js
 *
 * Carrega e expõe todas as funções puras do sudoku-engine.js e de módulos
 * auxiliares sem exigir DOM, Firebase ou qualquer dependência externa.
 *
 * Estratégia:
 *  - Lê os fontes como texto.
 *  - Remove as linhas de import/export ES6 (usadas apenas pelo firebase-client).
 *  - Avalia em um Function() isolado, injetando stubs mínimos para os
 *    identificadores globais que o motor referencia (state, DIFFICULTY_REMOVAL_RATIOS,
 *    document, etc.).
 *  - Retorna um objeto com todas as funções expostas.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const JS = p => fs.readFileSync(path.resolve(__dirname, '../../js', p), 'utf8');

// Remove linhas de import/export ES6 que quebrariam a avaliação com new Function()
function stripModuleDirectives(src) {
  return src
    .replace(/^\s*import\s+.*?['"];?\s*$/gm, '')
    .replace(/^\s*export\s+/gm, '');
}

// ─── Stubs mínimos ─────────────────────────────────────────────────────────

function makeDOMStub() {
  return {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    documentElement: { setAttribute: () => {}, style: { setProperty: () => {} } },
    body: { classList: { contains: () => false } },
    createElement: (tag) => ({
      tagName: tag.toUpperCase(),
      className: '',
      style: {},
      dataset: {},
      classList: { add: () => {}, remove: () => {}, toggle: () => {} },
      appendChild: () => {},
      getAttribute: () => null,
      setAttribute: () => {},
    }),
  };
}

function makeStateStubb() {
  return {
    mode: 'standard',
    difficulty: 'medio',
    N: 9,
    blockR: 3,
    blockC: 3,
    symbols: ['1','2','3','4','5','6','7','8','9'],
    board: [],
    initial: [],
    solution: [],
    notes: [],
    nasaContributions: [],
    nasaCalls: 0,
    revealedErrors: [],
    focusedCell: { r: 0, c: 0 },
    highlightedSymbol: null,
    pencilMode: false,
    immediateErrorCheck: false,
    highlightSameNumbers: true,
    timerSeconds: 0,
    timerRunning: false,
    timerInterval: null,
    completed: false,
    historyTab: 'ongoing',
    typingBuffer: '',
    typingTimeout: null,
    isManualCreating: false,
    boardZoom: 1,
    boardFocusMode: false,
    boardZoomBeforeFocus: null,
    visualSettings: {},
    multiplayer: {
      active: false, roomId: null, playerName: 'Jogador',
      playerId: 'player_test123', listeners: [], peers: {},
      contributions: {}, members: {}, players: {}, roomMode: 'coop',
      realtimeMetrics: false, color: '',
    },
    minVal: 1, maxVal: 9, includeZero: false,
    gameName: '', gameId: null,
  };
}

function loadEngineModule() {
  const src = stripModuleDirectives(JS('sudoku-engine.js'));

  // Stubs para funções de UI chamadas pelo engine
  const noopFns = [
    'updateDifficultyCluesUI', 'renderSudokuBoard', 'showToast',
    'updateCustomRangePreview', 'updateProgressUI', 'saveCurrentGameState',
    'syncModeTabsUI', 'updateHeaderSubtitle', 'renderVirtualNumpad',
    'updateAllCellVisuals',
  ].reduce((acc, name) => { acc[name] = () => {}; return acc; }, {});

  const DIFFICULTY_REMOVAL_RATIOS = {
    facil: 0.42, medio: 0.54, dificil: 0.63, uaiso: 0.716, doido: 0.79,
  };

  const state = makeStateStubb();
  const document = makeDOMStub();

  const exports = {};

  // Avalia o módulo; as funções ficam no escopo local da Function()
  // Precisamos expô-las explicitamente — usamos um objeto compartilhado
  const ctx = {
    state,
    document,
    DIFFICULTY_REMOVAL_RATIOS,
    ...noopFns,
    _exports: exports,
  };

  // Injeta as funções no objeto _exports ao final
  const wrapper = `
${src}

// Auto-export de todas as funções declaradas no engine
_exports.isValidMatrix           = isValidMatrix;
_exports.validateGameState       = validateGameState;
_exports.buildSymbolsFromRange   = buildSymbolsFromRange;
_exports.computeBlockDimensions  = computeBlockDimensions;
_exports.shuffleArray             = shuffleArray;
_exports.generateCompleteValidGrid = generateCompleteValidGrid;
_exports.solvePartialGrid         = solvePartialGrid;
_exports.countSolutionsMRV        = countSolutionsMRV;
_exports.createUniqueSudokuPuzzle = createUniqueSudokuPuzzle;
_exports.buildIsomorphic9x9FromSeed = buildIsomorphic9x9FromSeed;
_exports.SEEDS_17_CLUES           = SEEDS_17_CLUES;
_exports.SEEDS_UAISO_BASE         = SEEDS_UAISO_BASE;
_exports.DIFFICULTY_REMOVAL_RATIOS = DIFFICULTY_REMOVAL_RATIOS;
  `;

  const keys = Object.keys(ctx);
  const vals = keys.map(k => ctx[k]);
  // eslint-disable-next-line no-new-func
  new Function(...keys, wrapper)(...vals);

  return exports;
}

function loadAppStateModule() {
  const src = stripModuleDirectives(JS('app-state.js'));

  // Stub de localStorage
  const storage = {};
  const localStorageMock = {
    getItem: k => storage[k] ?? null,
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: k => { delete storage[k]; },
    clear: () => { Object.keys(storage).forEach(k => delete storage[k]); },
  };

  const cryptoMock = {
    getRandomValues: (arr) => { for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256); return arr; },
  };

  const Intl = { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: 'America/Sao_Paulo' }) }) };

  const exports = { _storage: storage };

  const wrapper = `
${src}

_exports.STORAGE_KEYS               = STORAGE_KEYS;
_exports.DIFFICULTY_LABELS          = DIFFICULTY_LABELS;
_exports.DIFFICULTY_REMOVAL_RATIOS  = DIFFICULTY_REMOVAL_RATIOS;
_exports.ROOM_PROTECTION_DAYS       = ROOM_PROTECTION_DAYS;
_exports.state                      = state;
_exports.getOrCreatePersistentPlayerId = getOrCreatePersistentPlayerId;
_exports.loadVisualSettings         = loadVisualSettings;
  `;

  const ctx = { localStorage: localStorageMock, crypto: cryptoMock, Intl, _exports: exports };
  const keys = Object.keys(ctx);
  const vals = keys.map(k => ctx[k]);
  // eslint-disable-next-line no-new-func
  new Function(...keys, wrapper)(...vals);

  return exports;
}

function loadUiHelpersModule() {
  const src = stripModuleDirectives(JS('ui-helpers.js'));
  const exports = {};
  const wrapper = `
${src}
_exports.formatTime = formatTime;
_exports.showToast  = showToast;
  `;
  // showToast precisa de DOM; injetamos stub
  const document = makeDOMStub();
  const container = {
    appendChild: () => {},
    querySelectorAll: () => [],
  };
  const domSpy = {
    ...document,
    getElementById: (id) => id === 'toast-container' ? container : null,
    createElement: (tag) => ({
      tagName: tag.toUpperCase(),
      className: '',
      style: {},
      appendChild: () => {},
      remove: () => {},
    }),
  };
  const ctx = { document: domSpy, setTimeout: (fn) => fn(), _exports: exports };
  const keys = Object.keys(ctx);
  const vals = keys.map(k => ctx[k]);
  // eslint-disable-next-line no-new-func
  new Function(...keys, wrapper)(...vals);
  return exports;
}

function loadMultiplayerServiceColorModule() {
  // Extrai apenas as funções puras de cor (sem Firebase, sem state)
  const src = stripModuleDirectives(JS('multiplayer-service.js'));

  const exports = {};
  const stateMock = {
    multiplayer: { color: '', playerId: 'test_player', playerName: 'Tester', players: {}, members: {}, peers: {} },
  };

  const wrapper = `
${src}
_exports.normalizePlayerColor          = normalizePlayerColor;
_exports.stablePlayerColorHash         = stablePlayerColorHash;
_exports.playerColorToOKLab            = playerColorToOKLab;
_exports.playerColorPerceptualDistance = playerColorPerceptualDistance;
_exports.chooseMostDistinctPlayerColor = chooseMostDistinctPlayerColor;
_exports.detectClientBrowser           = detectClientBrowser;
_exports.detectClientOperatingSystem   = detectClientOperatingSystem;
_exports.collectClientMetadata         = collectClientMetadata;
_exports.MULTIPLAYER_PLAYER_COLOR_PALETTE = MULTIPLAYER_PLAYER_COLOR_PALETTE;
  `;

  const navigator = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
    language: 'pt-BR', languages: ['pt-BR', 'en-US'], onLine: true, platform: 'Win32',
    connection: null, userAgentData: null,
  };

  // getFirebaseAPI e roomPath são usados fora das funções puras; o wrapper não os chama
  const noops = {
    getFirebaseAPI: () => null,
    roomPath: () => '',
    state: stateMock,
  };

  const ctx = { navigator, _exports: exports, ...noops };
  const keys = Object.keys(ctx);
  const vals = keys.map(k => ctx[k]);
  // eslint-disable-next-line no-new-func
  try { new Function(...keys, wrapper)(...vals); } catch (e) {
    // Algumas funções assíncronas (async) que dependem de Firebase falharão silenciosamente;
    // apenas as puras exportadas acima são necessárias para os testes de cor.
  }
  return exports;
}

function loadSharingModule() {
  const src = stripModuleDirectives(JS('sharing.js'));
  const exports = {};

  const stateMock = makeStateStubb();

  // solvePartialGrid e outras funções do engine precisam estar disponíveis
  const engine = loadEngineModule();

  const wrapper = `
${src}
_exports.processLoadedCode   = processLoadedCode;
_exports.shareCurrentPuzzleURL      = shareCurrentPuzzleURL;
_exports.shareCurrentPuzzleStateURL = shareCurrentPuzzleStateURL;
  `;

  const ctx = {
    state: stateMock,
    _exports: exports,
    validateGameState: engine.validateGameState,
    isValidMatrix: engine.isValidMatrix,
    solvePartialGrid: engine.solvePartialGrid,
    ensureNasaContributionGrid: () => {},
    buildSymbolsFromRange: engine.buildSymbolsFromRange,
    // DOM/UI stubs
    showToast: () => {},
    syncModeTabsUI: () => {},
    syncDifficultyButtonsUI: () => {},
    updateHeaderSubtitle: () => {},
    renderVirtualNumpad: () => {},
    renderSudokuBoard: () => {},
    startTimer: () => {},
    pauseTimer: () => {},
    saveCurrentGameState: () => {},
    formatTime: (s) => String(s),
    setGameNameInput: () => {},
    updateProgressUI: () => {},
    updateNasaContributionSummary: () => {},
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    document: {
      getElementById: () => ({ textContent: '', classList: { remove: () => {}, add: () => {} } }),
    },
    btoa: (s) => Buffer.from(s).toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('utf8'),
    encodeURIComponent,
    decodeURIComponent,
  };

  const keys = Object.keys(ctx);
  const vals = keys.map(k => ctx[k]);
  // eslint-disable-next-line no-new-func
  new Function(...keys, wrapper)(...vals);
  return { exports, state: stateMock };
}

function loadPanelSystemModule() {
  const src = stripModuleDirectives(JS('panel-system.js'));
  const exports = {};

  const storage = {};
  const localStorageMock = {
    getItem: k => storage[k] ?? null,
    setItem: (k, v) => { storage[k] = String(v); },
  };

  const panelEl = {
    classList: { add: jest.fn(), remove: jest.fn(), contains: () => false },
    offsetWidth: 280,
    getBoundingClientRect: () => ({ width: 280 }),
  };

  const resizerEl = {
    classList: { add: jest.fn(), remove: jest.fn() },
    addEventListener: jest.fn(),
  };

  const collapseEl = {
    classList: { add: jest.fn(), remove: jest.fn() },
    addEventListener: jest.fn(),
    setAttribute: jest.fn(),
    querySelector: () => null,
    querySelectorAll: () => [],
  };

  const documentMock = {
    querySelector: (sel) => {
      if (sel === '.panel-left')    return panelEl;
      if (sel === '.panel-resizer') return resizerEl;
      if (sel === '.panel-collapse-btn') return collapseEl;
      return null;
    },
    querySelectorAll: () => [],
    getElementById: () => null,
    documentElement: { style: { setProperty: jest.fn() } },
    body: { classList: { contains: () => false } },
    addEventListener: jest.fn(),
  };

  const wrapper = `
${src}
// PanelSystem é uma IIFE; expõe funções via objeto interno
  `;

  // A IIFE se auto-executa mas depende de document.querySelector; passamos o mock
  const ctx = {
    document: documentMock,
    localStorage: localStorageMock,
    window: { addEventListener: jest.fn() },
    renderSudokuBoard: jest.fn(),
    state: makeStateStubb(),
    setTimeout: (fn, delay) => { if (delay === 0) fn(); },
    _exports: exports,
    _panelEl: panelEl,
    _documentMock: documentMock,
  };

  const keys = Object.keys(ctx);
  const vals = keys.map(k => ctx[k]);
  try {
    // eslint-disable-next-line no-new-func
    new Function(...keys, wrapper)(...vals);
  } catch (_) {}

  return { storage, panelEl, documentMock };
}

module.exports = {
  loadEngineModule,
  loadAppStateModule,
  loadUiHelpersModule,
  loadMultiplayerServiceColorModule,
  loadSharingModule,
  loadPanelSystemModule,
  makeStateStubb,
  makeDOMStub,
};
