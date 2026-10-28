'use strict';

      function clearTypingBuffer() { state.typingBuffer = ''; if (state.typingTimeout) { clearTimeout(state.typingTimeout); state.typingTimeout = null; } }

      function handleCellKeyDown(e, r, c) {
        if (e.key === 'ArrowUp') { e.preventDefault(); focusCellByCoords((r - 1 + state.N) % state.N, c); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); focusCellByCoords((r + 1) % state.N, c); return; }
        if (e.key === 'ArrowLeft') { e.preventDefault(); focusCellByCoords(r, (c - 1 + state.N) % state.N); return; }
        if (e.key === 'ArrowRight') { e.preventDefault(); focusCellByCoords(r, (c + 1) % state.N); return; }
        if (e.key === 'n' || e.key === 'N') { e.preventDefault(); togglePencilMode(); return; }
        if (state.initial[r][c] !== '') { e.preventDefault(); return; }
        if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); clearTypingBuffer(); eraseCell(r, c); return; }
        if (e.key === '-' || (e.key >= '0' && e.key <= '9')) { e.preventDefault(); state.lastKeydownTimestamp = Date.now(); processTypedChar(r, c, e.key); }
      }

      function handleCellMobileInput(e, r, c) {
        const inputEl = document.getElementById(`cell-input-${r}-${c}`);
        if (state.completed || state.initial[r][c] !== '') { if (inputEl) inputEl.value = state.board[r][c]; return; }
        if (state.lastKeydownTimestamp && (Date.now() - state.lastKeydownTimestamp < 45)) { if (inputEl && !state.typingBuffer) inputEl.value = state.board[r][c]; return; }
        if (e.inputType === 'deleteContentBackward' || e.inputType === 'deleteContentForward') { clearTypingBuffer(); eraseCell(r, c); return; }
        let typedData = e.data || (inputEl ? inputEl.value : '');
        if (!typedData) { clearTypingBuffer(); eraseCell(r, c); return; }
        const cleanChars = String(typedData).replace(/[^0-9\-]/g, '');
        if (!cleanChars) { if (inputEl) inputEl.value = state.board[r][c]; return; }
        for (const ch of cleanChars) processTypedChar(r, c, ch);
        if (inputEl && !state.typingBuffer) inputEl.value = state.board[r][c];
      }

      function processTypedChar(r, c, char) {
        if (state.completed || state.initial[r][c] !== '') return;
        const candidateBuffer = state.typingBuffer + char;
        const exactMatch = state.symbols.includes(candidateBuffer);
        const hasLongerPrefixMatch = state.symbols.some(s => s.startsWith(candidateBuffer) && s.length > candidateBuffer.length);
        if (exactMatch && !hasLongerPrefixMatch) { clearTypingBuffer(); applySymbolToCell(r, c, candidateBuffer); return; }
        if (hasLongerPrefixMatch) {
          state.typingBuffer = candidateBuffer;
          const inputEl = document.getElementById(`cell-input-${r}-${c}`);
          if (inputEl && !state.pencilMode) inputEl.value = candidateBuffer;
          if (state.typingTimeout) clearTimeout(state.typingTimeout);
          state.typingTimeout = setTimeout(() => {
            const finalBuf = state.typingBuffer; clearTypingBuffer();
            if (state.symbols.includes(finalBuf)) applySymbolToCell(r, c, finalBuf); else updateAllCellVisuals();
          }, 480);
          return;
        }
        clearTypingBuffer();
        if (char === '-' && state.symbols.some(s => s.startsWith('-'))) processTypedChar(r, c, '-');
        else if (state.symbols.includes(char)) applySymbolToCell(r, c, char);
      }

      function focusCellByCoords(r, c) { const inputEl = document.getElementById(`cell-input-${r}-${c}`); if (inputEl) { inputEl.focus(); handleCellFocus(r, c); } }

      function applySymbolToCell(r, c, symbol) {
        if (state.completed || state.initial[r][c] !== '' || !state.symbols.includes(symbol)) return;
        state.revealedErrors[r][c] = false;
        if (state.pencilMode) {
          if (state.board[r][c] !== '') {
            state.board[r][c] = '';
            setNasaContributionCell(r, c, false);
            // Removing a filled cell is a real board move and remains shared in both room modes.
            pushMoveToFirebase('ERASE', r, c, '');
          }
          if (state.notes[r][c].has(symbol)) state.notes[r][c].delete(symbol);
          else state.notes[r][c].add(symbol);
          // Pencil marks are collaborative in Prosa e Cafézin, but private in Rinha de Galo.
          if (!state.multiplayer.active || !state.multiplayer.roomId || state.multiplayer.roomMode !== 'versus') {
            pushMoveToFirebase('NOTE', r, c, symbol);
          }
          state.highlightedSymbol = symbol; updateCellPencilDOM(r, c);
        } else {
          if (state.board[r][c] === symbol) { 
            state.board[r][c] = ''; state.highlightedSymbol = null; setNasaContributionCell(r, c, false);
            pushMoveToFirebase('ERASE', r, c, '');
          }
          else { 
            state.board[r][c] = symbol; state.notes[r][c].clear(); state.highlightedSymbol = symbol; setNasaContributionCell(r, c, false); removeAutoNotesPeers(r, c, symbol); 
            pushMoveToFirebase('SET', r, c, symbol);
          }
          updateCellPencilDOM(r, c);
        }
        updateAllCellVisuals(); updateProgressUI(); saveCurrentGameState();
      }

      function removeAutoNotesPeers(row, col, symbol) {
        const { N, blockR, blockC } = state, startR = Math.floor(row / blockR) * blockR, startC = Math.floor(col / blockC) * blockC;
        for (let i = 0; i < N; i++) {
          if (state.notes[row][i].delete(symbol)) updateCellPencilDOM(row, i);
          if (state.notes[i][col].delete(symbol)) updateCellPencilDOM(i, col);
        }
        for (let r = startR; r < startR + blockR; r++) for (let c = startC; c < startC + blockC; c++) if (state.notes[r][c].delete(symbol)) updateCellPencilDOM(r, c);
      }

      function eraseCell(r, c) {
        if (state.completed || state.initial[r][c] !== '') return;
        state.board[r][c] = ''; state.notes[r][c].clear(); state.revealedErrors[r][c] = false; state.highlightedSymbol = null; setNasaContributionCell(r, c, false);
        pushMoveToFirebase('ERASE', r, c, '');
        updateCellPencilDOM(r, c); updateAllCellVisuals(); updateProgressUI(); saveCurrentGameState();
      }

      function giveNasaHint() {
        if (state.isManualCreating) { showToast('A NASA não pode ajudar no modo de criação.', 'warn'); return; }
        if (state.completed) { showToast('O tabuleiro já foi concluído com sucesso!', 'info'); return; }
        const allCandidates = [];
        for (let r = 0; r < state.N; r++) for (let c = 0; c < state.N; c++) {
          if (state.initial[r][c] !== '') continue;
          if (state.board[r][c] === '') allCandidates.push({ r, c, type: 'empty' });
          else if (state.board[r][c] !== state.solution[r][c]) allCandidates.push({ r, c, type: 'wrong' });
        }
        if (allCandidates.length === 0) { showToast('Todas as casas já estão preenchidas corretamente!', 'success'); return; }
        const chosen = allCandidates[Math.floor(Math.random() * allCandidates.length)];
        const correctSymbol = state.solution[chosen.r][chosen.c];
        state.nasaCalls = Math.max(0, Number(state.nasaCalls) || 0) + 1;
        state.board[chosen.r][chosen.c] = correctSymbol; state.notes[chosen.r][chosen.c].clear(); state.revealedErrors[chosen.r][chosen.c] = false; setNasaContributionCell(chosen.r, chosen.c, true);
        state.focusedCell = { r: chosen.r, c: chosen.c }; state.highlightedSymbol = correctSymbol;
        removeAutoNotesPeers(chosen.r, chosen.c, correctSymbol); updateCellPencilDOM(chosen.r, chosen.c); updateAllCellVisuals(); updateProgressUI(); saveCurrentGameState();
        if (state.multiplayer.active && state.multiplayer.roomId) {
          pushMoveToFirebase('NASA', chosen.r, chosen.c, correctSymbol);
          publishRoomBoardState();
        }
        const inputEl = document.getElementById(`cell-input-${chosen.r}-${chosen.c}`);
        if (inputEl && inputEl.parentElement) { inputEl.parentElement.classList.remove('nasa-hint-flash'); void inputEl.parentElement.offsetWidth; inputEl.parentElement.classList.add('nasa-hint-flash'); inputEl.focus(); }
        saveCurrentGameState(); updateNasaContributionSummary();
        showToast(`🪐 A NASA ${chosen.type === 'wrong' ? 'corrigiu' : 'revelou'} a casa (Linha ${chosen.r + 1}, Coluna ${chosen.c + 1}) para ${correctSymbol}! Essa contribuição é da NASA, não de um jogador.`, 'info');
      }

      function togglePencilMode(forceState) {
        state.pencilMode = typeof forceState === 'boolean' ? forceState : !state.pencilMode;
        const btn = document.getElementById('btn-pencil-mode'), badge = document.getElementById('pencil-status-badge');
        if (state.pencilMode) { btn.classList.add('btn-accent'); btn.classList.remove('theme-panel-alt'); badge.textContent = 'ON'; badge.className = 'px-1.5 py-0.5 text-[10px] rounded bg-white/25 font-extrabold'; }
        else { btn.classList.remove('btn-accent'); btn.classList.add('theme-panel-alt'); badge.textContent = 'OFF'; badge.className = 'px-1.5 py-0.5 text-[10px] rounded bg-slate-500/20 font-extrabold'; }
      }

      function renderVirtualNumpad() {
        const container = document.getElementById('virtual-numpad'); container.innerHTML = '';
        document.getElementById('numpad-range-label').textContent = `[${state.symbols[0]} .. ${state.symbols[state.symbols.length - 1]}] (${state.N} núm.)`;
        state.symbols.forEach((sym, idx) => {
          const btn = document.createElement('button'); btn.type = 'button'; btn.dataset.sym = sym;
          btn.className = 'numpad-btn py-2.5 px-2 rounded-xl text-sm sm:text-base shadow-sm';
          btn.style.setProperty('--btn-hue', String(Math.round((idx / Math.max(1, state.symbols.length - 1)) * 330))); btn.textContent = sym;
          btn.addEventListener('mousedown', (e) => e.preventDefault());
          btn.addEventListener('click', () => { if (state.initial[state.focusedCell.r][state.focusedCell.c] !== '') { state.highlightedSymbol = sym; updateAllCellVisuals(); } else { applySymbolToCell(state.focusedCell.r, state.focusedCell.c, sym); } });
          container.appendChild(btn);
        });
      }
