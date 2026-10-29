'use strict';

      function updateProgressUI() {
        let filled = 0; const total = state.N * state.N;
        for (let r = 0; r < state.N; r++) for (let c = 0; c < state.N; c++) if (state.board[r][c] !== '') filled++;
        document.getElementById('progress-badge').textContent = `${filled} / ${total} (${Math.floor((filled / total) * 100)}%)`;
        updateNasaContributionSummary();
        const checkBtn = document.getElementById('btn-check-solution'), checkBtnText = document.getElementById('btn-check-solution-text');
        if (state.isManualCreating) { checkBtn.disabled = true; checkBtnText.textContent = 'Modo de Criação Ativo'; }
        else if (filled === total) { checkBtn.disabled = false; checkBtnText.textContent = 'Conferir Solução Agora!'; }
        else { checkBtn.disabled = true; checkBtnText.textContent = `Conferir Solução (Faltam ${total - filled})`; }
      }

      function checkFullBoardSolution() {
        if (state.isManualCreating) return;
        const { N, blockR, blockC, symbols, initial, solution, board } = state;
        const initialValid = isGridRuleValid(initial, N, blockR, blockC, symbols, false);
        const solutionValid = isGridRuleValid(solution, N, blockR, blockC, symbols, true) && boardPreservesInitial(solution, initial, N);
        if (!initialValid || !solutionValid) {
          showToast('O estado desta partida está inconsistente. Não foi possível conferir a solução.', 'warn');
          return;
        }
        // Não exigimos que a grade concluída seja idêntica à primeira solução encontrada:
        // puzzles manuais/OCR podem legitimamente ter mais de uma solução.
        const rulesValid = isGridRuleValid(board, N, blockR, blockC, symbols, true) && boardPreservesInitial(board, initial, N);
        if (rulesValid) {
          pauseTimer(); state.completed = true; saveCurrentGameState();
          document.getElementById('victory-time').textContent = formatTime(state.timerSeconds);
          document.getElementById('victory-diff').textContent = DIFFICULTY_LABELS[state.difficulty] || state.difficulty;
          document.getElementById('victory-dim').textContent = `${N}×${N} (${blockR}×${blockC})`;
          document.getElementById('victory-range').textContent = `${symbols[0]} a ${symbols[symbols.length - 1]}`;
          updateMultiplayerVictorySummary();
          openModal('modal-victory');
          if (state.multiplayer.active && state.multiplayer.roomId) {
            publishRoomBoardState();
          }
          if (typeof confetti === 'function') confetti({ particleCount: 95, spread: 70, origin: { y: 0.35 }, zIndex: 9999, colors: ['#34d399', '#22d3ee', '#a78bfa', '#f472b6'] });
          return;
        }
        const wrongCoords = [];
        for (let r = 0; r < N; r++) {
          for (let c = 0; c < N; c++) {
            if (initial[r][c] === '' && board[r][c] !== '' && board[r][c] !== solution[r][c]) wrongCoords.push([r, c]);
          }
        }
        document.getElementById('error-count-label').textContent = wrongCoords.length === 1 ? '1 casa incorreta' : `${wrongCoords.length} casas incorretas`;
        openModal('modal-errors-prompt');
      }

      function revealErrorsOnBoard() {
        for (let r = 0; r < state.N; r++) for (let c = 0; c < state.N; c++) if (state.initial[r][c] === '' && state.board[r][c] !== '' && state.board[r][c] !== state.solution[r][c]) state.revealedErrors[r][c] = true;
        updateAllCellVisuals(); saveCurrentGameState(); showToast('As casas com valores incorretos foram destacadas em vermelho.', 'warn');
      }

      function getMonotonicNow() {
        try {
          if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
        } catch (error) { /* fall back on the wall clock in restricted environments */ }
        return Date.now();
      }

      function syncTimerElapsedFromMonotonic() {
        if (!state.timerRunning || state.completed || state.isManualCreating || !Number.isFinite(state.timerLastTick)) return;
        const now = getMonotonicNow();
        const elapsedWholeSeconds = Math.floor(Math.max(0, now - state.timerLastTick) / 1000);
        if (elapsedWholeSeconds <= 0) return;
        const previousSeconds = Math.max(0, Number(state.timerSeconds) || 0);
        state.timerSeconds = Math.min(100000000, previousSeconds + elapsedWholeSeconds);
        state.timerLastTick += elapsedWholeSeconds * 1000;
        const timerDisplay = document.getElementById('timer-display');
        if (timerDisplay) timerDisplay.textContent = formatTime(state.timerSeconds);
        if (Math.floor(previousSeconds / 5) !== Math.floor(state.timerSeconds / 5)) saveCurrentGameState();
      }

      function startTimer() {
        if (state.timerInterval !== null && state.timerInterval !== undefined) clearInterval(state.timerInterval);
        state.timerInterval = null;
        if (state.completed || state.isManualCreating) {
          pauseTimer();
          return;
        }
        state.timerRunning = true;
        state.timerLastTick = getMonotonicNow();
        document.getElementById('pause-overlay').classList.add('hidden');
        document.getElementById('icon-pause-timer').className = 'fa-solid fa-pause text-xs';
        // A monotonic clock avoids accumulating interval-throttling drift in background tabs.
        state.timerInterval = setInterval(syncTimerElapsedFromMonotonic, 250);
      }

      function pauseTimer() {
        syncTimerElapsedFromMonotonic();
        state.timerRunning = false;
        state.timerLastTick = null;
        if (state.timerInterval !== null && state.timerInterval !== undefined) clearInterval(state.timerInterval);
        state.timerInterval = null;
        const pauseIcon = document.getElementById('icon-pause-timer');
        if (pauseIcon) pauseIcon.className = 'fa-solid fa-play text-xs';
      }
      function togglePauseGame() { if (state.completed) return; if (state.timerRunning) { pauseTimer(); document.getElementById('pause-overlay').classList.remove('hidden'); } else startTimer(); }

      function startNewGame(customConfig = null) {
        if (state.multiplayer.active && state.multiplayer.roomId) { showToast('Saia da sala multiplayer antes de iniciar uma partida local.', 'warn'); return; }
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
        state.nasaContributions = Array.from({ length: N }, () => Array(N).fill(false));
        state.nasaCalls = 0;
        state.revealedErrors = Array.from({ length: N }, () => Array(N).fill(false));
        state.focusedCell = { r: 0, c: 0 }; state.highlightedSymbol = null; state.timerSeconds = 0; state.completed = false; state.isManualCreating = false;
        const mcBar = document.getElementById('manual-create-bar'); if (mcBar) { mcBar.classList.remove('flex'); mcBar.classList.add('hidden'); }
        updateDifficultyCluesUI(state.N); updateHeaderSubtitle(); document.getElementById('timer-display').textContent = '00:00';
        renderVirtualNumpad(); renderSudokuBoard(); startTimer(); saveCurrentGameState();
      }

      function updateHeaderSubtitle() { document.getElementById('subtitle-mode-info').textContent = `Grade ${state.N}×${state.N} • Blocos ${state.blockR}×${state.blockC} • Intervalo [${state.symbols[0]} a ${state.symbols[state.symbols.length - 1]}] • ${DIFFICULTY_LABELS[state.difficulty] || '🛸Suave na Nave👽'}`; }


/* v6.0: replay the exact same puzzle, including when hosted in a room */
function replayCurrentGame() {
    if (!Array.isArray(state.initial) || !state.initial.length) return;
    if (state.multiplayer.active && state.multiplayer.roomId && !confirm('Reiniciar esta instância vai limpar as respostas e notas compartilhadas de toda a sala. Deseja continuar?')) return;
    state.board = state.initial.map(row => row.map(value => value == null ? '' : String(value)));
    state.notes = Array.from({ length: state.N }, () => Array.from({ length: state.N }, () => new Set()));
    state.nasaContributions = Array.from({ length: state.N }, () => Array(state.N).fill(false));
    state.nasaCalls = 0;
    state.revealedErrors = Array.from({ length: state.N }, () => Array(state.N).fill(false));
    state.focusedCell = { r: 0, c: 0 };
    state.highlightedSymbol = null;
    state.timerSeconds = 0;
    state.completed = false;
    state.pencilMode = false;
    togglePencilMode(false);
    document.getElementById('timer-display').textContent = '00:00';
    closeModal('modal-victory');
    renderVirtualNumpad();
    renderSudokuBoard();
    startTimer();
    saveCurrentGameState();
    if (state.multiplayer.active && state.multiplayer.roomId) {
        const fb = getFirebaseAPI();
        if (fb) {
            const roomRef = fb.ref(fb.db, roomPath(state.multiplayer.roomId));
            state.multiplayer.contributions = {};
            state.multiplayer.cellContributions = {};
            state.multiplayer.hasSharedNasaCounter = true;
            const resetPatch = {
                boardState: serializeCurrentRoomBoard(state.multiplayer.instanceCount),
                contributions: {},
                moves: {}
            };
            fb.update(roomRef, resetPatch).catch(error => {
                console.error(error);
                showToast('O tabuleiro reiniciou localmente, mas a sincronização da sala falhou.', 'warn');
            });
            renderMultiplayerSidebar();
        }
    }
    showToast('Mesma instância reiniciada! As pistas originais continuam iguais. Bora de novo!', 'success');
}

function updateMultiplayerVictorySummary() {
    updateNasaContributionSummary();
    const banner = document.getElementById('multiplayer-victory-banner');
    if (!banner) return;
    if (!state.multiplayer.active || !state.multiplayer.roomId) {
        banner.classList.add('hidden');
        return;
    }
    banner.classList.remove('hidden');
    const title = document.getElementById('multiplayer-victory-title');
    const message = document.getElementById('multiplayer-victory-message');
    const metrics = document.getElementById('multiplayer-victory-metrics');
    const stats = computeContributionStats();
    metrics.innerHTML = '';
    if (state.multiplayer.roomMode !== 'versus') {
        title.textContent = '☕ Prosa boa, equipe melhor!';
        message.textContent = 'Parabéns, turma! Vocês fecharam o Sudoku juntos — cada jogada ajudou a chegar até aqui.';
    } else {
        const top = stats.length ? stats[0].count : 0;
        const winners = stats.filter(item => item.count === top);
        if (top === 0 || winners.length === stats.length) {
            title.textContent = '⚔️ Rinha encerrada — empate!';
            message.textContent = 'Ninguém ficou na frente em casas atribuídas. Vitória da resenha!';
        } else if (winners.length > 1) {
            title.textContent = '⚔️ Deu empate na Rinha!';
            message.textContent = `Parabéns a ${winners.map(item => item.name).join(', ')}: empate no primeiro lugar com ${top} casa(s) atribuída(s)!`;
        } else {
            title.textContent = `🏆 ${winners[0].name} venceu a Rinha de Galo!`;
            message.textContent = `Parabéns, ${winners[0].name}, pela maior contribuição: ${top} casa(s). E parabéns à sala por terminar o desafio!`;
        }
    }
    if (!stats.length) {
        const empty = document.createElement('p'); empty.className = 'opacity-75'; empty.textContent = 'Ainda não há contribuições atribuídas para calcular.'; metrics.appendChild(empty);
        return;
    }
    stats.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'flex items-center justify-between gap-3 rounded-lg px-2 py-1 theme-panel';
        const name = document.createElement('span'); name.className = 'truncate'; name.textContent = `${index === 0 && item.count > 0 ? '🥇 ' : ''}${item.name}`;
        const amount = document.createElement('strong'); amount.className = 'font-mono shrink-0'; amount.textContent = `${item.count} casa(s) · ${item.percent}%`;
        row.append(name, amount); metrics.appendChild(row);
    });
    const nasaStats = getNasaContributionStats();
    const nasaRow = document.createElement('div');
    nasaRow.className = 'flex items-center justify-between gap-3 rounded-lg px-2 py-1 border border-cyan-400/40';
    const nasaName = document.createElement('span'); nasaName.className = 'truncate'; nasaName.textContent = '🪐 NASA';
    const nasaAmount = document.createElement('strong'); nasaAmount.className = 'font-mono shrink-0'; nasaAmount.textContent = `${nasaStats.count} chamada(s) · ${nasaStats.percent}%`;
    nasaRow.append(nasaName, nasaAmount); metrics.appendChild(nasaRow);
}
