'use strict';

/**
 * Exporta o tabuleiro como PNG sem alterar permanentemente a interface.
 * O cabeçalho da imagem contém o nome da partida/sala e metadados compactos.
 * Os controles de zoom e os elementos interativos são excluídos do PNG.
 */
async function exportBoardAsPNG() {
  const wrapper = document.getElementById('sudoku-board-wrapper');
  const nameInput = document.getElementById('game-name-input');

  if (!wrapper) {
    if (typeof showToast === 'function') showToast('Não foi possível localizar o tabuleiro para exportar.', 'warn');
    return;
  }
  if (typeof window.html2canvas !== 'function') {
    if (typeof showToast === 'function') showToast('O exportador de imagem não carregou. Verifique a conexão e tente novamente.', 'warn');
    return;
  }

  if (typeof showToast === 'function') showToast('Gerando imagem PNG de alta definição...', 'info');

  const safeText = (value, fallback = '') => {
    const text = String(value ?? '').trim();
    return text || fallback;
  };
  const difficulty = (() => {
    try {
      return (typeof DIFFICULTY_LABELS !== 'undefined' && DIFFICULTY_LABELS[state.difficulty])
        || safeText(state.difficulty, 'Não informada');
    } catch (_) { return 'Não informada'; }
  })();
  const dimension = (() => {
    try { return `${Number(state.N) || 9}×${Number(state.N) || 9}`; }
    catch (_) { return '9×9'; }
  })();
  const roomLabel = safeText(document.getElementById('current-room-id-label')?.textContent, '');
  let gameName = safeText(nameInput?.value, '');
  try { gameName ||= safeText(state.gameName, ''); } catch (_) { /* state indisponível */ }
  if (!gameName && roomLabel && roomLabel !== '---') gameName = `Sala ${roomLabel}`;
  gameName ||= 'Sudoku Sem Nome';

  const now = new Date();
  const generatedAt = now.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  let stage;
  try {
    // A cópia fica fora da tela, mas permanece renderizável pelo html2canvas.
    stage = document.createElement('section');
    stage.id = 'png-export-stage';
    stage.setAttribute('aria-hidden', 'true');
    const pageBg = getComputedStyle(document.documentElement).getPropertyValue('--bg-app').trim() || '#ffffff';
    const panelBg = getComputedStyle(document.body).backgroundColor || pageBg;
    Object.assign(stage.style, {
      position: 'fixed', left: '-20000px', top: '0', zIndex: '-1',
      display: 'flex', flexDirection: 'column', alignItems: 'stretch',
      width: `${Math.max(320, Math.ceil(wrapper.getBoundingClientRect().width))}px`,
      boxSizing: 'border-box', padding: '18px', gap: '12px',
      background: pageBg, color: getComputedStyle(document.body).color || '#111827',
      fontFamily: getComputedStyle(document.body).fontFamily || 'Arial, sans-serif'
    });

    const heading = document.createElement('header');
    Object.assign(heading.style, {
      display: 'flex', flexDirection: 'column', gap: '5px',
      padding: '10px 12px', borderRadius: '12px',
      background: panelBg, boxSizing: 'border-box',
      border: '1px solid rgba(148,163,184,.35)',
      overflow: 'visible'
    });
    const title = document.createElement('div');
    title.textContent = gameName;
    Object.assign(title.style, {
      fontSize: '18px', fontWeight: '800', lineHeight: '1.25',
      whiteSpace: 'normal', overflowWrap: 'anywhere'
    });
    const metadata = document.createElement('div');
    metadata.textContent = `Grade ${dimension}  ·  Dificuldade: ${difficulty}  ·  Gerado em ${generatedAt}`;
    Object.assign(metadata.style, {
      fontSize: '10px', fontWeight: '600', lineHeight: '1.4',
      opacity: '.82', whiteSpace: 'normal', overflowWrap: 'anywhere'
    });
    heading.append(title, metadata);
    stage.appendChild(heading);

    const boardClone = wrapper.cloneNode(true);
    boardClone.removeAttribute('id');
    Object.assign(boardClone.style, {
      width: '100%', maxWidth: 'none', margin: '0',
      position: 'relative', overflow: 'visible', transform: 'none'
    });

    // O zoom é uma ferramenta da interface e não faz parte da imagem exportada.
    boardClone.querySelectorAll('#board-zoom-controls, #pause-overlay, #manual-create-bar').forEach(el => el.remove());
    // html2canvas nem sempre pinta o value atual de inputs flex/centralizados.
    // Substitui SOMENTE no clone de exportação os campos .sudoku-input por divs
    // com a mesma classe/estilo e com o valor vivo da célula. O tabuleiro real
    // nunca é alterado; o clone inteiro é descartado no finally.
    boardClone.querySelectorAll('.sudoku-input').forEach(clonedInput => {
      const cell = clonedInput.closest('.sudoku-cell');
      const row = cell ? Number(cell.dataset.r) : NaN;
      const column = cell ? Number(cell.dataset.c) : NaN;
      const originalInput = Number.isInteger(row) && Number.isInteger(column)
        ? wrapper.querySelector(`#cell-input-${row}-${column}`)
        : null;
      const printableCell = document.createElement('div');
      printableCell.className = clonedInput.className;
      printableCell.style.cssText = clonedInput.style.cssText;
      printableCell.textContent = originalInput ? originalInput.value : clonedInput.value;
      const ariaLabel = clonedInput.getAttribute('aria-label');
      if (ariaLabel) printableCell.setAttribute('aria-label', ariaLabel);
      printableCell.setAttribute('aria-hidden', 'true');
      clonedInput.replaceWith(printableCell);
    });

    // Remove apenas controles da cópia; as divs que representam os números ficam visíveis.
    boardClone.querySelectorAll('button, input, select, textarea').forEach(el => el.remove());
    stage.appendChild(boardClone);
    document.body.appendChild(stage);

    // Aguarda layout e fontes antes da captura para reduzir falhas de renderização.
    if (document.fonts?.ready) await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const canvas = await window.html2canvas(stage, {
      backgroundColor: pageBg,
      scale: Math.min(3, Math.max(2, window.devicePixelRatio || 2)),
      useCORS: true,
      allowTaint: false,
      logging: false,
      imageTimeout: 15000,
      scrollX: 0,
      scrollY: 0
    });

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(result => result ? resolve(result) : reject(new Error('Não foi possível codificar a imagem PNG.')), 'image/png');
    });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `Sudoku-Anerothico-PRO-${dimension.replace('×', 'x')}.png`;
    link.href = objectUrl;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
    if (typeof showToast === 'function') showToast('Imagem PNG exportada com nome e metadados!', 'success');
  } catch (error) {
    console.error('[Sudoku PNG export]', error);
    if (typeof showToast === 'function') showToast('Erro ao exportar PNG. Confira o console do navegador para detalhes.', 'warn');
  } finally {
    stage?.remove();
  }
}

// Mantém compatibilidade com os módulos clássicos e com os botões já existentes.
window.exportBoardAsPNG = exportBoardAsPNG;
