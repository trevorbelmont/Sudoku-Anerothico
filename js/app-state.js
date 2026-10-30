'use strict';

      const STORAGE_KEYS = {
        THEME: 'sudoku_anerothico_theme_v1',
        SAVED_GAMES: 'sudoku_anerothico_games_v1',
        CURRENT_GAME_ID: 'sudoku_anerothico_current_id_v1',
        PLAYER_ID: 'sudoku_anerothico_player_id_v1',
        VISUAL_SETTINGS: 'sudoku_anerothico_visual_settings_v1'
      };

      // Número de dias após a última atividade de uma sala antes de ela poder ser sobrescrita.
      // Enquanto esse prazo não vence, a sala está "protegida" e não pode ser criada com o mesmo nome.
      const ROOM_PROTECTION_DAYS = 2;

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
                      nasaIntensity: Number(parsed.nasaIntensity ?? 60),
                      nasaSpeed: Number(parsed.nasaSpeed ?? 50),
                      playerColorAnimOn: parsed.playerColorAnimOn !== false,
                      playerColorFreq: Number(parsed.playerColorFreq ?? 50),
                      playerTileOn: parsed.playerTileOn !== false,
                      playerIdentityOff: parsed.playerIdentityOff === true,
                      insertSpeed: Number(parsed.insertSpeed ?? 50)
                    };
                  }
              }
          } catch (_) {}
          return { glowIntensity: 2, glowIntensityRaw: 50, animSpeed: 2, animSpeedRaw: 50, nasaIntensity: 60, nasaSpeed: 50, playerColorAnimOn: false, playerColorFreq: 50, playerTileOn: false, playerIdentityOff: false, insertSpeed: 50 };
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
        mode: 'standard',
        difficulty: 'facil',
        minVal: 1,
        maxVal: 9,
        includeZero: false,
        symbols: [],
        N: 9,
        boardZoom: 1,
        nasaContributions: [],
        nasaCalls: 0,
        boardFocusMode: false,
        boardZoomBeforeFocus: null,
        blockR: 3,
        blockC: 3,
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
            playerName: 'Jogador',
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
            roomMode: 'coop',
            realtimeMetrics: false,
            contributions: {},
            currentFeatureVote: null,
            featureVoteMinimized: false,
            observedFeatureVoteIds: {},
            roomSettings: { immediateErrorCheck: false }
        }
      };
