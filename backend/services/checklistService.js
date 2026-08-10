const { db, json, parseJson } = require('./databaseService');

const STOP_WORDS = new Set([
  'a', 'o', 'e', 'de', 'da', 'do', 'que', 'em', 'um', 'uma', 'para',
  'com', 'se', 'na', 'no', 'ou', 'ele', 'ela', 'os', 'as', 'ao', 'à',
  'não', 'mas', 'por', 'sua', 'seu', 'esta', 'esse', 'essa',
]);

function extractKeywords(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

function normalize(text) {
  return String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function mapItem(row) {
  return {
    id: row.id,
    problema: row.problema,
    keywords: parseJson(row.keywords_json),
    checklist: parseJson(row.checklist_json),
    createdAt: row.created_at,
  };
}

function loadAll() {
  return db.prepare(`
    SELECT id, problema, keywords_json, checklist_json, created_at
    FROM checklists
    ORDER BY datetime(created_at) DESC
  `).all().map(mapItem);
}

function addItem({ problema, checklist }) {
  const steps = Array.isArray(checklist)
    ? checklist.map((step) => step.trim()).filter(Boolean)
    : String(checklist || '').split(',').map((step) => step.trim()).filter(Boolean);

  const item = {
    id: Date.now().toString(),
    problema: problema.trim(),
    keywords: extractKeywords(problema),
    checklist: steps,
    createdAt: new Date().toISOString(),
  };

  db.prepare(`
    INSERT INTO checklists (id, problema, keywords_json, checklist_json, created_at)
    VALUES (@id, @problema, @keywordsJson, @checklistJson, @createdAt)
  `).run({
    ...item,
    keywordsJson: json(item.keywords),
    checklistJson: json(item.checklist),
  });

  return item;
}

function removeItem(id) {
  const result = db.prepare('DELETE FROM checklists WHERE id = ?').run(id);
  return result.changes > 0;
}

function findRelevant(message) {
  const normMsg = normalize(message);
  return loadAll().filter((item) => {
    if (normMsg.includes(normalize(item.problema))) return true;
    return item.keywords.some((keyword) => normMsg.includes(keyword));
  });
}

function buildChecklistBlock(message) {
  const relevant = findRelevant(message);
  if (relevant.length === 0) return '';

  let block = '\n\n=== CHECKLISTS DIAGNÓSTICOS RELEVANTES ===\n';
  for (const item of relevant) {
    block += `Problema: ${item.problema}\nPassos de diagnóstico:\n`;
    item.checklist.forEach((step, index) => { block += `  ${index + 1}. ${step}\n`; });
    block += '\n';
  }
  return block;
}

module.exports = { loadAll, addItem, removeItem, findRelevant, buildChecklistBlock };
