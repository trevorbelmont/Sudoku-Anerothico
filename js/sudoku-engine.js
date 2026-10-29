'use strict';

      function normalizeSymbolMatrix(matrix, N, symbols) {
        if (!Array.isArray(matrix) || matrix.length !== N) return null;
        const normalized = [];
        for (let r = 0; r < N; r++) {
          if (!Array.isArray(matrix[r]) || matrix[r].length !== N) return null;
          const row = [];
          for (let c = 0; c < N; c++) {
            const raw = matrix[r][c];
            const value = raw == null || raw === '' ? '' : String(raw);
            if (value !== '' && !symbols.includes(value)) return null;
            row.push(value);
          }
          normalized.push(row);
        }
        return normalized;
      }

      function isValidMatrix(matrix, N, symbols) {
        return normalizeSymbolMatrix(matrix, N, symbols) !== null;
      }

      function isGridRuleValid(matrix, N, blockR, blockC, symbols, requireComplete = false) {
        if (!Number.isInteger(N) || N < 4 || N > 25 || !Number.isInteger(blockR) || !Number.isInteger(blockC) ||
            blockR < 1 || blockC < 1 || blockR * blockC !== N || N % blockR !== 0 || N % blockC !== 0 ||
            !Array.isArray(symbols) || symbols.length !== N || new Set(symbols).size !== N) return false;
        const normalized = normalizeSymbolMatrix(matrix, N, symbols);
        if (!normalized) return false;
        for (let r = 0; r < N; r++) {
          const rowSeen = new Set();
          const colSeen = new Set();
          for (let c = 0; c < N; c++) {
            const rv = normalized[r][c];
            const cv = normalized[c][r];
            if (requireComplete && (rv === '' || cv === '')) return false;
            if (rv !== '') { if (rowSeen.has(rv)) return false; rowSeen.add(rv); }
            if (cv !== '') { if (colSeen.has(cv)) return false; colSeen.add(cv); }
          }
        }
        for (let br = 0; br < N; br += blockR) {
          for (let bc = 0; bc < N; bc += blockC) {
            const seen = new Set();
            for (let r = br; r < br + blockR; r++) {
              for (let c = bc; c < bc + blockC; c++) {
                const value = normalized[r][c];
                if (value === '') { if (requireComplete) return false; continue; }
                if (seen.has(value)) return false;
                seen.add(value);
              }
            }
          }
        }
        return true;
      }

      function boardPreservesInitial(board, initial, N) {
        if (!Array.isArray(board) || !Array.isArray(initial) || board.length !== N || initial.length !== N) return false;
        for (let r = 0; r < N; r++) {
          if (!Array.isArray(board[r]) || !Array.isArray(initial[r]) || board[r].length !== N || initial[r].length !== N) return false;
          for (let c = 0; c < N; c++) {
            if (initial[r][c] !== '' && board[r][c] !== initial[r][c]) return false;
          }
        }
        return true;
      }

      function solutionMatchesInitial(solution, initial, N, blockR, blockC, symbols) {
        const normalizedSolution = normalizeSymbolMatrix(solution, N, symbols);
        if (!normalizedSolution || normalizedSolution.some(row => row.some(value => value === ''))) return false;
        if (!isGridRuleValid(normalizedSolution, N, blockR, blockC, symbols, true)) return false;
        return boardPreservesInitial(normalizedSolution, initial, N);
      }

      function validateGameState(data) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
        const rawN = data.dimension ?? data.N;
        const N = Number(rawN);
        if (!Number.isInteger(N) || N < 4 || N > 25) return null;
        const bR = Number(data.blockRow ?? data.bR ?? data.blockR);
        const bC = Number(data.blockCol ?? data.bC ?? data.blockC);
        if (!Number.isInteger(bR) || !Number.isInteger(bC) || bR < 1 || bC < 1 || bR * bC !== N || N % bR !== 0 || N % bC !== 0) return null;
        const symList = data.symbols ?? data.s;
        if (!Array.isArray(symList) || symList.length !== N) return null;
        const symbols = symList.map(value => value == null ? '' : String(value));
        if (symbols.some(symbol => !symbol || symbol.length > 32) || new Set(symbols).size !== N) return null;

        const rawInitial = data.initialGrid ?? data.initial ?? data.i;
        const initial = normalizeSymbolMatrix(rawInitial, N, symbols);
        if (!initial || !isGridRuleValid(initial, N, bR, bC, symbols, false)) return null;

        const rawSol = data.solutionGrid ?? data.solution ?? data.sol;
        const isManualCreating = data.isManualCreating === true;
        let sol = null;
        if (rawSol !== undefined && rawSol !== null) {
          sol = normalizeSymbolMatrix(rawSol, N, symbols);
          if (!sol) return null;
          if (!isManualCreating && (sol.some(row => row.some(value => value === '')) || !isGridRuleValid(sol, N, bR, bC, symbols, true) || !boardPreservesInitial(sol, initial, N))) return null;
        } else if (!isManualCreating) {
          sol = null;
        }
        const modeValue = data.mode ?? data.m ?? 'standard';
        const difficultyValue = data.difficulty ?? data.d ?? 'medio';
        const mode = typeof modeValue === 'string' && modeValue.length <= 32 ? modeValue : 'standard';
        const difficulty = typeof difficultyValue === 'string' && difficultyValue.length <= 32 ? difficultyValue : 'medio';
        return {
          N, bR, bC, symbols, initial, sol, mode, difficulty,
          instanceCount: Number.isSafeInteger(Number(data.instanceCount)) && Number(data.instanceCount) >= 0 ? Number(data.instanceCount) : 0,
          isManualCreating
        };
      }

      function buildSymbolsFromRange(minVal, maxVal, includeZero) {
        const rawMin = Number(minVal), rawMax = Number(maxVal);
        if (!Number.isSafeInteger(rawMin) || !Number.isSafeInteger(rawMax) ||
            Math.abs(rawMin) > 1000000 || Math.abs(rawMax) > 1000000 || Math.abs(rawMax - rawMin) > 25) return [];
        const lo = Math.min(rawMin, rawMax);
        const hi = Math.max(rawMin, rawMax);
        const arr = [];
        for (let v = lo; v <= hi; v++) {
          if (v === 0 && !includeZero) continue;
          arr.push(String(v));
        }
        return arr;
      }

      function computeBlockDimensions(N) {
        let bestR = 1, bestC = N;
        const root = Math.floor(Math.sqrt(N));
        for (let r = root; r >= 1; r--) {
          if (N % r === 0) { bestR = r; bestC = N / r; break; }
        }
        return { blockR: bestR, blockC: bestC };
      }

      function updateDifficultyCluesUI(targetN) {
        const N = targetN || (state.mode === 'standard' ? 9 : state.N) || 9;
        const totalCells = N * N;
        Object.keys(DIFFICULTY_REMOVAL_RATIOS).forEach((diffKey) => {
          const badgeEl = document.querySelector(`[data-diff-clues="${diffKey}"]`);
          if (!badgeEl) return;
          const clueRatio = 1 - DIFFICULTY_REMOVAL_RATIOS[diffKey];
          badgeEl.textContent = `~${Math.round(totalCells * clueRatio)} pistas (${Math.round(clueRatio * 100)}%)`;
        });
      }

      function updateCustomRangePreview() {
        const minIn = parseInt(document.getElementById('custom-min-input').value, 10);
        const maxIn = parseInt(document.getElementById('custom-max-input').value, 10);
        const incZero = document.getElementById('custom-include-zero').checked;
        const previewEl = document.getElementById('custom-calc-preview');
        if (isNaN(minIn) || isNaN(maxIn)) { previewEl.innerHTML = `<span class="text-red-500 font-bold">Digite valores inteiros válidos.</span>`; return null; }
        if (!Number.isSafeInteger(minIn) || !Number.isSafeInteger(maxIn) || Math.abs(minIn) > 1000000 || Math.abs(maxIn) > 1000000 || Math.abs(maxIn - minIn) > 25) {
          previewEl.textContent = 'Intervalo inválido. Use inteiros com diferença máxima de 25 e valores entre -1.000.000 e 1.000.000.';
          return null;
        }
        const symbols = buildSymbolsFromRange(minIn, maxIn, incZero);
        const N = symbols.length;
        if (N < 4 || N > 25) { previewEl.innerHTML = `<span class="text-amber-500 font-bold">Total atual: ${N} números.</span> Escolha entre 4 e 25.`; return null; }
        const { blockR, blockC } = computeBlockDimensions(N);
        previewEl.innerHTML = `<div class="flex flex-col gap-0.5"><div>Total: <strong>${N} números</strong> → Grade <strong>${N}×${N}</strong></div><div>Sub-blocos: <strong>${blockR}×${blockC}</strong></div></div>`;
        updateDifficultyCluesUI(N);
        return { minVal: Math.min(minIn, maxIn), maxVal: Math.max(minIn, maxIn), includeZero: incZero, symbols, N, blockR, blockC };
      }

      function shuffleArray(arr) {
        const copy = arr.slice();
        for (let i = copy.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
      }

      function generateCompleteValidGrid(N, blockR, blockC, symbols) {
        const numBlockBands = N / blockR;
        const numBlockStacks = N / blockC;
        const bandOrder = shuffleArray([...Array(numBlockBands).keys()]);
        const rowPerm = [];
        for (const b of bandOrder) { rowPerm.push(...shuffleArray([...Array(blockR).keys()].map(x => b * blockR + x))); }
        const stackOrder = shuffleArray([...Array(numBlockStacks).keys()]);
        const colPerm = [];
        for (const s of stackOrder) { colPerm.push(...shuffleArray([...Array(blockC).keys()].map(x => s * blockC + x))); }
        const shuffledSymbols = shuffleArray(symbols);
        const grid = Array.from({ length: N }, () => Array(N).fill(''));
        for (let r = 0; r < N; r++) {
          const rr = rowPerm[r];
          for (let c = 0; c < N; c++) {
            const cc = colPerm[c];
            grid[r][c] = shuffledSymbols[(rr * blockC + Math.floor(rr / blockR) + cc) % N];
          }
        }
        return grid;
      }

      function countSolutionsMRV(puzzleIdxGrid, N, blockR, blockC, limit = 2, maxNodes = 8000) {
        const rowMask = new Int32Array(N), colMask = new Int32Array(N), blkMask = new Int32Array(N);
        const numBlocksPerRow = N / blockC, emptyCells = [];
        const grid = puzzleIdxGrid.map(r => r.slice());
        for (let r = 0; r < N; r++) {
          for (let c = 0; c < N; c++) {
            const v = grid[r][c];
            if (v !== -1) {
              const b = Math.floor(r / blockR) * numBlocksPerRow + Math.floor(c / blockC);
              const bit = 1 << v;
              if ((rowMask[r] & bit) || (colMask[c] & bit) || (blkMask[b] & bit)) return 0;
              rowMask[r] |= bit; colMask[c] |= bit; blkMask[b] |= bit;
            } else {
              emptyCells.push({ r, c, b: Math.floor(r / blockR) * numBlocksPerRow + Math.floor(c / blockC) });
            }
          }
        }
        const fullMask = (N === 32) ? -1 : ((1 << N) - 1);
        let solutions = 0, nodes = 0;
        function popcount32(x) {
          x = x - ((x >>> 1) & 0x55555555); x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
          return (((x + (x >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24;
        }
        function backtrack(remainingCount) {
          if (remainingCount === 0) { solutions++; return; }
          if (++nodes > maxNodes) { solutions = limit; return; }
          let bestIdx = -1, bestCount = N + 1, bestAvailMask = 0;
          for (let i = 0; i < emptyCells.length; i++) {
            const cell = emptyCells[i];
            if (grid[cell.r][cell.c] !== -1) continue;
            const avail = (~(rowMask[cell.r] | colMask[cell.c] | blkMask[cell.b])) & fullMask;
            if (avail === 0) return;
            const cnt = popcount32(avail);
            if (cnt < bestCount) { bestCount = cnt; bestIdx = i; bestAvailMask = avail; if (cnt === 1) break; }
          }
          const target = emptyCells[bestIdx];
          let mask = bestAvailMask;
          while (mask !== 0) {
            const lowBit = mask & -mask;
            const v = Math.clz32(lowBit) ^ 31;
            mask &= ~lowBit;
            grid[target.r][target.c] = v; rowMask[target.r] |= lowBit; colMask[target.c] |= lowBit; blkMask[target.b] |= lowBit;
            backtrack(remainingCount - 1);
            if (solutions >= limit) return;
            grid[target.r][target.c] = -1; rowMask[target.r] &= ~lowBit; colMask[target.c] &= ~lowBit; blkMask[target.b] &= ~lowBit;
          }
        }
        backtrack(emptyCells.length);
        return solutions;
      }

      function solvePartialGrid(initialStrings, N, blockR, blockC, symbols) {
        const symToIdx = new Map(symbols.map((s, i) => [s, i]));
        const idxGrid = initialStrings.map(row => row.map(val => (val !== '' && symToIdx.has(val) ? symToIdx.get(val) : -1)));
        const rowMask = new Int32Array(N), colMask = new Int32Array(N), blkMask = new Int32Array(N);
        const numBlocksPerRow = N / blockC, emptyCells = [];
        for (let r = 0; r < N; r++) {
          for (let c = 0; c < N; c++) {
            const v = idxGrid[r][c];
            const b = Math.floor(r / blockR) * numBlocksPerRow + Math.floor(c / blockC);
            if (v !== -1) {
              const bit = 1 << v;
              if ((rowMask[r] & bit) || (colMask[c] & bit) || (blkMask[b] & bit)) return null;
              else { rowMask[r] |= bit; colMask[c] |= bit; blkMask[b] |= bit; }
            } else { emptyCells.push({ r, c, b }); }
          }
        }
        const fullMask = (1 << N) - 1;
        let steps = 0;
        function solve(rem) {
          if (rem === 0) return true;
          if (++steps > 60000) return false;
          let bestIdx = -1, bestCnt = N + 1, bestMask = 0;
          for (let i = 0; i < emptyCells.length; i++) {
            const cell = emptyCells[i];
            if (idxGrid[cell.r][cell.c] !== -1) continue;
            const avail = (~(rowMask[cell.r] | colMask[cell.c] | blkMask[cell.b])) & fullMask;
            if (avail === 0) return false;
            let m = avail, cnt = 0; while (m) { m &= m - 1; cnt++; }
            if (cnt < bestCnt) { bestCnt = cnt; bestIdx = i; bestMask = avail; if (cnt === 1) break; }
          }
          const cell = emptyCells[bestIdx];
          let m = bestMask;
          while (m) {
            const bit = m & -m; const v = Math.clz32(bit) ^ 31; m &= ~bit;
            idxGrid[cell.r][cell.c] = v; rowMask[cell.r] |= bit; colMask[cell.c] |= bit; blkMask[cell.b] |= bit;
            if (solve(rem - 1)) return true;
            idxGrid[cell.r][cell.c] = -1; rowMask[cell.r] &= ~bit; colMask[cell.c] &= ~bit; blkMask[cell.b] &= ~bit;
          }
          return false;
        }
        if (solve(emptyCells.length)) return idxGrid.map(row => row.map(v => symbols[v]));
        return null;
      }

      const SEEDS_17_CLUES = ['8...3..........4.7..2.8....4....3...5......2.....7...3.5..........2..61..6.......', '.......1.4.........2...........5.4.7..8...3....1.9....3..4..2...5.1........8.6...', '.......12........3..23..4....18....5.6..7.8.......9.....85.....9...4.5..47...6...', '.....6....59.....82....8....45........3........6..3.54...325..6..................', '....14....3....2...7..........9...3.6.1.............8.2.....1.4....5.6.....7.8...'];
      const SEEDS_UAISO_BASE = ['..3...81....9...42....61...6.....7..7.4.2.....39.5.......6.3....1..7.6..8......75', '..7......51.8...43..95....69...1...5....93.822................1.4..6..9..8....7..', '87.9..3......25...4..71....567......2.....9....15..2...8..4..1........6.7.....5.2'];

      function buildIsomorphic9x9FromSeed(seedStr, symbols, targetCluesCount) {
        const stdSymbols = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
        const rawInitial = Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => { const ch = seedStr[r * 9 + c]; return (ch >= '1' && ch <= '9') ? ch : ''; }));
        const rawSolution = solvePartialGrid(rawInitial, 9, 3, 3, stdSymbols);
        const bandOrder = shuffleArray([0, 1, 2]); const rowPerm = [];
        for (const b of bandOrder) rowPerm.push(...shuffleArray([b * 3, b * 3 + 1, b * 3 + 2]));
        const stackOrder = shuffleArray([0, 1, 2]); const colPerm = [];
        for (const s of stackOrder) colPerm.push(...shuffleArray([s * 3, s * 3 + 1, s * 3 + 2]));
        const permSymbols = shuffleArray(symbols); const transpose = Math.random() < 0.5;
        const solution = Array.from({ length: 9 }, () => Array(9).fill(''));
        const initial = Array.from({ length: 9 }, () => Array(9).fill(''));
        const emptyPositions = []; let currentClues = 0;
        for (let r = 0; r < 9; r++) {
          for (let c = 0; c < 9; c++) {
            const sr = transpose ? colPerm[c] : rowPerm[r], sc = transpose ? rowPerm[r] : colPerm[c];
            solution[r][c] = permSymbols[parseInt(rawSolution[sr][sc], 10) - 1];
            if (rawInitial[sr][sc] !== '') { initial[r][c] = permSymbols[parseInt(rawInitial[sr][sc], 10) - 1]; currentClues++; }
            else { emptyPositions.push([r, c]); }
          }
        }
        if (targetCluesCount && currentClues < targetCluesCount) {
          const shuffledEmpty = shuffleArray(emptyPositions); const needed = targetCluesCount - currentClues;
          for (let i = 0; i < needed && i < shuffledEmpty.length; i++) initial[shuffledEmpty[i][0]][shuffledEmpty[i][1]] = solution[shuffledEmpty[i][0]][shuffledEmpty[i][1]];
        }
        return { solution, initial };
      }

      function createUniqueSudokuPuzzle(N, blockR, blockC, symbols, difficulty) {
        if (N === 9 && blockR === 3 && blockC === 3 && (difficulty === 'doido' || difficulty === 'uaiso')) {
          if (difficulty === 'doido') return buildIsomorphic9x9FromSeed(SEEDS_17_CLUES[Math.floor(Math.random() * SEEDS_17_CLUES.length)], symbols, Math.random() < 0.8 ? 17 : 18);
          if (difficulty === 'uaiso') return buildIsomorphic9x9FromSeed([...SEEDS_UAISO_BASE, ...SEEDS_17_CLUES][Math.floor(Math.random() * 8)], symbols, 22 + Math.floor(Math.random() * 3));
        }
        const solution = generateCompleteValidGrid(N, blockR, blockC, symbols);
        const symToIdx = new Map(symbols.map((s, i) => [s, i]));
        const puzzleIdx = solution.map(row => row.map(s => symToIdx.get(s)));
        const totalCells = N * N, targetClues = Math.round(totalCells * (1 - (DIFFICULTY_REMOVAL_RATIOS[difficulty] || 0.50)));
        const allCoords = []; for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) allCoords.push([r, c]);
        const shuffledCoords = shuffleArray(allCoords);
        let removed = 0; const nodeBudget = N <= 9 ? 6500 : (N <= 16 ? 1200 : 400);
        for (const [r, c] of shuffledCoords) {
          if (removed >= (totalCells - targetClues)) break;
          const backup = puzzleIdx[r][c]; puzzleIdx[r][c] = -1;
          if (countSolutionsMRV(puzzleIdx, N, blockR, blockC, 2, nodeBudget) === 1) removed++; else puzzleIdx[r][c] = backup;
        }
        return { solution, initial: puzzleIdx.map(row => row.map(idx => (idx === -1 ? '' : symbols[idx]))) };
      }
