'use strict';

      function renderSudokuBoard() {
        const gridEl = document.getElementById('sudoku-grid'); gridEl.innerHTML = '';
        const { N, blockR, blockC } = state;
        gridEl.style.gridTemplateColumns = `repeat(${N}, minmax(0, 1fr))`;
        gridEl.style.gridTemplateRows = `repeat(${N}, minmax(0, 1fr))`;
        const maxSymbolLen = Math.max(1, ...state.symbols.map(s => String(s).length));
        const gridWidth = gridEl.clientWidth || gridEl.getBoundingClientRect().width || 560;
        const cellWidth = gridWidth / Math.max(1, N);
        const widthFactor = maxSymbolLen >= 3 ? 0.34 : (maxSymbolLen === 2 ? 0.43 : 0.58);
        const mainFontPx = Math.max(6, Math.min(N <= 9 ? 27 : 22, cellWidth * widthFactor));
        const mainFontSize = `${mainFontPx.toFixed(2)}px`;
        const noteCols = Math.ceil(Math.sqrt(N)), noteRows = Math.ceil(N / noteCols);
        let noteFontSize = (N > 9 || maxSymbolLen >= 2) ? 'clamp(0.36rem, 0.85vw, 0.52rem)' : 'clamp(0.45rem, 1.15vw, 0.65rem)';
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

      function updateCellPencilDOM(r, c) {
        const pencilEl = document.getElementById(`pencil-${r}-${c}`);
        if (!pencilEl) return;
        const val = state.board[r][c], noteSet = state.notes[r][c];
        pencilEl.innerHTML = '';
        if (val !== '' || !noteSet || noteSet.size === 0) return;
        const totalSyms = Math.max(1, state.symbols.length - 1);
        state.symbols.forEach((sym, idx) => {
          if (!noteSet.has(sym)) return;
          const span = document.createElement('span'); span.className = 'pencil-note'; span.dataset.sym = sym;
          span.style.setProperty('--note-hue', String(Math.round((idx / totalSyms) * 330)));
          span.textContent = sym;
          if (state.highlightedSymbol !== null && state.highlightedSymbol === sym) span.classList.add('is-note-highlighted');
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
