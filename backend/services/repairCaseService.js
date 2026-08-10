const { db, json, parseJson } = require('./databaseService');

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9+_.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSet(value) {
  return new Set(normalizeText(value).split(/\s+/).filter((word) => word.length >= 2));
}

function sanitizeMeasurements(measurements) {
  if (!Array.isArray(measurements)) return [];

  return measurements
    .map((item) => ({
      signal: String(item.signal || item.sinal || '').trim(),
      measured: String(item.measured || item.medido || '').trim(),
      expected: String(item.expected || item.esperado || '').trim(),
      note: String(item.note || item.observacao || '').trim(),
    }))
    .filter((item) => item.signal || item.measured || item.expected || item.note);
}

function getMeasurements(caseId) {
  return db.prepare(`
    SELECT signal, measured, expected, note
    FROM repair_measurements
    WHERE repair_case_id = ?
    ORDER BY position ASC
  `).all(caseId);
}

function mapRepairCase(row) {
  return {
    id: row.id,
    boardId: row.board_id,
    symptom: row.symptom,
    defect: row.defect || '',
    component: row.component || '',
    measurements: getMeasurements(row.id),
    analysis: row.analysis || '',
    cause: row.cause || '',
    solution: row.solution || '',
    result: row.result || '',
    tags: parseJson(row.tags_json),
    createdAt: row.created_at,
  };
}

function loadAll() {
  return db.prepare(`
    SELECT id, board_id, symptom, defect, component, analysis, cause, solution, result, tags_json, created_at
    FROM repair_cases
    ORDER BY datetime(created_at) DESC
  `).all().map(mapRepairCase);
}

function createRepairCase(boardId, payload) {
  const symptom = String(payload.symptom || payload.sintoma || '').trim();
  if (!boardId || !symptom) return null;

  const measurements = sanitizeMeasurements(payload.measurements || payload.medicoes);
  const measurementText = measurements
    .map((measurement) => `${measurement.signal} ${measurement.measured} ${measurement.expected} ${measurement.note}`)
    .join(' ');

  const repairCase = {
    id: Date.now().toString() + Math.random().toString(36).slice(2),
    boardId,
    symptom,
    defect: String(payload.defect || payload.defeito || '').trim(),
    component: String(payload.component || payload.componente || '').trim(),
    measurements,
    analysis: String(payload.analysis || payload.analise || '').trim(),
    cause: String(payload.cause || payload.causa || '').trim(),
    solution: String(payload.solution || payload.solucao || '').trim(),
    result: String(payload.result || payload.resultado || '').trim(),
    tags: [...tokenSet([
      symptom,
      payload.defect || payload.defeito,
      payload.component || payload.componente,
      payload.analysis || payload.analise,
      payload.cause || payload.causa,
      payload.solution || payload.solucao,
      payload.result || payload.resultado,
      measurementText,
    ].join(' '))],
    createdAt: new Date().toISOString(),
  };

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO repair_cases
        (id, board_id, symptom, defect, component, analysis, cause, solution, result, tags_json, created_at)
      VALUES
        (@id, @boardId, @symptom, @defect, @component, @analysis, @cause, @solution, @result, @tagsJson, @createdAt)
    `).run({
      ...repairCase,
      tagsJson: json(repairCase.tags),
    });

    const insertMeasurement = db.prepare(`
      INSERT INTO repair_measurements
        (id, repair_case_id, signal, measured, expected, note, position)
      VALUES
        (@id, @repairCaseId, @signal, @measured, @expected, @note, @position)
    `);

    repairCase.measurements.forEach((measurement, index) => {
      insertMeasurement.run({
        id: `${repairCase.id}-m-${index}-${Math.random().toString(36).slice(2)}`,
        repairCaseId: repairCase.id,
        signal: measurement.signal,
        measured: measurement.measured,
        expected: measurement.expected,
        note: measurement.note,
        position: index,
      });
    });
  });

  tx();
  return repairCase;
}

function getByBoard(boardId) {
  return db.prepare(`
    SELECT id, board_id, symptom, defect, component, analysis, cause, solution, result, tags_json, created_at
    FROM repair_cases
    WHERE board_id = ?
    ORDER BY datetime(created_at) DESC
  `).all(boardId).map(mapRepairCase);
}

function removeRepairCase(id) {
  const result = db.prepare('DELETE FROM repair_cases WHERE id = ?').run(id);
  return result.changes > 0;
}

function scoreRepairCase(repairCase, query) {
  const terms = tokenSet(query);
  if (terms.size === 0) return 0;

  let score = 0;
  const fields = [
    repairCase.symptom,
    repairCase.defect,
    repairCase.component,
    repairCase.analysis,
    repairCase.cause,
    repairCase.solution,
    repairCase.result,
    ...(repairCase.measurements || []).map((measurement) => (
      `${measurement.signal} ${measurement.measured} ${measurement.expected} ${measurement.note}`
    )),
  ].map(normalizeText);

  for (const term of terms) {
    if (repairCase.tags?.includes(term)) score += 2;
    if (fields.some((field) => field.includes(term))) score += 1;
  }

  return score;
}

function search(query, { boardId, limit = 6 } = {}) {
  return loadAll()
    .filter((repairCase) => !boardId || repairCase.boardId === boardId)
    .map((repairCase) => ({ repairCase, score: scoreRepairCase(repairCase, query) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || new Date(b.repairCase.createdAt) - new Date(a.repairCase.createdAt))
    .slice(0, limit)
    .map((item) => item.repairCase);
}

function formatMeasurements(measurements) {
  if (!measurements?.length) return '';
  return measurements
    .slice(0, 8)
    .map((measurement) => {
      const expected = measurement.expected ? ` esperado ${measurement.expected}` : '';
      const note = measurement.note ? ` (${measurement.note})` : '';
      return `${measurement.signal || 'medicao'} = ${measurement.measured || '-'}${expected}${note}`;
    })
    .join('; ');
}

function buildRepairCasesBlock(query, boards = []) {
  const boardIds = new Set(boards.map((board) => board.id));
  let relevant = [];

  if (boardIds.size > 0) {
    for (const boardId of boardIds) {
      relevant.push(...search(query, { boardId, limit: 4 }));
      relevant.push(...getByBoard(boardId).slice(0, 2));
    }
  } else {
    relevant = search(query, { limit: 6 });
  }

  const unique = [];
  const seen = new Set();
  for (const repairCase of relevant) {
    if (seen.has(repairCase.id)) continue;
    seen.add(repairCase.id);
    unique.push(repairCase);
  }

  if (unique.length === 0) return '';

  const lines = unique.slice(0, 6).map((repairCase, index) => {
    const board = boards.find((item) => item.id === repairCase.boardId);
    const boardLabel = board ? `${board.marca} ${board.modelo}` : `placa ${repairCase.boardId}`;
    const measurements = formatMeasurements(repairCase.measurements);
    return [
      `Caso #${index + 1} (${boardLabel})`,
      `Sintoma: ${repairCase.symptom}`,
      repairCase.defect ? `Defeito observado: ${repairCase.defect}` : '',
      measurements ? `Medicoes: ${measurements}` : '',
      repairCase.analysis ? `Analise: ${repairCase.analysis}` : '',
      repairCase.cause ? `Causa: ${repairCase.cause}` : '',
      repairCase.solution ? `Solucao: ${repairCase.solution}` : '',
      repairCase.result ? `Resultado: ${repairCase.result}` : '',
    ].filter(Boolean).join(' | ');
  });

  return `\n\n=== CASOS DE REPARO RELEVANTES ===\n${lines.join('\n')}`;
}

module.exports = {
  loadAll,
  createRepairCase,
  getByBoard,
  removeRepairCase,
  search,
  buildRepairCasesBlock,
};
