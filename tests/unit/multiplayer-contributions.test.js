/**
 * multiplayer-contributions.test.js
 *
 * Testes unitários para computeContributionStats (js/multiplayer-voting.js)
 *
 * computeContributionStats agrega as contribuições por jogador a partir de
 * state.multiplayer.contributions, mantendo visíveis todos os participantes
 * (mesmo com zero casas), excluindo entradas da NASA, e calculando o
 * percentual relativo ao total (contribuições humanas + chamadas NASA).
 */

'use strict';

const { loadMultiplayerVotingModule, makeStateStubb } = require('../helpers/engine-loader');

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Monta um estado multiplayer com N=9, tabuleiro e contribuições configuráveis.
 */
function setupState(overrides = {}) {
  const mod = loadMultiplayerVotingModule();
  const s = mod.state;
  s.N = 9; s.blockR = 3; s.blockC = 3;
  s.symbols = ['1','2','3','4','5','6','7','8','9'];
  // Grade inicial vazia (todas editáveis) para a contagem de células NASA
  s.initial = Array.from({ length: 9 }, () => Array(9).fill(''));
  s.board = Array.from({ length: 9 }, () => Array(9).fill(''));
  s.nasaContributions = Array.from({ length: 9 }, () => Array(9).fill(false));
  s.nasaCalls = 0;
  s.multiplayer.active = true;
  s.multiplayer.roomId = 'room_test';
  s.multiplayer.playerId = 'p_self';
  s.multiplayer.playerName = 'Você';
  s.multiplayer.contributions = {};
  s.multiplayer.members = {};
  s.multiplayer.players = {};
  // Mescla apenas as chaves de multiplayer (preservando playerId/active/etc.)
  Object.assign(s.multiplayer, overrides.multiplayer || {});
  // Permite sobrescrever campos diretos do state (ex.: nasaCalls) sem afetar multiplayer
  if (overrides.nasaCalls !== undefined) s.nasaCalls = overrides.nasaCalls;
  return mod;
}

function playerContribution(playerId, playerName, row, col) {
  return { [`${row}_${col}`]: { playerId, playerName } };
}

function mergeContributions(...objs) {
  return Object.assign({}, ...objs);
}

// ─────────────────────────────────────────────────────────────
// Caso base: sem contribuições
// ─────────────────────────────────────────────────────────────
describe('computeContributionStats — caso base', () => {
  test('sem contribuições, retorna apenas o jogador atual com count 0 e percent 0', () => {
    const { exports, state } = setupState();
    const rows = exports.computeContributionStats();
    expect(rows).toHaveLength(1);
    expect(rows[0].playerId).toBe('p_self');
    expect(rows[0].count).toBe(0);
    expect(rows[0].percent).toBe(0);
  });

  test('resultado é um array', () => {
    const { exports } = setupState();
    expect(Array.isArray(exports.computeContributionStats())).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// Agregação por playerId
// ─────────────────────────────────────────────────────────────
describe('computeContributionStats — agregação por jogador', () => {
  test('conta casas atribuídas a cada jogador', () => {
    const { exports, state } = setupState({
      multiplayer: {
        contributions: mergeContributions(
          playerContribution('p_a', 'Alice', 0, 0),
          playerContribution('p_a', 'Alice', 0, 1),
          playerContribution('p_a', 'Alice', 1, 1),
          playerContribution('p_b', 'Bob', 2, 2)
        ),
      },
    });
    const rows = exports.computeContributionStats();
    const alice = rows.find(r => r.playerId === 'p_a');
    const bob = rows.find(r => r.playerId === 'p_b');
    expect(alice.count).toBe(3);
    expect(bob.count).toBe(1);
  });

  test('ordena por count decrescente', () => {
    const { exports } = setupState({
      multiplayer: {
        contributions: mergeContributions(
          playerContribution('p_b', 'Bob', 0, 0),
          playerContribution('p_a', 'Alice', 1, 0),
          playerContribution('p_a', 'Alice', 1, 1),
          playerContribution('p_a', 'Alice', 1, 2)
        ),
      },
    });
    const rows = exports.computeContributionStats();
    expect(rows[0].playerId).toBe('p_a');
    expect(rows[0].count).toBe(3);
  });

  test('desempata por nome em ordem alfabética (locale pt-BR) quando count é igual', () => {
    const { exports } = setupState({
      multiplayer: {
        contributions: mergeContributions(
          playerContribution('p_zoe', 'Zoe', 0, 0),
          playerContribution('p_amy', 'Amy', 1, 1)
        ),
      },
    });
    const rows = exports.computeContributionStats();
    // Ambos com count 1; Amy deve vir antes de Zoe
    expect(rows[0].name).toBe('Amy');
    expect(rows[1].name).toBe('Zoe');
  });
});

// ─────────────────────────────────────────────────────────────
// Inclusão de participantes com zero contribuições
// ─────────────────────────────────────────────────────────────
describe('computeContributionStats — participantes sem contribuição', () => {
  test('membros em members aparecem mesmo sem contribuir', () => {
    const { exports } = setupState({
      multiplayer: {
        members: {
          p_a: { playerName: 'Alice' },
          p_b: { name: 'Bob' },
        },
      },
    });
    const rows = exports.computeContributionStats();
    const ids = rows.map(r => r.playerId);
    expect(ids).toContain('p_a');
    expect(ids).toContain('p_b');
    const alice = rows.find(r => r.playerId === 'p_a');
    expect(alice.count).toBe(0);
  });

  test('jogadores em players aparecem mesmo sem contribuir', () => {
    const { exports } = setupState({
      multiplayer: {
        players: {
          p_x: { playerName: 'Xavier' },
        },
      },
    });
    const rows = exports.computeContributionStats();
    expect(rows.find(r => r.playerId === 'p_x').count).toBe(0);
  });

  test('o jogador atual sempre aparece, mesmo sem members/players', () => {
    const { exports } = setupState({ multiplayer: { contributions: {} } });
    const rows = exports.computeContributionStats();
    expect(rows.some(r => r.playerId === 'p_self')).toBe(true);
  });

  test('contribuidor que também está em members não é duplicado', () => {
    const { exports } = setupState({
      multiplayer: {
        contributions: playerContribution('p_a', 'Alice', 0, 0),
        members: { p_a: { playerName: 'Alice' } },
      },
    });
    const rows = exports.computeContributionStats();
    const alices = rows.filter(r => r.playerId === 'p_a');
    expect(alices).toHaveLength(1);
    expect(alices[0].count).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────
// Exclusão de entradas da NASA
// ─────────────────────────────────────────────────────────────
describe('computeContributionStats — entradas NASA são excluídas', () => {
  test('entrada com playerId="NASA" não conta como contribuição de jogador', () => {
    const { exports } = setupState({
      multiplayer: {
        contributions: mergeContributions(
          playerContribution('p_a', 'Alice', 0, 0),
          { '1_1': { playerId: 'NASA', playerName: 'NASA' } }
        ),
      },
    });
    const rows = exports.computeContributionStats();
    // Não deve existir um "jogador" NASA
    expect(rows.find(r => r.playerId === 'NASA')).toBeUndefined();
    expect(rows.find(r => r.playerId === 'p_a').count).toBe(1);
  });

  test('entrada com kind="NASA" é ignorada', () => {
    const { exports } = setupState({
      multiplayer: {
        contributions: { '0_0': { playerId: 'p_a', playerName: 'Alice', kind: 'NASA' } },
        members: { p_a: { playerName: 'Alice' } },
      },
    });
    const rows = exports.computeContributionStats();
    // A entrada NASA é ignorada, então p_a fica com count 0
    expect(rows.find(r => r.playerId === 'p_a').count).toBe(0);
  });

  test('entrada com action="NASA" é ignorada', () => {
    const { exports } = setupState({
      multiplayer: {
        contributions: { '0_0': { playerId: 'p_a', playerName: 'Alice', action: 'NASA' } },
        members: { p_a: { playerName: 'Alice' } },
      },
    });
    const rows = exports.computeContributionStats();
    expect(rows.find(r => r.playerId === 'p_a').count).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// Cálculo de percentual
// ─────────────────────────────────────────────────────────────
describe('computeContributionStats — percentual', () => {
  test('percent é calculado sobre (humanas + NASA calls)', () => {
    const { exports, state } = setupState({
      multiplayer: {
        contributions: mergeContributions(
          playerContribution('p_a', 'Alice', 0, 0),
          playerContribution('p_a', 'Alice', 0, 1),
          playerContribution('p_b', 'Bob', 1, 0)
        ),
      },
    });
    // 3 humanas + nasaCalls (0) = total 3
    state.nasaCalls = 0;
    const rows = exports.computeContributionStats();
    const alice = rows.find(r => r.playerId === 'p_a');
    const bob = rows.find(r => r.playerId === 'p_b');
    // Alice: 2/3 = 67%, Bob: 1/3 = 33%
    expect(alice.percent).toBe(67);
    expect(bob.percent).toBe(33);
  });

  test('nasaCalls entra no total e reduz o percentual humano', () => {
    const { exports, state } = setupState({
      multiplayer: {
        contributions: mergeContributions(
          playerContribution('p_a', 'Alice', 0, 0),
          playerContribution('p_a', 'Alice', 0, 1)
        ),
      },
    });
    // 2 humanas + 2 NASA calls = total 4; Alice = 2/4 = 50%
    state.nasaCalls = 2;
    const rows = exports.computeContributionStats();
    expect(rows.find(r => r.playerId === 'p_a').percent).toBe(50);
  });

  test('percent é 0 quando não há nenhuma contribuição', () => {
    const { exports } = setupState();
    const rows = exports.computeContributionStats();
    rows.forEach(r => expect(r.percent).toBe(0));
  });

  test('percent arredonda para inteiro', () => {
    const { exports, state } = setupState({
      multiplayer: {
        contributions: mergeContributions(
          playerContribution('p_a', 'Alice', 0, 0),
          playerContribution('p_b', 'Bob', 1, 0),
          playerContribution('p_c', 'Carl', 2, 0)
        ),
      },
    });
    state.nasaCalls = 0;
    const rows = exports.computeContributionStats();
    // total = 3; cada um 1/3 = 33.33.. -> 33
    rows.forEach(r => expect(Number.isInteger(r.percent)).toBe(true));
  });
});

// ─────────────────────────────────────────────────────────────
// Robustez
// ─────────────────────────────────────────────────────────────
describe('computeContributionStats — robustez', () => {
  test('contributions undefined não lança exceção', () => {
    const { exports, state } = setupState({ multiplayer: { contributions: undefined } });
    expect(() => exports.computeContributionStats()).not.toThrow();
  });

  test('contributions não-objeto (array) retorna o jogador atual', () => {
    const { exports, state } = setupState({ multiplayer: { contributions: [] } });
    const rows = exports.computeContributionStats();
    expect(rows.some(r => r.playerId === 'p_self')).toBe(true);
  });

  test('entrada nula em contributions é ignorada', () => {
    const { exports } = setupState({
      multiplayer: { contributions: { '0_0': null, '1_1': { playerId: 'p_a', playerName: 'Alice' } } },
    });
    const rows = exports.computeContributionStats();
    expect(rows.find(r => r.playerId === 'p_a').count).toBe(1);
  });

  test('nome do jogador é atualizado a partir da contribuição', () => {
    const { exports } = setupState({
      multiplayer: {
        members: { p_a: { playerName: 'Nome Antigo' } },
        contributions: playerContribution('p_a', 'Nome Novo', 0, 0),
      },
    });
    const rows = exports.computeContributionStats();
    expect(rows.find(r => r.playerId === 'p_a').name).toBe('Nome Novo');
  });

  test('membros sem playerName usam "Jogador" como fallback', () => {
    const { exports } = setupState({
      multiplayer: { members: { p_anon: {} } },
    });
    const rows = exports.computeContributionStats();
    expect(rows.find(r => r.playerId === 'p_anon').name).toBe('Jogador');
  });
});
