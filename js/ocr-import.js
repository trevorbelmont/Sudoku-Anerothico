'use strict';

async function processOCRImageSource(imageSource) {
        const progressBox = document.getElementById('ocr-progress-box'), statusText = document.getElementById('ocr-status-text'), percentText = document.getElementById('ocr-percent-text'), progressBar = document.getElementById('ocr-progress-bar'), previewWrapper = document.getElementById('ocr-preview-wrapper'), previewCanvas = document.getElementById('ocr-preview-canvas');
        progressBox.classList.remove('hidden'); progressBox.classList.add('flex'); previewWrapper.classList.remove('hidden'); previewWrapper.classList.add('flex');
        const ctx = previewCanvas.getContext('2d'), size = 360; previewCanvas.width = size; previewCanvas.height = size;
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, size, size); ctx.drawImage(imageSource, 0, 0, size, size);
        const imgData = ctx.getImageData(0, 0, size, size), d = imgData.data;
        for (let i = 0; i < d.length; i += 4) { const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; const v = lum < 165 ? 0 : 255; d[i] = d[i + 1] = d[i + 2] = v; }
        ctx.putImageData(imgData, 0, 0);
        statusText.textContent = 'Carregando OCR...'; percentText.textContent = '10%'; progressBar.style.width = '10%';
        try {
          const worker = await Tesseract.createWorker('eng'); await worker.setParameters({ tessedit_char_whitelist: '123456789', tessedit_pageseg_mode: '10' });
          const cellSize = size / 9, recognizedInitial = Array.from({ length: 9 }, () => Array(9).fill('')), cellCanvas = document.createElement('canvas'); cellCanvas.width = 40; cellCanvas.height = 40; const cellCtx = cellCanvas.getContext('2d');
          for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
              const pct = Math.floor((((r * 9 + c) + 1) / 81) * 100); statusText.textContent = `Lendo célula (${r + 1}, ${c + 1})...`; percentText.textContent = `${pct}%`; progressBar.style.width = `${pct}%`;
              const pad = 6; cellCtx.fillStyle = '#ffffff'; cellCtx.fillRect(0, 0, 40, 40); cellCtx.drawImage(previewCanvas, c * cellSize + pad, r * cellSize + pad, cellSize - pad * 2, cellSize - pad * 2, 4, 4, 32, 32);
              const subData = cellCtx.getImageData(8, 8, 24, 24).data; let darkPixels = 0;
              for (let p = 0; p < subData.length; p += 4) if (subData[p] < 128) darkPixels++;
              if (darkPixels > 18) { const { data: { text } } = await worker.recognize(cellCanvas); recognizedInitial[r][c] = (text || '').trim().replace(/[^1-9]/g, '')[0] || ''; }
            }
          }
          await worker.terminate();
          const symbols = buildSymbolsFromRange(1, 9, false);
          const solved = solvePartialGrid(recognizedInitial, 9, 3, 3, symbols);
          
          if (!solved) {
            state.mode = 'standard'; state.difficulty = 'medio'; state.minVal = 1; state.maxVal = 9; state.includeZero = false; state.symbols = symbols; state.N = 9; state.blockR = 3; state.blockC = 3;
            state.initial = Array.from({ length: 9 }, () => Array(9).fill('')); 
            state.board = recognizedInitial.map(row => row.slice());
            state.notes = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => new Set())); state.nasaContributions = Array.from({ length: 9 }, () => Array(9).fill(false)); state.nasaCalls = 0;
            state.revealedErrors = Array.from({ length: 9 }, () => Array(9).fill(false)); 
            state.gameId = 'ocr_manual_' + Date.now(); state.gameName = 'OCR ' + new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'}); document.getElementById('game-name-input').value = state.gameName; state.timerSeconds = 0; state.completed = false;
            state.isManualCreating = true;
            syncModeTabsUI(); updateHeaderSubtitle(); renderVirtualNumpad(); renderSudokuBoard();
            document.getElementById('manual-create-bar').classList.remove('hidden'); document.getElementById('manual-create-bar').classList.add('flex');
            closeModal('modal-ocr');
            showToast('Algumas casas foram lidas com erro. Corrija os conflitos e inicie a partida.', 'warn');
            return;
          }

          state.mode = 'standard'; state.difficulty = 'medio'; state.minVal = 1; state.maxVal = 9; state.includeZero = false; state.symbols = symbols; state.N = 9; state.blockR = 3; state.blockC = 3;
          state.initial = recognizedInitial; state.solution = solved; state.board = recognizedInitial.map(row => row.slice());
          state.notes = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => new Set())); state.nasaContributions = Array.from({ length: 9 }, () => Array(9).fill(false)); state.revealedErrors = Array.from({ length: 9 }, () => Array(9).fill(false)); state.gameId = 'ocr_' + Date.now(); state.gameName = 'OCR ' + new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'}); document.getElementById('game-name-input').value = state.gameName; state.timerSeconds = 0; state.completed = false;
          syncModeTabsUI(); updateHeaderSubtitle(); renderVirtualNumpad(); renderSudokuBoard(); startTimer(); saveCurrentGameState();
          closeModal('modal-ocr'); showToast('Grade 9×9 importada via OCR com sucesso!', 'success');
        } catch (e) { statusText.textContent = 'Erro ao processar OCR.'; }
      }

      function generateSamplePrintableCanvas() {
        const c = document.createElement('canvas'); c.width = 360; c.height = 360; const ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 360, 360);
        const { initial } = createUniqueSudokuPuzzle(9, 3, 3, buildSymbolsFromRange(1, 9, false), 'facil');
        ctx.strokeStyle = '#000000';
        for (let i = 0; i <= 9; i++) { ctx.lineWidth = (i % 3 === 0) ? 3 : 1; ctx.beginPath(); ctx.moveTo(i * 40, 0); ctx.lineTo(i * 40, 360); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i * 40); ctx.lineTo(360, i * 40); ctx.stroke(); }
        ctx.fillStyle = '#000000'; ctx.font = 'bold 24px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (initial[r][c] !== '') ctx.fillText(initial[r][c], c * 40 + 20, r * 40 + 21);
        return c;
      }
