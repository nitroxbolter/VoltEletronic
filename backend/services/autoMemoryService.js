const boardService = require('./boardService');
const knowledgeService = require('./knowledgeService');
const repairCaseService = require('./repairCaseService');

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasSaveIntent(text) {
  const normalized = normalize(text);
  return /\b(salve|salvar|guarde|guardar|armazene|armazenar|registre|registrar|lembre|memorize)\b/.test(normalized);
}

function stripSaveIntent(text) {
  return String(text || '')
    .replace(/\b(salve|salvar|guarde|guardar|armazene|armazenar|registre|registrar|lembre|memorize)\b\s*(?:(essa|esta|a)\s+)?(isso|isto|informacao|informaçao|informação|no contexto|na memoria|na memória)?/ig, '')
    .replace(/\b(essa|esta|a)\s+(informacao|informaçao|informação)\b/ig, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectEquipment(text) {
  const normalized = normalize(text);
  const equipmentWords = ['notebook', 'tv', 'televisao', 'fonte', 'placa', 'monitor', 'desktop', 'pc', 'carregador'];
  const equipment = equipmentWords.find((word) => normalized.includes(word));

  const brandModelMatch = text.match(/\b(?:notebook|placa|tv|televis[aã]o|monitor|fonte)\s+([a-zA-Z0-9][a-zA-Z0-9\s._-]{2,40}?)(?:\s+(?:ele|ela|nao|não|sem|com|quando|que|e\b|,|\.|$))/i);
  const brandModel = brandModelMatch ? brandModelMatch[1].trim() : '';

  return {
    equipment: equipment || '',
    brandModel,
  };
}

function detectSymptom(text) {
  const normalized = normalize(text);
  const symptoms = [
    ['nao liga', 'nao liga'],
    ['não liga', 'nao liga'],
    ['sem imagem', 'sem imagem'],
    ['sem video', 'sem video'],
    ['sem vídeo', 'sem video'],
    ['reinicia', 'reinicia'],
    ['desarma a fonte', 'desarma a fonte'],
    ['fonte desarma', 'desarma a fonte'],
    ['curto', 'curto'],
    ['aquece', 'aquece'],
    ['esquenta', 'aquece'],
  ];

  const found = symptoms.find(([needle]) => normalized.includes(normalize(needle)));
  return found ? found[1] : '';
}

function detectDefect(text) {
  const normalized = normalize(text);
  const patterns = [
    /defeito (?:de|do|da|e|é)\s+(.+?)(?:\s+precisa|\s+deve|\s+verificar|\.|,|$)/i,
    /(?:isso e|isso é|e|é)\s+(curto.+?)(?:\s+precisa|\s+deve|\s+verificar|\.|,|$)/i,
    /(curto no circuito de entrada)/i,
    /(curto na linha [a-z0-9+_.-]+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }

  if (normalized.includes('curto')) return 'suspeita de curto';
  return '';
}

function detectAction(text) {
  const cleanText = stripSaveIntent(text);
  const patterns = [
    /(?:precisa|deve|tem que|recomenda)\s+(.+?)(?:\.|$)/i,
    /(verificar\s+.+?)(?:\.|$)/i,
    /(medir\s+.+?)(?:\.|$)/i,
    /(testar\s+.+?)(?:\.|$)/i,
  ];

  for (const pattern of patterns) {
    const match = cleanText.match(pattern);
    if (match?.[1]) return match[1].trim();
  }

  return '';
}

function buildKnowledgePayload(text) {
  const cleanText = stripSaveIntent(text) || String(text || '').trim();
  const { equipment, brandModel } = detectEquipment(cleanText);
  const symptom = detectSymptom(cleanText);
  const defect = detectDefect(cleanText);
  const action = detectAction(cleanText);

  const categoryParts = [equipment || 'diagnostico', brandModel].filter(Boolean);
  const categoria = categoryParts.join(' ').trim() || 'diagnostico';
  const titulo = [symptom || 'sintoma informado', defect].filter(Boolean).join(' - ').slice(0, 100);

  const lines = [
    brandModel ? `Equipamento/modelo citado: ${brandModel}.` : '',
    symptom ? `Sintoma: ${symptom}.` : '',
    defect ? `Defeito/suspeita: ${defect}.` : '',
    action ? `Procedimento recomendado: ${action}.` : '',
    `Registro original: ${cleanText}`,
  ].filter(Boolean);

  return {
    cleanText,
    equipment,
    brandModel,
    symptom,
    defect,
    action,
    categoria,
    titulo,
    conteudo: lines.join('\n'),
  };
}

function autoSave(text) {
  if (!text || !String(text).trim()) {
    throw new Error('Texto para salvar é obrigatório.');
  }

  const payload = buildKnowledgePayload(text);
  const boards = boardService.findByMention(payload.cleanText);
  const saved = [];

  if (boards.length === 1) {
    const board = boards[0];
    const note = boardService.addNote(board.id, payload.conteudo);
    saved.push({
      type: 'board_note',
      label: `${board.marca} ${board.modelo}`,
      id: note.id,
    });

    if (payload.symptom && (payload.defect || payload.action)) {
      const repairCase = repairCaseService.createRepairCase(board.id, {
        symptom: payload.symptom,
        defect: payload.defect,
        analysis: payload.cleanText,
        cause: payload.defect,
        solution: payload.action,
        result: 'registrado automaticamente a partir do chat',
      });
      if (repairCase) {
        saved.push({
          type: 'repair_case',
          label: `${board.marca} ${board.modelo}`,
          id: repairCase.id,
        });
      }
    }
  } else {
    const entry = knowledgeService.addStructured(payload.categoria, payload.titulo, payload.conteudo);
    saved.push({
      type: 'knowledge',
      label: `[${entry.categoria}/${entry.titulo}]`,
      id: entry.id,
    });
  }

  return {
    saved,
    inferred: payload,
    message: formatSavedMessage(saved, payload, boards.length),
  };
}

function formatSavedMessage(saved, payload, boardMatches) {
  const target = saved.map((item) => {
    if (item.type === 'board_note') return `nota da placa ${item.label}`;
    if (item.type === 'repair_case') return `caso de reparo em ${item.label}`;
    return `conhecimento técnico ${item.label}`;
  }).join(' + ');

  const inferred = [
    payload.brandModel ? `Equipamento: ${payload.brandModel}` : '',
    payload.symptom ? `Sintoma: ${payload.symptom}` : '',
    payload.defect ? `Defeito: ${payload.defect}` : '',
    payload.action ? `Ação: ${payload.action}` : '',
  ].filter(Boolean).join('\n');

  const note = boardMatches > 1
    ? '\n\nEncontrei mais de uma placa possível, então salvei como conhecimento geral para evitar associar errado.'
    : '';

  return `Salvei automaticamente em: ${target}.\n\n${inferred || 'Guardei o texto como contexto técnico.'}${note}`;
}

function looksReusableApiAnswer(text) {
  const normalized = normalize(text);
  if (!normalized || normalized.length < 80) return false;
  if (normalized.length > 2600) return false;
  if (/^\s*(oi|ola|ol[aá]|e ai|tudo bem|tudo certo)\b/.test(normalized)) return false;
  if (/\bnao posso atender|não posso atender|forneca mais informacoes|forneça mais informações\b/.test(normalized)) return false;
  return /\b(verifique|medir|meda|teste|teste|suspeita|curto|entrada|dcin|vin|b\+|mosfet|charger|fonte|placa|solucao|solução|proximo passo|próximo passo)\b/.test(normalized);
}

function buildApiLearningPayload(userText, aiText, metadata = {}) {
  const base = buildKnowledgePayload(userText);
  const responseClean = String(aiText || '').trim();
  const routeLabel = metadata.remoteModel ? `API ${metadata.remoteModel}` : 'API';

  const categoriaBase = [base.equipment || 'api', base.brandModel || 'geral'].filter(Boolean).join(' ').trim() || 'api';
  const tituloBase = [base.symptom || 'diagnostico', base.defect || 'orientacao tecnica'].filter(Boolean).join(' - ').slice(0, 100);

  const lines = [
    `Origem: aprendizado automático de resposta ${routeLabel}.`,
    base.brandModel ? `Equipamento/modelo citado: ${base.brandModel}.` : '',
    base.symptom ? `Sintoma: ${base.symptom}.` : '',
    base.defect ? `Suspeita inicial: ${base.defect}.` : '',
    `Pergunta do técnico: ${String(userText || '').trim()}`,
    `Resposta validada pela API: ${responseClean}`,
  ].filter(Boolean);

  return {
    categoria: categoriaBase,
    titulo: tituloBase,
    conteudo: lines.join('\n'),
    symptom: base.symptom,
    defect: base.defect,
    action: detectAction(responseClean) || base.action,
    analysis: responseClean,
  };
}

function autoLearnFromApiInteraction(userText, aiText, metadata = {}) {
  const cleanUser = String(userText || '').trim();
  const cleanAnswer = String(aiText || '').trim();
  if (!cleanUser || !cleanAnswer) {
    return { saved: [], skipped: 'empty' };
  }

  if (!looksReusableApiAnswer(cleanAnswer)) {
    return { saved: [], skipped: 'not_reusable' };
  }

  const payload = buildApiLearningPayload(cleanUser, cleanAnswer, metadata);
  const boards = boardService.findByMention(`${cleanUser}\n${cleanAnswer}`);
  const saved = [];

  const duplicateKnowledge = knowledgeService.findSimilarStructured(payload.categoria, payload.titulo, payload.conteudo);
  if (!duplicateKnowledge) {
    const entry = knowledgeService.addStructured(payload.categoria, payload.titulo, payload.conteudo);
    saved.push({
      type: 'knowledge',
      id: entry.id,
      label: `[${entry.categoria}/${entry.titulo}]`,
    });
  }

  if (boards.length === 1) {
    const board = boards[0];
    const noteText = `[Aprendizado API] ${payload.conteudo}`;
    if (!boardService.findSimilarNote(board.id, noteText)) {
      const note = boardService.addNote(board.id, noteText);
      saved.push({
        type: 'board_note',
        id: note.id,
        label: `${board.marca} ${board.modelo}`,
      });
    }
  }

  return {
    saved,
    skipped: saved.length === 0 ? 'duplicate' : '',
    inferred: payload,
  };
}

module.exports = {
  autoSave,
  hasSaveIntent,
  buildKnowledgePayload,
  autoLearnFromApiInteraction,
};
