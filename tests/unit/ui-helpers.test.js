/**
 * ui-helpers.test.js
 *
 * Testes unitários para js/ui-helpers.js
 * Cobre: formatTime, showToast
 */

'use strict';

const { loadUiHelpersModule } = require('../helpers/engine-loader');

let helpers;

beforeAll(() => {
  helpers = loadUiHelpersModule();
});

// ─────────────────────────────────────────────────────────────
// formatTime
// ─────────────────────────────────────────────────────────────
describe('formatTime', () => {
  test('formata 0 segundos como "00:00"', () => {
    expect(helpers.formatTime(0)).toBe('00:00');
  });

  test('formata 59 segundos como "00:59"', () => {
    expect(helpers.formatTime(59)).toBe('00:59');
  });

  test('formata 60 segundos como "01:00"', () => {
    expect(helpers.formatTime(60)).toBe('01:00');
  });

  test('formata 61 segundos como "01:01"', () => {
    expect(helpers.formatTime(61)).toBe('01:01');
  });

  test('formata 3599 segundos como "59:59"', () => {
    expect(helpers.formatTime(3599)).toBe('59:59');
  });

  test('formata 3600 segundos (1 hora) como "01:00:00"', () => {
    expect(helpers.formatTime(3600)).toBe('01:00:00');
  });

  test('formata 3661 segundos como "01:01:01"', () => {
    expect(helpers.formatTime(3661)).toBe('01:01:01');
  });

  test('formata 7322 segundos como "02:02:02"', () => {
    expect(helpers.formatTime(7322)).toBe('02:02:02');
  });

  test('formata 86399 segundos (23:59:59)', () => {
    expect(helpers.formatTime(86399)).toBe('23:59:59');
  });

  test('padding com zeros: 5 segundos → "00:05"', () => {
    expect(helpers.formatTime(5)).toBe('00:05');
  });

  test('padding com zeros: 65 segundos → "01:05"', () => {
    expect(helpers.formatTime(65)).toBe('01:05');
  });
});

// ─────────────────────────────────────────────────────────────
// showToast
// ─────────────────────────────────────────────────────────────
describe('showToast', () => {
  test('é uma função', () => {
    expect(typeof helpers.showToast).toBe('function');
  });

  test('não lança exceção ao ser chamada com texto e tipo', () => {
    expect(() => helpers.showToast('Mensagem de teste', 'info')).not.toThrow();
    expect(() => helpers.showToast('Aviso', 'warn')).not.toThrow();
    expect(() => helpers.showToast('Sucesso', 'success')).not.toThrow();
  });

  test('não lança exceção sem tipo (usa padrão "info")', () => {
    expect(() => helpers.showToast('Só texto')).not.toThrow();
  });
});
