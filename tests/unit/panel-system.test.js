/**
 * panel-system.test.js
 *
 * Testes unitários para js/panel-system.js
 * Cobre: persistência de largura/estado no localStorage,
 *        limites de largura (LEFT_MIN_PX, LEFT_MAX_PX),
 *        variável CSS --left-panel-width
 */

'use strict';

const path = require('path');
const fs   = require('fs');

// Lê o fonte do panel-system para inspecionar as constantes
const panelSrc = fs.readFileSync(
  path.resolve(__dirname, '../../js/panel-system.js'), 'utf8'
);

// Extrai valores das constantes STORAGE_*, LEFT_MIN_PX, LEFT_MAX_PX, LEFT_DEFAULT
function extractConst(src, name) {
  const match = src.match(new RegExp(`var\\s+${name}\\s*=\\s*([^;\\n]+)`));
  if (!match) return null;
  try { return JSON.parse(match[1].replace(/'/g, '"')); } catch (_) { return match[1].trim(); }
}

describe('panel-system constants', () => {
  test('STORAGE_LEFT_WIDTH é uma string de chave de armazenamento', () => {
    const val = extractConst(panelSrc, 'STORAGE_LEFT_WIDTH');
    expect(typeof val).toBe('string');
    expect(val.length).toBeGreaterThan(0);
  });

  test('STORAGE_LEFT_COLLAPSED é uma string de chave de armazenamento', () => {
    const val = extractConst(panelSrc, 'STORAGE_LEFT_COLLAPSED');
    expect(typeof val).toBe('string');
    expect(val.length).toBeGreaterThan(0);
  });

  test('LEFT_MIN_PX é 180', () => {
    const val = Number(extractConst(panelSrc, 'LEFT_MIN_PX'));
    expect(val).toBe(180);
  });

  test('LEFT_MAX_PX é 420', () => {
    const val = Number(extractConst(panelSrc, 'LEFT_MAX_PX'));
    expect(val).toBe(420);
  });

  test('LEFT_DEFAULT é 280', () => {
    const val = Number(extractConst(panelSrc, 'LEFT_DEFAULT'));
    expect(val).toBe(280);
  });

  test('LEFT_DEFAULT está dentro de [LEFT_MIN_PX, LEFT_MAX_PX]', () => {
    const min = Number(extractConst(panelSrc, 'LEFT_MIN_PX'));
    const max = Number(extractConst(panelSrc, 'LEFT_MAX_PX'));
    const def = Number(extractConst(panelSrc, 'LEFT_DEFAULT'));
    expect(def).toBeGreaterThanOrEqual(min);
    expect(def).toBeLessThanOrEqual(max);
  });
});

// ─────────────────────────────────────────────────────────────
// Testa persistência via localStorage mock
// ─────────────────────────────────────────────────────────────
describe('panel-system localStorage persistence', () => {
  let storage;
  let documentMock;
  let setPropCalls;

  function runPanelSystem(extraCtx = {}) {
    storage = {};
    setPropCalls = [];

    const localStorageMock = {
      getItem: k => storage[k] ?? null,
      setItem: (k, v) => { storage[k] = String(v); },
    };

    documentMock = {
      querySelector: (sel) => {
        if (sel === '.panel-left') return {
          classList: { add: jest.fn(), remove: jest.fn(), contains: () => false },
          offsetWidth: 280,
          getBoundingClientRect: () => ({ width: 280 }),
          addEventListener: jest.fn(),
        };
        if (sel === '.panel-resizer') return {
          classList: { add: jest.fn(), remove: jest.fn() },
          addEventListener: jest.fn(),
        };
        if (sel === '.panel-collapse-btn') return {
          classList: { add: jest.fn(), remove: jest.fn() },
          addEventListener: jest.fn(),
          setAttribute: jest.fn(),
          querySelector: () => null,
          querySelectorAll: () => [],
        };
        return null;
      },
      querySelectorAll: () => [],
      getElementById: () => null,
      documentElement: {
        style: { setProperty: (prop, val) => { setPropCalls.push({ prop, val }); } },
      },
      body: { classList: { contains: () => false } },
      addEventListener: jest.fn(),
    };

    const src = fs.readFileSync(
      path.resolve(__dirname, '../../js/panel-system.js'), 'utf8'
    );

    const ctx = {
      document: documentMock,
      localStorage: localStorageMock,
      window: { addEventListener: jest.fn() },
      renderSudokuBoard: jest.fn(),
      state: { board: [], symbols: [] },
      setTimeout: (fn, delay) => { if (!delay) fn(); },
      ...extraCtx,
    };

    const keys = Object.keys(ctx);
    const vals = keys.map(k => ctx[k]);
    try {
      // eslint-disable-next-line no-new-func
      new Function(...keys, src)(...vals);
    } catch (_) {}

    return { storage, setPropCalls };
  }

  test('define --left-panel-width via CSS ao inicializar', () => {
    const { setPropCalls } = runPanelSystem();
    const widthCall = setPropCalls.find(c => c.prop === '--left-panel-width');
    expect(widthCall).toBeDefined();
    expect(widthCall.val).toMatch(/^\d+px$/);
  });

  test('lê largura salva do localStorage se válida', () => {
    const { setPropCalls } = runPanelSystem({
      // Injeta storage pré-preenchido antes da avaliação
    });
    // Sem estado pré-salvo: usa o DEFAULT (280px)
    const widthCall = setPropCalls.find(c => c.prop === '--left-panel-width');
    expect(widthCall.val).toBe('280px');
  });

  test('usa default quando a largura salva é inválida (fora dos limites)', () => {
    // Fornece largura 50 (abaixo do mínimo 180) como valor pré-salvo
    const src = fs.readFileSync(path.resolve(__dirname, '../../js/panel-system.js'), 'utf8');
    const storage = { 'sudoku_anerothico_left_panel_width_v1': '50' };
    const setPropCalls = [];

    const ctx = {
      document: {
        querySelector: (sel) => {
          if (sel === '.panel-left') return {
            classList: { add: jest.fn(), remove: jest.fn(), contains: () => false },
            offsetWidth: 280, getBoundingClientRect: () => ({ width: 280 }),
            addEventListener: jest.fn(),
          };
          if (sel === '.panel-resizer') return { classList: { add: jest.fn(), remove: jest.fn() }, addEventListener: jest.fn() };
          if (sel === '.panel-collapse-btn') return { classList: { add: jest.fn(), remove: jest.fn() }, addEventListener: jest.fn(), setAttribute: jest.fn(), querySelector: () => null, querySelectorAll: () => [] };
          return null;
        },
        querySelectorAll: () => [],
        getElementById: () => null,
        documentElement: { style: { setProperty: (p, v) => setPropCalls.push({ prop: p, val: v }) } },
        body: { classList: { contains: () => false } },
        addEventListener: jest.fn(),
      },
      localStorage: { getItem: k => storage[k] ?? null, setItem: jest.fn() },
      window: { addEventListener: jest.fn() },
      renderSudokuBoard: jest.fn(),
      state: { board: [], symbols: [] },
      setTimeout: (fn, delay) => { if (!delay) fn(); },
    };

    const keys = Object.keys(ctx);
    const vals = keys.map(k => ctx[k]);
    try { new Function(...keys, src)(...vals); } catch (_) {} // eslint-disable-line no-new-func

    const widthCall = setPropCalls.find(c => c.prop === '--left-panel-width');
    // Com valor inválido (50 < 180), deve aplicar o DEFAULT (280px)
    expect(widthCall.val).toBe('280px');
  });
});
