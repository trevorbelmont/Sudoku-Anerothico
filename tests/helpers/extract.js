/**
 * helpers/extract.js
 *
 * Extrai funções puras do fonte original sem executar o módulo inteiro.
 * Como os arquivos JS da aplicação não usam import/export (são scripts globais),
 * usamos regex para extrair funções nomeadas específicas e avaliamos em um
 * contexto controlado, injetando apenas as dependências necessárias.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const JS_DIR = path.resolve(__dirname, '../../js');

/**
 * Lê o conteúdo de um arquivo JS do diretório /js.
 */
function readJS(filename) {
  return fs.readFileSync(path.join(JS_DIR, filename), 'utf8');
}

/**
 * Extrai o corpo de uma função nomeada pelo nome.
 * Suporta: function foo(...) { ... } e const/let/var foo = function / arrow
 *
 * @param {string} source - conteúdo JS
 * @param {string} name   - nome da função
 * @returns {string} fragmento de código que declara a função
 */
function extractFunction(source, name) {
  // Tenta function declaration
  const declPattern = new RegExp(
    `(function\\s+${name}\\s*\\([^)]*\\)\\s*\\{)`,
    'm'
  );
  const declMatch = source.match(declPattern);
  if (declMatch) {
    const startIdx = source.indexOf(declMatch[0]);
    return extractBlock(source, startIdx + declMatch[0].length - 1);
  }

  // Tenta const/let/var name = function / arrow
  const assignPattern = new RegExp(
    `(?:const|let|var)\\s+${name}\\s*=\\s*(?:function\\s*\\([^)]*\\)|\\([^)]*\\)\\s*=>|[a-zA-Z_$][\\w$]*\\s*=>)\\s*\\{`,
    'm'
  );
  const assignMatch = source.match(assignPattern);
  if (assignMatch) {
    const startIdx = source.indexOf(assignMatch[0]);
    const braceIdx = source.indexOf('{', startIdx + assignMatch[0].length - 1);
    return `const ${name} = ${source.slice(source.indexOf(assignMatch[0]) + assignMatch[0].indexOf('=') + 1, braceIdx + 1)}${extractBodyFrom(source, braceIdx)}`;
  }

  throw new Error(`Função "${name}" não encontrada no fonte.`);
}

/**
 * Extrai o bloco { ... } começando no índice do '{' de abertura.
 * Retorna a string completa incluindo a declaração antes do '{'.
 */
function extractBlock(source, braceOpenIdx) {
  // Retrocede para pegar a declaração completa
  let declStart = braceOpenIdx;
  while (declStart > 0 && source[declStart] !== '\n' && source[declStart] !== ';') declStart--;
  declStart++;

  let depth = 0;
  let i = braceOpenIdx;
  while (i < source.length) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(declStart, i + 1); }
    i++;
  }
  throw new Error('Bloco não fechado a partir do índice ' + braceOpenIdx);
}

function extractBodyFrom(source, braceOpenIdx) {
  let depth = 0;
  let i = braceOpenIdx;
  while (i < source.length) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(braceOpenIdx + 1, i); }
    i++;
  }
  throw new Error('Corpo não fechado a partir do índice ' + braceOpenIdx);
}

/**
 * Avalia um fragmento de código em um contexto isolado com as dependências
 * injetadas, retornando o objeto de exports preenchido pela execução.
 *
 * @param {string} code    - código a avaliar
 * @param {object} context - variáveis globais injetadas no escopo
 * @returns {object}       - objeto preenchido durante a avaliação
 */
function evalInContext(code, context = {}) {
  const keys = Object.keys(context);
  const vals = keys.map(k => context[k]);
  // eslint-disable-next-line no-new-func
  const fn = new Function(...keys, code);
  fn(...vals);
  return context;
}

module.exports = { readJS, extractFunction, evalInContext };
