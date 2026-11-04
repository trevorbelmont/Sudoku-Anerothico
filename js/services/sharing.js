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
        try {
          const rawData = JSON.parse(decodeURIComponent(atob(encoded)));
          const validMeta = validateGameState({ N: rawData.N || (rawData.s ? rawData.s.length : 0), bR: rawData.bR, bC: rawData.bC, s: rawData.s, i: rawData.i, sol: rawData.sol });
          if (!validMeta) return false;
          if (rawData.st === 1 && !isValidMatrix(rawData.b, validMeta.N, validMeta.symbols)) return false;
          
          state.gameId = 'shared_' + Date.now(); state.gameName = ''; setGameNameInput(''); state.mode = rawData.m || 'standard'; state.difficulty = rawData.d || 'medio';
          state.minVal = rawData.minV ?? 1; state.maxVal = rawData.maxV ?? 9; state.includeZero = !!rawData.incZ;
          state.symbols = validMeta.symbols; state.N = validMeta.N; state.blockR = validMeta.bR; state.blockC = validMeta.bC;
          state.initial = validMeta.initial;
          state.nasaContributions = Array.from({ length: state.N }, () => Array(state.N).fill(false));
          
          const solved = validMeta.sol || solvePartialGrid(validMeta.initial, validMeta.N, validMeta.bR, validMeta.bC, validMeta.symbols);
          if (!solved) return false;
          state.solution = solved;

          if (rawData.st === 1 && Array.isArray(rawData.b)) {
            state.board = rawData.b.map(r => r.slice());
            state.notes = Array.isArray(rawData.n) ? rawData.n.map(row => row.map(arr => new Set(arr || []))) : Array.from({ length: state.N }, () => Array.from({ length: state.N }, () => new Set()));
            state.nasaContributions = Array.from({ length: state.N }, (_, r) => Array.from({ length: state.N }, (_, c) => !!(rawData.nc && rawData.nc[r] && rawData.nc[r][c])));
            state.nasaCalls = Math.max(0, Number.isFinite(Number(rawData.nca)) ? Number(rawData.nca) : state.nasaContributions.flat().filter(Boolean).length);
            state.revealedErrors = Array.isArray(rawData.re) ? rawData.re : Array.from({ length: state.N }, () => Array(state.N).fill(false));
            state.timerSeconds = typeof rawData.t === 'number' ? rawData.t : 0; state.completed = !!rawData.c;
          } else {
            state.isManualCreating = false; const mcBarShare = document.getElementById('manual-create-bar'); if (mcBarShare) { mcBarShare.classList.remove('flex'); mcBarShare.classList.add('hidden'); }
            state.board = validMeta.initial.map(r => r.slice()); state.notes = Array.from({ length: state.N }, () => Array.from({ length: state.N }, () => new Set())); state.nasaCalls = 0;
            state.revealedErrors = Array.from({ length: state.N }, () => Array(state.N).fill(false)); state.timerSeconds = 0; state.completed = false;
          }
          syncModeTabsUI(); syncDifficultyButtonsUI(); updateHeaderSubtitle(); document.getElementById('timer-display').textContent = formatTime(state.timerSeconds);
          renderVirtualNumpad(); renderSudokuBoard();
          if (state.completed) pauseTimer(); else startTimer();
          saveCurrentGameState();
          showToast(rawData.st === 1 ? 'Estado completo carregado com sucesso!' : 'Grade carregada com sucesso!', 'success');
          return true;
        } catch (e) { return false; }
      }

      function tryLoadSharedPuzzleFromURL() {
        try {
          const params = new URLSearchParams(window.location.search);
          const encoded = params.get('puzzle');
          if (!encoded) return false;
          window.history.replaceState({}, '', window.location.pathname);
          return processLoadedCode(encoded);
        } catch (e) { return false; }
      }
