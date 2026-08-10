const { db } = require('./databaseService');

function normalize(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function compact(value) {
  return normalize(value).replace(/[^a-z0-9]/g, '');
}

function tokenizeBoardText(value) {
  const fixes = {
    ace: 'acer',
    acerr: 'acer',
    acers: 'acer',
    aser: 'acer',
    del: 'dell',
    delll: 'dell',
    sansung: 'samsung',
    samsumg: 'samsung',
    positv: 'positivo',
    posivo: 'positivo',
    lenvo: 'lenovo',
    lenov: 'lenovo',
  };

  return normalize(value)
    .replace(/[\s._-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((item) => fixes[item] || item);
}

function extractBoardCodes(value) {
  const source = String(value || '');
  const patterns = [
    /\b(?:la|da|nm|mbx|ba)[\s._-]?[a-z0-9]{3,10}(?:[\s._-]?[a-z0-9]{1,4})?\b/gi,
    /\b6050a[\s._-]?\d{3,}\b/gi,
    /\bda0[a-z0-9]{6,}\b/gi,
    /\b(?:71r|ba41|48\.4)[\s._-]?[a-z0-9.-]{4,}\b/gi,
  ];
  const found = new Set();

  for (const pattern of patterns) {
    for (const match of source.match(pattern) || []) {
      const code = compact(match);
      if (code.length >= 5) found.add(code);
    }
  }

  return [...found];
}

function mapBoard(row) {
  if (!row) return null;

  const defects = db.prepare(`
    SELECT id, nome, descricao, created_at AS createdAt
    FROM board_defects
    WHERE board_id = ?
    ORDER BY datetime(created_at) DESC
  `).all(row.id);

  const notas = db.prepare(`
    SELECT id, texto, created_at AS createdAt
    FROM board_notes
    WHERE board_id = ?
    ORDER BY datetime(created_at) DESC
  `).all(row.id);

  const voltagePoints = db.prepare(`
    SELECT id, ref, tensao, observacao, componente, created_at AS createdAt
    FROM voltage_points
    WHERE board_id = ?
    ORDER BY datetime(created_at) DESC
  `).all(row.id);

  return {
    id: row.id,
    marca: row.marca,
    modelo: row.modelo,
    schematicPath: row.schematic_path || '',
    schematicName: row.schematic_name || '',
    defects,
    notas,
    voltagePoints,
    createdAt: row.created_at,
  };
}

function loadAll() {
  const rows = db.prepare(`
    SELECT id, marca, modelo, schematic_path, schematic_name, created_at
    FROM boards
    ORDER BY datetime(created_at) DESC
  `).all();

  return rows.map(mapBoard);
}

function createBoard({ marca, modelo, schematicPath, schematicName }) {
  const board = {
    id: Date.now().toString(),
    marca: marca.trim(),
    modelo: modelo.trim(),
    schematicPath: schematicPath || '',
    schematicName: schematicName || '',
    createdAt: new Date().toISOString(),
  };

  db.prepare(`
    INSERT INTO boards (id, marca, modelo, schematic_path, schematic_name, created_at)
    VALUES (@id, @marca, @modelo, @schematicPath, @schematicName, @createdAt)
  `).run(board);

  return { ...board, defects: [], notas: [], voltagePoints: [] };
}

function getBoard(id) {
  const row = db.prepare(`
    SELECT id, marca, modelo, schematic_path, schematic_name, created_at
    FROM boards
    WHERE id = ?
  `).get(id);

  return mapBoard(row);
}

function deleteBoard(id) {
  const result = db.prepare('DELETE FROM boards WHERE id = ?').run(id);
  return result.changes > 0;
}

function addDefect(boardId, { nome, descricao }) {
  if (!getBoard(boardId)) return null;

  const defect = {
    id: Date.now().toString(),
    boardId,
    nome: nome.trim(),
    descricao: descricao.trim(),
    createdAt: new Date().toISOString(),
  };

  db.prepare(`
    INSERT INTO board_defects (id, board_id, nome, descricao, created_at)
    VALUES (@id, @boardId, @nome, @descricao, @createdAt)
  `).run(defect);

  return {
    id: defect.id,
    nome: defect.nome,
    descricao: defect.descricao,
    createdAt: defect.createdAt,
  };
}

function removeDefect(boardId, defectId) {
  const result = db.prepare('DELETE FROM board_defects WHERE board_id = ? AND id = ?').run(boardId, defectId);
  return result.changes > 0;
}

function searchByQuery(query) {
  const q = normalize(query);
  const qCompact = compact(query);
  const qTokens = tokenizeBoardText(query);
  const qCodes = extractBoardCodes(query);

  return loadAll().filter((board) => {
    const marca = normalize(board.marca);
    const modelo = normalize(board.modelo);
    const joined = `${marca} ${modelo}`;
    const joinedCompact = compact(joined);
    const boardCodes = extractBoardCodes(board.modelo);

    if (marca.includes(q) || modelo.includes(q) || joined.includes(q)) return true;
    if (qCompact && joinedCompact.includes(qCompact)) return true;
    if (qCodes.some((code) => boardCodes.includes(code) || joinedCompact.includes(code))) return true;

    return qTokens.every((token) => joined.includes(token) || joinedCompact.includes(compact(token)));
  });
}

function findByMention(message) {
  const norm = normalize(message);
  const messageCompact = compact(message);
  const messageCodes = extractBoardCodes(message);
  return loadAll().filter((board) => {
    const marca = normalize(board.marca);
    const modelo = normalize(board.modelo);
    const joinedCompact = compact(`${board.marca} ${board.modelo}`);
    const boardCodes = extractBoardCodes(board.modelo);
    const escapedModelo = modelo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const modeloMatch = modelo.length >= 2 && new RegExp(`\\b${escapedModelo}\\b`).test(norm);
    const marcaModeloMatch = norm.includes(`${marca} ${modelo}`);
    const compactMatch = joinedCompact && messageCompact.includes(joinedCompact);
    const codeMatch = messageCodes.some((code) => boardCodes.includes(code) || joinedCompact.includes(code));
    return modeloMatch || marcaModeloMatch || compactMatch || codeMatch;
  });
}

function addNote(boardId, texto) {
  if (!getBoard(boardId)) return null;

  const note = {
    id: Date.now().toString(),
    boardId,
    texto: texto.trim(),
    createdAt: new Date().toISOString(),
  };

  db.prepare(`
    INSERT INTO board_notes (id, board_id, texto, created_at)
    VALUES (@id, @boardId, @texto, @createdAt)
  `).run(note);

  return {
    id: note.id,
    texto: note.texto,
    createdAt: note.createdAt,
  };
}

function findSimilarNote(boardId, texto) {
  const target = normalize(texto).replace(/\s+/g, ' ').trim();
  if (!target) return null;

  const board = getBoard(boardId);
  if (!board?.notas?.length) return null;

  return board.notas.find((note) => {
    const current = normalize(note.texto).replace(/\s+/g, ' ').trim();
    return current === target || current.includes(target) || target.includes(current);
  }) || null;
}

function removeNote(boardId, noteId) {
  const result = db.prepare('DELETE FROM board_notes WHERE board_id = ? AND id = ?').run(boardId, noteId);
  return result.changes > 0;
}

function addVoltagePoint(boardId, { ref, tensao, observacao, componente }) {
  if (!getBoard(boardId)) return null;

  const vp = {
    id: Date.now().toString(),
    boardId,
    ref: ref.trim().toUpperCase(),
    tensao: tensao.trim(),
    observacao: (observacao || '').trim(),
    componente: (componente || '').trim(),
    createdAt: new Date().toISOString(),
  };

  db.prepare(`
    INSERT INTO voltage_points (id, board_id, ref, tensao, observacao, componente, created_at)
    VALUES (@id, @boardId, @ref, @tensao, @observacao, @componente, @createdAt)
  `).run(vp);

  return {
    id: vp.id,
    ref: vp.ref,
    tensao: vp.tensao,
    observacao: vp.observacao,
    componente: vp.componente,
    createdAt: vp.createdAt,
  };
}

function removeVoltagePoint(boardId, vpId) {
  const result = db.prepare('DELETE FROM voltage_points WHERE board_id = ? AND id = ?').run(boardId, vpId);
  return result.changes > 0;
}

function bulkSetVoltagePoints(boardId, points) {
  if (!getBoard(boardId)) return null;

  const tx = db.transaction((items) => {
    db.prepare('DELETE FROM voltage_points WHERE board_id = ?').run(boardId);
    const insert = db.prepare(`
      INSERT INTO voltage_points (id, board_id, ref, tensao, observacao, componente, created_at)
      VALUES (@id, @boardId, @ref, @tensao, @observacao, @componente, @createdAt)
    `);

    for (const point of items) {
      insert.run({
        id: Date.now().toString() + Math.random().toString(36).slice(2),
        boardId,
        ref: (point.ref || '').trim().toUpperCase(),
        tensao: (point.tensao || '').trim(),
        observacao: (point.observacao || '').trim(),
        componente: (point.componente || '').trim(),
        createdAt: new Date().toISOString(),
      });
    }
  });

  tx(points);
  return getBoard(boardId);
}

module.exports = {
  loadAll,
  createBoard,
  getBoard,
  deleteBoard,
  addDefect,
  removeDefect,
  searchByQuery,
  findByMention,
  addNote,
  findSimilarNote,
  removeNote,
  addVoltagePoint,
  removeVoltagePoint,
  bulkSetVoltagePoints,
};
