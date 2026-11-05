/**
 * gas-fallback.test.js
 *
 * Testes da arquitetura Fallout/Fallback do backend GAS (Firebase-first → GitHub):
 *   - loadAndValidateConfig: hit Firebase / fallback GitHub + auto-seed + flag _usedFallback / falha segura / cache.
 *   - loadAndParseButIgnore:  mesmo padrão; flag _usedFallback anexada ao array de RegExp[];
 *                            round-trip via JSON (o .butIgnore é texto INI, armazenado como string JSON no Firebase).
 *
 * Não exige Firebase/GitHub reais — usa stubs de UrlFetchApp controlados por URL
 * (já providenciados pelo gas-loader via options.urlFetch).
 */

'use strict';

const { loadGASMaster, loadGASColdStorage } = require('../helpers/gas-loader');

// ── Configuração válida mínima (satisfaz validateOrchestratorConfig) ──────────
function makeValidConfig() {
  return {
    system: {
      version: '1.1.0',
      timezone: 'America/Sao_Paulo',
      scheduling: { heartbeat_interval: 'PT1H', default_repeat_policy: 'ALL_SUCCEEDED' }
    },
    telemetry: { spreadsheet_name: 'Sudoku PRO', sheet_name: 'JobsTelemetry' },
    jobs_schedule: {
      coldstorage_rooms: { enabled: true, schedule: { interval: 'P1D', repeat_policy: 'ALL_SUCCEEDED' } }
    },
    visual_theme: {
      job_styles: {
        coldstorage_rooms: { label: 'C', row_background: '#fff', row_font_color: '#000', job_id_cell: { bg: '#f', fg: '#0' } }
      },
      status_cells: {
        SUCCESS: { bg: '#0', fg: '#1' }, SKIPPED: { bg: '#2', fg: '#3' }, FAILED: { bg: '#4', fg: '#5' }
      },
      error_column: { default_clean: { bg: '#0', fg: '#1' }, has_exception: { bg: '#2', fg: '#3' } }
    }
  };
}

const PROPS_CONFIG = {
  FIREBASE_URL: 'https://fb-test.firebaseio.com',
  FIREBASE_SECRET: 'SECRET',
  GITHUB_JOBS_CONFIG_URL: 'https://raw.githubusercontent.com/u/r/main/backend/config/jobs-orchestrator.json'
};

const PROPS_BUTIGNORE = {
  FIREBASE_URL: 'https://fb-test.firebaseio.com',
  FIREBASE_SECRET: 'SECRET',
  GITHUB_BUTIGNORE_URL: 'https://raw.githubusercontent.com/u/r/main/.butIgnore'
};

// .butIgnore de exemplo: 1 regra global + 1 seccional
const BUTIGNORE_TEXT = ['rooms/*/moves', '[coldstorage_rooms]', 'rooms/*/cursors'].join('\n');

// ── Helper: UrlFetchApp stub que registra chamadas e PUTs (com payload) ─────────
function makeFetch(router) {
  const calls = [];
  const puts = []; // { url, payload }
  const fetch = (url, opts) => {
    calls.push(url);
    if (opts && opts.method === 'PUT') puts.push({ url, payload: opts.payload });
    return router(url, opts);
  };
  fetch.calls = calls;
  fetch.puts = puts;
  return fetch;
}

function resp(code, text) {
  return { getResponseCode: () => code, getContentText: () => text, getContent: () => [] };
}

// ═════════════════════════════════════════════════════════════════════════════
// loadAndValidateConfig — Fallout/Fallback
// ═════════════════════════════════════════════════════════════════════════════
describe('loadAndValidateConfig — Fallout/Fallback (Firebase-first → GitHub)', () => {
  test('Firebase com config válida → retorna config, sem fallback, sem seed', () => {
    const cfg = makeValidConfig();
    const fetch = makeFetch((url) => {
      if (url.includes('/server_config/jobs_orchestrator.json')) return resp(200, JSON.stringify(cfg));
      if (url.includes('raw.githubusercontent')) return resp(200, JSON.stringify(cfg));
      return resp(404, '');
    });
    const master = loadGASMaster({ props: PROPS_CONFIG, urlFetch: fetch });
    const config = master.loadAndValidateConfig();

    expect(config.system.version).toBe('1.1.0');
    expect(config._usedFallback).toBeFalsy();
    expect(fetch.calls.some(u => u.includes('/server_config/jobs_orchestrator.json'))).toBe(true);
    expect(fetch.calls.some(u => u.includes('raw.githubusercontent'))).toBe(false);
    expect(fetch.puts.length).toBe(0); // sem seed (Firebase foi a fonte da verdade)
  });

  test('Firebase vazio ("null") → cai no GitHub, marca _usedFallback e semeia o Firebase (PUT)', () => {
    const cfg = makeValidConfig();
    const fetch = makeFetch((url) => {
      if (url.includes('/server_config/jobs_orchestrator.json')) return resp(200, 'null'); // nó inexistente
      if (url.includes('raw.githubusercontent')) return resp(200, JSON.stringify(cfg));
      return resp(404, '');
    });
    const master = loadGASMaster({ props: PROPS_CONFIG, urlFetch: fetch });
    const config = master.loadAndValidateConfig();

    expect(config.system.version).toBe('1.1.0');
    expect(config._usedFallback).toBe(true);
    expect(fetch.calls.some(u => u.includes('raw.githubusercontent'))).toBe(true);
    // auto-seed: PUT no nó do Firebase com o payload = JSON da config (válida)
    expect(fetch.puts.some(p => p.url.includes('/server_config/jobs_orchestrator.json'))).toBe(true);
    expect(fetch.puts[0].payload).toBe(JSON.stringify(cfg));
  });

  test('Firebase e GitHub ambos falham (503) → lança erro de falha segura', () => {
    const fetch = makeFetch(() => resp(503, ''));
    const master = loadGASMaster({ props: PROPS_CONFIG, urlFetch: fetch });
    expect(() => master.loadAndValidateConfig()).toThrow(/Impossível obter jobs-orchestrator\.json/);
  });

  test('sem FIREBASE_URL/SECRET e sem GITHUB_JOBS_CONFIG_URL → lança (nenhuma fonte)', () => {
    const fetch = makeFetch(() => resp(200, 'null'));
    const master = loadGASMaster({ props: {}, urlFetch: fetch });
    expect(() => master.loadAndValidateConfig()).toThrow(/Impossível obter/);
  });

  test('cache: segunda chamada não refaz fetch (Firebase hit na primeira)', () => {
    const cfg = makeValidConfig();
    const fetch = makeFetch((url) => {
      if (url.includes('/server_config/jobs_orchestrator.json')) return resp(200, JSON.stringify(cfg));
      return resp(404, '');
    });
    const master = loadGASMaster({ props: PROPS_CONFIG, urlFetch: fetch });

    const c1 = master.loadAndValidateConfig();
    const c2 = master.loadAndValidateConfig();

    expect(c1.system.version).toBe('1.1.0');
    expect(c2.system.version).toBe('1.1.0');
    // Só 1 fetch (Firebase) na primeira chamada; a segunda veio do CacheService.
    expect(fetch.calls.length).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// loadAndParseButIgnore — Fallout/Fallback (flag _usedFallback no array)
// ═════════════════════════════════════════════════════════════════════════════
describe('loadAndParseButIgnore — Fallout/Fallback (Firebase-first → GitHub)', () => {
  test('Firebase com butIgnore válido → retorna RegExp[] funcionais, sem fallback', () => {
    // No Firebase o .butIgnore é armazenado como string JSON (round-trip via JSON).
    const fetch = makeFetch((url) => {
      if (url.includes('/server_config/but_ignore.json')) return resp(200, JSON.stringify(BUTIGNORE_TEXT));
      if (url.includes('raw.githubusercontent')) return resp(200, BUTIGNORE_TEXT);
      return resp(404, '');
    });
    const cs = loadGASColdStorage({ props: PROPS_BUTIGNORE, urlFetch: fetch });
    const rules = cs.loadAndParseButIgnore('coldstorage_rooms');

    expect(Array.isArray(rules)).toBe(true);
    expect(rules.length).toBe(2); // 1 global + 1 seccional
    expect(rules._usedFallback).toBeFalsy();
    expect(rules[0].test('rooms/SALA1/moves')).toBe(true);
    expect(rules[1].test('rooms/SALA1/cursors')).toBe(true);
    expect(fetch.calls.some(u => u.includes('raw.githubusercontent'))).toBe(false);
    expect(fetch.puts.length).toBe(0);
  });

  test('Firebase vazio → cai no GitHub, marca _usedFallback no array e semeia o Firebase (PUT como string JSON)', () => {
    const fetch = makeFetch((url) => {
      if (url.includes('/server_config/but_ignore.json')) return resp(200, 'null');
      if (url.includes('raw.githubusercontent')) return resp(200, BUTIGNORE_TEXT);
      return resp(404, '');
    });
    const cs = loadGASColdStorage({ props: PROPS_BUTIGNORE, urlFetch: fetch });
    const rules = cs.loadAndParseButIgnore('coldstorage_rooms');

    expect(rules.length).toBe(2);
    expect(rules._usedFallback).toBe(true);
    expect(rules[0].test('rooms/SALA1/moves')).toBe(true);
    expect(fetch.calls.some(u => u.includes('raw.githubusercontent'))).toBe(true);
    // auto-seed: PUT no Firebase com o .butIgnore ENVOLVIDO como string JSON
    expect(fetch.puts.some(p => p.url.includes('/server_config/but_ignore.json'))).toBe(true);
    expect(fetch.puts[0].payload).toBe(JSON.stringify(BUTIGNORE_TEXT));
  });

  test('Firebase e GitHub ambos falham → lança (falha segura: nunca roda sem filtros)', () => {
    const fetch = makeFetch(() => resp(503, ''));
    const cs = loadGASColdStorage({ props: PROPS_BUTIGNORE, urlFetch: fetch });
    expect(() => cs.loadAndParseButIgnore('coldstorage_rooms')).toThrow(/Não foi possível obter \.butIgnore/);
  });

  test('round-trip Firebase: lê de volta exatamente o que foi semeado (string JSON → texto INI)', () => {
    // Primeira chamada: Firebase vazio → GitHub → seed (PUT JSON.stringify).
    // Para validar o round-trip, simulamos o Firebase já com o conteúdo semeado.
    const fetch = makeFetch((url) => {
      if (url.includes('/server_config/but_ignore.json')) return resp(200, JSON.stringify(BUTIGNORE_TEXT));
      return resp(404, '');
    });
    const cs = loadGASColdStorage({ props: PROPS_BUTIGNORE, urlFetch: fetch });
    const rules = cs.loadAndParseButIgnore('coldstorage_rooms');
    // Se o round-trip estiver correto, as regras voltam íntegras (não viram JSON com aspas).
    expect(rules.length).toBe(2);
    expect(rules[0].test('rooms/XYZ/moves')).toBe(true);
    expect(rules._usedFallback).toBeFalsy();
  });
});
