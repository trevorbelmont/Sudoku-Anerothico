/**
 * game-storage-roundtrip.test.js
 *
 * Testes de integração: persistência de partidas (save → getAll → restore)
 * Cobre: getAllSavedGames, saveCurrentGameState, updateSavedBadgeCount
 *        round-trip de serialização, deduplicação por gameId, limite de 35,
 *        filtragem de registros inválidos por validateGameState
 */

'use strict';

const { loadGameStorageModule, loadEngineModule } = require('../helpers/engine-loader');

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function makePuzzle9x9(difficulty = 'facil') {
  const engine = loadEngineModule();
  const sym = engine.buildSymbolsFromRange(1, 9, false);
  return { engine, sym, ...engine.createUniqueSudokuPuzzle(9, 3, 3, sym, difficulty) };
}

/**
 * Popula o `state` do módulo de storage com uma partida completa e válida.
 */
function populateState(state, puzzle, sym, opts = {}) {
  const { solution, initial } = puzzle;
  state.gameId = opts.gameId !== undefined ? opts.gameId : 'game_test_' + Math.random().toString(36).slice(2, 8);
  state.gameName = opts.gameName || '';
  state.mode = opts.mode || 'standard';
  state.difficulty = opts.difficulty || 'facil';
  state.minVal = 1; state.maxVal = 9; state.includeZero = false;
  state.symbols = sym;
  state.N = 9; state.blockR = 3; state.blockC = 3;
  state.solution = solution;
  state.initial = initial;
  state.board = opts.board || initial.map(r => r.slice());
  state.notes = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => new Set()));
  state.revealedErrors = Array.from({ length: 9 }, () => Array(9).fill(false));
  state.nasaContributions = Array.from({ length: 9 }, () => Array(9).fill(false));
  state.nasaCalls = 0;
  state.timerSeconds = opts.timerSeconds || 0;
  state.completed = opts.completed || false;
}

// ─────────────────────────────────────────────────────────────
// getAllSavedGames — leitura e filtragem
// ─────────────────────────────────────────────────────────────
describe('getAllSavedGames: leitura e filtragem', () => {
  let mod;

  beforeEach(() => { mod = loadGameStorageModule(); });

  test('retorna array vazio quando não há jogos salvos', () => {
    expect(mod.exports.getAllSavedGames()).toEqual([]);
  });

  test('retorna array vazio quando o conteúdo salvo não é JSON válido', () => {
    mod.localStorageMock.setItem(mod.STORAGE_KEYS.SAVED_GAMES, 'não é json');
    expect(mod.exports.getAllSavedGames()).toEqual([]);
  });

  test('retorna array vazio quando o conteúdo salvo não é um array', () => {
    mod.localStorageMock.setItem(mod.STORAGE_KEYS.SAVED_GAMES, JSON.stringify({ not: 'array' }));
    expect(mod.exports.getAllSavedGames()).toEqual([]);
  });

  test('filtra registros que falham em validateGameState (sem solution/initial)', () => {
    // Salva diretamente um array com um registro válido e um inválido
    const { sym, solution, initial } = makePuzzle9x9();
    const validRecord = {
      gameId: 'g1', mode: 'standard', difficulty: 'facil',
      symbols: sym, N: 9, blockR: 3, blockC: 3,
      solution, initial, board: initial, notes: [], timerSeconds: 0, completed: false,
    };
    const invalidRecord = { gameId: 'g2', N: 9, blockR: 3, blockC: 3, symbols: sym, initial: 'não é matriz' };
    mod.localStorageMock.setItem(
      mod.STORAGE_KEYS.SAVED_GAMES,
      JSON.stringify([validRecord, invalidRecord])
    );
    const games = mod.exports.getAllSavedGames();
    expect(games).toHaveLength(1);
    expect(games[0].gameId).toBe('g1');
  });
});

// ─────────────────────────────────────────────────────────────
// saveCurrentGameState → getAllSavedGames round-trip
// ─────────────────────────────────────────────────────────────
describe('save → getAll round-trip', () => {
  let mod, engine, sym, solution, initial;

  beforeEach(() => {
    mod = loadGameStorageModule();
    const puzzle = makePuzzle9x9();
    engine = puzzle.engine; sym = puzzle.sym;
    solution = puzzle.solution; initial = puzzle.initial;
  });

  test('salvar uma partida a torna recuperável por getAllSavedGames', () => {
    populateState(mod.state, { solution, initial }, sym, { gameId: 'game_alpha' });
    mod.exports.saveCurrentGameState();

    const games = mod.exports.getAllSavedGames();
    expect(games).toHaveLength(1);
    expect(games[0].gameId).toBe('game_alpha');
  });

  test('o registro recuperado preserva N, blockR/blockC e símbolos', () => {
    populateState(mod.state, { solution, initial }, sym, { gameId: 'game_beta' });
    mod.exports.saveCurrentGameState();

    const [g] = mod.exports.getAllSavedGames();
    expect(g.N).toBe(9);
    expect(g.blockR).toBe(3);
    expect(g.blockC).toBe(3);
    expect(g.symbols).toHaveLength(9);
  });

  test('solution e initial são preservados como matrizes 9×9', () => {
    populateState(mod.state, { solution, initial }, sym);
    mod.exports.saveCurrentGameState();

    const [g] = mod.exports.getAllSavedGames();
    expect(g.solution).toHaveLength(9);
    expect(g.initial).toHaveLength(9);
    g.solution.forEach(r => expect(r).toHaveLength(9));
    g.initial.forEach(r => expect(r).toHaveLength(9));
  });

  test('notas são serializadas como arrays (não Sets) no storage', () => {
    populateState(mod.state, { solution, initial }, sym);
    // Adiciona notas de lápis em algumas células
    mod.state.notes[0][0].add('5');
    mod.state.notes[0][0].add('7');
    mod.state.notes[3][4].add('2');
    mod.exports.saveCurrentGameState();

    // Lê o storage bruto e verifica que notes viraram arrays
    const raw = JSON.parse(mod.storage[mod.STORAGE_KEYS.SAVED_GAMES]);
    expect(raw[0].notes[0][0]).toEqual(expect.arrayContaining(['5', '7']));
    expect(raw[0].notes[3][4]).toContain('2');
  });

  test('timerSeconds e completed são persistidos', () => {
    populateState(mod.state, { solution, initial }, sym, { timerSeconds: 250, completed: false });
    mod.exports.saveCurrentGameState();
    let [g] = mod.exports.getAllSavedGames();
    expect(g.timerSeconds).toBe(250);
    expect(g.completed).toBe(false);

    // Salva novamente como concluído
    mod.state.completed = true;
    mod.state.timerSeconds = 300;
    mod.exports.saveCurrentGameState();
    [g] = mod.exports.getAllSavedGames();
    expect(g.timerSeconds).toBe(300);
    expect(g.completed).toBe(true);
  });

  test('board parcialmente preenchido é preservado', () => {
    populateState(mod.state, { solution, initial }, sym);
    // Preenche algumas células editáveis com a solução
    let filled = 0;
    for (let r = 0; r < 9 && filled < 5; r++)
      for (let c = 0; c < 9 && filled < 5; c++)
        if (mod.state.initial[r][c] === '') { mod.state.board[r][c] = solution[r][c]; filled++; }
    mod.exports.saveCurrentGameState();

    const [g] = mod.exports.getAllSavedGames();
    expect(g.board).toHaveLength(9);
    // Pelo menos as 5 células preenchidas devem estar presentes
    const boardFilled = g.board.flat().filter(v => v !== '').length;
    expect(boardFilled).toBeGreaterThanOrEqual(5);
  });
});

// ─────────────────────────────────────────────────────────────
// Deduplicação por gameId
// ─────────────────────────────────────────────────────────────
describe('Deduplicação por gameId', () => {
  let mod, sym, solution, initial;

  beforeEach(() => {
    mod = loadGameStorageModule();
    const puzzle = makePuzzle9x9();
    sym = puzzle.sym; solution = puzzle.solution; initial = puzzle.initial;
  });

  test('salvar o mesmo gameId duas vezes substitui em vez de duplicar', () => {
    populateState(mod.state, { solution, initial }, sym, { gameId: 'dup', timerSeconds: 10 });
    mod.exports.saveCurrentGameState();

    mod.state.timerSeconds = 99;
    mod.exports.saveCurrentGameState();

    const games = mod.exports.getAllSavedGames();
    const dupGames = games.filter(g => g.gameId === 'dup');
    expect(dupGames).toHaveLength(1);
    expect(dupGames[0].timerSeconds).toBe(99);
  });

  test('salvar gameIds diferentes mantém ambos', () => {
    populateState(mod.state, { solution, initial }, sym, { gameId: 'g_one' });
    mod.exports.saveCurrentGameState();

    populateState(mod.state, { solution, initial }, sym, { gameId: 'g_two' });
    mod.exports.saveCurrentGameState();

    const games = mod.exports.getAllSavedGames();
    expect(games).toHaveLength(2);
    const ids = games.map(g => g.gameId).sort();
    expect(ids).toEqual(['g_one', 'g_two']);
  });

  test('o jogo salvo mais recentemente fica no topo da lista', () => {
    populateState(mod.state, { solution, initial }, sym, { gameId: 'first' });
    mod.exports.saveCurrentGameState();

    populateState(mod.state, { solution, initial }, sym, { gameId: 'second' });
    mod.exports.saveCurrentGameState();

    const games = mod.exports.getAllSavedGames();
    expect(games[0].gameId).toBe('second');
  });
});

// ─────────────────────────────────────────────────────────────
// Limite de 35 jogos (trim)
// ─────────────────────────────────────────────────────────────
describe('Limite de 35 jogos salvos', () => {
  let mod, sym, solution, initial;

  beforeEach(() => {
    mod = loadGameStorageModule();
    const puzzle = makePuzzle9x9();
    sym = puzzle.sym; solution = puzzle.solution; initial = puzzle.initial;
  });

  test('salvar 37 jogos mantém apenas os 35 mais recentes', () => {
    for (let i = 0; i < 37; i++) {
      populateState(mod.state, { solution, initial }, sym, { gameId: 'game_' + i });
      mod.exports.saveCurrentGameState();
    }
    const games = mod.exports.getAllSavedGames();
    expect(games.length).toBeLessThanOrEqual(35);
  });
});

// ─────────────────────────────────────────────────────────────
// CURRENT_GAME_ID é atualizado
// ─────────────────────────────────────────────────────────────
describe('CURRENT_GAME_ID persistence', () => {
  let mod, sym, solution, initial;

  beforeEach(() => {
    mod = loadGameStorageModule();
    const puzzle = makePuzzle9x9();
    sym = puzzle.sym; solution = puzzle.solution; initial = puzzle.initial;
  });

  test('salvar uma partida grava o gameId atual em CURRENT_GAME_ID', () => {
    populateState(mod.state, { solution, initial }, sym, { gameId: 'current_game_xyz' });
    mod.exports.saveCurrentGameState();
    expect(mod.storage[mod.STORAGE_KEYS.CURRENT_GAME_ID]).toBe('current_game_xyz');
  });
});

// ─────────────────────────────────────────────────────────────
// updateSavedBadgeCount
// ─────────────────────────────────────────────────────────────
describe('updateSavedBadgeCount', () => {
  let mod, sym, solution, initial;

  beforeEach(() => {
    mod = loadGameStorageModule();
    const puzzle = makePuzzle9x9();
    sym = puzzle.sym; solution = puzzle.solution; initial = puzzle.initial;
  });

  test('atualiza o textContent do badge com a contagem de jogos', () => {
    populateState(mod.state, { solution, initial }, sym, { gameId: 'badge1' });
    mod.exports.saveCurrentGameState();
    // saveCurrentGameState chama updateSavedBadgeCount internamente
    expect(mod.badgeEl.textContent).toBe(1);

    populateState(mod.state, { solution, initial }, sym, { gameId: 'badge2' });
    mod.exports.saveCurrentGameState();
    expect(mod.badgeEl.textContent).toBe(2);
  });

  test('recebe lista explícita e usa seu tamanho', () => {
    mod.exports.updateSavedBadgeCount([1, 2, 3, 4, 5]);
    expect(mod.badgeEl.textContent).toBe(5);
  });

  test('sem argumentos, recalcula a partir do storage', () => {
    populateState(mod.state, { solution, initial }, sym, { gameId: 'recalc1' });
    mod.exports.saveCurrentGameState();
    populateState(mod.state, { solution, initial }, sym, { gameId: 'recalc2' });
    mod.exports.saveCurrentGameState();
    mod.exports.updateSavedBadgeCount();
    expect(mod.badgeEl.textContent).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────
// Robustez: salvar sem gameId é no-op
// ─────────────────────────────────────────────────────────────
describe('saveCurrentGameState robustez', () => {
  let mod, sym, solution, initial;

  beforeEach(() => {
    mod = loadGameStorageModule();
    const puzzle = makePuzzle9x9();
    sym = puzzle.sym; solution = puzzle.solution; initial = puzzle.initial;
  });

  test('não salva nada quando state.gameId é vazio', () => {
    populateState(mod.state, { solution, initial }, sym, { gameId: '' });
    mod.exports.saveCurrentGameState();
    expect(mod.exports.getAllSavedGames()).toEqual([]);
  });

  test('não lança exceção mesmo com notas vazias', () => {
    populateState(mod.state, { solution, initial }, sym, { gameId: 'empty_notes' });
    mod.state.notes = [];
    expect(() => mod.exports.saveCurrentGameState()).not.toThrow();
  });
});
