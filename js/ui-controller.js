'use strict';

function openModal(id) { const el = document.getElementById(id); if (el) { el.classList.remove('hidden'); el.classList.add('flex'); } }
      function closeModal(id) { const el = document.getElementById(id); if (el) { el.classList.add('hidden'); el.classList.remove('flex'); } }

      function applyTheme(themeKey) {
        document.documentElement.setAttribute('data-theme', themeKey);
        const selector = document.getElementById('theme-selector'); if (selector && selector.value !== themeKey) selector.value = themeKey;
        safeStorageSet(STORAGE_KEYS.THEME, themeKey);
        if (state.board && state.board.length > 0) renderSudokuBoard();
      }

      function syncModeTabsUI() {
        const btnStd = document.getElementById('tab-mode-standard'), btnCus = document.getElementById('tab-mode-custom'), panelStd = document.getElementById('panel-mode-standard'), panelCus = document.getElementById('panel-mode-custom');
        if (state.mode === 'standard') { btnStd.className = 'px-2.5 py-1 rounded-md btn-accent transition'; btnCus.className = 'px-2.5 py-1 rounded-md opacity-75 hover:opacity-100 transition'; panelStd.classList.remove('hidden'); panelCus.classList.add('hidden'); panelCus.classList.remove('flex'); updateDifficultyCluesUI(9); }
        else { btnCus.className = 'px-2.5 py-1 rounded-md btn-accent transition'; btnStd.className = 'px-2.5 py-1 rounded-md opacity-75 hover:opacity-100 transition'; panelCus.classList.remove('hidden'); panelCus.classList.add('flex'); panelStd.classList.add('hidden'); updateCustomRangePreview(); }
      }

      function syncDifficultyButtonsUI() {
        document.querySelectorAll('.diff-btn').forEach(b => { b.className = b.dataset.diff === state.difficulty ? 'diff-btn px-3 py-2 rounded-lg text-xs font-bold btn-accent text-left flex items-center justify-between' : 'diff-btn px-3 py-2 rounded-lg text-xs font-bold theme-panel-alt opacity-80 text-left flex items-center justify-between'; });
      }
