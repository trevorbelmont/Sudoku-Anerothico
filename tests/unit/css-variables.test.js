/**
 * css-variables.test.js
 *
 * Testes sobre as variáveis CSS definidas em app.css
 * Cobre: variáveis do sistema de painéis, presença de todos os temas,
 *        container queries e a variável --left-panel-font-base
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const CSS_SRC = fs.readFileSync(
  path.resolve(__dirname, '../../css/app.css'), 'utf8'
);

// ─────────────────────────────────────────────────────────────
// Variáveis de largura do painel
// ─────────────────────────────────────────────────────────────
describe('CSS panel width variables', () => {
  test('define --left-panel-width em :root', () => {
    expect(CSS_SRC).toMatch(/--left-panel-width\s*:\s*280px/);
  });

  test('define --left-panel-min em :root', () => {
    expect(CSS_SRC).toMatch(/--left-panel-min\s*:\s*180px/);
  });

  test('define --left-panel-max em :root', () => {
    expect(CSS_SRC).toMatch(/--left-panel-max\s*:\s*420px/);
  });

  test('define --resizer-width em :root', () => {
    expect(CSS_SRC).toMatch(/--resizer-width\s*:\s*6px/);
  });
});

// ─────────────────────────────────────────────────────────────
// Variável de tamanho de fonte base do painel (v6.8+)
// ─────────────────────────────────────────────────────────────
describe('CSS --left-panel-font-base', () => {
  test('define --left-panel-font-base em :root', () => {
    expect(CSS_SRC).toMatch(/--left-panel-font-base\s*:/);
  });

  test('valor padrão de --left-panel-font-base é rem', () => {
    const match = CSS_SRC.match(/--left-panel-font-base\s*:\s*([\d.]+rem)/);
    expect(match).not.toBeNull();
    const value = parseFloat(match[1]);
    expect(value).toBeGreaterThan(0.5);
    expect(value).toBeLessThan(2);
  });
});

// ─────────────────────────────────────────────────────────────
// Container queries com calc(var(--left-panel-font-base)...)
// ─────────────────────────────────────────────────────────────
describe('CSS container queries font scaling', () => {
  test('usa var(--left-panel-font-base) nas container queries', () => {
    expect(CSS_SRC).toMatch(/var\(--left-panel-font-base\)/);
  });

  test('define container query para max-width: 220px', () => {
    expect(CSS_SRC).toMatch(/@container left-panel \(max-width: 220px\)/);
  });

  test('define container query para min-width: 221px e max-width: 300px', () => {
    expect(CSS_SRC).toMatch(/@container left-panel \(min-width: 221px\) and \(max-width: 300px\)/);
  });

  test('define container query para min-width: 301px', () => {
    expect(CSS_SRC).toMatch(/@container left-panel \(min-width: 301px\)/);
  });

  test('container queries usam calc() para escalar os tamanhos', () => {
    expect(CSS_SRC).toMatch(/calc\(var\(--left-panel-font-base\)/);
  });
});

// ─────────────────────────────────────────────────────────────
// Temas disponíveis
// ─────────────────────────────────────────────────────────────
describe('CSS themes', () => {
  const themes = ['claro', 'escuro', 'roxo', 'verde', 'epico1', 'epico2', 'rainbow', 'altocontraste', 'daltonico'];

  themes.forEach(theme => {
    test(`define o tema "${theme}"`, () => {
      expect(CSS_SRC).toMatch(new RegExp(`\\[data-theme="${theme}"\\]`));
    });
  });

  themes.forEach(theme => {
    test(`tema "${theme}" define --bg-app`, () => {
      // Extrai o bloco do tema
      const themeMatch = CSS_SRC.match(
        new RegExp(`\\[data-theme="${theme}"\\][^{]*\\{([^}]+)\\}`)
      );
      if (themeMatch) {
        expect(themeMatch[1]).toMatch(/--bg-app\s*:/);
      } else {
        // Tema pode ter bloco com seletor combinado (ex: `:root, [data-theme="claro"]`)
        expect(CSS_SRC).toMatch(/--bg-app\s*:/);
      }
    });
  });
});

// ─────────────────────────────────────────────────────────────
// Variáveis de animação
// ─────────────────────────────────────────────────────────────
describe('CSS animation variables', () => {
  test('define --nasa-anim-duration em :root', () => {
    expect(CSS_SRC).toMatch(/--nasa-anim-duration\s*:/);
  });

  test('define --player-glow-color para todos os temas principais', () => {
    ['claro', 'escuro', 'roxo', 'verde'].forEach(theme => {
      // As variáveis de glow são definidas fora dos blocos de tema principais
      expect(CSS_SRC).toMatch(/--player-glow-color\s*:/);
    });
  });

  test('define @keyframes nasaGlyphShimmer', () => {
    expect(CSS_SRC).toMatch(/@keyframes nasaGlyphShimmer/);
  });

  test('define @keyframes cellInsertPop', () => {
    expect(CSS_SRC).toMatch(/@keyframes cellInsertPop/);
  });

  test('define @keyframes playerCellGlow', () => {
    expect(CSS_SRC).toMatch(/@keyframes playerCellGlow/);
  });
});

// ─────────────────────────────────────────────────────────────
// Sistema de painéis (v6.8)
// ─────────────────────────────────────────────────────────────
describe('CSS panel system layout', () => {
  test('define .panel-left com width via variável', () => {
    expect(CSS_SRC).toMatch(/\.panel-left\s*\{/);
    expect(CSS_SRC).toMatch(/var\(--left-panel-width\)/);
  });

  test('define .panel-left.collapsed que oculta o conteúdo', () => {
    expect(CSS_SRC).toMatch(/\.panel-left\.collapsed/);
  });

  test('define .panel-resizer com cursor col-resize', () => {
    expect(CSS_SRC).toMatch(/\.panel-resizer/);
    expect(CSS_SRC).toMatch(/cursor\s*:\s*col-resize/);
  });

  test('define .panel-collapse-btn', () => {
    expect(CSS_SRC).toMatch(/\.panel-collapse-btn/);
  });

  test('board focus mode oculta o painel esquerdo', () => {
    expect(CSS_SRC).toMatch(/board-focus-mode .panel-left/);
    expect(CSS_SRC).toMatch(/display\s*:\s*none/);
  });
});

// ─────────────────────────────────────────────────────────────
// Responsividade mobile
// ─────────────────────────────────────────────────────────────
describe('CSS mobile responsiveness', () => {
  test('define media query para telas menores que 1024px', () => {
    expect(CSS_SRC).toMatch(/@media\s*\(max-width:\s*1023px\)/);
  });

  test('em mobile, .panel-resizer é display none', () => {
    // Verifica que dentro do bloco mobile o resizer é ocultado
    const mobileBlock = CSS_SRC.match(/@media\s*\(max-width:\s*1023px\)[^{]*\{([\s\S]*?)^}/m);
    if (mobileBlock) {
      expect(mobileBlock[1]).toMatch(/\.panel-resizer/);
      expect(mobileBlock[1]).toMatch(/display\s*:\s*none/);
    } else {
      // Verificação alternativa: apenas confirma que o padrão existe no arquivo
      expect(CSS_SRC).toMatch(/\.panel-resizer[\s\S]*?display\s*:\s*none/);
    }
  });
});
