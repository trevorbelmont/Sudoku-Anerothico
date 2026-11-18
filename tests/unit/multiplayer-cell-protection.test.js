/**
 * Proteção de autoria das células corretas em salas multiplayer.
 * A política é independente do modo da sala (coop/versus) e não afeta o offline.
 */
'use strict';

const {
  loadInputControllerProtectionModule,
  loadMultiplayerServiceProtectionModule,
} = require('../helpers/engine-loader');

function configureCell(state, { active = true, roomMode = 'coop', playerId = 'player-a', ownerId = 'player-a', value = '5' } = {}) {
  state.N = 9;
  state.multiplayer.active = active;
  state.multiplayer.roomId = active ? 'room-test' : null;
  state.multiplayer.roomMode = roomMode;
  state.multiplayer.playerId = playerId;
  state.multiplayer.cellLocks = ownerId === undefined ? {} : { '0_0': ownerId };
  state.multiplayer.contributions = ownerId === undefined ? {} : { '0_0': { playerId: ownerId } };
  state.board = Array.from({ length: 9 }, () => Array(9).fill(''));
  state.solution = Array.from({ length: 9 }, () => Array(9).fill(''));
  state.board[0][0] = value;
  state.solution[0][0] = '5';
}

describe('isMultiplayerCellEditableByCurrentPlayer', () => {
  test.each(['coop', 'versus'])('em sala %s, outro jogador não pode alterar a célula correta', roomMode => {
    const { exports, state } = loadInputControllerProtectionModule();
    configureCell(state, { roomMode, playerId: 'player-b', ownerId: 'player-a' });
    expect(exports.isMultiplayerCellEditableByCurrentPlayer(0, 0)).toBe(false);
  });

  test('em qualquer modo multiplayer, o autor da resposta correta pode alterá-la', () => {
    const { exports, state } = loadInputControllerProtectionModule();
    configureCell(state, { roomMode: 'coop', playerId: 'player-a', ownerId: 'player-a' });
    expect(exports.isMultiplayerCellEditableByCurrentPlayer(0, 0)).toBe(true);
    state.multiplayer.roomMode = 'versus';
    expect(exports.isMultiplayerCellEditableByCurrentPlayer(0, 0)).toBe(true);
  });

  test('singleplayer não aplica bloqueio mesmo que exista autoria multiplayer antiga', () => {
    const { exports, state } = loadInputControllerProtectionModule();
    configureCell(state, { active: false, playerId: 'player-b', ownerId: 'player-a' });
    expect(exports.isMultiplayerCellEditableByCurrentPlayer(0, 0)).toBe(true);
  });

  test('célula errada continua editável por qualquer jogador', () => {
    const { exports, state } = loadInputControllerProtectionModule();
    configureCell(state, { playerId: 'player-b', ownerId: 'player-a', value: '4' });
    expect(exports.isMultiplayerCellEditableByCurrentPlayer(0, 0)).toBe(true);
  });

  test('célula vazia continua editável por qualquer jogador', () => {
    const { exports, state } = loadInputControllerProtectionModule();
    configureCell(state, { playerId: 'player-b', ownerId: 'player-a', value: '' });
    expect(exports.isMultiplayerCellEditableByCurrentPlayer(0, 0)).toBe(true);
  });

  test('resposta correta sem autoria conhecida fica bloqueada para evitar apropriação', () => {
    const { exports, state } = loadInputControllerProtectionModule();
    configureCell(state, { playerId: 'player-b', ownerId: undefined });
    expect(exports.isMultiplayerCellEditableByCurrentPlayer(0, 0)).toBe(false);
  });

  test('resposta correta revelada pela NASA não pode ser alterada por jogador', () => {
    const { exports, state } = loadInputControllerProtectionModule();
    configureCell(state, { playerId: 'player-a', ownerId: 'NASA' });
    expect(exports.isMultiplayerCellEditableByCurrentPlayer(0, 0)).toBe(false);
  });

  test('o autor pode substituir sua resposta correta por uma resposta errada', () => {
    const { exports, state } = loadInputControllerProtectionModule();
    configureCell(state, { playerId: 'player-a', ownerId: 'player-a' });
    state.initial = Array.from({ length: 9 }, () => Array(9).fill(''));
    state.notes = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => new Set()));
    state.revealedErrors = Array.from({ length: 9 }, () => Array(9).fill(false));
    state.symbols = ['1','2','3','4','5','6','7','8','9'];
    exports.applySymbolToCell(0, 0, '4');
    expect(state.board[0][0]).toBe('4');
  });

  test('as rotas de digitação e apagamento bloqueiam outro jogador antes de mutar o tabuleiro', () => {
    const { exports, state } = loadInputControllerProtectionModule();
    configureCell(state, { playerId: 'player-b', ownerId: 'player-a' });
    state.initial = Array.from({ length: 9 }, () => Array(9).fill(''));
    state.notes = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => new Set()));
    state.revealedErrors = Array.from({ length: 9 }, () => Array(9).fill(false));
    state.symbols = ['1','2','3','4','5','6','7','8','9'];
    exports.applySymbolToCell(0, 0, '4');
    expect(state.board[0][0]).toBe('5');
    exports.eraseCell(0, 0);
    expect(state.board[0][0]).toBe('5');
    state.pencilMode = true;
    exports.applySymbolToCell(0, 0, '4');
    expect(state.board[0][0]).toBe('5');
  });
});

describe('política de atualização remota da célula', () => {
  const mp = loadMultiplayerServiceProtectionModule();

  test('aceita que o autor substitua a resposta correta por uma errada e libera a autoria', () => {
    expect(mp.resolveCellOwnershipUpdate('5', '4', '5', 'player-a', 'player-a'))
      .toEqual({ accepted: true, ownerId: null });
  });

  test('rejeita que outro jogador altere uma resposta correta e preserva sua autoria', () => {
    expect(mp.resolveCellOwnershipUpdate('5', '4', '5', 'player-a', 'player-b'))
      .toEqual({ accepted: false, ownerId: 'player-a' });
  });

  test('rejeita alteração de célula correta sem editor por célula identificado', () => {
    expect(mp.resolveCellOwnershipUpdate('5', '', '5', 'player-a', ''))
      .toEqual({ accepted: false, ownerId: 'player-a' });
  });

  test('célula vazia ou errada pode ser preenchida por qualquer jogador', () => {
    expect(mp.resolveCellOwnershipUpdate('', '5', '5', null, 'player-b'))
      .toEqual({ accepted: true, ownerId: 'player-b' });
    expect(mp.resolveCellOwnershipUpdate('4', '5', '5', 'player-a', 'player-b'))
      .toEqual({ accepted: true, ownerId: 'player-b' });
  });

  test('update sem mudança de valor não transfere autoria mesmo que traga outro owner', () => {
    expect(mp.resolveCellOwnershipUpdate('5', '5', '5', 'player-a', 'player-b', 'player-b'))
      .toEqual({ accepted: true, ownerId: 'player-a' });
  });

  test('resposta revelada pela NASA permanece bloqueada para jogadores', () => {
    expect(mp.resolveCellOwnershipUpdate('5', '4', '5', 'NASA', 'player-a'))
      .toEqual({ accepted: false, ownerId: 'NASA' });
  });
});


describe('saída da sala e continuação offline', () => {
  test('desativa os locks locais sem apagar contribuições consolidadas', () => {
    const mp = loadMultiplayerServiceProtectionModule();
    const state = mp.state;
    state.multiplayer.active = true;
    state.multiplayer.roomId = 'room-test';
    state.multiplayer.cellLocks = { '0_0': 'player-a' };
    state.multiplayer.contributions = { '0_0': { playerId: 'player-a', kind: 'PLAYER', action: 'SET' } };

    mp.deactivateMultiplayerSessionForOffline();

    expect(state.multiplayer.active).toBe(false);
    expect(state.multiplayer.roomId).toBeNull();
    expect(state.multiplayer.cellLocks).toEqual({});
    expect(state.multiplayer.contributions['0_0'].playerId).toBe('player-a');
  });

  test('snapshot atrasado não substitui o tabuleiro depois da saída', () => {
    const mp = loadMultiplayerServiceProtectionModule();
    const state = mp.state;
    state.N = 9;
    state.multiplayer.active = true;
    state.multiplayer.roomId = 'room-test';
    state.multiplayer.instanceCount = 2;
    state.multiplayer.lastAppliedInstanceNumber = 2;
    state.initial = Array.from({ length: 9 }, () => Array(9).fill(''));
    state.solution = Array.from({ length: 9 }, () => Array(9).fill(''));
    state.board = Array.from({ length: 9 }, () => Array(9).fill(''));
    state.board[0][0] = '5';
    mp.deactivateMultiplayerSessionForOffline();

    const incoming = Array.from({ length: 9 }, () => Array(9).fill(''));
    incoming[0][0] = '4';
    mp.applyRoomBoardState({ boardInstanceNumber: 2, boardValues: incoming });

    expect(state.board[0][0]).toBe('5');
  });
});

describe('integração da proteção ao receber boardState', () => {
  function makeRemoteState({ localValue = '5', ownerId = 'player-a', incomingValue = '4', editorId = 'player-b', incomingOwnerId = null } = {}) {
    const mp = loadMultiplayerServiceProtectionModule();
    const state = mp.state;
    state.N = 9;
    state.symbols = ['1','2','3','4','5','6','7','8','9'];
    state.initial = Array.from({ length: 9 }, () => Array(9).fill(''));
    state.solution = Array.from({ length: 9 }, () => Array(9).fill(''));
    state.solution[0][0] = '5';
    state.board = Array.from({ length: 9 }, () => Array(9).fill(''));
    state.board[0][0] = localValue;
    state.notes = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => new Set()));
    state.multiplayer.active = true;
    state.multiplayer.roomId = 'room-test';
    state.multiplayer.roomMode = 'coop';
    state.multiplayer.instanceCount = 2;
    state.multiplayer.lastAppliedInstanceNumber = 2;
    state.multiplayer.cellLocks = ownerId ? { '0_0': ownerId } : {};
    state.multiplayer.contributions = ownerId ? { '0_0': { playerId: ownerId } } : {};
    const boardValues = Array.from({ length: 9 }, () => Array(9).fill(''));
    boardValues[0][0] = incomingValue;
    const cellLocks = {};
    if (incomingOwnerId) cellLocks['0_0'] = incomingOwnerId;
    const cellEditors = {};
    if (editorId) cellEditors['0_0'] = editorId;
    mp.applyRoomBoardState({
      boardInstanceNumber: 2,
      boardValues,
      cellLocks,
      cellLastUpdatedByPlayerIdByCell: cellEditors,
      pencilNotes: [],
      elapsedSeconds: 0,
      isCompleted: false,
    });
    return state;
  }

  test('rejeita atualização recebida de outro jogador e preserva valor e autoria', () => {
    const state = makeRemoteState({ editorId: 'player-b' });
    expect(state.board[0][0]).toBe('5');
    expect(state.multiplayer.cellLocks['0_0']).toBe('player-a');
  });

  test('aceita atualização recebida do próprio autor e remove o bloqueio após tornar a célula errada', () => {
    const state = makeRemoteState({ editorId: 'player-a' });
    expect(state.board[0][0]).toBe('4');
    expect(state.multiplayer.cellLocks['0_0']).toBeUndefined();
  });

  test('não transfere autoria quando outro jogador apenas reenvia o mesmo valor correto', () => {
    const state = makeRemoteState({ incomingValue: '5', editorId: 'player-b', incomingOwnerId: 'player-b' });
    expect(state.board[0][0]).toBe('5');
    expect(state.multiplayer.cellLocks['0_0']).toBe('player-a');
  });
});
