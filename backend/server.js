const express = require('express');
const cors = require('cors');
const fs = require('fs');
const pdfParse = require('pdf-parse');
require('./services/envService').loadEnv();
const { generateResponse } = require('./services/aiService');
const { addEntry, addStructured, addSolution, removeEntry, loadAll, search } = require('./services/knowledgeService');
const boardService = require('./services/boardService');
const checklistService = require('./services/checklistService');
const repairCaseService = require('./services/repairCaseService');
const chatHistoryService = require('./services/chatHistoryService');
const autoMemoryService = require('./services/autoMemoryService');
const mosfetService = require('./services/mosfetService');

const STARTED_AT = new Date().toISOString();

// Expressões regex de tensão usadas na extração automática de PDF
const VOLTAGE_PATTERN = /\b([A-Z]{1,3}\d{3,5})\b[^\n]{0,60}?(\d+[.,]\d+|\d+)\s*[Vv]\b/g;
const VOLTAGE_VALUE_PATTERN = /\b(\d+[.,]\d+|\d+)\s*[Vv]\b/g;
const COMMON_RAILS = ['1.0', '1.05', '1.1', '1.2', '1.35', '1.5', '1.8', '2.5', '3.3', '5.0', '12.0', '19.0'];

// Colunas de estado comuns em tabelas de Voltage Rails — serão removidas da descrição
const STATE_TOKENS = new Set(['ON', 'OFF', 'ON*', 'N/A', 'DS3', '---']);

/**
 * Extrai pontos de tensão de texto bruto de um PDF.
 * Suporta dois formatos:
 *   1. Tabela "Voltage Rails": linhas começando com + (ex: +19V_ADPIN, +3VALW_PCH)
 *   2. Referências de componentes: PU301 ... 3.3V
 * Retorna { byRef: [{ref, tensao, observacao}], rails: string[] }
 */
function extractVoltagesFromText(text) {
  const found = new Map();

  // ── Formato 1: Power Rail Table (+NOME_DO_RAIL) ──────────────────────────
  // Cada linha começa com + seguido de um nome de rail (ex: +19V_ADPIN, +1.0V_PRIM, +3VALW_PCH)
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('+')) continue;

    const tokens = line.split(/\s+/);
    const ref = tokens[0]; // ex: +19V_ADPIN, +3VALW_PCH, +VCCSTG
    if (found.has(ref)) continue;

    // Extrai tensão do nome do rail: +19V → 19, +1.0V → 1.0, +3VALW → 3, +0.95V → 0.95
    let tensao = null;
    const voltInName = ref.match(/\+(\d+[.,]?\d*)\s*[Vv]/i);
    if (voltInName) {
      tensao = parseFloat(voltInName[1].replace(',', '.'));
      if (tensao <= 0 || tensao > 50) tensao = null;
      else tensao = `${voltInName[1].replace(',', '.')}V`;
    }

    // Se não achou no nome, tenta na descrição (ex: "+VCCSTG +1.05 VCCSTG power")
    if (!tensao) {
      const desc = tokens.slice(1).join(' ');
      const voltInDesc = desc.match(/\+?(\d+[.,]\d+)\s*[Vv]\b/);
      if (voltInDesc) {
        const v = parseFloat(voltInDesc[1].replace(',', '.'));
        if (v > 0 && v <= 50) tensao = `${voltInDesc[1].replace(',', '.')}V`;
      }
    }

    // Só salva rails com tensão identificada
    if (!tensao) continue;

    // Monta descrição limpando colunas de estado (ON/OFF/N/A) do final
    const descTokens = tokens.slice(1).filter(t => !STATE_TOKENS.has(t.toUpperCase()));
    const observacao = descTokens.join(' ').replace(/\s+/g, ' ').trim();

    // Extrai componente responsável pelo rail:
    // IC part name: apenas maiúsculas+dígitos, 6+ chars (ex: SY8286BRAC, RT8081AZQW, EM5209VF)
    const icName = tokens.slice(1).find(t => /^[A-Z][A-Z0-9]{5,}$/.test(t) && !STATE_TOKENS.has(t)) || '';
    // Component reference: 1-2 letras + 2-4 dígitos (ex: PU301, UL2, Q3)
    const compRef = tokens.slice(1).find(t => /^[A-Z]{1,2}\d{1,4}$/.test(t)) || '';
    const componente = [icName, compRef].filter(Boolean).join(' ').trim();

    found.set(ref, { ref, tensao, observacao, componente });
  }

  // ── Formato 2: Referências de componentes (PU301 ... 3.3V) ──────────────
  if (found.size === 0) {
    for (const m of text.matchAll(/\b([A-Z]{1,2}\d{3,5})\b[^\n]{0,80}(\d+[.,]?\d*)\s*V\b/gi)) {
      const ref = m[1].toUpperCase();
      const v = parseFloat(m[2].replace(',', '.'));
      if (v > 0 && v <= 50 && !found.has(ref)) {
        found.set(ref, { ref, tensao: `${m[2].replace(',', '.')}V`, observacao: '' });
      }
    }
  }

  // ── Rails comuns encontrados no texto ────────────────────────────────────
  const railsFound = [];
  for (const rail of COMMON_RAILS) {
    const re = new RegExp(`\\b${rail.replace('.', '\\.')}\\s*[Vv]\\b`);
    if (re.test(text)) railsFound.push(`${rail}V`);
  }

  return { byRef: [...found.values()], rails: railsFound };
}

function classifyEntryComponent(ref, line) {
  const upperRef = String(ref || '').toUpperCase();
  const normalizedLine = String(line || '').toLowerCase();

  if (/^PQ/.test(upperRef) || /^Q/.test(upperRef)) {
    if (/mosfet|fet|acdrv|cmsrc|dcin|vin|adapter|adp|entrada|charger/.test(normalizedLine)) return 'MOSFET de entrada/protecao';
    return 'MOSFET relacionado ao circuito encontrado';
  }
  if (/^PR/.test(upperRef) || /^R/.test(upperRef)) {
    if (isLowOhmSenseLine(line)) return 'Resistor shunt / sense de corrente da linha principal';
    if (/shunt|sense|acn|acp|current|corrente/.test(normalizedLine)) return 'Resistor shunt / sense de corrente';
    if (/acdet|divisor|detect|adapter/.test(normalizedLine)) return 'Resistor de deteccao/divisor da entrada';
    return 'Resistor relacionado ao circuito encontrado';
  }
  if (/^PU/.test(upperRef) || /^U/.test(upperRef)) {
    if (/charger|charge|bq|isl|rt|sy|acdet|acdrv/.test(normalizedLine)) return 'CI charger / controlador de entrada';
    return 'CI relacionado ao circuito encontrado';
  }
  if (/^PC/.test(upperRef) || /^C/.test(upperRef)) return 'Capacitor/filtro da linha encontrada';
  if (/^PL/.test(upperRef)) return 'Indutor / etapa de conversao';
  if (/^PD/.test(upperRef) || /^D/.test(upperRef)) return 'Diodo/protecao da entrada';
  if (/^F/.test(upperRef)) return 'Fusivel/protecao inicial';
  return 'Referencia relacionada ao circuito de entrada';
}

function isLowOhmSenseLine(line) {
  const normalized = String(line || '')
    .replace(',', '.')
    .replace(/Ω/g, 'ohm')
    .toLowerCase();

  return (
    /\b(?:pr|r)\d{1,5}[a-z]?\b/i.test(normalized)
    && (
      /\b0\.0[0-9]{1,2}(?:r|_|ohm|\s|$)/i.test(normalized)
      || /\b(?:5|10|20|25|50)\s*m(?:ohm|r|Ω)?\b/i.test(normalized)
      || /\b(?:0r005|0r01|0r02|0r025|0r05)\b/i.test(normalized)
    )
    && /(?:2512|2010|1206|sense|shunt|acn|acp|current|corrente|1%|0\.5%)/i.test(normalized)
  );
}

function extractEntryComponentsFromText(text) {
  const refs = new Map();
  const inputTerms = /\b(pwr\s*dcin|pre[-\s]?charge|dcin|dc\s*jack|vin|b\+|19v|adapter|adp|acdet|acdrv|cmsrc|charger|charge|mosfet|shunt|acn|acp|entrada)\b/i;
  const refPattern = /\b(?:PQ|PR|PU|PC|PL|PD|F|Q|R|U|C|D)\d{1,5}[A-Z]?\b/gi;
  const context = [];

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (line.length < 6 || line.length > 220) continue;
    const isInputContext = inputTerms.test(line);
    const isLowOhmSense = isLowOhmSenseLine(line);
    const nearInputContext = context.some((previousLine) => inputTerms.test(previousLine));

    if (isInputContext) context.push(line);
    if (context.length > 8) context.shift();
    if (!isInputContext && !(isLowOhmSense && nearInputContext)) continue;

    const foundRefs = line.match(refPattern) || [];
    for (const ref of foundRefs) {
      const key = ref.toUpperCase();
      if (!refs.has(key)) {
        refs.set(key, {
          ref: key,
          role: classifyEntryComponent(key, line),
          evidence: line.slice(0, 180),
        });
      }
    }
  }

  const priority = (item) => {
    if (/shunt|sense/i.test(item.role)) return 0;
    if (/^(PQ|Q)/.test(item.ref)) return 1;
    if (/^(PR|R)/.test(item.ref)) return 2;
    if (/^(PU|U)/.test(item.ref)) return 3;
    if (/^(PC|C)/.test(item.ref)) return 4;
    return 5;
  };

  return [...refs.values()]
    .sort((a, b) => priority(a) - priority(b) || a.ref.localeCompare(b.ref))
    .slice(0, 24);
}

async function parsePdfPages(dataBuffer) {
  const pages = [];
  let pageNumber = 0;

  await pdfParse(dataBuffer, {
    pagerender: async (pageData) => {
      pageNumber += 1;
      const textContent = await pageData.getTextContent({
        normalizeWhitespace: true,
        disableCombineTextItems: false,
      });
      const text = textContent.items
        .map((item) => String(item.str || '').trim())
        .filter(Boolean)
        .join('\n');
      pages.push({ pageNumber, text });
      return text;
    },
  });

  return pages;
}

function compactLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function extractComponentContextFromText(text, ref, pageInfo = null) {
  const target = String(ref || '').trim().toUpperCase();
  if (!target) return { ref: target, snippets: [], component: null, pins: [], powerPins: [], circuit: '' };

  const lines = compactLines(text);

  const targetPattern = new RegExp(`\\b${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  const electricalTerms = /\b(dcin|vin|b\+|19v|3v|5v|gnd|gate|source|drain|vcc|acdet|acdrv|cmsrc|charger|charge|shunt|sense|acn|acp|bat|battery|regn|phase|mosfet|pwr|pre[-\s]?charge)\b/i;
  const snippets = [];
  const seen = new Set();
  const hitIndexes = [];

  lines.forEach((line, index) => {
    if (!targetPattern.test(line)) return;
    hitIndexes.push(index);
    const start = Math.max(0, index - 18);
    const end = Math.min(lines.length, index + 90);
    const block = lines.slice(start, end)
      .filter((item) => (
        targetPattern.test(item)
        || electricalTerms.test(item)
        || /\b(?:PQ|PR|PU|PC|PL|PD|F|Q|R|U|C|D)\d{1,5}[A-Z]?\b/i.test(item)
        || /^[A-Z][A-Z0-9_/#.+-]{1,24}$/.test(item)
        || /^\d{1,3}$/.test(item)
      ))
      .join('\n');
    const key = block.slice(0, 240);
    if (block && !seen.has(key)) {
      seen.add(key);
      snippets.push(block);
    }
  });

  const directLine = lines.find((line) => targetPattern.test(line)) || '';
  const firstIndex = hitIndexes[0] ?? -1;
  const localWindow = firstIndex >= 0 ? lines.slice(Math.max(0, firstIndex - 12), Math.min(lines.length, firstIndex + 130)) : [];
  const partNumber = findComponentPartNumber(localWindow, target);
  const pins = extractPinPairs(localWindow);
  const powerPins = pins.filter((pin) => isPowerLikePin(pin.name));
  const circuitBlock = buildCircuitBlock(lines, {
    ref: target,
    partNumber,
    pins,
    pageInfo,
  });
  const circuit = circuitBlock.title || circuitBlock.circuit || inferCircuit({ ref: target, partNumber, pins, text: localWindow.join(' ') });
  const component = directLine ? {
    ref: target,
    partNumber,
    role: classifyEntryComponent(target, `${directLine} ${partNumber} ${localWindow.join(' ')}`),
    circuit,
    evidence: directLine.slice(0, 180),
  } : null;

  return {
    ref: target,
    component,
    partNumber,
    circuit,
    pins,
    powerPins,
    circuitBlock,
    snippets: snippets.slice(0, 8),
  };
}

function findBestComponentPage(pages, ref) {
  const target = String(ref || '').trim().toUpperCase();
  if (!target || !Array.isArray(pages) || pages.length === 0) return null;
  const targetPattern = new RegExp(`\\b${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');

  return pages
    .map((page) => {
      const text = page.text || '';
      let score = targetPattern.test(text) ? 20 : 0;
      if (/\b(PWR|POWER|CPU_CORE|VGFX_CORE|VCORE|CORE|CHARGER|DCIN|VIN|B\+)\b/i.test(text)) score += 4;
      if (/\b(Title|Sheet)\b/i.test(text)) score += 2;
      return { ...page, score };
    })
    .filter((page) => page.score > 0)
    .sort((a, b) => b.score - a.score || a.pageNumber - b.pageNumber)[0] || null;
}

function extractComponentContextFromPages(pages, ref) {
  const bestPage = findBestComponentPage(pages, ref);
  if (!bestPage) {
    return extractComponentContextFromText(pages.map((page) => page.text).join('\n'), ref);
  }

  return extractComponentContextFromText(bestPage.text, ref, {
    pageNumber: bestPage.pageNumber,
  });
}

function buildCircuitBlock(lines, { ref, partNumber, pins, pageInfo }) {
  const pageText = lines.join(' ');
  const title = extractCircuitTitle(lines);
  const rails = extractRails(lines);
  const componentRefs = extractPageComponentRefs(lines);
  const keySignals = extractKeySignals(lines);
  const snippets = buildCircuitSnippets(lines, ref);
  const circuit = inferCircuit({
    ref,
    partNumber,
    pins,
    text: `${title} ${rails.join(' ')} ${pageText.slice(0, 5000)}`,
  });

  return {
    localPage: pageInfo?.pageNumber || null,
    title,
    circuit,
    rails,
    keySignals,
    controllers: componentRefs.filter((item) => /^(PU|U)/.test(item.ref)).slice(0, 12),
    mosfets: componentRefs.filter((item) => /^(PQ|Q)/.test(item.ref)).slice(0, 32),
    inductors: componentRefs.filter((item) => /^(PL|L)/.test(item.ref)).slice(0, 16),
    senseAndFeedback: componentRefs.filter((item) => /^(PR|R|PC|C)/.test(item.ref)).slice(0, 40),
    snippets,
  };
}

function extractCircuitTitle(lines) {
  const candidates = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^(?:PWR|POWER)\b/i.test(line) || /\b(?:CPU_CORE|VGFX_CORE|VCORE|CORE|CHARGER|DCIN|ALW|SUSP|DDR|VGA|LCD|BACKLIGHT)\b/i.test(line)) {
      if (line.length >= 6 && line.length <= 90 && !/CONFIDENTIAL|PROPRIETARY|COMPAL ELECTRONICS/i.test(line)) {
        candidates.push(line);
      }
    }
  }

  return candidates
    .sort((a, b) => scoreCircuitTitle(b) - scoreCircuitTitle(a) || b.length - a.length)[0] || '';
}

function scoreCircuitTitle(line) {
  let score = 0;
  if (/^(?:PWR|POWER)\b/i.test(line)) score += 8;
  if (/[+][A-Z0-9_]+/.test(line)) score += 4;
  if (/CPU_CORE|VGFX_CORE|VCORE|CORE/i.test(line)) score += 4;
  if (/CHARGER|DCIN|ALW|SUSP|DDR/i.test(line)) score += 3;
  return score;
}

function extractRails(lines) {
  const rails = new Set();
  const railPattern = /\b\+?[A-Z0-9_.-]*(?:CPU_CORE|VGFX_CORE|VCORE|CORE|VIN|B\+|DCIN|3VALW|5VALW|VCC|VDD|VSS|PHASE|BOOT)[A-Z0-9_.+-]*\b/g;
  for (const line of lines) {
    for (const match of line.match(railPattern) || []) {
      const rail = match.toUpperCase();
      if (rail.length >= 2 && rail.length <= 32) rails.add(rail);
    }
  }
  return [...rails].slice(0, 40);
}

function extractPageComponentRefs(lines) {
  const refs = new Map();
  const refPattern = /\b(?:PU|PQ|PR|PC|PL|PD|PF|U|Q|R|C|L|D|F)\d{1,5}[A-Z]?\b/gi;

  lines.forEach((line, index) => {
    for (const rawRef of line.match(refPattern) || []) {
      const ref = rawRef.toUpperCase();
      if (!refs.has(ref)) {
        refs.set(ref, {
          ref,
          role: classifyEntryComponent(ref, line),
          evidence: line.slice(0, 120),
          index,
        });
      }
    }
  });

  return [...refs.values()].sort((a, b) => componentRefPriority(a.ref) - componentRefPriority(b.ref) || a.ref.localeCompare(b.ref));
}

function componentRefPriority(ref) {
  if (/^(PU|U)/.test(ref)) return 1;
  if (/^(PQ|Q)/.test(ref)) return 2;
  if (/^(PL|L)/.test(ref)) return 3;
  if (/^(PR|R)/.test(ref)) return 4;
  if (/^(PC|C)/.test(ref)) return 5;
  return 6;
}

function extractKeySignals(lines) {
  const signals = new Set();
  const signalPattern = /\b[+A-Z][A-Z0-9_+/#.-]{2,32}\b/g;
  const useful = /(?:CPU|GFX|CORE|VCORE|VIN|VDD|VCC|VSS|GND|BOOT|UG|LG|PH|FB|COMP|VSEN|ISEN|SDA|SCL|PGOOD|VR_ON|ALERT|IMON|NTC|B\+)/i;

  for (const line of lines) {
    for (const match of line.match(signalPattern) || []) {
      const signal = match.toUpperCase();
      if (useful.test(signal) && !/^(TITLE|SHEET|CUSTOM|COMPAL|ELECTRONICS)$/.test(signal)) signals.add(signal);
    }
  }

  return [...signals].slice(0, 80);
}

function buildCircuitSnippets(lines, ref) {
  const target = String(ref || '').toUpperCase();
  const useful = new RegExp(`${target}|CPU_CORE|VGFX_CORE|VCORE|\\+CPU|\\+VGFX|VIN|VDD|GND|BOOT|UG\\d*|LG\\d*|PH\\d*|FB|COMP|VSEN|ISEN|VSSP|VDDP|MOSFET|PHASE|PWR`, 'i');
  const selected = [];
  const seen = new Set();

  for (const line of lines) {
    if (!useful.test(line)) continue;
    const normalized = line.slice(0, 180);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    selected.push(normalized);
    if (selected.length >= 120) break;
  }

  return selected;
}

function findComponentPartNumber(windowLines, ref) {
  const target = String(ref || '').toUpperCase();
  const targetIndex = windowLines.findIndex((line) => line.toUpperCase() === target || new RegExp(`\\b${target}\\b`, 'i').test(line));
  const candidates = [];
  const start = Math.max(0, targetIndex - 5);
  const end = Math.min(windowLines.length, targetIndex + 8);

  for (let i = start; i < end; i += 1) {
    const line = windowLines[i];
    if (!line || line.toUpperCase() === target) continue;
    if (/^(?:PQ|PR|PU|PC|PL|PD|F|Q|R|U|C|D)\d{1,5}[A-Z]?$/i.test(line)) continue;
    if (/^\d{1,3}$/.test(line)) continue;
    if (/^[A-Z0-9][A-Z0-9_.+#/-]{4,}(?:_[A-Z0-9_.+#/-]+)*$/i.test(line)) candidates.push(line);
  }

  return candidates.find((item) => /(?:ISL|RT|BQ|TPS|SY|APW|NCP|PU|AO|AON|TPS|MAX|MP|ISL|TQFN|QFN|SOP|DFN)/i.test(item))
    || candidates[0]
    || '';
}

function extractPinPairs(windowLines) {
  const pins = [];
  const seen = new Set();
  const signalPattern = /^[A-Z][A-Z0-9_/#.+-]{1,24}$/;

  for (let i = 0; i < windowLines.length - 1; i += 1) {
    const name = windowLines[i];
    const number = windowLines[i + 1];
    if (!signalPattern.test(name)) continue;
    if (!/^\d{1,3}$/.test(number)) continue;
    if (/^(?:PU|PQ|PR|PC|PL|PD|R|Q|U|C|D|F)\d+/i.test(name)) continue;
    const pinNumber = Number(number);
    if (pinNumber <= 0 || pinNumber > 160) continue;
    const key = `${pinNumber}:${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pins.push({
      number: pinNumber,
      name,
      kind: classifyPinName(name),
    });
  }

  return pins.slice(0, 80).sort((a, b) => a.number - b.number);
}

function isPowerLikePin(name) {
  return /^(VIN|VDD|VCC|VDDP|VSS|VSSP|GND|AGND|PGND|B\+|\+|REGN|PVCC|AVCC|VBAT|BAT|PH\d*|BOOT\d*|UG\d*|LG\d*)$/i.test(String(name || ''));
}

function classifyPinName(name) {
  const upper = String(name || '').toUpperCase();
  if (/^(GND|VSS|VSSP|PGND|AGND|RTN|RTNG)$/.test(upper)) return 'terra/referencia';
  if (/^(VIN|VDD|VCC|VDDP|PVCC|AVCC|VBAT|BAT|REGN)$/.test(upper)) return 'alimentacao';
  if (/^(BOOT|UG|LG|PH|SW|LX)/.test(upper)) return 'gate driver/chaveamento';
  if (/^(FB|VSEN|ISEN|ISUM|ISN|ISP|ACN|ACP)/.test(upper)) return 'realimentacao/sense';
  if (/^(SDA|SCL|SCLK|ALERT|PGOOD|VR_ON|EN|IMON|NTC)/.test(upper)) return 'controle/sinal';
  return 'sinal';
}

function inferCircuit({ ref, partNumber, pins, text }) {
  const joined = `${ref} ${partNumber} ${text}`.toLowerCase();
  if (/charger|charge|bq247|isl887|acdet|acdrv|acn|acp|cmsrc/.test(joined)) return 'charger / entrada de carregador';
  if (/isl958|vwg|imon|vr_on|cpu|gfx|core|ug1|lg1|boot1|phase|ph1/.test(joined)) return 'VRM CPU/GPU / fonte multiphase';
  if (/rt820|3valw|5valw|always|s5|s3/.test(joined)) return 'fonte 3V/5V always';
  if (/lcd|edp|lvds|backlight|inv/.test(joined)) return 'video / tela / backlight';
  if (pins.some((pin) => /^VIN$/i.test(pin.name)) && pins.some((pin) => /^GND$/i.test(pin.name))) return 'fonte chaveada / regulador';
  return 'circuito nao classificado automaticamente';
}

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Middlewares ──────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ─── Rotas ────────────────────────────────────────────────────────────────────

/**
 * GET /health
 * Verifica se o backend está online.
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend rodando.' });
});

app.get('/debug-info', (req, res) => {
  res.json({
    app: 'volt',
    debugProtocol: 2,
    pid: process.pid,
    chatFlowLogs: true,
    startedAt: STARTED_AT,
  });
});

/**
 * POST /chat
 * Recebe uma mensagem do usuário e retorna a resposta do modelo Ollama.
 *
 * Body: { "message": "string" }
 * Response: { "response": "string" }
 */
app.post('/chat', async (req, res) => {
  const { message, analyzerContext, sessionId, forceApi } = req.body;

  if (!message || typeof message !== 'string' || message.trim() === '') {
    return res.status(400).json({ error: 'O campo "message" é obrigatório e não pode estar vazio.' });
  }

  try {
    const cleanMessage = message.trim();
    const shortMessage = cleanMessage.length > 140 ? `${cleanMessage.slice(0, 140)}...` : cleanMessage;
    const chatId = Math.random().toString(36).slice(2, 8);
    const requestStartedAt = Date.now();
    console.log(`\n━━━━━━━━━━━━ CHAT ${chatId} INICIO ━━━━━━━━━━━━`);
    console.log(`[CHAT:${chatId}] Usuario enviou mensagem | chars=${cleanMessage.length} | api_avancado=${Boolean(forceApi) ? 'ligado' : 'desligado'} | texto="${shortMessage}"`);
    const session = chatHistoryService.ensureSession(sessionId, cleanMessage.slice(0, 48) || 'Nova conversa');
    const recentSession = chatHistoryService.getSessionWithMessages(session.id);
    const aiResult = await generateResponse(cleanMessage, undefined, analyzerContext || null, {
      forceApi: Boolean(forceApi),
      chatId,
      recentMessages: recentSession?.messages || [],
    });
    const aiResponse = aiResult?.text || '';
    console.log(`[CHAT:${chatId}] IA respondeu ao usuario | chars=${aiResponse.length} | tempo_total=${Date.now() - requestStartedAt}ms | sessao=${session.id}`);
    console.log(`━━━━━━━━━━━━ CHAT ${chatId} FIM ━━━━━━━━━━━━\n`);

    if (aiResult?.meta?.usedApi) {
      const learned = autoMemoryService.autoLearnFromApiInteraction(cleanMessage, aiResponse, {
        remoteModel: aiResult.meta.model,
        route: aiResult.meta.route,
        usage: aiResult.meta.usage || null,
      });

      if (learned.saved?.length) {
        const labels = learned.saved.map((item) => `${item.type}:${item.label}`).join(' | ');
        console.log(`[MEMORIA API:${chatId}] Aprendizado salvo automaticamente | ${labels}`);
      } else if (learned.skipped) {
        console.log(`[MEMORIA API:${chatId}] Aprendizado nao salvo | motivo=${learned.skipped}`);
      }
    }

    const saved = chatHistoryService.addExchange(session.id, cleanMessage, aiResponse, {
      user: analyzerContext ? { hasAnalyzerContext: true } : {},
      ai: {
        provider: aiResult?.meta?.provider || process.env.AI_PROVIDER || 'hybrid',
        route: aiResult?.meta?.route || 'unknown',
        localModel: process.env.OLLAMA_MODEL || 'llama3.2:3b',
        remoteModel: aiResult?.meta?.usedApi ? (aiResult?.meta?.model || process.env.GROQ_MODEL || 'llama-3.1-8b-instant') : (process.env.GROQ_MODEL || 'llama-3.1-8b-instant'),
        forceApi: Boolean(forceApi),
        usage: aiResult?.meta?.usage || null,
      },
    });

    return res.json({
      response: aiResponse,
      sessionId: saved.session.id,
      savedMessages: saved.messages,
      meta: aiResult?.meta || null,
    });
  } catch (error) {
    console.error('[/chat] Erro ao chamar Ollama:', error.message);

    if (error.code === 'ECONNREFUSED') {
      return res.status(503).json({
        error: 'Não foi possível conectar ao Ollama. Certifique-se de que ele está rodando em http://localhost:11434'
      });
    }

    // Repassa a mensagem real do erro (ex: RAM insuficiente, modelo não encontrado)
    return res.status(500).json({ error: error.message || 'Erro interno ao processar a mensagem.' });
  }
});

// ─── Rotas de histórico de chat ──────────────────────────────────────────────

app.get('/chat-sessions', (req, res) => {
  const limit = Number(req.query.limit || 30);
  res.json(chatHistoryService.listSessions(limit));
});

app.post('/chat-sessions', (req, res) => {
  const session = chatHistoryService.createSession({
    title: req.body?.title || 'Nova conversa',
    summary: req.body?.summary || '',
    metadata: req.body?.metadata || {},
  });
  return res.status(201).json(session);
});

app.get('/chat-sessions/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  res.json(chatHistoryService.searchMessages(q));
});

app.get('/chat-sessions/:id', (req, res) => {
  const session = chatHistoryService.getSessionWithMessages(req.params.id);
  if (!session) return res.status(404).json({ error: 'Sessão de chat não encontrada.' });
  return res.json(session);
});

app.patch('/chat-sessions/:id', (req, res) => {
  const session = chatHistoryService.updateSession(req.params.id, req.body || {});
  if (!session) return res.status(404).json({ error: 'Sessão de chat não encontrada.' });
  return res.json(session);
});

app.post('/chat-sessions/:id/messages', (req, res) => {
  try {
    const session = chatHistoryService.getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Sessão de chat não encontrada.' });

    const message = chatHistoryService.addMessage(req.params.id, {
      role: req.body?.role,
      text: req.body?.text,
      metadata: req.body?.metadata || {},
    });
    return res.status(201).json(message);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.delete('/chat-sessions/:id', (req, res) => {
  const removed = chatHistoryService.deleteSession(req.params.id);
  if (!removed) return res.status(404).json({ error: 'Sessão de chat não encontrada.' });
  return res.json({ success: true });
});

// ─── Memória automática ──────────────────────────────────────────────────────

app.post('/memory/auto-save', (req, res) => {
  const { text } = req.body || {};
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'O campo "text" é obrigatório.' });
  }

  try {
    const result = autoMemoryService.autoSave(text);
    console.log(`[/memory/auto-save] ${result.saved.map((item) => item.type).join(', ')} salvo.`);
    return res.status(201).json(result);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Erro ao salvar memória automática.' });
  }
});

// ─── Rotas de conhecimento ────────────────────────────────────────────────────

/**
 * GET /knowledge
 * Lista todas as entradas de conhecimento armazenadas.
 */
app.get('/knowledge', (req, res) => {
  res.json(loadAll());
});

/**
 * POST /knowledge
 * Armazena uma nova entrada de conhecimento.
 * Body: { "text": "string" }
 */
app.post('/knowledge', (req, res) => {
  const { text } = req.body;
  if (!text || typeof text !== 'string' || text.trim() === '') {
    return res.status(400).json({ error: 'O campo "text" é obrigatório.' });
  }
  const entry = addEntry(text);
  console.log(`[/knowledge] Entrada salva: "${entry.text}"`);
  return res.status(201).json(entry);
});

/**
 * POST /knowledge/structured
 * Armazena entrada ESTRUTURADA: { categoria, titulo, conteudo }
 */
app.post('/knowledge/structured', (req, res) => {
  const { categoria, titulo, conteudo } = req.body;
  if (!categoria || !titulo || !conteudo) {
    return res.status(400).json({ error: 'Campos obrigatórios: categoria, titulo, conteudo.' });
  }
  const entry = addStructured(categoria, titulo, conteudo);
  console.log(`[/knowledge] Estruturado salvo: [${entry.categoria}/${entry.titulo}]`);
  return res.status(201).json(entry);
});

/**
 * GET /knowledge/search?q=...
 * Busca entradas relevantes por query.
 */
app.get('/knowledge/search', (req, res) => {
  const q = req.query.q || '';
  res.json(search(q));
});

/**
 * POST /knowledge/:id/solucao
 * Registra uma solução confirmada em uma entrada existente.
 * Body: { solucao: string }
 */
app.post('/knowledge/:id/solucao', (req, res) => {
  const { solucao } = req.body;
  if (!solucao) return res.status(400).json({ error: 'Campo "solucao" é obrigatório.' });
  const updated = addSolution(req.params.id, solucao);
  if (!updated) return res.status(404).json({ error: 'Entrada não encontrada.' });
  console.log(`[/knowledge] Solução registrada em ${req.params.id}: "${solucao}"`);
  return res.json(updated);
});

/**
 * DELETE /knowledge/:id
 * Remove uma entrada de conhecimento pelo ID.
 */
app.delete('/knowledge/:id', (req, res) => {
  const removed = removeEntry(req.params.id);
  if (!removed) return res.status(404).json({ error: 'Entrada não encontrada.' });
  console.log(`[/knowledge] Entrada ${req.params.id} removida.`);
  return res.json({ success: true });
});

// ─── Rotas de MOSFETs ─────────────────────────────────────────────────────────

app.get('/mosfets', (_req, res) => {
  res.json(mosfetService.loadAll());
});

app.get('/mosfets/suggest', (req, res) => {
  const model = String(req.query.model || '').trim();
  if (!model) return res.status(400).json({ error: 'Informe ?model=<modelo>.' });
  res.json({ response: mosfetService.suggestSubstitutes(model) });
});

app.get('/mosfets/compare', (req, res) => {
  const original = String(req.query.original || '').trim();
  const substitute = String(req.query.substitute || '').trim();
  if (!original || !substitute) {
    return res.status(400).json({ error: 'Informe ?original=<modelo>&substitute=<modelo>.' });
  }
  res.json({ response: mosfetService.compareMosfets(original, substitute) });
});

app.get('/mosfets/:model', (req, res) => {
  const mosfet = mosfetService.findByModel(req.params.model);
  if (!mosfet) return res.status(404).json({ error: 'MOSFET não encontrado.' });
  res.json(mosfet);
});

// ─── Rotas de placas ─────────────────────────────────────────────────────────

/** GET /boards — Lista todas as placas */
app.get('/boards', (req, res) => {
  res.json(boardService.loadAll());
});

/** POST /boards — Cria uma nova placa */
app.post('/boards', (req, res) => {
  const { marca, modelo, schematicPath, schematicName } = req.body;
  if (!marca || !modelo) {
    return res.status(400).json({ error: 'Os campos "marca" e "modelo" são obrigatórios.' });
  }
  const board = boardService.createBoard({ marca, modelo, schematicPath, schematicName });
  console.log(`[/boards] Placa criada: ${board.marca} ${board.modelo}`);
  return res.status(201).json(board);
});

/** GET /boards/search?q= — Busca placas por marca ou modelo */
app.get('/boards/search', (req, res) => {
  const { q } = req.query;
  if (!q || !q.trim()) return res.json([]);
  res.json(boardService.searchByQuery(q.trim()));
});

/** GET /boards/:id — Retorna uma placa pelo ID */
app.get('/boards/:id', (req, res) => {
  const board = boardService.getBoard(req.params.id);
  if (!board) return res.status(404).json({ error: 'Placa não encontrada.' });
  return res.json(board);
});

/** DELETE /boards/:id — Remove uma placa */
app.delete('/boards/:id', (req, res) => {
  const removed = boardService.deleteBoard(req.params.id);
  if (!removed) return res.status(404).json({ error: 'Placa não encontrada.' });
  return res.json({ success: true });
});

/** POST /boards/:id/defects — Adiciona um defeito a uma placa */
app.post('/boards/:id/defects', (req, res) => {
  const { nome, descricao } = req.body;
  if (!nome || !descricao) {
    return res.status(400).json({ error: 'Os campos "nome" e "descricao" são obrigatórios.' });
  }
  const defect = boardService.addDefect(req.params.id, { nome, descricao });
  if (!defect) return res.status(404).json({ error: 'Placa não encontrada.' });
  return res.status(201).json(boardService.getBoard(req.params.id));
});

/** DELETE /boards/:id/defects/:defectId — Remove um defeito */
app.delete('/boards/:id/defects/:defectId', (req, res) => {
  const removed = boardService.removeDefect(req.params.id, req.params.defectId);
  if (!removed) return res.status(404).json({ error: 'Defeito não encontrado.' });
  return res.json(boardService.getBoard(req.params.id));
});

/** POST /boards/:id/notes — Adiciona uma nota técnica a uma placa */
app.post('/boards/:id/notes', (req, res) => {
  const { texto } = req.body;
  if (!texto || typeof texto !== 'string' || !texto.trim()) {
    return res.status(400).json({ error: 'O campo "texto" é obrigatório.' });
  }
  const note = boardService.addNote(req.params.id, texto);
  if (!note) return res.status(404).json({ error: 'Placa não encontrada.' });
  console.log(`[/boards/notes] Nota adicionada à placa ${req.params.id}`);
  return res.status(201).json(boardService.getBoard(req.params.id));
});

/** DELETE /boards/:id/notes/:noteId — Remove uma nota */
app.delete('/boards/:id/notes/:noteId', (req, res) => {
  const removed = boardService.removeNote(req.params.id, req.params.noteId);
  if (!removed) return res.status(404).json({ error: 'Nota não encontrada.' });
  return res.json(boardService.getBoard(req.params.id));
});

/** POST /boards/:id/voltagepoints — Adiciona um ponto de tensão */
app.post('/boards/:id/voltagepoints', (req, res) => {
  const { ref, tensao, observacao } = req.body;
  if (!ref || !tensao) {
    return res.status(400).json({ error: 'Os campos "ref" e "tensao" são obrigatórios.' });
  }
  const vp = boardService.addVoltagePoint(req.params.id, { ref, tensao, observacao });
  if (!vp) return res.status(404).json({ error: 'Placa não encontrada.' });
  return res.status(201).json(boardService.getBoard(req.params.id));
});

/** DELETE /boards/:id/voltagepoints/:vpId — Remove um ponto de tensão */
app.delete('/boards/:id/voltagepoints/:vpId', (req, res) => {
  const removed = boardService.removeVoltagePoint(req.params.id, req.params.vpId);
  if (!removed) return res.status(404).json({ error: 'Ponto de tensão não encontrado.' });
  return res.json(boardService.getBoard(req.params.id));
});

/** GET /repair-cases — Lista todos os casos de reparo ou busca por query */
app.get('/repair-cases', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q) return res.json(repairCaseService.search(q));
  return res.json(repairCaseService.loadAll());
});

/** GET /boards/:id/repair-cases — Lista casos de reparo de uma placa */
app.get('/boards/:id/repair-cases', (req, res) => {
  const board = boardService.getBoard(req.params.id);
  if (!board) return res.status(404).json({ error: 'Placa não encontrada.' });
  return res.json(repairCaseService.getByBoard(req.params.id));
});

/** POST /boards/:id/repair-cases — Cria um caso de reparo estruturado */
app.post('/boards/:id/repair-cases', (req, res) => {
  const board = boardService.getBoard(req.params.id);
  if (!board) return res.status(404).json({ error: 'Placa não encontrada.' });

  const repairCase = repairCaseService.createRepairCase(req.params.id, req.body);
  if (!repairCase) {
    return res.status(400).json({ error: 'O campo "symptom" é obrigatório.' });
  }

  console.log(`[/repair-cases] Caso salvo para ${board.marca} ${board.modelo}: ${repairCase.symptom}`);
  return res.status(201).json(repairCase);
});

/** DELETE /repair-cases/:id — Remove um caso de reparo */
app.delete('/repair-cases/:id', (req, res) => {
  const removed = repairCaseService.removeRepairCase(req.params.id);
  if (!removed) return res.status(404).json({ error: 'Caso de reparo não encontrado.' });
  return res.json({ success: true });
});

/** GET /boards/:id/schematic — Serve o arquivo de esquema diretamente via HTTP */
app.get('/boards/:id/schematic', (req, res) => {
  const board = boardService.getBoard(req.params.id);
  if (!board || !board.schematicPath) return res.status(404).json({ error: 'Arquivo não encontrado.' });
  if (!fs.existsSync(board.schematicPath)) return res.status(404).json({ error: 'Arquivo não encontrado no disco.' });
  const ext = board.schematicPath.split('.').pop().toLowerCase();
  const mimeMap = {
    pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    png: 'image/png', gif: 'image/gif', bmp: 'image/bmp',
    webp: 'image/webp', svg: 'image/svg+xml',
  };
  res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream');
  res.setHeader('Content-Disposition', 'inline');
  fs.createReadStream(board.schematicPath).pipe(res);
});

/** POST /boards/:id/parse-schematic — Extrai tensões do PDF do esquema */
app.post('/boards/:id/parse-schematic', async (req, res) => {
  const board = boardService.getBoard(req.params.id);
  if (!board) return res.status(404).json({ error: 'Placa não encontrada.' });
  if (!board.schematicPath) return res.status(400).json({ error: 'Esta placa não tem esquema vinculado.' });

  const ext = board.schematicPath.split('.').pop().toLowerCase();
  if (ext !== 'pdf') {
    return res.json({ message: 'Extração automática disponível apenas para PDF.', byRef: [], rails: [] });
  }

  try {
    if (!fs.existsSync(board.schematicPath)) {
      return res.status(400).json({ error: 'Arquivo não encontrado no caminho registrado.' });
    }
    const dataBuffer = fs.readFileSync(board.schematicPath);
    const pdfData = await pdfParse(dataBuffer);
    const { byRef, rails } = extractVoltagesFromText(pdfData.text);

    // Salva os pontos extraídos por referência (não sobrescreve manuais)
    if (byRef.length > 0) {
      boardService.bulkSetVoltagePoints(req.params.id, byRef);
    }

    console.log(`[parse-schematic] Extraídos ${byRef.length} pontos, ${rails.length} rails para placa ${req.params.id}`);
    return res.json({ byRef, rails, board: boardService.getBoard(req.params.id) });
  } catch (err) {
    console.error('[parse-schematic] Erro:', err.message);
    return res.status(500).json({ error: 'Erro ao processar o PDF: ' + err.message });
  }
});

/** POST /schematic/entry-components — Extrai referencias provaveis do circuito de entrada */
app.post('/schematic/entry-components', async (req, res) => {
  const filePath = req.body?.path || req.body?.schematicPath;
  if (!filePath) return res.status(400).json({ error: 'Informe o caminho do esquema.' });
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Arquivo nao encontrado no disco.' });

  const ext = filePath.split('.').pop().toLowerCase();
  if (ext !== 'pdf') {
    return res.json({ components: [], message: 'Extracao automatica de componentes disponivel apenas para PDF.' });
  }

  try {
    const dataBuffer = fs.readFileSync(filePath);
    const pdfData = await pdfParse(dataBuffer);
    const components = extractEntryComponentsFromText(pdfData.text || '');
    console.log(`[schematic-entry] ${components.length} referencia(s) extraidas de ${filePath}`);
    return res.json({ components });
  } catch (err) {
    console.error('[schematic-entry] Erro:', err.message);
    return res.status(500).json({ error: 'Erro ao processar o PDF: ' + err.message });
  }
});

/** POST /schematic/component-context — Extrai contexto filtrado de um componente no PDF */
app.post('/schematic/component-context', async (req, res) => {
  const filePath = req.body?.path || req.body?.schematicPath;
  const ref = String(req.body?.ref || '').trim().toUpperCase();
  if (!filePath) return res.status(400).json({ error: 'Informe o caminho do esquema.' });
  if (!ref) return res.status(400).json({ error: 'Informe a referência do componente.' });
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Arquivo nao encontrado no disco.' });

  const ext = filePath.split('.').pop().toLowerCase();
  if (ext !== 'pdf') {
    return res.json({ ref, component: null, snippets: [], message: 'Contexto automatico disponivel apenas para PDF.' });
  }

  try {
    const dataBuffer = fs.readFileSync(filePath);
    const pages = await parsePdfPages(dataBuffer);
    const result = extractComponentContextFromPages(pages, ref);
    console.log(`[schematic-component] ${ref} | circuito=${result.circuit || 'n/a'} | bloco=${result.circuitBlock?.title || 'n/a'} | trechos=${result.snippets.length} | arquivo=${filePath}`);
    return res.json(result);
  } catch (err) {
    console.error('[schematic-component] Erro:', err.message);
    return res.status(500).json({ error: 'Erro ao processar o PDF: ' + err.message });
  }
});

// ─── Rotas de checklist ───────────────────────────────────────────────────────

/** GET /checklist — Lista todos os itens */
app.get('/checklist', (req, res) => {
  res.json(checklistService.loadAll());
});

/** POST /checklist — Adiciona um item */
app.post('/checklist', (req, res) => {
  const { problema, checklist } = req.body;
  if (!problema || !checklist) {
    return res.status(400).json({ error: 'Os campos "problema" e "checklist" são obrigatórios.' });
  }
  const item = checklistService.addItem({ problema, checklist });
  console.log(`[/checklist] Item adicionado: "${item.problema}"`);
  return res.status(201).json(item);
});

/** DELETE /checklist/:id — Remove um item */
app.delete('/checklist/:id', (req, res) => {
  const removed = checklistService.removeItem(req.params.id);
  if (!removed) return res.status(404).json({ error: 'Item não encontrado.' });
  return res.json({ success: true });
});

// ─── Inicialização ────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`✅ Backend rodando em http://localhost:${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Porta ${PORT} já está em uso. Encerre o processo anterior e tente novamente.`);
    process.exit(1);
  } else {
    throw err;
  }
});
