'use strict';

      function showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        const iconMap = { info: 'fa-circle-info', success: 'fa-circle-check', warn: 'fa-triangle-exclamation', 'dev-mode': 'fa-rocket', 'dev-mode-off': 'fa-power-off' };
        
        toast.className = 'theme-panel px-4 py-3 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2.5 shadow-xl border pointer-events-auto transition-all duration-300';
        toast.style.borderColor = 'var(--accent)';
        
        const icon = document.createElement('i');
        icon.className = `fa-solid ${iconMap[type] || iconMap.info}`;
        icon.style.color = 'var(--accent)';
        
        // Estilos ultra-chamativos
        if (type === 'dev-mode') {
            toast.style.background = 'linear-gradient(135deg, #FF0080, #7928CA)'; // Rosa Choque para Roxo
            toast.style.color = '#ffffff';
            toast.style.border = 'none';
            toast.style.boxShadow = '0 0 25px rgba(255, 0, 128, 0.6)';
            icon.style.color = '#ffffff';
            icon.classList.add('fa-beat-fade'); // Faz o foguete piscar e bater!
        } else if (type === 'dev-mode-off') {
            toast.style.background = 'linear-gradient(135deg, #1f2937, #111827)'; // Escuro
            toast.style.color = '#ffffff';
            toast.style.border = '1px solid #4b5563';
            icon.style.color = '#fbbf24'; // Amarelo de atenção
        }
        
        const textSpan = document.createElement('span');
        textSpan.textContent = message;
        
        toast.appendChild(icon);
        toast.appendChild(textSpan);
        container.appendChild(toast);
        
        setTimeout(() => {
          toast.style.opacity = '0';
          toast.style.transform = 'translateY(8px)';
          setTimeout(() => toast.remove(), 300);
        }, 3200);
      }

      function formatTime(totalSeconds) {
        const mins = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;
        const hrs = Math.floor(mins / 60);
        if (hrs > 0) return `${String(hrs).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      }
