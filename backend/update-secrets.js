/**
 * backend/update-secrets.js
 *
 * Lê as variáveis do arquivo .environment na raiz do repositório,
 * gera o .clasp.json a partir do GAS_SCRIPT_ID se necessário,
 * e injeta as Script Properties no projeto GAS via Clasp.
 *
 * PRÉ-REQUISITOS:
 *   1. npm install -g @google/clasp
 *   2. Ativar a Google Apps Script API em:
 *      https://script.google.com/home/usersettings
 *   3. clasp login  (autenticar sua conta Google no terminal)
 *   4. Preencher .environment na raiz (copiar de .environment.example)
 *
 * USO (a partir da raiz do repositório):
 *   node backend/update-secrets.js
 *
 * O script faz automaticamente:
 *   1. Lê e valida o .environment.
 *   2. Gera backend/GAS/.clasp.json a partir de GAS_SCRIPT_ID,
 *      se o arquivo não existir ou estiver com placeholder/inválido.
 *   3. Gera um arquivo GAS temporário (.temp-secrets.js).
 *   4. clasp push → clasp run → cleanup (local + nuvem).
 *
 * SEGURANÇA:
 *   - .environment e .clasp.json estão no .gitignore — nunca saem da máquina.
 *   - O arquivo temporário é apagado no finally, mesmo em falha.
 *   - Nenhum valor de secret aparece nos logs (apenas os nomes das chaves).
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── Caminhos ──────────────────────────────────────────────────────────────────
const backendDir = __dirname;
const rootDir    = path.join(backendDir, '..');
const gasDir     = path.join(backendDir, 'GAS');
const envPath    = path.join(rootDir, '.environment');
const claspPath  = path.join(gasDir, '.clasp.json');
const tempFile   = path.join(gasDir, '.temp-secrets.js');

console.log('🚀 Iniciando sincronização de Secrets para o Google Apps Script...\n');

// ── 1. Verificar .environment ─────────────────────────────────────────────────
if (!fs.existsSync(envPath)) {
  console.error('❌ Arquivo .environment não encontrado em:', envPath);
  console.error('   Copie .environment.example para .environment e preencha os valores.');
  process.exit(1);
}

// ── 2. Parser do .environment ─────────────────────────────────────────────────
const envText = fs.readFileSync(envPath, 'utf8');
const env = {};

envText.split('\n').forEach(line => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return;
  if (!trimmed.includes('=')) return;
  const eqIdx = trimmed.indexOf('=');
  const key   = trimmed.slice(0, eqIdx).trim();
  const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
  if (key) env[key] = value;
});

// Valida obrigatórias (incluindo GAS_SCRIPT_ID)
const required = [
  'GAS_SCRIPT_ID',
  'CRON_TOKEN', 'FIREBASE_URL', 'FIREBASE_SECRET',
  'GITHUB_JOBS_CONFIG_URL', 'GITHUB_BUTIGNORE_URL', 'DRIVE_FOLDER_ID'
];
const empty = required.filter(k => !env[k]);
if (empty.length > 0) {
  console.error('❌ Variáveis obrigatórias vazias:', empty.join(', '));
  console.error('   Preencha-as no .environment antes de continuar.');
  process.exit(1);
}

// Separa GAS_SCRIPT_ID das demais (ele não vai como Script Property do GAS)
const { GAS_SCRIPT_ID, ...secrets } = env;
const secretKeys = Object.keys(secrets);
console.log('📋 Script Properties a injetar:', secretKeys.join(', '));

// ── 3. Gerar/validar .clasp.json ──────────────────────────────────────────────
let claspGenerated = false;
const needsGeneration = (() => {
  if (!fs.existsSync(claspPath)) return true;
  try {
    const existing = JSON.parse(fs.readFileSync(claspPath, 'utf8'));
    // Considera inválido se o scriptId está ausente, vazio ou ainda é placeholder
    if (!existing.scriptId || existing.scriptId === 'SEU_GAS_SCRIPT_ID_AQUI') return true;
    if (existing.scriptId !== GAS_SCRIPT_ID) {
      console.warn('⚠️  .clasp.json existente tem um scriptId diferente do GAS_SCRIPT_ID no .environment.');
      console.warn('   Sobrescrevendo com o valor do .environment...');
      return true;
    }
    return false;
  } catch (_) {
    return true; // JSON inválido → regenerar
  }
})();

if (needsGeneration) {
  const claspContent = {
    scriptId: GAS_SCRIPT_ID,
    rootDir: 'backend\\GAS',
    scriptExtensions: ['.js', '.gs'],
    htmlExtensions: ['.html'],
    jsonExtensions: ['.json'],
    filePushOrder: [],
    skipSubdirectories: false
  };
  fs.writeFileSync(claspPath, JSON.stringify(claspContent, null, 2), 'utf8');
  claspGenerated = true;
  console.log('🔧 .clasp.json gerado em:', claspPath);
} else {
  console.log('✅ .clasp.json já existe e está válido.');
}
console.log();

// ── 4. Gerar arquivo GAS temporário ──────────────────────────────────────────
const gasFunction = `/** ARQUIVO TEMPORÁRIO GERADO AUTOMATICAMENTE — NÃO EDITE NEM COMITE */
function setupOrchestratorSecrets() {
  var props = PropertiesService.getScriptProperties();
  props.setProperties(${JSON.stringify(secrets, null, 2)});
  Logger.log("Propriedades atualizadas: ${secretKeys.join(', ')}");
}
`;

fs.writeFileSync(tempFile, gasFunction, 'utf8');
console.log('📝 Arquivo temporário gerado:', tempFile);

// ── 5. Push + Run + Cleanup ───────────────────────────────────────────────────
let pushOk = false;
try {
  console.log('\n☁️  Enviando arquivo temporário (clasp push)...');
  execSync('clasp push -f', { cwd: gasDir, stdio: 'inherit' });
  pushOk = true;

  console.log('\n⚙️  Executando setup remotamente (clasp run)...');
  execSync('clasp run setupOrchestratorSecrets', { cwd: gasDir, stdio: 'inherit' });

  console.log('\n✅ Secrets injetados com sucesso no cofre do projeto GAS!');

} catch (err) {
  console.error('\n❌ Falha ao comunicar com o Clasp:', err.message);
  console.error('   Verifique: clasp login, Google Apps Script API ativa,');
  console.error('   e se o GAS_SCRIPT_ID no .environment está correto.');
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
