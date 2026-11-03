'use strict';

// ============================================================================
// ARQUIVO: js/config.js
// Central de Configurações da Aplicação (App Config)
// ----------------------------------------------------------------------------
// Single Source of Truth para todos os "magic numbers" e "magic strings"
// que antes estavam espalhados pelos módulos (app-state, dev-mode, gameplay,
// game-storage, multiplayer-voting, app-events, etc.) e no index.html.
//
// Para alterar o comportamento padrão do Sudoku, modifique estes valores e
// a aplicação inteira obedece — sem precisar caçar variáveis em vários arquivos.
//
// ATENÇÃO: As chaves de STORAGE já existem no localStorage dos usuários.
//          Alterá-las faria com que jogos salvos e preferências fossem perdidos.
//
// O servidor-local.ps1 e o Iniciar-Sudoku.bat também lêem APP_VERSION deste
// arquivo em tempo de execução, mantendo a versão sincronizada em todos os
// pontos de exibição (título da aba, cabeçalho, rodapé, banner do terminal).
// ============================================================================

const APP_CONFIG = {

  // ── 🏷️ Identidade da Aplicação ─────────────────────────────────────────
  // A versão exibida em todo lugar (aba do navegador, cabeçalho, rodapé,
  // banner do PowerShell, project.json, README) parte sempre daqui.
  /** Nome curto da aplicação, sem versão nem emoji. */
  APP_NAME: 'Sudoku Aneróthico PRÓ',
  /** Versão canônica com prefixo "v" (ex: 'v6.8'). */
  APP_VERSION: 'v6.8',
  /** Versão sem prefixo "v", para compatibilidade com project.json (ex: '6.8'). */
  APP_VERSION_NUMBER: '6.8',
  /** Emoji que acompanha o título em interfaces e notificações. */
  APP_EMOJI: '🧠',
  /** Título completo exibido na aba do navegador: Nome + Versão + Emoji. */
  APP_TITLE: 'Sudoku Aneróthico PRÓ v6.8 🧠',

  // ── 🎨 UI & Experiência do Usuário ──────────────────────────────────────
  /** Tema carregado na primeira visita (antes de existir dado salvo no navegador). */
  DEFAULT_THEME: 'rainbow',
  /** Dificuldade selecionada por padrão ao abrir a página. */
  DEFAULT_DIFFICULTY: 'facil',
  /** Modo de jogo padrão ('standard' = grade clássica, 'custom' = intervalo livre). */
  DEFAULT_MODE: 'standard',

  // ── 🧠 Motor do Sudoku ──────────────────────────────────────────────────
  /** Tamanho padrão da grade (N×N). */
  DEFAULT_GRID_SIZE: 9,
  /** Linhas por bloco na grade padrão. */
  DEFAULT_BLOCK_ROWS: 3,
  /** Colunas por bloco na grade padrão. */
  DEFAULT_BLOCK_COLS: 3,
  /** Valor mínimo do intervalo de símbolos na grade padrão. */
  DEFAULT_MIN_VAL: 1,
  /** Valor máximo do intervalo de símbolos na grade padrão. */
  DEFAULT_MAX_VAL: 9,
  /** Se o número 0 deve ser incluído no intervalo padrão. */
  DEFAULT_INCLUDE_ZERO: false,
  /** Símbolos padrão da grade 9×9 (referência; o motor recria via buildSymbolsFromRange). */
  DEFAULT_SYMBOLS: ['1', '2', '3', '4', '5', '6', '7', '8', '9'],

  // ── ⏱️ Timer & Persistência ─────────────────────────────────────────────
  /** Intervalo do cronômetro em milissegundos. */
  TIMER_INTERVAL_MS: 1000,
  /** A cada quantos segundos o estado da partida é salvo automaticamente. */
  TIMER_AUTOSAVE_INTERVAL_S: 5,
  /** Número máximo de partidas mantidas no histórico de jogos salvos. */
  MAX_SAVED_GAMES: 35,
  /** Texto exibido no cronômetro antes de a partida começar. */
  TIMER_DISPLAY_INITIAL: '00:00',

  // ── 📝 UI: Limites de Texto e Zoom ─────────────────────────────────────
  /** Número máximo de caracteres no nome da partida. */
  GAME_NAME_MAX_LENGTH: 80,
  /** Altura máxima (px) do textarea do nome da partida antes de rolar. */
  GAME_NAME_TEXTAREA_MAX_HEIGHT: 64,
  /** Zoom mínimo do tabuleiro (percentual). */
  BOARD_ZOOM_MIN: 50,
  /** Zoom máximo do tabuleiro (percentual). */
  BOARD_ZOOM_MAX: 500,
  /** Passo de incremento/decremento do zoom do tabuleiro. */
  BOARD_ZOOM_STEP: 25,
  /** Zoom padrão do tabuleiro ao iniciar (percentual). */
  BOARD_ZOOM_DEFAULT: 100,
  /** Valor mínimo aceito nos inputs de intervalo personalizado. */
  CUSTOM_RANGE_MIN: -50,
  /** Valor máximo aceito nos inputs de intervalo personalizado. */
  CUSTOM_RANGE_MAX: 50,

  // ── 🚀 Funcionalidades Premium (NASA & Efeitos Visuais) ──────────────────
  /** Brilho padrão do raio da NASA (0 a 100). */
  DEFAULT_NASA_INTENSITY: 60,
  /** Velocidade padrão da animação da NASA (0 a 100). */
  DEFAULT_NASA_SPEED: 50,
  /** Intensidade padrão do brilho das casas (0 a 100, valor raw). */
  DEFAULT_GLOW_INTENSITY_RAW: 50,
  /** Velocidade padrão da animação geral (0 a 100, valor raw). */
  DEFAULT_ANIM_SPEED_RAW: 50,
  /** Frequência padrão da varredura de cor do jogador (0 a 100). */
  DEFAULT_PLAYER_COLOR_FREQ: 50,
  /** Velocidade padrão da animação de inserção de números (0 a 100). */
  DEFAULT_INSERT_SPEED: 50,

  // ── 🎉 Efeitos de Confete ────────────────────────────────────────────────
  // Configurações do canvas-confetti reutilizadas em vitória solo, vitória
  // multiplayer e no botão do Presente Especial (💝).
  CONFETTI: {
    VICTORY: { particleCount: 95, spread: 70, origin: { y: 0.35 }, zIndex: 9999, colors: ['#34d399', '#22d3ee', '#a78bfa', '#f472b6'] },
    VICTORY_MP: { particleCount: 110, spread: 75, origin: { y: 0.35 }, zIndex: 9999, colors: ['#34d399', '#22d3ee', '#a78bfa', '#f472b6'] },
    GIFT: { particleCount: 150, spread: 80, origin: { y: 0.5 }, zIndex: 9999, colors: ['#f43f5e', '#ec4899', '#d946ef', '#8b5cf6'] },
  },

  // ── ⚙️ Modo Desenvolvedor (Easter Egg) ───────────────────────────────────
  /** Quantos cliques no logo ativam o modo desenvolvedor. */
  DEV_MODE_CLICKS_REQUIRED: 9,
  /** Janela de tempo (ms) para contar os cliques consecutivos. */
  DEV_MODE_TIME_WINDOW_MS: 4000,
  /** Chave do sessionStorage que guarda o estado do modo dev. */
  DEV_MODE_KEY: 'sudoku_anerothico_dev_mode_v1',

  // ── 🌐 Multiplayer & Network ─────────────────────────────────────────────
  /** Tempo máximo (ms) para uma votação de novo tabuleiro ou feature expirar. */
  MULTIPLAYER_VOTE_TIMEOUT_MS: 45000,
  /** Modo padrão da sala multiplayer ('coop' = cooperativo, 'versus' = rinha). */
  DEFAULT_ROOM_MODE: 'coop',
  /** Nome padrão do jogador antes de ele se identificar. */
  DEFAULT_PLAYER_NAME: 'Jogador',
  /** Número de dias após a última atividade antes de uma sala poder ser sobrescrita. */
  ROOM_PROTECTION_DAYS: 2,

  // ── 🖥️ Servidor Local (servidor-local.ps1) ──────────────────────────────
  // Porta preferida para o servidor de desenvolvimento. Se estiver ocupada,
  // o script tenta portas consecutivas até SERVER_PORT_MAX.
  SERVER_PORT: 8765,
  SERVER_PORT_MAX: 8785,

  // ── 📦 Storage Keys ─────────────────────────────────────────────────────
  // Chaves do LocalStorage/SessionStorage centralizadas para evitar erros de
  // digitação. Estas strings DEVEM coincidir com os dados já salvos nos
  // navegadores dos usuários — alterá-las causa perda de dados.
  STORAGE: {
    THEME: 'sudoku_anerothico_theme_v1',
    SAVED_GAMES: 'sudoku_anerothico_games_v1',
    CURRENT_GAME_ID: 'sudoku_anerothico_current_id_v1',
    PLAYER_ID: 'sudoku_anerothico_player_id_v1',
    VISUAL_SETTINGS: 'sudoku_anerothico_visual_settings_v1',
    HEADER_COLLAPSED: 'sudoku_anerothico_header_collapsed_v1',
    MP_PLAYER_NAME: 'sudoku_anerothico_mp_name',
    LEFT_PANEL_WIDTH: 'sudoku_anerothico_left_panel_width_v1',
    LEFT_PANEL_COLLAPSED: 'sudoku_anerothico_left_panel_collapsed_v1',
  },
};
