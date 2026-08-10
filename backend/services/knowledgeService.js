const { db, json, parseJson } = require('./databaseService');

function autoTags(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 4);
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function mapEntry(row) {
  const entry = {
    id: row.id,
    tags: parseJson(row.tags_json),
    createdAt: row.created_at,
  };

  if (row.categoria) {
    entry.categoria = row.categoria;
    entry.titulo = row.titulo;
    entry.conteudo = row.conteudo;
    entry.solucoes = parseJson(row.solucoes_json);
  } else {
    entry.text = row.text;
  }

  return entry;
}

function loadAll() {
  return db.prepare(`
    SELECT id, text, categoria, titulo, conteudo, tags_json, solucoes_json, created_at
    FROM knowledge_entries
    ORDER BY datetime(created_at) DESC
  `).all().map(mapEntry);
}

function addEntry(text) {
  const entry = {
    id: Date.now().toString(),
    text: text.trim(),
    tags: autoTags(text),
    createdAt: new Date().toISOString(),
  };

  db.prepare(`
    INSERT INTO knowledge_entries (id, text, categoria, titulo, conteudo, tags_json, solucoes_json, created_at)
    VALUES (@id, @text, '', '', '', @tagsJson, '[]', @createdAt)
  `).run({
    ...entry,
    tagsJson: json(entry.tags),
  });

  return entry;
}

function addStructured(categoria, titulo, conteudo) {
  const entry = {
    id: Date.now().toString(),
    categoria: categoria.trim().toLowerCase(),
    titulo: titulo.trim().toLowerCase(),
    conteudo: conteudo.trim(),
    tags: [...new Set(autoTags(`${categoria} ${titulo} ${conteudo}`))],
    solucoes: [],
    createdAt: new Date().toISOString(),
  };

  db.prepare(`
    INSERT INTO knowledge_entries (id, text, categoria, titulo, conteudo, tags_json, solucoes_json, created_at)
    VALUES (@id, '', @categoria, @titulo, @conteudo, @tagsJson, '[]', @createdAt)
  `).run({
    ...entry,
    tagsJson: json(entry.tags),
  });

  return entry;
}

function addSolution(id, solucao) {
  const row = db.prepare('SELECT * FROM knowledge_entries WHERE id = ?').get(id);
  if (!row) return null;

  const solucoes = parseJson(row.solucoes_json);
  solucoes.push({ solucao: solucao.trim(), resolvidoEm: new Date().toISOString() });

  db.prepare('UPDATE knowledge_entries SET solucoes_json = ? WHERE id = ?').run(json(solucoes), id);
  return mapEntry({ ...row, solucoes_json: json(solucoes) });
}

function removeEntry(id) {
  const result = db.prepare('DELETE FROM knowledge_entries WHERE id = ?').run(id);
  return result.changes > 0;
}

function search(query) {
  const entries = loadAll();
  const terms = autoTags(query);
  if (terms.length === 0) return entries;

  const scored = entries.map((entry) => {
    let score = 0;
    const catMatch = entry.categoria && terms.some((term) => entry.categoria.includes(term));
    const titMatch = entry.titulo && terms.some((term) => entry.titulo.includes(term));
    if (catMatch) score += 3;
    if (titMatch) score += 3;
    if (entry.tags) score += entry.tags.filter((tag) => terms.includes(tag)).length;
    if (entry.text) {
      const lower = entry.text.toLowerCase();
      score += terms.filter((term) => lower.includes(term)).length;
    }
    return { entry, score };
  });

  return scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.entry);
}

function buildKnowledgeBlock(query) {
  const entries = query ? search(query) : loadAll();
  if (entries.length === 0) return '';

  const lines = entries.slice(0, 10).map((entry) => {
    if (entry.categoria) {
      let line = `REGISTRO [categoria: ${entry.categoria} | problema: ${entry.titulo}] → ${entry.conteudo}`;
      if (entry.solucoes && entry.solucoes.length > 0) {
        line += ` | Solução confirmada: ${entry.solucoes[entry.solucoes.length - 1].solucao}`;
      }
      return line;
    }

    return `NOTA: ${entry.text}`;
  }).join('\n');

  return `\n\n## Conhecimento técnico armazenado (REGISTROS DE DIAGNÓSTICO — use apenas quando tecnicamente relevante para o problema descrito):\n${lines}`;
}

function findSimilarStructured(categoria, titulo, conteudo) {
  const targetCategory = normalizeText(categoria);
  const targetTitle = normalizeText(titulo);
  const targetContent = normalizeText(conteudo);
  if (!targetCategory && !targetTitle && !targetContent) return null;

  return loadAll().find((entry) => {
    if (!entry.categoria) return false;
    const sameCategory = normalizeText(entry.categoria) === targetCategory;
    const sameTitle = normalizeText(entry.titulo) === targetTitle;
    const entryContent = normalizeText(entry.conteudo);
    const veryCloseContent = targetContent && (
      entryContent === targetContent
      || entryContent.includes(targetContent)
      || targetContent.includes(entryContent)
    );
    return sameCategory && (sameTitle || veryCloseContent);
  }) || null;
}

module.exports = {
  addEntry,
  addStructured,
  addSolution,
  removeEntry,
  loadAll,
  search,
  buildKnowledgeBlock,
  findSimilarStructured,
};
