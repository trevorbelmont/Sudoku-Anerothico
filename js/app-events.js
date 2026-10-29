'use strict';

function initEventListeners() {
        document.getElementById('theme-selector').addEventListener('change', (e) => applyTheme(e.target.value));
        const header = document.getElementById('main-app-header');
        const headerToggle = document.getElementById('btn-toggle-header');
        const setHeaderCollapsed = (collapsed) => {
          header.dataset.headerCollapsed = collapsed ? 'true' : 'false';
          headerToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
          headerToggle.setAttribute('aria-label', collapsed ? 'Expandir cabeçalho' : 'Recolher cabeçalho');
          document.getElementById('header-toggle-label').textContent = collapsed ? 'Expandir cabeçalho' : 'Recolher cabeçalho';
          document.getElementById('header-toggle-icon').className = `fa-solid ${collapsed ? 'fa-chevron-down' : 'fa-chevron-up'} text-xs`;
          safeStorageSet('sudoku_anerothico_header_collapsed_v1', collapsed ? 'true' : 'false');
        };
        let savedHeaderState = false;
        savedHeaderState = safeStorageGet('sudoku_anerothico_header_collapsed_v1') === 'true';
        setHeaderCollapsed(savedHeaderState);
        headerToggle.addEventListener('click', () => setHeaderCollapsed(header.dataset.headerCollapsed !== 'true'));

        const zoomSlider = document.getElementById('board-zoom');
        zoomSlider.addEventListener('input', (e) => setBoardZoom(Number(e.target.value)));
        document.getElementById('btn-board-zoom-out').addEventListener('click', () => setBoardZoom(Number(zoomSlider.value) - 25));
        document.getElementById('btn-board-zoom-in').addEventListener('click', () => setBoardZoom(Number(zoomSlider.value) + 25));
        document.getElementById('btn-board-zoom-reset').addEventListener('click', () => setBoardZoom(100));
        document.getElementById('btn-board-focus').addEventListener('click', () => toggleBoardFocusMode(true));
        document.getElementById('btn-exit-board-focus').addEventListener('click', () => toggleBoardFocusMode(false));
        let lastBoardViewportWidth = document.getElementById('sudoku-board-viewport').clientWidth;
        let lastBoardViewportHeight = window.innerHeight;
        window.addEventListener('resize', () => {
          const viewportWidth = document.getElementById('sudoku-board-viewport').clientWidth;
          const viewportHeight = window.innerHeight;
          if ((viewportWidth > 0 && Math.abs(viewportWidth - lastBoardViewportWidth) > 2) || Math.abs(viewportHeight - lastBoardViewportHeight) > 80) {
            lastBoardViewportWidth = viewportWidth;
            lastBoardViewportHeight = viewportHeight;
            if (state.board && state.board.length) renderSudokuBoard();
          }
        });
        document.getElementById('game-name-input').addEventListener('input', (e) => { state.gameName = e.target.value; saveCurrentGameState(); if (state.multiplayer.active && state.multiplayer.roomId) { const fb = getFirebaseAPI(); if (fb) fb.update(fb.ref(fb.db, roomPath(state.multiplayer.roomId, 'boardState')), { gameName: state.gameName, lastUpdatedByPlayerId: state.multiplayer.playerId, updatedAtTimestamp: Date.now() }).catch(() => {}); } });
        document.getElementById('tab-mode-standard').addEventListener('click', () => { state.mode = 'standard'; syncModeTabsUI(); });
        document.getElementById('tab-mode-custom').addEventListener('click', () => { state.mode = 'custom'; syncModeTabsUI(); });
        ['custom-min-input', 'custom-max-input', 'custom-include-zero'].forEach(id => { document.getElementById(id).addEventListener('input', updateCustomRangePreview); document.getElementById(id).addEventListener('change', updateCustomRangePreview); });
        document.querySelectorAll('.preset-range-btn').forEach(btn => btn.addEventListener('click', () => { const [minS, maxS, zeroS] = btn.dataset.preset.split(','); document.getElementById('custom-min-input').value = minS; document.getElementById('custom-max-input').value = maxS; document.getElementById('custom-include-zero').checked = (zeroS === '1'); updateCustomRangePreview(); }));
        document.querySelectorAll('.diff-btn').forEach(btn => btn.addEventListener('click', () => { state.difficulty = btn.dataset.diff; syncDifficultyButtonsUI(); }));
        document.getElementById('btn-new-game').addEventListener('click', () => { 
            if (state.multiplayer.active && state.multiplayer.roomId) {
                // Modo Multiplayer: Pede permissão para a sala
                requestNewGameConsensus();
            } else {
                startNewGame(); 
                showToast(`Novo Sudoku (${DIFFICULTY_LABELS[state.difficulty]}) gerado!`, 'info'); 
            }
        });
        
        document.getElementById('btn-pause-timer').addEventListener('click', togglePauseGame);
        document.getElementById('btn-resume-overlay').addEventListener('click', togglePauseGame);
        document.getElementById('btn-pencil-mode').addEventListener('click', () => togglePencilMode());
        document.getElementById('btn-erase-cell').addEventListener('click', () => eraseCell(state.focusedCell.r, state.focusedCell.c));
        document.getElementById('btn-nasa-hint').addEventListener('click', () => { if (state.multiplayer.active && state.multiplayer.roomId) requestFeatureVote('nasa'); else giveNasaHint(); });
        document.getElementById('toggle-immediate-error').addEventListener('change', (e) => { const requested = e.target.checked; if (state.multiplayer.active && state.multiplayer.roomId) { e.target.checked = !!state.immediateErrorCheck; requestFeatureVote('immediateError', requested); } else { state.immediateErrorCheck = requested; updateAllCellVisuals(); } });
        document.getElementById('toggle-highlight-same').addEventListener('change', (e) => { state.highlightSameNumbers = e.target.checked; updateAllCellVisuals(); });
        document.getElementById('btn-check-solution').addEventListener('click', checkFullBoardSolution);
        
        document.getElementById('btn-manual-create').addEventListener('click', () => {
          if (state.multiplayer.active && state.multiplayer.roomId) {
            showToast('Saia da sala multiplayer antes de iniciar a criação manual.', 'warn');
            return;
          }
          const { N } = state; state.isManualCreating = true;
          state.initial = Array.from({ length: N }, () => Array(N).fill('')); state.board = Array.from({ length: N }, () => Array(N).fill(''));
          state.notes = Array.from({ length: N }, () => Array.from({ length: N }, () => new Set())); state.nasaContributions = Array.from({ length: N }, () => Array(N).fill(false)); state.nasaCalls = 0; state.revealedErrors = Array.from({ length: N }, () => Array(N).fill(false)); state.solution = Array.from({ length: N }, () => Array(N).fill(''));
          state.completed = false; state.timerSeconds = 0; pauseTimer(); document.getElementById('timer-display').textContent = '00:00';
          document.getElementById('manual-create-bar').classList.remove('hidden'); document.getElementById('manual-create-bar').classList.add('flex');
          renderVirtualNumpad(); renderSudokuBoard(); showToast('Modo Criação: Preencha as pistas e clique em Iniciar Partida.', 'info');
        });
        document.getElementById('btn-finish-manual').addEventListener('click', () => {
          if (state.multiplayer.active && state.multiplayer.roomId) { showToast('A criação manual não pode alterar uma sala multiplayer ativa.', 'warn'); return; }
          let hasClues = false; for(let r=0; r<state.N; r++) for(let c=0; c<state.N; c++) if (state.board[r][c] !== '') hasClues = true;
          if (!hasClues) { showToast('Preencha ao menos uma pista!', 'warn'); return; }
          const newInitial = state.board.map(row => row.slice());
          const newSolution = solvePartialGrid(newInitial, state.N, state.blockR, state.blockC, state.symbols);
          if (!newSolution) {
             showToast('A grade possui conflitos ou não tem solução lógica.', 'warn');
             return; 
          }
          state.initial = newInitial; state.solution = newSolution; state.isManualCreating = false;
          document.getElementById('manual-create-bar').classList.remove('flex'); document.getElementById('manual-create-bar').classList.add('hidden');
          state.gameId = 'manual_' + Date.now(); state.gameName = 'Manual ' + new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'}); document.getElementById('game-name-input').value = state.gameName; renderSudokuBoard(); startTimer(); saveCurrentGameState(); showToast('Pistas fixadas! Boa sorte!', 'success');
        });
        
        document.getElementById('btn-reveal-errors-yes').addEventListener('click', () => { closeModal('modal-errors-prompt'); revealErrorsOnBoard(); });
        document.getElementById('btn-reveal-errors-no').addEventListener('click', () => closeModal('modal-errors-prompt'));
        document.getElementById('btn-victory-new').addEventListener('click', () => { closeModal('modal-victory'); if (state.multiplayer.active && state.multiplayer.roomId) requestNewGameConsensus(); else startNewGame(); });
        document.getElementById('btn-victory-replay').addEventListener('click', replayCurrentGame);
        document.getElementById('btn-victory-export').addEventListener('click', () => { closeModal('modal-victory'); exportBoardAsPNG(); });
        document.getElementById('btn-victory-close').addEventListener('click', () => closeModal('modal-victory'));
        
        document.getElementById('btn-open-changelog').addEventListener('click', () => openModal('modal-changelog'));
        document.getElementById('btn-close-changelog').addEventListener('click', () => closeModal('modal-changelog'));
        document.getElementById('btn-open-howto').addEventListener('click', () => openModal('modal-howto'));
        document.getElementById('btn-close-howto').addEventListener('click', () => closeModal('modal-howto'));
        document.getElementById('btn-open-gift').addEventListener('click', () => {
          openModal('modal-gift');
          if (typeof confetti === 'function') {
            confetti({ particleCount: 150, spread: 80, origin: { y: 0.5 }, zIndex: 9999, colors: ['#f43f5e', '#ec4899', '#d946ef', '#8b5cf6'] });
          }
        });
        document.getElementById('btn-close-gift').addEventListener('click', () => closeModal('modal-gift'));
        
        document.getElementById('btn-open-history').addEventListener('click', () => { renderHistoryModalList(); openModal('modal-history'); });
        document.getElementById('btn-close-history').addEventListener('click', () => closeModal('modal-history'));
        document.getElementById('btn-clear-history').addEventListener('click', () => {
          if (!getAllSavedGames().length) { showToast('O histórico local já está vazio.', 'info'); return; }
          if (window.confirm('Apagar todas as partidas salvas neste navegador? A partida aberta continuará na tela, mas deixará de ser salva automaticamente.')) clearSavedGameHistory();
        });
        document.getElementById('tab-hist-ongoing').addEventListener('click', () => { state.historyTab = 'ongoing'; document.getElementById('tab-hist-ongoing').className = 'pb-2.5 border-b-2 border-current text-blue-500'; document.getElementById('tab-hist-completed').className = 'pb-2.5 border-b-2 border-transparent opacity-60 hover:opacity-100'; renderHistoryModalList(); });
        document.getElementById('tab-hist-completed').addEventListener('click', () => { state.historyTab = 'completed'; document.getElementById('tab-hist-completed').className = 'pb-2.5 border-b-2 border-current text-blue-500'; document.getElementById('tab-hist-ongoing').className = 'pb-2.5 border-b-2 border-transparent opacity-60 hover:opacity-100'; renderHistoryModalList(); });
        
        document.getElementById('btn-share-url').addEventListener('click', shareCurrentPuzzleURL);
        document.getElementById('btn-share-state-url').addEventListener('click', shareCurrentPuzzleStateURL);
        document.getElementById('btn-export-png').addEventListener('click', exportBoardAsPNG);
        
        
        document.getElementById('btn-create-room').addEventListener('click', () => {
            const fb = getFirebaseAPI();
            if (!fb || !fb.db) { showToast('Carregando conexão de rede... Tente novamente em 2 segundos.', 'warn'); return; }
            const savedName = safeStorageGet('sudoku_anerothico_mp_name') || '';
            document.getElementById('multiplayer-name-input').value = savedName;
            openModal('modal-multiplayer');
        });
        
        document.getElementById('btn-close-multiplayer').addEventListener('click', () => closeModal('modal-multiplayer'));
        const roomModeSelect = document.getElementById('multiplayer-room-mode');
        const realtimeMetricsWrap = document.getElementById('multiplayer-realtime-metrics-wrap');
        const syncRoomModeOptions = () => { const isVersus = roomModeSelect.value === 'versus'; realtimeMetricsWrap.classList.toggle('hidden', !isVersus); if (!isVersus) document.getElementById('multiplayer-realtime-metrics').checked = false; };
        roomModeSelect.addEventListener('change', syncRoomModeOptions);
        syncRoomModeOptions();
        document.getElementById('mp-feature-vote-minimize').addEventListener('click', () => { state.multiplayer.featureVoteMinimized = true; renderFeatureVoteCard(state.multiplayer.currentFeatureVote); });
        document.getElementById('mp-feature-vote-pill').addEventListener('click', () => { state.multiplayer.featureVoteMinimized = false; renderFeatureVoteCard(state.multiplayer.currentFeatureVote); });
        document.querySelectorAll('[data-feature-vote]').forEach(button => button.addEventListener('click', () => castFeatureVote(button.dataset.featureVote)));
        
        
        document.getElementById('btn-vote-cancel').addEventListener('click', async () => {
            const fb = getFirebaseAPI();
            const proposal = state.multiplayer.currentProposal;
            if (!fb || typeof fb.runTransaction !== 'function' || !state.multiplayer.roomId || !proposal || proposal.proposerId !== state.multiplayer.playerId || proposal.status !== 'pending') {
                showToast('Somente quem propôs pode cancelar uma votação ainda pendente.', 'warn');
                return;
            }
            const propRef = fb.ref(fb.db, roomPath(state.multiplayer.roomId, 'proposal'));
            try {
                const result = await fb.runTransaction(propRef, current => {
                    if (!current || typeof current !== 'object' || Array.isArray(current) || current.proposalId !== proposal.proposalId || current.status !== 'pending' || current.proposerId !== state.multiplayer.playerId) return;
                    return null;
                }, false);
                if (!result || !result.committed) {
                    showToast('A votação já mudou ou foi concluída; atualizei o estado sem cancelar outra proposta.', 'warn');
                    return;
                }
                closeModal('modal-vote-newgame');
                showToast('Você cancelou a proposta de novo tabuleiro.', 'info');
            } catch (error) {
                console.error(error);
                showToast('Não foi possível cancelar a proposta.', 'warn');
            }
        });

        document.getElementById('btn-vote-reject').addEventListener('click', async () => {
            const fb = getFirebaseAPI();
            const proposal = state.multiplayer.currentProposal;
            if (!fb || typeof fb.runTransaction !== 'function' || !state.multiplayer.roomId || !proposal || proposal.status !== 'pending' || proposal.proposerId === state.multiplayer.playerId) return;
            const propRef = fb.ref(fb.db, roomPath(state.multiplayer.roomId, 'proposal'));
            try {
                const result = await fb.runTransaction(propRef, current => {
                    if (!current || typeof current !== 'object' || Array.isArray(current) || current.proposalId !== proposal.proposalId || current.status !== 'pending') return;
                    const required = Array.isArray(current.requiredPlayerIds) ? current.requiredPlayerIds : [];
                    if (!required.includes(state.multiplayer.playerId) || current.proposerId === state.multiplayer.playerId) return;
                    return {
                        ...current,
                        status: 'rejected',
                        rejectedByPlayerId: state.multiplayer.playerId,
                        rejectedByName: String(state.multiplayer.playerName || 'Jogador').slice(0, 40),
                        rejectedAtTimestamp: Date.now()
                    };
                }, false);
                if (!result || !result.committed) {
                    showToast('A votação já mudou ou você não faz parte dela.', 'warn');
                    return;
                }
                closeModal('modal-vote-newgame');
            } catch (error) {
                console.error(error);
                showToast('Não foi possível registrar sua recusa.', 'warn');
            }
        });
        
        document.getElementById('btn-vote-accept').addEventListener('click', async () => {
            const fb = getFirebaseAPI();
            const proposal = state.multiplayer.currentProposal;
            if (!fb || typeof fb.runTransaction !== 'function' || !state.multiplayer.roomId || !proposal || proposal.proposerId === state.multiplayer.playerId || proposal.status !== 'pending') return;
            const propRef = fb.ref(fb.db, roomPath(state.multiplayer.roomId, 'proposal'));
            try {
                const result = await fb.runTransaction(propRef, current => {
                    if (!current || typeof current !== 'object' || Array.isArray(current) || current.proposalId !== proposal.proposalId || current.status !== 'pending') return;
                    const required = Array.isArray(current.requiredPlayerIds) ? current.requiredPlayerIds : [];
                    if (!required.includes(state.multiplayer.playerId) || current.proposerId === state.multiplayer.playerId) return;
                    const voters = current.voters && typeof current.voters === 'object' && !Array.isArray(current.voters) ? { ...current.voters } : {};
                    if (voters[state.multiplayer.playerId]) return;
                    voters[state.multiplayer.playerId] = {
                        playerId: state.multiplayer.playerId,
                        playerName: String(state.multiplayer.playerName || 'Jogador').slice(0, 40),
                        playerColor: ensureMultiplayerColor(),
                        acceptedAtTimestamp: Date.now()
                    };
                    return { ...current, voters };
                }, false);
                if (!result || !result.committed) {
                    showToast('Seu aceite não foi registrado: a votação mudou ou você já votou.', 'warn');
                    return;
                }
                document.getElementById('vote-action-buttons').classList.add('hidden');
                document.getElementById('vote-wait-container').classList.remove('hidden');
                document.getElementById('btn-vote-cancel').classList.add('hidden');
                showProposalWaitingState(proposal, false);
            } catch (error) {
                console.error(error);
                showToast('Não foi possível registrar seu aceite.', 'warn');
            }
        });

        document.getElementById('btn-disconnect-room').addEventListener('click', () => {
            if (!state.multiplayer.active) return;
            const fb = getFirebaseAPI();
            const oldRoomId = state.multiplayer.roomId;
            const presenceRef = state.multiplayer.presenceRef;
            // Keep received NASA attribution markers when continuing the current board offline.
            Object.entries(state.multiplayer.contributions || {}).forEach(([key, entry]) => {
              const parts = key.split('_').map(Number);
              if (parts.length === 2 && parts.every(Number.isInteger)) setNasaContributionCell(parts[0], parts[1], isNASAContributionEntry(entry));
            });
            stopRoomListeners();
            if (fb && presenceRef) fb.remove(presenceRef).catch(() => {});
            if (fb && oldRoomId) {
              fb.remove(fb.ref(fb.db, roomPath(oldRoomId, `members/${state.multiplayer.playerId}`))).catch(() => {});
              fb.remove(fb.ref(fb.db, roomPath(oldRoomId, `cursors/${state.multiplayer.playerId}`))).catch(() => {});
            }
            state.multiplayer.active = false;
            state.multiplayer.roomId = null;
            state.multiplayer.presenceRef = null;
            state.multiplayer.players = {};
            state.multiplayer.members = {};
            state.multiplayer.peers = {};
            state.multiplayer.cellContributions = {};
            state.multiplayer.hasSharedNasaCounter = false;
            state.multiplayer.currentProposal = null;
            state.multiplayer.currentFeatureVote = null;
            renderFeatureVoteCard(null);
            state.multiplayer.lastAppliedInstanceNumber = null;
            state.multiplayer.pendingBoardState = null;
            document.getElementById('room-status-badge').classList.add('hidden');
            document.getElementById('room-status-badge').classList.remove('flex');
            document.getElementById('btn-create-room').classList.remove('hidden');
            updateAllCellVisuals();
            renderMultiplayerSidebar();
            showToast(`Desconectado da sala${oldRoomId ? ' ' + oldRoomId : ''}. Você pode continuar jogando offline.`, 'info');
        });

        
        document.getElementById('btn-host-room').addEventListener('click', () => {
            let name = document.getElementById('multiplayer-name-input').value.trim();
            if (!name) name = 'Anônimo';
            safeStorageSet('sudoku_anerothico_mp_name', name);
            hostRoom(name);
        });
        
        document.getElementById('btn-join-room').addEventListener('click', () => {
            let name = document.getElementById('multiplayer-name-input').value.trim();
            if (!name) name = 'Anônimo';
            const room = document.getElementById('multiplayer-room-input').value.trim();
            if (!room) { showToast('Digite o nome/ID da sala para entrar.', 'warn'); return; }
            safeStorageSet('sudoku_anerothico_mp_name', name);
            joinRoom(room, name);
        });
        
        document.getElementById('btn-open-load-code').addEventListener('click', () => { document.getElementById('load-code-input').value = ''; openModal('modal-load-code'); });
        document.getElementById('btn-close-load-code').addEventListener('click', () => closeModal('modal-load-code'));
        document.getElementById('btn-submit-load-code').addEventListener('click', () => {
          const val = document.getElementById('load-code-input').value.trim();
          if (!val) return;
          if (processLoadedCode(val)) closeModal('modal-load-code');
          else showToast('Código inválido ou corrompido!', 'warn');
        });
        
        document.getElementById('btn-open-ocr').addEventListener('click', () => openModal('modal-ocr'));
        document.getElementById('btn-close-ocr').addEventListener('click', () => closeModal('modal-ocr'));
        document.getElementById('ocr-file-input').addEventListener('change', (e) => {
          const file = e.target.files && e.target.files[0];
          if (!file) return;
          if (state.multiplayer.active && state.multiplayer.roomId) { showToast('Saia da sala multiplayer antes de importar uma imagem.', 'warn'); e.target.value = ''; return; }
          const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/bmp', 'image/gif']);
          if (!allowedTypes.has(String(file.type || '').toLowerCase()) || file.size <= 0 || file.size > 10 * 1024 * 1024) {
            showToast('Selecione uma imagem PNG, JPEG, WEBP, BMP ou GIF de até 10 MB.', 'warn'); e.target.value = ''; return;
          }
          const img = new Image();
          let objectUrl = '';
          const cleanup = () => { if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = ''; } };
          img.onload = async () => {
            cleanup();
            if (!img.naturalWidth || !img.naturalHeight || img.naturalWidth > 6000 || img.naturalHeight > 6000) {
              showToast('A imagem precisa ter dimensões válidas de até 6000×6000 pixels.', 'warn'); e.target.value = ''; return;
            }
            await processOCRImageSource(img);
            e.target.value = '';
          };
          img.onerror = () => { cleanup(); showToast('Não foi possível abrir essa imagem.', 'warn'); e.target.value = ''; };
          try { objectUrl = URL.createObjectURL(file); img.src = objectUrl; }
          catch (error) { cleanup(); showToast('Não foi possível carregar o arquivo de imagem.', 'warn'); e.target.value = ''; }
        });
        document.getElementById('btn-ocr-sample').addEventListener('click', () => processOCRImageSource(generateSamplePrintableCanvas()));
        
        window.addEventListener('keydown', (e) => {
          const active = document.activeElement;
          const activeTag = active ? active.tagName : '';
          const isSudokuCell = !!(active && active.id && active.id.startsWith('cell-input-'));
          const isTyping = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT' || (active && active.isContentEditable);
          const isConfigInput = active && ['custom-min-input', 'custom-max-input', 'load-code-input', 'game-name-input', 'multiplayer-name-input', 'multiplayer-room-input'].includes(active.id);
          const key = String(e.key || '');
          const lower = key.toLowerCase();
          const canUseGlobalShortcut = !e.ctrlKey && !e.metaKey && !e.altKey && !isConfigInput && (!isTyping || isSudokuCell || state.boardFocusMode);

          if (key === 'F11') {
            e.preventDefault();
            toggleBoardFocusMode(!state.boardFocusMode);
            return;
          }
          if (key === 'Escape' && state.boardFocusMode) {
            e.preventDefault();
            toggleBoardFocusMode(false);
            return;
          }
          if ((key === '+' || key === '=') && canUseGlobalShortcut) { e.preventDefault(); setBoardZoom(Number(document.getElementById('board-zoom').value) + 25); return; }
          if (key === '-' && canUseGlobalShortcut && (!isTyping || (isSudokuCell && !state.symbols.some(symbol => String(symbol).startsWith('-'))) || state.boardFocusMode)) { e.preventDefault(); setBoardZoom(Number(document.getElementById('board-zoom').value) - 25); return; }
          if ((lower === 'r') && canUseGlobalShortcut) { e.preventDefault(); setBoardZoom(100); return; }
          // A focused Sudoku cell handles N in handleCellKeyDown. Skipping it here prevents the old double-toggle (on then off).
          if (canUseGlobalShortcut && !isSudokuCell && (lower === 'n' || e.code === 'KeyN' || e.keyCode === 78)) { e.preventDefault(); togglePencilMode(); return; }
          if (canUseGlobalShortcut && lower === 'h' && !state.symbols.includes(key.toUpperCase())) {
            e.preventDefault();
            if (state.multiplayer.active && state.multiplayer.roomId) requestFeatureVote('nasa'); else giveNasaHint();
            return;
          }
          if (canUseGlobalShortcut && lower === 'e') {
            e.preventDefault();
            const requested = !state.immediateErrorCheck;
            if (state.multiplayer.active && state.multiplayer.roomId) requestFeatureVote('immediateError', requested);
            else {
              state.immediateErrorCheck = requested;
              const toggle = document.getElementById('toggle-immediate-error'); if (toggle) toggle.checked = requested;
              updateAllCellVisuals();
              showToast(`Erro imediato ${requested ? 'ativado' : 'desativado'}.`, 'info');
            }
            return;
          }
          if (canUseGlobalShortcut && lower === 'i') {
            e.preventDefault();
            state.highlightSameNumbers = !state.highlightSameNumbers;
            const toggle = document.getElementById('toggle-highlight-same'); if (toggle) toggle.checked = state.highlightSameNumbers;
            updateAllCellVisuals();
            showToast(`Destacar iguais ${state.highlightSameNumbers ? 'ativado' : 'desativado'}.`, 'info');
          }
        });
        // F11 may be handled by the browser before it reaches the page. Keep the application focus
        // state aligned with standard fullscreen changes whenever the Fullscreen API is available.
        document.addEventListener('fullscreenchange', () => {
          if (!document.fullscreenElement && state.boardFocusMode) toggleBoardFocusMode(false);
          else if (document.fullscreenElement && !state.boardFocusMode) toggleBoardFocusMode(true);
          else if (state.boardFocusMode && state.board) renderSudokuBoard();
        });
      }

      function initApp() {
        const savedTheme = safeStorageGet(STORAGE_KEYS.THEME) || 'rainbow';
        applyTheme(savedTheme);
        initEventListeners();
        updateSavedBadgeCount();
        if (tryLoadSharedPuzzleFromURL()) return;
        const savedGames = getAllSavedGames();
        const lastId = safeStorageGet(STORAGE_KEYS.CURRENT_GAME_ID);
        const lastGame = savedGames.find(g => g.gameId === lastId && !g.completed) || savedGames.find(g => !g.completed);
        if (lastGame) loadSavedGameRecord(lastGame); else startNewGame();
      }

      window.addEventListener('DOMContentLoaded', initApp);
