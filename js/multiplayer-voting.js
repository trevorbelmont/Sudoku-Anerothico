'use strict';

async function requestNewGameConsensus() {
          const fb = getFirebaseAPI();
          if (!fb || !state.multiplayer.active || !state.multiplayer.roomId) return;
          let N = state.N;
          if (state.mode === 'custom') {
              const cfg = updateCustomRangePreview();
              if (!cfg) { showToast('Ajuste o intervalo antes de solicitar outro tabuleiro.', 'warn'); return; }
              N = cfg.N;
          } else N = 9;

          let livePlayers = {};
          try {
              const playersSnapshot = await fb.get(fb.ref(fb.db, roomPath(state.multiplayer.roomId, 'players')));
              livePlayers = playersSnapshot.val() || {};
          } catch (error) {
              console.error('Falha ao consultar os jogadores online:', error);
              showToast('Não foi possível conferir quem está online para abrir a votação.', 'warn');
              return;
          }
          const proposalId = 'proposal_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
          const requiredPlayerIds = Array.from(new Set([
              ...Object.keys(livePlayers),
              state.multiplayer.playerId
          ]));
          const proposal = {
              proposalId,
              proposerId: state.multiplayer.playerId,
              proposerName: state.multiplayer.playerName,
              gameMode: state.mode,
              difficultyLevel: state.difficulty,
              minimumSymbolValue: state.mode === 'custom' ? Number(document.getElementById('custom-min-input').value) : 1,
              maximumSymbolValue: state.mode === 'custom' ? Number(document.getElementById('custom-max-input').value) : 9,
              includesZeroValue: state.mode === 'custom' ? document.getElementById('custom-include-zero').checked : false,
              boardDimension: N,
              requiredPlayerIds,
              baseInstanceNumber: state.multiplayer.instanceCount,
              status: 'pending',
              voters: {},
              createdAtTimestamp: Date.now()
          };
          const propRef = fb.ref(fb.db, roomPath(state.multiplayer.roomId, 'proposal'));
          state.multiplayer.currentProposal = proposal;
          state.multiplayer.lastObservedProposalId = proposalId;
          state.multiplayer.observedProposalVoteIds = {};
          fb.set(propRef, proposal).then(() => {
              showProposalWaitingState(proposal, true);
          }).catch(error => {
              console.error('Não foi possível solicitar novo tabuleiro:', error);
              showToast('Não foi possível enviar a proposta de novo tabuleiro.', 'warn');
          });
      }

      function executeMultiplayerNewGame(proposal) {
          if (!proposal || proposal.proposerId !== state.multiplayer.playerId || proposal.status !== 'pending') return;
          if (state.multiplayer.executingProposalId === proposal.proposalId) return;
          state.multiplayer.executingProposalId = proposal.proposalId;
          const fb = getFirebaseAPI();
          if (!fb) { state.multiplayer.executingProposalId = null; return; }

          try {
              const mode = proposal.gameMode || 'standard';
              const difficulty = proposal.difficultyLevel || 'medio';
              let minVal = 1, maxVal = 9, includeZero = false;
              let symbols = buildSymbolsFromRange(1, 9, false), N = 9, blockR = 3, blockC = 3;
              if (mode === 'custom') {
                  minVal = Number(proposal.minimumSymbolValue);
                  maxVal = Number(proposal.maximumSymbolValue);
                  includeZero = !!proposal.includesZeroValue;
                  symbols = buildSymbolsFromRange(minVal, maxVal, includeZero);
                  N = symbols.length;
                  const dims = computeBlockDimensions(N);
                  blockR = dims.blockR;
                  blockC = dims.blockC;
              }
              if (N < 4 || N > 25) throw new Error('Dimensão inválida para um novo tabuleiro.');
              const { solution, initial } = createUniqueSudokuPuzzle(N, blockR, blockC, symbols, difficulty);
              const nextInstanceNumber = Number(state.multiplayer.instanceCount || 0) + 1;
              const metaPayload = createRoomMeta(nextInstanceNumber, proposal.proposerId, {
                  gameMode: mode,
                  difficultyLevel: difficulty,
                  minimumSymbolValue: minVal,
                  maximumSymbolValue: maxVal,
                  includesZeroValue: includeZero,
                  boardDimension: N,
                  blockRowCount: blockR,
                  blockColumnCount: blockC,
                  symbolValues: symbols,
                  fixedInitialGrid: initial,
                  solutionGrid: solution
              });
              const blankBoardState = {
                  boardInstanceNumber: nextInstanceNumber,
                  boardValues: initial.map(row => row.slice()),
                  pencilNotes: Array.from({ length: N }, () => Array.from({ length: N }, () => [])),
                  elapsedSeconds: 0,
                  isCompleted: false,
                  gameName: `Sala: ${state.multiplayer.roomId} #${nextInstanceNumber}`,
                  lastUpdatedByPlayerId: proposal.proposerId,
                  updatedAtTimestamp: Date.now()
              };
              const roomRef = fb.ref(fb.db, roomPath(state.multiplayer.roomId));
              const metaRef = fb.child(roomRef, 'meta');
              const boardStateRef = fb.child(roomRef, 'boardState');
              const movesRef = fb.child(roomRef, 'moves');

              // A gravação de meta + boardState é explícita e versionada; todos aplicam a instância nova pela escuta contínua de meta.
              Promise.all([
                  fb.set(metaRef, metaPayload),
                  fb.set(boardStateRef, blankBoardState),
                  fb.remove(movesRef)
              ]).then(() => {
                  state.multiplayer.instanceCount = nextInstanceNumber;
                  state.multiplayer.executedProposalId = proposal.proposalId;
                  const propRef = fb.child(roomRef, 'proposal');
                  return fb.update(propRef, {
                      status: 'completed',
                      resultingInstanceNumber: nextInstanceNumber,
                      completedAtTimestamp: Date.now()
                  });
              }).then(() => {
                  setTimeout(() => {
                      const propRef = fb.ref(fb.db, roomPath(state.multiplayer.roomId, 'proposal'));
                      fb.remove(propRef).catch(() => {});
                  }, 900);
              }).catch(error => {
                  console.error('Falha ao gerar a nova instância multiplayer:', error);
                  showToast('A votação foi aprovada, mas não foi possível gravar o novo tabuleiro. Tente novamente.', 'warn');
              }).finally(() => {
                  state.multiplayer.executingProposalId = null;
              });
          } catch (error) {
              state.multiplayer.executingProposalId = null;
              console.error(error);
              showToast(error.message || 'Não foi possível gerar o novo tabuleiro.', 'warn');
          }
      }


      function onRoomProposalChanged(proposal) {
          const modal = document.getElementById('modal-vote-newgame');
          if (!proposal) {
              const previous = state.multiplayer.currentProposal;
              const modalWasOpen = modal.classList.contains('flex');
              if (modalWasOpen) closeModal('modal-vote-newgame');
              if (previous && previous.status === 'pending' && !state.multiplayer.completedProposalIds.includes(previous.proposalId)) {
                  // O modal do proponente fecha localmente antes da remoção e não recebe toast duplicado.
                  if (modalWasOpen) showToast(`${previous.proposerName || 'O proponente'} cancelou a proposta de novo tabuleiro.`, 'info');
              }
              state.multiplayer.currentProposal = null;
              state.multiplayer.lastObservedProposalId = null;
              state.multiplayer.observedProposalVoteIds = {};
              return;
          }

          state.multiplayer.currentProposal = proposal;
          const proposalId = proposal.proposalId || proposal.id || `proposal_${proposal.createdAtTimestamp || 0}`;
          if (state.multiplayer.lastObservedProposalId !== proposalId) {
              state.multiplayer.lastObservedProposalId = proposalId;
              state.multiplayer.observedProposalVoteIds = {};
          }

          if (proposal.status === 'rejected') {
              if (!state.multiplayer.handledProposalEndIds) state.multiplayer.handledProposalEndIds = [];
              if (!state.multiplayer.handledProposalEndIds.includes(proposalId)) {
                  state.multiplayer.handledProposalEndIds.push(proposalId);
                  const rejectorName = proposal.rejectedByName || 'Um jogador';
                  showToast(`${rejectorName} recusou a proposta de novo tabuleiro. A partida atual continua.`, 'warn');
              }
              if (modal.classList.contains('flex')) closeModal('modal-vote-newgame');
              if (state.multiplayer.playerId === proposal.proposerId) {
                  setTimeout(() => {
                      const fb = getFirebaseAPI();
                      if (fb && state.multiplayer.roomId) fb.remove(fb.ref(fb.db, roomPath(state.multiplayer.roomId, 'proposal'))).catch(() => {});
                  }, 1200);
              }
              return;
          }

          if (proposal.status === 'completed') {
              if (!state.multiplayer.completedProposalIds.includes(proposalId)) state.multiplayer.completedProposalIds.push(proposalId);
              if (!state.multiplayer.handledProposalEndIds) state.multiplayer.handledProposalEndIds = [];
              if (!state.multiplayer.handledProposalEndIds.includes(proposalId)) {
                  state.multiplayer.handledProposalEndIds.push(proposalId);
                  showToast(`Todos aceitaram a proposta de ${proposal.proposerName || 'novo tabuleiro'}; a nova instância foi gerada.`, 'success');
              }
              if (modal.classList.contains('flex')) closeModal('modal-vote-newgame');
              if (state.multiplayer.playerId === proposal.proposerId) {
                  setTimeout(() => {
                      const fb = getFirebaseAPI();
                      if (fb && state.multiplayer.roomId) fb.remove(fb.ref(fb.db, roomPath(state.multiplayer.roomId, 'proposal'))).catch(() => {});
                  }, 900);
              }
              return;
          }

          const voters = proposal.voters && typeof proposal.voters === 'object' ? proposal.voters : {};
          Object.entries(voters).forEach(([voterId, voter]) => {
              if (voterId === proposal.proposerId) return;
              if (!state.multiplayer.observedProposalVoteIds[voterId]) {
                  state.multiplayer.observedProposalVoteIds[voterId] = true;
                  const voterName = voter.playerName || voter.name || 'Um jogador';
                  showToast(`${voterName} aceitou a proposta de novo tabuleiro.`, 'success');
              }
          });

          if (proposal.proposerId === state.multiplayer.playerId) {
              showProposalWaitingState(proposal, true);
              renderProposalAcceptors(proposal);
              const requiredIds = Array.isArray(proposal.requiredPlayerIds) ? proposal.requiredPlayerIds : [proposal.proposerId];
              const otherPlayers = requiredIds.filter(id => id !== proposal.proposerId);
              const consensusReached = otherPlayers.every(id => !!voters[id]);
              if (consensusReached) executeMultiplayerNewGame(proposal);
          } else if (voters[state.multiplayer.playerId]) {
              showProposalWaitingState(proposal, false);
          } else {
              handleNewGameProposal(proposal);
          }
      }
