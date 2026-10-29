'use strict';

async function requestNewGameConsensus() {
    const fb = getFirebaseAPI();
    if (!fb || !state.multiplayer.active || !state.multiplayer.roomId) return;
    if (typeof fb.runTransaction !== 'function') {
        showToast('O Firebase não oferece transações; não é seguro abrir a votação.', 'warn');
        return;
    }
    let N = state.mode === 'custom' ? state.N : 9;
    if (state.mode === 'custom') {
        const cfg = updateCustomRangePreview();
        if (!cfg) { showToast('Ajuste o intervalo antes de solicitar outro tabuleiro.', 'warn'); return; }
        N = cfg.N;
    }

    let livePlayers = {};
    try {
        const snapshot = await fb.get(fb.ref(fb.db, roomPath(state.multiplayer.roomId, 'players')));
        const raw = snapshot && typeof snapshot.val === 'function' ? snapshot.val() : null;
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) livePlayers = raw;
    } catch (error) {
        console.error('Falha ao consultar os jogadores online:', error);
        showToast('Não foi possível conferir quem está online para abrir a votação.', 'warn');
        return;
    }
    const requiredPlayerIds = Array.from(new Set([
        ...Object.keys(livePlayers).filter(id => id.length > 0 && id.length <= 128).slice(0, 100),
        String(state.multiplayer.playerId || '')
    ].filter(Boolean))).sort();
    const proposal = {
        proposalId: createClientIdentifier('proposal_'),
        proposerId: state.multiplayer.playerId,
        proposerName: String(state.multiplayer.playerName || 'Jogador').trim().slice(0, 40) || 'Jogador',
        gameMode: state.mode === 'custom' ? 'custom' : 'standard',
        difficultyLevel: Object.prototype.hasOwnProperty.call(DIFFICULTY_REMOVAL_RATIOS, state.difficulty) ? state.difficulty : 'medio',
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
    try {
        const result = await fb.runTransaction(propRef, current => {
            if (current && typeof current === 'object' && current.status === 'pending') return;
            return proposal;
        }, false);
        if (!result || !result.committed) {
            const current = result && result.snapshot && typeof result.snapshot.val === 'function' ? result.snapshot.val() : null;
            if (current && current.status === 'pending') {
                state.multiplayer.currentProposal = current;
                state.multiplayer.lastObservedProposalId = current.proposalId || null;
                showProposalWaitingState(current, current.proposerId === state.multiplayer.playerId);
                showToast('Já existe uma proposta de novo tabuleiro nesta sala.', 'warn');
            } else showToast('Não foi possível reservar a votação de novo tabuleiro. Tente novamente.', 'warn');
            return;
        }
        state.multiplayer.currentProposal = proposal;
        state.multiplayer.lastObservedProposalId = proposal.proposalId;
        state.multiplayer.observedProposalVoteIds = {};
        showProposalWaitingState(proposal, true);
    } catch (error) {
        console.error('Não foi possível solicitar novo tabuleiro:', error);
        showToast('Não foi possível enviar a proposta de novo tabuleiro.', 'warn');
    }
}

async function executeMultiplayerNewGame(rawProposal) {
    const proposal = rawProposal;
    if (!proposal || proposal.status !== 'pending' || typeof proposal.proposalId !== 'string' || !state.multiplayer.active || !state.multiplayer.roomId) return;
    const requiredPlayerIds = Array.isArray(proposal.requiredPlayerIds)
        ? Array.from(new Set(proposal.requiredPlayerIds.filter(id => typeof id === 'string' && id.length > 0 && id.length <= 128))).slice(0, 100)
        : [];
    if (!requiredPlayerIds.includes(proposal.proposerId)) return;
    const voters = proposal.voters && typeof proposal.voters === 'object' && !Array.isArray(proposal.voters) ? proposal.voters : {};
    const otherPlayerIds = requiredPlayerIds.filter(id => id !== proposal.proposerId);
    if (!otherPlayerIds.every(id => !!voters[id])) return;
    if (state.multiplayer.executingProposalId === proposal.proposalId) return;

    const fb = getFirebaseAPI();
    if (!fb || typeof fb.runTransaction !== 'function') return;
    const players = state.multiplayer.players && typeof state.multiplayer.players === 'object' ? state.multiplayer.players : {};
    const onlineEligible = requiredPlayerIds.filter(id => !!players[id]);
    if (state.multiplayer.playerId && requiredPlayerIds.includes(state.multiplayer.playerId) && !onlineEligible.includes(state.multiplayer.playerId)) onlineEligible.push(state.multiplayer.playerId);
    const executor = onlineEligible.includes(proposal.proposerId) ? proposal.proposerId : onlineEligible.filter(id => id !== proposal.proposerId).sort()[0];
    if (!executor || executor !== state.multiplayer.playerId) return;

    state.multiplayer.executingProposalId = proposal.proposalId;
    const propRef = fb.ref(fb.db, roomPath(state.multiplayer.roomId, 'proposal'));
    let claimedProposal = null;
    try {
        const claimResult = await fb.runTransaction(propRef, current => {
            if (!current || typeof current !== 'object' || Array.isArray(current) || current.proposalId !== proposal.proposalId || current.status !== 'pending') return;
            const currentRequired = Array.isArray(current.requiredPlayerIds)
                ? Array.from(new Set(current.requiredPlayerIds.filter(id => typeof id === 'string' && id.length > 0 && id.length <= 128))).slice(0, 100)
                : [];
            if (!currentRequired.includes(current.proposerId)) return;
            const currentVoters = current.voters && typeof current.voters === 'object' && !Array.isArray(current.voters) ? current.voters : {};
            if (!currentRequired.filter(id => id !== current.proposerId).every(id => !!currentVoters[id])) return;
            if (current.executionClaimedBy && current.executionClaimedBy === state.multiplayer.playerId) return;
            if (current.executionClaimedBy && onlineEligible.includes(current.executionClaimedBy)) return;
            return { ...current, executionClaimedBy: state.multiplayer.playerId, executionClaimedAtTimestamp: Date.now() };
        }, false);
        if (!claimResult || !claimResult.committed) return;
        claimedProposal = claimResult.snapshot && typeof claimResult.snapshot.val === 'function' ? claimResult.snapshot.val() : null;
        if (!claimedProposal || claimedProposal.executionClaimedBy !== state.multiplayer.playerId) return;

        const mode = proposal.gameMode === 'custom' ? 'custom' : (proposal.gameMode === 'standard' ? 'standard' : null);
        const difficulty = Object.prototype.hasOwnProperty.call(DIFFICULTY_REMOVAL_RATIOS, proposal.difficultyLevel) ? proposal.difficultyLevel : null;
        if (!mode || !difficulty) throw new Error('A proposta possui modo ou dificuldade inválidos.');

        let minVal = 1, maxVal = 9, includeZero = false;
        let symbols = buildSymbolsFromRange(1, 9, false), N = 9, blockR = 3, blockC = 3;
        if (mode === 'custom') {
            minVal = Number(proposal.minimumSymbolValue);
            maxVal = Number(proposal.maximumSymbolValue);
            includeZero = proposal.includesZeroValue === true;
            if (!Number.isSafeInteger(minVal) || !Number.isSafeInteger(maxVal) || Math.abs(minVal) > 1000000 || Math.abs(maxVal) > 1000000 || Math.abs(maxVal - minVal) > 25) {
                throw new Error('O intervalo personalizado informado pela sala é inválido.');
            }
            symbols = buildSymbolsFromRange(minVal, maxVal, includeZero);
            N = symbols.length;
            const dims = computeBlockDimensions(N);
            blockR = dims.blockR;
            blockC = dims.blockC;
        }
        if (N < 4 || N > 25 || Number(proposal.boardDimension) !== N) throw new Error('Dimensão inválida para um novo tabuleiro.');
        const { solution, initial } = createUniqueSudokuPuzzle(N, blockR, blockC, symbols, difficulty);
        if (!solutionMatchesInitial(solution, initial, N, blockR, blockC, symbols)) throw new Error('O gerador não retornou uma solução válida.');

        const nextInstanceNumber = Math.max(0, Number(state.multiplayer.instanceCount) || 0) + 1;
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
            pencilNotes: state.multiplayer.roomMode === 'versus' ? null : Array.from({ length: N }, () => Array.from({ length: N }, () => [])),
            cellContributions: {},
            nasaCalls: 0,
            elapsedSeconds: 0,
            isCompleted: false,
            gameName: `Sala: ${state.multiplayer.roomId} #${nextInstanceNumber}`,
            lastUpdatedByPlayerId: proposal.proposerId,
            updatedAtTimestamp: Date.now()
        };
        const completedProposal = {
            ...claimedProposal,
            status: 'completed',
            resultingInstanceNumber: nextInstanceNumber,
            completedAtTimestamp: Date.now()
        };
        const proposalRoomId = state.multiplayer.roomId;
        const roomRef = fb.ref(fb.db, roomPath(proposalRoomId));
        // Publica nova meta, tabuleiro, limpeza de histórico e conclusão da proposta no mesmo patch.
        await fb.update(roomRef, {
            meta: metaPayload,
            boardState: blankBoardState,
            moves: null,
            contributions: null,
            proposal: completedProposal
        });
        state.multiplayer.instanceCount = nextInstanceNumber;
        state.multiplayer.executedProposalId = proposal.proposalId;
        setTimeout(() => {
            if (state.multiplayer.roomId !== proposalRoomId) return;
            const currentProposalRef = fb.ref(fb.db, roomPath(proposalRoomId, 'proposal'));
            fb.get(currentProposalRef).then(snapshot => {
                const current = snapshot.val();
                if (current && current.proposalId === proposal.proposalId && current.status === 'completed') return fb.remove(currentProposalRef);
                return null;
            }).catch(() => {});
        }, 900);
    } catch (error) {
        console.error('Falha ao gerar a nova instância multiplayer:', error);
        // Do not leave a claimed proposal pending forever after an executor-side failure.
        try {
            await fb.runTransaction(propRef, current => {
                if (!current || typeof current !== 'object' || Array.isArray(current) || current.proposalId !== proposal.proposalId || current.status !== 'pending' || current.executionClaimedBy !== state.multiplayer.playerId) return;
                return { ...current, status: 'rejected', executionFailed: true, failureMessage: String(error && error.message || 'Falha na geração').slice(0, 180), rejectedAtTimestamp: Date.now() };
            }, false);
        } catch (markError) {
            console.warn('Não foi possível marcar a proposta com falha:', markError);
        }
        showToast(error.message || 'Não foi possível gerar o novo tabuleiro.', 'warn');
    } finally {
        state.multiplayer.executingProposalId = null;
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
                  if (proposal.executionFailed) showToast('A proposta foi encerrada porque houve uma falha ao gerar o novo tabuleiro. A partida atual continua.', 'warn');
                  else showToast(`${rejectorName} recusou a proposta de novo tabuleiro. A partida atual continua.`, 'warn');
              }
              if (modal.classList.contains('flex')) closeModal('modal-vote-newgame');
              if (state.multiplayer.playerId === proposal.proposerId) {
                  setTimeout(() => {
                      const fb = getFirebaseAPI();
                      if (fb && state.multiplayer.roomId) {
                      const rejectedRoomId = state.multiplayer.roomId;
                      const rejectedProposalRef = fb.ref(fb.db, roomPath(rejectedRoomId, 'proposal'));
                      fb.get(rejectedProposalRef).then(snapshot => {
                          const current = snapshot && typeof snapshot.val === 'function' ? snapshot.val() : null;
                          if (current && current.proposalId === proposalId && current.status === 'rejected') return fb.remove(rejectedProposalRef);
                          return null;
                      }).catch(() => {});
                  }
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
          } else if (voters[state.multiplayer.playerId]) {
              showProposalWaitingState(proposal, false);
          } else {
              handleNewGameProposal(proposal);
          }
          const requiredIds = Array.isArray(proposal.requiredPlayerIds) ? proposal.requiredPlayerIds.filter(id => typeof id === 'string').slice(0, 100) : [proposal.proposerId];
          const accepted = proposal.voters && typeof proposal.voters === 'object' && !Array.isArray(proposal.voters) ? proposal.voters : {};
          if (requiredIds.filter(id => id !== proposal.proposerId).every(id => !!accepted[id])) executeMultiplayerNewGame(proposal);
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

function getFeatureVoteEligibleIds(vote) {
    const rawIds = Array.isArray(vote && vote.eligiblePlayerIds)
        ? vote.eligiblePlayerIds
        : [...Object.keys(state.multiplayer.players || {}), state.multiplayer.playerId];
    const ids = Array.from(new Set(rawIds.filter(id => typeof id === 'string' && id.length > 0 && id.length <= 128))).slice(0, 100);
    if (vote && typeof vote.proposerId === 'string' && vote.proposerId && !ids.includes(vote.proposerId)) ids.push(vote.proposerId);
    return ids;
}

function normalizeFeatureVote(vote) {
    if (!vote || typeof vote !== 'object' || Array.isArray(vote)) return null;
    if (typeof vote.voteId !== 'string' || !vote.voteId || vote.voteId.length > 160) return null;
    if (!['nasa', 'immediateError'].includes(vote.type)) return null;
    if (typeof vote.proposerId !== 'string' || !vote.proposerId || vote.proposerId.length > 128) return null;
    if (!['pending', 'approved', 'rejected'].includes(vote.status)) return null;
    if (vote.type === 'immediateError' && typeof vote.requestedValue !== 'boolean') return null;
    return {
        ...vote,
        proposerName: typeof vote.proposerName === 'string' ? vote.proposerName.slice(0, 40) : 'Jogador',
        eligiblePlayerIds: getFeatureVoteEligibleIds(vote),
        votes: vote.votes && typeof vote.votes === 'object' && !Array.isArray(vote.votes) ? vote.votes : {}
    };
}

function renderFeatureVoteCard(rawVote) {
    const container = document.getElementById('mp-feature-vote-toast');
    const expanded = document.getElementById('mp-feature-vote-expanded');
    const pill = document.getElementById('mp-feature-vote-pill');
    if (!container || !expanded || !pill) return;
    const vote = normalizeFeatureVote(rawVote);
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
    if (!title || !message || !status || !actionButtons) return;
    const yesNames = { nasa: 'É o 🚂 tá feio!', immediateError: '😌 Suave 🤙' };
    const noNames = { nasa: 'Cê num é doido! 😤', immediateError: '🐔 Deixe de ser frango! 🧐' };
    const abstainNames = { nasa: 'Cês que sabe... ¯\\_(ツ)_/¯', immediateError: '🙄 Já que cê insiste... 🤷' };
    const featureName = vote.type === 'nasa' ? 'chamar a NASA' : (vote.requestedValue ? 'ativar o erro imediato' : 'desativar o erro imediato');
    title.textContent = vote.type === 'nasa' ? '🪐 Votação: chamar a NASA' : '🗳️ Votação: erro imediato';
    message.textContent = `${vote.proposerName || 'Um jogador'} quer ${featureName}. Vote aqui no canto; dá para continuar jogando enquanto decide.`;
    const votes = vote.votes;
    const eligibleIds = new Set(vote.eligiblePlayerIds);
    const onlineIds = Object.keys(state.multiplayer.players || {});
    if (state.multiplayer.playerId && eligibleIds.has(state.multiplayer.playerId) && !onlineIds.includes(state.multiplayer.playerId)) onlineIds.push(state.multiplayer.playerId);
    const onlineEligible = onlineIds.filter(id => eligibleIds.has(id)).length;
    const count = { yes: 0, no: 0, abstain: 0 };
    Object.entries(votes).forEach(([voterId, record]) => {
        if (!eligibleIds.has(voterId) || !record || typeof record !== 'object' || count[record.choice] === undefined) return;
        count[record.choice]++;
    });
    const totalEligible = Math.max(1, eligibleIds.size);
    const threshold = Math.floor(totalEligible / 2) + 1;
    status.textContent = `A favor: ${count.yes} · Contra: ${count.no} · Abstenções: ${count.abstain} · Elegíveis: ${totalEligible} (online agora: ${onlineEligible}). Aprovação exige maioria estrita: ${threshold} voto(s) a favor (mais de 50%).`;
    const mine = votes[state.multiplayer.playerId];
    actionButtons.classList.toggle('hidden', !!mine || !eligibleIds.has(state.multiplayer.playerId));
    const [yesBtn, noBtn, abstainBtn] = actionButtons.querySelectorAll('[data-feature-vote]');
    if (!yesBtn || !noBtn || !abstainBtn) return;
    yesBtn.textContent = yesNames[vote.type] || 'Aprovar';
    noBtn.textContent = noNames[vote.type] || 'Negar';
    abstainBtn.textContent = abstainNames[vote.type] || 'Abster-se';
    if (mine) status.textContent += ` Sua resposta: ${mine.choice === 'yes' ? 'a favor' : mine.choice === 'no' ? 'contra' : 'abstenção'}.`;
}

function onFeatureVoteChanged(rawVote) {
    if (!state.multiplayer.active) return;
    if (!rawVote) {
        state.multiplayer.currentFeatureVote = null;
        renderFeatureVoteCard(null);
        return;
    }
    const vote = normalizeFeatureVote(rawVote);
    if (!vote) {
        console.warn('Votação multiplayer com formato inválido; atualização descartada.');
        return;
    }
    state.multiplayer.currentFeatureVote = vote;
    renderFeatureVoteCard(vote);
    if (vote.status === 'pending') {
        evaluateFeatureVote(vote);
        const timeLeft = Number(vote.expiresAtTimestamp) - Date.now();
        if (Number.isFinite(timeLeft) && timeLeft > 0 && !((state.multiplayer.featureVoteTimeouts || {})[vote.voteId])) {
            if (!state.multiplayer.featureVoteTimeouts) state.multiplayer.featureVoteTimeouts = {};
            state.multiplayer.featureVoteTimeouts[vote.voteId] = setTimeout(() => {
                delete state.multiplayer.featureVoteTimeouts[vote.voteId];
                const current = state.multiplayer.currentFeatureVote;
                if (current && current.voteId === vote.voteId && current.status === 'pending') evaluateFeatureVote(current);
            }, Math.min(timeLeft + 50, 60000));
        }
        return;
    }

    if (vote.status === 'approved' || vote.status === 'rejected') {
        const handled = state.multiplayer.observedFeatureVoteIds || (state.multiplayer.observedFeatureVoteIds = {});
        if (!handled[vote.voteId]) {
            handled[vote.voteId] = true;
            if (vote.status === 'approved') showToast(vote.type === 'nasa' ? 'A sala aprovou chamar a NASA!' : `A sala aprovou ${vote.requestedValue ? 'ativar' : 'desativar'} o erro imediato.`, 'success');
            else showToast(vote.type === 'nasa' ? 'A sala decidiu seguir sem chamar a NASA desta vez.' : 'A alteração do erro imediato não atingiu votos suficientes.', 'info');
        }
        if (vote.status === 'approved') executeApprovedFeatureVote(vote);
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

function evaluateFeatureVote(rawVote) {
    const fb = getFirebaseAPI();
    const vote = normalizeFeatureVote(rawVote);
    if (!fb || !state.multiplayer.roomId || !vote || vote.status !== 'pending' || typeof fb.runTransaction !== 'function') return;
    const resolving = state.multiplayer.resolvingFeatureVoteIds || (state.multiplayer.resolvingFeatureVoteIds = {});
    if (resolving[vote.voteId]) return;
    resolving[vote.voteId] = true;
    const voteRef = fb.ref(fb.db, roomPath(state.multiplayer.roomId, 'featureVote'));
    fb.runTransaction(voteRef, current => {
        if (!current || typeof current !== 'object' || Array.isArray(current) || current.voteId !== vote.voteId || current.status !== 'pending') return;
        const eligibleIds = getFeatureVoteEligibleIds(current);
        const total = Math.max(1, eligibleIds.length);
        const threshold = Math.floor(total / 2) + 1;
        const votes = current.votes && typeof current.votes === 'object' && !Array.isArray(current.votes) ? current.votes : {};
        const yes = eligibleIds.filter(id => votes[id] && votes[id].choice === 'yes').length;
        const no = eligibleIds.filter(id => votes[id] && votes[id].choice === 'no').length;
        const allAnswered = eligibleIds.every(id => !!votes[id]);
        let nextStatus = null;
        if (yes >= threshold) nextStatus = 'approved';
        else if (allAnswered || (Number(current.expiresAtTimestamp) > 0 && Date.now() >= Number(current.expiresAtTimestamp))) nextStatus = 'rejected';
        if (!nextStatus) return;
        return { ...current, status: nextStatus, resolvedAtTimestamp: Date.now(), yesCount: yes, noCount: no, eligibleCount: total };
    }, false).catch(error => {
        console.error('Não foi possível concluir a votação:', error);
    }).finally(() => {
        delete resolving[vote.voteId];
    });
}

function executeApprovedFeatureVote(vote) {
    const fb = getFirebaseAPI();
    if (!fb || !state.multiplayer.roomId || vote.status !== 'approved' || typeof fb.runTransaction !== 'function') return;
    const currentPlayers = state.multiplayer.players && typeof state.multiplayer.players === 'object' ? state.multiplayer.players : {};
    const eligibleIds = getFeatureVoteEligibleIds(vote);
    const onlineEligible = eligibleIds.filter(id => !!currentPlayers[id]);
    if (state.multiplayer.playerId && eligibleIds.includes(state.multiplayer.playerId) && !onlineEligible.includes(state.multiplayer.playerId)) onlineEligible.push(state.multiplayer.playerId);
    const executor = onlineEligible.includes(vote.proposerId) ? vote.proposerId : onlineEligible.slice().sort()[0];
    if (!executor || executor !== state.multiplayer.playerId) return;
    const handled = state.multiplayer.executingFeatureVoteIds || (state.multiplayer.executingFeatureVoteIds = {});
    if (handled[vote.voteId]) return;
    handled[vote.voteId] = true;
    const voteRef = fb.ref(fb.db, roomPath(state.multiplayer.roomId, 'featureVote'));
    fb.runTransaction(voteRef, current => {
        if (!current || typeof current !== 'object' || Array.isArray(current) || current.voteId !== vote.voteId || current.status !== 'approved') return;
        if (current.executionClaimedBy === state.multiplayer.playerId) return;
        if (current.executionClaimedBy && onlineEligible.includes(current.executionClaimedBy)) return;
        return { ...current, executionClaimedBy: state.multiplayer.playerId, executionClaimedAtTimestamp: Date.now() };
    }, false).then(result => {
        if (!result || !result.committed) { delete handled[vote.voteId]; return; }
        if (vote.type === 'nasa') {
            giveNasaHint();
            return;
        }
        const settingsRef = fb.ref(fb.db, roomPath(state.multiplayer.roomId, 'settings'));
        return fb.update(settingsRef, {
            immediateErrorCheck: !!vote.requestedValue,
            immediateErrorUpdatedAt: Date.now(),
            immediateErrorUpdatedBy: vote.proposerId
        }).catch(error => {
            console.error('Não foi possível aplicar a configuração aprovada:', error);
            showToast('A votação foi aprovada, mas a configuração não pôde ser sincronizada.', 'warn');
        });
    }).catch(error => {
        delete handled[vote.voteId];
        console.error('Não foi possível reservar a execução da votação:', error);
    });
}

function requestFeatureVote(type, requestedValue = null) {
    const fb = getFirebaseAPI();
    if (!fb || !state.multiplayer.active || !state.multiplayer.roomId) return false;
    if (!['nasa', 'immediateError'].includes(type) || (type === 'immediateError' && typeof requestedValue !== 'boolean')) {
        showToast('Solicitação de votação inválida.', 'warn');
        return false;
    }
    if (state.multiplayer.featureVoteRequesting) return true;
    state.multiplayer.featureVoteRequesting = true;
    (async () => {
        try {
            const playersSnapshot = await fb.get(fb.ref(fb.db, roomPath(state.multiplayer.roomId, 'players')));
            const livePlayers = playersSnapshot && typeof playersSnapshot.val === 'function' ? playersSnapshot.val() : null;
            const onlineIds = livePlayers && typeof livePlayers === 'object' && !Array.isArray(livePlayers)
                ? Object.keys(livePlayers).filter(id => typeof id === 'string' && id.length > 0 && id.length <= 128).slice(0, 100)
                : Object.keys(state.multiplayer.players || {}).slice(0, 100);
            if (state.multiplayer.playerId && !onlineIds.includes(state.multiplayer.playerId)) onlineIds.push(state.multiplayer.playerId);
            const eligiblePlayerIds = Array.from(new Set(onlineIds)).sort();
            const voteId = createClientIdentifier('feature_');
            const now = Date.now();
            const vote = {
                voteId,
                type,
                requestedValue,
                proposerId: state.multiplayer.playerId,
                proposerName: String(state.multiplayer.playerName || 'Jogador').slice(0, 40),
                status: 'pending',
                votes: {},
                eligiblePlayerIds,
                createdAtTimestamp: now,
                expiresAtTimestamp: now + 60000
            };
            const ref = fb.ref(fb.db, roomPath(state.multiplayer.roomId, 'featureVote'));
            const result = await fb.runTransaction(ref, current => {
                if (current && typeof current === 'object' && current.status === 'pending') return;
                return vote;
            }, false);
            if (!result || !result.committed) {
                const snapshot = result && result.snapshot;
                const current = snapshot && typeof snapshot.val === 'function' ? normalizeFeatureVote(snapshot.val()) : null;
                if (current && current.status === 'pending') {
                    state.multiplayer.currentFeatureVote = current;
                    renderFeatureVoteCard(current);
                    showToast('Já existe uma votação ativa nesta sala. Responda à votação atual primeiro.', 'warn');
                } else {
                    showToast('Não foi possível abrir a votação. Tente novamente.', 'warn');
                }
                return;
            }
            state.multiplayer.currentFeatureVote = vote;
            renderFeatureVoteCard(vote);
        } catch (error) {
            console.error('Falha ao abrir votação da sala:', error);
            showToast('Não foi possível abrir a votação. Confira a conexão e as regras do Firebase.', 'warn');
        } finally {
            state.multiplayer.featureVoteRequesting = false;
        }
    })();
    return true;
}

function castFeatureVote(choice) {
    const fb = getFirebaseAPI();
    const vote = normalizeFeatureVote(state.multiplayer.currentFeatureVote);
    if (!fb || !vote || vote.status !== 'pending' || !state.multiplayer.roomId) return;
    if (!['yes', 'no', 'abstain'].includes(choice) || !vote.eligiblePlayerIds.includes(state.multiplayer.playerId)) return;
    if (vote.votes[state.multiplayer.playerId]) return;
    const voteRef = fb.ref(fb.db, roomPath(state.multiplayer.roomId, 'featureVote'));
    fb.runTransaction(voteRef, current => {
        if (!current || typeof current !== 'object' || Array.isArray(current) || current.voteId !== vote.voteId || current.status !== 'pending') return;
        const voters = current.votes && typeof current.votes === 'object' && !Array.isArray(current.votes) ? { ...current.votes } : {};
        if (voters[state.multiplayer.playerId]) return;
        const eligible = getFeatureVoteEligibleIds(current);
        if (!eligible.includes(state.multiplayer.playerId)) return;
        voters[state.multiplayer.playerId] = {
            choice,
            playerId: state.multiplayer.playerId,
            playerName: String(state.multiplayer.playerName || 'Jogador').slice(0, 40),
            timestamp: Date.now()
        };
        return { ...current, votes: voters };
    }, false).then(result => {
        if (!result || !result.committed) showToast('Seu voto não foi registrado; a votação pode ter terminado ou seu voto já existe.', 'warn');
    }).catch(error => {
        console.error(error);
        showToast('Não foi possível registrar seu voto.', 'warn');
    });
}
