const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'mosfets.json');

function normalize(value) {
  return String(value || '')
    .toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

function buildVariantKeys(name) {
  const raw = normalize(name);
  if (!raw) return [];

  const variants = new Set([raw]);
  variants.add(raw.replace(/^(AON|AOZ|SIS|SI|FDMS)/, ''));
  variants.add(raw.replace(/(MOSFET|FET)$/g, ''));

  const alphaNum = raw.match(/^([A-Z]{2,5})([0-9]{3,5}[A-Z]{0,3})$/);
  if (alphaNum) {
    variants.add(alphaNum[2]);
    variants.add(`${alphaNum[1]} ${alphaNum[2]}`);
  }

  return [...variants].filter((value) => value && value.length >= 3);
}

function getMosfetLookupKeys(mosfet) {
  const names = [mosfet.model, ...(mosfet.aliases || [])];
  return [...new Set(names.flatMap(buildVariantKeys))];
}

function loadAll() {
  if (!fs.existsSync(DATA_PATH)) return [];
  return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
}

function findByModel(model) {
  const key = normalize(model);
  if (!key) return null;
  return loadAll().find((mosfet) => {
    const names = getMosfetLookupKeys(mosfet);
    return names.includes(key) || names.includes(`AON${key}`) || names.includes(`AOZ${key}`) || names.includes(`SI${key}`);
  }) || null;
}

function extractMentionedModels(text) {
  const found = [];
  const normalizedText = String(text || '').toUpperCase();
  const compactText = normalize(text);
  const all = loadAll();

  for (const mosfet of all) {
    const names = [mosfet.model, ...(mosfet.aliases || [])];
    const keys = getMosfetLookupKeys(mosfet);
    if (
      names.some((name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(normalizedText))
      || keys.some((key) => compactText.includes(key))
    ) {
      found.push(mosfet.model);
    }
  }

  const rawMatches = normalizedText.match(/\b(?:AON|AOZ|SI|SIS|FDMS)?[\s-]?\d{4,5}[A-Z]{0,3}\b/g) || [];
  for (const raw of rawMatches) {
    const item = findByModel(raw);
    if (item) found.push(item.model);
  }

  return [...new Set(found)];
}

function bestRds(mosfet, vgs) {
  return (mosfet.rdsOn || []).find((item) => Number(item.vgs) === Number(vgs)) || null;
}

function rdsLabel(mosfet) {
  if (!mosfet?.rdsOn?.length) return 'dados ausentes';
  return mosfet.rdsOn.map((item) => {
    const role = item.role ? `${item.role}: ` : '';
    const typ = item.typMohm ? `${item.typMohm} mOhm tip / ` : '';
    return `${role}${typ}${item.maxMohm} mOhm @${item.vgs} V`;
  }).join(' / ');
}

function mosfetTypeLabel(mosfet) {
  if (!mosfet) return 'dados ausentes';
  if (mosfet.configuration && mosfet.configuration !== 'Single') {
    return `${mosfet.polarity || mosfet.type} / ${mosfet.configuration}`;
  }
  return mosfet.polarity || mosfet.type || 'dados ausentes';
}

function voltageLabel(mosfet) {
  if (!mosfet) return 'dados ausentes';
  if (mosfet.vds != null) return `${mosfet.vds} V`;
  return mosfet.vinRange || 'dados ausentes';
}

function currentLabel(mosfet) {
  if (!mosfet) return 'dados ausentes';
  if (mosfet.idContinuous != null) return `${mosfet.idContinuous} A`;
  return 'dados ausentes';
}

function formatMosfetBlock(label, mosfet) {
  if (!mosfet) return `${label}:\nModelo: dados ausentes`;
  return [
    `${label}:`,
    `Modelo: ${mosfet.model}`,
    `Tipo: ${mosfetTypeLabel(mosfet)}`,
    `Tensao: ${voltageLabel(mosfet)}`,
    `Amperagem: ${currentLabel(mosfet)}`,
    `RDS(on): ${rdsLabel(mosfet)}`,
    `Encapsulamento: ${mosfet.package || 'dados ausentes'}`,
  ].join('\n');
}

function sameKnownPackage(a, b) {
  const pa = normalize(a.package);
  const pb = normalize(b.package);
  if (!pa || !pb) return null;
  return pa === pb || (pa.includes('DFN3X3') && pb.includes('DFN3X3'));
}

function functionMismatchNote(original, substitute) {
  const originalTags = new Set(original.functionTags || []);
  const substituteTags = new Set(substitute.functionTags || []);
  if (originalTags.has('high-side') && substituteTags.has('low-side')) return 'original high-side, candidato low-side';
  if (originalTags.has('low-side') && substituteTags.has('high-side')) return 'original low-side, candidato high-side';
  if (originalTags.has('drmos') && !substituteTags.has('drmos')) return 'original DrMOS integrado, candidato discreto';
  if (!originalTags.has('drmos') && substituteTags.has('drmos')) return 'candidato DrMOS integrado, original discreto';
  if (originalTags.has('charger') && !substituteTags.has('charger') && !substituteTags.has('entrada')) return 'funcao charger/entrada nao confirmada no candidato';
  return '';
}

function compareMosfets(originalModel, substituteModel) {
  const original = findByModel(originalModel);
  const substitute = findByModel(substituteModel);

  if (!original || !substitute) {
    return [
      formatMosfetBlock('ORIGINAL', original),
      '',
      formatMosfetBlock('SUBSTITUTO', substitute),
      '',
      'RESULTADO:',
      '[DADOS INSUFICIENTES]',
      `Nao encontrei dados suficientes para ${!original ? originalModel : substituteModel}. Nao vou inventar parametros.`,
    ].join('\n');
  }

  const problems = [];
  const warnings = [];

  if (original.polarity !== substitute.polarity) problems.push('polaridade diferente');
  const functionNote = functionMismatchNote(original, substitute);
  if (functionNote) warnings.push(functionNote);
  if (original.configuration !== substitute.configuration) {
    problems.push(`topologia diferente: ${substitute.configuration || 'desconhecida'} no lugar de ${original.configuration || 'desconhecida'}`);
  }

  if (original.vds == null || substitute.vds == null) {
    warnings.push('faltam dados de tensao VDS para comparacao completa');
  } else if (Number(substitute.vds) < Number(original.vds)) {
    problems.push(`tensao menor: ${substitute.vds} V contra ${original.vds} V do original`);
  }

  if (original.idContinuous == null || substitute.idContinuous == null) {
    warnings.push('faltam dados de amperagem/corrente para comparacao completa');
  } else if (Number(substitute.idContinuous) < Number(original.idContinuous) * 0.8) {
    problems.push(`corrente/amperagem menor que a margem minima: ${substitute.idContinuous} A contra ${original.idContinuous} A do original`);
  } else if (Number(substitute.idContinuous) < Number(original.idContinuous)) {
    warnings.push(`corrente/amperagem menor: ${substitute.idContinuous} A contra ${original.idContinuous} A; aceitar somente se houver margem real no circuito`);
  }

  const rds10Original = bestRds(original, 10);
  const rds10Sub = bestRds(substitute, 10);
  if (rds10Original && rds10Sub) {
    if (Number(rds10Sub.maxMohm) > Number(rds10Original.maxMohm) * 1.2) problems.push('RDS(on) @10 V muito acima do original');
    else if (Number(rds10Sub.maxMohm) > Number(rds10Original.maxMohm)) warnings.push('RDS(on) @10 V maior que o original');
  } else {
    warnings.push('faltam dados de RDS(on) comparaveis na mesma tensao VGS');
  }

  const rds45Original = bestRds(original, 4.5);
  const rds45Sub = bestRds(substitute, 4.5);
  if (rds45Original && rds45Sub && Number(rds45Sub.maxMohm) > Number(rds45Original.maxMohm) * 1.2) {
    warnings.push('RDS(on) @4,5 V bem maior; cuidado se o gate trabalhar em baixa tensao');
  }

  const packageMatch = sameKnownPackage(original, substitute);
  if (packageMatch === false) warnings.push('encapsulamento/footprint nao e identico; conferir mecanica');
  if (packageMatch === null) warnings.push('encapsulamento insuficiente para afirmar compatibilidade');

  if (!original.pinout || !substitute.pinout) warnings.push('conferir pinagem no datasheet/placa antes de trocar');
  if (original.gateCharge && substitute.gateCharge && normalize(original.gateCharge) !== normalize(substitute.gateCharge)) {
    warnings.push('em conversor DC-DC conferir driver, perdas e aquecimento');
  }

  let classification = '[COMPATIVEL]';
  let summary = 'Parametros principais atendem na base local.';
  if (problems.length > 0) {
    classification = '[NAO RECOMENDADO]';
    summary = problems.join('; ') + '.';
  } else if (warnings.length > 0) {
    classification = '[POSSIVELMENTE COMPATIVEL]';
    summary = warnings.join('; ') + '.';
  }

  return [
    formatMosfetBlock('ORIGINAL', original),
    '',
    formatMosfetBlock('SUBSTITUTO', substitute),
    '',
    'RESULTADO:',
    classification,
    summary,
    '',
    'Antes de trocar na placa: confirme funcao no circuito, footprint, pinagem e aquecimento.',
  ].join('\n');
}

function scoreCandidate(original, candidate) {
  if (!original || !candidate || original.model === candidate.model) return null;
  if (original.polarity !== candidate.polarity) return null;
  if (original.configuration !== candidate.configuration) return null;
  if (original.vds == null || candidate.vds == null) return null;
  if (original.idContinuous == null || candidate.idContinuous == null) return null;
  if (Number(candidate.vds) < Number(original.vds)) return null;

  let score = 0;
  const notes = [];
  const functionNote = functionMismatchNote(original, candidate);
  if (functionNote) notes.push(functionNote);

  if (Number(candidate.idContinuous) >= Number(original.idContinuous)) score += 2;
  else if (Number(candidate.idContinuous) >= Number(original.idContinuous) * 0.8) {
    score += 1;
    notes.push('ID menor, mas dentro da faixa de candidato');
  } else return null;

  const rdsOriginal = bestRds(original, 10);
  const rdsCandidate = bestRds(candidate, 10);
  if (rdsOriginal && rdsCandidate) {
    if (Number(rdsCandidate.maxMohm) <= Number(rdsOriginal.maxMohm)) score += 3;
    else if (Number(rdsCandidate.maxMohm) <= Number(rdsOriginal.maxMohm) * 1.2) {
      score += 1;
      notes.push('RDS(on) um pouco maior');
    } else return null;
  } else {
    notes.push('RDS(on) incompleto');
  }

  const packageMatch = sameKnownPackage(original, candidate);
  if (packageMatch === true) score += 2;
  else notes.push('conferir encapsulamento/footprint');

  if (candidate.pinout && original.pinout) score += 2;
  else notes.push('conferir pinagem');

  if (candidate.gateCharge) score += 1;
  else notes.push('Qg ausente');

  return { candidate, score, notes };
}

function suggestSubstitutes(model) {
  const original = findByModel(model);
  if (!original) {
    return `Nao encontrei "${model}" na base local de MOSFETs.`;
  }

  const candidates = loadAll()
    .map((candidate) => scoreCandidate(original, candidate))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  const header = [
    `MOSFET de referencia: ${original.model}`,
    `Tipo: ${mosfetTypeLabel(original)} | Tensao: ${voltageLabel(original)} | Amperagem: ${currentLabel(original)} | RDS(on): ${rdsLabel(original)} | Encapsulamento: ${original.package}`,
  ];

  if (candidates.length === 0) {
    return [
      ...header,
      '',
      'Nao encontrei substitutos candidatos na base atual.',
      'Regra: procurar mesma polaridade, VDS >= original, RDS(on) igual/menor, pinagem/encapsulamento compativeis e gate adequado.',
    ].join('\n');
  }

  const hasNotes = candidates.some(({ notes }) => notes.length > 0);

  return [
    ...header,
    '',
    `Tenho ${candidates.length} candidato(s) na base:`,
    ...candidates.map(({ candidate, notes }, index) => {
      const shortNote = notes.length ? ` | ${notes[0]}` : '';
      return `${index + 1}. ${candidate.model} — ${voltageLabel(candidate)}, ${currentLabel(candidate)}, RDS(on) ${rdsLabel(candidate)}, ${candidate.package}${shortNote}`;
    }),
    hasNotes ? '\nObservacao: antes de trocar, confirme footprint/pinagem na placa.' : '',
    '',
    'Use: "posso usar <substituto> no lugar do <original>?" para a comparacao completa.',
  ].filter(Boolean).join('\n');
}

function parseComparisonFromText(text, recentText = '') {
  const currentModels = extractMentionedModels(text);
  const allModels = extractMentionedModels(`${recentText} ${text}`);
  const lower = String(text || '').toLowerCase();

  const noLugar = lower.match(/(.+?)\s+(?:no lugar do|no lugar de|lugar do|lugar de)\s+(.+)/i);
  if (noLugar) {
    const sub = extractMentionedModels(noLugar[1])[0];
    const original = extractMentionedModels(noLugar[2])[0];
    if (original && sub) return { original, substitute: sub };
  }

  const por = lower.match(/(?:substituir|trocar)\s+(.+?)\s+(?:por|pelo|pela)\s+(.+)/i);
  if (por) {
    const original = extractMentionedModels(por[1])[0];
    const sub = extractMentionedModels(por[2])[0];
    if (original && sub) return { original, substitute: sub };
  }

  if (currentModels.length >= 2) return { original: currentModels[0], substitute: currentModels[1] };
  if (currentModels.length === 1 && allModels.length >= 2) {
    const previous = allModels.find((model) => model !== currentModels[0]);
    if (previous) return { original: previous, substitute: currentModels[0] };
  }

  return null;
}

function answerMosfetQuery(text, recentText = '') {
  const mentioned = extractMentionedModels(`${recentText} ${text}`);
  const isMosfetQuery = /\b(mosfet|equivalent|equivalente|substitu|trocar|posso usar|qual posso usar|compat[ií]vel|compatibilidade)\b/i.test(text)
    || mentioned.length > 0;
  if (!isMosfetQuery) return null;

  const comparison = parseComparisonFromText(text, recentText);
  if (comparison) return compareMosfets(comparison.original, comparison.substitute);

  const currentModels = extractMentionedModels(text);
  if (currentModels.length === 1) return suggestSubstitutes(currentModels[0]);

  if (/mosfet/i.test(text)) {
    return 'Me diga o modelo do MOSFET, por exemplo: "tenho AON7410, qual posso usar?" ou "posso usar AON7408 no lugar do AON7410?".';
  }

  return null;
}

module.exports = {
  loadAll,
  findByModel,
  extractMentionedModels,
  compareMosfets,
  suggestSubstitutes,
  answerMosfetQuery,
};
