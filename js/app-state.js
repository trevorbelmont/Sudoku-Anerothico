'use strict';

      const STORAGE_KEYS = {
        THEME: 'sudoku_anerothico_theme_v1',
        SAVED_GAMES: 'sudoku_anerothico_games_v1',
        CURRENT_GAME_ID: 'sudoku_anerothico_current_id_v1'
      };

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
        
        // Multiplayer State
        multiplayer: {
            active: false,
            roomId: null,
            playerName: 'Jogador',
            playerId: 'player_' + Math.random().toString(36).substr(2, 9),
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
