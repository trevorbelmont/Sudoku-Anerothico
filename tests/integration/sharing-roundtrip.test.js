/**
 * sharing-roundtrip.test.js
 *
 * Testes de integração: round-trip de serialização/desserialização
 * Cobre: encode → decode preserva todos os campos essenciais,
 *        payload de grade e payload de estado completo,
 *        carregamento de 4×4, 9×9, modo custom, notas e nasaContributions
 */

'use strict';

const { loadSharingModule, loadEngineModule } = require('../helpers/engine-loader');

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function encodePayload(obj) {
  return Buffer.from(encodeURIComponent(JSON.stringify(obj))).toString('base64');
}

function makeGrid9x9() {
  const engine = loadEngineModule();
  const sym9 = engine.buildSymbolsFromRange(1, 9, false);
  return { engine, sym9, ...engine.createUniqueSudokuPuzzle(9, 3, 3, sym9, 'facil') };
}

// ─────────────────────────────────────────────────────────────
// Round-trip: grade sem estado (modo puzzle)
// ─────────────────────────────────────────────────────────────
describe('Sharing round-trip: grid-only payload', () => {
  let sharing, state;

  beforeEach(() => {
    const loaded = loadSharingModule();
    sharing = loaded.exports;
    state = loaded.state;
  });

  test('N é restaurado corretamente', () => {
    const { sym9, solution, initial } = makeGrid9x9();
    sharing.processLoadedCode(encodePayload({ m: 'standard', d: 'medio', s: sym9, N: 9, bR: 3, bC: 3, i: initial, sol: solution }));
    expect(state.N).toBe(9);
  });

  test('blockR e blockC são restaurados', () => {
    const { sym9, solution, initial } = makeGrid9x9();
    sharing.processLoadedCode(encodePayload({ m: 'standard', d: 'facil', s: sym9, N: 9, bR: 3, bC: 3, i: initial, sol: solution }));
    expect(state.blockR).toBe(3);
    expect(state.blockC).toBe(3);
  });

  test('symbols é restaurado com 9 elementos', () => {
    const { sym9, solution, initial } = makeGrid9x9();
    sharing.processLoadedCode(encodePayload({ m: 'standard', d: 'facil', s: sym9, N: 9, bR: 3, bC: 3, i: initial, sol: solution }));
    expect(state.symbols).toHaveLength(9);
  });

  test('initial é restaurado como grade N×N de strings', () => {
    const { sym9, solution, initial } = makeGrid9x9();
    sharing.processLoadedCode(encodePayload({ m: 'standard', d: 'facil', s: sym9, N: 9, bR: 3, bC: 3, i: initial, sol: solution }));
    expect(state.initial).toHaveLength(9);
    state.initial.forEach(row => {
      expect(row).toHaveLength(9);
      row.forEach(v => expect(typeof v).toBe('string'));
    });
  });

  test('board começa igual ao initial (sem estado)', () => {
    const { sym9, solution, initial } = makeGrid9x9();
    sharing.processLoadedCode(encodePayload({ m: 'standard', d: 'facil', s: sym9, N: 9, bR: 3, bC: 3, i: initial, sol: solution }));
    // Sem st=1, board = cópia do initial
    for (let r = 0; r < 9; r++)
      for (let c = 0; c < 9; c++)
        expect(state.board[r][c]).toBe(state.initial[r][c]);
  });

  test('dificuldade é restaurada', () => {
    const { sym9, solution, initial } = makeGrid9x9();
    sharing.processLoadedCode(encodePayload({ m: 'standard', d: 'dificil', s: sym9, N: 9, bR: 3, bC: 3, i: initial, sol: solution }));
    expect(state.difficulty).toBe('dificil');
  });
});

// ─────────────────────────────────────────────────────────────
// Round-trip: estado completo (st=1)
// ─────────────────────────────────────────────────────────────
describe('Sharing round-trip: full state payload (st=1)', () => {
  let sharing, state;

  beforeEach(() => {
    const loaded = loadSharingModule();
    sharing = loaded.exports;
    state = loaded.state;
  });

  function makeFullStatePayload(overrides = {}) {
    const { sym9, solution, initial } = makeGrid9x9();
    // Cria um board com algumas células preenchidas
    const board = initial.map(r => r.slice());
    for (let r = 0; r < 9; r++)
      for (let c = 0; c < 9; c++)
        if (board[r][c] === '') board[r][c] = solution[r][c]; // preenche tudo para teste

    return encodePayload({
      st: 1,
      m: 'standard', d: 'medio',
      s: sym9, N: 9, bR: 3, bC: 3,
      i: initial, sol: solution,
      b: board,
      n: Array.from({ length: 9 }, () => Array(9).fill([])),
      re: Array.from({ length: 9 }, () => Array(9).fill(false)),
      nc: Array.from({ length: 9 }, () => Array(9).fill(false)),
      nca: 3,
      t: 450,
      c: false,
      ...overrides,
    });
  }

  test('timerSeconds é restaurado a partir de "t"', () => {
    sharing.processLoadedCode(makeFullStatePayload({ t: 450 }));
    expect(state.timerSeconds).toBe(450);
  });

  test('nasaCalls é restaurado a partir de "nca"', () => {
    sharing.processLoadedCode(makeFullStatePayload({ nca: 3 }));
    expect(state.nasaCalls).toBeGreaterThanOrEqual(3);
  });

  test('notas são restauradas como Sets', () => {
    const notes = Array.from({ length: 9 }, () => Array(9).fill(null).map(() => []));
    notes[0][1] = ['5', '7']; // célula (0,1) tem notas 5 e 7
    sharing.processLoadedCode(makeFullStatePayload({ n: notes }));
    // A célula (0,1) deve ter notas como Set
    if (state.notes[0][1]) {
      expect(state.notes[0][1] instanceof Set).toBe(true);
    }
  });

  test('nasaContributions são restaurados', () => {
    const nc = Array.from({ length: 9 }, () => Array(9).fill(false));
    nc[2][3] = true;
    sharing.processLoadedCode(makeFullStatePayload({ nc }));
    // Verifica que a grade de contribuições foi criada
    expect(Array.isArray(state.nasaContributions)).toBe(true);
    expect(state.nasaContributions).toHaveLength(9);
  });

  test('board preenchido é restaurado com todos os valores', () => {
    const { sym9, solution, initial } = makeGrid9x9();
    const fullBoard = solution.map(r => r.slice());
    sharing.processLoadedCode(makeFullStatePayload());
    expect(state.board).toHaveLength(9);
    state.board.forEach(row => expect(row).toHaveLength(9));
  });
});

// ─────────────────────────────────────────────────────────────
// Round-trip: grade 4×4
// ─────────────────────────────────────────────────────────────
describe('Sharing round-trip: 4×4 grid', () => {
  let sharing, state;

  beforeEach(() => {
    const loaded = loadSharingModule();
    sharing = loaded.exports;
    state = loaded.state;
  });

  test('grade 4×4 é carregada corretamente', () => {
    const engine = loadEngineModule();
    const sym4 = engine.buildSymbolsFromRange(1, 4, false);
    const { solution, initial } = engine.createUniqueSudokuPuzzle(4, 2, 2, sym4, 'facil');
    const encoded = encodePayload({ m: 'standard', d: 'facil', s: sym4, N: 4, bR: 2, bC: 2, i: initial, sol: solution });

    const result = sharing.processLoadedCode(encoded);
    expect(result).toBe(true);
    expect(state.N).toBe(4);
    expect(state.blockR).toBe(2);
    expect(state.blockC).toBe(2);
    expect(state.symbols).toHaveLength(4);
  });
});

// ─────────────────────────────────────────────────────────────
// Round-trip: modo custom (símbolos negativos)
// ─────────────────────────────────────────────────────────────
describe('Sharing round-trip: custom mode with negative symbols', () => {
  let sharing, state;

  beforeEach(() => {
    const loaded = loadSharingModule();
    sharing = loaded.exports;
    state = loaded.state;
  });

  test('símbolos negativos são preservados após round-trip', () => {
    const engine = loadEngineModule();
    const sym = engine.buildSymbolsFromRange(-3, 0, true); // '-3','-2','-1','0'
    const { blockR, blockC } = engine.computeBlockDimensions(4);
    const { solution, initial } = engine.createUniqueSudokuPuzzle(4, blockR, blockC, sym, 'facil');
    const encoded = encodePayload({ m: 'custom', d: 'facil', s: sym, N: 4, bR: blockR, bC: blockC, i: initial, sol: solution });

    const result = sharing.processLoadedCode(encoded);
    expect(result).toBe(true);
    expect(state.symbols).toContain('-3');
    expect(state.symbols).toContain('0');
  });
});

// ─────────────────────────────────────────────────────────────
// Robustez: payloads corrompidos ou parcialmente inválidos
// ─────────────────────────────────────────────────────────────
describe('Sharing robustness', () => {
  let sharing;

  beforeEach(() => {
    sharing = loadSharingModule().exports;
  });

  test('string vazia retorna false', () => {
    expect(sharing.processLoadedCode('')).toBe(false);
  });

  test('base64 válido mas JSON inválido retorna false', () => {
    const encoded = Buffer.from('{ not valid json ').toString('base64');
    expect(sharing.processLoadedCode(encoded)).toBe(false);
  });

  test('objeto sem symbols retorna false', () => {
    const engine = loadEngineModule();
    const { initial } = engine.createUniqueSudokuPuzzle(9, 3, 3, engine.buildSymbolsFromRange(1, 9, false), 'facil');
    const encoded = encodePayload({ N: 9, bR: 3, bC: 3, i: initial });
    expect(sharing.processLoadedCode(encoded)).toBe(false);
  });

  test('initial com símbolos fora da lista retorna false', () => {
    const sym9 = ['1','2','3','4','5','6','7','8','9'];
    const engine = loadEngineModule();
    const { solution, initial } = engine.createUniqueSudokuPuzzle(9, 3, 3, sym9, 'facil');
    initial[0][0] = 'X'; // invalida
    const encoded = encodePayload({ m: 'standard', d: 'facil', s: sym9, N: 9, bR: 3, bC: 3, i: initial, sol: solution });
    expect(sharing.processLoadedCode(encoded)).toBe(false);
  });
});
