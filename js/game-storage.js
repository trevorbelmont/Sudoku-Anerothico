'use strict';

function getAllSavedGames() { try { const raw = localStorage.getItem(STORAGE_KEYS.SAVED_GAMES); if (!raw) return []; const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed.filter(g => validateGameState(g) !== null) : []; } catch (e) { return []; } }
      function saveCurrentGameState() {
        if (!state.gameId) return;
        try {
          const games = getAllSavedGames();
          const record = {
            gameId: state.gameId, updatedAt: Date.now(), mode: state.mode, difficulty: state.difficulty,
            minVal: state.minVal, maxVal: state.maxVal, includeZero: state.includeZero, symbols: state.symbols,
            N: state.N, blockR: state.blockR, blockC: state.blockC, solution: state.solution, initial: state.initial,
            board: state.board, notes: state.notes.map(row => row.map(set => Array.from(set))), revealedErrors: state.revealedErrors,
            nasaContributions: (ensureNasaContributionGrid(), state.nasaContributions.map(row => row.slice())),
            nasaCalls: Math.max(0, Number(state.nasaCalls) || 0),
            timerSeconds: state.timerSeconds, completed: state.completed, gameName: state.gameName
          };
          const existingIdx = games.findIndex(g => g.gameId === state.gameId);
          if (existingIdx >= 0) games[existingIdx] = record; else games.unshift(record);
          const trimmed = games.slice(0, 35);
          localStorage.setItem(STORAGE_KEYS.SAVED_GAMES, JSON.stringify(trimmed));
          localStorage.setItem(STORAGE_KEYS.CURRENT_GAME_ID, state.gameId);
          updateSavedBadgeCount(trimmed);
        } catch (e) {}
      }
      function loadSavedGameRecord(record) {
        if (!record) return;
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
        state.timerSeconds = record.timerSeconds || 0; state.completed = !!record.completed; state.isManualCreating = false;
        const mcBarLoad = document.getElementById('manual-create-bar'); if (mcBarLoad) { mcBarLoad.classList.remove('flex'); mcBarLoad.classList.add('hidden'); }
        state.focusedCell = { r: 0, c: 0 }; state.highlightedSymbol = null;
        syncModeTabsUI(); updateHeaderSubtitle(); document.getElementById('timer-display').textContent = formatTime(state.timerSeconds);
        renderVirtualNumpad(); renderSudokuBoard(); updateNasaContributionSummary();
        if (state.completed) pauseTimer(); else startTimer();
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
          card.querySelector('.h-btn-del').addEventListener('click', () => { const updated = getAllSavedGames().filter(g => g.gameId !== item.gameId); localStorage.setItem(STORAGE_KEYS.SAVED_GAMES, JSON.stringify(updated)); updateSavedBadgeCount(updated); renderHistoryModalList(); });
          container.appendChild(card);
        }
      }
