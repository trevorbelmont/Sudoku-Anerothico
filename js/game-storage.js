'use strict';

// Clearing history suppresses autosaves for the currently open game until a new game is started.
let historySuppressedGameId = null;

function normalizeBooleanGrid(grid, N) {
  if (grid == null) return Array.from({ length: N }, () => Array(N).fill(false));
  if (!Array.isArray(grid) || grid.length !== N || grid.some(row => !Array.isArray(row) || row.length !== N)) return null;
  const result = [];
  for (const row of grid) {
    const normalizedRow = [];
    for (const value of row) {
      if (typeof value !== 'boolean') return null;
      normalizedRow.push(value);
    }
    result.push(normalizedRow);
  }
  return result;
}

function normalizeNotesGrid(grid, N, symbols) {
  if (grid == null) return Array.from({ length: N }, () => Array.from({ length: N }, () => []));
  if (!Array.isArray(grid) || grid.length !== N || grid.some(row => !Array.isArray(row) || row.length !== N)) return null;
  const result = [];
  for (const row of grid) {
    const normalizedRow = [];
    for (const cellNotes of row) {
      if (!Array.isArray(cellNotes) || cellNotes.length > N) return null;
      const values = cellNotes.map(value => value == null ? '' : String(value));
      if (values.some(value => !symbols.includes(value)) || new Set(values).size !== values.length) return null;
      normalizedRow.push(values);
    }
    result.push(normalizedRow);
  }
  return result;
}

function normalizeSavedGameRecord(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const valid = validateGameState(raw);
  if (!valid || (!valid.isManualCreating && !valid.sol) || !Array.isArray(raw.board) || !raw.gameId || typeof raw.gameId !== 'string' || raw.gameId.length > 128) return null;
  const board = normalizeSymbolMatrix(raw.board, valid.N, valid.symbols);
  if (!board) return null;
  if (!valid.isManualCreating && !boardPreservesInitial(board, valid.initial, valid.N)) return null;
  if (valid.isManualCreating && board.some(row => row.some(value => value !== '' && !valid.symbols.includes(value)))) return null;

  const notes = normalizeNotesGrid(raw.notes, valid.N, valid.symbols);
  const revealedErrors = normalizeBooleanGrid(raw.revealedErrors, valid.N);
  const nasaContributions = normalizeBooleanGrid(raw.nasaContributions, valid.N);
  if (!notes || !revealedErrors || !nasaContributions) return null;

  const timerSeconds = Number(raw.timerSeconds ?? 0);
  const nasaCalls = Number(raw.nasaCalls ?? 0);
  const updatedAt = Number(raw.updatedAt ?? Date.now());
  if (!Number.isSafeInteger(timerSeconds) || timerSeconds < 0 || timerSeconds > 100000000 ||
      !Number.isSafeInteger(nasaCalls) || nasaCalls < 0 || nasaCalls > 1000000 ||
      !Number.isFinite(updatedAt) || updatedAt < 0) return null;
  const completed = raw.completed === true;
  if (raw.completed != null && typeof raw.completed !== 'boolean') return null;
  if (completed && (valid.isManualCreating || !isGridRuleValid(board, valid.N, valid.bR, valid.bC, valid.symbols, true) || !boardPreservesInitial(board, valid.initial, valid.N))) return null;
  const mode = typeof raw.mode === 'string' && raw.mode.length <= 32 ? raw.mode : valid.mode;
  const difficulty = typeof raw.difficulty === 'string' && raw.difficulty.length <= 32 ? raw.difficulty : valid.difficulty;
  const gameName = typeof raw.gameName === 'string' ? raw.gameName.slice(0, 100) : '';
  return {
    gameId: raw.gameId, updatedAt, mode, difficulty,
    minVal: Number.isFinite(Number(raw.minVal)) ? Number(raw.minVal) : Number(valid.symbols[0]),
    maxVal: Number.isFinite(Number(raw.maxVal)) ? Number(raw.maxVal) : Number(valid.symbols[valid.symbols.length - 1]),
    includeZero: raw.includeZero === true, symbols: valid.symbols, N: valid.N, blockR: valid.bR, blockC: valid.bC,
    solution: valid.sol || Array.from({ length: valid.N }, () => Array(valid.N).fill('')),
    initial: valid.initial, board, notes, revealedErrors, nasaContributions,
    nasaCalls, timerSeconds, completed, gameName, isManualCreating: valid.isManualCreating
  };
}

function getAllSavedGames() {
  try {
    const raw = safeStorageGet(STORAGE_KEYS.SAVED_GAMES);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(normalizeSavedGameRecord).filter(Boolean).slice(0, 35) : [];
  } catch (error) { return []; }
}

      function saveCurrentGameState() {
        if (!state.gameId || state.gameId === historySuppressedGameId) return;
        try {
          const games = getAllSavedGames();
          const record = {
            gameId: state.gameId, updatedAt: Date.now(), mode: state.mode, difficulty: state.difficulty,
            minVal: state.minVal, maxVal: state.maxVal, includeZero: state.includeZero, symbols: state.symbols,
            N: state.N, blockR: state.blockR, blockC: state.blockC, solution: state.solution, initial: state.initial,
            board: state.board, notes: state.notes.map(row => row.map(set => Array.from(set))), revealedErrors: state.revealedErrors,
            nasaContributions: (ensureNasaContributionGrid(), state.nasaContributions.map(row => row.slice())),
            nasaCalls: Math.max(0, Number(state.nasaCalls) || 0),
            timerSeconds: state.timerSeconds, completed: state.completed, gameName: state.gameName, isManualCreating: !!state.isManualCreating
          };
          const existingIdx = games.findIndex(g => g.gameId === state.gameId);
          if (existingIdx >= 0) games[existingIdx] = record; else games.unshift(record);
          const trimmed = games.slice(0, 35);
          safeStorageSet(STORAGE_KEYS.SAVED_GAMES, JSON.stringify(trimmed));
          safeStorageSet(STORAGE_KEYS.CURRENT_GAME_ID, state.gameId);
          updateSavedBadgeCount(trimmed);
        } catch (e) {}
      }

function clearSavedGameHistory() {
  const currentGameId = typeof state !== 'undefined' ? state.gameId : null;
  historySuppressedGameId = typeof currentGameId === 'string' ? currentGameId : null;
  safeStorageRemove(STORAGE_KEYS.SAVED_GAMES);
  safeStorageRemove(STORAGE_KEYS.CURRENT_GAME_ID);
  updateSavedBadgeCount([]);
  renderHistoryModalList();
  showToast('Histórico local apagado. A partida aberta continua em memória, mas não será salva novamente; os próximos jogos voltarão a ser salvos.', 'info');
}

      function loadSavedGameRecord(record) {
        if (state.multiplayer.active && state.multiplayer.roomId) {
          showToast('Saia da sala multiplayer antes de carregar uma partida do histórico.', 'warn');
          return;
        }
        record = normalizeSavedGameRecord(record);
        if (!record) { showToast('Este registro do histórico está inválido ou corrompido.', 'warn'); return; }
        state.gameId = record.gameId; state.gameName = record.gameName || ''; state.mode = record.mode || 'standard';
        const nameInput = document.getElementById('game-name-input'); if (nameInput) nameInput.value = state.gameName; state.difficulty = record.difficulty || 'facil';
        state.minVal = record.minVal ?? 1; state.maxVal = record.maxVal ?? 9; state.includeZero = !!record.includeZero;
        state.symbols = record.symbols || buildSymbolsFromRange(1, 9, false); state.N = record.N || state.symbols.length;
        const dims = computeBlockDimensions(state.N); state.blockR = record.blockR || dims.blockR; state.blockC = record.blockC || dims.blockC;
        state.solution = record.solution; state.initial = record.initial; state.board = record.board;
        state.notes = (record.notes || Array.from({ length: state.N }, () => Array.from({ length: state.N }, () => []))).map(row => row.map(arr => new Set(arr || []))); state.revealedErrors = record.revealedErrors || Array.from({ length: state.N }, () => Array(state.N).fill(false));
        state.nasaContributions = Array.from({ length: state.N }, (_, r) => Array.from({ length: state.N }, (_, c) => !!(record.nasaContributions && record.nasaContributions[r] && record.nasaContributions[r][c])));
        const savedNasaCells = state.nasaContributions.flat().filter(Boolean).length;
        state.nasaCalls = Math.max(0, Number.isFinite(Number(record.nasaCalls)) ? Number(record.nasaCalls) : savedNasaCells);
        state.timerSeconds = record.timerSeconds || 0; state.completed = !!record.completed; state.isManualCreating = !!record.isManualCreating;
        const mcBarLoad = document.getElementById('manual-create-bar'); if (mcBarLoad) { mcBarLoad.classList.toggle('flex', state.isManualCreating); mcBarLoad.classList.toggle('hidden', !state.isManualCreating); }
        state.focusedCell = { r: 0, c: 0 }; state.highlightedSymbol = null;
        syncModeTabsUI(); updateHeaderSubtitle(); document.getElementById('timer-display').textContent = formatTime(state.timerSeconds);
        renderVirtualNumpad(); renderSudokuBoard(); updateNasaContributionSummary();
        if (state.completed || state.isManualCreating) pauseTimer(); else startTimer();
      }
      function updateSavedBadgeCount(gamesList) { document.getElementById('saved-count-badge').textContent = (gamesList || getAllSavedGames()).length; }

      function renderHistoryModalList() {
        const games = getAllSavedGames(), ongoing = games.filter(g => !g.completed), completed = games.filter(g => g.completed);
        document.getElementById('count-ongoing').textContent = ongoing.length; document.getElementById('count-completed').textContent = completed.length;
        const list = state.historyTab === 'ongoing' ? ongoing : completed; const container = document.getElementById('history-list-container'); container.innerHTML = '';
        if (list.length === 0) { container.innerHTML = `<div class="text-center py-10 opacity-70"><i class="fa-regular fa-folder-open text-3xl mb-2 block"></i><span>Nenhuma partida encontrada.</span></div>`; return; }
        for (const item of list) {
          const total = item.N * item.N; let filled = 0; item.board.forEach(r => r.forEach(v => { if (v !== '') filled++; }));
          const card = document.createElement('div'); const isCurrent = item.gameId === state.gameId;
          card.className = 'theme-panel-alt p-3.5 rounded-2xl flex flex-wrap items-center justify-between gap-3 border'; card.style.borderColor = isCurrent ? 'var(--accent)' : 'var(--board-border-cell)';
          
          // Data precisa
          const dateObj = new Date(item.updatedAt);
          const fullDateStr = dateObj.toLocaleDateString('pt-BR', {day:'2-digit', month:'2-digit', year:'numeric'}) + ' às ' + dateObj.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit', second:'2-digit'});
          
          // Mini preview do tabuleiro
          let miniBoardHTML = `<div class="grid gap-[1px] bg-gray-500/30 border border-gray-500/30 p-[1px] shrink-0" style="grid-template-columns: repeat(${item.N}, minmax(0, 1fr)); width: 44px; height: 44px; border-radius: 4px;">`;
          for(let mr = 0; mr < item.N; mr++) {
              for(let mc = 0; mc < item.N; mc++) {
                  const hasVal = item.board[mr][mc] !== '';
                  const isGiven = item.initial[mr][mc] !== '';
                  let bgC = 'transparent';
                  if(hasVal) bgC = isGiven ? 'rgba(59, 130, 246, 0.8)' : 'var(--accent)';
                  miniBoardHTML += `<div style="background-color: ${bgC};"></div>`;
              }
          }
          miniBoardHTML += `</div>`;

          card.innerHTML = `
            <div class="flex gap-3 items-center w-full sm:w-auto overflow-hidden">
                ${miniBoardHTML}
                <div class="flex flex-col gap-0.5">
                  <div class="font-extrabold flex items-center gap-2 flex-wrap">
                    <span class="h-name text-blue-600 dark:text-blue-400" title="Nome Personalizado"></span>
                    <span class="h-title"></span>
                    <span class="px-2 py-0.5 rounded text-[10px] btn-accent h-diff"></span>
                    <span class="text-[10px] font-bold opacity-80 h-cur hidden">(Atual)</span>
                  </div>
                  <div class="text-xs opacity-80 font-mono h-desc"></div>
                  <div class="text-[11px] opacity-50 font-mono h-date"></div>
                </div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
                <button type="button" class="px-3 py-1.5 rounded-xl btn-accent font-bold text-xs h-btn-res"></button>
                <button type="button" class="w-8 h-8 rounded-xl bg-red-500/15 text-red-500 hover:bg-red-500 hover:text-white transition flex items-center justify-center h-btn-del">
                    <i class="fa-solid fa-trash-can text-xs pointer-events-none"></i>
                </button>
            </div>
          `;
          
          if(item.gameName) {
              card.querySelector('.h-name').textContent = item.gameName;
          } else {
              card.querySelector('.h-name').classList.add('hidden');
          }
          card.querySelector('.h-title').textContent = `Grade ${item.N}×${item.N}`;
          card.querySelector('.h-diff').textContent = DIFFICULTY_LABELS[item.difficulty] || item.difficulty;
          if (isCurrent) card.querySelector('.h-cur').classList.remove('hidden');
          card.querySelector('.h-desc').textContent = `Int. [${item.symbols[0]}..${item.symbols[item.symbols.length - 1]}] • Tempo: ${formatTime(item.timerSeconds)} • Progresso: ${Math.floor((filled / total) * 100)}%`;
          card.querySelector('.h-date').textContent = fullDateStr;
          card.querySelector('.h-btn-res').textContent = item.completed ? 'Visualizar' : 'Retomar';
          card.querySelector('.h-btn-res').addEventListener('click', () => { loadSavedGameRecord(item); closeModal('modal-history'); showToast('Partida restaurada!', 'success'); });
          card.querySelector('.h-btn-del').addEventListener('click', () => { const updated = getAllSavedGames().filter(g => g.gameId !== item.gameId); safeStorageSet(STORAGE_KEYS.SAVED_GAMES, JSON.stringify(updated)); updateSavedBadgeCount(updated); renderHistoryModalList(); });
          container.appendChild(card);
        }
      }
