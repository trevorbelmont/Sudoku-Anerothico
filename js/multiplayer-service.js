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
              schemaVersion: 2,
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
              // solutionGrid é omitido intencionalmente: cada cliente re-deriva a solução localmente
              // via solvePartialGrid para que ela não fique exposta no Firebase para todos lerem.
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
          // Anti-cheat: ao aplicar o estado remoto, não permite que uma célula com valor correto
          // seja apagada por outro jogador. Se o valor remoto é vazio e o local é correto, preserva o local.
          const incomingBoard = roomState.boardValues.map(row => row.map(value => value == null ? '' : String(value)));
          state.board = incomingBoard.map((row, r) => row.map((incomingVal, c) => {
              if (state.initial[r] && state.initial[r][c] !== '') return state.initial[r][c]; // pista fixa
              const localVal = previousBoard[r] ? previousBoard[r][c] : '';
              const isLocalCorrect = localVal !== '' && state.solution && state.solution[r] && localVal === state.solution[r][c];
              if (isLocalCorrect && incomingVal === '') return localVal; // preserva valor correto local
              return incomingVal;
          }));
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
              if (nameInput && nameInput.value !== state.gameName) setGameNameInput(state.gameName);
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

      // Atualiza o timestamp de última atividade da sala (chamado a cada interação significativa).
      // Isso alimenta o marcador de proteção contra sobrescrita da sala por N dias.
      function touchRoomActivity() {
          if (!state.multiplayer.active || !state.multiplayer.roomId) return;
          const fb = getFirebaseAPI();
          if (!fb) return;
          const roomPresenceRef = fb.ref(fb.db, roomPath(state.multiplayer.roomId, 'presence'));
          fb.update(roomPresenceRef, { lastSeenTimestamp: Date.now(), isActive: true }).catch(() => {});
      }

      // Verifica se uma sala com roomId já existe e se está ativa ou protegida.
      // Retorna: 'active' | 'protected' | 'free'
      async function checkRoomStatus(roomId) {
          const fb = getFirebaseAPI();
          if (!fb) return 'free';
          try {
              // Lê apenas o nó 'presence' — menor e suficiente para a decisão.
              const snapshot = await fb.get(fb.ref(fb.db, roomPath(roomId, 'presence')));
              const presence = snapshot && typeof snapshot.val === 'function' ? snapshot.val() : null;
              if (!presence || typeof presence !== 'object') return 'free';
              if (presence.isActive === true) return 'active';
              const lastSeen = Number(presence.lastSeenTimestamp) || 0;
              if (!lastSeen) return 'free';
              const protectionMs = (typeof ROOM_PROTECTION_DAYS === 'number' ? ROOM_PROTECTION_DAYS : 2) * 24 * 60 * 60 * 1000;
              if (Date.now() - lastSeen < protectionMs) return 'protected';
              return 'free';
          } catch (error) {
              console.warn('Não foi possível verificar o status da sala:', error);
              // Em caso de falha de leitura, assume livre para não bloquear o jogo.
              return 'free';
          }
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
          // Remove o cursor do jogador ao desconectar para não deixar avatar flutuante.
          const cursorRef = fb.ref(fb.db, roomPath(roomId, `cursors/${state.multiplayer.playerId}`));
          fb.onDisconnect(cursorRef).remove().catch(() => {});
          const memberRef = fb.ref(fb.db, roomPath(roomId, `members/${state.multiplayer.playerId}`));
          // Apenas informações de presença pública são gravadas no nó members (lido por todos).
          // Os metadados do cliente ficam em privateData, que deve ser protegido pelas regras do Firebase.
          fb.set(memberRef, { ...presence }).catch(error => console.warn('Não foi possível registrar o participante no histórico da sala:', error));
          const privateRef = fb.ref(fb.db, roomPath(roomId, `privateData/${state.multiplayer.playerId}/clientMetadata`));
          fb.set(privateRef, collectClientMetadata()).catch(() => { /* privateData pode não existir nas regras legadas; ignorar silenciosamente */ });

          // Marcador de atividade da sala: isActive volta para false ao desconectar;
          // lastSeenTimestamp persiste para implementar o período de proteção contra sobrescrita.
          const roomPresenceRef = fb.ref(fb.db, roomPath(roomId, 'presence'));
          fb.onDisconnect(roomPresenceRef).update({ isActive: false, lastDisconnectedTimestamp: Date.now() }).catch(() => {});
          fb.update(roomPresenceRef, { isActive: true, lastSeenTimestamp: Date.now() }).catch(() => {});
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
          setGameNameInput(state.gameName);
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
          // FOCUS events usam um nó mutável de cursor, não o log append-only. Ver publishCursorToFirebase.
          if (action === 'FOCUS') { publishCursorToFirebase(row, column); return; }
          const fb = getFirebaseAPI();
          if (!fb) return;
          ensureMultiplayerColor();
          state.multiplayer.lastProcessedSeq = (state.multiplayer.lastProcessedSeq || 0) + 1;
          const movePayload = {
              sequence: state.multiplayer.lastProcessedSeq,
              // serverTimestamp() é resolvido pelo Firebase no servidor, evitando skew de relógio.
              // O campo clientTimestamp fica como fallback de ordenação local.
              timestamp: fb.serverTimestamp ? fb.serverTimestamp() : Date.now(),
              clientTimestamp: Date.now(),
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
          publishRoomBoardCell(row, column, action === 'SET' || action === 'NASA');
          if (['SET', 'ERASE', 'NASA'].includes(action) && row >= 0 && column >= 0) {
              state.multiplayer.contributions = state.multiplayer.contributions || {};
              const localKey = `${row}_${column}`;
              if (action === 'NASA' && String(value ?? '') !== '') {
                  state.multiplayer.contributions[localKey] = { kind: 'NASA', action: 'NASA', playerId: 'NASA', playerName: 'NASA', timestamp: Date.now() };
              } else if (action === 'SET' && String(value ?? '') !== '') {
                  state.multiplayer.contributions[localKey] = { kind: 'PLAYER', action: 'SET', playerId: state.multiplayer.playerId, playerName: state.multiplayer.playerName, playerColor: state.multiplayer.color, timestamp: Date.now() };
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
                  operation = fb.set(attributionRef, { kind: 'PLAYER', action: 'SET', playerId: state.multiplayer.playerId, playerName: state.multiplayer.playerName, playerColor: state.multiplayer.color, timestamp: Date.now() });
              } else {
                  operation = fb.remove(attributionRef);
              }
              operation.catch(error => console.error('Falha ao atualizar a contribuição da célula:', error));
          }
      }

      // Publica a posição do cursor do jogador local num nó mutável por jogador,
      // em vez de anexar ao log append-only de moves. Isso evita crescimento ilimitado do log de moves.
      function publishCursorToFirebase(row, column) {
          if (!state.multiplayer.active || !state.multiplayer.roomId) return;
          const fb = getFirebaseAPI();
          if (!fb) return;
          ensureMultiplayerColor();
          const cursorRef = fb.ref(fb.db, roomPath(state.multiplayer.roomId, `cursors/${state.multiplayer.playerId}`));
          fb.set(cursorRef, {
              row,
              column,
              userId: state.multiplayer.playerId,
              userName: state.multiplayer.playerName,
              userColor: state.multiplayer.color,
              timestamp: Date.now()
          }).catch(() => { /* cursor updates are best-effort */ });
          // Toda movimentação de cursor conta como atividade da sala para o marcador de proteção.
          touchRoomActivity();
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
          const cursorsRef = fb.ref(fb.db, roomPath(roomId, 'cursors'));

          // Listener de cursores: atualiza a posição visível de cada jogador sem poluir o log de moves.
          state.multiplayer.listeners.push(fb.onValue(cursorsRef, snapshot => {
              const cursors = snapshot.val() && typeof snapshot.val() === 'object' ? snapshot.val() : {};
              state.multiplayer.peers = state.multiplayer.peers || {};
              Object.entries(cursors).forEach(([userId, cursor]) => {
                  if (userId === state.multiplayer.playerId) return;
                  if (!cursor || typeof cursor !== 'object') return;
                  const row = Number.isInteger(Number(cursor.row)) ? Number(cursor.row) : -1;
                  const column = Number.isInteger(Number(cursor.column)) ? Number(cursor.column) : -1;
                  const userName = typeof cursor.userName === 'string' ? cursor.userName.slice(0, 64) : 'Jogador';
                  const userColor = typeof cursor.userColor === 'string' && /^#[0-9a-f]{6}$/i.test(cursor.userColor) ? cursor.userColor : '#3b82f6';
                  const previous = state.multiplayer.peers[userId] || {};
                  state.multiplayer.peers[userId] = { ...previous, row, column, name: userName, color: userColor, lastSeen: Date.now() };
              });
              // Remove cursores de jogadores que não estão mais online.
              const onlineIds = new Set(Object.keys(state.multiplayer.players || {}));
              Object.keys(state.multiplayer.peers).forEach(id => { if (!onlineIds.has(id)) delete state.multiplayer.peers[id]; });
              updateAllCellVisuals();
              renderMultiplayerSidebar();
          }));

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
              updateAllCellVisuals();
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
          // Usa onChildAdded para receber apenas o movimento individual mais recente,
          // em vez de onValue que baixa o log completo a cada nova jogada.
          // Na entrada da sala, faz um get() único para contar NASA calls históricas e
          // marcar os IDs já existentes como processados (sem re-executar moves antigas).
          fb.get(movesRef).then(snapshot => {
              const moves = snapshot.val();
              if (!moves || typeof moves !== 'object') return;
              const nasaMoveCount = Object.values(moves).filter(m => m && (m.action || m.act) === 'NASA').length;
              if (nasaMoveCount !== Number(state.nasaCalls || 0)) {
                  state.nasaCalls = nasaMoveCount;
                  updateNasaContributionSummary();
                  renderMultiplayerSidebar();
                  saveCurrentGameState();
              }
              // Marca todos os moves pré-existentes como já processados (não re-executa cursores antigos).
              Object.keys(moves).forEach(id => { state.multiplayer.processedMoveIds[id] = true; });
          }).catch(() => {});

          const unsubMoves = fb.onChildAdded(movesRef, (childSnapshot) => {
              const moveId = childSnapshot.key;
              const move = childSnapshot.val();
              if (!move || state.multiplayer.processedMoveIds[moveId]) return;
              state.multiplayer.processedMoveIds[moveId] = true;
              if (move.action === 'NASA' || move.act === 'NASA') {
                  state.nasaCalls = (Number(state.nasaCalls) || 0) + 1;
                  updateNasaContributionSummary();
                  renderMultiplayerSidebar();
                  saveCurrentGameState();
                  const victoryModal = document.getElementById('modal-victory');
                  if (victoryModal && victoryModal.classList.contains('flex') && state.completed) updateMultiplayerVictorySummary();
              }
              processIncomingMove(move);
              const processedIds = Object.keys(state.multiplayer.processedMoveIds);
              if (processedIds.length > 2000) {
                  state.multiplayer.processedMoveIds = Object.fromEntries(processedIds.slice(-1000).map(id => [id, true]));
              }
          });
          state.multiplayer.listeners.push(unsubMoves);
      }

      function joinRoom(roomId, playerName) {
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
          if (!roomId) {
              // Sala com nome automático: usa crypto.getRandomValues para gerar um ID com alta entropia.
              // IDs aleatórios têm chance de colisão desprezível, então não verificamos existência.
              const bytes = new Uint8Array(8);
              crypto.getRandomValues(bytes);
              roomId = Array.from(bytes, b => b.toString(36).padStart(2, '0')).join('').toUpperCase().slice(0, 8);
          } else {
              roomId = roomId.replace(/[.#$\[\]/]/g, '_');
              // Nome personalizado: verifica se a sala já existe e se está protegida.
              showToast('Verificando sala...', 'info');
              const status = await checkRoomStatus(roomId);
              if (status === 'active') {
                  showToast(`A sala "${roomId}" está ativa com jogadores conectados. Entre nela ou escolha outro nome.`, 'warn');
                  return;
              }
              if (status === 'protected') {
                  const days = typeof ROOM_PROTECTION_DAYS === 'number' ? ROOM_PROTECTION_DAYS : 2;
                  showToast(`Uma sala com o nome "${roomId}" já existe e foi usada recentemente (protegida por ${days} dias). Entre nela ou escolha outro nome para criar a sua.`, 'warn');
                  return;
              }
              // status === 'free': sala não existe ou expirou → pode sobrescrever.
          }

          // Só muta o estado local depois da verificação passar.
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
          setGameNameInput(state.gameName);

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
          ]).then(async () => {
              await assignRoomPlayerColor(roomId);
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
