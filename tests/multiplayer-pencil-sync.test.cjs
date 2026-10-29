'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const multiplayer = fs.readFileSync(path.join(root, 'js', 'multiplayer-service.js'), 'utf8');
const input = fs.readFileSync(path.join(root, 'js', 'input-controller.js'), 'utf8');

test('cooperative pencil notes are sent through the shared board transaction', () => {
  assert.match(multiplayer, /if \(action === 'NOTE' && state\.multiplayer\.roomMode === 'versus'\) return Promise\.resolve/);
  assert.match(multiplayer, /publishRoomBoardCell\(row, column, action, value, desiredNotePresent\)/);
  assert.match(multiplayer, /const normalizedNotes = normalizeNotesGrid\(currentValue\.pencilNotes, state\.N, state\.symbols\)/);
});

test('pencil note updates merge as cell-level add/remove operations instead of replacing a stale grid cell', () => {
  assert.match(multiplayer, /if \(notePresent\) \{\s*if \(!cellNotes\.includes\(normalizedNoteSymbol\) && cellNotes\.length < state\.N\) cellNotes\.push\(normalizedNoteSymbol\);/);
  assert.match(multiplayer, /notesCopy\[row\]\[column\] = cellNotes\.filter\(symbol => symbol !== normalizedNoteSymbol\)/);
  assert.doesNotMatch(multiplayer, /notesCopy\[row\]\[column\] = localNotes/);
});

test('pencil notes remain private in Versus and preserve intent after an erase transaction', () => {
  assert.match(input, /state\.multiplayer\.roomMode !== 'versus'/);
  assert.match(input, /let eraseSync = Promise\.resolve/);
  assert.match(input, /pushMoveToFirebase\('NOTE', r, c, symbol, notePresent\)/);
  assert.match(input, /Promise\.resolve\(eraseSync\).*then\(\(\) => \{/);
});
