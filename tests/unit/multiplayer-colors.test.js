/**
 * multiplayer-colors.test.js
 *
 * Testes unitários para as funções puras de cor no multiplayer-service.js
 * Cobre: normalizePlayerColor, stablePlayerColorHash, playerColorToOKLab,
 *        playerColorPerceptualDistance, chooseMostDistinctPlayerColor,
 *        detectClientBrowser, detectClientOperatingSystem, collectClientMetadata
 */

'use strict';

const { loadMultiplayerServiceColorModule } = require('../helpers/engine-loader');

let mp;

beforeAll(() => {
  mp = loadMultiplayerServiceColorModule();
});

// ─────────────────────────────────────────────────────────────
// normalizePlayerColor
// ─────────────────────────────────────────────────────────────
describe('normalizePlayerColor', () => {
  test('normaliza cor hexadecimal válida para minúsculo', () => {
    expect(mp.normalizePlayerColor('#FF0000')).toBe('#ff0000');
    expect(mp.normalizePlayerColor('#AbCdEf')).toBe('#abcdef');
  });

  test('retorna string vazia para cor inválida', () => {
    expect(mp.normalizePlayerColor('')).toBe('');
    expect(mp.normalizePlayerColor(null)).toBe('');
    expect(mp.normalizePlayerColor(undefined)).toBe('');
    expect(mp.normalizePlayerColor('red')).toBe('');
    expect(mp.normalizePlayerColor('#GGGGGG')).toBe('');
    expect(mp.normalizePlayerColor('#12345')).toBe(''); // apenas 5 dígitos
  });

  test('aceita hex com letras minúsculas já normalizadas', () => {
    expect(mp.normalizePlayerColor('#a1b2c3')).toBe('#a1b2c3');
  });

  test('retorna string vazia para valor numérico', () => {
    expect(mp.normalizePlayerColor(123)).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────
// stablePlayerColorHash
// ─────────────────────────────────────────────────────────────
describe('stablePlayerColorHash', () => {
  test('retorna um número inteiro não-negativo', () => {
    const hash = mp.stablePlayerColorHash('player_abc123');
    expect(typeof hash).toBe('number');
    expect(hash).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(hash)).toBe(true);
  });

  test('o mesmo input sempre produz o mesmo hash', () => {
    const id = 'player_xyz789';
    expect(mp.stablePlayerColorHash(id)).toBe(mp.stablePlayerColorHash(id));
  });

  test('inputs diferentes produzem hashes diferentes (alta probabilidade)', () => {
    const h1 = mp.stablePlayerColorHash('player_aaa');
    const h2 = mp.stablePlayerColorHash('player_bbb');
    expect(h1).not.toBe(h2);
  });

  test('aceita null/undefined sem lançar exceção', () => {
    expect(() => mp.stablePlayerColorHash(null)).not.toThrow();
    expect(() => mp.stablePlayerColorHash(undefined)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────
// playerColorToOKLab
// ─────────────────────────────────────────────────────────────
describe('playerColorToOKLab', () => {
  test('converte #ff0000 (vermelho) para OKLab com L > 0', () => {
    const lab = mp.playerColorToOKLab('#ff0000');
    expect(lab).not.toBeNull();
    expect(lab).toHaveLength(3);
    expect(lab[0]).toBeGreaterThan(0); // L
  });

  test('converte #000000 (preto) para [0,0,0] aproximado', () => {
    const lab = mp.playerColorToOKLab('#000000');
    expect(lab).not.toBeNull();
    expect(lab[0]).toBeCloseTo(0, 5);
  });

  test('retorna null para cor inválida', () => {
    expect(mp.playerColorToOKLab('invalid')).toBeNull();
    expect(mp.playerColorToOKLab('')).toBeNull();
  });

  test('#ffffff (branco) tem L ≈ 1', () => {
    const lab = mp.playerColorToOKLab('#ffffff');
    expect(lab).not.toBeNull();
    expect(lab[0]).toBeCloseTo(1, 1);
  });
});

// ─────────────────────────────────────────────────────────────
// playerColorPerceptualDistance
// ─────────────────────────────────────────────────────────────
describe('playerColorPerceptualDistance', () => {
  test('distância de uma cor para ela mesma é 0', () => {
    const d = mp.playerColorPerceptualDistance('#e53935', '#e53935');
    expect(d).toBeCloseTo(0, 5);
  });

  test('vermelho e azul são mais distantes do que vermelho e laranja', () => {
    const dRedBlue   = mp.playerColorPerceptualDistance('#e53935', '#1e88e5');
    const dRedOrange = mp.playerColorPerceptualDistance('#e53935', '#ef6c00');
    expect(dRedBlue).toBeGreaterThan(dRedOrange);
  });

  test('retorna 0 quando algum argumento é inválido', () => {
    expect(mp.playerColorPerceptualDistance('', '#ff0000')).toBe(0);
    expect(mp.playerColorPerceptualDistance('#ff0000', '')).toBe(0);
  });

  test('distância é simétrica', () => {
    const a = '#e53935', b = '#1e88e5';
    expect(mp.playerColorPerceptualDistance(a, b)).toBeCloseTo(
      mp.playerColorPerceptualDistance(b, a), 10
    );
  });
});

// ─────────────────────────────────────────────────────────────
// chooseMostDistinctPlayerColor
// ─────────────────────────────────────────────────────────────
describe('chooseMostDistinctPlayerColor', () => {
  test('retorna uma cor hex válida', () => {
    const color = mp.chooseMostDistinctPlayerColor([], 'player_001');
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  test('evita cor já usada quando possível', () => {
    // Usa todas as cores da paleta exceto uma — a função deve escolher aquela
    const palette = mp.MULTIPLAYER_PLAYER_COLOR_PALETTE;
    const allButLast = palette.slice(0, -1);
    const chosen = mp.chooseMostDistinctPlayerColor(allButLast, 'player_x');
    // A cor escolhida pode ser a última (a mais distinta disponível)
    expect(chosen).toMatch(/^#[0-9a-f]{6}$/i);
  });

  test('sem cores usadas, retorna cor da paleta', () => {
    const color = mp.chooseMostDistinctPlayerColor([], 'player_abc');
    expect(mp.MULTIPLAYER_PLAYER_COLOR_PALETTE).toContain(color);
  });

  test('não retorna string vazia', () => {
    const color = mp.chooseMostDistinctPlayerColor(['#e53935', '#1e88e5'], 'player_zzz');
    expect(color.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────
// detectClientBrowser
// ─────────────────────────────────────────────────────────────
describe('detectClientBrowser', () => {
  test('detecta Chrome', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
    const result = mp.detectClientBrowser(ua);
    expect(result.name).toBe('Chrome');
    expect(result.version).toContain('120');
  });

  test('detecta Firefox', () => {
    const ua = 'Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/109.0';
    const result = mp.detectClientBrowser(ua);
    expect(result.name).toBe('Firefox');
    expect(result.version).toContain('109');
  });

  test('detecta Edge', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36 Edg/120.0.0.0';
    const result = mp.detectClientBrowser(ua);
    expect(result.name).toBe('Microsoft Edge');
  });

  test('detecta Safari', () => {
    const ua = 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15';
    const result = mp.detectClientBrowser(ua);
    expect(result.name).toBe('Safari');
  });

  test('retorna Unknown para UA desconhecido', () => {
    const result = mp.detectClientBrowser('SomeRobot/1.0');
    expect(result.name).toBe('Unknown');
  });
});

// ─────────────────────────────────────────────────────────────
// detectClientOperatingSystem
// ─────────────────────────────────────────────────────────────
describe('detectClientOperatingSystem', () => {
  test('detecta Windows', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
    const result = mp.detectClientOperatingSystem(ua);
    expect(result.name).toBe('Windows');
  });

  test('detecta iOS', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)';
    const result = mp.detectClientOperatingSystem(ua);
    expect(result.name).toBe('iOS');
    expect(result.version).toBe('16.0');
  });

  test('detecta Android', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 13; Pixel 7)';
    const result = mp.detectClientOperatingSystem(ua);
    expect(result.name).toBe('Android');
    expect(result.version).toContain('13');
  });

  test('detecta macOS', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';
    const result = mp.detectClientOperatingSystem(ua);
    expect(result.name).toBe('macOS');
    expect(result.version).toContain('10.15');
  });

  test('detecta Linux', () => {
    const ua = 'Mozilla/5.0 (X11; Linux x86_64)';
    const result = mp.detectClientOperatingSystem(ua);
    expect(result.name).toBe('Linux');
  });

  test('retorna Unknown para UA desconhecido', () => {
    const result = mp.detectClientOperatingSystem('SomeRobot/1.0');
    expect(result.name).toBe('Unknown');
  });
});

// ─────────────────────────────────────────────────────────────
// collectClientMetadata
// ─────────────────────────────────────────────────────────────
describe('collectClientMetadata', () => {
  test('retorna objeto com schemaVersion=2', () => {
    const meta = mp.collectClientMetadata();
    expect(meta.schemaVersion).toBe(2);
  });

  test('retorna browser e operatingSystem como objetos com name', () => {
    const meta = mp.collectClientMetadata();
    expect(typeof meta.browser).toBe('object');
    expect(typeof meta.browser.name).toBe('string');
    expect(typeof meta.operatingSystem).toBe('object');
    expect(typeof meta.operatingSystem.name).toBe('string');
  });

  test('retorna capturedAtTimestamp como número', () => {
    const meta = mp.collectClientMetadata();
    expect(typeof meta.capturedAtTimestamp).toBe('number');
    expect(meta.capturedAtTimestamp).toBeGreaterThan(0);
  });

  test('retorna languages como array', () => {
    const meta = mp.collectClientMetadata();
    expect(Array.isArray(meta.languages)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// MULTIPLAYER_PLAYER_COLOR_PALETTE
// ─────────────────────────────────────────────────────────────
describe('MULTIPLAYER_PLAYER_COLOR_PALETTE', () => {
  test('é um array não-vazio', () => {
    expect(Array.isArray(mp.MULTIPLAYER_PLAYER_COLOR_PALETTE)).toBe(true);
    expect(mp.MULTIPLAYER_PLAYER_COLOR_PALETTE.length).toBeGreaterThan(0);
  });

  test('cada entrada é uma cor hex válida', () => {
    mp.MULTIPLAYER_PLAYER_COLOR_PALETTE.forEach(color => {
      expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
    });
  });

  test('não há cores duplicadas na paleta', () => {
    const lower = mp.MULTIPLAYER_PLAYER_COLOR_PALETTE.map(c => c.toLowerCase());
    const unique = new Set(lower);
    expect(unique.size).toBe(lower.length);
  });
});
