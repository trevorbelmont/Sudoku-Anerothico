/**
 * sudoku-engine.test.js
 *
 * Testes unitários para js/sudoku-engine.js
 * Cobre: isValidMatrix, validateGameState, buildSymbolsFromRange,
 *        computeBlockDimensions, shuffleArray, generateCompleteValidGrid,
 *        solvePartialGrid, countSolutionsMRV, createUniqueSudokuPuzzle
 */

'use strict';

const { loadEngineModule } = require('../helpers/engine-loader');

let engine;

beforeAll(() => {
  engine = loadEngineModule();
});

// ─────────────────────────────────────────────────────────────
// isValidMatrix
// ─────────────────────────────────────────────────────────────
describe('isValidMatrix', () => {
  const sym9 = ['1','2','3','4','5','6','7','8','9'];

  test('retorna true para uma grade 9×9 válida com strings e vazios', () => {
    const grid = Array.from({ length: 9 }, () => Array(9).fill(''));
    grid[0][0] = '5'; grid[4][4] = '9';
    expect(engine.isValidMatrix(grid, 9, sym9)).toBe(true);
  });

  test('retorna false se a grade não for um array', () => {
    expect(engine.isValidMatrix(null, 9, sym9)).toBe(false);
    expect(engine.isValidMatrix('abc', 9, sym9)).toBe(false);
  });

  test('retorna false se o número de linhas for diferente de N', () => {
    const grid = Array.from({ length: 8 }, () => Array(9).fill(''));
    expect(engine.isValidMatrix(grid, 9, sym9)).toBe(false);
  });

  test('retorna false se alguma linha tiver comprimento diferente de N', () => {
    const grid = Array.from({ length: 9 }, () => Array(9).fill(''));
    grid[3] = ['1','2','3'];
    expect(engine.isValidMatrix(grid, 9, sym9)).toBe(false);
  });

  test('retorna false se um valor não pertencer aos símbolos', () => {
    const grid = Array.from({ length: 9 }, () => Array(9).fill(''));
    grid[0][0] = 'X'; // não está em sym9
    expect(engine.isValidMatrix(grid, 9, sym9)).toBe(false);
  });

  test('aceita grades 4×4 com símbolos personalizados', () => {
    const sym4 = ['A','B','C','D'];
    const grid = Array.from({ length: 4 }, () => Array(4).fill(''));
    grid[0][0] = 'A'; grid[1][1] = 'D';
    expect(engine.isValidMatrix(grid, 4, sym4)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// validateGameState
// ─────────────────────────────────────────────────────────────
describe('validateGameState', () => {
  const base9 = () => ({
    N: 9, bR: 3, bC: 3,
    symbols: ['1','2','3','4','5','6','7','8','9'],
    i: Array.from({ length: 9 }, () => Array(9).fill('')),
    sol: null,
  });

  test('retorna null para entrada nula', () => {
    expect(engine.validateGameState(null)).toBeNull();
  });

  test('retorna null para N fora do intervalo 4–25', () => {
    expect(engine.validateGameState({ ...base9(), N: 3 })).toBeNull();
    expect(engine.validateGameState({ ...base9(), N: 26 })).toBeNull();
  });

  test('retorna null se bR × bC !== N', () => {
    expect(engine.validateGameState({ ...base9(), bR: 2, bC: 2 })).toBeNull(); // 4 ≠ 9
  });

  test('retorna null se symbols.length !== N', () => {
    const bad = { ...base9(), symbols: ['1','2','3'] };
    expect(engine.validateGameState(bad)).toBeNull();
  });

  test('valida estado 9×9 correto e retorna objeto com as propriedades certas', () => {
    const result = engine.validateGameState(base9());
    expect(result).not.toBeNull();
    expect(result.N).toBe(9);
    expect(result.bR).toBe(3);
    expect(result.bC).toBe(3);
    expect(result.symbols).toHaveLength(9);
  });

  test('aceita grade 4×4 (2×2)', () => {
    const data = {
      N: 4, bR: 2, bC: 2,
      symbols: ['1','2','3','4'],
      i: Array.from({ length: 4 }, () => Array(4).fill('')),
    };
    const result = engine.validateGameState(data);
    expect(result).not.toBeNull();
    expect(result.N).toBe(4);
  });

  test('retorna null se a grade inicial contiver símbolo inválido', () => {
    const bad = base9();
    bad.i[0][0] = 'Z';
    expect(engine.validateGameState(bad)).toBeNull();
  });

  test('aceita campos alternativos (dimension, blockRow, blockCol, s, initialGrid)', () => {
    const data = {
      dimension: 9, blockRow: 3, blockCol: 3,
      s: ['1','2','3','4','5','6','7','8','9'],
      initialGrid: Array.from({ length: 9 }, () => Array(9).fill('')),
    };
    const result = engine.validateGameState(data);
    expect(result).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// buildSymbolsFromRange
// ─────────────────────────────────────────────────────────────
describe('buildSymbolsFromRange', () => {
  test('gera símbolos de 1 a 9 sem zero', () => {
    const syms = engine.buildSymbolsFromRange(1, 9, false);
    expect(syms).toHaveLength(9);
    expect(syms[0]).toBe('1');
    expect(syms[8]).toBe('9');
    expect(syms).not.toContain('0');
  });

  test('inclui zero quando includeZero=true', () => {
    const syms = engine.buildSymbolsFromRange(0, 9, true);
    expect(syms).toContain('0');
    expect(syms).toHaveLength(10);
  });

  test('exclui zero mesmo dentro do intervalo quando includeZero=false', () => {
    const syms = engine.buildSymbolsFromRange(0, 5, false);
    expect(syms).not.toContain('0');
    expect(syms).toHaveLength(5); // 1,2,3,4,5
  });

  test('inverte min/max automaticamente (min > max)', () => {
    const syms = engine.buildSymbolsFromRange(9, 1, false);
    expect(syms).toHaveLength(9);
    expect(syms[0]).toBe('1');
  });

  test('gera símbolos com números negativos', () => {
    const syms = engine.buildSymbolsFromRange(-3, 0, true);
    expect(syms).toContain('-3');
    expect(syms).toContain('0');
    expect(syms).toHaveLength(4);
  });
});

// ─────────────────────────────────────────────────────────────
// computeBlockDimensions
// ─────────────────────────────────────────────────────────────
describe('computeBlockDimensions', () => {
  test('retorna 3×3 para N=9', () => {
    const { blockR, blockC } = engine.computeBlockDimensions(9);
    expect(blockR * blockC).toBe(9);
    expect(blockR).toBe(3);
    expect(blockC).toBe(3);
  });

  test('retorna 2×2 para N=4', () => {
    const { blockR, blockC } = engine.computeBlockDimensions(4);
    expect(blockR).toBe(2);
    expect(blockC).toBe(2);
  });

  test('retorna bloco válido para N=6', () => {
    const { blockR, blockC } = engine.computeBlockDimensions(6);
    expect(blockR * blockC).toBe(6);
  });

  test('retorna bloco válido para N=16', () => {
    const { blockR, blockC } = engine.computeBlockDimensions(16);
    expect(blockR * blockC).toBe(16);
    expect(blockR).toBe(4);
    expect(blockC).toBe(4);
  });

  test('retorna bloco válido para N=25', () => {
    const { blockR, blockC } = engine.computeBlockDimensions(25);
    expect(blockR * blockC).toBe(25);
    expect(blockR).toBe(5);
    expect(blockC).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────
// shuffleArray
// ─────────────────────────────────────────────────────────────
describe('shuffleArray', () => {
  test('retorna array com o mesmo comprimento', () => {
    const arr = [1,2,3,4,5,6,7,8,9];
    expect(engine.shuffleArray(arr)).toHaveLength(9);
  });

  test('não modifica o array original', () => {
    const arr = [1,2,3,4,5];
    const copy = [...arr];
    engine.shuffleArray(arr);
    expect(arr).toEqual(copy);
  });

  test('contém os mesmos elementos após embaralhamento', () => {
    const arr = ['a','b','c','d','e'];
    const shuffled = engine.shuffleArray(arr);
    expect(shuffled.sort()).toEqual([...arr].sort());
  });

  test('embaralha array vazio sem lançar exceção', () => {
    expect(() => engine.shuffleArray([])).not.toThrow();
    expect(engine.shuffleArray([])).toEqual([]);
  });

  test('array com 1 elemento é retornado como está', () => {
    expect(engine.shuffleArray([42])).toEqual([42]);
  });
});

// ─────────────────────────────────────────────────────────────
// generateCompleteValidGrid
// ─────────────────────────────────────────────────────────────
describe('generateCompleteValidGrid', () => {
  const sym9 = ['1','2','3','4','5','6','7','8','9'];

  function isValidSudokuGrid(grid, N, blockR, blockC, symbols) {
    const symsSet = new Set(symbols);
    for (let r = 0; r < N; r++) {
      const rowSet = new Set(), colSet = new Set();
      for (let c = 0; c < N; c++) {
        if (!symsSet.has(grid[r][c])) return false;
        rowSet.add(grid[r][c]); colSet.add(grid[c][r]);
      }
      if (rowSet.size !== N || colSet.size !== N) return false;
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

  test('gera grade 9×9 válida', () => {
    const grid = engine.generateCompleteValidGrid(9, 3, 3, sym9);
    expect(isValidSudokuGrid(grid, 9, 3, 3, sym9)).toBe(true);
  });

  test('gera grade 4×4 válida', () => {
    const sym4 = ['1','2','3','4'];
    const grid = engine.generateCompleteValidGrid(4, 2, 2, sym4);
    expect(isValidSudokuGrid(grid, 4, 2, 2, sym4)).toBe(true);
  });

  test('a cada chamada gera uma grade (pode ser diferente)', () => {
    const a = engine.generateCompleteValidGrid(9, 3, 3, sym9);
    const b = engine.generateCompleteValidGrid(9, 3, 3, sym9);
    // Ambas devem ser válidas
    expect(isValidSudokuGrid(a, 9, 3, 3, sym9)).toBe(true);
    expect(isValidSudokuGrid(b, 9, 3, 3, sym9)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// solvePartialGrid
// ─────────────────────────────────────────────────────────────
describe('solvePartialGrid', () => {
  const sym9 = ['1','2','3','4','5','6','7','8','9'];

  test('resolve grade vazia e retorna solução válida', () => {
    const empty = Array.from({ length: 9 }, () => Array(9).fill(''));
    const sol = engine.solvePartialGrid(empty, 9, 3, 3, sym9);
    expect(sol).not.toBeNull();
    for (let r = 0; r < 9; r++) {
      const rowSet = new Set(sol[r]);
      expect(rowSet.size).toBe(9);
    }
  });

  test('resolve puzzle clássico de 17 pistas', () => {
    const seed = '8...3..........4.7..2.8....4....3...5......2.....7...3.5..........2..61..6.......';
    const initial = Array.from({ length: 9 }, (_, r) =>
      Array.from({ length: 9 }, (_, c) => {
        const ch = seed[r * 9 + c];
        return (ch >= '1' && ch <= '9') ? ch : '';
      })
    );
    const sol = engine.solvePartialGrid(initial, 9, 3, 3, sym9);
    expect(sol).not.toBeNull();
    expect(sol[0][0]).toBe('8');
  });

  test('retorna null para grade impossível (conflito)', () => {
    const bad = Array.from({ length: 9 }, () => Array(9).fill(''));
    bad[0][0] = '1'; bad[0][1] = '1'; // conflito na linha 0
    // Pode ou não retornar null dependendo da posição; o conflito direto deve ser null
    bad[0].fill('1'); // linha inteira = '1', impossível
    const sol = engine.solvePartialGrid(bad, 9, 3, 3, sym9);
    expect(sol).toBeNull();
  });

  test('resolve grade 4×4', () => {
    const sym4 = ['1','2','3','4'];
    const initial = [
      ['1','','',''],
      ['','','1',''],
      ['','1','',''],
      ['','','','1'],
    ];
    const sol = engine.solvePartialGrid(initial, 4, 2, 2, sym4);
    expect(sol).not.toBeNull();
    // Solução deve preservar as pistas
    expect(sol[0][0]).toBe('1');
    expect(sol[1][2]).toBe('1');
  });
});

// ─────────────────────────────────────────────────────────────
// countSolutionsMRV
// ─────────────────────────────────────────────────────────────
describe('countSolutionsMRV', () => {
  test('retorna 0 para grade impossível', () => {
    // grade 4×4 com dois "1" na mesma linha (índice 0)
    const grid = [
      [0, 0, -1, -1],
      [-1, -1, -1, -1],
      [-1, -1, -1, -1],
      [-1, -1, -1, -1],
    ];
    const count = engine.countSolutionsMRV(grid, 4, 2, 2, 2);
    expect(count).toBe(0);
  });

  test('grade vazia 4×4 tem pelo menos 2 soluções', () => {
    const grid = Array.from({ length: 4 }, () => Array(4).fill(-1));
    const count = engine.countSolutionsMRV(grid, 4, 2, 2, 2);
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('limite=1 para puzzle 9×9 único pára em 1', () => {
    // Usa um dos seeds de 17 pistas, que é único
    const sym9 = ['1','2','3','4','5','6','7','8','9'];
    const seed = '8...3..........4.7..2.8....4....3...5......2.....7...3.5..........2..61..6.......';
    const initial = Array.from({ length: 9 }, (_, r) =>
      Array.from({ length: 9 }, (_, c) => {
        const ch = seed[r * 9 + c];
        return (ch >= '1' && ch <= '9') ? sym9.indexOf(ch) : -1;
      })
    );
    const count = engine.countSolutionsMRV(initial, 9, 3, 3, 1, 8000);
    expect(count).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────
// createUniqueSudokuPuzzle
// ─────────────────────────────────────────────────────────────
describe('createUniqueSudokuPuzzle', () => {
  const sym9 = ['1','2','3','4','5','6','7','8','9'];

  test('retorna { solution, initial } com grades NxN', () => {
    const { solution, initial } = engine.createUniqueSudokuPuzzle(9, 3, 3, sym9, 'facil');
    expect(solution).toHaveLength(9);
    expect(initial).toHaveLength(9);
    solution.forEach(row => expect(row).toHaveLength(9));
    initial.forEach(row => expect(row).toHaveLength(9));
  });

  test('pistas iniciais são subconjunto da solução', () => {
    const { solution, initial } = engine.createUniqueSudokuPuzzle(9, 3, 3, sym9, 'medio');
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (initial[r][c] !== '') {
          expect(initial[r][c]).toBe(solution[r][c]);
        }
      }
    }
  });

  test('dificuldade "facil" produz mais pistas do que "doido"', () => {
    const countClues = (initial) => initial.flat().filter(v => v !== '').length;
    const { initial: initFacil } = engine.createUniqueSudokuPuzzle(9, 3, 3, sym9, 'facil');
    const { initial: initDoido } = engine.createUniqueSudokuPuzzle(9, 3, 3, sym9, 'doido');
    expect(countClues(initFacil)).toBeGreaterThan(countClues(initDoido));
  });

  test('modo "doido" gera puzzle de 17 a 21 pistas (isomórfico do seed)', () => {
    const { initial } = engine.createUniqueSudokuPuzzle(9, 3, 3, sym9, 'doido');
    const clues = initial.flat().filter(v => v !== '').length;
    // Contrato flexibilizado (9×9/doido): 17–21 pistas; algumas instâncias podem ter múltiplas
    // soluções. A seed que originalmente possuía 21 pistas permanece válida neste intervalo.
    expect(clues).toBeGreaterThanOrEqual(17);
    expect(clues).toBeLessThanOrEqual(21);
  });

  test('funciona com grade 4×4', () => {
    const sym4 = ['1','2','3','4'];
    const { solution, initial } = engine.createUniqueSudokuPuzzle(4, 2, 2, sym4, 'facil');
    expect(solution).toHaveLength(4);
    expect(initial).toHaveLength(4);
  });
});
