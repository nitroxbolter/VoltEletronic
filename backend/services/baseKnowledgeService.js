const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, json, parseJson } = require('./databaseService');

const BASE_DIR = path.join(__dirname, '..', 'base');

const STOP_WORDS = new Set([
  'para', 'com', 'uma', 'que', 'por', 'das', 'dos', 'nas', 'nos', 'sem',
  'deve', 'como', 'mais', 'esta', 'esse', 'essa', 'entre', 'quando', 'onde',
  'tensao', 'medir', 'teste', 'testes',
]);

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9+_.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function keywordsFor(text) {
  return [...new Set(
    normalize(text)
      .split(/\s+/)
      .filter((word) => word.length >= 3 && !STOP_WORDS.has(word))
  )];
}

function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function sourceIdFor(relativePath) {
  return crypto.createHash('sha1').update(relativePath).digest('hex');
}

function titleFromContent(fileName, content) {
  const heading = content.match(/^#\s+(.+)$/m);
  if (heading) return heading[1].trim();
  return path.basename(fileName, path.extname(fileName)).replace(/[_-]+/g, ' ');
}

function splitMarkdown(content) {
  const lines = content.split(/\r?\n/);
  const chunks = [];
  let currentHeading = '';
  let current = [];

  function flush() {
    const text = current.join('\n').trim();
    if (!text) return;
    chunks.push({ heading: currentHeading, content: text });
    current = [];
  }

  for (const line of lines) {
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flush();
      currentHeading = heading[2].trim();
      current.push(line);
    } else {
      current.push(line);
    }
  }

  flush();
  return chunks;
}

function listSourceFiles() {
  if (!fs.existsSync(BASE_DIR)) return [];
  return fs.readdirSync(BASE_DIR)
    .filter((file) => file.toLowerCase().endsWith('.md'))
    .map((file) => path.join(BASE_DIR, file));
}

function indexSourceFile(filePath) {
  const relativePath = path.relative(path.join(__dirname, '..'), filePath).replace(/\\/g, '/');
  const content = fs.readFileSync(filePath, 'utf8');
  const contentHash = hashContent(content);
  const existing = db.prepare('SELECT content_hash FROM knowledge_sources WHERE file_path = ?').get(relativePath);

  if (existing?.content_hash === contentHash) return false;

  const source = {
    id: sourceIdFor(relativePath),
    filePath: relativePath,
    title: titleFromContent(filePath, content),
    type: 'markdown',
    contentHash,
    updatedAt: fs.statSync(filePath).mtime.toISOString(),
    indexedAt: new Date().toISOString(),
  };
  const chunks = splitMarkdown(content);

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO knowledge_sources (id, file_path, title, type, content_hash, updated_at, indexed_at)
      VALUES (@id, @filePath, @title, @type, @contentHash, @updatedAt, @indexedAt)
      ON CONFLICT(file_path) DO UPDATE SET
        title = excluded.title,
        type = excluded.type,
        content_hash = excluded.content_hash,
        updated_at = excluded.updated_at,
        indexed_at = excluded.indexed_at
    `).run(source);

    db.prepare('DELETE FROM knowledge_chunks WHERE source_id = ?').run(source.id);

    const insertChunk = db.prepare(`
      INSERT INTO knowledge_chunks (id, source_id, heading, content, keywords_json, position)
      VALUES (@id, @sourceId, @heading, @content, @keywordsJson, @position)
    `);

    chunks.forEach((chunk, index) => {
      insertChunk.run({
        id: `${source.id}-${index}`,
        sourceId: source.id,
        heading: chunk.heading,
        content: chunk.content,
        keywordsJson: json(keywordsFor(`${source.title} ${chunk.heading} ${chunk.content}`)),
        position: index,
      });
    });
  });

  tx();
  return true;
}

function syncBaseKnowledge() {
  for (const file of listSourceFiles()) {
    indexSourceFile(file);
  }
}

function loadSources() {
  syncBaseKnowledge();
  return db.prepare(`
    SELECT id, file_path AS filePath, title, type, content_hash AS contentHash, updated_at AS updatedAt, indexed_at AS indexedAt
    FROM knowledge_sources
    ORDER BY title ASC
  `).all();
}

function searchChunks(query, limit = 8) {
  syncBaseKnowledge();
  const terms = keywordsFor(query);
  if (terms.length === 0) return [];

  const rows = db.prepare(`
    SELECT c.id, c.source_id AS sourceId, c.heading, c.content, c.keywords_json AS keywordsJson,
           c.position, s.title AS sourceTitle, s.file_path AS filePath
    FROM knowledge_chunks c
    JOIN knowledge_sources s ON s.id = c.source_id
  `).all();

  return rows
    .map((row) => {
      const keywords = parseJson(row.keywordsJson);
      const normalized = normalize(`${row.sourceTitle} ${row.heading} ${row.content}`);
      let score = 0;
      for (const term of terms) {
        if (keywords.includes(term)) score += 3;
        if (normalized.includes(term)) score += 1;
      }
      return { ...row, keywords, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.position - b.position)
    .slice(0, limit);
}

function buildBaseKnowledgeBlock(query) {
  const chunks = searchChunks(query, 8);
  if (chunks.length === 0) return '';

  const lines = chunks.map((chunk, index) => {
    const heading = chunk.heading ? ` > ${chunk.heading}` : '';
    return [
      `Trecho #${index + 1}: ${chunk.sourceTitle}${heading}`,
      chunk.content,
    ].join('\n');
  });

  return `\n\n=== BASE TÉCNICA INDEXADA (Markdown + SQLite; use somente se relevante) ===\n${lines.join('\n\n')}`;
}

module.exports = {
  syncBaseKnowledge,
  loadSources,
  searchChunks,
  buildBaseKnowledgeBlock,
};
