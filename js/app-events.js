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
          try { localStorage.setItem('sudoku_anerothico_header_collapsed_v1', collapsed ? 'true' : 'false'); } catch (_) {}
        };
        let savedHeaderState = false;
        try { savedHeaderState = localStorage.getItem('sudoku_anerothico_header_collapsed_v1') === 'true'; } catch (_) {}
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
        document.getElementById('game-name-input').addEventListener('input', (e) => { state.gameName = e.target.value; saveCurrentGameState(); if (state.multiplayer.active && state.multiplayer.roomId) { const fb = getFirebaseAPI(); if (fb) fb.update(fb.ref(fb.db, roomPath(state.multiplayer.roomId, 'boardState')), { gameName: state.gameName, lastUpdatedByPlayerId: state.multiplayer.playerId, updatedAtTimestamp: Date.now() }).catch(() => {}); }
          // v6.7: auto-resize textarea
          const ta = e.target; ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 64) + 'px';
        });
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
          const { N } = state; state.isManualCreating = true;
          state.initial = Array.from({ length: N }, () => Array(N).fill('')); state.board = Array.from({ length: N }, () => Array(N).fill(''));
          state.notes = Array.from({ length: N }, () => Array.from({ length: N }, () => new Set())); state.nasaContributions = Array.from({ length: N }, () => Array(N).fill(false)); state.nasaCalls = 0; state.revealedErrors = Array.from({ length: N }, () => Array(N).fill(false)); state.solution = Array.from({ length: N }, () => Array(N).fill(''));
          state.completed = false; state.timerSeconds = 0; pauseTimer(); document.getElementById('timer-display').textContent = '00:00';
          document.getElementById('manual-create-bar').classList.remove('hidden'); document.getElementById('manual-create-bar').classList.add('flex');
          renderVirtualNumpad(); renderSudokuBoard(); showToast('Modo Criação: Preencha as pistas e clique em Iniciar Partida.', 'info');
        });
        document.getElementById('btn-finish-manual').addEventListener('click', () => {
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
          state.gameId = 'manual_' + Date.now(); state.gameName = 'Manual ' + new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'}); setGameNameInput(state.gameName); renderSudokuBoard(); startTimer(); saveCurrentGameState(); showToast('Pistas fixadas! Boa sorte!', 'success');
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

        // Configurações visuais
        document.getElementById('btn-open-settings').addEventListener('click', () => {
          const vs = state.visualSettings || {};
          document.getElementById('setting-glow-intensity').value = String(vs.glowIntensityRaw ?? vs.glowIntensity * 25 ?? 50);
          document.getElementById('setting-anim-speed').value = String(vs.animSpeedRaw ?? vs.animSpeed * 25 ?? 50);
          // v6.7: novos controles NASA (0-100)
          document.getElementById('setting-nasa-intensity').value = String(vs.nasaIntensity ?? 60);
          document.getElementById('setting-nasa-speed').value = String(vs.nasaSpeed ?? 50);
          // v6.7: animação de cor do jogador
          document.getElementById('setting-player-color-anim-on').checked = (vs.playerColorAnimOn !== false);
          document.getElementById('setting-player-color-freq').value = String(vs.playerColorFreq ?? 50);
          // v6.7: tile de mapa de calor
          document.getElementById('setting-player-tile-on').checked = (vs.playerTileOn !== false);
          // v6.7: desligar identificação
          document.getElementById('setting-player-identity-off').checked = (vs.playerIdentityOff === true);
          // v6.7: velocidade de inserção (0-100 — substituindo o slider antigo 0-3)
          const insertSpeedEl = document.getElementById('setting-insert-speed');
          if (insertSpeedEl) insertSpeedEl.value = String(vs.insertSpeed ?? 50);
          updateSettingsLabels();
          openModal('modal-settings');
        });
        document.getElementById('btn-close-settings').addEventListener('click', () => closeModal('modal-settings'));

        function updateSettingsLabels() {
          // v6.7: sliders glow e anim-speed agora são 0-100
          const giRaw = Number(document.getElementById('setting-glow-intensity').value);
          const asRaw = Number(document.getElementById('setting-anim-speed').value);
          const glowLabelEl = document.getElementById('setting-glow-intensity-label');
          const animLabelEl = document.getElementById('setting-anim-speed-label');
          if (glowLabelEl) glowLabelEl.textContent = giRaw === 0 ? 'Desligado' : giRaw < 34 ? 'Baixo' : giRaw < 67 ? 'Médio' : 'Alto';
          if (animLabelEl) animLabelEl.textContent = asRaw === 0 ? 'Estático' : asRaw < 34 ? 'Lento' : asRaw < 67 ? 'Normal' : 'Rápido';
          // v6.7: labels NASA
          const nasaI = Number(document.getElementById('setting-nasa-intensity').value);
          const nasaS = Number(document.getElementById('setting-nasa-speed').value);
          const nasaIntEl = document.getElementById('setting-nasa-intensity-label');
          const nasaSpdEl = document.getElementById('setting-nasa-speed-label');
          if (nasaIntEl) nasaIntEl.textContent = nasaI === 0 ? 'Desligado' : nasaI < 34 ? 'Baixo' : nasaI < 67 ? 'Médio' : 'Alto';
          if (nasaSpdEl) nasaSpdEl.textContent = nasaS === 0 ? 'Estático' : nasaS < 34 ? 'Lento' : nasaS < 67 ? 'Normal' : 'Rápido';
          // v6.7: label frequência cor do jogador
          const freqEl = document.getElementById('setting-player-color-freq-label');
          const freqV = Number(document.getElementById('setting-player-color-freq').value);
          if (freqEl) freqEl.textContent = freqV === 0 ? 'Desligado' : freqV >= 98 ? 'Constante' : freqV < 34 ? 'Lento' : freqV < 67 ? 'Normal' : 'Rápido';
          // v6.7: label inserção
          const insEl = document.getElementById('setting-insert-speed-label');
          const insV = Number((document.getElementById('setting-insert-speed') || {}).value ?? 50);
          if (insEl) insEl.textContent = insV === 0 ? 'Desligado' : insV >= 98 ? 'Instantâneo' : insV < 34 ? 'Lento' : insV < 67 ? 'Normal' : 'Rápido';
        }

        function saveAndApplyVisualSettings() {
          const giRaw = Number(document.getElementById('setting-glow-intensity').value); // 0-100
          const asRaw = Number(document.getElementById('setting-anim-speed').value);     // 0-100
          // Mapear 0-100 → 0-3 para compatibilidade com updateAllCellVisuals (legado)
          const gi = giRaw === 0 ? 0 : giRaw < 34 ? 1 : giRaw < 67 ? 2 : 3;
          const as = asRaw === 0 ? 0 : asRaw < 34 ? 1 : asRaw < 67 ? 2 : 3;
          const nasaI = Number(document.getElementById('setting-nasa-intensity').value);
          const nasaS = Number(document.getElementById('setting-nasa-speed').value);
          const playerColorAnimOn = document.getElementById('setting-player-color-anim-on').checked;
          const playerColorFreq = Number(document.getElementById('setting-player-color-freq').value);
          const playerTileOn = document.getElementById('setting-player-tile-on').checked;
          const playerIdentityOff = document.getElementById('setting-player-identity-off').checked;
          const insertSpeedEl = document.getElementById('setting-insert-speed');
          const insertSpeed = insertSpeedEl ? Number(insertSpeedEl.value) : 50;
          // Guarda também os valores raw (0-100) para precisão ao reabrir o modal
          state.visualSettings = { glowIntensity: gi, glowIntensityRaw: giRaw, animSpeed: as, animSpeedRaw: asRaw, nasaIntensity: nasaI, nasaSpeed: nasaS, playerColorAnimOn, playerColorFreq, playerTileOn, playerIdentityOff, insertSpeed };
          try { localStorage.setItem(STORAGE_KEYS.VISUAL_SETTINGS, JSON.stringify(state.visualSettings)); } catch (_) {}
          updateSettingsLabels();
          // Aplica variáveis CSS da NASA em tempo real
          applyNasaCSSSettings(nasaI, nasaS);
          // Aplica frequência da varredura de cor do jogador
          applyPlayerColorSweepSettings(playerColorAnimOn, playerColorFreq);
          updateAllCellVisuals();
        }

        // v6.7: aplica variáveis CSS de intensidade/velocidade da NASA
        function applyNasaCSSSettings(intensity, speed) {
          const root = document.documentElement;
          const nasaCells = document.querySelectorAll('#sudoku-grid .sudoku-cell.is-nasa-contribution');
          if (intensity === 0) {
            // sem brilho: remove animação e remove brilho
            root.style.setProperty('--nasa-anim-duration', '99999s');
            root.style.setProperty('--nasa-glow-max-brightness', '1.1');
            root.style.setProperty('--nasa-glow-max-saturation', '1.05');
            root.style.setProperty('--nasa-glow-spread', '2px');
            root.style.setProperty('--nasa-glow-opacity', '0.2');
            nasaCells.forEach(c => { c.classList.remove('nasa-static'); c.classList.add('nasa-off'); });
          } else {
            // duração: speed=0 → estático (sem piscar), speed=1→6s, speed=100→0.6s
            if (speed === 0) {
              root.style.setProperty('--nasa-anim-duration', '99999s');
              const t = intensity / 100;
              root.style.setProperty('--nasa-static-brightness', (1.1 + t * 0.8).toFixed(2));
              nasaCells.forEach(c => { c.classList.remove('nasa-off'); c.classList.add('nasa-static'); });
            } else {
              const dur = 0.6 + (100 - speed) * 0.054; // speed=100→0.6s, speed=1→6s
              root.style.setProperty('--nasa-anim-duration', `${dur.toFixed(2)}s`);
              nasaCells.forEach(c => { c.classList.remove('nasa-off', 'nasa-static'); });
            }
            // intensidade: 0-100 → brightness 1.1 – 2.8, saturação 1.05 – 2.0, spread 2px – 22px
            const t = intensity / 100;
            root.style.setProperty('--nasa-glow-max-brightness', (1.1 + t * 1.7).toFixed(2));
            root.style.setProperty('--nasa-glow-max-saturation', (1.05 + t * 0.95).toFixed(2));
            root.style.setProperty('--nasa-glow-spread', `${Math.round(2 + t * 20)}px`);
            root.style.setProperty('--nasa-glow-opacity', (0.3 + t * 0.7).toFixed(2));
          }
        }

        // v6.7: configura o intervalo de varredura de cor nos números do jogador
        function applyPlayerColorSweepSettings(enabled, freq) {
          // Limpa timer anterior se existir
          if (window._playerColorSweepTimer) { clearInterval(window._playerColorSweepTimer); window._playerColorSweepTimer = null; }
          if (!enabled || freq === 0) return;
          // freq=100 → intervalo=0 (constante, todos os frames), freq=1 → 30s
          const intervalMs = freq >= 98 ? 800 : Math.round(30000 - (freq / 100) * 29200);
          const sweepDurationMs = Math.max(400, Math.min(2000, 2000 - freq * 16));
          window._playerColorSweepTimer = setInterval(() => {
            runPlayerColorSweep(sweepDurationMs);
          }, intervalMs);
        }

        document.getElementById('setting-glow-intensity').addEventListener('input', saveAndApplyVisualSettings);
        document.getElementById('setting-anim-speed').addEventListener('input', saveAndApplyVisualSettings);
        document.getElementById('setting-nasa-intensity').addEventListener('input', saveAndApplyVisualSettings);
        document.getElementById('setting-nasa-speed').addEventListener('input', saveAndApplyVisualSettings);
        document.getElementById('setting-player-color-anim-on').addEventListener('change', saveAndApplyVisualSettings);
        document.getElementById('setting-player-color-freq').addEventListener('input', saveAndApplyVisualSettings);
        document.getElementById('setting-player-tile-on').addEventListener('change', saveAndApplyVisualSettings);
        document.getElementById('setting-player-identity-off').addEventListener('change', saveAndApplyVisualSettings);
        const insertSpeedSlider = document.getElementById('setting-insert-speed');
        if (insertSpeedSlider) insertSpeedSlider.addEventListener('input', saveAndApplyVisualSettings);
        
        // Aplica as configurações salvas imediatamente ao iniciar
        (function applyInitialVisualSettings() {
          const vs = state.visualSettings || {};
          applyNasaCSSSettings(vs.nasaIntensity ?? 60, vs.nasaSpeed ?? 50);
          applyPlayerColorSweepSettings(vs.playerColorAnimOn !== false, vs.playerColorFreq ?? 50);
        })();
        
        document.getElementById('btn-open-history').addEventListener('click', () => { renderHistoryModalList(); openModal('modal-history'); });
        document.getElementById('btn-close-history').addEventListener('click', () => closeModal('modal-history'));
        document.getElementById('tab-hist-ongoing').addEventListener('click', () => { state.historyTab = 'ongoing'; document.getElementById('tab-hist-ongoing').className = 'pb-2.5 border-b-2 border-current text-blue-500'; document.getElementById('tab-hist-completed').className = 'pb-2.5 border-b-2 border-transparent opacity-60 hover:opacity-100'; renderHistoryModalList(); });
        document.getElementById('tab-hist-completed').addEventListener('click', () => { state.historyTab = 'completed'; document.getElementById('tab-hist-completed').className = 'pb-2.5 border-b-2 border-current text-blue-500'; document.getElementById('tab-hist-ongoing').className = 'pb-2.5 border-b-2 border-transparent opacity-60 hover:opacity-100'; renderHistoryModalList(); });
        
        document.getElementById('btn-share-url').addEventListener('click', shareCurrentPuzzleURL);
        document.getElementById('btn-share-state-url').addEventListener('click', shareCurrentPuzzleStateURL);
        document.getElementById('btn-export-png').addEventListener('click', exportBoardAsPNG);
        
        
        document.getElementById('btn-create-room').addEventListener('click', () => {
            const fb = getFirebaseAPI();
            if (!fb || !fb.db) { showToast('Carregando conexão de rede... Tente novamente em 2 segundos.', 'warn'); return; }
            let savedName = '';
            try { savedName = localStorage.getItem('sudoku_anerothico_mp_name') || ''; } catch (_) {}
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
        
        
        document.getElementById('btn-vote-cancel').addEventListener('click', () => {
            const fb = getFirebaseAPI();
            const proposal = state.multiplayer.currentProposal;
            if (!fb || !state.multiplayer.roomId || !proposal || proposal.proposerId !== state.multiplayer.playerId) {
                showToast('Somente quem propôs pode cancelar esta votação.', 'warn');
                return;
            }
            const propRef = fb.ref(fb.db, roomPath(state.multiplayer.roomId, 'proposal'));
            state.multiplayer.currentProposal = { ...proposal, status: 'cancelled' };
            closeModal('modal-vote-newgame');
            fb.remove(propRef).then(() => {
                state.multiplayer.currentProposal = null;
                showToast('Você cancelou a proposta de novo tabuleiro.', 'info');
            }).catch(error => {
                console.error(error);
                showToast('Não foi possível cancelar a proposta.', 'warn');
            });
        });

        document.getElementById('btn-vote-reject').addEventListener('click', () => {
            const fb = getFirebaseAPI();
            const proposal = state.multiplayer.currentProposal;
            if (!fb || !state.multiplayer.roomId || !proposal || proposal.proposerId === state.multiplayer.playerId) return;
            const propRef = fb.ref(fb.db, roomPath(state.multiplayer.roomId, 'proposal'));
            fb.update(propRef, {
                status: 'rejected',
                rejectedByPlayerId: state.multiplayer.playerId,
                rejectedByName: state.multiplayer.playerName,
                rejectedAtTimestamp: Date.now()
            }).then(() => closeModal('modal-vote-newgame'))
              .catch(error => { console.error(error); showToast('Não foi possível registrar sua recusa.', 'warn'); });
        });
        
        document.getElementById('btn-vote-accept').addEventListener('click', () => {
            const fb = getFirebaseAPI();
            const proposal = state.multiplayer.currentProposal;
            if (!fb || !state.multiplayer.roomId || !proposal || proposal.proposerId === state.multiplayer.playerId || proposal.status !== 'pending') return;
            document.getElementById('vote-action-buttons').classList.add('hidden');
            document.getElementById('vote-wait-container').classList.remove('hidden');
            document.getElementById('btn-vote-cancel').classList.add('hidden');
            const voteRef = fb.ref(fb.db, roomPath(state.multiplayer.roomId, `proposal/voters/${state.multiplayer.playerId}`));
            fb.set(voteRef, {
                playerId: state.multiplayer.playerId,
                playerName: state.multiplayer.playerName,
                playerColor: ensureMultiplayerColor(),
                acceptedAtTimestamp: Date.now()
            }).then(() => {
                showProposalWaitingState(proposal, false);
            }).catch(error => {
                console.error(error);
                showToast('Não foi possível registrar seu aceite.', 'warn');
            });
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
            state.multiplayer.active = false;
            state.multiplayer.roomId = null;
            state.multiplayer.presenceRef = null;
            state.multiplayer.players = {};
            state.multiplayer.peers = {};
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
            try { localStorage.setItem('sudoku_anerothico_mp_name', name); } catch (_) {}
            hostRoom(name);
        });
        
        document.getElementById('btn-join-room').addEventListener('click', () => {
            let name = document.getElementById('multiplayer-name-input').value.trim();
            if (!name) name = 'Anônimo';
            let room = document.getElementById('multiplayer-room-input').value.trim();
            if (!room) { showToast('Digite o nome/ID da sala para entrar.', 'warn'); return; }
            room = room.replace(/[\.#\$\[\]/]/g, '_');
            try { localStorage.setItem('sudoku_anerothico_mp_name', name); } catch (_) {}
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
        document.getElementById('ocr-file-input').addEventListener('change', (e) => { const file = e.target.files && e.target.files[0]; if (!file) return; const img = new Image(); img.onload = () => processOCRImageSource(img); img.src = URL.createObjectURL(file); });
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
        let savedTheme = 'rainbow';
        try { savedTheme = localStorage.getItem(STORAGE_KEYS.THEME) || 'rainbow'; } catch (_) {}
        applyTheme(savedTheme);
        initEventListeners();
        updateSavedBadgeCount();
        if (tryLoadSharedPuzzleFromURL()) return;
        const savedGames = getAllSavedGames();
        let lastId = null;
        try { lastId = localStorage.getItem(STORAGE_KEYS.CURRENT_GAME_ID); } catch (_) {}
        const lastGame = savedGames.find(g => g.gameId === lastId && !g.completed) || savedGames.find(g => !g.completed);
        if (lastGame) loadSavedGameRecord(lastGame); else startNewGame();
      }

      window.addEventListener('DOMContentLoaded', initApp);
