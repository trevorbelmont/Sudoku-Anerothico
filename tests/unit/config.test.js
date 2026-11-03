/**
 * config.test.js
 *
 * Testes unitários para js/config.js
 * Cobre: APP_CONFIG — central de configuração (Single Source of Truth).
 *        Verifica que todas as propriedades esperadas existem, têm o tipo
 *        correto e que os valores críticos (chaves de storage, versão)
 *        não mudam acidentalmente.
 */

'use strict';

const { loadConfigModule } = require('../helpers/engine-loader');

let APP_CONFIG;

beforeEach(() => {
  APP_CONFIG = loadConfigModule();
});

// ─────────────────────────────────────────────────────────────
// Identidade da Aplicação
// ─────────────────────────────────────────────────────────────
describe('Identidade da Aplicação', () => {
  test('APP_NAME é uma string não-vazia', () => {
    expect(typeof APP_CONFIG.APP_NAME).toBe('string');
    expect(APP_CONFIG.APP_NAME.length).toBeGreaterThan(0);
  });

  test('APP_VERSION segue o formato vN.N', () => {
    expect(APP_CONFIG.APP_VERSION).toMatch(/^v\d+\.\d+$/);
  });

  test('APP_VERSION_NUMBER é a versão sem prefixo v', () => {
    expect(APP_CONFIG.APP_VERSION_NUMBER).toBe(
      APP_CONFIG.APP_VERSION.replace(/^v/, '')
    );
  });

  test('APP_TITLE contém nome, versão e emoji', () => {
    expect(APP_CONFIG.APP_TITLE).toContain(APP_CONFIG.APP_NAME);
    expect(APP_CONFIG.APP_TITLE).toContain(APP_CONFIG.APP_VERSION);
  });

  test('APP_EMOJI é uma string não-vazia', () => {
    expect(typeof APP_CONFIG.APP_EMOJI).toBe('string');
    expect(APP_CONFIG.APP_EMOJI.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────
// UI & Experiência do Usuário
// ─────────────────────────────────────────────────────────────
describe('UI & Experiência do Usuário', () => {
  test('DEFAULT_THEME é uma string não-vazia', () => {
    expect(typeof APP_CONFIG.DEFAULT_THEME).toBe('string');
    expect(APP_CONFIG.DEFAULT_THEME.length).toBeGreaterThan(0);
  });

  test('DEFAULT_DIFFICULTY é uma das dificuldades válidas', () => {
    expect(['facil', 'medio', 'dificil', 'uaiso', 'doido']).toContain(APP_CONFIG.DEFAULT_DIFFICULTY);
  });

  test('DEFAULT_MODE é standard ou custom', () => {
    expect(['standard', 'custom']).toContain(APP_CONFIG.DEFAULT_MODE);
  });
});

// ─────────────────────────────────────────────────────────────
// Motor do Sudoku
// ─────────────────────────────────────────────────────────────
describe('Motor do Sudoku', () => {
  test('DEFAULT_GRID_SIZE é um inteiro positivo', () => {
    expect(Number.isInteger(APP_CONFIG.DEFAULT_GRID_SIZE)).toBe(true);
    expect(APP_CONFIG.DEFAULT_GRID_SIZE).toBeGreaterThan(0);
  });

  test('DEFAULT_BLOCK_ROWS e DEFAULT_BLOCK_COLS são inteiros positivos', () => {
    expect(Number.isInteger(APP_CONFIG.DEFAULT_BLOCK_ROWS)).toBe(true);
    expect(Number.isInteger(APP_CONFIG.DEFAULT_BLOCK_COLS)).toBe(true);
    expect(APP_CONFIG.DEFAULT_BLOCK_ROWS).toBeGreaterThan(0);
    expect(APP_CONFIG.DEFAULT_BLOCK_COLS).toBeGreaterThan(0);
  });

  test('DEFAULT_BLOCK_ROWS * DEFAULT_BLOCK_COLS === DEFAULT_GRID_SIZE', () => {
    expect(APP_CONFIG.DEFAULT_BLOCK_ROWS * APP_CONFIG.DEFAULT_BLOCK_COLS).toBe(APP_CONFIG.DEFAULT_GRID_SIZE);
  });

  test('DEFAULT_MIN_VAL < DEFAULT_MAX_VAL', () => {
    expect(APP_CONFIG.DEFAULT_MIN_VAL).toBeLessThan(APP_CONFIG.DEFAULT_MAX_VAL);
  });

  test('DEFAULT_INCLUDE_ZERO é booleano', () => {
    expect(typeof APP_CONFIG.DEFAULT_INCLUDE_ZERO).toBe('boolean');
  });

  test('DEFAULT_SYMBOLS é um array com DEFAULT_GRID_SIZE elementos', () => {
    expect(Array.isArray(APP_CONFIG.DEFAULT_SYMBOLS)).toBe(true);
    expect(APP_CONFIG.DEFAULT_SYMBOLS.length).toBe(APP_CONFIG.DEFAULT_GRID_SIZE);
  });
});

// ─────────────────────────────────────────────────────────────
// Timer & Persistência
// ─────────────────────────────────────────────────────────────
describe('Timer & Persistência', () => {
  test('TIMER_INTERVAL_MS é um número positivo', () => {
    expect(typeof APP_CONFIG.TIMER_INTERVAL_MS).toBe('number');
    expect(APP_CONFIG.TIMER_INTERVAL_MS).toBeGreaterThan(0);
  });

  test('TIMER_AUTOSAVE_INTERVAL_S é um número positivo', () => {
    expect(typeof APP_CONFIG.TIMER_AUTOSAVE_INTERVAL_S).toBe('number');
    expect(APP_CONFIG.TIMER_AUTOSAVE_INTERVAL_S).toBeGreaterThan(0);
  });

  test('MAX_SAVED_GAMES é um inteiro positivo', () => {
    expect(Number.isInteger(APP_CONFIG.MAX_SAVED_GAMES)).toBe(true);
    expect(APP_CONFIG.MAX_SAVED_GAMES).toBeGreaterThan(0);
  });

  test('TIMER_DISPLAY_INITIAL é uma string não-vazia', () => {
    expect(typeof APP_CONFIG.TIMER_DISPLAY_INITIAL).toBe('string');
    expect(APP_CONFIG.TIMER_DISPLAY_INITIAL.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────
// UI: Limites de Texto e Zoom
// ─────────────────────────────────────────────────────────────
describe('UI: Limites de Texto e Zoom', () => {
  test('GAME_NAME_MAX_LENGTH é um inteiro positivo', () => {
    expect(Number.isInteger(APP_CONFIG.GAME_NAME_MAX_LENGTH)).toBe(true);
    expect(APP_CONFIG.GAME_NAME_MAX_LENGTH).toBeGreaterThan(0);
  });

  test('GAME_NAME_TEXTAREA_MAX_HEIGHT é um número positivo', () => {
    expect(typeof APP_CONFIG.GAME_NAME_TEXTAREA_MAX_HEIGHT).toBe('number');
    expect(APP_CONFIG.GAME_NAME_TEXTAREA_MAX_HEIGHT).toBeGreaterThan(0);
  });

  test('BOARD_ZOOM_MIN < BOARD_ZOOM_DEFAULT < BOARD_ZOOM_MAX', () => {
    expect(APP_CONFIG.BOARD_ZOOM_MIN).toBeLessThan(APP_CONFIG.BOARD_ZOOM_DEFAULT);
    expect(APP_CONFIG.BOARD_ZOOM_DEFAULT).toBeLessThan(APP_CONFIG.BOARD_ZOOM_MAX);
  });

  test('BOARD_ZOOM_STEP é um número positivo', () => {
    expect(typeof APP_CONFIG.BOARD_ZOOM_STEP).toBe('number');
    expect(APP_CONFIG.BOARD_ZOOM_STEP).toBeGreaterThan(0);
  });

  test('CUSTOM_RANGE_MIN < CUSTOM_RANGE_MAX', () => {
    expect(APP_CONFIG.CUSTOM_RANGE_MIN).toBeLessThan(APP_CONFIG.CUSTOM_RANGE_MAX);
  });
});

// ─────────────────────────────────────────────────────────────
// NASA & Efeitos Visuais
// ─────────────────────────────────────────────────────────────
describe('NASA & Efeitos Visuais', () => {
  test('DEFAULT_NASA_INTENSITY está entre 0 e 100', () => {
    expect(APP_CONFIG.DEFAULT_NASA_INTENSITY).toBeGreaterThanOrEqual(0);
    expect(APP_CONFIG.DEFAULT_NASA_INTENSITY).toBeLessThanOrEqual(100);
  });

  test('DEFAULT_NASA_SPEED está entre 0 e 100', () => {
    expect(APP_CONFIG.DEFAULT_NASA_SPEED).toBeGreaterThanOrEqual(0);
    expect(APP_CONFIG.DEFAULT_NASA_SPEED).toBeLessThanOrEqual(100);
  });
});

// ─────────────────────────────────────────────────────────────
// Confetti
// ─────────────────────────────────────────────────────────────
describe('Confetti', () => {
  test('CONFETTI tem VICTORY, VICTORY_MP e GIFT', () => {
    expect(APP_CONFIG.CONFETTI).toHaveProperty('VICTORY');
    expect(APP_CONFIG.CONFETTI).toHaveProperty('VICTORY_MP');
    expect(APP_CONFIG.CONFETTI).toHaveProperty('GIFT');
  });

  test('cada config de confetti tem particleCount, spread e colors', () => {
    Object.values(APP_CONFIG.CONFETTI).forEach(cfg => {
      expect(cfg).toHaveProperty('particleCount');
      expect(cfg).toHaveProperty('spread');
      expect(cfg).toHaveProperty('colors');
      expect(Array.isArray(cfg.colors)).toBe(true);
      expect(cfg.colors.length).toBeGreaterThan(0);
    });
  });
});

// ─────────────────────────────────────────────────────────────
// Modo Desenvolvedor
// ─────────────────────────────────────────────────────────────
describe('Modo Desenvolvedor', () => {
  test('DEV_MODE_CLICKS_REQUIRED é um inteiro positivo', () => {
    expect(Number.isInteger(APP_CONFIG.DEV_MODE_CLICKS_REQUIRED)).toBe(true);
    expect(APP_CONFIG.DEV_MODE_CLICKS_REQUIRED).toBeGreaterThan(0);
  });

  test('DEV_MODE_TIME_WINDOW_MS é um número positivo', () => {
    expect(typeof APP_CONFIG.DEV_MODE_TIME_WINDOW_MS).toBe('number');
    expect(APP_CONFIG.DEV_MODE_TIME_WINDOW_MS).toBeGreaterThan(0);
  });

  test('DEV_MODE_KEY é uma string não-vazia', () => {
    expect(typeof APP_CONFIG.DEV_MODE_KEY).toBe('string');
    expect(APP_CONFIG.DEV_MODE_KEY.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────
// Multiplayer & Network
// ─────────────────────────────────────────────────────────────
describe('Multiplayer & Network', () => {
  test('MULTIPLAYER_VOTE_TIMEOUT_MS é um número positivo', () => {
    expect(typeof APP_CONFIG.MULTIPLAYER_VOTE_TIMEOUT_MS).toBe('number');
    expect(APP_CONFIG.MULTIPLAYER_VOTE_TIMEOUT_MS).toBeGreaterThan(0);
  });

  test('DEFAULT_ROOM_MODE é coop ou versus', () => {
    expect(['coop', 'versus']).toContain(APP_CONFIG.DEFAULT_ROOM_MODE);
  });

  test('DEFAULT_PLAYER_NAME é uma string não-vazia', () => {
    expect(typeof APP_CONFIG.DEFAULT_PLAYER_NAME).toBe('string');
    expect(APP_CONFIG.DEFAULT_PLAYER_NAME.length).toBeGreaterThan(0);
  });

  test('ROOM_PROTECTION_DAYS é um número positivo', () => {
    expect(typeof APP_CONFIG.ROOM_PROTECTION_DAYS).toBe('number');
    expect(APP_CONFIG.ROOM_PROTECTION_DAYS).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────
// Servidor Local
// ─────────────────────────────────────────────────────────────
describe('Servidor Local', () => {
  test('SERVER_PORT é um inteiro positivo', () => {
    expect(Number.isInteger(APP_CONFIG.SERVER_PORT)).toBe(true);
    expect(APP_CONFIG.SERVER_PORT).toBeGreaterThan(0);
  });

  test('SERVER_PORT_MAX > SERVER_PORT', () => {
    expect(APP_CONFIG.SERVER_PORT_MAX).toBeGreaterThan(APP_CONFIG.SERVER_PORT);
  });
});

// ─────────────────────────────────────────────────────────────
// Storage Keys — regressão crítica: não podem mudar
// ─────────────────────────────────────────────────────────────
describe('STORAGE keys', () => {
  test('todas as chaves esperadas existem', () => {
    const keys = APP_CONFIG.STORAGE;
    expect(keys).toHaveProperty('THEME');
    expect(keys).toHaveProperty('SAVED_GAMES');
    expect(keys).toHaveProperty('CURRENT_GAME_ID');
    expect(keys).toHaveProperty('PLAYER_ID');
    expect(keys).toHaveProperty('VISUAL_SETTINGS');
    expect(keys).toHaveProperty('HEADER_COLLAPSED');
    expect(keys).toHaveProperty('MP_PLAYER_NAME');
    expect(keys).toHaveProperty('LEFT_PANEL_WIDTH');
    expect(keys).toHaveProperty('LEFT_PANEL_COLLAPSED');
  });

  test('chaves são strings não-vazias', () => {
    Object.values(APP_CONFIG.STORAGE).forEach(v => {
      expect(typeof v).toBe('string');
      expect(v.length).toBeGreaterThan(0);
    });
  });

  test('valores das chaves coincidem com os que já existem no localStorage dos usuários', () => {
    // Estas asserções protegem contra mudanças acidentais que fariam
    // com que jogos salvos e preferências fossem perdidos.
    expect(APP_CONFIG.STORAGE.THEME).toBe('sudoku_anerothico_theme_v1');
    expect(APP_CONFIG.STORAGE.SAVED_GAMES).toBe('sudoku_anerothico_games_v1');
    expect(APP_CONFIG.STORAGE.CURRENT_GAME_ID).toBe('sudoku_anerothico_current_id_v1');
    expect(APP_CONFIG.STORAGE.PLAYER_ID).toBe('sudoku_anerothico_player_id_v1');
    expect(APP_CONFIG.STORAGE.VISUAL_SETTINGS).toBe('sudoku_anerothico_visual_settings_v1');
    expect(APP_CONFIG.STORAGE.HEADER_COLLAPSED).toBe('sudoku_anerothico_header_collapsed_v1');
    expect(APP_CONFIG.STORAGE.MP_PLAYER_NAME).toBe('sudoku_anerothico_mp_name');
    expect(APP_CONFIG.STORAGE.LEFT_PANEL_WIDTH).toBe('sudoku_anerothico_left_panel_width_v1');
    expect(APP_CONFIG.STORAGE.LEFT_PANEL_COLLAPSED).toBe('sudoku_anerothico_left_panel_collapsed_v1');
  });
});

// ─────────────────────────────────────────────────────────────
// Consistência: STORAGE_KEYS em app-state.js referencia APP_CONFIG.STORAGE
// ─────────────────────────────────────────────────────────────
describe('Consistência com app-state.js', () => {
  test('STORAGE do APP_CONFIG coincide com STORAGE_KEYS do app-state', () => {
    const appState = require('../helpers/engine-loader').loadAppStateModule();
    expect(appState.STORAGE_KEYS).toEqual(APP_CONFIG.STORAGE);
  });

  test('ROOM_PROTECTION_DAYS do APP_CONFIG coincide com o do app-state', () => {
    const appState = require('../helpers/engine-loader').loadAppStateModule();
    expect(appState.ROOM_PROTECTION_DAYS).toBe(APP_CONFIG.ROOM_PROTECTION_DAYS);
  });
});
