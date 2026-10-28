'use strict';

/* ========================================================================
         FIREBASE MULTIPLAYER LOGIC
         ======================================================================== */
      
      function renderMultiplayerSidebar() {
          const listContainer = document.getElementById('mp-players-list');
          if (!listContainer) return;
          if (!state.multiplayer.active) {
              listContainer.innerHTML = '';
              return;
          }
          listContainer.innerHTML = '';
          const now = Date.now();
          ensureMultiplayerColor();
          const appendPlayer = (name, color, suffix = '') => {
              const row = document.createElement('div');
              row.className = 'flex items-center gap-2 px-2 py-1';
              const avatar = document.createElement('div');
              avatar.className = 'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-sm shrink-0';
              avatar.style.backgroundColor = color || '#64748b';
              avatar.title = name;
              avatar.textContent = String(name || '?').charAt(0).toUpperCase();
              const label = document.createElement('span');
              label.className = `text-[11px] ${suffix ? 'font-bold opacity-90' : 'font-semibold opacity-75'} truncate`;
              label.title = name;
              label.textContent = `${name}${suffix}`;
              row.appendChild(avatar);
              row.appendChild(label);
              listContainer.appendChild(row);
          };
          appendPlayer(state.multiplayer.playerName || 'Você', state.multiplayer.color, ' (Você)');
          const onlinePlayers = state.multiplayer.players && Object.keys(state.multiplayer.players).length
              ? state.multiplayer.players
              : state.multiplayer.peers || {};
          Object.entries(onlinePlayers).forEach(([playerId, player]) => {
              if (playerId === state.multiplayer.playerId) return;
              const peer = state.multiplayer.peers[playerId] || {};
              const name = player.playerName || peer.name || player.name || 'Jogador';
              const color = player.playerColor || peer.color || player.color || '#64748b';
              const lastSeen = peer.lastSeen || now;
              if (state.multiplayer.players && Object.keys(state.multiplayer.players).length || now - lastSeen < 120000) {
                  appendPlayer(name, color);
              }
          });
      }


      function renderProposalAcceptors(proposal) {
          const list = document.getElementById('vote-acceptors-list');
          const count = document.getElementById('vote-acceptance-count');
          if (!list) return;
          list.innerHTML = '';
          const voters = proposal && proposal.voters && typeof proposal.voters === 'object' ? proposal.voters : {};
          const requiredIds = Array.isArray(proposal && proposal.requiredPlayerIds) ? proposal.requiredPlayerIds : [];
          const eligibleOtherPlayers = requiredIds.filter(id => id !== proposal.proposerId);
          const acceptedCount = eligibleOtherPlayers.filter(id => !!voters[id]).length;
          Object.entries(voters).forEach(([playerId, voter]) => {
              if (!eligibleOtherPlayers.includes(playerId)) return;
              const avatar = document.createElement('div');
              avatar.className = 'w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-extrabold text-white shadow-sm border border-white/40';
              avatar.style.backgroundColor = voter.playerColor || voter.color || '#64748b';
              avatar.textContent = String(voter.playerName || voter.name || '?').charAt(0).toUpperCase();
              avatar.title = `${voter.playerName || voter.name || 'Jogador'} aceitou`;
              list.appendChild(avatar);
          });
          if (count) count.textContent = `${acceptedCount} de ${eligibleOtherPlayers.length} jogador(es) aceitaram`;
      }

      function showProposalWaitingState(proposal, isProposer) {
          document.getElementById('vote-proposer-name').textContent = isProposer ? 'Você' : (proposal.proposerName || 'Outro jogador');
          let N = Number(proposal.boardDimension) || 9;
          if (proposal.gameMode === 'custom') {
              N = buildSymbolsFromRange(Number(proposal.minimumSymbolValue), Number(proposal.maximumSymbolValue), !!proposal.includesZeroValue).length;
          }
          document.getElementById('vote-dim').textContent = `${N}x${N}`;
          document.getElementById('vote-diff').textContent = DIFFICULTY_LABELS[proposal.difficultyLevel] || proposal.difficultyLevel || 'Dificuldade atual';
          document.getElementById('vote-action-buttons').classList.add('hidden');
          document.getElementById('vote-wait-container').classList.remove('hidden');
          document.getElementById('btn-vote-cancel').classList.toggle('hidden', !isProposer);
          if (isProposer) renderProposalAcceptors(proposal);
          else {
              const list = document.getElementById('vote-acceptors-list');
              if (list) list.innerHTML = '';
              const count = document.getElementById('vote-acceptance-count');
              if (count) count.textContent = 'Sua resposta foi registrada.';
          }
          openModal('modal-vote-newgame');
      }

      function handleNewGameProposal(proposal) {
          if (!proposal || !state.multiplayer.active || proposal.proposerId === state.multiplayer.playerId) return;
          state.multiplayer.currentProposal = proposal;
          document.getElementById('vote-proposer-name').textContent = proposal.proposerName || 'Outro jogador';
          let N = Number(proposal.boardDimension) || 9;
          if (proposal.gameMode === 'custom') {
              N = buildSymbolsFromRange(Number(proposal.minimumSymbolValue), Number(proposal.maximumSymbolValue), !!proposal.includesZeroValue).length;
          }
          document.getElementById('vote-dim').textContent = `${N}x${N}`;
          document.getElementById('vote-diff').textContent = DIFFICULTY_LABELS[proposal.difficultyLevel] || proposal.difficultyLevel || 'Dificuldade atual';
          document.getElementById('vote-action-buttons').classList.remove('hidden');
          document.getElementById('btn-vote-reject').classList.remove('hidden');
          document.getElementById('btn-vote-accept').classList.remove('hidden');
          document.getElementById('vote-wait-container').classList.add('hidden');
          document.getElementById('btn-vote-cancel').classList.add('hidden');
          openModal('modal-vote-newgame');
      }
