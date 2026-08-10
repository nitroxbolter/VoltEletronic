const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'volt.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function readJsonFile(fileName, fallback = []) {
  const filePath = path.join(DATA_DIR, fileName);
  if (!fs.existsSync(filePath)) return fallback;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function json(value) {
  return JSON.stringify(value || []);
}

function parseJson(value, fallback = []) {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function createSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS boards (
      id TEXT PRIMARY KEY,
      marca TEXT NOT NULL,
      modelo TEXT NOT NULL,
      schematic_path TEXT DEFAULT '',
      schematic_name TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS board_defects (
      id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL,
      nome TEXT NOT NULL,
      descricao TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_board_defects_board_id ON board_defects(board_id);

    CREATE TABLE IF NOT EXISTS board_notes (
      id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL,
      texto TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_board_notes_board_id ON board_notes(board_id);

    CREATE TABLE IF NOT EXISTS voltage_points (
      id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL,
      ref TEXT NOT NULL,
      tensao TEXT NOT NULL,
      observacao TEXT DEFAULT '',
      componente TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_voltage_points_board_id ON voltage_points(board_id);

    CREATE TABLE IF NOT EXISTS knowledge_entries (
      id TEXT PRIMARY KEY,
      text TEXT DEFAULT '',
      categoria TEXT DEFAULT '',
      titulo TEXT DEFAULT '',
      conteudo TEXT DEFAULT '',
      tags_json TEXT DEFAULT '[]',
      solucoes_json TEXT DEFAULT '[]',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS checklists (
      id TEXT PRIMARY KEY,
      problema TEXT NOT NULL,
      keywords_json TEXT DEFAULT '[]',
      checklist_json TEXT DEFAULT '[]',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS repair_cases (
      id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL,
      symptom TEXT NOT NULL,
      defect TEXT DEFAULT '',
      component TEXT DEFAULT '',
      analysis TEXT DEFAULT '',
      cause TEXT DEFAULT '',
      solution TEXT DEFAULT '',
      result TEXT DEFAULT '',
      tags_json TEXT DEFAULT '[]',
      created_at TEXT NOT NULL,
      FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_repair_cases_board_id ON repair_cases(board_id);

    CREATE TABLE IF NOT EXISTS repair_measurements (
      id TEXT PRIMARY KEY,
      repair_case_id TEXT NOT NULL,
      signal TEXT DEFAULT '',
      measured TEXT DEFAULT '',
      expected TEXT DEFAULT '',
      note TEXT DEFAULT '',
      position INTEGER DEFAULT 0,
      FOREIGN KEY (repair_case_id) REFERENCES repair_cases(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_repair_measurements_case_id ON repair_measurements(repair_case_id);

    CREATE TABLE IF NOT EXISTS knowledge_sources (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      type TEXT DEFAULT 'markdown',
      content_hash TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      indexed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      heading TEXT DEFAULT '',
      content TEXT NOT NULL,
      keywords_json TEXT DEFAULT '[]',
      position INTEGER DEFAULT 0,
      FOREIGN KEY (source_id) REFERENCES knowledge_sources(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_source_id ON knowledge_chunks(source_id);

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT DEFAULT '',
      metadata_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'ai', 'system')),
      text TEXT NOT NULL,
      metadata_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated_at ON chat_sessions(updated_at);
  `);
}

function countRows(table) {
  return db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total;
}

function migrateBoardsFromJson() {
  if (countRows('boards') > 0) return;

  const boards = readJsonFile('boards.json');
  if (boards.length === 0) return;

  const insertBoard = db.prepare(`
    INSERT OR IGNORE INTO boards (id, marca, modelo, schematic_path, schematic_name, created_at)
    VALUES (@id, @marca, @modelo, @schematicPath, @schematicName, @createdAt)
  `);
  const insertDefect = db.prepare(`
    INSERT OR IGNORE INTO board_defects (id, board_id, nome, descricao, created_at)
    VALUES (@id, @boardId, @nome, @descricao, @createdAt)
  `);
  const insertNote = db.prepare(`
    INSERT OR IGNORE INTO board_notes (id, board_id, texto, created_at)
    VALUES (@id, @boardId, @texto, @createdAt)
  `);
  const insertVoltage = db.prepare(`
    INSERT OR IGNORE INTO voltage_points (id, board_id, ref, tensao, observacao, componente, created_at)
    VALUES (@id, @boardId, @ref, @tensao, @observacao, @componente, @createdAt)
  `);

  const tx = db.transaction((items) => {
    for (const board of items) {
      const boardId = String(board.id || Date.now().toString());
      insertBoard.run({
        id: boardId,
        marca: String(board.marca || '').trim(),
        modelo: String(board.modelo || '').trim(),
        schematicPath: board.schematicPath || '',
        schematicName: board.schematicName || '',
        createdAt: board.createdAt || new Date().toISOString(),
      });

      for (const defect of board.defects || []) {
        insertDefect.run({
          id: String(defect.id || `${boardId}-defect-${Math.random().toString(36).slice(2)}`),
          boardId,
          nome: String(defect.nome || '').trim(),
          descricao: String(defect.descricao || '').trim(),
          createdAt: defect.createdAt || new Date().toISOString(),
        });
      }

      for (const note of board.notas || []) {
        insertNote.run({
          id: String(note.id || `${boardId}-note-${Math.random().toString(36).slice(2)}`),
          boardId,
          texto: String(note.texto || '').trim(),
          createdAt: note.createdAt || new Date().toISOString(),
        });
      }

      for (const point of board.voltagePoints || []) {
        insertVoltage.run({
          id: String(point.id || `${boardId}-vp-${Math.random().toString(36).slice(2)}`),
          boardId,
          ref: String(point.ref || '').trim().toUpperCase(),
          tensao: String(point.tensao || '').trim(),
          observacao: String(point.observacao || '').trim(),
          componente: String(point.componente || '').trim(),
          createdAt: point.createdAt || new Date().toISOString(),
        });
      }
    }
  });

  tx(boards.filter((board) => board?.marca && board?.modelo));
}

function migrateKnowledgeFromJson() {
  if (countRows('knowledge_entries') > 0) return;

  const entries = readJsonFile('knowledge.json');
  if (entries.length === 0) return;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO knowledge_entries
      (id, text, categoria, titulo, conteudo, tags_json, solucoes_json, created_at)
    VALUES
      (@id, @text, @categoria, @titulo, @conteudo, @tagsJson, @solucoesJson, @createdAt)
  `);

  const tx = db.transaction((items) => {
    for (const entry of items) {
      insert.run({
        id: String(entry.id || Date.now().toString() + Math.random().toString(36).slice(2)),
        text: entry.text || '',
        categoria: entry.categoria || '',
        titulo: entry.titulo || '',
        conteudo: entry.conteudo || '',
        tagsJson: json(entry.tags),
        solucoesJson: json(entry.solucoes),
        createdAt: entry.createdAt || new Date().toISOString(),
      });
    }
  });

  tx(entries);
}

function migrateChecklistsFromJson() {
  if (countRows('checklists') > 0) return;

  const items = readJsonFile('checklist.json');
  if (items.length === 0) return;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO checklists (id, problema, keywords_json, checklist_json, created_at)
    VALUES (@id, @problema, @keywordsJson, @checklistJson, @createdAt)
  `);

  const tx = db.transaction((checklists) => {
    for (const item of checklists) {
      if (!item?.problema) continue;
      insert.run({
        id: String(item.id || Date.now().toString() + Math.random().toString(36).slice(2)),
        problema: String(item.problema || '').trim(),
        keywordsJson: json(item.keywords),
        checklistJson: json(item.checklist),
        createdAt: item.createdAt || new Date().toISOString(),
      });
    }
  });

  tx(items);
}

function migrateRepairCasesFromJson() {
  if (countRows('repair_cases') > 0) return;

  const cases = readJsonFile('repairCases.json');
  if (cases.length === 0) return;

  const insertCase = db.prepare(`
    INSERT OR IGNORE INTO repair_cases
      (id, board_id, symptom, defect, component, analysis, cause, solution, result, tags_json, created_at)
    VALUES
      (@id, @boardId, @symptom, @defect, @component, @analysis, @cause, @solution, @result, @tagsJson, @createdAt)
  `);
  const insertMeasurement = db.prepare(`
    INSERT INTO repair_measurements
      (id, repair_case_id, signal, measured, expected, note, position)
    VALUES
      (@id, @repairCaseId, @signal, @measured, @expected, @note, @position)
  `);

  const tx = db.transaction((items) => {
    for (const repairCase of items) {
      if (!repairCase?.boardId || !repairCase?.symptom) continue;
      const caseId = String(repairCase.id || Date.now().toString() + Math.random().toString(36).slice(2));
      insertCase.run({
        id: caseId,
        boardId: String(repairCase.boardId),
        symptom: String(repairCase.symptom || '').trim(),
        defect: repairCase.defect || '',
        component: repairCase.component || '',
        analysis: repairCase.analysis || '',
        cause: repairCase.cause || '',
        solution: repairCase.solution || '',
        result: repairCase.result || '',
        tagsJson: json(repairCase.tags),
        createdAt: repairCase.createdAt || new Date().toISOString(),
      });

      (repairCase.measurements || []).forEach((measurement, index) => {
        insertMeasurement.run({
          id: `${caseId}-m-${index}-${Math.random().toString(36).slice(2)}`,
          repairCaseId: caseId,
          signal: measurement.signal || '',
          measured: measurement.measured || '',
          expected: measurement.expected || '',
          note: measurement.note || '',
          position: index,
        });
      });
    }
  });

  tx(cases);
}

function initializeDatabase() {
  createSchema();
  migrateBoardsFromJson();
  migrateKnowledgeFromJson();
  migrateChecklistsFromJson();
  migrateRepairCasesFromJson();
}

initializeDatabase();

module.exports = {
  db,
  DB_FILE,
  parseJson,
  json,
};
