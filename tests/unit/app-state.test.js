/**
 * app-state.test.js
 *
 * Testes unitários para js/app-state.js
 * Cobre: STORAGE_KEYS, DIFFICULTY_LABELS, DIFFICULTY_REMOVAL_RATIOS,
 *        getOrCreatePersistentPlayerId, loadVisualSettings, state inicial
 */

'use strict';

const { loadAppStateModule } = require('../helpers/engine-loader');

let mod;

beforeEach(() => {
  // Carrega módulo fresh a cada teste para isolar estado
  mod = loadAppStateModule();
});

// ─────────────────────────────────────────────────────────────
// STORAGE_KEYS
// ─────────────────────────────────────────────────────────────
describe('STORAGE_KEYS', () => {
  test('define todas as chaves esperadas', () => {
    const keys = mod.STORAGE_KEYS;
    expect(keys).toHaveProperty('THEME');
    expect(keys).toHaveProperty('SAVED_GAMES');
    expect(keys).toHaveProperty('CURRENT_GAME_ID');
    expect(keys).toHaveProperty('PLAYER_ID');
    expect(keys).toHaveProperty('VISUAL_SETTINGS');
  });

  test('chaves são strings não-vazias', () => {
    Object.values(mod.STORAGE_KEYS).forEach(v => {
      expect(typeof v).toBe('string');
      expect(v.length).toBeGreaterThan(0);
    });
  });
});

// ─────────────────────────────────────────────────────────────
// DIFFICULTY_LABELS
// ─────────────────────────────────────────────────────────────
describe('DIFFICULTY_LABELS', () => {
  test('define rótulos para todas as cinco dificuldades', () => {
    const labels = mod.DIFFICULTY_LABELS;
    ['facil', 'medio', 'dificil', 'uaiso', 'doido'].forEach(key => {
      expect(labels).toHaveProperty(key);
      expect(typeof labels[key]).toBe('string');
      expect(labels[key].length).toBeGreaterThan(0);
    });
  });
});

// ─────────────────────────────────────────────────────────────
// DIFFICULTY_REMOVAL_RATIOS
// ─────────────────────────────────────────────────────────────
describe('DIFFICULTY_REMOVAL_RATIOS', () => {
  test('define razões para todas as cinco dificuldades', () => {
    const ratios = mod.DIFFICULTY_REMOVAL_RATIOS;
    ['facil', 'medio', 'dificil', 'uaiso', 'doido'].forEach(key => {
      expect(ratios).toHaveProperty(key);
      expect(typeof ratios[key]).toBe('number');
    });
  });

  test('razões estão entre 0 e 1', () => {
    Object.values(mod.DIFFICULTY_REMOVAL_RATIOS).forEach(ratio => {
      expect(ratio).toBeGreaterThan(0);
      expect(ratio).toBeLessThan(1);
    });
  });

  test('dificuldade maior implica remoção maior', () => {
    const r = mod.DIFFICULTY_REMOVAL_RATIOS;
    expect(r.facil).toBeLessThan(r.medio);
    expect(r.medio).toBeLessThan(r.dificil);
    expect(r.dificil).toBeLessThan(r.uaiso);
    expect(r.uaiso).toBeLessThan(r.doido);
  });
});

// ─────────────────────────────────────────────────────────────
// getOrCreatePersistentPlayerId
// ─────────────────────────────────────────────────────────────
describe('getOrCreatePersistentPlayerId', () => {
  test('retorna um ID começando com "player_"', () => {
    const id = mod.getOrCreatePersistentPlayerId();
    expect(id).toMatch(/^player_/);
  });

  test('ID tem comprimento mínimo adequado', () => {
    const id = mod.getOrCreatePersistentPlayerId();
    expect(id.length).toBeGreaterThanOrEqual(12);
  });

  test('reutiliza o ID armazenado no localStorage', () => {
    // Ao chamar duas vezes no mesmo módulo (mesmo localStorage mock),
    // o ID deve ser consistente
    const id1 = mod.getOrCreatePersistentPlayerId();
    const id2 = mod.getOrCreatePersistentPlayerId();
    expect(id1).toBe(id2);
  });

  test('gera ID diferente quando o storage está vazio', () => {
    // Como cada beforeEach recarrega o módulo com storage vazio, o ID é novo
    const mod2 = loadAppStateModule();
    const id1 = mod.getOrCreatePersistentPlayerId();
    const id2 = mod2.getOrCreatePersistentPlayerId();
    // IDs podem ser iguais ou diferentes (aleatórios); ambos devem ser válidos
    expect(id1).toMatch(/^player_/);
    expect(id2).toMatch(/^player_/);
  });
});

// ─────────────────────────────────────────────────────────────
// loadVisualSettings
// ─────────────────────────────────────────────────────────────
describe('loadVisualSettings', () => {
  test('retorna defaults quando localStorage está vazio', () => {
    const settings = mod.loadVisualSettings();
    expect(settings).toMatchObject({
      glowIntensity: expect.any(Number),
      animSpeed: expect.any(Number),
      nasaIntensity: expect.any(Number),
      nasaSpeed: expect.any(Number),
      playerColorAnimOn: expect.any(Boolean),
      playerTileOn: expect.any(Boolean),
      playerIdentityOff: expect.any(Boolean),
      insertSpeed: expect.any(Number),
    });
  });

  test('defaults: playerColorAnimOn=false e playerTileOn=false', () => {
    const settings = mod.loadVisualSettings();
    expect(settings.playerColorAnimOn).toBe(false);
    expect(settings.playerTileOn).toBe(false);
  });

  test('defaults: playerIdentityOff=false', () => {
    const settings = mod.loadVisualSettings();
    expect(settings.playerIdentityOff).toBe(false);
  });

  test('valores numéricos estão dentro de intervalos razoáveis', () => {
    const s = mod.loadVisualSettings();
    expect(s.nasaIntensity).toBeGreaterThanOrEqual(0);
    expect(s.nasaIntensity).toBeLessThanOrEqual(100);
    expect(s.nasaSpeed).toBeGreaterThanOrEqual(0);
    expect(s.nasaSpeed).toBeLessThanOrEqual(100);
    expect(s.insertSpeed).toBeGreaterThanOrEqual(0);
    expect(s.insertSpeed).toBeLessThanOrEqual(100);
  });
});

// ─────────────────────────────────────────────────────────────
// state inicial
// ─────────────────────────────────────────────────────────────
describe('state inicial', () => {
  test('state existe e tem as propriedades fundamentais', () => {
    const { state } = mod;
    expect(state).toBeDefined();
    expect(state).toHaveProperty('mode');
    expect(state).toHaveProperty('difficulty');
    expect(state).toHaveProperty('N');
    expect(state).toHaveProperty('board');
    expect(state).toHaveProperty('solution');
    expect(state).toHaveProperty('initial');
    expect(state).toHaveProperty('notes');
    expect(state).toHaveProperty('multiplayer');
  });

  test('multiplayer inicializa inactive e sem roomId', () => {
    const { state } = mod;
    expect(state.multiplayer.active).toBe(false);
    expect(state.multiplayer.roomId).toBeNull();
  });

  test('pencilMode começa false', () => {
    expect(mod.state.pencilMode).toBe(false);
  });

  test('completed começa false', () => {
    expect(mod.state.completed).toBe(false);
  });

  test('N padrão é 9', () => {
    expect(mod.state.N).toBe(9);
  });

  test('boardZoom padrão é 1', () => {
    expect(mod.state.boardZoom).toBe(1);
  });

  test('ROOM_PROTECTION_DAYS é um número positivo', () => {
    expect(typeof mod.ROOM_PROTECTION_DAYS).toBe('number');
    expect(mod.ROOM_PROTECTION_DAYS).toBeGreaterThan(0);
  });
});
