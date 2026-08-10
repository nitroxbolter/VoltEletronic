const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

const cache = new Map();

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9+_.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function termsFromQuery(query) {
  const normalized = normalize(query);
  const terms = new Set(normalized.split(/\s+/).filter((term) => term.length >= 3));

  if (/\b(fonte|desarma|desarmando|19v|entrada|dc|jack|curto)\b/.test(normalized)) {
    [
      'dcin', 'dc', 'jack', 'vin', 'b+', 'batt+', 'adapter', 'adp',
      'acdet', 'acdrv', 'acok', 'charger', 'charge', 'mosfet',
      'pq', 'pu', 'pr', 'pl', '19v',
    ].forEach((term) => terms.add(term));
  }

  return [...terms];
}

function isPdf(filePath) {
  return path.extname(filePath || '').toLowerCase() === '.pdf';
}

async function loadPdfText(filePath) {
  if (!filePath || !fs.existsSync(filePath) || !isPdf(filePath)) return '';

  const stat = fs.statSync(filePath);
  const key = `${filePath}:${stat.mtimeMs}:${stat.size}`;
  if (cache.has(key)) return cache.get(key);

  const buffer = fs.readFileSync(filePath);
  const parsed = await pdfParse(buffer);
  const text = parsed.text || '';
  cache.set(key, text);
  return text;
}

function scoreLine(line, terms) {
  const normalized = normalize(line);
  let score = 0;
  for (const term of terms) {
    if (normalized.includes(term)) score += 2;
  }
  if (/\b(19v|12v|5v|3\.3v|3v|1\.8v|gnd|acdet|acdrv|dcin|vin|b\+|regn)\b/i.test(line)) score += 2;
  if (/\b(pu|pq|pc|pr|pl|pd|u|q|c|r)\d{1,5}\b/i.test(line)) score += 1;
  return score;
}

function pickRelevantLines(text, query, limit = Number(process.env.SCHEMATIC_MAX_LINES || 24)) {
  const terms = termsFromQuery(query);
  if (!text || terms.length === 0) return [];

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= 8 && line.length <= 180);

  return lines
    .map((line, index) => ({ line, index, score: scoreLine(line, terms) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.line);
}

async function buildSchematicContext(query, boards = []) {
  const blocks = [];

  for (const board of boards.slice(0, 2)) {
    if (!board.schematicPath || !isPdf(board.schematicPath)) continue;
    const text = await loadPdfText(board.schematicPath);
    const lines = pickRelevantLines(text, query);
    if (lines.length === 0) continue;

    blocks.push([
      `Esquema: ${board.marca} ${board.modelo}`,
      `Arquivo: ${board.schematicName || path.basename(board.schematicPath)}`,
      lines.map((line) => `- ${line}`).join('\n'),
    ].join('\n'));
  }

  if (blocks.length === 0) return '';
  return `\n\n=== TRECHOS RELEVANTES DO ESQUEMA ===\n${blocks.join('\n\n')}`;
}

module.exports = {
  buildSchematicContext,
};
