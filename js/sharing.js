'use strict';

function copyTextToClipboard(text, successMessage) {
        navigator.clipboard.writeText(text).then(() => showToast(successMessage, 'success')).catch(() => {
          const tempInput = document.createElement('textarea'); tempInput.value = text; document.body.appendChild(tempInput);
          tempInput.select(); document.execCommand('copy'); document.body.removeChild(tempInput); showToast(successMessage, 'success');
        });
      }

      function shareCurrentPuzzleURL() {
        try {
          const payload = { m: state.mode, d: state.difficulty, s: state.symbols, N: state.N, bR: state.blockR, bC: state.blockC, i: state.initial, sol: state.solution };
          copyTextToClipboard(btoa(encodeURIComponent(JSON.stringify(payload))), 'Código da grade copiado para a área de transferência!');
        } catch (e) { showToast('Erro ao gerar código da grade.', 'warn'); }
      }

      function shareCurrentPuzzleStateURL() {
        try {
          const payload = {
            st: 1, m: state.mode, d: state.difficulty, minV: state.minVal, maxV: state.maxVal, incZ: state.includeZero,
            s: state.symbols, N: state.N, bR: state.blockR, bC: state.blockC, i: state.initial, sol: state.solution,
            b: state.board, n: state.notes.map(row => row.map(set => Array.from(set))), re: state.revealedErrors, nc: (ensureNasaContributionGrid(), state.nasaContributions.map(row => row.slice())), nca: Math.max(0, Number(state.nasaCalls) || 0), t: state.timerSeconds, c: state.completed
          };
          copyTextToClipboard(btoa(encodeURIComponent(JSON.stringify(payload))), 'Código do estado do puzzle copiado para a área de transferência!');
        } catch (e) { showToast('Erro ao gerar código do estado.', 'warn'); }
      }

      function processLoadedCode(encoded) {
        if (state.multiplayer.active && state.multiplayer.roomId) {
          showToast('Saia da sala multiplayer antes de importar um código.', 'warn');
          return false;
        }
        try {
          if (typeof encoded !== 'string' || encoded.length < 4 || encoded.length > 1000000) return false;
          const decoded = decodeURIComponent(atob(encoded));
          if (decoded.length > 750000) return false;
          const rawData = JSON.parse(decoded);
          if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) return false;
          const validMeta = validateGameState({
            N: rawData.N || (Array.isArray(rawData.s) ? rawData.s.length : 0),
            bR: rawData.bR, bC: rawData.bC, s: rawData.s, i: rawData.i, sol: rawData.sol
          });
          if (!validMeta) return false;
          const solved = validMeta.sol || solvePartialGrid(validMeta.initial, validMeta.N, validMeta.bR, validMeta.bC, validMeta.symbols);
          if (!solved || !isGridRuleValid(solved, validMeta.N, validMeta.bR, validMeta.bC, validMeta.symbols, true) || !boardPreservesInitial(solved, validMeta.initial, validMeta.N)) return false;

          const N = validMeta.N;
          let board = validMeta.initial.map(row => row.slice());
          let notes = Array.from({ length: N }, () => Array.from({ length: N }, () => []));
          let nasaContributions = Array.from({ length: N }, () => Array(N).fill(false));
          let revealedErrors = Array.from({ length: N }, () => Array(N).fill(false));
          let nasaCalls = 0, timerSeconds = 0, completed = false;
          if (rawData.st === 1) {
            board = normalizeSymbolMatrix(rawData.b, N, validMeta.symbols);
            if (!board || !boardPreservesInitial(board, validMeta.initial, N)) return false;
            notes = normalizeNotesGrid(rawData.n, N, validMeta.symbols);
            revealedErrors = normalizeBooleanGrid(rawData.re, N);
            nasaContributions = normalizeBooleanGrid(rawData.nc, N);
            if (!notes || !revealedErrors || !nasaContributions) return false;
            const rawNasaCalls = Number(rawData.nca ?? nasaContributions.flat().filter(Boolean).length);
            const rawTimerSeconds = Number(rawData.t ?? 0);
            if (!Number.isSafeInteger(rawNasaCalls) || rawNasaCalls < 0 || rawNasaCalls > 1000000 ||
                !Number.isSafeInteger(rawTimerSeconds) || rawTimerSeconds < 0 || rawTimerSeconds > 100000000 ||
                (rawData.c != null && typeof rawData.c !== 'boolean')) return false;
            nasaCalls = rawNasaCalls;
            timerSeconds = rawTimerSeconds;
            completed = rawData.c === true;
            if (completed && !isGridRuleValid(board, N, validMeta.bR, validMeta.bC, validMeta.symbols, true)) return false;
          }

          const allowedModes = new Set(['standard', 'custom']);
          const mode = allowedModes.has(rawData.m) ? rawData.m : 'standard';
          const difficulty = Object.prototype.hasOwnProperty.call(DIFFICULTY_LABELS, rawData.d) ? rawData.d : 'medio';
          const minVal = Number.isFinite(Number(rawData.minV)) ? Number(rawData.minV) : Number(validMeta.symbols[0]);
          const maxVal = Number.isFinite(Number(rawData.maxV)) ? Number(rawData.maxV) : Number(validMeta.symbols[validMeta.symbols.length - 1]);
          if (Math.abs(minVal) > 1000000 || Math.abs(maxVal) > 1000000) return false;

          // All payload data has been parsed and validated into temporary values. Commit to state only now.
          state.gameId = createClientIdentifier('shared_');
          state.gameName = '';
          const nameInput = document.getElementById('game-name-input'); if (nameInput) nameInput.value = '';
          state.mode = mode; state.difficulty = difficulty;
          state.minVal = minVal; state.maxVal = maxVal; state.includeZero = rawData.incZ === true;
          state.symbols = validMeta.symbols.slice(); state.N = N; state.blockR = validMeta.bR; state.blockC = validMeta.bC;
          state.initial = validMeta.initial.map(row => row.slice());
          state.solution = solved.map(row => row.slice());
          state.board = board.map(row => row.slice());
          state.notes = notes.map(row => row.map(arr => new Set(arr)));
          state.nasaContributions = nasaContributions.map(row => row.slice());
          state.nasaCalls = nasaCalls;
          state.revealedErrors = revealedErrors.map(row => row.slice());
          state.timerSeconds = timerSeconds; state.completed = completed; state.isManualCreating = false;
          const mcBarShare = document.getElementById('manual-create-bar');
          if (mcBarShare) { mcBarShare.classList.remove('flex'); mcBarShare.classList.add('hidden'); }
          state.focusedCell = { r: 0, c: 0 }; state.highlightedSymbol = null;
          syncModeTabsUI(); syncDifficultyButtonsUI(); updateHeaderSubtitle();
          document.getElementById('timer-display').textContent = formatTime(state.timerSeconds);
          renderVirtualNumpad(); renderSudokuBoard(); updateProgressUI(); updateNasaContributionSummary();
          if (state.completed) pauseTimer(); else startTimer();
          saveCurrentGameState();
          showToast(rawData.st === 1 ? 'Estado completo carregado com sucesso!' : 'Grade carregada com sucesso!', 'success');
          return true;
        } catch (error) {
          return false;
        }
      }

      function tryLoadSharedPuzzleFromURL() {
        try {
          const params = new URLSearchParams(window.location.search);
          const encoded = params.get('puzzle');
          if (!encoded) return false;
          const loaded = processLoadedCode(encoded);
          if (loaded) window.history.replaceState({}, '', window.location.pathname);
          return loaded;
        } catch (e) { return false; }
      }
