'use strict';

/* ============================================================
   v6.8 — Panel System: Resizable & Collapsible Side Panels
   Autor: Sudoku Aneróthico PRÓ
   ============================================================
   Responsabilidades:
   - Inicializar o layout de painéis com as classes corretas
   - Implementar redimensionamento arrastável (.panel-resizer)
   - Implementar colapso/expansão do painel esquerdo (.collapsed)
   - Persistir largura e estado colapsado no localStorage
   - Disparar re-render do tabuleiro ao redimensionar painéis
   ============================================================ */

(function PanelSystem() {

  /* ── Constantes de persistência ── */
  var STORAGE_LEFT_WIDTH   = 'sudoku_anerothico_left_panel_width_v1';
  var STORAGE_LEFT_COLLAPSED = 'sudoku_anerothico_left_panel_collapsed_v1';

  /* ── Limites de largura (em px) ── */
  var LEFT_MIN_PX  = 180;
  var LEFT_MAX_PX  = 420;
  var LEFT_DEFAULT = 280;

  /* ── Estado interno ── */
  var leftWidth     = LEFT_DEFAULT;
  var leftCollapsed = false;

  /* ── Referências a elementos ── */
  var panelLeft     = null;
  var resizerLeft   = null;
  var collapseBtn   = null;

  /* ────────────────────────────────────────────
     Carrega estado salvo do localStorage
  ──────────────────────────────────────────── */
  function loadSavedState() {
    try {
      var w = parseInt(localStorage.getItem(STORAGE_LEFT_WIDTH), 10);
      if (!isNaN(w) && w >= LEFT_MIN_PX && w <= LEFT_MAX_PX) leftWidth = w;
    } catch (_) {}
    try {
      leftCollapsed = localStorage.getItem(STORAGE_LEFT_COLLAPSED) === 'true';
    } catch (_) {}
  }

  /* ────────────────────────────────────────────
     Persiste estado no localStorage
  ──────────────────────────────────────────── */
  function saveState() {
    try { localStorage.setItem(STORAGE_LEFT_WIDTH, String(leftWidth)); } catch (_) {}
    try { localStorage.setItem(STORAGE_LEFT_COLLAPSED, leftCollapsed ? 'true' : 'false'); } catch (_) {}
  }

  /* ────────────────────────────────────────────
     Aplica a largura e o estado de colapso ao DOM
  ──────────────────────────────────────────── */
  function applyPanelState(animate) {
    if (!panelLeft) return;

    /* Largura via variável CSS no :root */
    document.documentElement.style.setProperty('--left-panel-width', leftWidth + 'px');

    /* Classe de colapso */
    if (leftCollapsed) {
      panelLeft.classList.add('collapsed');
    } else {
      panelLeft.classList.remove('collapsed');
    }

    /* Acessibilidade do botão */
    updateCollapseButtonUI();

    /* Notifica re-render do tabuleiro após a transição CSS */
    var delay = animate ? 300 : 0;
    setTimeout(function () {
      if (typeof renderSudokuBoard === 'function' && typeof state !== 'undefined' && state.board && state.board.length) {
        renderSudokuBoard();
      }
    }, delay);
  }

  /* ────────────────────────────────────────────
     Atualiza o ícone e aria do botão de colapso
  ──────────────────────────────────────────── */
  function updateCollapseButtonUI() {
    if (!collapseBtn) return;
    var icon = collapseBtn.querySelector('.icon-collapse');
    if (leftCollapsed) {
      collapseBtn.setAttribute('aria-label', 'Expandir painel lateral');
      collapseBtn.setAttribute('title', 'Expandir painel lateral');
      if (icon) icon.innerHTML = '<i class="fa-solid fa-chevron-right" style="font-size:8px;"></i>';
    } else {
      collapseBtn.setAttribute('aria-label', 'Recolher painel lateral');
      collapseBtn.setAttribute('title', 'Recolher painel lateral');
      if (icon) icon.innerHTML = '<i class="fa-solid fa-chevron-left" style="font-size:8px;"></i>';
    }
  }

  /* ────────────────────────────────────────────
     Cria o botão de colapso e o insere no painel
  ──────────────────────────────────────────── */
  function createCollapseButton() {
    collapseBtn = document.createElement('button');
    collapseBtn.type = 'button';
    collapseBtn.className = 'panel-collapse-btn';
    collapseBtn.setAttribute('aria-label', 'Recolher painel lateral');
    collapseBtn.setAttribute('title', 'Recolher painel lateral');
    collapseBtn.setAttribute('aria-expanded', 'true');
    collapseBtn.setAttribute('aria-controls', 'panel-left');
    collapseBtn.innerHTML = '<span class="icon-collapse"><i class="fa-solid fa-chevron-left" style="font-size:8px;"></i></span>';

    collapseBtn.addEventListener('click', function () {
      leftCollapsed = !leftCollapsed;
      collapseBtn.setAttribute('aria-expanded', leftCollapsed ? 'false' : 'true');
      applyPanelState(true);
      saveState();
    });

    /* Também cria o botão mobile na parte superior do painel */
    var mobileWrapper = document.createElement('div');
    mobileWrapper.className = 'panel-collapse-btn-wrapper';
    var mobileBtn = document.createElement('button');
    mobileBtn.type = 'button';
    mobileBtn.className = 'panel-collapse-btn theme-panel-alt';
    mobileBtn.style.cssText = 'position:static; transform:none; border-radius:8px; border:1px solid var(--board-border-cell); width:32px; height:32px; box-shadow:none; display:flex; align-items:center; justify-content:center;';
    mobileBtn.setAttribute('aria-label', 'Recolher painel');
    mobileBtn.setAttribute('title', 'Recolher/expandir painel');
    mobileBtn.innerHTML = '<i class="fa-solid fa-chevron-up" style="font-size:9px;"></i>';
    mobileBtn.addEventListener('click', function () {
      leftCollapsed = !leftCollapsed;
      /* No mobile, muda direção do ícone */
      var ic = mobileBtn.querySelector('i');
      if (ic) {
        ic.className = leftCollapsed
          ? 'fa-solid fa-chevron-down'
          : 'fa-solid fa-chevron-up';
        ic.style.fontSize = '9px';
      }
      applyPanelState(true);
      saveState();
    });
    mobileWrapper.appendChild(mobileBtn);

    if (panelLeft) {
      panelLeft.insertBefore(mobileWrapper, panelLeft.firstChild);
      panelLeft.appendChild(collapseBtn);
    }
  }

  /* ────────────────────────────────────────────
     Cria o divisor arrastável (resizer)
  ──────────────────────────────────────────── */
  function createResizer() {
    resizerLeft = document.createElement('div');
    resizerLeft.className = 'panel-resizer';
    resizerLeft.setAttribute('aria-hidden', 'true');
    resizerLeft.setAttribute('role', 'separator');
    resizerLeft.setAttribute('title', 'Arraste para redimensionar o painel');

    /* Insere o resizer entre o painel esquerdo e a área central */
    if (panelLeft && panelLeft.parentNode) {
      panelLeft.parentNode.insertBefore(resizerLeft, panelLeft.nextSibling);
    }

    /* ── Lógica de arrastar ── */
    var dragging = false;
    var startX   = 0;
    var startW   = 0;

    resizerLeft.addEventListener('mousedown', function (e) {
      if (leftCollapsed) return;
      dragging = true;
      startX   = e.clientX;
      startW   = leftWidth;
      resizerLeft.classList.add('dragging');
      document.body.style.cursor    = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    /* Touch support */
    resizerLeft.addEventListener('touchstart', function (e) {
      if (leftCollapsed) return;
      dragging = true;
      startX   = e.touches[0].clientX;
      startW   = leftWidth;
      resizerLeft.classList.add('dragging');
      document.body.style.userSelect = 'none';
      e.preventDefault();
    }, { passive: false });

    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      var delta    = e.clientX - startX;
      var newWidth = Math.min(LEFT_MAX_PX, Math.max(LEFT_MIN_PX, startW + delta));
      leftWidth    = Math.round(newWidth);
      document.documentElement.style.setProperty('--left-panel-width', leftWidth + 'px');
    });

    window.addEventListener('touchmove', function (e) {
      if (!dragging) return;
      var delta    = e.touches[0].clientX - startX;
      var newWidth = Math.min(LEFT_MAX_PX, Math.max(LEFT_MIN_PX, startW + delta));
      leftWidth    = Math.round(newWidth);
      document.documentElement.style.setProperty('--left-panel-width', leftWidth + 'px');
    }, { passive: true });

    window.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false;
      resizerLeft.classList.remove('dragging');
      document.body.style.cursor     = '';
      document.body.style.userSelect = '';
      saveState();
      /* Re-render do tabuleiro após soltar o mouse */
      if (typeof renderSudokuBoard === 'function' && typeof state !== 'undefined' && state.board && state.board.length) {
        renderSudokuBoard();
      }
    });

    window.addEventListener('touchend', function () {
      if (!dragging) return;
      dragging = false;
      resizerLeft.classList.remove('dragging');
      document.body.style.userSelect = '';
      saveState();
      if (typeof renderSudokuBoard === 'function' && typeof state !== 'undefined' && state.board && state.board.length) {
        renderSudokuBoard();
      }
    });
  }

  /* ────────────────────────────────────────────
     Inicialização principal
  ──────────────────────────────────────────── */
  function init() {
    var mainEl = document.querySelector('main');
    if (!mainEl) return;

    /* Adiciona classe de controle ao main para ativar o layout flex */
    mainEl.classList.add('app-main-layout');

    /* Localiza as seções já existentes do layout */
    var sections = mainEl.querySelectorAll(':scope > section');
    if (sections.length < 2) return;

    /* A primeira section (order-2 lg:order-1) é o painel esquerdo */
    /* A segunda section (order-1 lg:order-2) é a área central */
    var leftSection   = null;
    var centerSection = null;

    sections.forEach(function (sec) {
      /* Identifica pelo col-span via classList (Tailwind usa ':' literal como classe) */
      if (sec.classList.contains('lg:col-span-2')) {
        leftSection = sec;
      } else if (sec.classList.contains('lg:col-span-10')) {
        centerSection = sec;
      }
    });

    /* Fallback: primeira e segunda section */
    if (!leftSection)   leftSection   = sections[0];
    if (!centerSection) centerSection = sections[1];

    if (!leftSection || !centerSection) return;

    /* Adiciona IDs e classes do sistema de painéis */
    leftSection.id  = 'panel-left';
    leftSection.classList.add('panel-left');
    centerSection.classList.add('panel-center');

    panelLeft = leftSection;

    /* Remove classes Tailwind de grid que seriam sobrescritas pelo flex */
    /* (mantém as demais classes intactas; apenas desativa o posicionamento de grid) */
    var tailwindGridClasses = [
      'lg:col-span-2', 'lg:col-span-10',
      'order-2', 'order-1', 'lg:order-1', 'lg:order-2'
    ];
    tailwindGridClasses.forEach(function (cls) {
      leftSection.classList.remove(cls);
      centerSection.classList.remove(cls);
    });

    /* Carrega estado salvo e cria os elementos interativos */
    loadSavedState();
    createCollapseButton();
    createResizer();
    applyPanelState(false);
  }

  /* ────────────────────────────────────────────
     Ponto de entrada: aguarda o DOM
  ──────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
