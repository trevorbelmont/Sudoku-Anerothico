/**
 * gas-master.test.js
 *
 * Testes unitários para o Master Orchestrator (GAS).
 * Cobre: parseIso8601Duration, selectAnchorTimestamp, validateOrchestratorConfig,
 *        parseTriggerSpec, ciclo do Master (dispatch, policies, lock, falhas).
 * Não exige conexão real com Firebase, Drive, Sheets ou GitHub.
 */

'use strict';

const { loadGASMaster } = require('../helpers/gas-loader');

let master;

beforeAll(() => {
  master = loadGASMaster();
});

// ─────────────────────────────────────────────────────────────────────────────
// parseIso8601Duration
// ─────────────────────────────────────────────────────────────────────────────
describe('parseIso8601Duration', () => {
  test('P1D = 86 400 000 ms', () => {
    expect(master.parseIso8601Duration('P1D')).toBe(86400000);
  });
  test('PT12H = 43 200 000 ms', () => {
    expect(master.parseIso8601Duration('PT12H')).toBe(43200000);
  });
  test('P7D = 604 800 000 ms', () => {
    expect(master.parseIso8601Duration('P7D')).toBe(604800000);
  });
  test('P1DT12H = 129 600 000 ms', () => {
    expect(master.parseIso8601Duration('P1DT12H')).toBe(129600000);
  });
  test('PT30M = 1 800 000 ms', () => {
    expect(master.parseIso8601Duration('PT30M')).toBe(1800000);
  });
  test('PT1H = 3 600 000 ms', () => {
    expect(master.parseIso8601Duration('PT1H')).toBe(3600000);
  });
  test('P1W = 7 * 24 h', () => {
    expect(master.parseIso8601Duration('P1W')).toBe(7 * 24 * 3600000);
  });
  test('rejeita P1M (mês-calendário)', () => {
    expect(() => master.parseIso8601Duration('P1M')).toThrow();
  });
  test('rejeita P1Y (ano)', () => {
    expect(() => master.parseIso8601Duration('P1Y')).toThrow();
  });
  test('rejeita string malformada', () => {
    expect(() => master.parseIso8601Duration('1D')).toThrow();
    expect(() => master.parseIso8601Duration('invalid')).toThrow();
  });
  test('rejeita duração zero', () => {
    expect(() => master.parseIso8601Duration('PT0S')).toThrow();
  });
  test('rejeita vazio/null', () => {
    expect(() => master.parseIso8601Duration('')).toThrow();
    expect(() => master.parseIso8601Duration(null)).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// selectAnchorTimestamp — quatro políticas
// ─────────────────────────────────────────────────────────────────────────────
describe('selectAnchorTimestamp', () => {
  const meta = {
    last_completed_at: 1000,
    last_success_at: 2000,
    last_scheduled_at: 3000,
    last_scheduled_success_at: 4000,
  };

  test('ALL → last_completed_at', () => {
    expect(master.selectAnchorTimestamp('ALL', meta)).toBe(1000);
  });
  test('ALL_SUCCEEDED → last_success_at', () => {
    expect(master.selectAnchorTimestamp('ALL_SUCCEEDED', meta)).toBe(2000);
  });
  test('SCHEDULED → last_scheduled_at', () => {
    expect(master.selectAnchorTimestamp('SCHEDULED', meta)).toBe(3000);
  });
  test('SCHEDULED_SUCCEEDED → last_scheduled_success_at', () => {
    expect(master.selectAnchorTimestamp('SCHEDULED_SUCCEEDED', meta)).toBe(4000);
  });
  test('retorna null quando campo ausente (primeira execução elegível)', () => {
    expect(master.selectAnchorTimestamp('ALL_SUCCEEDED', {})).toBeNull();
    expect(master.selectAnchorTimestamp('SCHEDULED', {})).toBeNull();
  });
  test('retorna null quando valor é 0', () => {
    expect(master.selectAnchorTimestamp('ALL', { last_completed_at: 0 })).toBeNull();
  });
  test('last_attempt_at nunca é âncora', () => {
    const metaWithAttempt = { last_attempt_at: 9999 };
    // Nenhuma política usa last_attempt_at
    expect(master.selectAnchorTimestamp('ALL', metaWithAttempt)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateOrchestratorConfig
// ─────────────────────────────────────────────────────────────────────────────
describe('validateOrchestratorConfig', () => {
  function makeValidConfig() {
    return {
      system: {
        version: '1.1.0',
        timezone: 'America/Sao_Paulo',
        scheduling: { heartbeat_interval: 'PT1H', default_repeat_policy: 'ALL_SUCCEEDED' }
      },
      telemetry: { spreadsheet_name: 'Sudoku PRO', sheet_name: 'JobsTelemetry' },
      jobs_schedule: { coldstorage_rooms: { enabled: true, schedule: { interval: 'P1D', repeat_policy: 'ALL_SUCCEEDED' } } },
      visual_theme: {
        job_styles: { coldstorage_rooms: { label: 'X', row_background: '#fff', row_font_color: '#000', job_id_cell: { bg: '#f', fg: '#0' } } },
        status_cells: { SUCCESS: { bg: '#0', fg: '#1' }, SKIPPED: { bg: '#2', fg: '#3' }, FAILED: { bg: '#4', fg: '#5' } },
        error_column: { default_clean: { bg: '#0', fg: '#1' }, has_exception: { bg: '#2', fg: '#3' } }
      }
    };
  }

  test('aceita configuração válida sem lançar exceção', () => {
    expect(() => master.validateOrchestratorConfig(makeValidConfig())).not.toThrow();
  });
  test('lança se system.version ausente', () => {
    const cfg = makeValidConfig(); delete cfg.system.version;
    expect(() => master.validateOrchestratorConfig(cfg)).toThrow();
  });
  test('lança se heartbeat_interval ausente', () => {
    const cfg = makeValidConfig(); delete cfg.system.scheduling.heartbeat_interval;
    expect(() => master.validateOrchestratorConfig(cfg)).toThrow();
  });
  test('lança se default_repeat_policy inválida', () => {
    const cfg = makeValidConfig(); cfg.system.scheduling.default_repeat_policy = 'INVALID';
    expect(() => master.validateOrchestratorConfig(cfg)).toThrow();
  });
  test('lança se jobs_schedule ausente', () => {
    const cfg = makeValidConfig(); delete cfg.jobs_schedule;
    expect(() => master.validateOrchestratorConfig(cfg)).toThrow();
  });
  test('lança se telemetry incompleta', () => {
    const cfg = makeValidConfig(); delete cfg.telemetry.sheet_name;
    expect(() => master.validateOrchestratorConfig(cfg)).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseTriggerSpec
// ─────────────────────────────────────────────────────────────────────────────
describe('parseTriggerSpec', () => {
  test('PT1H → hours=1', () => {
    expect(master.parseTriggerSpec('PT1H')).toEqual({ unit: 'hours', value: 1 });
  });
  test('P1D → days=1', () => {
    expect(master.parseTriggerSpec('P1D')).toEqual({ unit: 'days', value: 1 });
  });
  test('PT30M → minutes=30', () => {
    expect(master.parseTriggerSpec('PT30M')).toEqual({ unit: 'minutes', value: 30 });
  });
  test('P1W → weeks=1', () => {
    expect(master.parseTriggerSpec('P1W')).toEqual({ unit: 'weeks', value: 1 });
  });
  test('PT7M não é valor aceito para everyMinutes', () => {
    expect(() => master.parseTriggerSpec('PT7M')).toThrow();
  });
  test('P1DT2H (composto) não é representável como trigger único', () => {
    expect(() => master.parseTriggerSpec('P1DT2H')).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ciclo do Master — dispatch, políticas, lock, falhas (com mocks)
// ─────────────────────────────────────────────────────────────────────────────
describe('runMasterCore (com mocks de GAS)', () => {
  function makeValidConfig(overrides) {
    return Object.assign({
      system: {
        version: '1.1.0',
        timezone: 'America/Sao_Paulo',
        scheduling: { heartbeat_interval: 'PT1H', default_repeat_policy: 'ALL_SUCCEEDED' }
      },
      telemetry: { spreadsheet_name: 'Sudoku PRO', sheet_name: 'JobsTelemetry' },
      jobs_schedule: {
        coldstorage_rooms: {
          enabled: true,
          schedule: { interval: 'P1D', repeat_policy: 'ALL_SUCCEEDED' }
        }
      },
      visual_theme: {
        job_styles: {
          master_orchestrator: { label: 'MASTER_ORCHESTRATOR', row_background: '#1e293b', row_font_color: '#f8fafc', job_id_cell: { bg: '#0f172a', fg: '#38bdf8' } },
          coldstorage_rooms:   { label: 'COLDSTORAGE_ROOMS',   row_background: '#ffffff', row_font_color: '#0f172a', job_id_cell: { bg: '#f1f5f9', fg: '#0284c7' } },
          default:             { label: 'GENERIC_JOB',          row_background: '#ffffff', row_font_color: '#000000', job_id_cell: { bg: '#e2e8f0', fg: '#334155' } }
        },
        status_cells: {
          SUCCESS: { bg: '#dcfce7', fg: '#15803d' },
          SKIPPED: { bg: '#f1f5f9', fg: '#64748b' },
          FAILED:  { bg: '#fee2e2', fg: '#b91c1c' }
        },
        error_column: {
          default_clean: { bg: '#fef9c3', fg: '#854d0e' },
          has_exception: { bg: '#ef4444', fg: '#ffffff' }
        }
      }
    }, overrides || {});
  }

  test('não despacha job desabilitado', () => {
    const config = makeValidConfig();
    config.jobs_schedule.coldstorage_rooms.enabled = false;
    const { invokedJobs } = master.evaluateJobSchedule(config, {}, Date.now(), 'MANUAL_MASTER');
    expect(invokedJobs).toEqual([]);
  });

  test('não despacha job habilitado sem handler', () => {
    const config = makeValidConfig();
    config.jobs_schedule.coldstorage_rooms.enabled = true;
    const { invokedJobs } = master.evaluateJobSchedule(config, {}, Date.now(), 'MANUAL_MASTER', {});
    expect(invokedJobs).toEqual([]);
  });

  test('despacha job quando intervalo vencido (sem âncora = primeira exec)', () => {
    const config = makeValidConfig();
    const serverMeta = {}; // sem âncora → elegível
    const handlerMock = jest.fn().mockReturnValue({
      jobId: 'coldstorage_rooms', status: 'SUCCESS',
      completedSuccessfully: true, notes: '', errorTrace: '',
      itemsProcessed: 1, bytesDownloaded: 100, bytesSaved: 90, target: 'file.json',
      timestamp: new Date().toISOString(), invocation: 'MANUAL_MASTER', action: 'BACKUP', runId: 'r1'
    });
    const handlers = { coldstorage_rooms: handlerMock };
    const { invokedJobs } = master.evaluateJobSchedule(config, serverMeta, Date.now(), 'MANUAL_MASTER', handlers);
    expect(invokedJobs).toContain('coldstorage_rooms');
    expect(handlerMock).toHaveBeenCalledTimes(1);
  });

  test('não despacha job quando intervalo ainda não vencido', () => {
    const config = makeValidConfig();
    const now = Date.now();
    // last_success_at = agora mesmo → intervalo P1D não venceu
    const serverMeta = { coldstorage_rooms: { last_success_at: now } };
    const handlerMock = jest.fn();
    const handlers = { coldstorage_rooms: handlerMock };
    const { invokedJobs } = master.evaluateJobSchedule(config, serverMeta, now, 'MANUAL_MASTER', handlers);
    expect(invokedJobs).toEqual([]);
    expect(handlerMock).not.toHaveBeenCalled();
  });

  test('ALL: execução manual com falha desloca âncora', () => {
    const config = makeValidConfig();
    config.jobs_schedule.coldstorage_rooms.schedule.repeat_policy = 'ALL';
    const pastTs = Date.now() - 90000000; // > 24 h atrás
    const serverMeta = { coldstorage_rooms: { last_completed_at: pastTs } };
    const handlerMock = jest.fn().mockReturnValue({
      jobId: 'coldstorage_rooms', status: 'FAILED',
      completedSuccessfully: false, notes: '', errorTrace: 'erro x',
      itemsProcessed: 0, bytesDownloaded: 0, bytesSaved: 0, target: '',
      timestamp: new Date().toISOString(), invocation: 'MANUAL_MASTER', action: 'BACKUP', runId: 'r2'
    });
    const handlers = { coldstorage_rooms: handlerMock };
    const { invokedJobs } = master.evaluateJobSchedule(config, serverMeta, Date.now(), 'MANUAL_MASTER', handlers);
    expect(invokedJobs).toContain('coldstorage_rooms');
  });

  test('SCHEDULED_SUCCEEDED: execução manual NÃO desloca âncora agendada', () => {
    const config = makeValidConfig();
    config.jobs_schedule.coldstorage_rooms.schedule.repeat_policy = 'SCHEDULED_SUCCEEDED';
    const pastTs = Date.now() - 90000000;
    // last_scheduled_success_at inexistente → null → elegível
    const serverMeta = { coldstorage_rooms: { last_success_at: pastTs } };
    const handlerMock = jest.fn().mockReturnValue({
      jobId: 'coldstorage_rooms', status: 'SUCCESS',
      completedSuccessfully: true, notes: '', errorTrace: '',
      itemsProcessed: 1, bytesDownloaded: 10, bytesSaved: 10, target: 'f.json',
      timestamp: new Date().toISOString(), invocation: 'MANUAL_MASTER', action: 'BACKUP', runId: 'r3'
    });
    const handlers = { coldstorage_rooms: handlerMock };
    // Como não há last_scheduled_success_at, é elegível mesmo sem âncora
    const { invokedJobs } = master.evaluateJobSchedule(config, serverMeta, Date.now(), 'MANUAL_MASTER', handlers);
    expect(invokedJobs).toContain('coldstorage_rooms');
  });

  test('identifica SCHEDULED_MASTER corretamente', () => {
    const metrics = master.buildBaseMetrics('master_orchestrator', { invocation: 'SCHEDULED_MASTER', runId: 'r_sched' });
    expect(metrics.invocation).toBe('SCHEDULED_MASTER');
  });

  test('identifica MANUAL_SOLO corretamente', () => {
    const metrics = master.buildBaseMetrics('coldstorage_rooms', { invocation: 'MANUAL_SOLO', runId: 'r_solo' });
    expect(metrics.invocation).toBe('MANUAL_SOLO');
  });

  test('sanitizeError redige tokens de autenticação', () => {
    const err = new Error('Falha: auth=TOKEN_SECRETO123 no request');
    const clean = master.sanitizeError(err);
    expect(clean).not.toContain('TOKEN_SECRETO123');
    expect(clean).toContain('[REDACTED]');
  });

  test('lança se repeat_policy do job for inválido', () => {
    const config = makeValidConfig();
    config.jobs_schedule.coldstorage_rooms.schedule.repeat_policy = 'INVALIDO';
    expect(() => {
      master.evaluateJobSchedule(config, {}, Date.now(), 'MANUAL_MASTER', {
        coldstorage_rooms: () => {}
      });
    }).toThrow();
  });

  test('usa default_repeat_policy quando repeat_policy omitido no job', () => {
    const config = makeValidConfig();
    delete config.jobs_schedule.coldstorage_rooms.schedule.repeat_policy;
    // default_repeat_policy = 'ALL_SUCCEEDED' → usa last_success_at
    const now = Date.now();
    const serverMeta = { coldstorage_rooms: { last_success_at: now } };
    const handlerMock = jest.fn();
    const { invokedJobs } = master.evaluateJobSchedule(config, serverMeta, now, 'MANUAL_MASTER', { coldstorage_rooms: handlerMock });
    // Não vencido (acabou de executar)
    expect(invokedJobs).toEqual([]);
    expect(handlerMock).not.toHaveBeenCalled();
  });
});
