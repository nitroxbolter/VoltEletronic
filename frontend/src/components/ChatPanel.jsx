import { useState, useRef, useEffect } from 'react';
import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';

const API_URL = import.meta.env.VITE_API_URL || '/api';
const ACTIVE_CHAT_SESSION_KEY = 'volt_active_chat_session_id';
const FORCE_API_KEY = 'volt_force_api_mode';
const WELCOME_MESSAGE = {
  id: 'welcome',
  role: 'ai',
  text:
    '👋 Olá! Sou seu assistente de eletrônica.\n\n' +
    'Faça perguntas técnicas normalmente — detecto automaticamente qual placa e checklist usar.\n\n' +
    'Digite ajuda para ver os comandos disponíveis.',
};

/** Remove acentos de uma string para comparações case-insensitive */
function norm(str) {
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

const BOARD_QUERY_FIXES = {
  ace: 'acer',
  acerr: 'acer',
  acers: 'acer',
  aser: 'acer',
  delll: 'dell',
  del: 'dell',
  samsumg: 'samsung',
  sansung: 'samsung',
  positv: 'positivo',
  posivo: 'positivo',
  lenvo: 'lenovo',
  lenov: 'lenovo',
  soni: 'sony',
  vai: 'vaio',
};

const SCHEMATIC_PENALTY_TERMS = [
  'photo',
  'foto',
  'top',
  'bottom',
  'anotacoes',
  'adicionais',
  'troubleshooting',
  'editados',
  'edited',
  'video',
  'rapido',
];

const BOARD_QUERY_STOPWORDS = new Set([
  'nao', 'não', 'sem', 'com', 'quando', 'onde', 'que', 'esta', 'está', 'liga',
  'curto', 'curta', 'principal', 'linha', 'fonte', 'desarma', 'placa', 'notebook',
]);

function compactBoardToken(value) {
  return norm(value).replace(/[^a-z0-9]/g, '');
}

function extractBoardCodeCandidates(text) {
  const source = String(text || '');
  const patterns = [
    /\b(?:la|da|nm|mbx|ba)[\s._-]?[a-z0-9]{3,10}(?:[\s._-]?[a-z0-9]{1,4})?\b/gi,
    /\b6050a[\s._-]?\d{3,}\b/gi,
    /\bda0[a-z0-9]{6,}\b/gi,
    /\b(?:71r|ba41|48\.4)[\s._-]?[a-z0-9.-]{4,}\b/gi,
  ];
  const found = new Set();

  for (const pattern of patterns) {
    for (const match of source.match(pattern) || []) {
      const compact = compactBoardToken(match);
      if (compact.length >= 5) found.add(compact);
    }
  }

  return [...found];
}

function extractProductModelCandidates(text) {
  const source = norm(text);
  const matches = source.match(/\b[a-z]{1,5}\d{3,4}[a-z0-9-]{0,6}\b/g) || [];
  return [...new Set(matches.map((item) => item.replace(/[^a-z0-9]/g, '')).filter((item) => item.length >= 4))];
}

// ─── Lê e formata o estado do analisador de circuito ───────────────────────
function buildAnalyzerContext() {
  const ctx = window.__analyzerCtx;
  if (!ctx || !ctx.points?.length) return null;

  const STATUS_ICON = { ok: '✓ OK', warn: '⚠ Atenção', bad: '✗ FALHA', empty: '— (sem medição)', na: '— (N/A)' };

  const measured = ctx.points.filter(p => p.status !== 'empty');
  const failed   = ctx.points.filter(p => p.status === 'bad');
  const warned   = ctx.points.filter(p => p.status === 'warn');

  let out = `=== ANALISADOR DE CIRCUITO — CSPRH LA-E921P / BQ24781 ===\n`;
  out += `Estágio de teste: ${ctx.stageLabel}\n`;
  out += `Pontos medidos: ${measured.length}/${ctx.points.length}\n`;

  if (failed.length > 0) {
    out += `\n⚠ FALHAS DETECTADAS (${failed.length}):  ← prioridade diagnóstico\n`;
    for (const p of failed) {
      out += `  ${p.signal} (${p.comp}): medido=${p.measured}V | esperado=${p.expLabel}`;
      if (p.expMin !== null && p.expMax !== null) out += ` [${p.expMin}–${p.expMax}V]`;
      out += '\n';
    }
  }
  if (warned.length > 0) {
    out += `\n⚠ ATENÇÃO (${warned.length}):\n`;
    for (const p of warned) {
      out += `  ${p.signal}: medido=${p.measured}V | esperado=${p.expLabel}\n`;
    }
  }
  if (measured.length > 0) {
    out += `\nTODOS OS PONTOS MEDIDOS:\n`;
    for (const p of measured) {
      if (p.status === 'empty') continue;
      const icon = STATUS_ICON[p.status] || p.status;
      out += `  ${p.signal} | Esp: ${p.expLabel} | Medido: ${p.measured}V | ${icon}\n`;
    }
  }
  if (ctx.guidedFlow?.length) {
    out += `\nFLUXO GUIADO:\n`;
    for (const item of ctx.guidedFlow) out += `  - ${item}\n`;
  }
  out += `\n(Pontos sem medição: ${ctx.points.filter(p=>p.status==='empty').map(p=>p.signal).join(', ') || 'nenhum'})`;
  return out;
}

export default function ChatPanel({ analyzerActive, onOpenSchematic, onDiagnosticChecklist, onActivateAnalyzer }) {
  const [expanded, setExpanded] = useState(0); // 0=normal 1=largo 2=max
  const [hidden, setHidden] = useState(false);
  const [messages, setMessages] = useState([WELCOME_MESSAGE]);
  const [chatSessionId, setChatSessionId] = useState(() => {
    try { return localStorage.getItem(ACTIVE_CHAT_SESSION_KEY) || ''; } catch { return ''; }
  });
  const [chatSessions, setChatSessions] = useState([]);
  const [forceApi, setForceApi] = useState(() => {
    try { return localStorage.getItem(FORCE_API_KEY) === '1'; } catch { return false; }
  });
  const chatSessionIdRef = useRef(chatSessionId);
  const [isLoading, setIsLoading] = useState(false);
  const bottomRef = useRef(null);
  /**
   * Guarda o último texto normal do usuário (não-comando).
   * Usado pelo comando "adicione essa informação na placa X".
   */
  const lastUserTextRef = useRef('');
  /** Guarda o último texto da IA. Usado pelo comando "addcontexto". */
  const lastAiTextRef = useRef('');
  const commandCaptureRef = useRef(null);
  const pendingSchematicRef = useRef(null);
  const pendingSchematicConfirmRef = useRef(null);
  const pendingSchematicChoicesRef = useRef([]);
  /** Mapa de aliases: { 'lc': 'listar conhecimento' } — persiste em localStorage. */
  const aliasesRef = useRef((() => {
    try { return JSON.parse(localStorage.getItem('volt_aliases') || '{}'); } catch { return {}; }
  })());

  function saveAliases() {
    localStorage.setItem('volt_aliases', JSON.stringify(aliasesRef.current));
  }

  function toggleForceApi() {
    setForceApi((current) => {
      const next = !current;
      try { localStorage.setItem(FORCE_API_KEY, next ? '1' : '0'); } catch (_) {}
      return next;
    });
  }

  function debugLog(text, level = 'log') {
    try {
      window.debugAPI?.log?.(level, `[FRONTEND LOCAL] ${text}`);
    } catch (_) {}
  }

  function pushChecklistPatch(patch) {
    try {
      onDiagnosticChecklist?.(patch);
    } catch (_) {}
  }

  function normalizeSavedMessage(msg) {
    return {
      id: msg.id,
      role: msg.role === 'user' ? 'user' : 'ai',
      text: msg.text,
      isError: msg.metadata?.isError || false,
    };
  }

  function rememberSession(sessionId) {
    if (!sessionId) return;
    chatSessionIdRef.current = sessionId;
    setChatSessionId(sessionId);
    try { localStorage.setItem(ACTIVE_CHAT_SESSION_KEY, sessionId); } catch (_) {}
  }

  async function createChatSession() {
    const res = await fetch(`${API_URL}/chat-sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Nova conversa' }),
    });
    const session = await res.json();
    if (!res.ok) throw new Error(session.error || 'Erro ao criar sessão de chat.');
    rememberSession(session.id);
    return session.id;
  }

  async function refreshChatSessions() {
    const res = await fetch(`${API_URL}/chat-sessions?limit=50`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao listar conversas.');
    setChatSessions(data);
    return data;
  }

  async function loadExistingChatSession(sessionId) {
    if (!sessionId) return;
    const res = await fetch(`${API_URL}/chat-sessions/${sessionId}`);
    const session = await res.json();
    if (!res.ok) throw new Error(session.error || 'Erro ao carregar conversa.');

    rememberSession(session.id);
    setMessages(session.messages?.length ? session.messages.map(normalizeSavedMessage) : [WELCOME_MESSAGE]);
    await refreshChatSessions();
  }

  async function persistLocalMessage(role, text, metadata = {}) {
    let sessionId = chatSessionIdRef.current;
    if (!sessionId) sessionId = await createChatSession();

    const res = await fetch(`${API_URL}/chat-sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, text, metadata }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao salvar mensagem.');
    return data;
  }

  useEffect(() => {
    let cancelled = false;

    async function loadChatSession() {
      try {
        let sessionId = chatSessionIdRef.current;
        if (!sessionId) sessionId = await createChatSession();

        const res = await fetch(`${API_URL}/chat-sessions/${sessionId}`);
        if (res.status === 404) {
          try { localStorage.removeItem(ACTIVE_CHAT_SESSION_KEY); } catch (_) {}
          chatSessionIdRef.current = '';
          const newSessionId = await createChatSession();
          if (!cancelled) rememberSession(newSessionId);
          await refreshChatSessions();
          return;
        }

        const session = await res.json();
        if (!res.ok) throw new Error(session.error || 'Erro ao carregar sessão de chat.');
        if (cancelled) return;

        rememberSession(session.id);
        setMessages(session.messages?.length ? session.messages.map(normalizeSavedMessage) : [WELCOME_MESSAGE]);
        await refreshChatSessions();
      } catch (error) {
        if (!cancelled) {
          console.warn('[Chat] Histórico indisponível:', error.message);
        }
      }
    }

    loadChatSession();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  function addAiMsg(text, isError = false) {
    if (commandCaptureRef.current) {
      commandCaptureRef.current.push({ role: 'ai', text, metadata: { isError } });
    }

    setMessages((prev) => [
      ...prev,
      { id: Date.now().toString(), role: 'ai', text, isError },
    ]);
  }

  function addSavedAiMsg(savedMessage, fallbackText, isError = false) {
    setMessages((prev) => [
      ...prev,
      savedMessage ? normalizeSavedMessage(savedMessage) : { id: Date.now().toString(), role: 'ai', text: fallbackText, isError },
    ]);
  }

  async function startNewChatSession() {
    try {
      const sessionId = await createChatSession();
      rememberSession(sessionId);
      setMessages([WELCOME_MESSAGE]);
      lastUserTextRef.current = '';
      lastAiTextRef.current = '';
      pushChecklistPatch({ reset: true });
      await refreshChatSessions();
    } catch (error) {
      addAiMsg(`⚠️ Erro ao criar nova conversa: ${error.message}`, true);
    }
  }

  // ─── Helpers de API ─────────────────────────────────────────────────────────
  async function searchBoards(query) {
    const res = await fetch(`${API_URL}/boards/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error('Erro ao buscar placas.');
    return res.json();
  }

  async function postNote(boardId, texto) {
    const res = await fetch(`${API_URL}/boards/${boardId}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texto }),
    });
    if (!res.ok) throw new Error('Erro ao salvar nota.');
    return res.json();
  }

  function looksLikeBoardModel(text) {
    const value = norm(text);
    return /\b(placa|board|mbx|la|da|quanta|compal|wistron|inventec|pegatron|6050a)\b/.test(value)
      || /\b(?:la|da|mbx)[-\s]?[a-z0-9]{2,}\b/i.test(text)
      || /\b6050a\d{3,}\b/i.test(text)
      || /^[a-z0-9][a-z0-9\s._-]{2,39}$/i.test(text.trim());
  }

  function previousAiAskedBoardModel() {
    const recentAi = [...messages].reverse().find((msg) => msg.role === 'ai');
    if (!recentAi) return false;
    const value = norm(recentAi.text || '');
    return value.includes('modelo da placa')
      || value.includes('codigo/modelo da placa')
      || value.includes('codigo da placa')
      || value.includes('procuro esquema');
  }

  function extractBoardQuery(text) {
    return text
      .replace(/^(?:a\s+)?placa\s+/i, '')
      .replace(/^modelo\s+(?:da\s+placa\s+)?/i, '')
      .replace(/^codigo\s+(?:da\s+placa\s+)?/i, '')
      .trim();
  }

  function extractExplicitBoardModel(text) {
    const value = String(text || '');
    const directCode = value.match(/\b(?:placa|board|modelo|codigo|c[oó]digo)\s+((?:la|da|mbx|nm|ba|6050a|71r|ba41|da0)[\s._-]?[a-z0-9]{3,10}(?:[\s._-]?[a-z0-9]{1,4})?)\b/i);
    if (directCode) return directCode[1].trim();

    const code = value.match(/\b((?:la|da|mbx|nm|ba|6050a|71r|ba41|da0)[\s._-]?[a-z0-9]{3,10}(?:[\s._-]?[a-z0-9]{1,4})?)\b/i);
    if (code) {
      const candidate = code[1].trim();
      const tail = candidate.split(/[\s._-]+/).slice(-1)[0]?.toLowerCase();
      if (tail && (BOARD_QUERY_STOPWORDS.has(tail) || tail.length === 1)) {
        return candidate.replace(new RegExp(`[\\s._-]+${tail}$`, 'i'), '').trim();
      }
      return candidate;
    }

    return '';
  }

  function normalizeBoardQuery(text) {
    return norm(extractBoardQuery(text))
      .replace(/[\s._-]+/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => BOARD_QUERY_FIXES[word] || word)
      .join(' ');
  }

  function tokenSimilarity(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.length >= 3 && b.includes(a)) return 0.82;
    if (b.length >= 3 && a.includes(b)) return 0.78;

    const maxLen = Math.max(a.length, b.length);
    if (maxLen > 12) return 0;
    const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
    for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
    for (let i = 1; i <= a.length; i += 1) {
      for (let j = 1; j <= b.length; j += 1) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      }
    }
    return 1 - (dp[a.length][b.length] / maxLen);
  }

  function scoreSchematicLabel(query, label) {
    const normalizedQuery = normalizeBoardQuery(query);
    const queryTokens = normalizedQuery.split(/\s+/).filter((word) => word.length >= 2);
    if (queryTokens.length === 0) return 0;
    const labelNorm = norm(label);
    const labelCompact = labelNorm.replace(/[\s._-]+/g, '');
    const labelTokens = labelNorm.split(/[\s._-]+/).filter(Boolean);
    const queryCompact = queryTokens.join('');
    const queryCollapsed = normalizedQuery.replace(/\s+/g, '');
    const queryBoardCodes = extractBoardCodeCandidates(query);
    const labelBoardCodes = extractBoardCodeCandidates(label);
    const queryProductModels = extractProductModelCandidates(query);
    const labelProductModels = extractProductModelCandidates(label);

    let score = labelCompact.includes(queryCompact) || labelCompact.includes(queryCollapsed) ? 8 : 0;

    if (queryBoardCodes.length > 0) {
      const hasStrictBoardCodeMatch = queryBoardCodes.some((code) => labelBoardCodes.includes(code) || labelCompact.includes(code));
      if (!hasStrictBoardCodeMatch) return 0;
    }

    for (const code of queryBoardCodes) {
      if (labelBoardCodes.includes(code)) score += 12;
      else if (labelCompact.includes(code)) score += 8;
    }

    for (const model of queryProductModels) {
      if (labelProductModels.includes(model)) score += 4.5;
      else if (labelCompact.includes(model)) score += 2.5;
    }

    for (const q of queryTokens) {
      let best = labelCompact.includes(q) ? 2.5 : 0;
      for (const token of labelTokens) {
        const sim = tokenSimilarity(q, token);
        if (sim >= 0.72) best = Math.max(best, sim * 3);
      }
      score += best;
    }

    if (queryTokens.length >= 2) {
      const adjacentPairs = [];
      for (let index = 0; index < queryTokens.length - 1; index += 1) {
        adjacentPairs.push(`${queryTokens[index]}${queryTokens[index + 1]}`);
      }
      for (const pair of adjacentPairs) {
        if (pair.length >= 5 && labelCompact.includes(pair)) score += 3.2;
      }
    }

    for (const noisyTerm of SCHEMATIC_PENALTY_TERMS) {
      if (labelNorm.includes(noisyTerm)) score -= 1.8;
    }

    if (/esquema\s*\[/.test(labelNorm) || /diagramas\.com\.br/.test(labelNorm)) score -= 0.8;
    if (/boardview\.pdf/.test(labelNorm)) score -= 0.5;

    return score;
  }

  function shouldTrySchematicLookup(text) {
    const explicitBoard = extractExplicitBoardModel(text);
    const normalized = normalizeBoardQuery(text);
    const words = normalized.split(/\s+/).filter(Boolean);
    if (isUnknownBoardModelText(text)) return false;
    if (explicitBoard) return true;
    if (words.length === 0 || words.length > 5) return false;
    if (/^(sim|nao|não|ok|oi|ola|obrigado|valeu|ajuda|comandos|analisar|analise|análise)$/i.test(normalized)) return false;
    return looksLikeBoardModel(text) || words.some((word) => /\d/.test(word));
  }

  function isUnknownBoardModelText(text) {
    const value = norm(text);
    return /\b(nao sei|não sei|nao tenho|não tenho|desconheco|desconheço|sem modelo|nao identifiquei|não identifiquei)\b/.test(value)
      && /\b(modelo|codigo|código|placa|board)\b/.test(value);
  }

  function buildUnknownBoardTriageResponse() {
    return [
      'Sem problema. Vou iniciar uma triagem geral sem modelo de placa, sem chamar API.',
      '',
      'Primeiro defina o sintoma principal no fluxo guiado:',
      '1. Não liga',
      '2. Liga sem vídeo',
      '3. Outro fluxo',
      '',
      'Se for não liga, comece pela entrada: confirme se chega tensão no DC jack, depois veja se passa para o shunt e se existe curto na linha principal.',
    ].join('\n');
  }

  function hasTechnicalSymptom(text) {
    return /\b(nao liga|não liga|curto|sem imagem|fonte desarma|desarma a fonte|sem tensao|sem tensão|19v|dcin|vin|mosfet|shunt|charger|aquece)\b/i.test(norm(text));
  }

  function formatChecklistModel(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
  }

  function buildChecklistPatchFromText(text) {
    const normalized = norm(text);
    const boardModel = formatChecklistModel(extractExplicitBoardModel(text));
    const deviceModel = formatChecklistModel(extractProductModelCandidates(text)[0] || '');
    const noPower = /\b(nao liga|não liga|sem ligar|morto|sem start)\b/.test(normalized);
    const adapterDisarms = /\b(desarma a fonte|fonte desarma|desarma fonte)\b/.test(normalized);
    const shortInput = /\bcurto\b/.test(normalized) || adapterDisarms;
    const findings = [];
    const steps = {};

    if (boardModel) {
      steps.boardIdentified = 'done';
      findings.push(`Placa ${boardModel}`);
    }
    if (deviceModel && deviceModel !== boardModel) findings.push(`Modelo ${deviceModel}`);
    if (noPower) {
      steps.noPower = 'done';
      steps.check19v = 'current';
      findings.push('Sintoma: não liga');
    }
    if (adapterDisarms) {
      steps.adapterDisarms = 'done';
      steps.shortInput = 'done';
      steps.check19v = 'current';
      steps.checkDcin = 'pending';
      steps.checkInputMosfets = 'pending';
      findings.push('Fonte desarma ao conectar');
    } else if (shortInput) {
      steps.shortInput = 'done';
      steps.check19v = steps.check19v || 'current';
      steps.checkDcin = 'pending';
      steps.checkInputMosfets = 'pending';
      findings.push('Suspeita de curto');
    }

    const activate = Boolean(boardModel || deviceModel || noPower || adapterDisarms || shortInput);
    if (!activate) return null;

    return {
      activate: true,
      boardModel,
      deviceModel,
      symptom: noPower ? 'Não liga' : '',
      sourceBehavior: adapterDisarms ? 'Fonte desarma ao plugar' : '',
      summary: boardModel ? `Triagem iniciada para ${boardModel}` : 'Triagem iniciada pelo chat',
      findings,
      steps,
    };
  }

  function fileBaseName(filePathOrLabel) {
    return String(filePathOrLabel || '').split(/[\\/]/).pop() || '';
  }

  function schematicPreviewKind(match) {
    const name = fileBaseName(match.path || match.label || match.schematicName);
    const ext = name.split('.').pop()?.toLowerCase() || '';
    if (ext === 'pdf') return 'pdf';
    if (['jpg', 'jpeg', 'png', 'bmp', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
    return 'external';
  }

  function assetKindLabel(match) {
    const name = `${match.label || ''} ${match.path || ''}`.toLowerCase();
    const ext = fileBaseName(match.path || match.label).split('.').pop()?.toLowerCase() || '';
    if (ext === 'pdf') return 'esquema elétrico';
    if (['jpg', 'jpeg', 'png', 'bmp', 'gif', 'webp', 'svg'].includes(ext)) return 'imagem do esquema';
    if (['bdv', 'brd', 'obd', 'obdlocal', 'fz', 'cad', 'sqlite', 'sqlite3'].includes(ext) || name.includes('boardview') || name.includes('borderview')) {
      return 'boardview';
    }
    return 'arquivo técnico';
  }

  async function searchSchematicFiles(query) {
    if (!window.electronAPI?.scanSchematics) return [];
    const files = await window.electronAPI.scanSchematics();
    return files
      .map((file) => ({
        file,
        score: scoreSchematicLabel(query, `${file.label || ''} ${file.path || ''}`),
      }))
      .filter((item) => item.score >= 4.5)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map(({ file, score }) => ({
        source: 'file',
        title: fileBaseName(file.label || file.path),
        label: file.label,
        path: file.path,
        score,
      }));
  }

  async function findBoardAndSchematics(query) {
    const boards = await searchBoards(query).catch(() => []);
    const boardMatches = boards
      .filter((board) => board.schematicPath || board.schematicName)
      .map((board) => ({
        source: 'board',
        boardId: board.id,
        title: `${board.marca} ${board.modelo}`,
        label: board.schematicName || fileBaseName(board.schematicPath),
        path: board.schematicPath,
        board,
        score: 100,
      }));

    const fileMatches = await searchSchematicFiles(query);
    const seen = new Set();
    return [...boardMatches, ...fileMatches].filter((match) => {
      const key = norm(match.path || `${match.title} ${match.label}`);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function describeSchematicMatch(match) {
    const origin = match.source === 'board' ? 'banco da placa' : 'pasta Schematic';
    const label = match.label || fileBaseName(match.path) || match.title;
    return `${match.title || label} — ${label} (${origin})`;
  }

  function schematicChecklistPatch(match, matches = []) {
    const options = [match, ...matches].filter(Boolean);
    const pdfMatch = options.find((item) => schematicPreviewKind(item) === 'pdf');
    return {
      matchedSchematic: match.title || match.label || fileBaseName(match.path),
      matchedSchematicPath: match.path || '',
      matchedSchematicKind: schematicPreviewKind(match),
      analysisSchematicPath: pdfMatch?.path || '',
      analysisSchematicLabel: pdfMatch ? (pdfMatch.title || pdfMatch.label || fileBaseName(pdfMatch.path)) : '',
      schematicStatus: 'found',
    };
  }

  function highlightedMatch(match) {
    return `[[blue:${match.title || match.label || fileBaseName(match.path)}]] — ${assetKindLabel(match)}`;
  }

  function formatSchematicChoices(query, matches, exact = false) {
    const [best, ...others] = matches;
    const lines = [];
    if (exact) {
      lines.push(`Encontrei um resultado para "${query}":`);
    } else {
      lines.push(`Encontrei um modelo mais parecido com o que você pediu:`);
    }
    lines.push(`1. ${highlightedMatch(best)}`);

    if (others.length > 0) {
      lines.push('');
      lines.push(`Também achei estes outros:`);
      others.slice(0, 5).forEach((match, index) => {
        lines.push(`${index + 2}. ${highlightedMatch(match)}`);
      });
    }

    lines.push('');
    lines.push('Digite o número ou parte do modelo para escolher.');
    return lines.join('\n');
  }

  function chooseSchematicFromText(text) {
    const choices = pendingSchematicChoicesRef.current || [];
    if (choices.length === 0) return null;
    const clean = norm(text);
    const index = Number.parseInt(clean, 10);
    if (Number.isInteger(index) && index >= 1 && index <= choices.length) return choices[index - 1];

    const scored = choices
      .map((choice) => ({
        choice,
        score: scoreSchematicLabel(text, `${choice.title || ''} ${choice.label || ''} ${choice.path || ''}`),
      }))
      .sort((a, b) => b.score - a.score);
    return scored[0]?.score >= 4 ? scored[0].choice : null;
  }

  async function openPendingSchematic() {
    const match = pendingSchematicRef.current;
    if (!match) return false;

    const kind = schematicPreviewKind(match);
    debugLog(`[SCHEMATIC] Abrindo esquema | tipo=${kind} | arquivo="${match.label || match.path || match.title}"`);
    if ((kind === 'pdf' || kind === 'image') && onOpenSchematic) {
      onOpenSchematic({ ...match, kind });
      pushChecklistPatch({
        activate: true,
        ...schematicChecklistPatch(match, pendingSchematicChoicesRef.current),
        steps: {
        },
      });
      addAiMsg(`✅ Abrindo esquema no painel central:\n${describeSchematicMatch(match)}`);
    } else if (window.electronAPI?.openPath && match.path) {
      await window.electronAPI.openPath(match.path);
      pushChecklistPatch({
        activate: true,
        ...schematicChecklistPatch(match, pendingSchematicChoicesRef.current),
        steps: {
        },
      });
      addAiMsg(`✅ Esse tipo de arquivo abre fora do painel. Abrindo no programa padrão:\n${describeSchematicMatch(match)}`);
    } else {
      addAiMsg('⚠️ Encontrei o esquema, mas não consegui abrir o arquivo neste ambiente.', true);
    }
    pendingSchematicRef.current = null;
    return true;
  }

  function confirmPendingSchematicSuggestion() {
    const match = pendingSchematicConfirmRef.current;
    if (!match) return false;
    debugLog(`[SCHEMATIC] Usuario confirmou sugestao fuzzy | escolhido="${match.label || match.title}" | score=${match.score ?? '-'}`);
    pendingSchematicRef.current = match;
    pendingSchematicConfirmRef.current = null;
    addAiMsg(`Sim, encontrei esse esquema:\n${describeSchematicMatch(match)}\n\nQuer que eu abra no painel de análise? Responda "sim" ou "abrir".`);
    return true;
  }

  function selectSchematicChoice(match) {
    pendingSchematicChoicesRef.current = [];
    pendingSchematicConfirmRef.current = null;
    pendingSchematicRef.current = match;
    debugLog(`[SCHEMATIC] Usuario escolheu resultado | escolhido="${match.label || match.title}"`);
    addAiMsg(`Beleza, vou usar:\n${highlightedMatch(match)}\n\nQuer abrir esse ${assetKindLabel(match)} no painel de análise? Responda "sim" ou "abrir".`);
    return true;
  }

  async function handleBoardModelLookup(text) {
    const query = extractBoardQuery(text);
    if (!query || query.length < 2) return false;

    pushChecklistPatch({
      activate: true,
      boardModel: formatChecklistModel(extractExplicitBoardModel(text)),
      deviceModel: formatChecklistModel(extractProductModelCandidates(text)[0] || query),
      summary: `Buscando esquema para ${query}`,
      schematicStatus: '',
      steps: {
        ...(extractExplicitBoardModel(text) ? { boardIdentified: 'done' } : {}),
      },
    });

    debugLog(`[SCHEMATIC] Busca local/fuzzy iniciada | query="${query}" | normalizada="${normalizeBoardQuery(query)}"`);
    const matches = await findBoardAndSchematics(query);
    if (matches.length === 0) {
      debugLog(`[SCHEMATIC] Nenhum esquema encontrado | query="${query}"`, 'warn');
      pushChecklistPatch({
        activate: true,
        summary: `Nenhum esquema encontrado para ${query}`,
        schematicStatus: 'missing',
      });
      addAiMsg(
        `Não encontrei placa/esquema para "${query}" no banco nem na pasta Schematic.\n` +
        'Pode conferir o código da placa ou cadastrar/vincular o esquema em Armazenar Placa.'
      );
      return false;
    }

    const best = matches[0];
    pushChecklistPatch({
      activate: true,
      ...schematicChecklistPatch(best, matches),
      summary: `Esquema localizado para ${query}`,
      steps: {},
    });
    debugLog(`[SCHEMATIC] Melhor resultado | query="${query}" | score=${best.score ?? '-'} | resultado="${best.label || best.title}" | total=${matches.length}`);
    const cleanedQuery = norm(extractBoardQuery(query));
    const correctedQuery = normalizeBoardQuery(query);
    const wasCorrected = cleanedQuery !== correctedQuery;
    const isExact = !wasCorrected && (
      best.source === 'board' || best.score >= 8 || norm(describeSchematicMatch(best)).includes(correctedQuery)
    );
    if (!isExact) {
      pendingSchematicConfirmRef.current = best;
      pendingSchematicChoicesRef.current = matches;
      debugLog(`[SCHEMATIC] Resultado aproximado, aguardando confirmacao do usuario | query="${query}"`);
      addAiMsg(formatSchematicChoices(query, matches, false));
      return true;
    }

    pendingSchematicRef.current = best;
    pendingSchematicChoicesRef.current = matches;
    debugLog(`[SCHEMATIC] Esquema encontrado, aguardando comando para abrir | query="${query}"`);
    addAiMsg(`${formatSchematicChoices(query, matches, true)}\n\nSe for o primeiro, responda "sim" ou "abrir".`);
    return true;
  }

  // ─── Resolve busca de placa + executa callback ─────────────────────────────
  async function withBoard(modelQuery, callback) {
    const boards = await searchBoards(modelQuery);
    if (boards.length === 0) {
      addAiMsg(
        `⚠️ Nenhuma placa encontrada com "${modelQuery}".\n` +
        `Verifique o modelo ou cadastre a placa primeiro.`,
        true
      );
    } else if (boards.length === 1) {
      await callback(boards[0]);
    } else {
      addAiMsg(
        `Encontrei ${boards.length} placas com "${modelQuery}". Qual delas?\n\n` +
        boards.map((b, i) => `${i + 1}. ${b.marca} ${b.modelo}`).join('\n') +
        '\n\nUse o modelo completo: adicionar na placa <modelo exato>: <informação>'
      );
    }
  }

  // ─── Comandos ───────────────────────────────────────────────────────────────
  async function handleCommand(text) {
    let lower = norm(text);

    if (isUnknownBoardModelText(text)) {
      pendingSchematicRef.current = null;
      pendingSchematicConfirmRef.current = null;
      pendingSchematicChoicesRef.current = [];
      debugLog('[TRIAGEM] Usuario informou que nao sabe o modelo da placa | iniciando checklist geral sem API');
      pushChecklistPatch({
        activate: true,
        boardModel: '',
        deviceModel: '',
        symptom: '',
        sourceBehavior: '',
        schematicStatus: 'missing',
        summary: 'Triagem geral iniciada sem modelo de placa',
        findings: ['Modelo da placa desconhecido', 'Triagem geral iniciada'],
        steps: { genericTriage: 'current' },
      });
      onActivateAnalyzer?.();
      addAiMsg(buildUnknownBoardTriageResponse());
      return true;
    }

    if (/^(analisar|analise|análise)$/.test(lower)) {
      addAiMsg(
        'Beleza. Para iniciar a análise eu preciso primeiro do código/modelo da placa e do sintoma principal.\n\n' +
        'Exemplos:\n' +
        '• "placa la-6901p nao liga"\n' +
        '• "acer a515 liga sem video"\n\n' +
        'Depois disso eu abro o checklist com perguntas Sim/Não. Se já tiver medições no mapa técnico, use "analisar circuito".'
      );
      return true;
    }

    if (pendingSchematicChoicesRef.current.length > 0 && !/^(sim|s|isso|esse|correto|ok|pode ser|abrir|abre)$/i.test(lower)) {
      const choice = chooseSchematicFromText(text);
      if (choice) return selectSchematicChoice(choice);
    }

    if (pendingSchematicConfirmRef.current && /^(sim|s|isso|esse|correto|ok|pode ser)$/i.test(lower)) {
      return selectSchematicChoice(pendingSchematicConfirmRef.current);
    }

    if (pendingSchematicConfirmRef.current && /^(nao|não|n|outro|cancelar|cancela)$/i.test(lower)) {
      pendingSchematicConfirmRef.current = null;
      pendingSchematicChoicesRef.current = [];
      debugLog('[SCHEMATIC] Usuario recusou sugestao fuzzy');
      addAiMsg('Beleza. Me informe o modelo mais completo da placa ou do notebook.');
      return true;
    }

    if (pendingSchematicRef.current && /^(sim|s|abrir|abre|pode abrir|quero|ok|isso|esse)$/i.test(lower)) {
      await openPendingSchematic();
      pendingSchematicChoicesRef.current = [];
      return true;
    }

    if (pendingSchematicRef.current && /^(nao|não|n|agora nao|agora não|cancelar|cancela)$/i.test(lower)) {
      pendingSchematicRef.current = null;
      pendingSchematicChoicesRef.current = [];
      debugLog('[SCHEMATIC] Usuario cancelou abertura do esquema');
      addAiMsg('Beleza, não vou abrir agora. Seguimos pela triagem.');
      return true;
    }

    if ((previousAiAskedBoardModel() && looksLikeBoardModel(text)) || /^buscar\s+esquema\s+/i.test(text) || /^abrir\s+esquema\s+/i.test(text) || shouldTrySchematicLookup(text)) {
      const query = text.replace(/^buscar\s+esquema\s+/i, '').replace(/^abrir\s+esquema\s+/i, '').trim();
      const lookupOnly = /^buscar\s+esquema\s+/i.test(text) || /^abrir\s+esquema\s+/i.test(text) || !hasTechnicalSymptom(text);
      const lookupResult = await handleBoardModelLookup(extractExplicitBoardModel(query || text) || query || text);
      return lookupOnly ? lookupResult : false;
    }

    // ── resolução de alias ──────────────────────────────────────────────────
    // Verifica se a mensagem inteira ou a primeira palavra é um alias definido.
    const resolvedAlias = aliasesRef.current[lower];
    if (resolvedAlias) {
      lower = norm(resolvedAlias);
      text = resolvedAlias;
    }

    // ── salvamento automático por linguagem natural ────────────────────────
    if (/\b(salve|salvar|guarde|guardar|armazene|armazenar|registre|registrar|lembre|memorize)\b/i.test(text)) {
      try {
        const res = await fetch(`${API_URL}/memory/auto-save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erro ao salvar memória.');
        addAiMsg(`✅ ${data.message}`);
      } catch (e) {
        addAiMsg(`⚠️ Erro ao salvar automaticamente: ${e.message}`, true);
      }
      return true;
    }

    // ── associar <alias> a <comando> ────────────────────────────────────────
    const assocMatch = text.match(/^associar\s+(.+?)\s+a[o]?\s+(.+)/i);
    if (assocMatch) {
      const alias = norm(assocMatch[1].trim());
      const target = assocMatch[2].trim();
      if (!alias || !target) {
        addAiMsg('⚠️ Use: associar <alias> ao <comando>\nEx: associar comman ao comando', true);
        return true;
      }
      aliasesRef.current[alias] = target;
      saveAliases();
      addAiMsg(`✅ Alias criado! "${alias}" agora executa "${target}".`);
      return true;
    }

    // ── listar aliases ──────────────────────────────────────────────────────
    if (lower === 'listar aliases' || lower === 'listar alias') {
      const entries = Object.entries(aliasesRef.current);
      if (entries.length === 0) {
        addAiMsg('Nenhum alias cadastrado ainda.\nUse: associar <alias> ao <comando>');
      } else {
        addAiMsg(
          `🔗 ${entries.length} alias(es) cadastrado(s):\n\n` +
          entries.map(([k, v]) => `  "${k}"  →  "${v}"`).join('\n')
        );
      }
      return true;
    }

    // ── apagar alias: <alias> ───────────────────────────────────────────────
    if (lower.startsWith('apagar alias:')) {
      const alias = norm(text.slice('apagar alias:'.length).trim());
      if (!aliasesRef.current[alias]) {
        addAiMsg(`⚠️ Alias "${alias}" não encontrado. Use "listar aliases" para ver os existentes.`, true);
      } else {
        delete aliasesRef.current[alias];
        saveAliases();
        addAiMsg(`🗑️ Alias "${alias}" removido.`);
      }
      return true;
    }

    // ── adicionar checklist ─────────────────────────────────────────────────
    // Formato A: adicionar checklist: <problema> | <p1>, <p2>
    // Formato B: adicionar a informações básicas <problema> = checklist <p1>, <p2>
    const checklistAddMatch = text.match(
      /^adicionar\s+(?:checklist:\s*|a\s+informa[çc][oõo]es\s+b[áa]sicas?\s*|info\s+b[áa]sica:\s*)(.*)/is
    );
    if (checklistAddMatch) {
      const body = checklistAddMatch[1].trim();
      let problema = '';
      let stepsRaw = '';

      const eqIdx = body.indexOf('=');
      const pipIdx = body.indexOf('|');

      if (eqIdx !== -1 && (pipIdx === -1 || eqIdx < pipIdx)) {
        problema = body.slice(0, eqIdx).trim();
        stepsRaw = body.slice(eqIdx + 1).replace(/^\s*checklist\s*/i, '').trim();
      } else if (pipIdx !== -1) {
        problema = body.slice(0, pipIdx).trim();
        stepsRaw = body.slice(pipIdx + 1).trim();
      } else {
        addAiMsg(
          '⚠️ Use um dos formatos:\n' +
          'adicionar checklist: <problema> | <passo1>, <passo2>\n' +
          'adicionar a informações básicas <problema> = checklist <passo1>, <passo2>',
          true
        );
        return true;
      }

      if (!problema) { addAiMsg('⚠️ Informe o nome do problema.', true); return true; }
      const checklist = stepsRaw.split(',').map(s => s.trim()).filter(Boolean);
      if (checklist.length === 0) { addAiMsg('⚠️ Informe ao menos um passo.', true); return true; }

      try {
        const res = await fetch(`${API_URL}/checklist`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ problema, checklist }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        addAiMsg(
          `✅ Checklist adicionado!\n\n📋 ${data.problema}\n` +
          data.checklist.map((s, i) => `  ${i + 1}. ${s}`).join('\n') +
          `\n\nID: ${data.id}`
        );
      } catch (e) { addAiMsg(`⚠️ Erro: ${e.message}`, true); }
      return true;
    }

    // ── listar checklist ────────────────────────────────────────────────────
    if (lower === 'listar checklist') {
      try {
        const data = await fetch(`${API_URL}/checklist`).then(r => r.json());
        if (data.length === 0) { addAiMsg('Nenhum checklist cadastrado ainda.'); return true; }
        addAiMsg(
          `📋 ${data.length} checklist(s):\n\n` +
          data.map((item, i) =>
            `${i + 1}. ${item.problema}\n` +
            item.checklist.map((s, j) => `   ${j + 1}. ${s}`).join('\n') +
            `\n   ID: ${item.id}`
          ).join('\n\n')
        );
      } catch (e) { addAiMsg(`⚠️ Erro: ${e.message}`, true); }
      return true;
    }

    // ── apagar checklist: <id> ──────────────────────────────────────────────
    if (lower.startsWith('apagar checklist:')) {
      const id = text.slice('apagar checklist:'.length).trim();
      try {
        const res = await fetch(`${API_URL}/checklist/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('ID não encontrado. Use "listar checklist".');
        addAiMsg('🗑️ Checklist removido.');
      } catch (e) { addAiMsg(`⚠️ Erro: ${e.message}`, true); }
      return true;
    }

    // ── adicionar na placa <modelo>: <informação> ───────────────────────────
    const notaDirectMatch = text.match(/^adicionar\s+(?:na\s+)?placa\s+(.+?):\s*(.+)/is);
    if (notaDirectMatch) {
      const modelQuery = notaDirectMatch[1].trim();
      const info = notaDirectMatch[2].trim();
      try {
        await withBoard(modelQuery, async (board) => {
          await postNote(board.id, info);
          addAiMsg(`✅ Nota adicionada à placa ${board.marca} ${board.modelo}:\n"${info}"`);
        });
      } catch (e) { addAiMsg(`⚠️ Erro: ${e.message}`, true); }
      return true;
    }

    // ── adicione essa informação na placa <modelo> ──────────────────────────
    // Usa lastUserTextRef como conteúdo da nota
    const addThisMatch = text.match(
      /adicione?\s+(?:essa|esta|a)\s+informa[çc][aã]o\s+(?:na\s+|à\s+|a\s+)?placa\s+(.+)/i
    );
    if (addThisMatch) {
      const modelQuery = addThisMatch[1].trim();
      const info = lastUserTextRef.current;
      if (!info) {
        addAiMsg('⚠️ Não encontrei uma mensagem anterior para usar. Escreva a informação antes de dar esse comando.', true);
        return true;
      }
      try {
        await withBoard(modelQuery, async (board) => {
          await postNote(board.id, info);
          addAiMsg(`✅ Informação adicionada à placa ${board.marca} ${board.modelo}:\n"${info}"`);
        });
      } catch (e) { addAiMsg(`⚠️ Erro: ${e.message}`, true); }
      return true;
    }

    // ── adicionar em informações gerais: <fato> ─────────────────────────────
    // Também detecta: "<fato> adicionar em informações gerais de eletrônica"
    const geraisPrefix = text.match(
      /^adicionar\s+em\s+informa[çc][oõo]es\s+gerais(?:\s+de\s+eletr[oô]nica)?:\s*(.*)/is
    );
    const geraisSuffix = text.match(
      /^(.+?)\s+adicionar\s+em\s+informa[çc][oõo]es\s+gerais(?:\s+de\s+eletr[oô]nica)?$/is
    );
    const geraisFact = geraisPrefix ? geraisPrefix[1].trim()
      : geraisSuffix ? geraisSuffix[1].trim()
        : null;

    if (geraisFact !== null) {
      if (!geraisFact) { addAiMsg('⚠️ Informe o fato a salvar.', true); return true; }
      try {
        const res = await fetch(`${API_URL}/knowledge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: geraisFact }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        addAiMsg(`✅ Salvo em informações gerais de eletrônica!\n"${data.text}"`);
      } catch (e) { addAiMsg(`⚠️ Erro: ${e.message}`, true); }
      return true;
    }

    // ── add conhecimento | categoria | titulo | conteudo ────────────────────
    // Formato estruturado profissional
    const addKnMatch = text.match(/^add\s+conhecimento\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+)/i);
    if (addKnMatch) {
      const [, categoria, titulo, conteudo] = addKnMatch;
      try {
        const res = await fetch(`${API_URL}/knowledge/structured`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ categoria: categoria.trim(), titulo: titulo.trim(), conteudo: conteudo.trim() }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        addAiMsg(
          `✅ Conhecimento estruturado salvo!\n` +
          `📂 Categoria: ${data.categoria}\n` +
          `📌 Título: ${data.titulo}\n` +
          `📝 Conteúdo: ${data.conteudo}\n` +
          `🏷️ Tags: ${data.tags.join(', ')}`
        );
      } catch (e) { addAiMsg(`⚠️ Erro: ${e.message}`, true); }
      return true;
    }

    // ── resolver | id | solucao ──────────────────────────────────────────────
    // Registra a solução confirmada em uma entrada existente
    const resolverMatch = text.match(/^resolver\s*\|\s*(\S+)\s*\|\s*(.+)/i);
    if (resolverMatch) {
      const [, id, solucao] = resolverMatch;
      try {
        const res = await fetch(`${API_URL}/knowledge/${id}/solucao`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ solucao: solucao.trim() }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        addAiMsg(`✅ Solução registrada!\n"${solucao.trim()}" → salva na entrada ${id}.`);
      } catch (e) { addAiMsg(`⚠️ Erro: ${e.message}`, true); }
      return true;
    }

    // ── buscar conhecimento | query ──────────────────────────────────────────
    const buscarMatch = text.match(/^buscar\s+conhecimento\s*\|\s*(.+)/i)
      || (lower.startsWith('buscar conhecimento ') ? [null, text.slice('buscar conhecimento '.length)] : null);
    if (buscarMatch) {
      const query = buscarMatch[1].trim();
      try {
        const data = await fetch(`${API_URL}/knowledge/search?q=${encodeURIComponent(query)}`).then(r => r.json());
        if (data.length === 0) {
          addAiMsg(`Nenhum resultado para "${query}".`);
        } else {
          addAiMsg(
            `🔍 ${data.length} resultado(s) para "${query}":\n\n` +
            data.map((e, i) => {
              if (e.categoria) {
                const sol = e.solucoes?.length > 0 ? `\n   ✅ Solução: ${e.solucoes[e.solucoes.length - 1].solucao}` : '';
                return `${i + 1}. [${e.categoria}/${e.titulo}] ${e.conteudo}${sol}\n   ID: ${e.id}`;
              }
              return `${i + 1}. ${e.text}\n   ID: ${e.id}`;
            }).join('\n\n')
          );
        }
      } catch (e) { addAiMsg(`⚠️ Erro: ${e.message}`, true); }
      return true;
    }

    // ── del conhecimento | id ────────────────────────────────────────────────
    const delKnMatch = text.match(/^del\s+conhecimento\s*\|\s*(\S+)/i);
    if (delKnMatch) {
      const id = delKnMatch[1].trim();
      try {
        const res = await fetch(`${API_URL}/knowledge/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('ID não encontrado. Use "listar conhecimento".');
        addAiMsg(`🗑️ Entrada ${id} removida.`);
      } catch (e) { addAiMsg(`⚠️ Erro: ${e.message}`, true); }
      return true;
    }

    // ── armazenar: <fato> (legado) ──────────────────────────────────────────
    if (lower.startsWith('armazenar:')) {
      const fact = text.slice('armazenar:'.length).trim();
      if (!fact) { addAiMsg('⚠️ Use: armazenar: <texto>', true); return true; }
      try {
        const res = await fetch(`${API_URL}/knowledge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: fact }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        addAiMsg(`✅ Conhecimento salvo!\n"${data.text}"`);
      } catch (e) { addAiMsg(`⚠️ Erro: ${e.message}`, true); }
      return true;
    }

    // ── listar conhecimento ─────────────────────────────────────────────────
    if (lower === 'listar conhecimento' || lower === 'listar:') {
      try {
        const data = await fetch(`${API_URL}/knowledge`).then(r => r.json());
        addAiMsg(
          data.length === 0
            ? 'Nenhum conhecimento armazenado ainda.'
            : `📚 ${data.length} entrada(s):\n\n` +
            data.map((e, i) => `${i + 1}. ${e.text}\n   ID: ${e.id}`).join('\n\n')
        );
      } catch (e) { addAiMsg(`⚠️ Erro: ${e.message}`, true); }
      return true;
    }

    // ── apagar: <id> ────────────────────────────────────────────────────────
    if (lower.startsWith('apagar:')) {
      const id = text.slice('apagar:'.length).trim();
      try {
        const res = await fetch(`${API_URL}/knowledge/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('ID não encontrado. Use "listar conhecimento".');
        addAiMsg('🗑️ Entrada removida.');
      } catch (e) { addAiMsg(`⚠️ Erro: ${e.message}`, true); }
      return true;
    }

    // ── addcontexto ─────────────────────────────────────────────────────────
    // addcontexto: <fato>  → salva fato diretamente
    // addcontexto          → salva última resposta da IA
    if (lower.startsWith('addcontexto:') || lower === 'addcontexto') {
      const fact = lower.startsWith('addcontexto:')
        ? text.slice('addcontexto:'.length).trim()
        : lastAiTextRef.current;
      if (!fact) {
        addAiMsg(
          '⚠️ Use: addcontexto: <informação>\n' +
          'Ou só "addcontexto" para salvar minha última resposta.',
          true
        );
        return true;
      }
      try {
        const res = await fetch(`${API_URL}/knowledge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: fact }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        addAiMsg(`✅ Contexto salvo! Vou lembrar disso nas próximas perguntas.\n"${data.text}"`);
      } catch (e) { addAiMsg(`⚠️ Erro: ${e.message}`, true); }
      return true;
    }

    // ── analisar circuito ────────────────────────────────────────────────────
    if (lower === 'analisar circuito' || lower === 'analise circuito' || lower === 'analisar medições' || lower === 'analisar medicoes') {
      const ctx = buildAnalyzerContext();
      if (!ctx) {
        addAiMsg(
          'Ainda não há medições no mapa técnico.\n\n' +
          'Se quiser triagem inicial, me passe o modelo da placa e o sintoma.\n' +
          'Se quiser análise de medições, abra o mapa técnico, preencha as tensões e envie "analisar circuito" novamente.'
        );
        return true;
      }
      setIsLoading(true);
      try {
        const res = await fetch(`${API_URL}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: 'Com base nas medições do analisador de circuito abaixo, identifique os pontos com falha, possíveis causas e próximos passos de diagnóstico para o técnico de bancada:',
            analyzerContext: ctx,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erro desconhecido.');
        lastAiTextRef.current = data.response;
        addAiMsg(data.response);
      } catch (e) {
        addAiMsg(`⚠️ ${e.message}`, true);
      } finally {
        setIsLoading(false);
      }
      return true;
    }

    // ── ajuda ───────────────────────────────────────────────────────────────
    // ajuda          → lista os tópicos
    // ajuda <tópico> → detalha comandos do tópico
    if (['ajuda', 'comandos', 'comando', 'command', 'commands', 'help'].includes(lower)) {
      addAiMsg(
        '🛠️ Olá! Selecione um tópico para ver os comandos disponíveis:\n\n' +
        '  1️⃣  ajuda checklists    — criar e gerenciar checklists de diagnóstico\n' +
        '  2️⃣  ajuda placas        — adicionar notas e informações em placas\n' +
        '  3️⃣  ajuda conhecimento  — salvar e buscar conhecimento estruturado\n' +
        '  4️⃣  ajuda automatico    — como funciona o modo automático da IA\n' +
        '  5️⃣  ajuda aliases       — criar atalhos personalizados para comandos\n\n' +
        'Digite "ajuda <tópico>" para ver os comandos detalhados.\n' +
        'Ex: ajuda conhecimento'
      );
      return true;
    }

    if (lower === 'ajuda checklists' || lower === 'ajuda 1') {
      addAiMsg(
        '📋 CHECKLISTS DE DIAGNÓSTICO\n\n' +
        'Adicionar checklist:\n' +
        '  adicionar checklist: <problema> | <passo1>, <passo2>\n' +
        '  adicionar a informações básicas <problema> = checklist <passo1>, <passo2>\n\n' +
        'Consultar:\n' +
        '  listar checklist\n\n' +
        'Remover:\n' +
        '  apagar checklist: <id>\n\n' +
        'Exemplo:\n' +
        '  adicionar checklist: não liga | medir tensão fonte, verificar fusível, testar botão'
      );
      return true;
    }

    if (lower === 'ajuda placas' || lower === 'ajuda 2') {
      addAiMsg(
        '🖥️ NOTAS DE PLACA\n\n' +
        'Adicionar nota em placa específica:\n' +
        '  adicionar na placa <modelo>: <informação>\n' +
        '  adicionar placa <modelo>: <informação>\n\n' +
        'Usar sua última mensagem como nota:\n' +
        '  adicione essa informação na placa <modelo>\n' +
        '  (usa o que você digitou antes como informação)\n\n' +
        'Exemplo:\n' +
        '  adicionar na placa Dell 3420: capacitor C302 causa não ligar'
      );
      return true;
    }

    if (lower === 'ajuda conhecimento' || lower === 'ajuda 3') {
      addAiMsg(
        '🧠 CONHECIMENTO GERAL\n\n' +
        '── FORMATO ESTRUTURADO (recomendado) ──\n' +
        '  add conhecimento | <categoria> | <titulo> | <conteudo>\n\n' +
        '  Exemplo:\n' +
        '  add conhecimento | fonte | nao liga | verificar capacitor primario e fusivel\n\n' +
        'Registrar solução confirmada:\n' +
        '  resolver | <id> | <solucao aplicada>\n\n' +
        'Buscar manualmente:\n' +
        '  buscar conhecimento | <query>\n\n' +
        'Remover entrada:\n' +
        '  del conhecimento | <id>\n\n' +
        '── FORMATO SIMPLES (addcontexto) ──\n' +
        '  addcontexto: <fato>   → salva fato direto\n' +
        '  addcontexto           → salva última resposta da IA\n' +
        '  armazenar: <fato>     → alias legado\n\n' +
        'Listar tudo salvo:\n' +
        '  listar conhecimento\n\n' +
        'Remover entrada simples:\n' +
        '  apagar: <id>'
      );
      return true;
    }

    if (lower === 'ajuda aliases' || lower === 'ajuda alias' || lower === 'ajuda 5') {
      addAiMsg(
        '🔗 ALIASES (atalhos personalizados)\n\n' +
        'Criar um alias:\n' +
        '  associar <alias> ao <comando>\n\n' +
        'Listar aliases criados:\n' +
        '  listar aliases\n\n' +
        'Remover um alias:\n' +
        '  apagar alias: <alias>\n\n' +
        'Exemplos:\n' +
        '  associar comman ao comando\n' +
        '  associar lc ao listar conhecimento\n' +
        '  associar lp ao listar checklist\n\n' +
        '💡 Aliases ficam salvos mesmo após fechar o app.'
      );
      return true;
    }

    if (lower === 'ajuda automatico' || lower === 'ajuda automático' || lower === 'ajuda 4') {
      addAiMsg(
        '🤖 MODO AUTOMÁTICO\n\n' +
        'Basta digitar sua pergunta normalmente.\n\n' +
        'O assistente detecta automaticamente:\n' +
        '  • Placas e modelos cadastrados no sistema\n' +
        '  • Checklists relevantes para o problema descrito\n' +
        '  • Conhecimento técnico salvo anteriormente\n\n' +
        'Exemplo de perguntas:\n' +
        '  "Notebook Dell 3420 não liga"\n' +
        '  "Televisão Samsung sem imagem"\n' +
        '  "Como medir tensão na fonte ATX?"\n\n' +
        '� ANALISADOR DE CIRCUITO\n\n' +
        'Quando o Analizer estiver aberto com medições inseridas:\n' +
        '  analisar circuito  → IA analisa todos os pontos e aponta falhas\n' +
        '  (Qualquer pergunta sobre tensão/MOSFET/circuito também injeta os dados automaticamente)\n\n' +
        '�💡 Quanto mais informações você salvar, mais precisas ficam as respostas!'
      );
      return true;
    }

    return false;
  }

  // ─── Envio de mensagem ──────────────────────────────────────────────────────
  async function handleSend(text) {
    if (!text.trim() || isLoading) return;

    const checklistPatch = buildChecklistPatchFromText(text.trim());
    if (checklistPatch) {
      pushChecklistPatch(checklistPatch);
      if (checklistPatch.symptom === 'Não liga') onActivateAnalyzer?.();
    }

    setMessages((prev) => [
      ...prev,
      { id: Date.now().toString(), role: 'user', text },
    ]);

    commandCaptureRef.current = [];
    const wasCommand = await handleCommand(text.trim());
    const capturedCommandMessages = commandCaptureRef.current || [];
    commandCaptureRef.current = null;
    if (wasCommand) {
      persistLocalMessage('user', text.trim(), { source: 'command' })
        .then(() => Promise.all(
          capturedCommandMessages.map((msg) => persistLocalMessage(msg.role, msg.text, msg.metadata))
        ))
        .then(() => refreshChatSessions())
        .catch((error) => console.warn('[Chat] Erro ao salvar comando no histórico:', error.message));
      return;
    }

    // Guarda o último texto normal para o comando "adicione essa informação"
    lastUserTextRef.current = text.trim();

    setIsLoading(true);
    try {
      // Injeta contexto do analisador quando o analyzer está ativo ou a mensagem menciona circuito/tensão
      const circuitKeywords = /circuito|analisador|tensão|tensao|mosfet|dcin|acdet|acdrv|bq24781|carregador|bateria|pino|gate|source|drain/i;
      const analyzerCtx = (analyzerActive || circuitKeywords.test(text)) ? buildAnalyzerContext() : null;

      const res = await fetch(`${API_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          sessionId: chatSessionIdRef.current || undefined,
          forceApi,
          ...(analyzerCtx ? { analyzerContext: analyzerCtx } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro desconhecido.');
      if (data.sessionId) rememberSession(data.sessionId);
      lastAiTextRef.current = data.response;
      addSavedAiMsg(data.savedMessages?.find((msg) => msg.role === 'ai'), data.response);
      refreshChatSessions().catch(() => {});
    } catch (e) {
      addAiMsg(`⚠️ ${e.message}`, true);
    } finally {
      setIsLoading(false);
    }
  }

  if (hidden) {
    return (
      <aside className="flex flex-col shrink-0 bg-surface-800 border-l border-surface-600 w-8">
        <button
          onClick={() => setHidden(false)}
          title="Mostrar assistente IA"
          className="flex-1 flex items-center justify-center text-gray-500 hover:text-gray-200 hover:bg-surface-600 transition-colors"
          style={{writingMode:'vertical-rl'}}>
          <span className="text-xs font-semibold tracking-widest rotate-180">IA ►</span>
        </button>
      </aside>
    );
  }

  return (
    <aside
      className={`flex flex-col shrink-0 bg-surface-800 border-l border-surface-600 transition-all duration-300 ${
        expanded === 2 ? 'w-[1100px]' : expanded === 1 ? 'w-[680px]' : 'w-80'
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-600">
        <div className="w-7 h-7 rounded-full bg-accent flex items-center justify-center text-white text-xs font-bold shrink-0">
          IA
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight truncate">Assistente IA</p>
          <p className="text-xs text-gray-400 truncate">Ollama · local</p>
        </div>
        <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse shrink-0" />
        <button
          onClick={startNewChatSession}
          title="Nova conversa"
          className="ml-auto p-1 rounded hover:bg-surface-600 text-gray-500 hover:text-gray-200 transition-colors shrink-0"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
        </button>
        <button
          onClick={() => setHidden(true)}
          title="Ocultar painel IA"
          className="p-1 rounded hover:bg-surface-600 text-gray-500 hover:text-gray-200 transition-colors shrink-0"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
        <button
          onClick={() => setExpanded((v) => (v + 1) % 3)}
          style={{marginLeft:'8px'}}
          title={expanded === 0 ? 'Expandir chat' : expanded === 1 ? 'Maximizar chat' : 'Recolher chat'}
          className="ml-2 p-1 rounded hover:bg-surface-600 text-gray-400 hover:text-gray-100 transition-colors shrink-0"
        >
          {expanded === 2 ? (
            /* setas para dentro (recolher) */
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 9 3 3 9 3" /><line x1="3" y1="3" x2="10" y2="10" />
              <polyline points="21 15 21 21 15 21" /><line x1="21" y1="21" x2="14" y2="14" />
            </svg>
          ) : expanded === 1 ? (
            /* seta dupla (maximizar) */
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 3 21 3 21 9" /><line x1="21" y1="3" x2="14" y2="10" />
              <polyline points="3 15 3 21 9 21" /><line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          ) : (
            /* seta simples para esquerda (expandir) */
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 3 21 3 21 9" /><line x1="21" y1="3" x2="14" y2="10" />
              <polyline points="3 15 3 21 9 21" /><line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          )}
        </button>
      </div>

      <div className="px-3 py-2 border-b border-surface-600 bg-surface-900/40">
        <select
          value={chatSessionId}
          onChange={(event) => loadExistingChatSession(event.target.value).catch((error) => addAiMsg(`⚠️ ${error.message}`, true))}
          className="w-full bg-surface-700 border border-surface-600 rounded text-xs text-gray-200 px-2 py-1.5 outline-none focus:border-accent"
          title="Conversas salvas"
        >
          {chatSessions.length === 0 ? (
            <option value={chatSessionId || ''}>Conversa atual</option>
          ) : chatSessions.map((session) => (
            <option key={session.id} value={session.id}>
              {session.title} ({session.messageCount || 0})
            </option>
          ))}
        </select>
      </div>

      {/* Mensagens */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-3">
        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} compact />
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="flex items-center gap-1 bg-surface-700 px-3 py-2 rounded-2xl rounded-tl-sm">
              <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce [animation-delay:-0.3s]" />
              <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce [animation-delay:-0.15s]" />
              <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-3 pb-4 pt-2 border-t border-surface-600">
        <div className="flex items-center justify-between gap-3 mb-2 px-1">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-gray-300 leading-tight">Avançado</p>
            <p className="text-[10px] text-gray-500 truncate">
              {forceApi ? 'API sempre ligada' : 'Local primeiro, API se precisar'}
            </p>
          </div>
          <button
            type="button"
            onClick={toggleForceApi}
            aria-pressed={forceApi}
            title={forceApi ? 'Desligar API sempre' : 'Ligar API sempre'}
            className={[
              'relative h-6 w-11 rounded-full border transition-colors shrink-0',
              forceApi ? 'bg-accent border-accent' : 'bg-surface-700 border-surface-600',
            ].join(' ')}
          >
            <span
              className={[
                'absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform',
                forceApi ? 'translate-x-5' : 'translate-x-0.5',
              ].join(' ')}
            />
          </button>
        </div>
        <ChatInput onSend={handleSend} isLoading={isLoading} compact />
      </div>
    </aside>
  );
}
