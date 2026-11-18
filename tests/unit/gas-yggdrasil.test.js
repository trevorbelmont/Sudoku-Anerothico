/**
 * gas-yggdrasil.test.js
 * Testes puros da projeção Jianmu, ledger/hash e serialização Firestore.
 * Não acessa Firebase, Firestore, Google Drive ou Google Sheets reais.
 */
'use strict';

const { loadGASColdStorage } = require('../helpers/gas-loader');

let cs;
beforeAll(() => { cs = loadGASColdStorage(); });

function makeRoom() {
  return {
    updatedAt: 1700000000000,
    meta: {
      createdAtTimestamp: 1699990000000,
      ownerPlayerId: 'owner/player',
      instanceNumber: 3,
      boardDimension: 4,
      fixedInitialGrid: [[1, 0], [0, 1]],
      solutionGrid: [[1, 2], [2, 1]],
      roomMode: 'coop'
    },
    boardState: {
      boardInstanceNumber: 3,
      boardValues: [['1', ''], ['', '1']],
      pencilNotes: [[[], ['2']], [['1'], []]],
      elapsedSeconds: 12,
      isCompleted: false,
      updatedAtTimestamp: 1700000000000
    },
    settings: { immediateErrorCheck: true, immediateErrorUpdatedAt: 1700000000000 },
    members: { p1: { playerId: 'p1', playerName: 'Jogador', playerColor: '#112233', joinedAtTimestamp: 1699999999000, clientMetadata: { language: 'pt-BR' } } },
    contributions: { '0_0': { kind: 'PLAYER', action: 'SET', playerId: 'p1', playerName: 'Jogador', timestamp: 1700000000000 } },
    players: { p1: { playerName: 'Jogador' } },
    privateData: { p1: { clientMetadata: { language: 'pt-BR' } } },
    presence: { isActive: true },
    proposal: { status: 'pending' },
    featureVote: { status: 'pending' },
    history: {
      '2': {
        instanceNumber: 2,
        meta: { instanceNumber: 2, boardDimension: 4, solutionGrid: [[1]] },
        boardState: { boardInstanceNumber: 2, boardValues: [['1']] },
        contributions: { '0_0': { playerId: 'p0', action: 'SET', kind: 'PLAYER' } },
        archivedAtTimestamp: 1699999990000
      }
    },
    contributionEvents: {
      '3': {
        evt1: { eventId: 'evt1', operation: 'DELETE', instanceNumber: 3, cellKey: '0_0', row: 0, column: 0, playerId: 'p1', timestamp: 1700000000000 }
      }
    }
  };
}

describe('Jianmu projection and hash', () => {
  test('applies a strict allowlist and excludes solution/private/transient data', () => {
    const projection = cs.jianmu_projectRoomData('ROOM_A', makeRoom());
    expect(projection.meta.solutionGrid).toBeUndefined();
    expect(projection.members.p1.clientMetadata).toBeUndefined();
    expect(projection.players).toBeUndefined();
    expect(projection.privateData).toBeUndefined();
    expect(projection.presence).toBeUndefined();
    expect(projection.proposal).toBeUndefined();
    expect(projection.featureVote).toBeUndefined();
    expect(projection.history['2'].meta.solutionGrid).toBeUndefined();
    expect(projection.contributionEvents).toBeUndefined();
  });

  test('contributionEvents não altera projeção nem hash persistente', () => {
    const first = cs.jianmu_projectRoomData('ROOM_A', makeRoom());
    const changedRoom = makeRoom();
    changedRoom.contributionEvents['3'].evt2 = { eventId: 'evt2', operation: 'SET', instanceNumber: 3, cellKey: '1_1', timestamp: 1700000001000 };
    const second = cs.jianmu_projectRoomData('ROOM_A', changedRoom);
    expect(cs.jianmu_canonicalize(first)).toBe(cs.jianmu_canonicalize(second));
  });

  test('orders object keys canonically and keeps array order', () => {
    const a = cs.jianmu_canonicalize({ b: 2, a: { y: 1, x: 0 }, rows: [[1, 2], [3, 4]] });
    const b = cs.jianmu_canonicalize({ rows: [[1, 2], [3, 4]], a: { x: 0, y: 1 }, b: 2 });
    expect(a).toBe(b);
    expect(cs.jianmu_calculateSha256(a)).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  test('persistent subnode changes alter the projection and do not depend on root updatedAt', () => {
    const first = cs.jianmu_projectRoomData('ROOM_A', makeRoom());
    const changedRoom = makeRoom();
    changedRoom.members.p1.playerColor = '#abcdef';
    changedRoom.updatedAt = 1;
    const second = cs.jianmu_projectRoomData('ROOM_A', changedRoom);
    expect(cs.jianmu_canonicalize(first)).not.toBe(cs.jianmu_canonicalize(second));
  });

  test('falha fechado para sala/snapshot sem estrutura mínima de instância', () => {
    expect(() => cs.jianmu_projectRoomData('BROKEN', { meta: { instanceNumber: 1 }, boardState: {} })).toThrow(/boardState.boardValues/);
    const malformedHistory = makeRoom();
    malformedHistory.history = { '2': { meta: { instanceNumber: 2 }, boardState: {} } };
    expect(() => cs.jianmu_projectRoomData('BROKEN_HISTORY', malformedHistory)).toThrow(/Snapshot histórico inválido/);
    const mismatched = makeRoom();
    mismatched.boardState.boardInstanceNumber = 4;
    expect(() => cs.jianmu_projectRoomData('MISMATCHED', mismatched)).toThrow(/instanceNumber divergente/);
  });

  test('preserves IDs that look like object prototype properties without mutating prototypes', () => {
    const room = makeRoom();
    room.contributions = JSON.parse('{"__proto__":{"kind":"PLAYER","action":"SET","playerId":"p"},"constructor":{"kind":"NASA","action":"NASA","playerId":"NASA"}}');
    const projection = cs.jianmu_projectRoomData('ROOM_A', room);
    expect(Object.keys(projection.contributions)).toContain('__proto__');
    expect(Object.keys(projection.contributions)).toContain('constructor');
    expect(Object.getPrototypeOf(projection.contributions)).toBe(null);
  });

  test('root updatedAt isolado é diagnóstico e não altera o hash do conteúdo persistente', () => {
    const first = cs.jianmu_projectRoomData('ROOM_A', makeRoom());
    const changedRoom = makeRoom();
    changedRoom.updatedAt += 5000;
    const second = cs.jianmu_projectRoomData('ROOM_A', changedRoom);
    delete first.updatedAt;
    delete second.updatedAt;
    expect(cs.jianmu_canonicalize(first)).toBe(cs.jianmu_canonicalize(second));
  });
});

describe('Firestore value conversion', () => {
  test('encodes scalar values using Firestore REST types', () => {
    expect(cs.ygg_convertToFirestoreValue(null)).toEqual({ nullValue: null });
    expect(cs.ygg_convertToFirestoreValue(true)).toEqual({ booleanValue: true });
    expect(cs.ygg_convertToFirestoreValue('á')).toEqual({ stringValue: 'á' });
    expect(cs.ygg_convertToFirestoreValue(1700000000000)).toEqual({ integerValue: '1700000000000' });
    expect(cs.ygg_convertToFirestoreValue(1.25)).toEqual({ doubleValue: 1.25 });
  });

  test('round-trips 4x4, 9x9 and 25x25 nested arrays', () => {
    [4, 9, 25].forEach(size => {
      const matrix = Array.from({ length: size }, (_, r) => Array.from({ length: size }, (_, c) => (r + c) % 10));
      const encoded = cs.ygg_convertToFirestoreValue(matrix);
      expect(JSON.stringify(encoded)).not.toContain('arrayValue":{"values":[{"arrayValue"');
      expect(cs.ygg_decodeFirestoreValue(encoded)).toEqual(matrix);
    });
  });

  test('omits undefined map fields but rejects undefined array elements and non-finite numbers', () => {
    expect(cs.ygg_convertToFirestoreValue({ keep: 1, omit: undefined }).mapValue.fields.omit).toBeUndefined();
    expect(() => cs.ygg_convertToFirestoreValue([1, undefined])).toThrow(/undefined/);
    expect(() => cs.ygg_convertToFirestoreValue(NaN)).toThrow(/NaN/);
    expect(() => cs.ygg_convertToFirestoreValue(Infinity)).toThrow(/NaN/);
    expect(() => cs.ygg_convertToFirestoreValue(Number.MAX_SAFE_INTEGER + 1)).toThrow(/precisão segura/);
  });

  test('document IDs are deterministic and reversible', () => {
    const original = 'room/name com acento ç';
    const encoded = cs.ygg_encodeDocumentId(original);
    expect(encoded).not.toContain('/');
    expect(cs.ygg_decodeDocumentId(encoded)).toBe(original);
    expect(cs.ygg_encodeDocumentId(original)).toBe(encoded);
  });
});

describe('Firestore write plan', () => {
  test('creates historical/current instance and contribution documents, but no contribution-event documents', () => {
    const projection = cs.jianmu_projectRoomData('ROOM_A', makeRoom());
    const plan = cs.ygg_buildRoomWrites('sudoku-anerothico', projection, 'sha256:' + 'a'.repeat(64), 1700000000000);
    const names = plan.writes.filter(w => w.update).map(w => w.update.name);
    expect(names.some(n => n.includes('/instances/id_0032/'))).toBe(true); // instance "2"
    expect(names.some(n => n.includes('/instances/id_0033/'))).toBe(true); // instance "3"
    expect(names.some(n => n.includes('/contribution_events/'))).toBe(false);
    expect(names.some(n => n.includes('/contributions/'))).toBe(true);
    expect(plan.currentContributionDocumentIds).toContain(cs.ygg_encodeDocumentId('0_0'));
    const currentInstanceWrite = plan.writes.find(w => w.update && w.update.name.includes('/instances/id_0033'));
    expect(currentInstanceWrite.update.fields.contributions).toBeUndefined();
  });

  test('builds explicit deletes only for stale active-instance contribution documents', () => {
    const collectionPath = 'projects/p/databases/(default)/documents/cold_rooms/r/instances/i/contributions';
    const currentContributionId = cs.ygg_encodeDocumentId('0_0');
    const staleContributionId = cs.ygg_encodeDocumentId('0_1');
    const deletes = cs.ygg_buildStaleContributionDeletes(collectionPath, [
      collectionPath + '/' + currentContributionId,
      collectionPath + '/' + staleContributionId
    ], [currentContributionId]);
    expect(deletes).toHaveLength(1);
    expect(deletes[0].delete).toBe(collectionPath + '/' + staleContributionId);
  });

  test('rejects plans exceeding the safe per-room write limit', () => {
    const writes = Array.from({ length: 451 }, (_, i) => ({ delete: 'projects/p/databases/(default)/documents/cold_rooms/r/d' + i }));
    expect(() => cs.ygg_validateRoomWritePlan(writes)).toThrow(/limite operacional de writes/);
  });
});


describe('runColdStorageCore — sincronização diferencial integrada (mocks)', () => {
  function response(code, text) {
    const content = Buffer.from(text || '', 'utf8');
    return {
      getResponseCode: () => code,
      getContentText: () => text || '',
      getContent: () => Array.from(content)
    };
  }

  function buildHarness(options) {
    options = options || {};
    let marker = null;
    let checkpoint = null;
    let rooms = { LEGACY_ROOM: {
      meta: { instanceNumber: 1, boardDimension: 4, fixedInitialGrid: [[1]], ownerPlayerId: 'owner' },
      boardState: { boardInstanceNumber: 1, boardValues: [['1']], updatedAtTimestamp: 1000 },
      settings: { immediateErrorCheck: false },
      members: { p1: { playerId: 'p1', playerName: 'Nome', joinedAtTimestamp: 900 } },
      contributions: { '0_0': { kind: 'PLAYER', action: 'SET', playerId: 'p1', timestamp: 950 } }
    } };
    const commits = [];
    const calls = [];
    const csHarness = loadGASColdStorage({
      props: {},
      urlFetch: (url, opts) => {
        opts = opts || {};
        calls.push({ url, method: opts.method || 'GET', opts });
        if (url.includes('/rooms.json')) return response(200, JSON.stringify(rooms));
        if (url.includes('/rooms/LEGACY_ROOM.json') && opts.method === 'PATCH') {
          const patch = JSON.parse(opts.payload);
          Object.keys(patch).forEach(path => {
            const parts = path.split('/');
            if (parts[0] === 'history' && parts.length === 2) {
              if (rooms.LEGACY_ROOM.history) delete rooms.LEGACY_ROOM.history[parts[1]];
            }
          });
          if (rooms.LEGACY_ROOM.history && !Object.keys(rooms.LEGACY_ROOM.history).length) delete rooms.LEGACY_ROOM.history;
          return response(200, JSON.stringify(rooms.LEGACY_ROOM));
        }
        if (url.includes('/server_meta/coldstorage_rooms.json')) {
          if ((opts.method || 'GET') === 'GET') return response(200, checkpoint ? JSON.stringify(checkpoint) : 'null');
          if (opts.method === 'PATCH') { checkpoint = Object.assign({}, checkpoint || {}, JSON.parse(opts.payload)); return response(200, JSON.stringify(checkpoint)); }
        }
        if (url.includes('/eden/coldstorage_rooms/room_sync/')) {
          if ((opts.method || 'GET') === 'GET') return response(200, marker ? JSON.stringify(marker) : 'null');
          if (opts.method === 'PUT') { marker = JSON.parse(opts.payload); return response(200, JSON.stringify(marker)); }
        }
        if (url.includes('firestore.googleapis.com')) {
          if ((opts.method || 'GET') === 'GET') return response(200, JSON.stringify({ documents: [] }));
          if (opts.method === 'POST') {
            const request = JSON.parse(opts.payload);
            commits.push(request);
            if (options.commitStatus && options.commitStatus !== 200) return response(options.commitStatus, JSON.stringify({ error: { message: 'mock failure' } }));
            return response(200, JSON.stringify({ writeResults: request.writes.map(() => ({})), commitTime: '2026-11-18T00:00:00Z' }));
          }
        }
        return response(500, 'unexpected mock URL');
      }
    });
    const props = { getProperty: key => ({
      FIREBASE_URL: 'https://test.firebaseio.com',
      FIREBASE_SECRET: 'test-secret',
      PROJECT_ID: 'sudoku-anerothico'
    })[key] || null };
    const config = { system: { timezone: 'America/Sao_Paulo' }, jobs_schedule: { coldstorage_rooms: { schedule: { repeat_policy: 'ALL_SUCCEEDED' } } } };
    return {
      cs: csHarness, props, config, get rooms() { return rooms; },
      setRooms(value) { rooms = value; },
      getMarker() { return marker; },
      getCheckpoint() { return checkpoint; },
      commits, calls
    };
  }

  test('sincroniza sala legada uma vez e ignora hash idêntico no ciclo seguinte', () => {
    const h = buildHarness();
    const first = h.cs.runColdStorageCore(h.props, h.config, [], 1700000000000, 'run-1', 'MANUAL_SOLO');
    expect(first.status).toBe('SUCCESS');
    expect(h.commits).toHaveLength(1);
    expect(h.getMarker().lastSyncedHash).toMatch(/^sha256:/);
    expect(h.getCheckpoint().last_backup_timestamp).toBe(1700000000000);

    const second = h.cs.runColdStorageCore(h.props, h.config, [], 1700000001000, 'run-2', 'MANUAL_SOLO');
    expect(second.status).toBe('SKIPPED');
    expect(h.commits).toHaveLength(1);
    expect(h.getMarker().lastRunId).toBe('run-1');
    expect(h.getCheckpoint().last_backup_timestamp).toBe(1700000001000);
  });

  test('detecta mudança em membro mesmo sem mudança no updatedAt da raiz', () => {
    const h = buildHarness();
    h.cs.runColdStorageCore(h.props, h.config, [], 1700000000000, 'run-1', 'MANUAL_SOLO');
    const changed = JSON.parse(JSON.stringify(h.rooms));
    changed.LEGACY_ROOM.members.p1.playerName = 'Nome alterado';
    h.setRooms(changed);
    const result = h.cs.runColdStorageCore(h.props, h.config, [], 1700000001000, 'run-2', 'MANUAL_SOLO');
    expect(result.status).toBe('SUCCESS');
    expect(h.commits).toHaveLength(2);
    expect(h.getMarker().lastRunId).toBe('run-2');
  });

  test('mudança isolada no updatedAt da raiz não força novo commit', () => {
    const h = buildHarness();
    h.cs.runColdStorageCore(h.props, h.config, [], 1700000000000, 'run-1', 'MANUAL_SOLO');
    const changed = JSON.parse(JSON.stringify(h.rooms));
    changed.LEGACY_ROOM.updatedAt = 1234567899999;
    h.setRooms(changed);
    const result = h.cs.runColdStorageCore(h.props, h.config, [], 1700000001000, 'run-2', 'MANUAL_SOLO');
    expect(result.status).toBe('SKIPPED');
    expect(h.commits).toHaveLength(1);
    expect(h.getMarker().lastRunId).toBe('run-1');
  });

  test('sincroniza snapshots históricos e só os compacta após o commit; ignora contributionEvents', () => {
    const h = buildHarness();
    const withHistory = JSON.parse(JSON.stringify(h.rooms));
    withHistory.LEGACY_ROOM.history = {
      '0': { instanceNumber: 0, meta: { instanceNumber: 0 }, boardState: { boardInstanceNumber: 0, boardValues: [['1']] }, settings: {}, contributions: { '0_0': { kind: 'PLAYER', action: 'SET', playerId: 'old' } }, archivedAtTimestamp: 1500 }
    };
    withHistory.LEGACY_ROOM.contributionEvents = {
      '1': { oldEvent: { eventId: 'oldEvent', operation: 'DELETE', instanceNumber: 1, cellKey: '0_0', timestamp: 1600 } }
    };
    h.setRooms(withHistory);
    const first = h.cs.runColdStorageCore(h.props, h.config, [], 1700000000000, 'run-history', 'MANUAL_SOLO');
    expect(first.status).toBe('SUCCESS');
    expect(h.commits).toHaveLength(1);
    const firstWrites = h.commits[0].writes.map(w => w.update && w.update.name).filter(Boolean);
    expect(firstWrites.some(name => name.includes('/instances/id_0030'))).toBe(true);
    expect(firstWrites.some(name => name.includes('/contribution_events/'))).toBe(false);
    expect(firstWrites.some(name => name.includes('/contributions/'))).toBe(true);
    expect(h.getMarker().projectionVersion).toBe(2);
    expect(h.rooms.LEGACY_ROOM.history).toBeUndefined();
    expect(h.rooms.LEGACY_ROOM.contributionEvents['1'].oldEvent.eventId).toBe('oldEvent');

    // A projeção L1 mudou pela compactação apenas do history. A execução
    // seguinte atualiza o snapshot e mantém os documentos históricos confirmados.
    const second = h.cs.runColdStorageCore(h.props, h.config, [], 1700000001000, 'run-history-2', 'MANUAL_SOLO');
    expect(second.status).toBe('SUCCESS');
    expect(h.commits).toHaveLength(2);
    const third = h.cs.runColdStorageCore(h.props, h.config, [], 1700000002000, 'run-history-3', 'MANUAL_SOLO');
    expect(third.status).toBe('SKIPPED');
    expect(h.commits).toHaveLength(2);
  });

  test('novos contributionEvents no RTDB não provocam escrita nem compactação na Yggdrasil', () => {
    const h = buildHarness();
    h.cs.runColdStorageCore(h.props, h.config, [], 1700000000000, 'run-1', 'MANUAL_SOLO');
    const changed = JSON.parse(JSON.stringify(h.rooms));
    changed.LEGACY_ROOM.contributionEvents = {
      '1': { evt1: { eventId: 'evt1', operation: 'SET', instanceNumber: 1, cellKey: '0_0', timestamp: 1700000000100 } }
    };
    h.setRooms(changed);
    const second = h.cs.runColdStorageCore(h.props, h.config, [], 1700000001000, 'run-2', 'MANUAL_SOLO');
    expect(second.status).toBe('SKIPPED');
    expect(h.commits).toHaveLength(1);
    expect(h.rooms.LEGACY_ROOM.contributionEvents['1'].evt1.eventId).toBe('evt1');
  });

  test('falha no commit não grava marker nem avança checkpoint global', () => {
    const h = buildHarness({ commitStatus: 403 });
    const result = h.cs.runColdStorageCore(h.props, h.config, [], 1700000000000, 'run-fail', 'MANUAL_SOLO');
    expect(result.status).toBe('FAILED');
    expect(h.getMarker()).toBeNull();
    expect(h.getCheckpoint()).toBeNull();
  });
});
