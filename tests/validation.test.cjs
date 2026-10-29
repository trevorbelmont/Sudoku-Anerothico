'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const engineSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'sudoku-engine.js'), 'utf8');
const sandbox = { console, Math, Set, Map, Array, Object, Number, String, Boolean, JSON, Date };
vm.createContext(sandbox);
vm.runInContext(engineSource, sandbox, { filename: 'sudoku-engine.js' });

const symbols = ['1', '2', '3', '4'];
const solution = [
  ['1', '2', '3', '4'],
  ['3', '4', '1', '2'],
  ['2', '1', '4', '3'],
  ['4', '3', '2', '1']
];
const validInitial = [
  ['1', '', '', '4'],
  ['', '4', '1', ''],
  ['', '1', '4', ''],
  ['4', '', '', '1']
];

function payload(initial = validInitial, sol = solution, overrides = {}) {
  return { N: 4, bR: 2, bC: 2, s: symbols, i: initial, sol, ...overrides };
}

test('accepts a valid puzzle and compatible complete solution', () => {
  const result = sandbox.validateGameState(payload());
  assert.ok(result);
  assert.equal(result.N, 4);
  assert.deepEqual(JSON.parse(JSON.stringify(result.sol)), solution);
});

test('accepts puzzles that may have multiple solutions (uniqueness is not required)', () => {
  // An empty 4x4 grid has multiple solutions; the validator only requires a valid compatible solution.
  const result = sandbox.validateGameState(payload(Array.from({ length: 4 }, () => Array(4).fill(''))));
  assert.ok(result);
  assert.equal(sandbox.solutionMatchesInitial(result.sol, result.initial, 4, 2, 2, symbols), true);
});

test('rejects conflicting initial clues', () => {
  const conflict = validInitial.map(row => row.slice());
  conflict[0][1] = '1';
  assert.equal(sandbox.validateGameState(payload(conflict)), null);
});

test('rejects incomplete or rule-invalid canonical solutions', () => {
  const incomplete = solution.map(row => row.slice());
  incomplete[0][0] = '';
  assert.equal(sandbox.validateGameState(payload(validInitial, incomplete)), null);
  const duplicate = solution.map(row => row.slice());
  duplicate[0][1] = '1';
  assert.equal(sandbox.validateGameState(payload(validInitial, duplicate)), null);
});

test('rejects block dimensions that do not divide the board', () => {
  assert.equal(sandbox.validateGameState(payload(validInitial, solution, { bR: 3, bC: 2 })), null);
});

test('rejects boards that change a fixed clue', () => {
  const changed = solution.map(row => row.slice());
  changed[0][0] = '2';
  assert.equal(sandbox.boardPreservesInitial(changed, validInitial, 4), false);
});

test('rejects excessive custom symbol ranges before building a large array', () => {
  assert.equal(sandbox.buildSymbolsFromRange(-1000000, 1000000, false).length, 0);
  assert.equal(sandbox.buildSymbolsFromRange(1, 1000000, false).length, 0);
});
