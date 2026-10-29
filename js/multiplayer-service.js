'use strict';

function getFirebaseAPI() {
          return window.firebaseDB;
      }

      // Paleta expandida de cores saturadas, adequada para identificar contornos no tabuleiro.
      // Cores históricas continuam válidas e são preservadas para participantes já conhecidos.
      const MULTIPLAYER_PLAYER_COLOR_PALETTE = [
          '#e53935', '#ef6c00', '#7cb342', '#16a34a', '#00897b', '#00acc1', '#0284c7', '#1e88e5',
          '#3949ab', '#5e35b1', '#8e24aa', '#d81b60', '#f4511e', '#4d7c0f', '#15803d', '#0f766e',
          '#0e7490', '#0369a1', '#1d4ed8', '#4338ca', '#6d28d9', '#86198f', '#9d174d', '#9f1239',
          '#b91c1c', '#7c3aed', '#db2777', '#ec4899', '#a855f7', '#0891b2', '#059669', '#ca8a04',
          '#ef4444', '#f97316', '#06b6d4', '#3b82f6', '#8b5cf6', '#d946ef', '#f43f5e'
      ];

      function normalizePlayerColor(color) {
          return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : '';
      }

      function stablePlayerColorHash(value) {
          const text = String(value || 'player');
          let hash = 2166136261;
          for (let i = 0; i < text.length; i++) {
              hash ^= text.charCodeAt(i);
              hash = Math.imul(hash, 16777619);
          }
          return hash >>> 0;
      }

      // RGB -> OKLab: uma distância euclidiana nesse espaço aproxima melhor a diferença percebida
      // pelo olho humano do que comparar diretamente os canais RGB.
      function playerColorToOKLab(hex) {
          const value = normalizePlayerColor(hex);
          if (!value) return null;
          const channel = offset => {
              const c = parseInt(value.slice(offset, offset + 2), 16) / 255;
              return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
          };
          const r = channel(1), g = channel(3), b = channel(5);
          const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
          const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
          const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
          return [
              0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
              1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
              0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
          ];
      }

      function playerColorPerceptualDistance(colorA, colorB) {
          const a = playerColorToOKLab(colorA), b = playerColorToOKLab(colorB);
          if (!a || !b) return 0;
          const dL = a[0] - b[0], da = a[1] - b[1], db = a[2] - b[2];
          return Math.sqrt(dL * dL + da * da + db * db);
      }

      function chooseMostDistinctPlayerColor(usedColors, playerId) {
          const candidates = MULTIPLAYER_PLAYER_COLOR_PALETTE;
          const validUsedColors = (Array.isArray(usedColors) ? usedColors : [])
              .map(normalizePlayerColor).filter(Boolean);
          const qualityCandidates = candidates.filter(candidate => {
              const lab = playerColorToOKLab(candidate);
              const chroma = lab ? Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]) : 0;
              // Evita tons quase neutros ou extremos de luminosidade, que funcionam pior como contornos.
              return !!lab && chroma >= 0.13 && lab[0] >= 0.36 && lab[0] <= 0.82;
          });
          const palette = qualityCandidates.length ? qualityCandidates : candidates;
          const offset = stablePlayerColorHash(playerId) % palette.length;

          // Para a primeira pessoa da sala, o identificador dá variedade entre salas sem aleatoriedade instável.
          if (!validUsedColors.length) return palette[offset];

          let bestColor = palette[offset];
          let bestDistance = -1;
          // Maximin: escolher a candidata cuja distância para sua cor ocupada mais próxima seja máxima.
          for (let step = 0; step < palette.length; step++) {
              const candidate = palette[(offset + step) % palette.length];
              let nearestDistance = Infinity;
              for (const usedColor of validUsedColors) {
                  nearestDistance = Math.min(nearestDistance, playerColorPerceptualDistance(candidate, usedColor));
                  if (nearestDistance === 0) break;
              }
              if (nearestDistance > bestDistance + 1e-9) {
                  bestDistance = nearestDistance;
                  bestColor = candidate;
              }
          }
          return bestColor;
      }

      function ensureMultiplayerColor() {
          if (normalizePlayerColor(state.multiplayer.color)) return state.multiplayer.color;
          // Cor provisória para interfaces/fluxos usados antes de a sala estar conectada.
          // A entrada em uma sala substitui-a pela escolha perceptual e persistida abaixo.
          state.multiplayer.color = chooseMostDistinctPlayerColor([], state.multiplayer.playerId || state.multiplayer.playerName || 'Jogador');
          return state.multiplayer.color;
      }

      function getStoredPlayerColor(record) {
          if (!record || typeof record !== 'object') return '';
          return normalizePlayerColor(record.playerColor) || normalizePlayerColor(record.userColor) || normalizePlayerColor(record.color);
      }

      function collectUsedRoomPlayerColors(assignments, players, members, playerId) {
          const colors = [];
          const addRecords = records => {
              if (!records || typeof records !== 'object') return;
              Object.entries(records).forEach(([id, record]) => {
                  if (id === playerId) return;
                  const color = typeof record === 'string' ? normalizePlayerColor(record) : getStoredPlayerColor(record);
                  if (color) colors.push(color);
              });
          };
          addRecords(assignments);
          addRecords(players);
          addRecords(members);
          // Inclui também snapshots em memória como proteção caso uma leitura pontual do Firebase falhe.
          addRecords(state.multiplayer.players || {});
          addRecords(state.multiplayer.members || {});
          addRecords(state.multiplayer.peers || {});
          return colors;
      }

      async function readRoomObject(fb, roomId, childName) {
          try {
              const snapshot = await fb.get(fb.ref(fb.db, roomPath(roomId, childName)));
              const value = snapshot && typeof snapshot.val === 'function' ? snapshot.val() : null;
              return value && typeof value === 'object' ? value : {};
          } catch (error) {
              console.warn(`Não foi possível ler ${childName} para a escolha de cor multiplayer.`, error);
              return {};
          }
      }

      async function assignRoomPlayerColor(roomId) {
          const fb = getFirebaseAPI();
          const playerId = String(state.multiplayer.playerId || '');
          if (!roomId || !playerId) {
              state.multiplayer.color = chooseMostDistinctPlayerColor([], playerId || state.multiplayer.playerName || 'Jogador');
              return state.multiplayer.color;
          }

          const [players, members] = await Promise.all([
              readRoomObject(fb, roomId, 'players'),
              readRoomObject(fb, roomId, 'members')
          ]);
          let assignedColor = '';
          const canReserveAtomically = fb && typeof fb.ref === 'function' && typeof fb.runTransaction === 'function';

          if (canReserveAtomically) {
              const assignmentsRef = fb.ref(fb.db, roomPath(roomId, 'colorAssignments'));
              try {
                  const result = await fb.runTransaction(assignmentsRef, currentValue => {
                      const assignments = currentValue && typeof currentValue === 'object' && !Array.isArray(currentValue)
                          ? { ...currentValue } : {};
                      const reservedColor = normalizePlayerColor(assignments[playerId]);
                      if (reservedColor) return assignments;

                      // Para salas existentes, preserva a cor já associada a este mesmo participante.
                      const previousColor = getStoredPlayerColor(players[playerId]) || getStoredPlayerColor(members[playerId]);
                      if (previousColor) {
                          assignments[playerId] = previousColor;
                          return assignments;
                      }

                      // A transação serializa novos participantes: cada repetição do callback já vê reservas recentes.
                      const usedColors = collectUsedRoomPlayerColors(assignments, players, members, playerId);
                      assignments[playerId] = chooseMostDistinctPlayerColor(usedColors, playerId);
                      return assignments;
                  });
                  const assignmentData = result && result.snapshot && typeof result.snapshot.val === 'function'
                      ? result.snapshot.val() : null;
                  if (result && assignmentData && typeof assignmentData === 'object') {
                      assignedColor = normalizePlayerColor(assignmentData[playerId]);
                  }
              } catch (error) {
                  // Não bloqueia o jogo se as regras de um Firebase legado não permitirem colorAssignments.
                  console.warn('Reserva transacional de cor não disponível; usando seleção compatível.', error);
              }
          }

          if (!assignedColor) {
              const fallbackUsedColors = collectUsedRoomPlayerColors({}, players, members, playerId);
              assignedColor = getStoredPlayerColor(players[playerId]) || getStoredPlayerColor(members[playerId]) ||
                  chooseMostDistinctPlayerColor(fallbackUsedColors, playerId);
          }
          state.multiplayer.color = assignedColor;
          return assignedColor;
      }

      function detectClientBrowser(userAgent) {
          const rules = [
              { name: 'Microsoft Edge', pattern: /(?:EdgA?|EdgiOS)\/([\d.]+)/i },
              { name: 'Opera', pattern: /(?:OPR|Opera)\/([\d.]+)/i },
              { name: 'Samsung Internet', pattern: /SamsungBrowser\/([\d.]+)/i },
              { name: 'Firefox', pattern: /(?:Firefox|FxiOS)\/([\d.]+)/i },
              { name: 'Chrome', pattern: /(?:Chrome|CriOS)\/([\d.]+)/i },
              { name: 'Safari', pattern: /Version\/([\d.]+).*Safari/i }
          ];
          for (const rule of rules) {
              const match = userAgent.match(rule.pattern);
              if (match) return { name: rule.name, version: match[1] || '' };
          }
          return { name: 'Unknown', version: '' };
      }

      function detectClientOperatingSystem(userAgent) {
          let match;
          if ((match = userAgent.match(/Windows NT ([\d.]+)/i))) {
              const version = match[1] === '10.0' ? 'NT 10.0 (Windows 10/11; UA não distingue)' : `NT ${match[1]}`;
              return { name: 'Windows', version };
          }
          if ((match = userAgent.match(/(?:iPhone OS|CPU OS) ([\d_]+)/i))) return { name: 'iOS', version: match[1].replace(/_/g, '.') };
          if ((match = userAgent.match(/Android[\s-]([\d.]+)/i))) return { name: 'Android', version: match[1] };
          if ((match = userAgent.match(/Mac OS X ([\d_]+)/i))) return { name: 'macOS', version: match[1].replace(/_/g, '.') };
          if ((match = userAgent.match(/CrOS [^ ]+ ([\d.]+)/i))) return { name: 'ChromeOS', version: match[1] };
          if (/Linux/i.test(userAgent)) return { name: 'Linux', version: '' };
          return { name: 'Unknown', version: '' };
      }

      function collectClientMetadata() {
          const nav = typeof navigator !== 'undefined' ? navigator : {};
          const userAgent = String(nav.userAgent || '');
          const connection = nav.connection || nav.mozConnection || nav.webkitConnection || null;
          let timeZone = '';
          try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (error) { /* optional browser metadata */ }
          const languages = Array.isArray(nav.languages) ? nav.languages.slice(0, 5).map(value => String(value).slice(0, 32)) : [];
          return {
              schemaVersion: 1,
              capturedAtTimestamp: Date.now(),
              browser: detectClientBrowser(userAgent),
              operatingSystem: detectClientOperatingSystem(userAgent),
              platform: String((nav.userAgentData && nav.userAgentData.platform) || nav.platform || '').slice(0, 80),
              language: String(nav.language || '').slice(0, 32),
              languages,
              timeZone,
              online: typeof nav.onLine === 'boolean' ? nav.onLine : null,
              connectionType: connection && connection.effectiveType ? String(connection.effectiveType).slice(0, 16) : ''
          };
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
          const solution = valid.sol || solvePartialGrid(valid.initial, valid.N, valid.bR, valid.bC, valid.symbols);
          if (!solution || !solutionMatchesInitial(solution, valid.initial, valid.N, valid.bR, valid.bC, valid.symbols)) return null;
          valid.sol = solution.map(row => row.slice());
          valid.instanceCount = Number.isSafeInteger(Number(meta.instanceNumber)) && Number(meta.instanceNumber) >= 0 ? Number(meta.instanceNumber) : 0;
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

      function normalizeRoomContributionMap(raw) {
          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
          const result = {};
          for (const [key, entry] of Object.entries(raw).slice(0, 625)) {
              if (!/^\d{1,2}_\d{1,2}$/.test(key) || !entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
              const playerId = typeof entry.playerId === 'string' ? entry.playerId.slice(0, 128) : '';
              const playerName = typeof entry.playerName === 'string' ? entry.playerName.slice(0, 40) : '';
              const kind = entry.kind === 'NASA' || entry.action === 'NASA' || playerId === 'NASA' ? 'NASA' : 'PLAYER';
              if (!playerId) continue;
              result[key] = {
                  kind,
                  action: kind === 'NASA' ? 'NASA' : 'SET',
                  playerId,
                  playerName: kind === 'NASA' ? 'NASA' : (playerName || 'Jogador'),
                  ...(kind === 'PLAYER' ? { playerColor: normalizePlayerColor(entry.playerColor) } : {}),
                  timestamp: Number.isFinite(Number(entry.timestamp)) && Number(entry.timestamp) >= 0 ? Number(entry.timestamp) : 0
              };
          }
          return result;
      }

      function serializeExistingRoomContributions() {
          const result = serializeExistingNasaContributions();
          for (let r = 0; r < state.N; r++) {
              for (let c = 0; c < state.N; c++) {
                  const key = `${r}_${c}`;
                  if (state.initial[r][c] === '' && state.board[r][c] !== '' && !result[key]) {
                      result[key] = {
                          kind: 'PLAYER', action: 'SET', playerId: state.multiplayer.playerId,
                          playerName: String(state.multiplayer.playerName || 'Host').slice(0, 40),
                          playerColor: normalizePlayerColor(state.multiplayer.color), timestamp: Date.now()
                      };
                  }
              }
          }
          return result;
      }

      function serializeCurrentRoomBoard(instanceNumber = state.multiplayer.instanceCount) {
          return {
              boardInstanceNumber: instanceNumber,
              boardValues: state.board.map(row => row.map(value => value == null ? '' : String(value))),
              pencilNotes: state.multiplayer.roomMode === 'versus' ? null : state.notes.map(row => row.map(notes => Array.from(notes || []))),
              cellContributions: normalizeRoomContributionMap(state.multiplayer.contributions),
              nasaCalls: Math.max(0, Math.min(1000000, Math.floor(Number(state.nasaCalls) || 0))),
              elapsedSeconds: Math.max(0, Math.floor(Number(state.timerSeconds) || 0)),
              isCompleted: !!state.completed,
              gameName: String(state.gameName || '').slice(0, 100),
              lastUpdatedByPlayerId: String(state.multiplayer.playerId || '').slice(0, 128),
              updatedAtTimestamp: Date.now()
          };
      }

      function applyRoomBoardState(roomState) {
          if (!roomState || typeof roomState !== 'object' || Array.isArray(roomState) || !Array.isArray(roomState.boardValues)) return;
          const N = state.N;
          if (state.multiplayer.lastAppliedInstanceNumber === null || state.multiplayer.lastAppliedInstanceNumber === undefined || Number(roomState.boardInstanceNumber) !== Number(state.multiplayer.instanceCount)) {
              state.multiplayer.pendingBoardState = roomState;
              return;
          }
          const normalizedBoard = normalizeSymbolMatrix(roomState.boardValues, N, state.symbols);
          if (!normalizedBoard || !boardPreservesInitial(normalizedBoard, state.initial, N)) {
              console.warn('Estado de tabuleiro remoto inválido; a atualização foi descartada.');
              return;
          }
          const hasElapsed = roomState.elapsedSeconds !== undefined && roomState.elapsedSeconds !== null;
          const incomingElapsed = hasElapsed ? Number(roomState.elapsedSeconds) : state.timerSeconds;
          if (!Number.isSafeInteger(incomingElapsed) || incomingElapsed < 0 || incomingElapsed > 100000000) return;
          if (roomState.isCompleted !== undefined && typeof roomState.isCompleted !== 'boolean') return;
          const incomingCompleted = roomState.isCompleted === true;
          if (incomingCompleted && !isGridRuleValid(normalizedBoard, N, state.blockR, state.blockC, state.symbols, true)) {
              console.warn('Estado remoto marcou como concluída uma grade que não satisfaz as regras; atualização descartada.');
              return;
          }
          if (roomState.gameName !== undefined && (typeof roomState.gameName !== 'string' || roomState.gameName.length > 100)) return;
          let normalizedNotes = null;
          if (state.multiplayer.roomMode !== 'versus') {
              normalizedNotes = normalizeNotesGrid(roomState.pencilNotes, N, state.symbols);
              if (!normalizedNotes) return;
          }
          const normalizedCellContributions = normalizeRoomContributionMap(roomState.cellContributions);

          state.multiplayer.pendingBoardState = null;
          const wasCompleted = !!state.completed;
          const previousBoard = Array.isArray(state.board) ? state.board.map(row => row.slice()) : [];
          state.timerSeconds = incomingElapsed;
          state.timerLastTick = typeof getMonotonicNow === 'function' ? getMonotonicNow() : null;
          state.completed = incomingCompleted;
          state.board = normalizedBoard;
          if (Number.isSafeInteger(Number(roomState.nasaCalls)) && Number(roomState.nasaCalls) >= 0 && Number(roomState.nasaCalls) <= 1000000) {
              state.nasaCalls = Number(roomState.nasaCalls);
              state.multiplayer.hasSharedNasaCounter = true;
          }
          state.multiplayer.cellContributions = normalizedCellContributions;
          if (state.multiplayer.roomMode === 'versus') {
              for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
                  const incoming = state.board[r][c];
                  const previous = previousBoard[r] ? previousBoard[r][c] : '';
                  if (incoming !== '' && incoming !== previous) {
                      if (state.notes[r] && state.notes[r][c]) state.notes[r][c].clear();
                      removeAutoNotesPeers(r, c, incoming);
                  }
              }
              ensureNasaContributionGrid();
          } else {
              state.notes = normalizedNotes.map(row => row.map(cellNotes => new Set(cellNotes)));
          }
          if (typeof roomState.gameName === 'string') {
              state.gameName = roomState.gameName;
              const nameInput = document.getElementById('game-name-input');
              if (nameInput && nameInput.value !== state.gameName) nameInput.value = state.gameName;
          }
          for (let r = 0; r < N; r++) {
              for (let c = 0; c < N; c++) {
                  const input = document.getElementById(`cell-input-${r}-${c}`);
                  if (input && document.activeElement !== input && !state.typingBuffer) input.value = state.board[r][c];
                  updateCellPencilDOM(r, c);
              }
          }
          updateNasaContributionSummary();
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
          // State transitions that do not intentionally reset a puzzle only touch metadata,
          // never replace boardValues/pencilNotes with a potentially stale client snapshot.
          fb.update(boardStateRef, {
              nasaCalls: Math.max(0, Math.floor(Number(state.nasaCalls) || 0)),
              elapsedSeconds: Math.max(0, Math.floor(Number(state.timerSeconds) || 0)),
              isCompleted: !!state.completed,
              gameName: String(state.gameName || '').slice(0, 100),
              lastUpdatedByPlayerId: String(state.multiplayer.playerId || '').slice(0, 128),
              updatedAtTimestamp: Date.now()
          }).catch(error => console.error('Falha ao sincronizar metadados do tabuleiro:', error));
      }

      function publishRoomBoardCell(row, column, action = 'SET', noteSymbol = '', notePresent = true) {
          if (!state.multiplayer.active || !state.multiplayer.roomId || !Number.isInteger(row) || !Number.isInteger(column) || row < 0 || column < 0 || row >= state.N || column >= state.N) {
              return Promise.resolve({ committed: false, reason: 'invalid-coordinates' });
          }
          const fb = getFirebaseAPI();
          if (!fb || typeof fb.runTransaction !== 'function') return Promise.resolve({ committed: false, reason: 'transactions-unavailable' });
          const roomId = state.multiplayer.roomId;
          const playerId = String(state.multiplayer.playerId || '');
          const desiredValue = state.board[row][column] == null ? '' : String(state.board[row][column]);
          if (action !== 'NOTE' && desiredValue !== '' && !state.symbols.includes(desiredValue)) return Promise.resolve({ committed: false, reason: 'invalid-value' });
          if (!['SET', 'ERASE', 'NASA', 'NOTE'].includes(action)) return Promise.resolve({ committed: false, reason: 'invalid-action' });
          if (action === 'NOTE' && state.multiplayer.roomMode === 'versus') return Promise.resolve({ committed: false, reason: 'private-notes' });
          const normalizedNoteSymbol = String(noteSymbol == null ? '' : noteSymbol);
          if (action === 'NOTE' && !state.symbols.includes(normalizedNoteSymbol)) return Promise.resolve({ committed: false, reason: 'invalid-note-symbol' });
          const boardStateRef = fb.ref(fb.db, roomPath(roomId, 'boardState'));
          const key = `${row}_${column}`;
          return fb.runTransaction(boardStateRef, currentValue => {
              if (!currentValue || typeof currentValue !== 'object' || Array.isArray(currentValue) || Number(currentValue.boardInstanceNumber) !== Number(state.multiplayer.instanceCount)) return;
              const currentBoard = normalizeSymbolMatrix(currentValue.boardValues, state.N, state.symbols);
              if (!currentBoard || !boardPreservesInitial(currentBoard, state.initial, state.N)) return;
              const currentContributionMap = normalizeRoomContributionMap(currentValue.cellContributions);
              const currentValueAtCell = currentBoard[row][column];
              const currentOwner = currentContributionMap[key];
              const hasOtherOwner = currentOwner && currentOwner.playerId !== playerId;
              const currentCellIsCorrect = currentValueAtCell !== '' && currentValueAtCell === state.solution[row][column];

              if (action === 'NOTE') {
                  // Notes are a delta on the shared cell, not a stale client-side replacement.
                  // A missing notes grid is normalized to an empty grid for legacy rooms.
                  const normalizedNotes = normalizeNotesGrid(currentValue.pencilNotes, state.N, state.symbols);
                  if (!normalizedNotes) return;
                  const notesCopy = normalizedNotes.map(noteRow => noteRow.map(notes => notes.slice()));
                  const cellNotes = notesCopy[row][column];
                  if (notePresent) {
                      if (!cellNotes.includes(normalizedNoteSymbol) && cellNotes.length < state.N) cellNotes.push(normalizedNoteSymbol);
                  } else {
                      notesCopy[row][column] = cellNotes.filter(symbol => symbol !== normalizedNoteSymbol);
                  }
                  return { ...currentValue, pencilNotes: notesCopy, lastUpdatedByPlayerId: playerId, updatedAtTimestamp: Date.now() };
              }

              // Correct cells are owned by the player who entered them. NASA cells are owned by NASA.
              // If attribution is missing (legacy room), fail closed rather than allow score theft.
              if (currentCellIsCorrect && (!currentOwner || hasOtherOwner)) return;
              if (action === 'ERASE' && currentCellIsCorrect && currentOwner.playerId !== playerId) return;
              if (action === 'NASA' && currentCellIsCorrect) return;

              const boardCopy = currentBoard.map(boardRow => boardRow.slice());
              const contributionCopy = { ...currentContributionMap };
              let nextNasaCalls = Math.max(0, Math.floor(Number(currentValue.nasaCalls) || 0));
              if (action === 'ERASE') {
                  boardCopy[row][column] = '';
                  delete contributionCopy[key];
              } else {
                  boardCopy[row][column] = desiredValue;
                  if (action === 'NASA') {
                      contributionCopy[key] = { kind: 'NASA', action: 'NASA', playerId: 'NASA', playerName: 'NASA', timestamp: Date.now() };
                      nextNasaCalls = Math.min(1000000, nextNasaCalls + 1);
                  } else {
                      contributionCopy[key] = {
                          kind: 'PLAYER', action: 'SET', playerId,
                          playerName: String(state.multiplayer.playerName || 'Jogador').slice(0, 40),
                          playerColor: normalizePlayerColor(state.multiplayer.color), timestamp: Date.now()
                      };
                  }
              }

              let pencilNotes = currentValue.pencilNotes;
              if (Array.isArray(pencilNotes) && pencilNotes.length === state.N && pencilNotes.every(noteRow => Array.isArray(noteRow) && noteRow.length === state.N) && action !== 'NASA') {
                  pencilNotes = pencilNotes.map(noteRow => noteRow.map(notes => Array.isArray(notes) ? notes.slice() : []));
                  pencilNotes[row][column] = [];
                  if (action === 'SET' && desiredValue !== '') {
                      const startRow = Math.floor(row / state.blockR) * state.blockR;
                      const startColumn = Math.floor(column / state.blockC) * state.blockC;
                      for (let index = 0; index < state.N; index++) {
                          pencilNotes[row][index] = pencilNotes[row][index].filter(symbol => String(symbol) !== desiredValue);
                          pencilNotes[index][column] = pencilNotes[index][column].filter(symbol => String(symbol) !== desiredValue);
                      }
                      for (let r = startRow; r < startRow + state.blockR; r++) {
                          for (let c = startColumn; c < startColumn + state.blockC; c++) pencilNotes[r][c] = pencilNotes[r][c].filter(symbol => String(symbol) !== desiredValue);
                      }
                  }
              } else if (state.multiplayer.roomMode === 'versus') {
                  pencilNotes = null;
              }
              return {
                  ...currentValue,
                  boardValues: boardCopy,
                  pencilNotes,
                  cellContributions: contributionCopy,
                  nasaCalls: nextNasaCalls,
                  elapsedSeconds: Math.max(0, Math.floor(Number(state.timerSeconds) || 0)),
                  isCompleted: false,
                  lastUpdatedByPlayerId: playerId,
                  updatedAtTimestamp: Date.now()
              };
          }, false).then(result => ({
              committed: !!(result && result.committed),
              value: result && result.snapshot && typeof result.snapshot.val === 'function' ? result.snapshot.val() : null,
              reason: result && result.committed ? '' : 'transaction-aborted'
          }));
      }

      function registerRoomPresence(roomId) {
          const fb = getFirebaseAPI();
          if (!fb) return;
          ensureMultiplayerColor();
          const playerId = String(state.multiplayer.playerId || '');
          const presence = {
              playerId,
              playerName: String(state.multiplayer.playerName || 'Jogador').slice(0, 40),
              playerColor: normalizePlayerColor(state.multiplayer.color),
              joinedAtTimestamp: Date.now()
          };
          const playerRef = fb.ref(fb.db, roomPath(roomId, `players/${playerId}`));
          const memberRef = fb.ref(fb.db, roomPath(roomId, `members/${playerId}`));
          const cursorRef = fb.ref(fb.db, roomPath(roomId, `cursors/${playerId}`));
          state.multiplayer.presenceRef = playerRef;
          state.multiplayer.cursorRef = cursorRef;
          // Current membership records are ephemeral. Historical diagnostics live in a separate node.
          Promise.all([fb.onDisconnect(playerRef).remove(), fb.onDisconnect(memberRef).remove(), fb.onDisconnect(cursorRef).remove()])
              .then(() => Promise.all([fb.set(playerRef, presence), fb.set(memberRef, presence)]))
              .catch(error => {
                  console.error('Falha ao registrar presença multiplayer:', error);
                  fb.set(playerRef, presence).catch(() => {});
                  fb.set(memberRef, presence).catch(() => {});
              });
          const metricsRef = fb.ref(fb.db, roomPath(roomId, `metrics/${playerId}`));
          const metricRecord = { ...presence, clientMetadata: collectClientMetadata() };
          fb.set(metricsRef, metricRecord).catch(error => console.warn('Não foi possível registrar métricas de diagnóstico:', error));
      }


      function forceApplyNewMetaState(meta, announceNewInstance = true) {
          const validMeta = validateRoomMeta(meta);
          if (!validMeta) {
              console.error('Os metadados da sala não são válidos:', meta);
              showToast('A sala enviou metadados de Sudoku inválidos.', 'warn');
              return false;
          }
          const solved = validMeta.sol || solvePartialGrid(validMeta.initial, validMeta.N, validMeta.bR, validMeta.bC, validMeta.symbols);
          if (!solved || !solutionMatchesInitial(solved, validMeta.initial, validMeta.N, validMeta.bR, validMeta.bC, validMeta.symbols)) {
              showToast('A sala enviou um puzzle sem solução válida. A instância atual foi preservada.', 'warn');
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
          state.solution = solved.map(row => row.slice());
          state.board = state.initial.map(row => row.slice());
          state.notes = Array.from({ length: state.N }, () => Array.from({ length: state.N }, () => new Set()));
          state.nasaContributions = Array.from({ length: state.N }, () => Array(state.N).fill(false));
          state.nasaCalls = 0;
          state.multiplayer.contributions = {};
          state.multiplayer.cellContributions = {};
          state.multiplayer.hasSharedNasaCounter = false;
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



    function appendRoomMove(fb, roomId, movePayload) {
        const movesRef = fb.ref(fb.db, roomPath(roomId, 'moves'));
        return fb.push(movesRef, movePayload);
    }

    function restoreBoardStateAfterRejectedMove(fb, roomId, result, row, column) {
        const apply = current => {
            if (!current) return;
              state.multiplayer.cellContributions = normalizeRoomContributionMap(current.cellContributions);
              state.multiplayer.contributions = normalizeRoomContributionMap(current.cellContributions);
              applyRoomBoardState(current);
              const key = `${row}_${column}`;
              const owner = state.multiplayer.cellContributions[key];
              if (owner && owner.playerId !== state.multiplayer.playerId && state.board[row] && state.board[row][column] === state.solution[row][column]) {
                  showToast('Essa resposta correta está protegida: só quem a colocou pode alterá-la.', 'warn');
              } else {
                  showToast('A jogada não foi sincronizada porque o estado da sala mudou. A grade foi atualizada.', 'warn');
              }
          };
          if (result && result.value) { apply(result.value); return; }
          const fbRef = fb.ref(fb.db, roomPath(roomId, 'boardState'));
          fb.get(fbRef).then(snapshot => apply(snapshot && snapshot.val ? snapshot.val() : null)).catch(error => {
              console.warn('Não foi possível recuperar o tabuleiro após uma jogada rejeitada.', error);
              showToast('Falha de sincronização. Verifique sua conexão antes de continuar.', 'warn');
          });
      }

      function isCellProtectedByAnotherPlayer(row, column) {
          if (!state.multiplayer || !state.multiplayer.active || !state.multiplayer.roomId || !Number.isInteger(row) || !Number.isInteger(column) || row < 0 || column < 0 || row >= state.N || column >= state.N) return false;
          if (state.initial[row][column] !== '' || !Array.isArray(state.solution[row])) return false;
          const value = state.board[row][column];
          if (!value || value !== state.solution[row][column]) return false;
          const key = `${row}_${column}`;
          const owner = (state.multiplayer.cellContributions && state.multiplayer.cellContributions[key]) ||
              (state.multiplayer.contributions && state.multiplayer.contributions[key]);
          // Missing attribution may occur in a legacy or inconsistent room; don't permit score theft.
          return !owner || String(owner.playerId || '') !== String(state.multiplayer.playerId || '');
      }

      function pushMoveToFirebase(action, row, column, value, notePresent) {
          if (!state.multiplayer.active || !state.multiplayer.roomId) return Promise.resolve({ committed: false, reason: 'not-in-room' });
          if (action === 'NOTE' && state.multiplayer.roomMode === 'versus') return Promise.resolve({ committed: false, reason: 'private-notes' });
          const fb = getFirebaseAPI();
          if (!fb) return Promise.resolve({ committed: false, reason: 'firebase-unavailable' });
          ensureMultiplayerColor();
          const roomId = state.multiplayer.roomId;
          state.multiplayer.lastProcessedSeq = (state.multiplayer.lastProcessedSeq || 0) + 1;
          const movePayload = {
              sequence: state.multiplayer.lastProcessedSeq,
              timestamp: Date.now(),
              userId: String(state.multiplayer.playerId || '').slice(0, 128),
              userName: String(state.multiplayer.playerName || 'Jogador').slice(0, 40),
              userColor: normalizePlayerColor(state.multiplayer.color),
              action,
              row,
              column,
              value: typeof value === 'string' ? value.slice(0, 32) : ''
          };

          if (action === 'FOCUS') {
              if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 || column < 0 || row >= state.N || column >= state.N) return Promise.resolve({ committed: false, reason: 'invalid-coordinates' });
              const cursorRef = fb.ref(fb.db, roomPath(roomId, `cursors/${state.multiplayer.playerId}`));
              return fb.set(cursorRef, movePayload).catch(error => {
                  console.warn('Não foi possível atualizar o cursor multiplayer.', error);
                  return { committed: false, reason: 'cursor-write-failed' };
              });
          }

          if (['SET', 'ERASE', 'NASA', 'NOTE'].includes(action)) {
              const desiredNotePresent = action === 'NOTE'
                  ? (typeof notePresent === 'boolean' ? notePresent : state.notes[row][column].has(String(value)))
                  : true;
              return publishRoomBoardCell(row, column, action, value, desiredNotePresent).then(result => {
                  if (!result || !result.committed || !result.value) {
                      restoreBoardStateAfterRejectedMove(fb, roomId, result, row, column);
                      return;
                  }
                  const current = result.value;
                  state.multiplayer.cellContributions = normalizeRoomContributionMap(current.cellContributions);
                  state.multiplayer.contributions = normalizeRoomContributionMap(current.cellContributions);
                  if (Number.isFinite(Number(current.nasaCalls))) state.nasaCalls = Number(current.nasaCalls);
                  applyRoomBoardState(current);
                  if (action === 'SET' || action === 'NASA') {
                      const contribution = state.multiplayer.cellContributions[`${row}_${column}`];
                      const attributionRef = fb.ref(fb.db, roomPath(roomId, `contributions/${row}_${column}`));
                      fb.set(attributionRef, contribution || null).catch(error => console.warn('Não foi possível sincronizar a atribuição da célula.', error));
                  } else if (action === 'ERASE') {
                      fb.remove(fb.ref(fb.db, roomPath(roomId, `contributions/${row}_${column}`))).catch(error => console.warn('Não foi possível remover a atribuição da célula.', error));
                  }
                  updateAllCellVisuals(); updateNasaContributionSummary(); renderMultiplayerSidebar();
                  appendRoomMove(fb, roomId, movePayload).catch(error => console.error('Erro ao registrar jogada no Firebase:', error));
              }).catch(error => {
                  console.error('Falha na transação da célula multiplayer:', error);
                  restoreBoardStateAfterRejectedMove(fb, roomId, null, row, column);
                  return { committed: false, reason: 'transaction-failed' };
              });
          }
          return appendRoomMove(fb, roomId, movePayload).catch(error => {
              console.error('Erro ao registrar jogada no Firebase:', error);
              return { committed: false, reason: 'move-log-failed' };
          });
      }

      function processIncomingMove(move) {
          if (!move || typeof move !== 'object' || Array.isArray(move) || !state.multiplayer.active) return;
          const userId = typeof (move.userId || move.u) === 'string' ? String(move.userId || move.u).slice(0, 128) : '';
          const action = typeof (move.action || move.act) === 'string' ? String(move.action || move.act) : '';
          const row = move.row !== undefined ? Number(move.row) : Number(move.r);
          const column = move.column !== undefined ? Number(move.column) : Number(move.c);
          const rawTimestamp = Number(move.timestamp);
          const allowedActions = new Set(['FOCUS', 'SET', 'ERASE', 'NOTE', 'NASA']);
          if (!userId || userId === state.multiplayer.playerId || !allowedActions.has(action) || !Number.isFinite(rawTimestamp)) return;
          if (rawTimestamp < Date.now() - 120000 || rawTimestamp > Date.now() + 60000) return;
          if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 || column < 0 || row >= state.N || column >= state.N) return;
          const userName = typeof (move.userName || move.name) === 'string' ? String(move.userName || move.name).trim().slice(0, 40) : 'Jogador';
          const userColor = normalizePlayerColor(move.userColor);
          state.multiplayer.peers = state.multiplayer.peers || {};
          state.multiplayer.peers[userId] = { row, column, name: userName || 'Jogador', color: userColor, lastSeen: Date.now() };
          if (action === 'FOCUS' || action === 'SET' || action === 'ERASE' || action === 'NOTE' || action === 'NASA') {
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

      function normalizeRoomPresenceRecords(records) {
          const safeRecords = {};
          if (!records || typeof records !== 'object' || Array.isArray(records)) return safeRecords;
          for (const [playerId, player] of Object.entries(records).slice(0, 100)) {
              if (!player || typeof player !== 'object' || Array.isArray(player) || typeof playerId !== 'string' || !playerId || playerId.length > 128) continue;
              safeRecords[playerId] = {
                  playerId,
                  playerName: typeof player.playerName === 'string' ? player.playerName.trim().slice(0, 40) || 'Jogador' : 'Jogador',
                  playerColor: normalizePlayerColor(player.playerColor),
                  joinedAtTimestamp: Number.isFinite(Number(player.joinedAtTimestamp)) && Number(player.joinedAtTimestamp) >= 0 ? Number(player.joinedAtTimestamp) : 0
              };
          }
          return safeRecords;
      }

      function onRoomMembersChanged(members) {
          state.multiplayer.members = normalizeRoomPresenceRecords(members);
          updateAllCellVisuals();
          const victoryModal = document.getElementById('modal-victory');
          if (victoryModal && victoryModal.classList.contains('flex') && state.completed) updateMultiplayerVictorySummary();
      }

      function onRoomPlayersChanged(players) {
          const safePlayers = normalizeRoomPresenceRecords(players);
          const onlineIds = new Set(Object.keys(safePlayers));
          Object.keys(state.multiplayer.peers || {}).forEach(playerId => { if (!onlineIds.has(playerId)) delete state.multiplayer.peers[playerId]; });
          Object.entries(safePlayers).forEach(([playerId, player]) => {
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
          const pendingProposal = state.multiplayer.currentProposal;
          if (pendingProposal && pendingProposal.status === 'pending') executeMultiplayerNewGame(pendingProposal);
          const settledFeatureVote = state.multiplayer.currentFeatureVote;
          if (settledFeatureVote && settledFeatureVote.status === 'approved') executeApprovedFeatureVote(settledFeatureVote);
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
          const cursorsRef = fb.ref(fb.db, roomPath(roomId, 'cursors'));
          const featureVoteRef = fb.ref(fb.db, roomPath(roomId, 'featureVote'));
          const settingsRef = fb.ref(fb.db, roomPath(roomId, 'settings'));

          state.multiplayer.listeners.push(fb.onValue(contributionsRef, snapshot => {
              state.multiplayer.contributions = normalizeRoomContributionMap(snapshot.val());
              updateAllCellVisuals();
              updateNasaContributionSummary();
              renderMultiplayerSidebar();
              const victoryModal = document.getElementById('modal-victory');
              if (victoryModal && victoryModal.classList.contains('flex') && state.completed) updateMultiplayerVictorySummary();
          }));
          state.multiplayer.listeners.push(fb.onValue(membersRef, snapshot => onRoomMembersChanged(snapshot.val())));
          state.multiplayer.listeners.push(fb.onValue(cursorsRef, snapshot => {
              const cursors = snapshot.val();
              if (!cursors || typeof cursors !== 'object' || Array.isArray(cursors)) return;
              for (const [playerId, cursor] of Object.entries(cursors)) {
                  if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) continue;
                  processIncomingMove({ ...cursor, userId: cursor.userId || playerId, action: 'FOCUS' });
              }
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
              if (!state.multiplayer.hasSharedNasaCounter && nasaMoveCount !== Number(state.nasaCalls || 0)) {
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

      function normalizeRoomId(value) {
          if (typeof value !== 'string') return null;
          const roomId = value.trim().replace(/[.#$\[\]/\u0000-\u001F\u007F]/g, '_');
          if (!roomId || roomId.length > 40) return null;
          return roomId;
      }

      function generateSecureRoomId() {
          try {
              if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
                  const bytes = new Uint8Array(8); crypto.getRandomValues(bytes);
                  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
              }
          } catch (error) { /* fallback does not provide cryptographic guarantees */ }
          return createClientIdentifier('R').replace(/[^A-Za-z0-9]/g, '').slice(-16).toUpperCase();
      }

      function joinRoom(roomId, playerName) {
          roomId = normalizeRoomId(roomId);
          if (!roomId) { showToast('O ID da sala contém caracteres inválidos ou é longo demais.', 'warn'); return; }
          const fb = getFirebaseAPI();
          if (!fb) { showToast('Firebase indisponível.', 'warn'); return; }
          if (state.multiplayer.active) {
              showToast('Desconecte da sala atual antes de entrar em outra.', 'warn');
              return;
          }
          const metaRef = fb.ref(fb.db, roomPath(roomId, 'meta'));
          let joinStarted = false;
          fb.onValue(metaRef, async snapshot => {
              if (joinStarted || state.multiplayer.active) return;
              const meta = snapshot.val();
              const validMeta = validateRoomMeta(meta);
              if (!validMeta) {
                  showToast('Sala não encontrada ou com metadados inválidos.', 'warn');
                  return;
              }
              joinStarted = true;
              state.multiplayer.active = true;
              state.multiplayer.roomId = roomId;
              state.multiplayer.playerName = playerName || 'Jogador';
              state.multiplayer.color = null;
              state.multiplayer.players = {};
              state.multiplayer.members = {};
              state.multiplayer.peers = {};
              await assignRoomPlayerColor(roomId);
              state.multiplayer.instanceCount = validMeta.instanceCount;
              state.multiplayer.roomMode = meta.roomMode === 'versus' ? 'versus' : 'coop';
              state.multiplayer.realtimeMetrics = !!meta.realtimeMetrics;
              const modeLabel = document.getElementById('mp-room-mode-label');
              if (modeLabel) modeLabel.textContent = state.multiplayer.roomMode === 'versus' ? '⚔️ Rinha de Galo 🐓' : '🤝 Prosa e Cafézin ☕';
              state.multiplayer.contributions = {};
              state.multiplayer.lastAppliedInstanceNumber = null;
              state.multiplayer.processedMoveIds = {};
              state.multiplayer.cellContributions = {};
              state.multiplayer.hasSharedNasaCounter = false;
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

      async function hostRoom(playerName) {
          if (state.isManualCreating) { showToast('Finalize a criação manual antes de hospedar.', 'warn'); return; }
          const fb = getFirebaseAPI();
          if (!fb || typeof fb.runTransaction !== 'function') { showToast('Firebase/transactions indisponível. Não é seguro criar a sala sem reserva atômica.', 'warn'); return; }
          if (state.multiplayer.active) { showToast('Desconecte da sala atual antes de hospedar outra.', 'warn'); return; }

          const rawRoomName = document.getElementById('multiplayer-room-input').value.trim();
          let roomId = rawRoomName ? normalizeRoomId(rawRoomName) : generateSecureRoomId();
          if (!roomId) { showToast('O nome da sala contém caracteres inválidos ou excede 40 caracteres.', 'warn'); return; }
          const previous = {
              gameId: state.gameId,
              gameName: state.gameName,
              multiplayer: { ...state.multiplayer }
          };
          state.multiplayer.roomMode = document.getElementById('multiplayer-room-mode')?.value === 'versus' ? 'versus' : 'coop';
          state.multiplayer.realtimeMetrics = state.multiplayer.roomMode === 'versus' && !!document.getElementById('multiplayer-realtime-metrics')?.checked;
          state.multiplayer.active = true;
          state.multiplayer.roomId = roomId;
          state.multiplayer.playerName = String(playerName || 'Host').trim().slice(0, 40) || 'Host';
          state.multiplayer.color = ensureMultiplayerColor();
          state.multiplayer.instanceCount = 0;
          state.multiplayer.lastAppliedInstanceNumber = 0;
          state.multiplayer.lastProcessedSeq = 0;
          state.multiplayer.processedMoveIds = {};
          state.multiplayer.peers = {};
          state.multiplayer.players = {};
          state.multiplayer.members = {};
          state.multiplayer.contributions = serializeExistingRoomContributions();
          state.multiplayer.cellContributions = normalizeRoomContributionMap(state.multiplayer.contributions);
          state.multiplayer.hasSharedNasaCounter = true;
          state.multiplayer.currentFeatureVote = null;
          state.multiplayer.gameResult = null;
          state.gameId = 'mp_' + roomId + '_0';
          state.gameName = 'Sala: ' + roomId + ' #0';
          const nameInput = document.getElementById('game-name-input'); if (nameInput) nameInput.value = state.gameName;

          const roomRef = fb.ref(fb.db, roomPath(roomId));
          const metaPayload = createRoomMeta(0, state.multiplayer.playerId);
          const boardState = serializeCurrentRoomBoard(0);
          boardState.gameName = state.gameName;
          const roomPayload = {
              meta: metaPayload,
              boardState,
              moves: {},
              contributions: state.multiplayer.contributions,
              members: {},
              settings: { immediateErrorCheck: false },
              colorAssignments: { [state.multiplayer.playerId]: normalizePlayerColor(state.multiplayer.color) }
          };
          try {
              const result = await fb.runTransaction(roomRef, currentValue => currentValue == null ? roomPayload : undefined, false);
              if (!result || !result.committed) {
                  throw Object.assign(new Error('ROOM_ALREADY_EXISTS'), { code: 'ROOM_ALREADY_EXISTS' });
              }
              try { await assignRoomPlayerColor(roomId); }
              catch (colorError) { console.warn('A sala foi criada, mas a atribuição avançada de cor falhou; mantendo a cor local.', colorError); }
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
          } catch (error) {
              console.error('Erro ao criar sala multiplayer:', error);
              // A reserva atômica pode ter falhado por colisão; restaure os valores locais
              // que foram preparados otimisticamente antes da transação.
              Object.assign(state.multiplayer, previous.multiplayer);
              state.gameId = previous.gameId;
              state.gameName = previous.gameName;
              if (nameInput) nameInput.value = state.gameName || '';
              showToast(error && error.code === 'ROOM_ALREADY_EXISTS' ? 'Esse ID já pertence a uma sala. Escolha outro nome ou deixe o campo vazio para gerar um ID seguro.' : 'Erro ao criar sala. Verifique sua conexão e as regras do Firebase.', 'warn');
          }
      }
