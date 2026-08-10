const { db } = require('./databaseService');

function now() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function toJson(value) {
  return JSON.stringify(value || {});
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function mapSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    summary: row.summary || '',
    metadata: parseJson(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: row.message_count ?? undefined,
  };
}

function mapMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    text: row.text,
    metadata: parseJson(row.metadata_json),
    createdAt: row.created_at,
  };
}

function createSession({ title = 'Nova conversa', summary = '', metadata = {} } = {}) {
  const timestamp = now();
  const session = {
    id: makeId('chat'),
    title: String(title || 'Nova conversa').trim().slice(0, 120),
    summary: String(summary || '').trim(),
    metadataJson: toJson(metadata),
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  db.prepare(`
    INSERT INTO chat_sessions (id, title, summary, metadata_json, created_at, updated_at)
    VALUES (@id, @title, @summary, @metadataJson, @createdAt, @updatedAt)
  `).run(session);

  return getSession(session.id);
}

function listSessions(limit = 30) {
  const rows = db.prepare(`
    SELECT
      s.*,
      COUNT(m.id) AS message_count
    FROM chat_sessions s
    LEFT JOIN chat_messages m ON m.session_id = s.id
    GROUP BY s.id
    ORDER BY s.updated_at DESC
    LIMIT ?
  `).all(Number(limit) || 30);

  return rows.map(mapSession);
}

function getSession(sessionId) {
  const row = db.prepare(`
    SELECT
      s.*,
      COUNT(m.id) AS message_count
    FROM chat_sessions s
    LEFT JOIN chat_messages m ON m.session_id = s.id
    WHERE s.id = ?
    GROUP BY s.id
  `).get(sessionId);

  return mapSession(row);
}

function getSessionWithMessages(sessionId) {
  const session = getSession(sessionId);
  if (!session) return null;

  const messages = db.prepare(`
    SELECT * FROM chat_messages
    WHERE session_id = ?
    ORDER BY created_at ASC
  `).all(sessionId).map(mapMessage);

  return { ...session, messages };
}

function updateSession(sessionId, { title, summary, metadata } = {}) {
  const current = getSession(sessionId);
  if (!current) return null;

  const next = {
    id: sessionId,
    title: title !== undefined ? String(title || 'Nova conversa').trim().slice(0, 120) : current.title,
    summary: summary !== undefined ? String(summary || '').trim() : current.summary,
    metadataJson: metadata !== undefined ? toJson(metadata) : toJson(current.metadata),
    updatedAt: now(),
  };

  db.prepare(`
    UPDATE chat_sessions
    SET title = @title,
        summary = @summary,
        metadata_json = @metadataJson,
        updated_at = @updatedAt
    WHERE id = @id
  `).run(next);

  return getSession(sessionId);
}

function ensureSession(sessionId, fallbackTitle = 'Nova conversa') {
  if (sessionId) {
    const existing = getSession(sessionId);
    if (existing) return existing;
  }
  return createSession({ title: fallbackTitle });
}

function addMessage(sessionId, { role, text, metadata = {}, createdAt } = {}) {
  if (!['user', 'ai', 'system'].includes(role)) {
    throw new Error('Role de mensagem inválido.');
  }

  const cleanText = String(text || '').trim();
  if (!cleanText) throw new Error('Texto da mensagem é obrigatório.');

  const session = ensureSession(sessionId);
  const message = {
    id: makeId('msg'),
    sessionId: session.id,
    role,
    text: cleanText,
    metadataJson: toJson(metadata),
    createdAt: createdAt || now(),
  };

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO chat_messages (id, session_id, role, text, metadata_json, created_at)
      VALUES (@id, @sessionId, @role, @text, @metadataJson, @createdAt)
    `).run(message);

    db.prepare(`
      UPDATE chat_sessions
      SET updated_at = ?
      WHERE id = ?
    `).run(message.createdAt, session.id);
  });

  tx();
  return mapMessage({
    id: message.id,
    session_id: message.sessionId,
    role: message.role,
    text: message.text,
    metadata_json: message.metadataJson,
    created_at: message.createdAt,
  });
}

function addExchange(sessionId, userText, aiText, metadata = {}) {
  const session = ensureSession(sessionId, makeTitleFromText(userText));
  const userMessage = addMessage(session.id, {
    role: 'user',
    text: userText,
    metadata: metadata.user || {},
  });
  const aiMessage = addMessage(session.id, {
    role: 'ai',
    text: aiText,
    metadata: metadata.ai || {},
  });

  if (session.title === 'Nova conversa') {
    updateSession(session.id, { title: makeTitleFromText(userText) });
  }

  return {
    session: getSession(session.id),
    messages: [userMessage, aiMessage],
  };
}

function makeTitleFromText(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'Nova conversa';
  return clean.length > 48 ? `${clean.slice(0, 45)}...` : clean;
}

function deleteSession(sessionId) {
  const result = db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(sessionId);
  return result.changes > 0;
}

function searchMessages(query, limit = 30) {
  const q = String(query || '').trim();
  if (!q) return [];

  const rows = db.prepare(`
    SELECT
      m.*,
      s.title AS session_title
    FROM chat_messages m
    JOIN chat_sessions s ON s.id = m.session_id
    WHERE m.text LIKE ?
    ORDER BY m.created_at DESC
    LIMIT ?
  `).all(`%${q}%`, Number(limit) || 30);

  return rows.map((row) => ({
    ...mapMessage(row),
    sessionTitle: row.session_title,
  }));
}

module.exports = {
  createSession,
  listSessions,
  getSession,
  getSessionWithMessages,
  updateSession,
  ensureSession,
  addMessage,
  addExchange,
  deleteSession,
  searchMessages,
};
