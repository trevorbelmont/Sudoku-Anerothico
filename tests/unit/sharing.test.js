/**
 * sharing.test.js
 *
 * Testes unitários para js/sharing.js
 * Cobre: processLoadedCode (carga de grade/estado),
 *        shareCurrentPuzzleURL, shareCurrentPuzzleStateURL
 */

'use strict';

const { loadSharingModule, loadEngineModule } = require('../helpers/engine-loader');

// ─────────────────────────────────────────────────────────────
// Helpers para gerar payloads de compartilhamento
// ─────────────────────────────────────────────────────────────
function makeValidGridPayload(overrides = {}) {
  const sym9 = ['1','2','3','4','5','6','7','8','9'];
  const engine = loadEngineModule();
  const { solution, initial } = engine.createUniqueSudokuPuzzle(9, 3, 3, sym9, 'facil');
  const payload = {
    m: 'standard',
    d: 'facil',
    s: sym9,
    N: 9,
    bR: 3,
    bC: 3,
    i: initial,
    sol: solution,
    ...overrides,
  };
  return Buffer.from(encodeURIComponent(JSON.stringify(payload))).toString('base64');
}

function makeValidStatePayload(overrides = {}) {
  const sym9 = ['1','2','3','4','5','6','7','8','9'];
  const engine = loadEngineModule();
  const { solution, initial } = engine.createUniqueSudokuPuzzle(9, 3, 3, sym9, 'facil');
  const payload = {
    st: 1,
    m: 'standard',
    d: 'facil',
    s: sym9,
    N: 9,
    bR: 3,
    bC: 3,
    i: initial,
    sol: solution,
    b: initial.map(r => r.slice()),
    n: Array.from({ length: 9 }, () => Array(9).fill([])),
    re: Array.from({ length: 9 }, () => Array(9).fill(false)),
    nc: Array.from({ length: 9 }, () => Array(9).fill(false)),
    nca: 0,
    t: 120,
    c: false,
    ...overrides,
  };
  return Buffer.from(encodeURIComponent(JSON.stringify(payload))).toString('base64');
}

// ─────────────────────────────────────────────────────────────
// processLoadedCode
// ─────────────────────────────────────────────────────────────
describe('processLoadedCode', () => {
  let sharing;
  let state;

  beforeEach(() => {
    const loaded = loadSharingModule();
    sharing = loaded.exports;
    state = loaded.state;
  });

  test('carrega grade válida (modo puzzle) e retorna true', () => {
    const encoded = makeValidGridPayload();
    const result = sharing.processLoadedCode(encoded);
    expect(result).toBe(true);
  });

  test('após carregar grade, state.N é 9', () => {
    const encoded = makeValidGridPayload();
    sharing.processLoadedCode(encoded);
    expect(state.N).toBe(9);
  });

  test('após carregar grade, state.initial é uma matriz 9×9', () => {
    const encoded = makeValidGridPayload();
    sharing.processLoadedCode(encoded);
    expect(state.initial).toHaveLength(9);
    state.initial.forEach(row => expect(row).toHaveLength(9));
  });

  test('carrega estado completo (st=1) e retorna true', () => {
    const encoded = makeValidStatePayload();
    const result = sharing.processLoadedCode(encoded);
    expect(result).toBe(true);
  });

  test('após carregar estado, timerSeconds é restaurado', () => {
    const encoded = makeValidStatePayload({ t: 300 });
    sharing.processLoadedCode(encoded);
    expect(state.timerSeconds).toBe(300);
  });

  test('retorna false para payload corrompido', () => {
    const result = sharing.processLoadedCode('notvalidbase64!!!');
    expect(result).toBe(false);
  });

  test('retorna false para JSON vazio "{}"', () => {
    const encoded = Buffer.from(encodeURIComponent('{}')).toString('base64');
    const result = sharing.processLoadedCode(encoded);
    expect(result).toBe(false);
  });

  test('retorna false se N for inválido (N=3)', () => {
    const sym3 = ['1','2','3'];
    const encoded = makeValidGridPayload({ N: 3, bR: 3, bC: 1, s: sym3, i: Array.from({ length: 3 }, () => Array(3).fill('')) });
    const result = sharing.processLoadedCode(encoded);
    expect(result).toBe(false);
  });

  test('retorna false se bR × bC !== N', () => {
    const sym9 = ['1','2','3','4','5','6','7','8','9'];
    const engine = loadEngineModule();
    const { initial, solution } = engine.createUniqueSudokuPuzzle(9, 3, 3, sym9, 'facil');
    const encoded = makeValidGridPayload({ bR: 2, bC: 2, i: initial, sol: solution });
    const result = sharing.processLoadedCode(encoded);
    expect(result).toBe(false);
  });

  test('modo "standard" é preservado após carga', () => {
    const encoded = makeValidGridPayload({ m: 'standard' });
    sharing.processLoadedCode(encoded);
    expect(state.mode).toBe('standard');
  });

  test('dificuldade é preservada após carga', () => {
    const encoded = makeValidGridPayload({ d: 'dificil' });
    sharing.processLoadedCode(encoded);
    expect(state.difficulty).toBe('dificil');
  });
});

// ─────────────────────────────────────────────────────────────
// shareCurrentPuzzleURL / shareCurrentPuzzleStateURL
// ─────────────────────────────────────────────────────────────
describe('shareCurrentPuzzleURL', () => {
  test('é uma função exportada', () => {
    const { exports } = loadSharingModule();
    expect(typeof exports.shareCurrentPuzzleURL).toBe('function');
  });

  test('não lança exceção ao ser chamada com state válido', () => {
    const { exports, state } = loadSharingModule();
    // Popula state com dados mínimos
    const engine = loadEngineModule();
    const sym9 = ['1','2','3','4','5','6','7','8','9'];
    const { solution, initial } = engine.createUniqueSudokuPuzzle(9, 3, 3, sym9, 'facil');
    state.N = 9; state.blockR = 3; state.blockC = 3; state.symbols = sym9;
    state.mode = 'standard'; state.difficulty = 'facil';
    state.initial = initial; state.solution = solution;
    state.board = initial.map(r => r.slice());
    state.notes = Array.from({ length: 9 }, () => Array(9).fill(new Set()));
    state.nasaContributions = Array.from({ length: 9 }, () => Array(9).fill(false));
    state.nasaCalls = 0;

    expect(() => exports.shareCurrentPuzzleURL()).not.toThrow();
  });
});

describe('shareCurrentPuzzleStateURL', () => {
  test('é uma função exportada', () => {
    const { exports } = loadSharingModule();
    expect(typeof exports.shareCurrentPuzzleStateURL).toBe('function');
  });

  test('não lança exceção ao ser chamada com state válido', () => {
    const { exports, state } = loadSharingModule();
    const engine = loadEngineModule();
    const sym9 = ['1','2','3','4','5','6','7','8','9'];
    const { solution, initial } = engine.createUniqueSudokuPuzzle(9, 3, 3, sym9, 'facil');
    state.N = 9; state.blockR = 3; state.blockC = 3; state.symbols = sym9;
    state.mode = 'standard'; state.difficulty = 'facil';
    state.initial = initial; state.solution = solution;
    state.board = initial.map(r => r.slice());
    state.notes = Array.from({ length: 9 }, () => Array(9).fill(new Set()));
    state.nasaContributions = Array.from({ length: 9 }, () => Array(9).fill(false));
    state.nasaCalls = 0; state.timerSeconds = 60; state.completed = false;
    state.revealedErrors = Array.from({ length: 9 }, () => Array(9).fill(false));

    expect(() => exports.shareCurrentPuzzleStateURL()).not.toThrow();
  });
});
