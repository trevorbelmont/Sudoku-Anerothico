'use strict';

      function updateProgressUI() {
        let filled = 0; const total = state.N * state.N;
        for (let r = 0; r < state.N; r++) for (let c = 0; c < state.N; c++) if (state.board[r][c] !== '') filled++;
        document.getElementById('progress-badge').textContent = `${filled} / ${total} (${Math.floor((filled / total) * 100)}%)`;
        const checkBtn = document.getElementById('btn-check-solution'), checkBtnText = document.getElementById('btn-check-solution-text');
        if (state.isManualCreating) { checkBtn.disabled = true; checkBtnText.textContent = 'Modo de Criação Ativo'; }
        else if (filled === total) { checkBtn.disabled = false; checkBtnText.textContent = 'Conferir Solução Agora!'; }
        else { checkBtn.disabled = true; checkBtnText.textContent = `Conferir Solução (Faltam ${total - filled})`; }
      }

      function checkFullBoardSolution() {
        if (state.isManualCreating) return;
        const { N, blockR, blockC } = state; const wrongCoords = []; let rulesValid = true;
        for (let r = 0; r < N; r++) {
          const rowSet = new Set(), colSet = new Set();
          for (let c = 0; c < N; c++) { rowSet.add(state.board[r][c]); colSet.add(state.board[c][r]); }
          if (rowSet.size !== N || colSet.size !== N) rulesValid = false;
        }
        for (let br = 0; br < N; br += blockR) for (let bc = 0; bc < N; bc += blockC) {
          const blkSet = new Set();
          for (let r = br; r < br + blockR; r++) for (let c = bc; c < bc + blockC; c++) blkSet.add(state.board[r][c]);
          if (blkSet.size !== N) rulesValid = false;
        }
        if (rulesValid) {
          pauseTimer(); state.completed = true; saveCurrentGameState();
          document.getElementById('victory-time').textContent = formatTime(state.timerSeconds);
          document.getElementById('victory-diff').textContent = DIFFICULTY_LABELS[state.difficulty] || state.difficulty;
          document.getElementById('victory-dim').textContent = `${N}×${N} (${blockR}×${blockC})`;
          document.getElementById('victory-range').textContent = `${state.symbols[0]} a ${state.symbols[state.symbols.length - 1]}`;
          openModal('modal-victory'); return;
        }
        for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (state.initial[r][c] === '' && state.board[r][c] !== state.solution[r][c]) wrongCoords.push([r, c]);
        document.getElementById('error-count-label').textContent = wrongCoords.length === 1 ? '1 casa incorreta' : `${wrongCoords.length} casas incorretas`;
        openModal('modal-errors-prompt');
      }

      function revealErrorsOnBoard() {
        for (let r = 0; r < state.N; r++) for (let c = 0; c < state.N; c++) if (state.initial[r][c] === '' && state.board[r][c] !== '' && state.board[r][c] !== state.solution[r][c]) state.revealedErrors[r][c] = true;
        updateAllCellVisuals(); saveCurrentGameState(); showToast('As casas com valores incorretos foram destacadas em vermelho.', 'warn');
      }

      function startTimer() {
        if (state.timerInterval) clearInterval(state.timerInterval); state.timerRunning = true;
        document.getElementById('pause-overlay').classList.add('hidden'); document.getElementById('icon-pause-timer').className = 'fa-solid fa-pause text-xs';
        state.timerInterval = setInterval(() => {
          if (!state.timerRunning || state.completed) return;
          state.timerSeconds++; document.getElementById('timer-display').textContent = formatTime(state.timerSeconds);
          if (state.timerSeconds % 5 === 0) saveCurrentGameState();
        }, 1000);
      }
      function pauseTimer() { state.timerRunning = false; document.getElementById('icon-pause-timer').className = 'fa-solid fa-play text-xs'; }
      function togglePauseGame() { if (state.completed) return; if (state.timerRunning) { pauseTimer(); document.getElementById('pause-overlay').classList.remove('hidden'); } else startTimer(); }

      function startNewGame(customConfig = null) {
        let N = 9, blockR = 3, blockC = 3, minVal = 1, maxVal = 9, includeZero = false, symbols = buildSymbolsFromRange(1, 9, false);
        if (state.mode === 'custom') {
          const cfg = customConfig || updateCustomRangePreview();
          if (!cfg) { showToast('Ajuste o intervalo.', 'warn'); return; }
          ({ minVal, maxVal, includeZero, symbols, N, blockR, blockC } = cfg);
        }
        const { solution, initial } = createUniqueSudokuPuzzle(N, blockR, blockC, symbols, state.difficulty);
        state.gameId = 'game_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        state.gameName = ''; document.getElementById('game-name-input').value = '';
        state.minVal = minVal; state.maxVal = maxVal; state.includeZero = includeZero; state.symbols = symbols; state.N = N; state.blockR = blockR; state.blockC = blockC;
        state.solution = solution; state.initial = initial; state.board = initial.map(row => row.slice());
        state.notes = Array.from({ length: N }, () => Array.from({ length: N }, () => new Set()));
        state.revealedErrors = Array.from({ length: N }, () => Array(N).fill(false));
        state.focusedCell = { r: 0, c: 0 }; state.highlightedSymbol = null; state.timerSeconds = 0; state.completed = false; state.isManualCreating = false;
        const mcBar = document.getElementById('manual-create-bar'); if (mcBar) { mcBar.classList.remove('flex'); mcBar.classList.add('hidden'); }
        updateDifficultyCluesUI(state.N); updateHeaderSubtitle(); document.getElementById('timer-display').textContent = '00:00';
        renderVirtualNumpad(); renderSudokuBoard(); startTimer(); saveCurrentGameState();
      }

      function updateHeaderSubtitle() { document.getElementById('subtitle-mode-info').textContent = `Grade ${state.N}×${state.N} • Blocos ${state.blockR}×${state.blockC} • Intervalo [${state.symbols[0]} a ${state.symbols[state.symbols.length - 1]}] • ${DIFFICULTY_LABELS[state.difficulty] || '🛸Suave na Nave👽'}`; }
