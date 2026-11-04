/**
 * gas-butignore.test.js
 *
 * Testes unitários para o parser .butIgnore do Cold Storage (GAS).
 * Cobre: seções INI, regras globais, compilação de RegExp, falha segura.
 * Não exige conexão real com Firebase, Drive, Sheets ou GitHub.
 */

'use strict';

const { loadGASColdStorage } = require('../helpers/gas-loader');

let cs;

beforeAll(() => {
  cs = loadGASColdStorage();
});

// ─────────────────────────────────────────────────────────────────────────────
// parseButIgnoreText
// ─────────────────────────────────────────────────────────────────────────────
describe('parseButIgnoreText', () => {
  test('preserva regras globais (fora de seção)', () => {
    const text = 'presence\nsomething/else';
    const rules = cs.parseButIgnoreText(text, 'coldstorage_rooms');
    expect(rules.length).toBe(2);
  });

  test('lê regras da seção correta e as combina com globais', () => {
    const text = [
      'presence',
      '[coldstorage_rooms]',
      'rooms/*/moves',
      'rooms/*/cursors',
    ].join('\n');
    const rules = cs.parseButIgnoreText(text, 'coldstorage_rooms');
    expect(rules.length).toBe(3); // 1 global + 2 seccionais
  });

  test('não aplica regras de outra seção', () => {
    const text = [
      'presence',
      '[coldstorage_chats]',
      'chats/*/messages',
    ].join('\n');
    const rules = cs.parseButIgnoreText(text, 'coldstorage_rooms');
    expect(rules.length).toBe(1); // só a global
  });

  test('ignora comentários iniciados com #', () => {
    const text = '# comentário\npresence\n# outro';
    const rules = cs.parseButIgnoreText(text, 'coldstorage_rooms');
    expect(rules.length).toBe(1);
  });

  test('ignora linhas vazias', () => {
    const text = '\n\npresence\n\n';
    const rules = cs.parseButIgnoreText(text, 'coldstorage_rooms');
    expect(rules.length).toBe(1);
  });

  test('retorna array vazio para arquivo sem regras relevantes', () => {
    const text = '# só comentário\n';
    const rules = cs.parseButIgnoreText(text, 'coldstorage_rooms');
    expect(rules.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// compileButIgnoreRule — '*' como um segmento
// ─────────────────────────────────────────────────────────────────────────────
describe('compileButIgnoreRule', () => {
  test('* corresponde a exatamente um segmento', () => {
    const re = cs.compileButIgnoreRule('rooms/*/moves');
    expect(re.test('rooms/SALA123/moves')).toBe(true);
    expect(re.test('rooms/SALA123/moves/subpath')).toBe(true);
  });

  test('* NÃO corresponde a múltiplos segmentos', () => {
    const re = cs.compileButIgnoreRule('rooms/*/moves');
    expect(re.test('rooms/a/b/moves')).toBe(false);
  });

  test('regra sem curinga corresponde a caminho exato', () => {
    const re = cs.compileButIgnoreRule('presence');
    expect(re.test('presence')).toBe(true);
    expect(re.test('presence/sub')).toBe(true);
    expect(re.test('presencex')).toBe(false);
  });

  test('escapa caracteres especiais de regex literalmente', () => {
    const re = cs.compileButIgnoreRule('rooms/sala.especial/moves');
    expect(re.test('rooms/sala.especial/moves')).toBe(true);
    // ponto literal — não casa com caractere arbitrário
    expect(re.test('rooms/salaXespecial/moves')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// applyButIgnoreFilter — integração parser + filtro
// ─────────────────────────────────────────────────────────────────────────────
describe('applyButIgnoreFilter', () => {
  // O filtro recebe o objeto de salas ({ROOM1: {...}}) e inicia a traversal com
  // o prefixo 'rooms', de modo que o caminho interno montado é 'rooms/ROOM1/moves'.
  // Isso permite que as regras do .butIgnore usem caminhos Firebase completos
  // (ex: rooms/*/moves) e casem corretamente.

  function makeRooms() {
    return {
      ROOM1: {
        updatedAt: 1000,
        meta: { ownerPlayerId: 'p1' },
        boardState: { boardValues: [] },
        moves: { m1: { action: 'SET' } },
        presence: { isActive: true },
        cursors: { p1: { row: 0 } },
      }
    };
  }

  test('remove moves e cursors com regras rooms/*/moves e rooms/*/cursors', () => {
    // Regras do .butIgnore real — caminhos Firebase completos
    const text = [
      '[coldstorage_rooms]',
      'rooms/*/moves',
      'rooms/*/cursors',
    ].join('\n');
    const rules = cs.parseButIgnoreText(text, 'coldstorage_rooms');
    const rooms = makeRooms();
    const count = cs.applyButIgnoreFilter(rooms, rules);
    expect(rooms.ROOM1.moves).toBeUndefined();
    expect(rooms.ROOM1.cursors).toBeUndefined();
    expect(count).toBeGreaterThan(0);
  });

  test('remove presence com regra global rooms/*/presence', () => {
    const text = 'rooms/*/presence';
    const rules = cs.parseButIgnoreText(text, 'coldstorage_rooms');
    const rooms = makeRooms();
    cs.applyButIgnoreFilter(rooms, rules);
    expect(rooms.ROOM1.presence).toBeUndefined();
  });

  test('preserva nós não cobertos pelas regras (meta, boardState, updatedAt)', () => {
    const text = [
      '[coldstorage_rooms]',
      'rooms/*/moves',
      'rooms/*/cursors',
    ].join('\n');
    const rules = cs.parseButIgnoreText(text, 'coldstorage_rooms');
    const rooms = makeRooms();
    cs.applyButIgnoreFilter(rooms, rules);
    expect(rooms.ROOM1.meta).toBeDefined();
    expect(rooms.ROOM1.boardState).toBeDefined();
    expect(rooms.ROOM1.updatedAt).toBe(1000);
    // presence não foi excluída (não estava nas regras)
    expect(rooms.ROOM1.presence).toBeDefined();
  });

  test('não aplica filtro com lista vazia de regras', () => {
    const rooms = makeRooms();
    const count = cs.applyButIgnoreFilter(rooms, []);
    expect(rooms.ROOM1.moves).toBeDefined();
    expect(count).toBe(0);
  });

  test('regra "rooms/*/moves" compila corretamente e casa rooms/SALA/moves', () => {
    const re = cs.compileButIgnoreRule('rooms/*/moves');
    expect(re.test('rooms/SALA123/moves')).toBe(true);
    expect(re.test('rooms/SALA123/moves/subpath')).toBe(true);
    expect(re.test('rooms/SALA123/cursors')).toBe(false);
    expect(re.test('rooms/a/b/moves')).toBe(false); // dois segmentos após rooms/ — não casa
  });

  test('combina regras globais e seccionais — .butIgnore real completo', () => {
    // Simulação do .butIgnore real do repositório
    const text = [
      '# Regras globais legadas preservadas',
      'rooms/*/presence',
      '',
      '[coldstorage_rooms]',
      'rooms/*/moves',
      'rooms/*/presence',
      'rooms/*/cursors',
    ].join('\n');
    const rules = cs.parseButIgnoreText(text, 'coldstorage_rooms');
    // 1 global (rooms/*/presence) + 3 seccionais = 4, mas rooms/*/presence duplica
    expect(rules.length).toBe(4);
    const rooms = makeRooms();
    cs.applyButIgnoreFilter(rooms, rules);
    expect(rooms.ROOM1.moves).toBeUndefined();
    expect(rooms.ROOM1.presence).toBeUndefined();
    expect(rooms.ROOM1.cursors).toBeUndefined();
    expect(rooms.ROOM1.meta).toBeDefined();
    expect(rooms.ROOM1.boardState).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// filterEligibleRooms — janela diferencial e legado
// ─────────────────────────────────────────────────────────────────────────────
describe('filterEligibleRooms', () => {
  const last = 1000000;
  const wake = 2000000;

  const allRooms = {
    inWindow:  { updatedAt: 1500000, meta: {} },
    beforeWm:  { updatedAt:  500000, meta: {} },
    future:    { updatedAt: 3000000, meta: {} },
    legacy1:   { meta: {} },                        // sem updatedAt
    legacy2:   { updatedAt: null, meta: {} },
    legacy3:   { updatedAt: 0,    meta: {} },
    badTs:     { updatedAt: 'nao-numerico', meta: {} },
  };

  test('inclui salas dentro da janela [last, wakeUp)', () => {
    const { eligible } = cs.filterEligibleRooms(allRooms, last, wake);
    expect(eligible['inWindow']).toBeDefined();
  });

  test('exclui salas com updatedAt < last (já cobertas)', () => {
    const { eligible } = cs.filterEligibleRooms(allRooms, last, wake);
    expect(eligible['beforeWm']).toBeUndefined();
  });

  test('adia salas com updatedAt >= wakeUpTime', () => {
    const { eligible, futureCount } = cs.filterEligibleRooms(allRooms, last, wake);
    expect(eligible['future']).toBeUndefined();
    expect(futureCount).toBe(1);
  });

  test('inclui salas legadas (updatedAt ausente, null ou 0)', () => {
    const { eligible, legacyCount } = cs.filterEligibleRooms(allRooms, last, wake);
    expect(eligible['legacy1']).toBeDefined();
    expect(eligible['legacy2']).toBeDefined();
    expect(eligible['legacy3']).toBeDefined();
    // legacy1 (sem updatedAt), legacy2 (null), legacy3 (0) = 3 explícitas
    // badTs também conta como legado, logo legacyCount >= 3
    expect(legacyCount).toBeGreaterThanOrEqual(3);
  });

  test('trata timestamps inválidos de forma conservadora (como legado)', () => {
    const { eligible, legacyCount } = cs.filterEligibleRooms(allRooms, last, wake);
    // badTs deve ser incluído como sala elegível
    expect(eligible['badTs']).toBeDefined();
    // legacyCount inclui badTs além dos 3 explícitos
    expect(legacyCount).toBe(4);
  });

  test('não avança watermark além de wakeUpTime', () => {
    const { eligible } = cs.filterEligibleRooms(allRooms, last, wake);
    // Sala futura não deve estar elegível
    expect(eligible['future']).toBeUndefined();
  });
});
