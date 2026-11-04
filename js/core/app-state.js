'use strict';

      // STORAGE_KEYS e ROOM_PROTECTION_DAYS agora referenciam a central de configuração
      // (js/config.js). Os valores permanecem idênticos — apenas a fonte mudou.
      const STORAGE_KEYS = APP_CONFIG.STORAGE;

      // Número de dias após a última atividade de uma sala antes de ela poder ser sobrescrita.
      // Enquanto esse prazo não vence, a sala está "protegida" e não pode ser criada com o mesmo nome.
      const ROOM_PROTECTION_DAYS = APP_CONFIG.ROOM_PROTECTION_DAYS;

      // Gera ou recupera o identificador persistente do jogador.
      // Ao recarregar a página ou reconectar, o mesmo ID é reutilizado, preservando
      // titularidade das células, avatar e histórico de contribuição na sala.
      function getOrCreatePersistentPlayerId() {
          try {
              const stored = localStorage.getItem(STORAGE_KEYS.PLAYER_ID);
              if (stored && /^player_[0-9a-z]{9,}$/.test(stored)) return stored;
          } catch (_) {}
          const bytes = new Uint8Array(6);
          crypto.getRandomValues(bytes);
          const newId = 'player_' + Array.from(bytes, b => b.toString(36).padStart(2, '0')).join('').slice(0, 12);
          try { localStorage.setItem(STORAGE_KEYS.PLAYER_ID, newId); } catch (_) {}
          return newId;
      }

      // Carrega as configurações visuais salvas (intensidade de glow e velocidade de animação).
      function loadVisualSettings() {
          try {
              const raw = localStorage.getItem(STORAGE_KEYS.VISUAL_SETTINGS);
              if (raw) {
                  const parsed = JSON.parse(raw);
                  if (parsed && typeof parsed === 'object') {
                    const gi = Number(parsed.glowIntensity ?? 2);
                    const as = Number(parsed.animSpeed ?? 2);
                    return {
                      glowIntensity: gi,
                      // v6.7: guarda raw 0-100; faz reverse-map se não existir
                      glowIntensityRaw: Number(parsed.glowIntensityRaw ?? (gi === 0 ? 0 : gi === 1 ? 25 : gi === 2 ? 50 : 75)),
                      animSpeed: as,
                      animSpeedRaw: Number(parsed.animSpeedRaw ?? (as === 0 ? 0 : as === 1 ? 25 : as === 2 ? 50 : 75)),
                      nasaIntensity: Number(parsed.nasaIntensity ?? APP_CONFIG.DEFAULT_NASA_INTENSITY),
                      nasaSpeed: Number(parsed.nasaSpeed ?? APP_CONFIG.DEFAULT_NASA_SPEED),
                      playerColorAnimOn: parsed.playerColorAnimOn !== false,
                      playerColorFreq: Number(parsed.playerColorFreq ?? APP_CONFIG.DEFAULT_PLAYER_COLOR_FREQ),
                      playerTileOn: parsed.playerTileOn !== false,
                      playerIdentityOff: parsed.playerIdentityOff === true,
                      insertSpeed: Number(parsed.insertSpeed ?? APP_CONFIG.DEFAULT_INSERT_SPEED)
                    };
                  }
              }
          } catch (_) {}
          return { glowIntensity: 2, glowIntensityRaw: APP_CONFIG.DEFAULT_GLOW_INTENSITY_RAW, animSpeed: 2, animSpeedRaw: APP_CONFIG.DEFAULT_ANIM_SPEED_RAW, nasaIntensity: APP_CONFIG.DEFAULT_NASA_INTENSITY, nasaSpeed: APP_CONFIG.DEFAULT_NASA_SPEED, playerColorAnimOn: false, playerColorFreq: APP_CONFIG.DEFAULT_PLAYER_COLOR_FREQ, playerTileOn: false, playerIdentityOff: false, insertSpeed: APP_CONFIG.DEFAULT_INSERT_SPEED };
      }

      const DIFFICULTY_LABELS = {
        facil: '🍭Melzinho na Chupeta🍼',
        medio: '🛸Suave na Nave👽',
        dificil: 'Uai, Sô🤠⁉️',
        uaiso: '🚂Doido D➕ da Conta‼️🤪',
        doido: '🌵Oxe, 🫠Que Miséria‼️🤦'
      };

      const DIFFICULTY_REMOVAL_RATIOS = {
        facil: 0.42,
        medio: 0.54,
        dificil: 0.63,
        uaiso: 0.716,
        doido: 0.79
      };

      
      const state = {
        gameId: null,
        gameName: '',
        mode: APP_CONFIG.DEFAULT_MODE,
        difficulty: APP_CONFIG.DEFAULT_DIFFICULTY,
        minVal: APP_CONFIG.DEFAULT_MIN_VAL,
        maxVal: APP_CONFIG.DEFAULT_MAX_VAL,
        includeZero: APP_CONFIG.DEFAULT_INCLUDE_ZERO,
        symbols: [],
        N: APP_CONFIG.DEFAULT_GRID_SIZE,
        boardZoom: 1,
        nasaContributions: [],
        nasaCalls: 0,
        boardFocusMode: false,
        boardZoomBeforeFocus: null,
        blockR: APP_CONFIG.DEFAULT_BLOCK_ROWS,
        blockC: APP_CONFIG.DEFAULT_BLOCK_COLS,
        solution: [],
        initial: [],
        board: [],
        notes: [],
        revealedErrors: [],
        focusedCell: { r: 0, c: 0 },
        highlightedSymbol: null,
        pencilMode: false,
        immediateErrorCheck: false,
        highlightSameNumbers: true,
        timerSeconds: 0,
        timerRunning: false,
        timerInterval: null,
        completed: false,
        historyTab: 'ongoing',
        typingBuffer: '',
        typingTimeout: null,
        isManualCreating: false,

        // Configurações visuais de acessibilidade (glow e animações)
        visualSettings: loadVisualSettings(),

        // Multiplayer State
        multiplayer: {
            active: false,
            roomId: null,
            playerName: APP_CONFIG.DEFAULT_PLAYER_NAME,
            playerId: getOrCreatePersistentPlayerId(),
            listener: null,
            listeners: [],
            presenceRef: null,
            players: {},
            members: {},
            peers: {},
            processedMoveIds: {},
            lastObservedProposalId: null,
            observedProposalVoteIds: {},
            currentProposal: null,
            executingProposalId: null,
            completedProposalIds: [],
            lastAppliedInstanceNumber: null,
            pendingBoardState: null,
            lastProcessedSeq: 0,
            instanceCount: 0,
            roomMode: APP_CONFIG.DEFAULT_ROOM_MODE,
            realtimeMetrics: false,
            contributions: {},
            currentFeatureVote: null,
            featureVoteMinimized: false,
            observedFeatureVoteIds: {},
            roomSettings: { immediateErrorCheck: false }
        }
      };
