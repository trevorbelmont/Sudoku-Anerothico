'use strict';

async function exportBoardAsPNG() {
        showToast('Gerando imagem PNG de alta definição...', 'info');
        const wrapper = document.getElementById('sudoku-board-wrapper');
        const nameInput = document.getElementById('game-name-input');
        
        // Converte o input de nome temporariamente para div para o html2canvas renderizar o texto corretamente
        const tempNameDisplay = document.createElement('div');
        tempNameDisplay.className = 'text-sm font-bold text-center px-2';
        tempNameDisplay.textContent = nameInput.value.trim() || 'Sudoku Sem Nome';
        tempNameDisplay.style.cssText = 'display:block;width:max-content;max-width:none;white-space:nowrap;overflow:visible;word-break:keep-all;overflow-wrap:normal;line-height:1.25;flex:0 0 auto;';
        const nameContainer = nameInput.parentNode;
        nameContainer.style.width = 'max-content';
        nameContainer.style.maxWidth = 'none';
        nameInput.style.display = 'none';
        nameContainer.insertBefore(tempNameDisplay, nameInput);

        try {
          const canvas = await html2canvas(wrapper, { backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--bg-app').trim() || '#ffffff', scale: 2, useCORS: true, logging: false });
          const link = document.createElement('a'); link.download = `Sudoku-Anerothico-PRO-${state.N}x${state.N}.png`; link.href = canvas.toDataURL('image/png'); link.click();
          showToast('Imagem .PNG exportada com sucesso!', 'success');
        } catch (e) { 
          showToast('Erro ao exportar PNG.', 'warn'); 
        } finally {
          // Reverte as alterações do DOM
          tempNameDisplay.remove();
          nameInput.style.display = '';
          nameContainer.style.width = '';
          nameContainer.style.maxWidth = '';
        }
      }
