'use strict';

const { loadMultiplayerContributionPersistenceModule } = require('../helpers/engine-loader');

describe('persistência consolidada de contribuições', () => {
  function makePublisher() {
    const module = loadMultiplayerContributionPersistenceModule();
    const { state, exports } = module;
    state.N = 9;
    state.multiplayer.active = true;
    state.multiplayer.roomId = 'room-test';
    state.multiplayer.playerId = 'player-a';
    state.multiplayer.playerName = 'Jogador A';
    state.multiplayer.color = '#123456';
    state.multiplayer.roomMode = 'coop';
    state.multiplayer.cellLocks = { '0_0': 'player-a' };
    state.board = Array.from({ length: 9 }, () => Array(9).fill(''));
    state.board[0][0] = '5';
    state.notes = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => new Set()));
    state.timerSeconds = 10;
    state.gameName = 'Sala teste';
    return module;
  }

  test('grava boardState, lock e contribuição consolidada sem criar contributionEvents', () => {
    const module = makePublisher();
    const contribution = {
      kind: 'PLAYER', action: 'SET', playerId: 'player-a',
      playerName: 'Jogador A', playerColor: '#123456', timestamp: 1000,
    };

    module.exports.publishRoomBoardCell(0, 0, false, { contribution });

    expect(module.updates).toHaveLength(1);
    const patch = module.updates[0].patch;
    expect(patch['boardState/boardValues/0/0']).toBe('5');
    expect(patch['boardState/cellLocks/0_0']).toBe('player-a');
    expect(patch['boardState/cellLastUpdatedByPlayerIdByCell/0_0']).toBe('player-a');
    expect(patch['contributions/0_0']).toEqual(contribution);
    expect(Object.keys(patch).some(path => path.includes('contributionEvents'))).toBe(false);
  });

  test('remoção de autoria continua sincronizada como null no mapa consolidado', () => {
    const module = makePublisher();
    module.state.multiplayer.cellLocks = {};

    module.exports.publishRoomBoardCell(0, 0, false, { contribution: null });

    const patch = module.updates[0].patch;
    expect(patch['contributions/0_0']).toBeNull();
    expect(patch['boardState/cellLocks/0_0']).toBeNull();
    expect(Object.keys(patch).some(path => path.includes('contributionEvents'))).toBe(false);
  });

  test('limpeza de uma sala remove a subárvore legada inteira', async () => {
    const module = loadMultiplayerContributionPersistenceModule();

    await expect(module.exports.clearDeprecatedContributionEvents('room-test')).resolves.toBe(true);
    expect(module.removals).toEqual(['rooms/room-test/contributionEvents']);
  });
});
