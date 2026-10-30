/**
 * generation-satisfiability.test.js
 *
 * Testes direcionados à garantia de satisfatibilidade da geração de instâncias de Sudoku.
 * Cobre: validade estrutural/solvabilidade das seeds em tempo de execução, robustez de
 * buildIsomorphic9x9FromSeed contra seeds inválidas/inconclusivas, satisfatibilidade do
 * gerador geral para todas as dimensões/dificuldades suportadas, preservação da unicidade
 * onde ela é exigida, isolamento da exceção de múltiplas soluções em 9x9/doido e regressão.
 *
 * A prova de satisfatibilidade usa o invariante "pistas ⊆ solução completa válida",
 * que é barato (O(N^2)) e funciona para todas as dimensões (inclusive 25x25) sem exigir
 * busca de força bruta.
 */

'use strict';

const { loadEngineModule } = require('../helpers/engine-loader');

let engine;

beforeAll(() => {
  engine = loadEngineModule();
});

// ─── Helpers ────────────────────────────────────────────────────────────────
const sym9 = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

function symbolsFor(N) {
  return Array.from({ length: N }, (_, i) => String(i + 1));
}

function clueCount(grid) {
  return grid.flat().filter((v) => v !== '').length;
}

function isSubsetOfSolution(initial, solution, N) {
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (initial[r][c] !== '' && initial[r][c] !== solution[r][c]) return false;
    }
  }
  return true;
}

// Verifica que uma grade completa respeita linhas, colunas e blocos (Sudoku válido).
function isValidCompleteGrid(grid, N, bR, bC, symbols) {
  const set = new Set(symbols);
  for (let r = 0; r < N; r++) {
    const rowSet = new Set(), colSet = new Set();
    for (let c = 0; c < N; c++) {
      if (!set.has(grid[r][c])) return false;
      rowSet.add(grid[r][c]); colSet.add(grid[c][r]);
    }
    if (rowSet.size !== N || colSet.size !== N) return false;
  }
  const blocksPerRow = N / bC;
  for (let br = 0; br < N; br += bR) {
    for (let bc = 0; bc < N; bc += bC) {
      const blkSet = new Set();
      for (let r = br; r < br + bR; r++)
        for (let c = bc; c < bc + bC; c++) blkSet.add(grid[r][c]);
      if (blkSet.size !== N) return false;
    }
  }
  return true;
}

function hasClueConflicts(seedStr, N, bR, bC) {
  const g = Array.from({ length: N }, (_, r) =>
    Array.from({ length: N }, (_, c) => {
      const ch = seedStr[r * N + c];
      return (ch >= '1' && ch <= '9') ? ch : '';
    }));
  const rs = Array.from({ length: N }, () => new Set());
  const cs = Array.from({ length: N }, () => new Set());
  const bs = Array.from({ length: N }, () => new Set());
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const v = g[r][c];
      if (v === '') continue;
      const b = Math.floor(r / bR) * (N / bC) + Math.floor(c / bC);
      if (rs[r].has(v) || cs[c].has(v) || bs[b].has(v)) return true;
      rs[r].add(v); cs[c].add(v); bs[b].add(v);
    }
  }
  return false;
}

function seedToInitial(seedStr) {
  return Array.from({ length: 9 }, (_, r) =>
    Array.from({ length: 9 }, (_, c) => {
      const ch = seedStr[r * 9 + c];
      return (ch >= '1' && ch <= '9') ? ch : '';
    }));
}

function seedSolvable(seedStr) {
  return !!engine.solvePartialGrid(seedToInitial(seedStr), 9, 3, 3, sym9);
}

function seedSolutions(seedStr) {
  const init = seedToInitial(seedStr);
  return engine.countSolutionsMRV(
    init.map((row) => row.map((v) => (v === '' ? -1 : sym9.indexOf(v)))),
    9, 3, 3, 2, 200000
  );
}

function gridSolutions(initial, N, bR, bC, syms) {
  const idx = initial.map((row) => row.map((v) => (v === '' ? -1 : syms.indexOf(v))));
  return engine.countSolutionsMRV(idx, N, bR, bC, 2, 200000);
}

// ─── Seeds em tempo de execução ─────────────────────────────────────────────
describe('Seeds em tempo de execução — validade estrutural e solvabilidade', () => {
  test('todas as SEEDS_17_CLUES têm 81 caracteres, sem conflitos e são solváveis', () => {
    engine.SEEDS_17_CLUES.forEach((s) => {
      expect(s.length).toBe(81);
      expect(hasClueConflicts(s, 9, 3, 3)).toBe(false);
      expect(seedSolvable(s)).toBe(true);
    });
  });

  test('todas as SEEDS_UAISO_BASE têm 81 caracteres, sem conflitos e são solváveis', () => {
    engine.SEEDS_UAISO_BASE.forEach((s) => {
      expect(s.length).toBe(81);
      expect(hasClueConflicts(s, 9, 3, 3)).toBe(false);
      expect(seedSolvable(s)).toBe(true);
    });
  });

  test('pool uaiso (UAISO_BASE + 17_CLUES) tem exatamente 8 entradas solváveis', () => {
    const pool = [...engine.SEEDS_UAISO_BASE, ...engine.SEEDS_17_CLUES];
    expect(pool).toHaveLength(8);
    pool.forEach((s) => expect(seedSolvable(s)).toBe(true));
  });
});

// ─── Seeds — unicidade e exceção de múltiplas soluções ───────────────────────
describe('Seeds — unicidade e exceção de múltiplas soluções', () => {
  test('SEEDS_UAISO_BASE são todas únicas', () => {
    engine.SEEDS_UAISO_BASE.forEach((s) => expect(seedSolutions(s)).toBe(1));
  });

  test('exceção de múltiplas soluções: apenas SEEDS_17_CLUES[0] tem >1 solução', () => {
    engine.SEEDS_17_CLUES.forEach((s, i) => {
      const c = seedSolutions(s);
      if (i === 0) expect(c).toBeGreaterThan(1); // exceção conhecida 9x9/doido
      else expect(c).toBe(1);                   // demais seeds únicas
    });
  });
});

// ─── buildIsomorphic9x9FromSeed — robustez ──────────────────────────────────
describe('buildIsomorphic9x9FromSeed — robustez contra seeds inválidas/inconclusivas', () => {
  test('retorna null (sem lançar) para seed com conflito direto', () => {
    const badSeed = '11' + '.'.repeat(79); // dois "1" na mesma linha
    expect(() => engine.buildIsomorphic9x9FromSeed(badSeed, sym9, 17)).not.toThrow();
    expect(engine.buildIsomorphic9x9FromSeed(badSeed, sym9, 17)).toBeNull();
  });

  test('retorna null (sem lançar) para seed impossível (linha inteira igual)', () => {
    const badSeed = '1'.repeat(9) + '.'.repeat(72); // linha 0 toda "1"
    expect(() => engine.buildIsomorphic9x9FromSeed(badSeed, sym9, 17)).not.toThrow();
    expect(engine.buildIsomorphic9x9FromSeed(badSeed, sym9, 17)).toBeNull();
  });

  test('para seed válida, retorna { solution, initial } solvável e consistente', () => {
    const res = engine.buildIsomorphic9x9FromSeed(engine.SEEDS_17_CLUES[1], sym9, 17);
    expect(res).not.toBeNull();
    expect(res.solution).toHaveLength(9);
    expect(res.initial).toHaveLength(9);
    expect(isValidCompleteGrid(res.solution, 9, 3, 3, sym9)).toBe(true);
    expect(isSubsetOfSolution(res.initial, res.solution, 9)).toBe(true);
  });

  test('100 transformações aleatórias de seed válida nunca lançam e sempre solváveis', () => {
    for (let k = 0; k < 100; k++) {
      const res = engine.buildIsomorphic9x9FromSeed(
        engine.SEEDS_17_CLUES[k % engine.SEEDS_17_CLUES.length], sym9, 17);
      expect(res).not.toBeNull();
      expect(isSubsetOfSolution(res.initial, res.solution, 9)).toBe(true);
    }
  });
});

// ─── Gerador geral — satisfatibilidade por dimensão/dificuldade ─────────────
describe('Gerador geral — toda instância gerada tem ao menos uma solução', () => {
  const dims = [[4, 2, 2], [6, 2, 3], [9, 3, 3], [12, 3, 4], [16, 4, 4], [25, 5, 5]];
  const diffs = ['facil', 'medio', 'dificil', 'uaiso', 'doido'];

  test.each(dims)(
    'dimensão $0x$0 (blocos $1x$2): todas as dificuldades geram instância satisfatível',
    (N, bR, bC) => {
      const syms = symbolsFor(N);
      const runs = N >= 25 ? 2 : (N >= 16 ? 3 : (N >= 12 ? 5 : 8));
      for (const diff of diffs) {
        for (let k = 0; k < runs; k++) {
          const { solution, initial } = engine.createUniqueSudokuPuzzle(N, bR, bC, syms, diff);
          expect(solution).toHaveLength(N);
          expect(initial).toHaveLength(N);
          // A solução completa é um Sudoku válido (prova a existência de ao menos uma solução).
          expect(isValidCompleteGrid(solution, N, bR, bC, syms)).toBe(true);
          // As pistas são subconjunto da solução (logo a instância é satisfatível).
          expect(isSubsetOfSolution(initial, solution, N)).toBe(true);
        }
      }
    },
    30000
  );
});

// ─── 9x9 doido/uaiso — contrato de pistas e satisfatibilidade ───────────────
describe('9x9 doido/uaiso — satisfatibilidade e contrato de pistas', () => {
  test('doido sempre satisfatível e com 17–21 pistas', () => {
    for (let k = 0; k < 40; k++) {
      const { solution, initial } = engine.createUniqueSudokuPuzzle(9, 3, 3, sym9, 'doido');
      expect(isValidCompleteGrid(solution, 9, 3, 3, sym9)).toBe(true);
      expect(isSubsetOfSolution(initial, solution, 9)).toBe(true);
      const c = clueCount(initial);
      expect(c).toBeGreaterThanOrEqual(17);
      expect(c).toBeLessThanOrEqual(21);
    }
  });

  test('uaiso sempre satisfatível e com 22–24 pistas', () => {
    for (let k = 0; k < 40; k++) {
      const { solution, initial } = engine.createUniqueSudokuPuzzle(9, 3, 3, sym9, 'uaiso');
      expect(isValidCompleteGrid(solution, 9, 3, 3, sym9)).toBe(true);
      expect(isSubsetOfSolution(initial, solution, 9)).toBe(true);
      const c = clueCount(initial);
      expect(c).toBeGreaterThanOrEqual(22);
      expect(c).toBeLessThanOrEqual(24);
    }
  });

  test('doido admite múltiplas soluções em algumas instâncias (exceção preservada) e sempre >=1', () => {
    let multi = 0;
    for (let k = 0; k < 120; k++) {
      const { initial } = engine.createUniqueSudokuPuzzle(9, 3, 3, sym9, 'doido');
      const cnt = gridSolutions(initial, 9, 3, 3, sym9);
      expect(cnt).toBeGreaterThanOrEqual(1); // sempre satisfatível
      if (cnt > 1) multi++;
    }
    expect(multi).toBeGreaterThan(0); // a exceção de múltiplas soluções ocorre em 9x9/doido
  });
});

// ─── Unicidade preservada onde é exigida ────────────────────────────────────
describe('Unicidade preservada nos caminhos que já exigem unicidade', () => {
  test('9x9 facil/medio/dificil geram instância única', () => {
    for (const diff of ['facil', 'medio', 'dificil']) {
      for (let k = 0; k < 6; k++) {
        const { initial } = engine.createUniqueSudokuPuzzle(9, 3, 3, sym9, diff);
        expect(gridSolutions(initial, 9, 3, 3, sym9)).toBe(1);
      }
    }
  });

  test('4x4 e 6x6 facil/medio/dificil geram instância única', () => {
    for (const [N, bR, bC] of [[4, 2, 2], [6, 2, 3]]) {
      const syms = symbolsFor(N);
      for (const diff of ['facil', 'medio', 'dificil']) {
        for (let k = 0; k < 5; k++) {
          const { initial } = engine.createUniqueSudokuPuzzle(N, bR, bC, syms, diff);
          expect(gridSolutions(initial, N, bR, bC, syms)).toBe(1);
        }
      }
    }
  });
});

// ─── Busca inconclusiva não é confundida com validade ────────────────────────
describe('Busca inconclusiva não é confundida com confirmação de validade/unicidade', () => {
  test('countSolutionsMRV com orçamento baixo em grade multi-solução retorna >=2, nunca 1', () => {
    // grade 4x4 vazia tem múltiplas soluções; orçamento 1 indica inconclusivo (>=2), não unicidade (1)
    const empty = Array.from({ length: 4 }, () => Array(4).fill(-1));
    expect(engine.countSolutionsMRV(empty, 4, 2, 2, 2, 1)).toBeGreaterThanOrEqual(2);
  });

  test('gerador geral só remove pistas quando unicidade é comprovada (resultado único)', () => {
    const { initial } = engine.createUniqueSudokuPuzzle(9, 3, 3, sym9, 'medio');
    // se a remoção tivesse usado busca inconclusiva como confirmação, o resultado não seria único
    expect(gridSolutions(initial, 9, 3, 3, sym9)).toBe(1);
  });
});

// ─── Regressão — preservação de comportamento ───────────────────────────────
describe('Regressão — preservação de comportamento e dificuldades', () => {
  test('ordem de pistas preservada em 9x9: facil > medio > dificil', () => {
    const avg = (diff) => {
      let s = 0;
      for (let k = 0; k < 5; k++) s += clueCount(engine.createUniqueSudokuPuzzle(9, 3, 3, sym9, diff).initial);
      return s / 5;
    };
    expect(avg('facil')).toBeGreaterThan(avg('medio'));
    expect(avg('medio')).toBeGreaterThan(avg('dificil'));
  });

  test('gerador produz grade NxN para cada dimensão suportada', () => {
    for (const [N, bR, bC] of [[4, 2, 2], [6, 2, 3], [9, 3, 3], [12, 3, 4], [16, 4, 4], [25, 5, 5]]) {
      const { solution, initial } = engine.createUniqueSudokuPuzzle(N, bR, bC, symbolsFor(N), 'medio');
      expect(solution).toHaveLength(N);
      expect(initial).toHaveLength(N);
    }
  });

  test('exceção de múltiplas soluções não atinge facil/medio/dificil (sempre únicos em 9x9)', () => {
    for (const diff of ['facil', 'medio', 'dificil']) {
      for (let k = 0; k < 8; k++) {
        const { initial } = engine.createUniqueSudokuPuzzle(9, 3, 3, sym9, diff);
        expect(gridSolutions(initial, 9, 3, 3, sym9)).toBe(1);
      }
    }
  });

  test('doido é a dificuldade com menos pistas que facil em 9x9', () => {
    const avg = (diff) => {
      let s = 0;
      for (let k = 0; k < 5; k++) s += clueCount(engine.createUniqueSudokuPuzzle(9, 3, 3, sym9, diff).initial);
      return s / 5;
    };
    expect(avg('doido')).toBeLessThan(avg('facil'));
  });
});
