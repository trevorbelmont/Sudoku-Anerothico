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
//
// O panel-system.js é uma IIFE que chama init() imediatamente quando
// document.readyState !== 'loading'. O init() só progride se existir um
// elemento <main> com duas <section> filhas (com classes lg:col-span-2 e
// lg:col-span-10). Por isso o mock DOM abaixo reproduz essa estrutura para
// que o fluxo completo (loadSavedState → createCollapseButton →
// createResizer → applyPanelState) seja executado e a variável CSS
// --left-panel-width seja realmente definida via documentElement.style.setProperty.
// ─────────────────────────────────────────────────────────────

/**
 * Cria um elemento DOM mock genérico com a API mínima usada pelo panel-system.
 */
function makeMockEl(tag) {
  const classSet = new Set();
  return {
    tagName: tag ? String(tag).toUpperCase() : 'DIV',
    id: '',
    className: '',
    style: {},
    dataset: {},
    innerHTML: '',
    type: '',
    firstChild: null,
    nextSibling: null,
    parentNode: null,
    classList: {
      add: (c) => classSet.add(c),
      remove: (c) => classSet.delete(c),
      contains: (c) => classSet.has(c),
      toggle: (c) => { classSet.has(c) ? classSet.delete(c) : classSet.add(c); },
    },
    children: [],
    appendChild: function (child) { this.children.push(child); child.parentNode = this; if (!this.firstChild) this.firstChild = child; return child; },
    insertBefore: function (newNode, ref) { this.children.unshift(newNode); newNode.parentNode = this; this.firstChild = newNode; return newNode; },
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    setAttribute: jest.fn(),
    getAttribute: jest.fn(() => null),
    querySelector: () => null,
    querySelectorAll: () => [],
    remove: jest.fn(),
  };
}

/**
 * Monta um document mock com a estrutura esperada por init():
 *   <main>
 *     <section class="lg:col-span-2">…</section>   ← painel esquerdo
 *     <section class="lg:col-span-10">…</section>  ← área central
 *   </main>
 */
function makeDocumentMock(storage) {
  const setPropCalls = [];

  const leftSection = makeMockEl('section');
  leftSection.classList.add('lg:col-span-2');
  leftSection.classList.add('order-2');
  leftSection.classList.add('lg:order-1');

  const centerSection = makeMockEl('section');
  centerSection.classList.add('lg:col-span-10');
  centerSection.classList.add('order-1');
  centerSection.classList.add('lg:order-2');

  const mainEl = makeMockEl('main');
  mainEl.querySelectorAll = (sel) => {
    if (sel && sel.indexOf(':scope') !== -1) return [leftSection, centerSection];
    return [];
  };
  // Empacota as duas sections como "filhas" para o forEach do init()
  mainEl.children = [leftSection, centerSection];

  const documentMock = {
    readyState: 'complete',
    querySelector: (sel) => (sel === 'main' ? mainEl : null),
    querySelectorAll: () => [],
    getElementById: () => null,
    createElement: (tag) => makeMockEl(tag),
    documentElement: {
      style: { setProperty: (prop, val) => { setPropCalls.push({ prop, val }); } },
    },
    body: { classList: { contains: () => false }, style: {} },
    addEventListener: jest.fn(),
  };

  const localStorageMock = {
    getItem: (k) => (storage[k] !== undefined ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; },
  };

  return { documentMock, localStorageMock, mainEl, leftSection, centerSection, setPropCalls };
}

/**
 * Avalia o fonte do panel-system em um contexto controlado, retornando o
 * storage, as chamadas de setProperty e os elementos mock criados.
 */
function runPanelSystem(initialStorage = {}) {
  const storage = { ...initialStorage };
  const { documentMock, localStorageMock, mainEl, leftSection, centerSection, setPropCalls } =
    makeDocumentMock(storage);

  const src = fs.readFileSync(
    path.resolve(__dirname, '../../js/panel-system.js'), 'utf8'
  );

  // window mock com addEventListener para capturar handlers de drag
  const windowListeners = {};
  const windowMock = {
    addEventListener: jest.fn((evt, fn) => { windowListeners[evt] = fn; }),
  };

  const ctx = {
    document: documentMock,
    localStorage: localStorageMock,
    window: windowMock,
    renderSudokuBoard: jest.fn(),
    state: { board: [], symbols: [] },
    setTimeout: (fn, delay) => { if (!delay) fn(); },
  };

  const keys = Object.keys(ctx);
  const vals = keys.map(k => ctx[k]);
  try {
    // eslint-disable-next-line no-new-func
    new Function(...keys, src)(...vals);
  } catch (e) {
    // Falhas silenciosas (ex.: APIs de DOM não cobertas) não devem quebrar o teste
  }

  return { storage, setPropCalls, mainEl, leftSection, centerSection, windowListeners };
}

describe('panel-system localStorage persistence', () => {
  test('define --left-panel-width via CSS ao inicializar', () => {
    const { setPropCalls } = runPanelSystem();
    const widthCall = setPropCalls.find(c => c.prop === '--left-panel-width');
    expect(widthCall).toBeDefined();
    expect(widthCall.val).toMatch(/^\d+px$/);
  });

  test('sem estado salvo, aplica a largura DEFAULT (280px)', () => {
    const { setPropCalls } = runPanelSystem();
    const widthCall = setPropCalls.find(c => c.prop === '--left-panel-width');
    expect(widthCall).toBeDefined();
    expect(widthCall.val).toBe('280px');
  });

  test('lê largura salva do localStorage quando dentro dos limites', () => {
    const { setPropCalls, storage } = runPanelSystem({
      'sudoku_anerothico_left_panel_width_v1': '320',
    });
    const widthCall = setPropCalls.find(c => c.prop === '--left-panel-width');
    expect(widthCall).toBeDefined();
    expect(widthCall.val).toBe('320px');
    // storage permanece intacto (não foi regravado na inicialização)
    expect(storage['sudoku_anerothico_left_panel_width_v1']).toBe('320');
  });

  test('usa default quando a largura salva é menor que o mínimo (50 < 180)', () => {
    const { setPropCalls } = runPanelSystem({
      'sudoku_anerothico_left_panel_width_v1': '50',
    });
    const widthCall = setPropCalls.find(c => c.prop === '--left-panel-width');
    expect(widthCall).toBeDefined();
    expect(widthCall.val).toBe('280px');
  });

  test('usa default quando a largura salva é maior que o máximo (500 > 420)', () => {
    const { setPropCalls } = runPanelSystem({
      'sudoku_anerothico_left_panel_width_v1': '500',
    });
    const widthCall = setPropCalls.find(c => c.prop === '--left-panel-width');
    expect(widthCall).toBeDefined();
    expect(widthCall.val).toBe('280px');
  });

  test('usa default quando a largura salva não é numérica', () => {
    const { setPropCalls } = runPanelSystem({
      'sudoku_anerothico_left_panel_width_v1': 'abc',
    });
    const widthCall = setPropCalls.find(c => c.prop === '--left-panel-width');
    expect(widthCall).toBeDefined();
    expect(widthCall.val).toBe('280px');
  });

  test('aplica o limite máximo (420px) quando a largura salva é exatamente o máximo', () => {
    const { setPropCalls } = runPanelSystem({
      'sudoku_anerothico_left_panel_width_v1': '420',
    });
    const widthCall = setPropCalls.find(c => c.prop === '--left-panel-width');
    expect(widthCall.val).toBe('420px');
  });

  test('aplica o limite mínimo (180px) quando a largura salva é exatamente o mínimo', () => {
    const { setPropCalls } = runPanelSystem({
      'sudoku_anerothico_left_panel_width_v1': '180',
    });
    const widthCall = setPropCalls.find(c => c.prop === '--left-panel-width');
    expect(widthCall.val).toBe('180px');
  });
});

// ─────────────────────────────────────────────────────────────
// Colapso do painel (estado collapsed)
// ─────────────────────────────────────────────────────────────
describe('panel-system collapse state', () => {
  test('inicializa sem a classe collapsed quando storage está vazio', () => {
    const { leftSection } = runPanelSystem();
    expect(leftSection.classList.contains('collapsed')).toBe(false);
  });

  test('aplica a classe collapsed quando storage tem o flag true', () => {
    const { leftSection } = runPanelSystem({
      'sudoku_anerothico_left_panel_collapsed_v1': 'true',
    });
    expect(leftSection.classList.contains('collapsed')).toBe(true);
  });

  test('não aplica collapsed quando storage tem flag false', () => {
    const { leftSection } = runPanelSystem({
      'sudoku_anerothico_left_panel_collapsed_v1': 'false',
    });
    expect(leftSection.classList.contains('collapsed')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// Estrutura do layout criada pelo init()
// ─────────────────────────────────────────────────────────────
describe('panel-system init layout structure', () => {
  test('adiciona a classe app-main-layout ao <main>', () => {
    const { mainEl } = runPanelSystem();
    expect(mainEl.classList.contains('app-main-layout')).toBe(true);
  });

  test('atribui id="panel-left" e classe panel-left à seção esquerda', () => {
    const { leftSection } = runPanelSystem();
    expect(leftSection.id).toBe('panel-left');
    expect(leftSection.classList.contains('panel-left')).toBe(true);
  });

  test('adiciona a classe panel-center à seção central', () => {
    const { centerSection } = runPanelSystem();
    expect(centerSection.classList.contains('panel-center')).toBe(true);
  });

  test('remove as classes Tailwind de grid das seções', () => {
    const { leftSection, centerSection } = runPanelSystem();
    expect(leftSection.classList.contains('lg:col-span-2')).toBe(false);
    expect(leftSection.classList.contains('order-2')).toBe(false);
    expect(centerSection.classList.contains('lg:col-span-10')).toBe(false);
    expect(centerSection.classList.contains('order-1')).toBe(false);
  });
});
