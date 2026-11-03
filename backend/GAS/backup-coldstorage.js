/**
 * SUDOKU ANERÓTHICO - BACKEND AS A SERVICE (L2 CACHE & BACKUP)
 * 
 * Este script opera como um cron job serverless via Google Apps Script.
 * Funcionalidades:
 * - Autenticação REST via token pré-compartilhado.
 * - Leitura dinâmica de regras de exclusão (.butignore) hospedadas no GitHub.
 * - Extração de dados do Firebase via REST API.
 * - Filtragem recursiva em memória de caminhos ignorados via Regex Pattern Matching.
 * - Armazenamento de snapshot em pasta específica do Google Drive (Cold Storage).
 * - Delegação de telemetria e auditoria para Google Sheets.
 */

const CONFIG = {
    BACKUP_PREFIX: 'sudoku_backup_',
    MIME_TYPE: MimeType.PLAIN_TEXT
  };
  
  // Ponto de verificação de integridade do Web App via navegador
  function doGet(e) {
    return ContentService.createTextOutput("Serviço L2 Cache e Backup Operacional.");
  }
  
  // Endpoint primário para execução de rotinas via requisições POST
  function doPost(e) {
    try {
      const props = PropertiesService.getScriptProperties();
      const expectedToken = props.getProperty('CRON_TOKEN');
      
      // Autenticação básica via token em parâmetro de URL ou Body
      if (!e.parameter.token || e.parameter.token !== expectedToken) {
        return ContentService.createTextOutput(JSON.stringify({ error: "Unauthorized" }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      
      // Roteamento da ação solicitada
      if (e.parameter.action === 'backup') {
        const result = executeFirebaseBackup();
        return ContentService.createTextOutput(JSON.stringify(result))
          .setMimeType(ContentService.MimeType.JSON);
      }
  
      return ContentService.createTextOutput(JSON.stringify({ error: "Invalid action" }))
        .setMimeType(ContentService.MimeType.JSON);
        
    } catch (error) {
      return ContentService.createTextOutput(JSON.stringify({ error: error.message }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }
  
  // Fluxo principal de extração, filtragem in-memory e persistência no Drive
  function executeFirebaseBackup() {
    const props = PropertiesService.getScriptProperties();
    const dbUrl = props.getProperty('FIREBASE_URL');
    const secret = props.getProperty('FIREBASE_SECRET');
    const githubRawUrl = props.getProperty('GITHUB_BUTIGNORE_URL');
    const sheetId = props.getProperty('LOG_SHEET_ID');
    const folderId = props.getProperty('DRIVE_FOLDER_ID');
    
    if (!dbUrl || !secret || !githubRawUrl || !sheetId || !folderId) {
      throw new Error("Configurações de ambiente incompletas nas Propriedades do Script.");
    }
  
    let metrics = {
      bytesDownloaded: 0,
      bytesSaved: 0,
      nodesIgnored: 0,
      status: 'failed',
      error: null,
      filename: null
    };
  
    try {
      // Obtenção do payload de regras de exclusão dinâmicas via request ao GitHub
      const rules = fetchIgnoreRules(githubRawUrl);
      
      // Extração integral do banco de dados Firebase
      const dbResponse = UrlFetchApp.fetch(`${dbUrl}/.json?auth=${secret}`);
      const rawData = dbResponse.getContentText();
      metrics.bytesDownloaded = rawData.length;
      
      let firebaseData = JSON.parse(rawData);
      if (!firebaseData) {
        metrics.status = 'skipped';
        metrics.error = 'Banco de dados vazio.';
        logMetrics(sheetId, metrics);
        return metrics;
      }
  
      // Aplicação do filtro de nós mutando o objeto JSON em memória
      metrics.nodesIgnored = filterObjectByPaths(firebaseData, '', rules);
  
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${CONFIG.BACKUP_PREFIX}${timestamp}.json`;
      const finalContent = JSON.stringify(firebaseData);
      
      // Alocação e persistência do blob na pasta definida do Google Drive
      const folder = DriveApp.getFolderById(folderId);
      folder.createFile(filename, finalContent, CONFIG.MIME_TYPE);
      
      metrics.bytesSaved = finalContent.length;
      metrics.status = 'success';
      metrics.filename = filename;
      
      logMetrics(sheetId, metrics);
      return metrics;
      
    } catch (err) {
      metrics.error = err.message;
      logMetrics(sheetId, metrics);
      throw err;
    }
  }
  
  // Compila o arquivo plain-text .butignore em arrays de Expressões Regulares
  function fetchIgnoreRules(url) {
    try {
      const response = UrlFetchApp.fetch(url);
      const text = response.getContentText();
      return text.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#'))
        .map(rule => {
          // Converte curingas de diretório (*) para grupos de captura regex delimitados ([^/]+)
          const regexStr = '^' + rule.replace(/\*/g, '[^/]+') + '$';
          return new RegExp(regexStr);
        });
    } catch (err) {
      console.error("Falha de I/O ao recuperar .butignore. Executando fallback de backup integral.", err);
      return [];
    }
  }
  
  // Algoritmo DFS (Depth-First Search) para travessia e deleção de chaves aninhadas
  function filterObjectByPaths(obj, currentPath, rules) {
    let ignoredCount = 0;
    
    if (typeof obj !== 'object' || obj === null) return 0;
    
    for (const key in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
      
      const nodePath = currentPath ? `${currentPath}/${key}` : key;
      
      // Validação da chave atual contra as expressões regulares
      const shouldIgnore = rules.some(regex => regex.test(nodePath));
      
      if (shouldIgnore) {
        delete obj[key];
        ignoredCount++;
      } else {
        ignoredCount += filterObjectByPaths(obj[key], nodePath, rules);
      }
    }
    
    return ignoredCount;
  }
  
  // Inserção de log via append na tabela de telemetria do Google Sheets
  function logMetrics(sheetId, metrics) {
    try {
      const sheet = SpreadsheetApp.openById(sheetId).getSheets()[0];
      const timestamp = new Date().toISOString();
      
      sheet.appendRow([
        timestamp,
        metrics.status,
        metrics.bytesDownloaded,
        metrics.bytesSaved,
        metrics.nodesIgnored,
        metrics.filename || 'N/A',
        metrics.error || 'N/A'
      ]);
    } catch (err) {
      console.error("Falha de RPC ao registrar telemetria no Sheets.", err);
    }
  }