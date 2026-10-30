'use strict';

// Modo Desenvolvedor: Easter egg de ativação (9 cliques rápidos no logo do cabeçalho)
// e opções de limpeza de armazenamento local no modal de Configurações Visuais.
// Nenhuma lógica, regra ou estética do tabuleiro é alterada por este módulo.
// Toda a interação é aditiva e restrita a ferramentas de manutenção no front-end.

const DEV_MODE_KEY = 'sudoku_anerothico_dev_mode_v1';
let devModeActive = false;
let devClickCount = 0;
let devClickFirstAt = 0;
const DEV_CLICK_TARGET = 9;
const DEV_CLICK_WINDOW_MS = 4000;

// Mostra/oculta a seção de limpeza no modal de Configurações Visuais conforme o estado do Modo Desenvolvedor.
function refreshDevModeSectionVisibility() {
  const section = document.getElementById('dev-mode-section');
  if (!section) return;
  if (devModeActive) { section.classList.remove('hidden'); section.classList.add('flex'); }
  else { section.classList.add('hidden'); section.classList.remove('flex'); }
}

function activateDevMode() {
  if (devModeActive) return;
  devModeActive = true;
  try { sessionStorage.setItem(DEV_MODE_KEY, '1'); } catch (_) {}
  showToast('Modo Desenvolvedor Ativado', 'success');
  refreshDevModeSectionVisibility();
}

// Easter egg: contar 9 cliques rápidos no logo "9" do cabeçalho.
function initDevModeLogoEasterEgg() {
  const logo = document.querySelector('.header-logo');
  if (!logo) return;
  logo.addEventListener('click', () => {
    const now = Date.now();
    if (now - devClickFirstAt > DEV_CLICK_WINDOW_MS) { devClickCount = 1; devClickFirstAt = now; }
    else { devClickCount++; }
    if (devClickCount >= DEV_CLICK_TARGET) {
      devClickCount = 0; devClickFirstAt = 0;
      activateDevMode();
    }
  });
}

// Associa as três ações de limpeza, cada uma exigindo confirmação nativa (window.confirm)
// antes de remover as chaves exatas do localStorage (ou localStorage.clear() no Nuclear).
function initDevModeCleanupButtons() {
  const btnVisual = document.getElementById('dev-reset-visual');
  const btnHistory = document.getElementById('dev-clear-history');
  const btnNuclear = document.getElementById('dev-nuclear');

  if (btnVisual) btnVisual.addEventListener('click', () => {
    if (!window.confirm('Resetar TODAS as configurações visuais (glow, animações, cores)? Esta ação é irreversível.')) return;
    try { localStorage.removeItem(STORAGE_KEYS.VISUAL_SETTINGS); } catch (_) {}
    showToast('Configurações visuais resetadas. Recarregando...', 'success');
    setTimeout(() => location.reload(), 700);
  });

  if (btnHistory) btnHistory.addEventListener('click', () => {
    if (!window.confirm('Apagar TODOS os jogos salvos e a partida atual? Ação irreversível e não pode ser desfeita.')) return;
    try {
      localStorage.removeItem(STORAGE_KEYS.SAVED_GAMES);
      localStorage.removeItem(STORAGE_KEYS.CURRENT_GAME_ID);
    } catch (_) {}
    showToast('Histórico de jogos apagado. Recarregando...', 'success');
    setTimeout(() => location.reload(), 700);
  });

  if (btnNuclear) btnNuclear.addEventListener('click', () => {
    if (!window.confirm('RESET DE FÁBRICA NUCLEAR: apaga TODOS os dados locais (jogos, configurações visuais, tema, nome multiplayer). Irreversível. Confirmar?')) return;
    try { localStorage.clear(); } catch (_) {}
    showToast('Reset de fábrica concluído. Recarregando...', 'success');
    setTimeout(() => location.reload(), 700);
  });
}

function initDevMode() {
  try { devModeActive = sessionStorage.getItem(DEV_MODE_KEY) === '1'; } catch (_) {}
  initDevModeLogoEasterEgg();
  initDevModeCleanupButtons();
  refreshDevModeSectionVisibility();
}
