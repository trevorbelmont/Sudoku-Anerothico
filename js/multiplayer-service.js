'use strict';

function getFirebaseAPI() {
          return window.firebaseDB;
      }

      function ensureMultiplayerColor() {
          if (state.multiplayer.color) return state.multiplayer.color;
          const colors = ['#ef4444', '#f97316', '#84cc16', '#06b6d4', '#3b82f6', '#8b5cf6', '#d946ef', '#f43f5e'];
          let hash = 0;
          const name = state.multiplayer.playerName || 'Jogador';
          for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
          state.multiplayer.color = colors[Math.abs(hash) % colors.length];
          return state.multiplayer.color;
      }

      function stopRoomListeners() {
          (state.multiplayer.listeners || []).forEach(unsubscribe => {
              try { if (typeof unsubscribe === 'function') unsubscribe(); } catch (e) { console.warn('Falha ao encerrar listener multiplayer.', e); }
          });
          state.multiplayer.listeners = [];
      }

      function roomPath(roomId, childName = '') {
          return `rooms/${roomId}${childName ? '/' + childName : ''}`;
      }

      function createRoomMeta(instanceNumber, ownerPlayerId, overrides = {}) {
          return {
              createdAtTimestamp: Date.now(),
              ownerPlayerId,
              instanceNumber,
              gameMode: overrides.gameMode ?? state.mode,
              difficultyLevel: overrides.difficultyLevel ?? state.difficulty,
              minimumSymbolValue: overrides.minimumSymbolValue ?? state.minVal,
              maximumSymbolValue: overrides.maximumSymbolValue ?? state.maxVal,
              includesZeroValue: overrides.includesZeroValue ?? state.includeZero,
              boardDimension: overrides.boardDimension ?? state.N,
              blockRowCount: overrides.blockRowCount ?? state.blockR,
              blockColumnCount: overrides.blockColumnCount ?? state.blockC,
              symbolValues: overrides.symbolValues ?? state.symbols.slice(),
              fixedInitialGrid: overrides.fixedInitialGrid ?? state.initial.map(row => row.slice()),
              solutionGrid: overrides.solutionGrid ?? state.solution.map(row => row.slice()),
              roomMode: overrides.roomMode ?? state.multiplayer.roomMode ?? 'coop',
              realtimeMetrics: overrides.realtimeMetrics ?? !!state.multiplayer.realtimeMetrics
          };
      }

      // Firebase metadata uses descriptive field names to simplify maintenance.
      function validateRoomMeta(meta) {
          if (!meta || typeof meta !== 'object') return null;
          const normalized = {
              dimension: meta.boardDimension,
              blockRow: meta.blockRowCount,
              blockCol: meta.blockColumnCount,
              symbols: meta.symbolValues,
              initialGrid: meta.fixedInitialGrid,
              solutionGrid: meta.solutionGrid,
              mode: meta.gameMode,
              difficulty: meta.difficultyLevel,
              instanceCount: meta.instanceNumber
          };
          const valid = validateGameState(normalized);
          if (!valid) return null;
          valid.instanceCount = Number.isFinite(Number(meta.instanceNumber)) ? Number(meta.instanceNumber) : 0;
          valid.minVal = Number.isFinite(Number(meta.minimumSymbolValue)) ? Number(meta.minimumSymbolValue) : Number(valid.symbols[0]);
          valid.maxVal = Number.isFinite(Number(meta.maximumSymbolValue)) ? Number(meta.maximumSymbolValue) : Number(valid.symbols[valid.symbols.length - 1]);
          valid.includeZero = !!meta.includesZeroValue;
          return valid;
      }

      function createNasaMoveHistory(count) {
          // When an already-played local game becomes a room, preserve its NASA-call count in the existing moves log.
          // Invalid coordinates make these history-only entries inert for the board and cursor logic.
          const history = {};
          const total = Math.max(0, Math.min(10000, Math.floor(Number(count) || 0)));
          const now = Date.now();
          for (let index = 1; index <= total; index++) {
              history[`nasa_history_${String(index).padStart(5, '0')}`] = {
                  action: 'NASA', row: -1, column: -1, value: '', userId: `nasa-history-${index}`,
                  userName: 'NASA (histórico)', timestamp: now - (total - index)
              };
          }
          return history;
      }

      function serializeExistingNasaContributions() {
          ensureNasaContributionGrid();
          const result = {};
          const timestamp = Date.now();
          for (let r = 0; r < state.N; r++) for (let c = 0; c < state.N; c++) {
              if (!state.nasaContributions[r][c] || state.board[r][c] === '' || state.initial[r][c] !== '') continue;
              result[`${r}_${c}`] = { kind: 'NASA', action: 'NASA', playerId: 'NASA', playerName: 'NASA', timestamp };
          }
          return result;
      }

      function serializeCurrentRoomBoard(instanceNumber = state.multiplayer.instanceCount) {
          return {
              boardInstanceNumber: instanceNumber,
              boardValues: state.board.map(row => row.map(value => value == null ? '' : String(value))),
              pencilNotes: state.multiplayer.roomMode === 'versus' ? null : state.notes.map(row => row.map(notes => Array.from(notes || []))),
              elapsedSeconds: state.timerSeconds,
              isCompleted: !!state.completed,
              gameName: state.gameName || '',
              lastUpdatedByPlayerId: state.multiplayer.playerId,
              updatedAtTimestamp: Date.now()
          };
      }

      function applyRoomBoardState(roomState) {
          if (!roomState || !Array.isArray(roomState.boardValues)) return;
          const N = state.N;
          // Durante a entrada na sala, boardState pode chegar antes de meta. Guarde-o até a dimensão/instância serem aplicadas.
          if (state.multiplayer.lastAppliedInstanceNumber === null || state.multiplayer.lastAppliedInstanceNumber === undefined || Number(roomState.boardInstanceNumber) !== Number(state.multiplayer.instanceCount)) {
              state.multiplayer.pendingBoardState = roomState;
              return;
          }
          if (roomState.boardValues.length !== N || roomState.boardValues.some(row => !Array.isArray(row) || row.length !== N)) {
              state.multiplayer.pendingBoardState = roomState;
              return;
          }
          state.multiplayer.pendingBoardState = null;
          const wasCompleted = !!state.completed;
          const previousBoard = state.board.map(row => row.slice());
          const incomingElapsed = Number.isFinite(Number(roomState.elapsedSeconds)) ? Number(roomState.elapsedSeconds) : 0;
          if (roomState.isCompleted || wasCompleted) state.timerSeconds = incomingElapsed;
          state.completed = !!roomState.isCompleted;
          state.board = roomState.boardValues.map(row => row.map(value => value == null ? '' : String(value)));
          if (state.multiplayer.roomMode === 'versus') {
              // Keep private annotations local, but still apply normal Sudoku candidate cleanup
              // when an opponent fills a cell with a new value.
              for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
                  const incoming = state.board[r][c];
                  const previous = previousBoard[r] ? previousBoard[r][c] : '';
                  if (incoming !== '' && incoming !== previous) {
                      if (state.notes[r] && state.notes[r][c]) state.notes[r][c].clear();
                      removeAutoNotesPeers(r, c, incoming);
                  }
              }
          }
          if (state.multiplayer.roomMode !== 'versus') {
              const notesData = Array.isArray(roomState.pencilNotes) ? roomState.pencilNotes : [];
              state.notes = Array.from({ length: N }, (_, r) => Array.from({ length: N }, (_, c) => {
                  const cellNotes = notesData[r] && Array.isArray(notesData[r][c]) ? notesData[r][c] : [];
                  return new Set(cellNotes.map(String).filter(symbol => state.symbols.includes(symbol)));
              }));
          } else {
              // Versus: never apply notes received from Firebase; keep this client's candidate marks private.
              ensureNasaContributionGrid();
          }
          if (roomState.gameName) {
              state.gameName = String(roomState.gameName);
              const nameInput = document.getElementById('game-name-input');
              if (nameInput && nameInput.value !== state.gameName) nameInput.value = state.gameName;
          }
          // Atualiza o DOM sem recriar os inputs; isso evita perder o foco enquanto o outro jogador digita.
          for (let r = 0; r < N; r++) {
              for (let c = 0; c < N; c++) {
                  const input = document.getElementById(`cell-input-${r}-${c}`);
                  if (input && document.activeElement !== input && !state.typingBuffer) input.value = state.board[r][c];
                  updateCellPencilDOM(r, c);
              }
          }
          updateAllCellVisuals();
          updateProgressUI();
          document.getElementById('timer-display').textContent = formatTime(state.timerSeconds);
          if (state.completed) {
              pauseTimer();
              document.getElementById('victory-time').textContent = formatTime(state.timerSeconds);
              document.getElementById('victory-diff').textContent = DIFFICULTY_LABELS[state.difficulty] || state.difficulty;
              document.getElementById('victory-dim').textContent = `${state.N}×${state.N} (${state.blockR}×${state.blockC})`;
              document.getElementById('victory-range').textContent = `${state.symbols[0]} a ${state.symbols[state.symbols.length - 1]}`;
              updateMultiplayerVictorySummary();
              if (!wasCompleted) {
                  openModal('modal-victory');
                  if (typeof confetti === 'function') confetti({ particleCount: 110, spread: 75, origin: { y: 0.35 }, zIndex: 9999, colors: ['#34d399', '#22d3ee', '#a78bfa', '#f472b6'] });
              }
          } else if (wasCompleted) {
              state.timerSeconds = Number(roomState.elapsedSeconds) || 0;
              document.getElementById('timer-display').textContent = formatTime(state.timerSeconds);
              closeModal('modal-victory');
              startTimer();
          }
          saveCurrentGameState();
      }

      function publishRoomBoardState() {
          if (!state.multiplayer.active || !state.multiplayer.roomId) return;
          const fb = getFirebaseAPI();
          if (!fb) return;
          const boardStateRef = fb.ref(fb.db, roomPath(state.multiplayer.roomId, 'boardState'));
          fb.update(boardStateRef, {
              boardValues: state.board.map(row => row.map(value => value == null ? '' : String(value))),
              pencilNotes: state.multiplayer.roomMode === 'versus' ? null : state.notes.map(row => row.map(notes => Array.from(notes || []))),
              elapsedSeconds: state.timerSeconds,
              isCompleted: !!state.completed,
              gameName: state.gameName || '',
              lastUpdatedByPlayerId: state.multiplayer.playerId,
              updatedAtTimestamp: Date.now()
          }).catch(error => console.error('Falha ao sincronizar o estado do tabuleiro:', error));
      }

      function publishRoomBoardCell(row, column, includePeerNotes = false) {
          if (!state.multiplayer.active || !state.multiplayer.roomId || !Number.isInteger(row) || !Number.isInteger(column)) return;
          const fb = getFirebaseAPI();
          if (!fb) return;
          const boardStateRef = fb.ref(fb.db, roomPath(state.multiplayer.roomId, 'boardState'));
          // Atualização por célula, para que jogadas simultâneas em casas diferentes não se sobrescrevam.
          const patch = {
              [`boardValues/${row}/${column}`]: state.board[row][column] == null ? '' : String(state.board[row][column]),
              lastUpdatedByPlayerId: state.multiplayer.playerId,
              updatedAtTimestamp: Date.now(),
              isCompleted: !!state.completed,
              elapsedSeconds: state.timerSeconds,
              gameName: state.gameName || ''
          };
          if (state.multiplayer.roomMode === 'versus') {
              // Remove any legacy note data from the shared room node and do not stream new notes.
              patch.pencilNotes = null;
          } else {
              patch[`pencilNotes/${row}/${column}`] = Array.from(state.notes[row][column] || []);
          }
          if (includePeerNotes && state.multiplayer.roomMode !== 'versus') {
              const affected = new Set();
              for (let index = 0; index < state.N; index++) {
                  affected.add(`${row},${index}`);
                  affected.add(`${index},${column}`);
              }
              const startRow = Math.floor(row / state.blockR) * state.blockR;
              const startColumn = Math.floor(column / state.blockC) * state.blockC;
              for (let r = startRow; r < startRow + state.blockR; r++) {
                  for (let c = startColumn; c < startColumn + state.blockC; c++) affected.add(`${r},${c}`);
              }
              affected.forEach(coordinate => {
                  const [r, c] = coordinate.split(',').map(Number);
                  patch[`pencilNotes/${r}/${c}`] = Array.from(state.notes[r][c] || []);
              });
          }
          fb.update(boardStateRef, patch).catch(error => console.error('Falha ao sincronizar a casa do Sudoku:', error));
      }

      function registerRoomPresence(roomId) {
          const fb = getFirebaseAPI();
          if (!fb) return;
          ensureMultiplayerColor();
          const playerRef = fb.ref(fb.db, roomPath(roomId, `players/${state.multiplayer.playerId}`));
          state.multiplayer.presenceRef = playerRef;
          const presence = {
              playerId: state.multiplayer.playerId,
              playerName: state.multiplayer.playerName,
              playerColor: state.multiplayer.color,
              joinedAtTimestamp: Date.now()
          };
          fb.onDisconnect(playerRef).remove()
              .then(() => fb.set(playerRef, presence))
              .catch(error => {
                  console.error('Falha ao registrar presença multiplayer:', error);
                  fb.set(playerRef, presence).catch(() => {});
              });
          const memberRef = fb.ref(fb.db, roomPath(roomId, `members/${state.multiplayer.playerId}`));
          fb.set(memberRef, presence).catch(error => console.warn('Não foi possível registrar o participante no histórico da sala:', error));
      }


      function forceApplyNewMetaState(meta, announceNewInstance = true) {
          const validMeta = validateRoomMeta(meta);
          if (!validMeta) {
              console.error('Os metadados da sala não são válidos:', meta);
              showToast('A sala enviou metadados de Sudoku inválidos.', 'warn');
              return false;
          }
          closeModal('modal-vote-newgame');
          state.mode = validMeta.mode;
          state.difficulty = validMeta.difficulty;
          state.minVal = validMeta.minVal;
          state.maxVal = validMeta.maxVal;
          state.includeZero = validMeta.includeZero;
          state.symbols = validMeta.symbols;
          state.N = validMeta.N;
          state.blockR = validMeta.bR;
          state.blockC = validMeta.bC;
          state.initial = validMeta.initial.map(row => row.slice());
          const solved = validMeta.sol || solvePartialGrid(validMeta.initial, validMeta.N, validMeta.bR, validMeta.bC, validMeta.symbols);
          if (solved) state.solution = solved.map(row => row.slice());
          state.board = state.initial.map(row => row.slice());
          state.notes = Array.from({ length: state.N }, () => Array.from({ length: state.N }, () => new Set()));
          state.nasaContributions = Array.from({ length: state.N }, () => Array(state.N).fill(false));
          state.nasaCalls = 0;
          state.multiplayer.contributions = {};
          state.revealedErrors = Array.from({ length: state.N }, () => Array(state.N).fill(false));
          state.timerSeconds = 0;
          state.completed = false;
          state.multiplayer.instanceCount = validMeta.instanceCount;
          state.multiplayer.roomMode = meta.roomMode === 'versus' ? 'versus' : 'coop';
          state.multiplayer.realtimeMetrics = !!meta.realtimeMetrics;
          const modeLabel = document.getElementById('mp-room-mode-label');
          if (modeLabel) modeLabel.textContent = state.multiplayer.roomMode === 'versus' ? '⚔️ Rinha de Galo 🐓' : '🤝 Prosa e Cafézin ☕';
          state.multiplayer.lastAppliedInstanceNumber = validMeta.instanceCount;
          state.gameId = 'mp_' + state.multiplayer.roomId + '_' + state.multiplayer.instanceCount;
          state.gameName = 'Sala: ' + state.multiplayer.roomId + ' #' + state.multiplayer.instanceCount;
          document.getElementById('game-name-input').value = state.gameName;
          document.getElementById('timer-display').textContent = '00:00';
          syncModeTabsUI();
          syncDifficultyButtonsUI();
          updateHeaderSubtitle();
          renderVirtualNumpad();
          renderSudokuBoard();
          startTimer();
          saveCurrentGameState();
          const pending = state.multiplayer.pendingBoardState;
          if (pending && Number(pending.boardInstanceNumber) === state.multiplayer.instanceCount) applyRoomBoardState(pending);
          if (announceNewInstance) showToast(`O novo tabuleiro da sala foi sincronizado (instância ${state.multiplayer.instanceCount}).`, 'success');
          return true;
      }



      function pushMoveToFirebase(action, row, column, value) {
          if (!state.multiplayer.active || !state.multiplayer.roomId) return;
          // Pencil edits in competitive rooms stay local: do not even publish their symbol in the move log.
          if (action === 'NOTE' && state.multiplayer.roomMode === 'versus') return;
          const fb = getFirebaseAPI();
          if (!fb) return;
          ensureMultiplayerColor();
          state.multiplayer.lastProcessedSeq = (state.multiplayer.lastProcessedSeq || 0) + 1;
          const movePayload = {
              sequence: state.multiplayer.lastProcessedSeq,
              timestamp: Date.now(),
              userId: state.multiplayer.playerId,
              userName: state.multiplayer.playerName,
              userColor: state.multiplayer.color,
              action,
              row,
              column,
              value
          };
          const movesRef = fb.ref(fb.db, roomPath(state.multiplayer.roomId, 'moves'));
          fb.push(movesRef, movePayload).catch(error => console.error('Erro ao enviar jogada para o Firebase:', error));
          if (action !== 'FOCUS') publishRoomBoardCell(row, column, action === 'SET' || action === 'NASA');
          if (['SET', 'ERASE', 'NASA'].includes(action) && row >= 0 && column >= 0) {
              state.multiplayer.contributions = state.multiplayer.contributions || {};
              const localKey = `${row}_${column}`;
              if (action === 'NASA' && String(value ?? '') !== '') {
                  state.multiplayer.contributions[localKey] = { kind: 'NASA', action: 'NASA', playerId: 'NASA', playerName: 'NASA', timestamp: Date.now() };
              } else if (action === 'SET' && String(value ?? '') !== '') {
                  state.multiplayer.contributions[localKey] = { kind: 'PLAYER', action: 'SET', playerId: state.multiplayer.playerId, playerName: state.multiplayer.playerName, timestamp: Date.now() };
              } else {
                  delete state.multiplayer.contributions[localKey];
              }
              updateAllCellVisuals();
              renderMultiplayerSidebar();
              updateNasaContributionSummary();
              const attributionRef = fb.ref(fb.db, roomPath(state.multiplayer.roomId, `contributions/${row}_${column}`));
              let operation;
              if (action === 'NASA' && String(value ?? '') !== '') {
                  operation = fb.set(attributionRef, { kind: 'NASA', action: 'NASA', playerId: 'NASA', playerName: 'NASA', timestamp: Date.now() });
              } else if (action === 'SET' && String(value ?? '') !== '') {
                  operation = fb.set(attributionRef, { kind: 'PLAYER', action: 'SET', playerId: state.multiplayer.playerId, playerName: state.multiplayer.playerName, timestamp: Date.now() });
              } else {
                  operation = fb.remove(attributionRef);
              }
              operation.catch(error => console.error('Falha ao atualizar a contribuição da célula:', error));
          }
      }

      function processIncomingMove(move) {
          if (!move || !state.multiplayer.active) return;
          const userId = move.userId || move.u;
          const action = move.action || move.act;
          const row = move.row !== undefined ? Number(move.row) : Number(move.r);
          const column = move.column !== undefined ? Number(move.column) : Number(move.c);
          const userName = move.userName || move.name || 'Jogador';
          const userColor = move.userColor || '#3b82f6';
          if (!userId || userId === state.multiplayer.playerId) return;
          if (Date.now() - Number(move.timestamp || 0) > 120000) return;
          if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 || column < 0 || row >= state.N || column >= state.N) return;
          state.multiplayer.peers = state.multiplayer.peers || {};
          state.multiplayer.peers[userId] = { row, column, name: userName, color: userColor, lastSeen: Date.now() };
          // O conteúdo do tabuleiro chega por boardState; o log de movimentos serve para cursores/avatar e presença da atividade.
          if (action === 'FOCUS' || action === 'SET' || action === 'ERASE' || action === 'NOTE') {
              updateAllCellVisuals();
              renderMultiplayerSidebar();
          }
      }

      function onRoomMetaChanged(meta) {
          if (!meta || !state.multiplayer.active) return;
          const valid = validateRoomMeta(meta);
          if (!valid) return;
          const incomingInstance = valid.instanceCount;
          const hasAppliedInstance = state.multiplayer.lastAppliedInstanceNumber !== null && state.multiplayer.lastAppliedInstanceNumber !== undefined;
          if (!hasAppliedInstance || incomingInstance !== Number(state.multiplayer.lastAppliedInstanceNumber)) {
              forceApplyNewMetaState(meta, hasAppliedInstance);
          }
      }

      function onRoomPlayersChanged(players) {
          state.multiplayer.players = players && typeof players === 'object' ? players : {};
          const onlineIds = new Set(Object.keys(state.multiplayer.players));
          Object.keys(state.multiplayer.peers || {}).forEach(playerId => {
              if (!onlineIds.has(playerId)) delete state.multiplayer.peers[playerId];
          });
          Object.entries(state.multiplayer.players).forEach(([playerId, player]) => {
              if (playerId === state.multiplayer.playerId) return;
              const previous = state.multiplayer.peers[playerId] || {};
              state.multiplayer.peers[playerId] = {
                  row: Number.isInteger(previous.row) ? previous.row : -1,
                  column: Number.isInteger(previous.column) ? previous.column : -1,
                  name: player.playerName || previous.name || 'Jogador',
                  color: player.playerColor || previous.color || '#3b82f6',
                  lastSeen: previous.lastSeen || Date.now()
              };
          });
          renderMultiplayerSidebar();
          updateAllCellVisuals();
          const victoryModal = document.getElementById('modal-victory');
          if (victoryModal && victoryModal.classList.contains('flex') && state.completed) updateMultiplayerVictorySummary();
          const proposal = state.multiplayer.currentProposal;
          if (proposal && proposal.status === 'pending' && proposal.proposerId === state.multiplayer.playerId && Array.isArray(proposal.requiredPlayerIds)) {
              const requiredNow = proposal.requiredPlayerIds.filter(id => id === state.multiplayer.playerId || onlineIds.has(id));
              if (requiredNow.length !== proposal.requiredPlayerIds.length) {
                  const fb = getFirebaseAPI();
                  if (fb && state.multiplayer.roomId) {
                      fb.update(fb.ref(fb.db, roomPath(state.multiplayer.roomId, 'proposal')), { requiredPlayerIds: requiredNow }).catch(() => {});
                  }
              }
          }
      }


      function setupRoomListeners(roomId) {
          const fb = getFirebaseAPI();
          if (!fb) return;
          stopRoomListeners();
          const metaRef = fb.ref(fb.db, roomPath(roomId, 'meta'));
          const boardStateRef = fb.ref(fb.db, roomPath(roomId, 'boardState'));
          const playersRef = fb.ref(fb.db, roomPath(roomId, 'players'));
          const proposalRef = fb.ref(fb.db, roomPath(roomId, 'proposal'));
          const movesRef = fb.ref(fb.db, roomPath(roomId, 'moves'));
          const contributionsRef = fb.ref(fb.db, roomPath(roomId, 'contributions'));
          const membersRef = fb.ref(fb.db, roomPath(roomId, 'members'));
          const featureVoteRef = fb.ref(fb.db, roomPath(roomId, 'featureVote'));
          const settingsRef = fb.ref(fb.db, roomPath(roomId, 'settings'));

          state.multiplayer.listeners.push(fb.onValue(contributionsRef, snapshot => {
              state.multiplayer.contributions = snapshot.val() && typeof snapshot.val() === 'object' ? snapshot.val() : {};
              updateAllCellVisuals();
              updateNasaContributionSummary();
              renderMultiplayerSidebar();
              const victoryModal = document.getElementById('modal-victory');
              if (victoryModal && victoryModal.classList.contains('flex') && state.completed) updateMultiplayerVictorySummary();
          }));
          state.multiplayer.listeners.push(fb.onValue(membersRef, snapshot => {
              state.multiplayer.members = snapshot.val() && typeof snapshot.val() === 'object' ? snapshot.val() : {};
              const victoryModal = document.getElementById('modal-victory');
              if (victoryModal && victoryModal.classList.contains('flex') && state.completed) updateMultiplayerVictorySummary();
          }));
          state.multiplayer.listeners.push(fb.onValue(featureVoteRef, snapshot => onFeatureVoteChanged(snapshot.val())));
          state.multiplayer.listeners.push(fb.onValue(settingsRef, snapshot => {
              const settings = snapshot.val() || {};
              state.multiplayer.roomSettings = settings;
              if (typeof settings.immediateErrorCheck === 'boolean') {
                  state.immediateErrorCheck = settings.immediateErrorCheck;
                  const errorToggle = document.getElementById('toggle-immediate-error');
                  if (errorToggle) errorToggle.checked = settings.immediateErrorCheck;
                  updateAllCellVisuals();
              }
          }));
          state.multiplayer.listeners.push(fb.onValue(metaRef, snapshot => {
              const meta = snapshot.val();
              if (!meta) {
                  showToast('A sala não foi encontrada ou foi encerrada.', 'warn');
                  return;
              }
              onRoomMetaChanged(meta);
          }));
          state.multiplayer.listeners.push(fb.onValue(boardStateRef, snapshot => {
              const roomState = snapshot.val();
              if (roomState) applyRoomBoardState(roomState);
          }));
          state.multiplayer.listeners.push(fb.onValue(playersRef, snapshot => onRoomPlayersChanged(snapshot.val())));
          state.multiplayer.listeners.push(fb.onValue(proposalRef, snapshot => onRoomProposalChanged(snapshot.val())));
          state.multiplayer.listeners.push(fb.onValue(movesRef, snapshot => {
              const moves = snapshot.val();
              if (!moves || typeof moves !== 'object') {
                  if (state.nasaCalls !== 0) { state.nasaCalls = 0; updateNasaContributionSummary(); saveCurrentGameState(); }
                  return;
              }
              const entries = Object.entries(moves).sort((a, b) => Number((a[1] || {}).timestamp || 0) - Number((b[1] || {}).timestamp || 0));
              const nasaMoveCount = entries.filter(([, move]) => move && (move.action || move.act) === 'NASA').length;
              if (nasaMoveCount !== Number(state.nasaCalls || 0)) {
                  state.nasaCalls = nasaMoveCount;
                  updateNasaContributionSummary();
                  renderMultiplayerSidebar();
                  saveCurrentGameState();
                  const victoryModal = document.getElementById('modal-victory');
                  if (victoryModal && victoryModal.classList.contains('flex') && state.completed) updateMultiplayerVictorySummary();
              }
              entries.forEach(([moveId, move]) => {
                  if (state.multiplayer.processedMoveIds[moveId]) return;
                  state.multiplayer.processedMoveIds[moveId] = true;
                  processIncomingMove(move);
              });
              const processedIds = Object.keys(state.multiplayer.processedMoveIds);
              if (processedIds.length > 1500) {
                  state.multiplayer.processedMoveIds = Object.fromEntries(processedIds.slice(-750).map(id => [id, true]));
              }
          }));
      }

      function joinRoom(roomId, playerName) {
          const fb = getFirebaseAPI();
          if (!fb) { showToast('Firebase indisponível.', 'warn'); return; }
          if (state.multiplayer.active) {
              showToast('Desconecte da sala atual antes de entrar em outra.', 'warn');
              return;
          }
          const metaRef = fb.ref(fb.db, roomPath(roomId, 'meta'));
          fb.onValue(metaRef, snapshot => {
              const meta = snapshot.val();
              const validMeta = validateRoomMeta(meta);
              if (!validMeta) {
                  showToast('Sala não encontrada ou com metadados inválidos.', 'warn');
                  return;
              }
              state.multiplayer.active = true;
              state.multiplayer.roomId = roomId;
              state.multiplayer.playerName = playerName || 'Jogador';
              state.multiplayer.color = null;
              ensureMultiplayerColor();
              state.multiplayer.instanceCount = validMeta.instanceCount;
              state.multiplayer.roomMode = meta.roomMode === 'versus' ? 'versus' : 'coop';
              state.multiplayer.realtimeMetrics = !!meta.realtimeMetrics;
              const modeLabel = document.getElementById('mp-room-mode-label');
              if (modeLabel) modeLabel.textContent = state.multiplayer.roomMode === 'versus' ? '⚔️ Rinha de Galo 🐓' : '🤝 Prosa e Cafézin ☕';
              state.multiplayer.contributions = {};
              state.multiplayer.members = {};
              state.multiplayer.lastAppliedInstanceNumber = null;
              state.multiplayer.processedMoveIds = {};
              state.multiplayer.peers = {};
              state.multiplayer.players = {};
              state.multiplayer.lastProcessedSeq = 0;
              registerRoomPresence(roomId);
              setupRoomListeners(roomId);
              document.getElementById('room-status-badge').classList.remove('hidden');
              document.getElementById('room-status-badge').classList.add('flex');
              document.getElementById('current-room-id-label').textContent = roomId;
              document.getElementById('btn-create-room').classList.add('hidden');
              closeModal('modal-multiplayer');
              showToast(`Conectado à sala ${roomId}! O estado atual do tabuleiro será sincronizado.`, 'success');
          }, { onlyOnce: true });
      }

      function hostRoom(playerName) {
          if (state.isManualCreating) {
              showToast('Finalize a criação manual antes de hospedar.', 'warn');
              return;
          }
          const fb = getFirebaseAPI();
          if (!fb) { showToast('Firebase indisponível.', 'warn'); return; }
          if (state.multiplayer.active) {
              showToast('Desconecte da sala atual antes de hospedar outra.', 'warn');
              return;
          }

          const customRoomName = document.getElementById('multiplayer-room-input').value.trim();
          state.multiplayer.roomMode = document.getElementById('multiplayer-room-mode')?.value === 'versus' ? 'versus' : 'coop';
          state.multiplayer.realtimeMetrics = state.multiplayer.roomMode === 'versus' && !!document.getElementById('multiplayer-realtime-metrics')?.checked;
          let roomId = customRoomName;
          if (!roomId) roomId = Math.random().toString(36).slice(2, 6).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
          else roomId = roomId.replace(/[.#$\[\]/]/g, '_');

          state.multiplayer.active = true;
          state.multiplayer.roomId = roomId;
          state.multiplayer.playerName = playerName || 'Host';
          state.multiplayer.color = null;
          ensureMultiplayerColor();
          state.multiplayer.instanceCount = 0;
          state.multiplayer.lastAppliedInstanceNumber = 0;
          state.multiplayer.lastProcessedSeq = 0;
          state.multiplayer.processedMoveIds = {};
          state.multiplayer.peers = {};
          state.multiplayer.players = {};
          state.multiplayer.members = {};
          state.multiplayer.contributions = serializeExistingNasaContributions();
          state.multiplayer.currentFeatureVote = null;
          state.multiplayer.gameResult = null;
          state.gameId = 'mp_' + roomId + '_0';
          state.gameName = 'Sala: ' + roomId + ' #0';
          document.getElementById('game-name-input').value = state.gameName;

          const roomRef = fb.ref(fb.db, roomPath(roomId));
          const metaPayload = createRoomMeta(0, state.multiplayer.playerId);
          const boardState = serializeCurrentRoomBoard(0);
          boardState.gameName = state.gameName;
          Promise.all([
              fb.set(fb.child(roomRef, 'meta'), metaPayload),
              fb.set(fb.child(roomRef, 'boardState'), boardState),
              fb.set(fb.child(roomRef, 'moves'), createNasaMoveHistory(state.nasaCalls)),
              fb.set(fb.child(roomRef, 'contributions'), state.multiplayer.contributions),
              fb.set(fb.child(roomRef, 'members'), {}),
              fb.set(fb.child(roomRef, 'settings'), { immediateErrorCheck: false }),
              fb.remove(fb.child(roomRef, 'featureVote'))
          ]).then(() => {
              registerRoomPresence(roomId);
              setupRoomListeners(roomId);
              saveCurrentGameState();
              document.getElementById('room-status-badge').classList.remove('hidden');
              document.getElementById('room-status-badge').classList.add('flex');
              document.getElementById('btn-create-room').classList.add('hidden');
              document.getElementById('current-room-id-label').textContent = roomId;
              const modeLabel = document.getElementById('mp-room-mode-label');
              if (modeLabel) modeLabel.textContent = state.multiplayer.roomMode === 'versus' ? '⚔️ Rinha de Galo 🐓' : '🤝 Prosa e Cafézin ☕';
              renderMultiplayerSidebar();
              closeModal('modal-multiplayer');
              showToast(`Sala ${roomId} criada! O tabuleiro e todos os preenchimentos atuais foram compartilhados.`, 'success');
          }).catch(error => {
              console.error('Erro ao criar sala multiplayer:', error);
              state.multiplayer.active = false;
              state.multiplayer.roomId = null;
              state.multiplayer.lastAppliedInstanceNumber = null;
              showToast('Erro ao criar sala. Verifique sua conexão e as regras do Firebase.', 'warn');
          });
      }
