'use strict';

      function renderSudokuBoard() {
        const gridEl = document.getElementById('sudoku-grid'); gridEl.innerHTML = '';
        const { N, blockR, blockC } = state;
        const viewportEl = document.getElementById('sudoku-board-viewport');
        const availableWidth = (viewportEl && viewportEl.clientWidth) || (gridEl.parentElement && gridEl.parentElement.clientWidth) || 560;
        const focusMode = !!state.boardFocusMode || document.body.classList.contains('board-focus-mode');
        const viewportHeight = Math.max(320, window.innerHeight || 800);
        const heightBudget = focusMode ? Math.max(160, viewportHeight - 24) : Math.max(220, viewportHeight * 0.68);
        const widthBudget = focusMode ? Math.max(160, (window.innerWidth || availableWidth) - 24) : availableWidth;
        const baseWidth = Math.max(1, Math.min(widthBudget, heightBudget, focusMode ? 100000 : 780));
        const zoomFactor = Math.max(0.5, Math.min(5, Number(state.boardZoom) || 1));
        const gridWidth = baseWidth * zoomFactor;
        gridEl.style.width = `${gridWidth}px`;
        gridEl.style.maxWidth = 'none';
        gridEl.style.flex = '0 0 auto';
        gridEl.style.gridTemplateColumns = `repeat(${N}, minmax(0, 1fr))`;
        gridEl.style.gridTemplateRows = `repeat(${N}, minmax(0, 1fr))`;
        const maxSymbolLen = Math.max(1, ...state.symbols.map(s => String(s).length));
        const cellWidth = gridWidth / Math.max(1, N);
        const widthFactor = maxSymbolLen >= 3 ? 0.34 : (maxSymbolLen === 2 ? 0.43 : 0.58);
        const mainFontPx = Math.max(6, Math.min(N <= 9 ? 27 : 22, cellWidth * widthFactor));
        const mainFontSize = `${mainFontPx.toFixed(2)}px`;
        // Candidate layout is based on the symbol count (not a fixed 1..9 assumption),
        // so custom grids and negative/multi-character symbols keep stable note slots.
        const candidateCount = Math.max(1, state.symbols.length);
        const noteCols = Math.ceil(Math.sqrt(candidateCount)), noteRows = Math.ceil(candidateCount / noteCols);
        const noteSlotWidth = cellWidth / Math.max(noteCols, noteRows);
        const noteFontPx = Math.max(2, Math.min(12, noteSlotWidth * (maxSymbolLen > 1 ? 0.62 : 0.72)));
        const noteFontSize = `${noteFontPx.toFixed(2)}px`;
        const rainbowColors = ['#ff0040', '#ff7300', '#ffeb00', '#00e676', '#00e5ff', '#2979ff', '#651fff', '#d500f9'];
        const isRainbow = document.documentElement.getAttribute('data-theme') === 'rainbow';
        for (let r = 0; r < N; r++) {
          for (let c = 0; c < N; c++) {
            const isGiven = state.initial[r][c] !== '';
            const cellDiv = document.createElement('div');
            cellDiv.className = `sudoku-cell ${isGiven ? 'given-cell' : ''}`; cellDiv.dataset.r = r; cellDiv.dataset.c = c;
            cellDiv.style.setProperty('--cell-hue', String(Math.round(((r + c) / Math.max(1, 2 * N - 2)) * 330)));
            if ((c + 1) % blockC === 0 && c < N - 1) cellDiv.style.borderRight = `3px solid ${isRainbow ? rainbowColors[(Math.floor(c / blockC) + Math.floor(r / blockR)) % 8] : 'var(--board-border-block)'}`;
            else if (c === N - 1) cellDiv.style.borderRight = 'none';
            if ((r + 1) % blockR === 0 && r < N - 1) cellDiv.style.borderBottom = `3px solid ${isRainbow ? rainbowColors[(Math.floor(r / blockR) + Math.floor(c / blockC) + 2) % 8] : 'var(--board-border-block)'}`;
            else if (r === N - 1) cellDiv.style.borderBottom = 'none';
            const pencilGrid = document.createElement('div'); pencilGrid.className = 'pencil-grid'; pencilGrid.id = `pencil-${r}-${c}`;
            pencilGrid.style.gridTemplateColumns = `repeat(${noteCols}, minmax(0, 1fr))`; pencilGrid.style.gridTemplateRows = `repeat(${noteRows}, minmax(0, 1fr))`; pencilGrid.style.fontSize = noteFontSize;
            cellDiv.appendChild(pencilGrid);
            const inputEl = document.createElement('input'); inputEl.type = 'text';
            if (isGiven) { inputEl.readOnly = true; inputEl.setAttribute('inputmode', 'none'); }
            else { inputEl.readOnly = false; const modeAttr = state.symbols.some(s => s.startsWith('-')) ? 'decimal' : 'numeric'; inputEl.inputMode = modeAttr; inputEl.setAttribute('inputmode', modeAttr); inputEl.setAttribute('pattern', '[0-9\\-]*'); }
            inputEl.setAttribute('autocomplete', 'off'); inputEl.setAttribute('autocorrect', 'off'); inputEl.setAttribute('autocapitalize', 'off'); inputEl.spellcheck = false;
            inputEl.className = 'sudoku-input'; inputEl.id = `cell-input-${r}-${c}`; inputEl.style.fontSize = mainFontSize; inputEl.value = state.board[r][c]; inputEl.setAttribute('aria-label', `Linha ${r + 1}, Coluna ${c + 1}`);
            cellDiv.addEventListener('click', (e) => { if (e.target !== inputEl) inputEl.focus(); });
            inputEl.addEventListener('focus', () => { handleCellFocus(r, c); if (!isGiven && inputEl.value) setTimeout(() => { try { inputEl.select(); } catch(e){} }, 0); });
            inputEl.addEventListener('click', () => { handleCellFocus(r, c); if (!isGiven && inputEl.value) try { inputEl.select(); } catch(e){} });
            inputEl.addEventListener('keydown', (e) => handleCellKeyDown(e, r, c));
            inputEl.addEventListener('input', (e) => handleCellMobileInput(e, r, c));
            cellDiv.appendChild(inputEl); gridEl.appendChild(cellDiv);
            updateCellPencilDOM(r, c);
          }
        }
        updateAllCellVisuals(); updateProgressUI();
      }

      function setBoardZoom(percent) {
        const clampedPercent = Math.max(50, Math.min(500, Math.round(Number(percent) / 25) * 25));
        state.boardZoom = clampedPercent / 100;
        const slider = document.getElementById('board-zoom');
        const output = document.getElementById('board-zoom-value');
        if (slider) slider.value = String(clampedPercent);
        if (output) output.textContent = `${clampedPercent}%`;
        if (state.board && state.board.length && document.getElementById('sudoku-grid')) renderSudokuBoard();
      }

      function updateCellPencilDOM(r, c) {
        const pencilEl = document.getElementById(`pencil-${r}-${c}`);
        if (!pencilEl) return;
        const val = state.board[r][c], noteSet = state.notes[r][c];
        pencilEl.innerHTML = '';
        if (val !== '' || !noteSet || noteSet.size === 0) return;
        const totalSyms = Math.max(1, state.symbols.length - 1);
        state.symbols.forEach((sym, idx) => {
          const span = document.createElement('span');
          span.className = noteSet.has(sym) ? 'pencil-note' : 'pencil-note pencil-note-empty';
          span.dataset.sym = sym;
          span.style.setProperty('--note-hue', String(Math.round((idx / totalSyms) * 330)));
          span.textContent = noteSet.has(sym) ? sym : '';
          if (noteSet.has(sym) && state.highlightedSymbol !== null && state.highlightedSymbol === sym) span.classList.add('is-note-highlighted');
          pencilEl.appendChild(span);
        });
      }

      function hasDirectPeerConflict(row, col, val) {
        if (val === '') return false;
        const { N, blockR, blockC } = state;
        if (!state.isManualCreating && state.solution[row] && state.solution[row][col] && val !== state.solution[row][col]) return true;
        for (let i = 0; i < N; i++) { if (i !== col && state.board[row][i] === val) return true; if (i !== row && state.board[i][col] === val) return true; }
        const startR = Math.floor(row / blockR) * blockR, startC = Math.floor(col / blockC) * blockC;
        for (let r = startR; r < startR + blockR; r++) for (let c = startC; c < startC + blockC; c++) if ((r !== row || c !== col) && state.board[r][c] === val) return true;
        return false;
      }

      function updateAllCellVisuals() {
        const { N, blockR, blockC, focusedCell, highlightedSymbol, immediateErrorCheck, highlightSameNumbers } = state;
        const focusR = focusedCell ? focusedCell.r : -1, focusC = focusedCell ? focusedCell.c : -1;
        const focusBlockR = focusR >= 0 ? Math.floor(focusR / blockR) : -1, focusBlockC = focusC >= 0 ? Math.floor(focusC / blockC) : -1;
        document.querySelectorAll('#sudoku-grid .sudoku-cell').forEach((cellDiv) => {
          const r = parseInt(cellDiv.dataset.r, 10), c = parseInt(cellDiv.dataset.c, 10), val = state.board[r][c];
          const inputEl = document.getElementById(`cell-input-${r}-${c}`);
          if (inputEl && (!state.typingBuffer || r !== focusR || c !== focusC)) inputEl.value = val;
          const isFocused = (r === focusR && c === focusC), inSameRowOrCol = (r === focusR || c === focusC), inSameBlock = (Math.floor(r / blockR) === focusBlockR && Math.floor(c / blockC) === focusBlockC);
          
          const isSameNumber = highlightSameNumbers && highlightedSymbol !== null && val !== '' && val === highlightedSymbol;
          const isError = state.revealedErrors[r][c] || (immediateErrorCheck && state.initial[r][c] === '' && val !== '' && hasDirectPeerConflict(r, c, val));
          
          cellDiv.classList.toggle('is-focused', isFocused);
          cellDiv.classList.toggle('is-crosshair', (!isFocused && (inSameRowOrCol || inSameBlock)));
          cellDiv.classList.toggle('is-same-number', isSameNumber);
          cellDiv.classList.toggle('is-error', isError);
          const symbolIndex = val === '' ? -1 : state.symbols.indexOf(String(val));
          const symbolHue = symbolIndex >= 0 ? Math.round((symbolIndex / Math.max(1, state.symbols.length - 1)) * 330) : 190;
          cellDiv.style.setProperty('--nasa-symbol-hue', `${symbolHue}deg`);
          cellDiv.classList.toggle('is-nasa-contribution', isNasaContributionCell(r, c));
          
          const pencilEl = document.getElementById(`pencil-${r}-${c}`);
          if (pencilEl) pencilEl.querySelectorAll('.pencil-note').forEach(span => {
            span.classList.toggle('is-note-highlighted', state.notes[r][c].has(span.dataset.sym) && highlightedSymbol === span.dataset.sym);
          });
          
          // Renderiza Avatares Multiplayer (se algum peer clicou recentemente nesta casa)
          const oldContainer = cellDiv.querySelector('.mp-avatars-container');
          if (oldContainer) oldContainer.remove();
          cellDiv.classList.remove('has-mp-cursor');
          
          if (state.multiplayer && state.multiplayer.peers) {
              const now = Date.now();
              const activePeers = Object.values(state.multiplayer.peers).filter(p => p.row === r && p.column === c && (now - p.lastSeen < 60000));
              
              if (activePeers.length > 0) {
                  const avContainer = document.createElement('div');
                  avContainer.className = 'mp-avatars-container';
                  
                  activePeers.forEach(peer => {
                      const av = document.createElement('div');
                      av.className = 'mp-avatar';
                      av.style.backgroundColor = peer.color;
                      av.textContent = peer.name.charAt(0).toUpperCase();
                      avContainer.appendChild(av);
                      
                      cellDiv.classList.add('has-mp-cursor');
                      cellDiv.style.setProperty('--avatar-color', peer.color); // Se houver vários, a borda pega a cor do último, mas as bolinhas ficam emparelhadas.
                  });
                  cellDiv.appendChild(avContainer);
              }
          }

        });
        document.querySelectorAll('#virtual-numpad .numpad-btn').forEach(btn => btn.classList.toggle('active-number-highlight', highlightedSymbol === btn.dataset.sym));
      }

      function handleCellFocus(r, c) {
        if (state.focusedCell.r !== r || state.focusedCell.c !== c) clearTypingBuffer();
        state.focusedCell = { r, c }; state.highlightedSymbol = state.board[r][c] !== '' ? state.board[r][c] : null; updateAllCellVisuals();
        // Emite evento leve de foco para os avatares multiplayer
        if (state.multiplayer.active && state.multiplayer.roomId) {
            pushMoveToFirebase('FOCUS', r, c, '');
        }
      }


/* v6.1: shared/local NASA attribution helpers and app-level board focus mode. */
function ensureNasaContributionGrid() {
    if (!Array.isArray(state.nasaContributions) || state.nasaContributions.length !== state.N || state.nasaContributions.some(row => !Array.isArray(row) || row.length !== state.N)) {
        const previous = state.nasaContributions;
        state.nasaContributions = Array.from({ length: state.N }, (_, r) => Array.from({ length: state.N }, (_, c) => !!(previous && previous[r] && previous[r][c])));
    }
    return state.nasaContributions;
}

function isNASAContributionEntry(entry) {
    return !!entry && (entry.kind === 'NASA' || entry.action === 'NASA' || entry.playerId === 'NASA' || entry.playerName === 'NASA');
}

function isNasaContributionCell(row, column) {
    ensureNasaContributionGrid();
    if (state.multiplayer && state.multiplayer.active) {
        const contributions = state.multiplayer.contributions || {};
        const key = `${row}_${column}`;
        if (Object.prototype.hasOwnProperty.call(contributions, key)) return isNASAContributionEntry(contributions[key]);
    }
    return !!state.nasaContributions[row][column];
}

function setNasaContributionCell(row, column, isNASA) {
    ensureNasaContributionGrid();
    if (row < 0 || column < 0 || row >= state.N || column >= state.N) return;
    state.nasaContributions[row][column] = !!isNASA;
    const cell = document.querySelector(`#sudoku-grid .sudoku-cell[data-r="${row}"][data-c="${column}"]`);
    if (cell) {
        const value = state.board[row][column];
        const index = value === '' ? -1 : state.symbols.indexOf(String(value));
        cell.style.setProperty('--nasa-symbol-hue', `${index >= 0 ? Math.round(index / Math.max(1, state.symbols.length - 1) * 330) : 190}deg`);
        cell.classList.toggle('is-nasa-contribution', isNasaContributionCell(row, column));
    }
}

function getNasaContributionStats() {
    ensureNasaContributionGrid();
    let nasaOwnedCells = 0;
    let editableFilled = 0;
    for (let r = 0; r < state.N; r++) for (let c = 0; c < state.N; c++) {
        if (state.initial && state.initial[r] && state.initial[r][c] !== '') continue;
        if (state.board && state.board[r] && state.board[r][c] !== '') {
            editableFilled++;
            if (isNasaContributionCell(r, c)) nasaOwnedCells++;
        }
    }
    // Count NASA calls/actions cumulatively. Cell color ownership remains a separate, current-board property.
    // For legacy v6.0 saves that have no counter, fall back to the NASA cells that were saved.
    const currentNasaCellCount = nasaOwnedCells;
    const callCount = Math.max(0, Number.isFinite(Number(state.nasaCalls)) ? Number(state.nasaCalls) : 0) || currentNasaCellCount;
    const humanFilledCells = Math.max(0, editableFilled - currentNasaCellCount);
    const totalContributions = humanFilledCells + callCount;
    return { count: callCount, cells: currentNasaCellCount, total: totalContributions, percent: totalContributions ? Math.round(callCount / totalContributions * 100) : 0 };
}

function updateNasaContributionSummary() {
    const container = document.getElementById('nasa-contribution-summary');
    const countEl = document.getElementById('nasa-contribution-count');
    const percentEl = document.getElementById('nasa-contribution-percent');
    if (!container || !countEl || !percentEl) return;
    const stats = getNasaContributionStats();
    countEl.textContent = String(stats.count);
    percentEl.textContent = `${stats.percent}%`;
    container.setAttribute('aria-label', `Número de chamadas da NASA ${stats.count}; ${stats.percent} por cento das contribuições contabilizadas.`);
}

async function toggleBoardFocusMode(force) {
    const enable = typeof force === 'boolean' ? force : !state.boardFocusMode;
    if (enable === !!state.boardFocusMode) return;
    const exitButton = document.getElementById('btn-exit-board-focus');
    if (enable) {
        state.boardZoomBeforeFocus = Number(state.boardZoom) || 1;
        state.boardZoom = 1;
        const zoomSlider = document.getElementById('board-zoom');
        const zoomOutput = document.getElementById('board-zoom-value');
        if (zoomSlider) zoomSlider.value = '100';
        if (zoomOutput) zoomOutput.textContent = '100%';
        state.boardFocusMode = true;
        document.body.classList.add('board-focus-mode');
        if (exitButton) exitButton.classList.remove('hidden');
        renderSudokuBoard();
        const active = document.activeElement;
        if (active && typeof active.blur === 'function') active.blur();
        try {
            if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
        } catch (error) {
            // Browser policy may refuse native fullscreen; the app-level focus mode remains usable.
            console.info('Tela cheia do navegador indisponível; usando modo de foco da aplicação.', error);
        }
        renderSudokuBoard();
        showToast('Modo de foco ativado. Use o botão no canto ou Esc para restaurar a interface.', 'info');
    } else {
        state.boardFocusMode = false;
        document.body.classList.remove('board-focus-mode');
        if (exitButton) exitButton.classList.add('hidden');
        const restoreZoom = Math.round((Number(state.boardZoomBeforeFocus) || 1) * 100);
        state.boardZoomBeforeFocus = null;
        state.boardZoom = Math.max(0.5, Math.min(5, restoreZoom / 100));
        const slider = document.getElementById('board-zoom');
        const output = document.getElementById('board-zoom-value');
        if (slider) slider.value = String(restoreZoom);
        if (output) output.textContent = `${restoreZoom}%`;
        if (document.fullscreenElement && document.exitFullscreen) {
            try { await document.exitFullscreen(); } catch (error) { console.info('O navegador não permitiu sair da tela cheia automaticamente.', error); }
        }
        renderSudokuBoard();
        showToast('Interface restaurada.', 'success');
    }
}
