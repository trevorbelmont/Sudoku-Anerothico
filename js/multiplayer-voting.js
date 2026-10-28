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
                  fb.remove(movesRef),
                  fb.set(fb.child(roomRef, 'contributions'), {})
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


/* v6.0: non-blocking multiplayer feature-vote cards */
function computeContributionStats() {
    const contributions = state.multiplayer.contributions && typeof state.multiplayer.contributions === 'object' ? state.multiplayer.contributions : {};
    const counts = new Map();
    Object.values(contributions).forEach(entry => {
        // NASA is a separate contribution category, never a player's completion credit.
        if (!entry || !entry.playerId || isNASAContributionEntry(entry)) return;
        const current = counts.get(entry.playerId) || { playerId: entry.playerId, name: entry.playerName || 'Jogador', count: 0 };
        current.count += 1;
        if (entry.playerName) current.name = entry.playerName;
        counts.set(entry.playerId, current);
    });
    // Keep every participant visible in the final summary, even if disconnected or if they contributed zero cells.
    Object.entries(state.multiplayer.members || {}).forEach(([playerId, player]) => {
        if (!counts.has(playerId)) counts.set(playerId, { playerId, name: player.playerName || player.name || 'Jogador', count: 0 });
    });
    Object.entries(state.multiplayer.players || {}).forEach(([playerId, player]) => {
        if (!counts.has(playerId)) counts.set(playerId, { playerId, name: player.playerName || 'Jogador', count: 0 });
    });
    if (state.multiplayer.playerId && !counts.has(state.multiplayer.playerId)) counts.set(state.multiplayer.playerId, { playerId: state.multiplayer.playerId, name: state.multiplayer.playerName || 'Você', count: 0 });
    const rows = Array.from(counts.values());
    const nasaCount = getNasaContributionStats().count;
    const total = rows.reduce((sum, item) => sum + item.count, 0) + nasaCount;
    rows.forEach(item => { item.percent = total ? Math.round(item.count / total * 100) : 0; });
    return rows.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'pt-BR'));
}

function renderFeatureVoteCard(vote) {
    const container = document.getElementById('mp-feature-vote-toast');
    const expanded = document.getElementById('mp-feature-vote-expanded');
    const pill = document.getElementById('mp-feature-vote-pill');
    if (!container || !expanded || !pill) return;
    if (!vote || vote.status !== 'pending' || !state.multiplayer.active) {
        container.classList.add('hidden');
        state.multiplayer.featureVoteMinimized = false;
        return;
    }
    container.classList.remove('hidden');
    expanded.classList.toggle('hidden', !!state.multiplayer.featureVoteMinimized);
    pill.classList.toggle('hidden', !state.multiplayer.featureVoteMinimized);
    const title = document.getElementById('mp-feature-vote-title');
    const message = document.getElementById('mp-feature-vote-message');
    const status = document.getElementById('mp-feature-vote-status');
    const actionButtons = document.getElementById('mp-feature-vote-actions');
    const yesNames = { nasa: 'É o 🚂 tá feio!', immediateError: '😌 Suave 🤙' };
    const noNames = { nasa: 'Cê num é doido! 😤', immediateError: '🐔 Deixe de ser frango! 🧐' };
    const abstainNames = { nasa: 'Cês que sabe... ¯\\_(ツ)_/¯', immediateError: '🙄 Já que cê insiste... 🤷' };
    const featureName = vote.type === 'nasa' ? 'chamar a NASA' : (vote.requestedValue ? 'ativar o erro imediato' : 'desativar o erro imediato');
    title.textContent = vote.type === 'nasa' ? '🪐 Votação: chamar a NASA' : '🗳️ Votação: erro imediato';
    message.textContent = `${vote.proposerName || 'Um jogador'} quer ${featureName}. Vote aqui no canto; dá para continuar jogando enquanto decide.`;
    const votes = vote.votes && typeof vote.votes === 'object' ? vote.votes : {};
    const count = { yes: 0, no: 0, abstain: 0 };
    Object.values(votes).forEach(v => { if (v && count[v.choice] !== undefined) count[v.choice]++; });
    const online = Math.max(1, Object.keys(state.multiplayer.players || {}).length);
    status.textContent = `A favor: ${count.yes} · Contra: ${count.no} · Abstenções: ${count.abstain} · Conectados: ${online}. Aprovação exige pelo menos ${Math.ceil(online / 2)} voto(s) a favor.`;
    const mine = votes[state.multiplayer.playerId];
    actionButtons.classList.toggle('hidden', !!mine);
    const [yesBtn, noBtn, abstainBtn] = actionButtons.querySelectorAll('[data-feature-vote]');
    yesBtn.textContent = yesNames[vote.type] || 'Aprovar';
    noBtn.textContent = noNames[vote.type] || 'Negar';
    abstainBtn.textContent = abstainNames[vote.type] || 'Abster-se';
    if (mine) status.textContent += ` Sua resposta: ${mine.choice === 'yes' ? 'a favor' : mine.choice === 'no' ? 'contra' : 'abstenção'}.`;
}

function onFeatureVoteChanged(vote) {
    if (!state.multiplayer.active) return;
    if (!vote) {
        state.multiplayer.currentFeatureVote = null;
        renderFeatureVoteCard(null);
        return;
    }
    state.multiplayer.currentFeatureVote = vote;
    renderFeatureVoteCard(vote);
    if (vote.status === 'pending') evaluateFeatureVote(vote);
    else if (vote.status === 'approved' || vote.status === 'rejected') {
        const handled = state.multiplayer.observedFeatureVoteIds || (state.multiplayer.observedFeatureVoteIds = {});
        if (!handled[vote.voteId]) {
            handled[vote.voteId] = true;
            if (vote.status === 'approved') showToast(vote.type === 'nasa' ? 'A sala aprovou chamar a NASA!' : `A sala aprovou ${vote.requestedValue ? 'ativar' : 'desativar'} o erro imediato.`, 'success');
            else showToast(vote.type === 'nasa' ? 'A sala decidiu seguir sem chamar a NASA desta vez.' : 'A alteração do erro imediato não atingiu votos suficientes.', 'info');
        }
        setTimeout(() => {
            const fb = getFirebaseAPI();
            if (!fb || !state.multiplayer.roomId || state.multiplayer.playerId !== vote.proposerId) return;
            const ref = fb.ref(fb.db, roomPath(state.multiplayer.roomId, 'featureVote'));
            fb.get(ref).then(snapshot => {
                const current = snapshot.val();
                if (current && current.voteId === vote.voteId && current.status !== 'pending') return fb.remove(ref);
                return null;
            }).catch(() => {});
        }, 1700);
    }
}

function evaluateFeatureVote(vote) {
    const fb = getFirebaseAPI();
    if (!fb || !state.multiplayer.roomId || !vote || vote.status !== 'pending') return;
    const voterIds = Object.keys(state.multiplayer.players || {});
    if (!voterIds.includes(state.multiplayer.playerId)) voterIds.push(state.multiplayer.playerId);
    const total = Math.max(1, voterIds.length);
    const threshold = Math.ceil(total / 2);
    const votes = vote.votes && typeof vote.votes === 'object' ? vote.votes : {};
    const yes = Object.values(votes).filter(v => v && v.choice === 'yes').length;
    const no = Object.values(votes).filter(v => v && v.choice === 'no').length;
    const allAnswered = voterIds.every(id => !!votes[id]);
    let nextStatus = null;
    if (yes >= threshold) nextStatus = 'approved';
    else if (allAnswered) nextStatus = 'rejected';
    if (!nextStatus) return;
    const voteRef = fb.ref(fb.db, roomPath(state.multiplayer.roomId, 'featureVote'));
    const resolving = state.multiplayer.resolvingFeatureVoteIds || (state.multiplayer.resolvingFeatureVoteIds = {});
    if (resolving[vote.voteId]) return;
    resolving[vote.voteId] = true;
    fb.update(voteRef, { status: nextStatus, resolvedAtTimestamp: Date.now(), yesCount: yes, noCount: no, eligibleCount: total }).then(() => {
        if (nextStatus !== 'approved') return;
        if (vote.type === 'immediateError') {
            const settingsRef = fb.ref(fb.db, roomPath(state.multiplayer.roomId, 'settings'));
            fb.update(settingsRef, { immediateErrorCheck: !!vote.requestedValue, immediateErrorUpdatedAt: Date.now(), immediateErrorUpdatedBy: vote.proposerId }).catch(error => console.error(error));
        } else if (vote.type === 'nasa' && vote.proposerId === state.multiplayer.playerId) {
            giveNasaHint();
        }
    }).catch(error => { delete resolving[vote.voteId]; console.error('Não foi possível concluir a votação:', error); });
}

function requestFeatureVote(type, requestedValue = null) {
    const fb = getFirebaseAPI();
    if (!fb || !state.multiplayer.active || !state.multiplayer.roomId) return false;
    if (state.multiplayer.currentFeatureVote && state.multiplayer.currentFeatureVote.status === 'pending') {
        showToast('Já existe uma votação ativa nesta sala. Responda à votação atual primeiro.', 'warn');
        renderFeatureVoteCard(state.multiplayer.currentFeatureVote);
        return true;
    }
    const voteId = `feature_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const vote = {
        voteId, type, requestedValue, proposerId: state.multiplayer.playerId,
        proposerName: state.multiplayer.playerName || 'Jogador', status: 'pending', votes: {}, createdAtTimestamp: Date.now()
    };
    const ref = fb.ref(fb.db, roomPath(state.multiplayer.roomId, 'featureVote'));
    fb.set(ref, vote).then(() => renderFeatureVoteCard(vote)).catch(error => {
        console.error('Falha ao abrir votação da sala:', error);
        showToast('Não foi possível abrir a votação. Confira as regras do Firebase.', 'warn');
    });
    return true;
}

function castFeatureVote(choice) {
    const fb = getFirebaseAPI();
    const vote = state.multiplayer.currentFeatureVote;
    if (!fb || !vote || vote.status !== 'pending' || !state.multiplayer.roomId) return;
    const voteRef = fb.ref(fb.db, roomPath(state.multiplayer.roomId, `featureVote/votes/${state.multiplayer.playerId}`));
    fb.set(voteRef, { choice, playerId: state.multiplayer.playerId, playerName: state.multiplayer.playerName, timestamp: Date.now() }).catch(error => {
        console.error(error); showToast('Não foi possível registrar seu voto.', 'warn');
    });
}
