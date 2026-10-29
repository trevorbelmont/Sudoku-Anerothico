'use strict';

function recognizeOCRCellWithTimeout(worker, canvas, timeoutMs = 30000) {
  let timeoutId = null;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('O OCR excedeu o tempo limite para uma célula.')), timeoutMs);
  });
  return Promise.race([Promise.resolve().then(() => worker.recognize(canvas)), timeout]).finally(() => {
    if (timeoutId !== null) clearTimeout(timeoutId);
  });
}

async function processOCRImageSource(imageSource) {
        if (state.multiplayer.active && state.multiplayer.roomId) {
          showToast('Saia da sala multiplayer antes de importar uma imagem.', 'warn');
          return;
        }
        const progressBox = document.getElementById('ocr-progress-box');
        const statusText = document.getElementById('ocr-status-text');
        const percentText = document.getElementById('ocr-percent-text');
        const progressBar = document.getElementById('ocr-progress-bar');
        const previewWrapper = document.getElementById('ocr-preview-wrapper');
        const previewCanvas = document.getElementById('ocr-preview-canvas');
        const sourceWidth = Number(imageSource && (imageSource.naturalWidth || imageSource.width)) || 0;
        const sourceHeight = Number(imageSource && (imageSource.naturalHeight || imageSource.height)) || 0;
        if (!imageSource || sourceWidth <= 0 || sourceHeight <= 0 || sourceWidth > 6000 || sourceHeight > 6000) {
          showToast('A imagem não é válida ou excede 6000×6000 pixels.', 'warn');
          return;
        }
        progressBox.classList.remove('hidden'); progressBox.classList.add('flex');
        previewWrapper.classList.remove('hidden'); previewWrapper.classList.add('flex');
        let worker = null;
        const processingStartedAt = Date.now();
        try {
          const ctx = previewCanvas.getContext('2d');
          if (!ctx) throw new Error('Canvas indisponível');
          const size = 360;
          previewCanvas.width = size; previewCanvas.height = size;
          ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, size, size); ctx.drawImage(imageSource, 0, 0, size, size);
          const imgData = ctx.getImageData(0, 0, size, size), d = imgData.data;
          for (let i = 0; i < d.length; i += 4) {
            const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            const value = lum < 165 ? 0 : 255;
            d[i] = d[i + 1] = d[i + 2] = value;
          }
          ctx.putImageData(imgData, 0, 0);
          statusText.textContent = 'Carregando OCR...'; percentText.textContent = '10%'; progressBar.style.width = '10%';
          if (typeof Tesseract === 'undefined' || typeof Tesseract.createWorker !== 'function') throw new Error('Motor OCR indisponível');
          worker = await Tesseract.createWorker('eng');
          await worker.setParameters({ tessedit_char_whitelist: '123456789', tessedit_pageseg_mode: '10' });
          const cellSize = size / 9;
          const recognizedInitial = Array.from({ length: 9 }, () => Array(9).fill(''));
          const cellCanvas = document.createElement('canvas'); cellCanvas.width = 40; cellCanvas.height = 40;
          const cellCtx = cellCanvas.getContext('2d');
          if (!cellCtx) throw new Error('Canvas de célula indisponível');
          for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
              if (Date.now() - processingStartedAt > 180000) throw new Error('O OCR excedeu o limite total de três minutos.');
              const pct = Math.floor((((r * 9 + c) + 1) / 81) * 100);
              statusText.textContent = `Lendo célula (${r + 1}, ${c + 1})...`; percentText.textContent = `${pct}%`; progressBar.style.width = `${pct}%`;
              const pad = 6;
              cellCtx.fillStyle = '#ffffff'; cellCtx.fillRect(0, 0, 40, 40);
              cellCtx.drawImage(previewCanvas, c * cellSize + pad, r * cellSize + pad, cellSize - pad * 2, cellSize - pad * 2, 4, 4, 32, 32);
              const subData = cellCtx.getImageData(8, 8, 24, 24).data;
              let darkPixels = 0;
              for (let p = 0; p < subData.length; p += 4) if (subData[p] < 128) darkPixels++;
              if (darkPixels > 18) {
                const result = await recognizeOCRCellWithTimeout(worker, cellCanvas, 30000);
                const text = result && result.data ? result.data.text : '';
                recognizedInitial[r][c] = String(text || '').trim().replace(/[^1-9]/g, '')[0] || '';
              }
            }
          }
          const symbols = buildSymbolsFromRange(1, 9, false);
          const solved = solvePartialGrid(recognizedInitial, 9, 3, 3, symbols);
          const commonSetup = () => {
            state.mode = 'standard'; state.difficulty = 'medio'; state.minVal = 1; state.maxVal = 9; state.includeZero = false;
            state.symbols = symbols; state.N = 9; state.blockR = 3; state.blockC = 3;
            state.notes = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => new Set()));
            state.nasaContributions = Array.from({ length: 9 }, () => Array(9).fill(false)); state.nasaCalls = 0;
            state.revealedErrors = Array.from({ length: 9 }, () => Array(9).fill(false));
            state.gameId = createClientIdentifier('ocr_');
            state.gameName = 'OCR ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            const gameNameInput = document.getElementById('game-name-input'); if (gameNameInput) gameNameInput.value = state.gameName;
            state.timerSeconds = 0; state.completed = false; state.focusedCell = { r: 0, c: 0 }; state.highlightedSymbol = null;
          };
          commonSetup();
          if (!solved) {
            // OCR recognition may contain conflicts. Preserve the recognized digits for manual correction.
            state.initial = Array.from({ length: 9 }, () => Array(9).fill(''));
            state.solution = Array.from({ length: 9 }, () => Array(9).fill(''));
            state.board = recognizedInitial.map(row => row.slice());
            state.isManualCreating = true;
            pauseTimer();
            syncModeTabsUI(); updateHeaderSubtitle(); renderVirtualNumpad(); renderSudokuBoard(); updateProgressUI();
            document.getElementById('manual-create-bar').classList.remove('hidden'); document.getElementById('manual-create-bar').classList.add('flex');
            closeModal('modal-ocr'); saveCurrentGameState();
            showToast('Algumas casas foram lidas com erro. Corrija os conflitos e inicie a partida.', 'warn');
            return;
          }
          state.initial = recognizedInitial.map(row => row.slice());
          state.solution = solved.map(row => row.slice());
          state.board = recognizedInitial.map(row => row.slice());
          state.isManualCreating = false;
          const manualBar = document.getElementById('manual-create-bar');
          if (manualBar) { manualBar.classList.remove('flex'); manualBar.classList.add('hidden'); }
          syncModeTabsUI(); updateHeaderSubtitle(); renderVirtualNumpad(); renderSudokuBoard(); updateProgressUI();
          startTimer(); saveCurrentGameState(); closeModal('modal-ocr');
          showToast('Grade 9×9 importada via OCR com sucesso!', 'success');
        } catch (error) {
          statusText.textContent = 'Erro ao processar OCR.';
          showToast('Não foi possível processar essa imagem. Tente uma imagem menor ou mais nítida.', 'warn');
          console.warn('Falha no processamento OCR:', error);
        } finally {
          if (worker) {
            try { await worker.terminate(); } catch (error) { console.warn('Não foi possível encerrar o worker OCR.', error); }
          }
          progressBar.style.width = '0%';
          // Object URLs created for uploaded files are revoked by the file-input handler on load/error.
        }
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
