'use strict';

const DEV_MODE_KEY = APP_CONFIG.DEV_MODE_KEY;
let devModeActive = false;
let devClickCount = 0;
let devClickFirstAt = 0;
const DEV_CLICK_TARGET = APP_CONFIG.DEV_MODE_CLICKS_REQUIRED;
const DEV_CLICK_WINDOW_MS = APP_CONFIG.DEV_MODE_TIME_WINDOW_MS;

function refreshDevModeSectionVisibility() {
  const section = document.getElementById('dev-mode-section');
  if (!section) return;
  if (devModeActive) { section.classList.remove('hidden'); section.classList.add('flex'); }
  else { section.classList.add('hidden'); section.classList.remove('flex'); }
}

function toggleDevMode() {
  devModeActive = !devModeActive;
  try { sessionStorage.setItem(DEV_MODE_KEY, devModeActive ? '1' : '0'); } catch (_) {}
  
  const logo = document.querySelector('.header-logo');
  if (logo) {
      if (devModeActive) logo.classList.add('dev-mode-active');
      else logo.classList.remove('dev-mode-active');
  }
  
  if (devModeActive) {
      showToast('⚠️ MODO DESENVOLVEDOR ATIVADO 🚀', 'dev-mode');
  } else {
      showToast('Modo Desenvolvedor Desativado', 'dev-mode-off');
  }
  refreshDevModeSectionVisibility();
}

function initDevModeLogoEasterEgg() {
  const logo = document.querySelector('.header-logo');
  if (!logo) return;
  
  logo.addEventListener('click', () => {
    // Animação de Mola no clique
    logo.classList.remove('logo-spring-anim');
    void logo.offsetWidth; // Força o reflow para reiniciar a animação
    logo.classList.add('logo-spring-anim');

    // Lógica dos 9 cliques
    const now = Date.now();
    if (now - devClickFirstAt > DEV_CLICK_WINDOW_MS) { devClickCount = 1; devClickFirstAt = now; }
    else { devClickCount++; }
    if (devClickCount >= DEV_CLICK_TARGET) {
      devClickCount = 0; devClickFirstAt = 0;
      toggleDevMode();
    }
  });
}

function initDevModeCleanupButtons() {
  const btnVisual = document.getElementById('dev-reset-visual');
  const btnHistory = document.getElementById('dev-clear-history');
  const btnNuclear = document.getElementById('dev-nuclear');

  if (btnVisual) btnVisual.addEventListener('click', () => {
    if (!window.confirm('Resetar TODAS as configurações visuais? Ação irreversível.')) return;
    try { localStorage.removeItem(STORAGE_KEYS.VISUAL_SETTINGS); } catch (_) {}
    showToast('Configurações visuais resetadas. Recarregando...', 'success');
    setTimeout(() => location.reload(), 700);
  });

  if (btnHistory) btnHistory.addEventListener('click', () => {
    if (!window.confirm('Apagar TODOS os jogos salvos? Ação irreversível.')) return;
    try {
      localStorage.removeItem(STORAGE_KEYS.SAVED_GAMES);
      localStorage.removeItem(STORAGE_KEYS.CURRENT_GAME_ID);
    } catch (_) {}
    showToast('Histórico de jogos apagado. Recarregando...', 'success');
    setTimeout(() => location.reload(), 700);
  });

  if (btnNuclear) btnNuclear.addEventListener('click', () => {
    if (!window.confirm('RESET DE FÁBRICA NUCLEAR: apaga TODOS os dados locais. Confirmar?')) return;
    try { localStorage.clear(); } catch (_) {}
    showToast('Reset de fábrica concluído. Recarregando...', 'success');
    setTimeout(() => location.reload(), 700);
  });
}

function initDevMode() {
  try { devModeActive = sessionStorage.getItem(DEV_MODE_KEY) === '1'; } catch (_) {}
  const logo = document.querySelector('.header-logo');
  if (logo && devModeActive) logo.classList.add('dev-mode-active');
  
  initDevModeLogoEasterEgg();
  initDevModeCleanupButtons();
  refreshDevModeSectionVisibility();
}