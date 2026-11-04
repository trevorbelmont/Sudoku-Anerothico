/**
 * backend/update-secrets.js
 *
 * Script interativo e resiliente para sincronizar secrets do projeto
 * Sudoku Aneróthico PRÓ com o Google Apps Script via Clasp.
 *
 * PRÉ-REQUISITOS:
 *   1. npm install -g @google/clasp
 *   2. Ativar a Google Apps Script API em:
 *      https://script.google.com/home/usersettings
 *   3. clasp login  (autenticar sua conta Google no terminal)
 *   4. Preencher .environment na raiz (ou deixar o script criá-lo e
 *      guiar o preenchimento interativamente)
 *
 * USO (a partir da raiz do repositório):
 *   node backend/update-secrets.js
 *   ou
 *   npm run secrets:update
 *
 * O script faz automaticamente:
 *   1. Localiza ou cria /.environment na raiz do repositório.
 *   2. Se secrets obrigatórias estiverem vazias ou ausentes, abre um prompt
 *      interativo no terminal (suporta copy/paste) e salva os valores de
 *      volta no arquivo (merge seguro — preserva comentários e variáveis
 *      já preenchidas).
 *   3. Gera/valida backend/GAS/.clasp.json com rootDir "." a partir do
 *      SCRIPT_ID informado.
 *   4. Gera um arquivo GAS temporário (.temp-secrets.js) com a função
 *      setupOrchestratorSecrets() contendo o payload JSON das propriedades.
 *   5. clasp push -f  →  clasp run setupOrchestratorSecrets  →  cleanup.
 *   6. No bloco finally, garante a exclusão do temporário localmente e
 *      na nuvem via um clasp push de limpeza.
 *
 * CHAVES TRATADAS:
 *   Obrigatórias:
 *     SCRIPT_ID, CRON_TOKEN, FIREBASE_URL, FIREBASE_SECRET,
 *     GITHUB_JOBS_CONFIG_URL, GITHUB_BUTIGNORE_URL, DRIVE_FOLDER_ID
 *   Especiais/Opcionais:
 *     LOG_SHEET_ID        — obrigatória na lógica do GAS; aceita "NULL"
 *                           como valor válido para auto-provisionamento.
 *     LOG_SHEET_FOLDER_ID — opcional; pode ser vazia ou omitida.
 *
 * SEGURANÇA:
 *   - .environment e backend/GAS/.clasp.json estão no .gitignore — nunca
 *     saem da máquina.
 *   - O arquivo temporário é apagado no finally, mesmo em falha.
 *   - Nenhum valor de secret aparece nos logs (apenas os nomes das chaves).
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');

// ── Caminhos (resolvidos dinamicamente via path do Node.js) ───────────────────
const backendDir   = __dirname;
const rootDir      = path.join(backendDir, '..');
const gasDir       = path.join(backendDir, 'GAS');
const envPath      = path.join(rootDir, '.environment');
const envExample   = path.join(rootDir, '.environment.example');
const claspPath    = path.join(gasDir, '.clasp.json');
const tempFile     = path.join(gasDir, '.temp-secrets.js');

// ── Definição das chaves tratadas pelo script ─────────────────────────────────
/** Chaves obrigatórias — não podem ficar vazias ou ausentes. */
const REQUIRED_KEYS = [
  'SCRIPT_ID',
  'CRON_TOKEN',
  'FIREBASE_URL',
  'FIREBASE_SECRET',
  'GITHUB_JOBS_CONFIG_URL',
  'GITHUB_BUTIGNORE_URL',
  'DRIVE_FOLDER_ID',
];

/**
 * LOG_SHEET_ID — obrigatória na lógica do GAS, mas aceita "NULL" como
 * valor válido para auto-provisionamento da planilha de telemetria.
 */
const LOG_SHEET_ID_KEY = 'LOG_SHEET_ID';

/**
 * LOG_SHEET_FOLDER_ID — opcional; pode ser vazia ou omitida.
 * Não dispara prompt interativo.
 */
const LOG_SHEET_FOLDER_ID_KEY = 'LOG_SHEET_FOLDER_ID';

// ── Parser do .environment ────────────────────────────────────────────────────
/**
 * Converte o texto do arquivo .environment em um objeto chave-valor.
 * Ignora linhas de comentário (#) e linhas sem "=".
 * Remove aspas envolventes do valor (se houver).
 *
 * @param {string} text — conteúdo do arquivo .environment
 * @returns {Object} — mapa { CHAVE: valor }
 */
function parseEnvFile(text) {
  const env = {};
  text.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    if (!trimmed.includes('=')) return;
    const eqIdx = trimmed.indexOf('=');
    const key   = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (key) env[key] = value;
  });
  return env;
}

// ── Serialização com merge seguro ─────────────────────────────────────────────
/**
 * Faz merge dos valores atualizados no texto existente do .environment,
 * preservando comentários e variáveis já preenchidas.
 *
 * Estratégia:
 *   - Percorre cada linha do arquivo original.
 *   - Se a linha contém KEY=valor e KEY está em updates, substitui o valor.
 *   - Chaves em updates que não existem no arquivo são anexadas ao final.
 *
 * @param {string} existingText — conteúdo atual do arquivo
 * @param {Object} updates — { CHAVE: novoValor } a mesclar
 * @returns {string} — novo conteúdo do arquivo
 */
function mergeEnvFile(existingText, updates) {
  // Arquivo vazio: escreve apenas as chaves atualizadas
  if (!existingText || existingText.trim() === '') {
    return Object.entries(updates)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n') + '\n';
  }

  const lines = existingText.split('\n');
  const updatedKeys = new Set();

  const newLines = lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) return line;
    const eqIdx = trimmed.indexOf('=');
    const key   = trimmed.slice(0, eqIdx).trim();
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      updatedKeys.add(key);
      return `${key}=${updates[key]}`;
    }
    return line;
  });

  // Anexa chaves que não estavam presentes no arquivo original
  for (const [key, value] of Object.entries(updates)) {
    if (!updatedKeys.has(key)) {
      newLines.push(`${key}=${value}`);
    }
  }

  const result = newLines.join('\n');
  // Garante terminação com newline
  return result.endsWith('\n') ? result : result + '\n';
}

// ── Verificação de chaves vazias ou ausentes ──────────────────────────────────
/**
 * Retorna true se a chave está vazia ou ausente no mapa env.
 * @param {Object} env — mapa de variáveis
 * @param {string} key — nome da chave
 * @returns {boolean}
 */
function isMissing(env, key) {
  const val = env[key];
  return !val || val.trim() === '';
}

// ── Prompt interativo via readline ─────────────────────────────────────────────
/**
 * Cria uma interface readline para entrada do terminal.
 * Suporta copy/paste nativamente (o terminal do SO cuida disso).
 */
function createReadlineInterface() {
  return readline.createInterface({
    input:  process.stdin,
    output: process.stdout,
  });
}

/**
 * Wrapper de Promise para rl.question().
 * @param {readline.Interface} rl
 * @param {string} prompt — texto exibido antes da entrada
 * @returns {Promise<string>} — resposta do usuário
 */
function ask(rl, prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(answer));
  });
}

/**
 * Abre um prompt interativo no terminal para preencher as secrets
 * obrigatórias que estiverem vazias ou ausentes.
 *
 * Regras:
 *   - Apenas avança para a próxima pergunta após receber uma resposta
 *     não vazia.
 *   - LOG_SHEET_ID aceita "NULL" (case-insensitive) como valor válido
 *     para auto-provisionamento.
 *
 * @param {Object} env — mapa de variáveis (modificado in-place)
 * @returns {Promise<Object>} — { CHAVE: valor } das chaves preenchidas
 */
async function promptMissingSecrets(env) {
  // Coleta todas as chaves obrigatórias que estão vazias ou ausentes
  const missing = REQUIRED_KEYS.filter(k => isMissing(env, k));

  // LOG_SHEET_ID: obrigatória na lógica do GAS, aceita "NULL"
  if (isMissing(env, LOG_SHEET_ID_KEY)) {
    missing.push(LOG_SHEET_ID_KEY);
  }

  if (missing.length === 0) return {};

  const rl = createReadlineInterface();

  console.log('\n⚠️  As seguintes secrets obrigatórias estão faltando.');
  console.log('   Preencha-as abaixo (suporta copy/paste) ou pressione Ctrl+C para cancelar:\n');

  const updates = {};

  for (const key of missing) {
    const isLogSheet = (key === LOG_SHEET_ID_KEY);

    while (true) {
      const answer = (await ask(rl, `${key} [OBRIGATÓRIA]: `)).trim();

      if (answer) {
        let value = answer;

        // LOG_SHEET_ID aceita "NULL" (case-insensitive) para auto-provisionamento
        if (isLogSheet && answer.toUpperCase() === 'NULL') {
          value = 'NULL';
        }

        env[key] = value;
        updates[key] = value;
        break;
      }

      console.log('   ⚠️  Valor não pode ser vazio. Tente novamente.');
    }
  }

  rl.close();
  return updates;
}

// ── Função principal ──────────────────────────────────────────────────────────
async function main() {
  console.log('🚀 Iniciando sincronização de Secrets para o Google Apps Script...\n');

  // ── 1. Verificar/criar .environment ──────────────────────────────────────────
  if (!fs.existsSync(envPath)) {
    console.log('📝 Arquivo .environment não encontrado. Criando...');

    if (fs.existsSync(envExample)) {
      // Usa .environment.example como base, limpando os valores de exemplo
      let exampleText = fs.readFileSync(envExample, 'utf8');
      exampleText = exampleText.replace(/^([A-Z_]+)=.+$/gm, '$1=');
      fs.writeFileSync(envPath, exampleText, 'utf8');
    } else {
      fs.writeFileSync(envPath, '', 'utf8');
    }

    console.log('✅ Arquivo .environment criado.\n');
  }

  // ── 2. Ler e parsear .environment ────────────────────────────────────────────
  const envText = fs.readFileSync(envPath, 'utf8');
  const env = parseEnvFile(envText);

  // ── 3. Prompt interativo para secrets faltantes ──────────────────────────────
  const updates = await promptMissingSecrets(env);

  // ── 4. Salvar valores de volta no .environment (merge seguro) ─────────────────
  if (Object.keys(updates).length > 0) {
    const merged = mergeEnvFile(envText, updates);
    fs.writeFileSync(envPath, merged, 'utf8');
    console.log('\n💾 Valores salvos no arquivo .environment.');
  }

  // ── 5. Validação final — todas as obrigatórias devem estar preenchidas ────────
  const stillMissing = REQUIRED_KEYS.filter(k => isMissing(env, k));
  if (isMissing(env, LOG_SHEET_ID_KEY)) {
    stillMissing.push(LOG_SHEET_ID_KEY);
  }
  if (stillMissing.length > 0) {
    console.error('\n❌ As seguintes secrets ainda estão vazias:', stillMissing.join(', '));
    console.error('   Preencha-as no .environment e tente novamente.');
    process.exit(1);
  }

  // ── 6. Separar SCRIPT_ID das demais (não vai como Script Property) ────────────
  const { SCRIPT_ID, ...allSecrets } = env;

  // Filtra apenas as chaves que têm valor (LOG_SHEET_FOLDER_ID pode estar vazia)
  const secrets = {};
  for (const [k, v] of Object.entries(allSecrets)) {
    if (v && v.trim() !== '') {
      secrets[k] = v;
    }
  }

  const secretKeys = Object.keys(secrets);
  console.log('\n📋 Script Properties a injetar:', secretKeys.join(', '));

  // ── 7. Gerar/validar backend/GAS/.clasp.json com rootDir "." ──────────────────
  const needsGeneration = (() => {
    if (!fs.existsSync(claspPath)) return true;
    try {
      const existing = JSON.parse(fs.readFileSync(claspPath, 'utf8'));
      // Considera inválido se o scriptId está ausente, vazio ou ainda é placeholder
      if (!existing.scriptId || existing.scriptId === 'SEU_SCRIPT_ID_DO_GAS_AQUI') return true;
      if (existing.scriptId !== SCRIPT_ID) {
        console.warn('⚠️  .clasp.json existente tem um scriptId diferente do SCRIPT_ID no .environment.');
        console.warn('   Sobrescrevendo com o valor do .environment...');
        return true;
      }
      // Garante que rootDir seja "." (caminho relativo ao próprio backend/GAS/)
      if (existing.rootDir !== '.') {
        console.warn('⚠️  .clasp.json existente tem rootDir diferente de ".". Corrigindo...');
        return true;
      }
      return false;
    } catch (_) {
      return true; // JSON inválido → regenerar
    }
  })();

  if (needsGeneration) {
    const claspContent = {
      scriptId: SCRIPT_ID,
      rootDir: '.',
    };
    fs.writeFileSync(claspPath, JSON.stringify(claspContent, null, 2), 'utf8');
    console.log('🔧 .clasp.json gerado em:', claspPath);
  } else {
    console.log('✅ .clasp.json já existe e está válido.');
  }
  console.log();

  // ── 8. Gerar arquivo GAS temporário ──────────────────────────────────────────
  const gasFunction = `/** ARQUIVO TEMPORÁRIO GERADO AUTOMATICAMENTE — NÃO EDITE NEM COMITE */
function setupOrchestratorSecrets() {
  var props = PropertiesService.getScriptProperties();
  props.setProperties(${JSON.stringify(secrets, null, 2)});
  Logger.log("Propriedades atualizadas: ${secretKeys.join(', ')}");
}
`;

  fs.writeFileSync(tempFile, gasFunction, 'utf8');
  console.log('📝 Arquivo temporário gerado:', tempFile);

  // ── 9. Push + Run + Cleanup ───────────────────────────────────────────────────
  let pushOk = false;
  try {
    console.log('\n☁️  Enviando arquivo temporário (clasp push)...');
    execSync('clasp push -f', { cwd: gasDir, stdio: 'inherit' });
    pushOk = true;

    // Pequena pausa para permitir a propagação do push no servidor do Apps Script
    // antes de tentar executar a função remotamente. Reduz NOT_FOUND transitórios.
    console.log('   Aguardando propagação (3s)...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log('\n⚙️  Executando setup remotamente (clasp run)...');

    // clasp run pode sair com exit code 0 mesmo quando a função remota
    // lança uma exceção (o erro é exibido no stdout/stderr mas não altera o
    // código de saída). Capturamos a saída para inspecionar.
    let runOutput = '';
    let runExitCode = 0;
    try {
      runOutput = execSync('clasp run setupOrchestratorSecrets', {
        cwd: gasDir,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 60000,
      });
    } catch (runErr) {
      // Se execSync lançar, capturamos stdout/stderr e o código de saída.
      runOutput = (runErr.stdout || '').toString() + (runErr.stderr || '').toString();
      runExitCode = runErr.status || 1;
    }

    // Exibe a saída capturada para o usuário (mantém visibilidade).
    if (runOutput.trim()) {
      console.log(runOutput.trim());
    }

    // Detecta falhas mesmo quando clasp sai com exit code 0.
    // Padrões de erro do Apps Script Execution API.
    const errorPatterns = [
      /Exception:/i,
      /Error code\s+\w+/i,
      /NOT_FOUND/i,
      /PERMISSION_DENIED/i,
      /FAILED_PRECONDITION/i,
    ];
    const runFailed = runExitCode !== 0 || errorPatterns.some(p => p.test(runOutput));

    if (runFailed) {
      console.error('\n❌ A execução remota de setupOrchestratorSecrets falhou.');
      console.error('   O clasp run não injetou as secrets no projeto GAS.');
      console.error('');
      console.error('   Possíveis causas:');
      console.error('   • A Google Apps Script API não está ativada.');
      console.error('     Ative em: https://script.google.com/home/usersettings');
      console.error('   • Propagação lenta após o push — aguarde ~10s e reexecute.');
      console.error('   • O SCRIPT_ID no .environment não corresponde ao projeto GAS.');
      console.error('   • A conta Google não tem permissão de execução no projeto.');
      // Força a entrada no bloco catch para acionar o cleanup do finally.
      throw new Error('clasp run setupOrchestratorSecrets falhou remotamente.');
    }

    console.log('\n✅ Secrets injetados com sucesso no cofre do projeto GAS!');

  } catch (err) {
    console.error('\n❌ Falha ao comunicar com o Clasp:', err.message);
    console.error('   Verifique: clasp login, Google Apps Script API ativa,');
    console.error('   e se o SCRIPT_ID no .environment está correto.');
  } finally {
    // Sempre apagar o temporário local
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
      console.log('\n🧹 Arquivo temporário local apagado.');

      if (pushOk) {
        try {
          console.log('☁️  Limpando código temporário na nuvem (clasp push final)...');
          execSync('clasp push -f', { cwd: gasDir, stdio: 'inherit' });
          console.log('✅ Nuvem limpa.');
        } catch (_) {
          console.warn('⚠️  Não foi possível limpar a nuvem automaticamente.');
          console.warn('   Delete setupOrchestratorSecrets no editor GAS e faça clasp push.');
        }
      }
    }
  }
}

// ── Ponto de entrada ──────────────────────────────────────────────────────────
main().catch(err => {
  console.error('\n❌ Erro inesperado:', err.message);
  process.exit(1);
});
