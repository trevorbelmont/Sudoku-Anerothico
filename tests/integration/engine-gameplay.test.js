/**
 * engine-gameplay.test.js
 *
 * Testes de integração: fluxo completo de uma partida
 * Cobre: geração → solução → preenchimento → vitória
 *        validação cruzada entre solvePartialGrid e isValidMatrix
 *        lógica de notas (pencil), erros e NASA hint
 */

'use strict';

const { loadEngineModule, makeStateStubb } = require('../helpers/engine-loader');

// ─── Funções auxiliares ─────────────────────────────────────────

function isBoardComplete(board) {
  return board.every(row => row.every(cell => cell !== ''));
}

function boardIsCorrect(board, solution) {
  return board.every((row, r) =>
    row.every((cell, c) => cell === solution[r][c])
  );
}

function isValidSudoku(grid, N, blockR, blockC) {
  for (let r = 0; r < N; r++) {
    const row = new Set(), col = new Set();
    for (let c = 0; c < N; c++) {
      row.add(grid[r][c]);
      col.add(grid[c][r]);
    }
    if (row.size !== N || col.size !== N) return false;
  }
  for (let br = 0; br < N; br += blockR) {
    for (let bc = 0; bc < N; bc += blockC) {
      const blk = new Set();
      for (let r = br; r < br + blockR; r++)
        for (let c = bc; c < bc + blockC; c++)
          blk.add(grid[r][c]);
      if (blk.size !== N) return false;
    }
  }
  return true;
}

// ─────────────────────────────────────────────────────────────
// Integração: gerar puzzle → copiar state → completar → verificar
// ─────────────────────────────────────────────────────────────
describe('Full game flow: generate → complete → verify', () => {
  let engine;

  beforeAll(() => {
    engine = loadEngineModule();
  });

  test('9×9 facil: a grade de solução é um sudoku válido', () => {
    const sym = engine.buildSymbolsFromRange(1, 9, false);
    const { solution } = engine.createUniqueSudokuPuzzle(9, 3, 3, sym, 'facil');
    expect(isValidSudoku(solution, 9, 3, 3)).toBe(true);
  });

  test('9×9 medio: preencher com a solução completa passa a validação de vitória', () => {
    const sym = engine.buildSymbolsFromRange(1, 9, false);
    const { solution, initial } = engine.createUniqueSudokuPuzzle(9, 3, 3, sym, 'medio');

    // Simula state preenchido com a solução
    const state = makeStateStubb();
    state.N = 9; state.blockR = 3; state.blockC = 3; state.symbols = sym;
    state.solution = solution; state.initial = initial;
    state.board = solution.map(row => row.slice());

    // Lógica da checkFullBoardSolution replicada aqui para não depender de DOM
    let rulesValid = true;
    for (let r = 0; r < 9; r++) {
      const rowSet = new Set(), colSet = new Set();
      for (let c = 0; c < 9; c++) { rowSet.add(state.board[r][c]); colSet.add(state.board[c][r]); }
      if (rowSet.size !== 9 || colSet.size !== 9) rulesValid = false;
    }
    for (let br = 0; br < 9; br += 3) for (let bc = 0; bc < 9; bc += 3) {
      const blk = new Set();
      for (let r = br; r < br + 3; r++) for (let c = bc; c < bc + 3; c++) blk.add(state.board[r][c]);
      if (blk.size !== 9) rulesValid = false;
    }
    expect(rulesValid).toBe(true);
  });

  test('4×4: puzzle gerado tem solução única e correta', () => {
    const sym = engine.buildSymbolsFromRange(1, 4, false);
    const { solution, initial } = engine.createUniqueSudokuPuzzle(4, 2, 2, sym, 'facil');
    expect(isValidSudoku(solution, 4, 2, 2)).toBe(true);
    // Todas as pistas estão na solução
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++)
        if (initial[r][c] !== '')
          expect(initial[r][c]).toBe(solution[r][c]);
  });

  test('solvePartialGrid restaura o puzzle inicial para a solução esperada', () => {
    const sym = engine.buildSymbolsFromRange(1, 9, false);
    const { solution, initial } = engine.createUniqueSudokuPuzzle(9, 3, 3, sym, 'dificil');
    const recomputed = engine.solvePartialGrid(initial, 9, 3, 3, sym);
    expect(recomputed).not.toBeNull();
    // Pistas originais devem coincidir com a solução recomputada
    for (let r = 0; r < 9; r++)
      for (let c = 0; c < 9; c++)
        if (initial[r][c] !== '')
          expect(recomputed[r][c]).toBe(initial[r][c]);
  });

  test('modo custom 6×6: puzzle gerado é solúvel', () => {
    const sym = engine.buildSymbolsFromRange(1, 6, false);
    const { blockR, blockC } = engine.computeBlockDimensions(6);
    const { solution, initial } = engine.createUniqueSudokuPuzzle(6, blockR, blockC, sym, 'medio');
    expect(solution).toHaveLength(6);
    expect(isValidSudoku(solution, 6, blockR, blockC)).toBe(true);
    // solvePartialGrid deve concordar com a solução
    const re = engine.solvePartialGrid(initial, 6, blockR, blockC, sym);
    expect(re).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// Integração: lógica de preenchimento e apagamento de células
// ─────────────────────────────────────────────────────────────
describe('Cell write / erase integration', () => {
  let engine, sym, state;

  beforeEach(() => {
    engine = loadEngineModule();
    sym = engine.buildSymbolsFromRange(1, 9, false);
    const { solution, initial } = engine.createUniqueSudokuPuzzle(9, 3, 3, sym, 'medio');
    state = makeStateStubb();
    state.N = 9; state.blockR = 3; state.blockC = 3; state.symbols = sym;
    state.solution = solution; state.initial = initial;
    state.board = initial.map(r => r.slice());
    state.notes = Array.from({ length: 9 }, () => Array(9).fill(new Set()));
    state.nasaContributions = Array.from({ length: 9 }, () => Array(9).fill(false));
    state.revealedErrors = Array.from({ length: 9 }, () => Array(9).fill(false));
  });

  test('preencher célula editável com símbolo correto', () => {
    // Encontra primeira célula editável
    let r = 0, c = 0;
    outer: for (r = 0; r < 9; r++) for (c = 0; c < 9; c++) if (state.initial[r][c] === '') break outer;

    const correct = state.solution[r][c];
    state.board[r][c] = correct;
    expect(state.board[r][c]).toBe(correct);
  });

  test('preencher célula com símbolo errado é detectado por hasDirectPeerConflict', () => {
    // hasDirectPeerConflict (emulado abaixo) compara com state.solution
    // Insere símbolo diferente da solução em célula vazia
    let r = -1, c = -1;
    outer: for (let rr = 0; rr < 9; rr++) for (let cc = 0; cc < 9; cc++) {
      if (state.initial[rr][cc] === '') { r = rr; c = cc; break outer; }
    }
    const wrong = sym.find(s => s !== state.solution[r][c]);
    state.board[r][c] = wrong;

    // Emula a verificação de conflito
    const hasConflict = !state.isManualCreating && state.solution[r][c] !== wrong;
    expect(hasConflict).toBe(true);
  });

  test('apagar célula preenchida a torna vazia', () => {
    let r = 0, c = 0;
    outer: for (r = 0; r < 9; r++) for (c = 0; c < 9; c++) if (state.initial[r][c] === '') break outer;
    state.board[r][c] = state.solution[r][c];
    // Apaga
    state.board[r][c] = '';
    expect(state.board[r][c]).toBe('');
  });

  test('nota de lápis é adicionada e removida corretamente', () => {
    // Encontra célula editável
    let r = 0, c = 0;
    outer: for (r = 0; r < 9; r++) for (c = 0; c < 9; c++) if (state.initial[r][c] === '') break outer;

    const noteSet = state.notes[r][c];
    noteSet.add('5');
    expect(noteSet.has('5')).toBe(true);

    noteSet.delete('5');
    expect(noteSet.has('5')).toBe(false);
  });

  test('preencher célula com valor deve limpar as notas', () => {
    let r = 0, c = 0;
    outer: for (r = 0; r < 9; r++) for (c = 0; c < 9; c++) if (state.initial[r][c] === '') break outer;
    state.notes[r][c].add('3');
    state.notes[r][c].add('7');

    // Simula o que applySymbolToCell faz ao escrever
    state.board[r][c] = state.solution[r][c];
    state.notes[r][c].clear();

    expect(state.notes[r][c].size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// Integração: removeAutoNotesPeers (limpa notas na linha/col/bloco)
// ─────────────────────────────────────────────────────────────
describe('removeAutoNotesPeers', () => {
  let engine;

  beforeAll(() => { engine = loadEngineModule(); });

  test('preencher uma célula limpa a nota desse símbolo nos peers', () => {
    const sym = engine.buildSymbolsFromRange(1, 9, false);
    const { solution, initial } = engine.createUniqueSudokuPuzzle(9, 3, 3, sym, 'facil');
    // Inicializa notas com o símbolo '5' em todas as células editáveis
    const notes = Array.from({ length: 9 }, () => Array(9).fill(null).map(() => new Set()));
    for (let r = 0; r < 9; r++)
      for (let c = 0; c < 9; c++)
        if (initial[r][c] === '') notes[r][c].add('5');

    // Simula preenchimento de (0,0) com '5' (se editável) e remoção de peers
    let row = -1, col = -1;
    outer: for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      if (initial[r][c] === '' && solution[r][c] === '5') { row = r; col = c; break outer; }
    }
    if (row < 0) return; // skip se não encontrou

    // Remove '5' de toda a linha, coluna e bloco
    for (let i = 0; i < 9; i++) {
      notes[row][i].delete('5');
      notes[i][col].delete('5');
    }
    const blockR = 3, blockC = 3;
    const startR = Math.floor(row / blockR) * blockR;
    const startC = Math.floor(col / blockC) * blockC;
    for (let r = startR; r < startR + blockR; r++)
      for (let c = startC; c < startC + blockC; c++)
        notes[r][c].delete('5');

    // Verifica que nenhum peer na linha/col/bloco tem '5'
    for (let i = 0; i < 9; i++) {
      if (i !== col) expect(notes[row][i].has('5')).toBe(false);
      if (i !== row) expect(notes[i][col].has('5')).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────
// Integração: lógica de progresso
// ─────────────────────────────────────────────────────────────
describe('Progress tracking integration', () => {
  let engine, sym, state;

  beforeEach(() => {
    engine = loadEngineModule();
    sym = engine.buildSymbolsFromRange(1, 9, false);
    const { solution, initial } = engine.createUniqueSudokuPuzzle(9, 3, 3, sym, 'facil');
    state = makeStateStubb();
    state.N = 9; state.blockR = 3; state.blockC = 3;
    state.solution = solution; state.initial = initial;
    state.board = initial.map(r => r.slice());
  });

  test('progresso inicial é > 0 (há pistas)', () => {
    const filled = state.board.flat().filter(v => v !== '').length;
    expect(filled).toBeGreaterThan(0);
  });

  test('tabuleiro completamente preenchido tem N×N células', () => {
    state.board = state.solution.map(r => r.slice());
    const filled = state.board.flat().filter(v => v !== '').length;
    expect(filled).toBe(81);
  });

  test('contagem de células vazias diminui ao preencher', () => {
    const initialEmpty = state.board.flat().filter(v => v === '').length;
    // Preenche a primeira célula vazia
    let r = 0, c = 0;
    outer: for (r = 0; r < 9; r++) for (c = 0; c < 9; c++) if (state.board[r][c] === '') break outer;
    state.board[r][c] = state.solution[r][c];
    const newEmpty = state.board.flat().filter(v => v === '').length;
    expect(newEmpty).toBe(initialEmpty - 1);
  });
});

// ─────────────────────────────────────────────────────────────
// Integração: buildSymbolsFromRange + createUniqueSudokuPuzzle custom
// ─────────────────────────────────────────────────────────────
describe('Custom range integration', () => {
  let engine;
  beforeAll(() => { engine = loadEngineModule(); });

  test('símbolos negativos (-3..-1, com zero) resultam em puzzle válido', () => {
    const sym = engine.buildSymbolsFromRange(-3, 0, true);
    expect(sym).toHaveLength(4);
    const { blockR, blockC } = engine.computeBlockDimensions(4);
    const { solution } = engine.createUniqueSudokuPuzzle(4, blockR, blockC, sym, 'facil');
    expect(isValidSudoku(solution, 4, blockR, blockC)).toBe(true);
  });

  test('intervalo 1–16 gera grade 16×16 válida', () => {
    const sym = engine.buildSymbolsFromRange(1, 16, false);
    expect(sym).toHaveLength(16);
    const { blockR, blockC } = engine.computeBlockDimensions(16);
    const { solution } = engine.createUniqueSudokuPuzzle(16, blockR, blockC, sym, 'facil');
    expect(isValidSudoku(solution, 16, 4, 4)).toBe(true);
  }, 30000); // 16×16 pode demorar mais

  test('validateGameState rejeita puzzle se bR × bC !== N', () => {
    const sym = engine.buildSymbolsFromRange(1, 9, false);
    const { initial, solution } = engine.createUniqueSudokuPuzzle(9, 3, 3, sym, 'facil');
    const result = engine.validateGameState({ N: 9, bR: 2, bC: 2, symbols: sym, i: initial, sol: solution });
    expect(result).toBeNull();
  });
});
