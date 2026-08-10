const { answerMosfetQuery } = require('./mosfetService');

function normalizeMessage(message) {
  return String(message || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isShortMessage(normalized, maxWords = 5) {
  if (!normalized) return false;
  return normalized.split(' ').length <= maxWords;
}

function buildCommandsResponse() {
  return [
    'Comandos principais:',
    'armazenar: <fato> - salva conhecimento rapido',
    'addcontexto: <fato> - adiciona contexto tecnico',
    'adicionar checklist: <problema> | <passo1>, <passo2> - cria checklist',
    'buscar contexto: <termo> - pesquisa conhecimento salvo',
    'adicionar na placa <modelo>: <obs> - registra observacao em uma placa',
  ].join('\n');
}

function hasAny(normalized, terms) {
  return terms.some((term) => normalized.includes(term));
}

function hasWord(normalized, pattern) {
  return normalized.split(' ').some((word) => pattern.test(word));
}

function isApproxSocial(normalized) {
  if (!normalized || normalized.split(' ').length > 7) return false;

  const hasGreeting = hasWord(normalized, /^(oi|ola|opa|eai|salve|bom|boa)$/);
  const hasTudo = hasWord(normalized, /^(tudo|td|tud)$/);
  const hasBem = hasWord(normalized, /^(bem|be|bm|ben)$/);
  const hasCerto = hasWord(normalized, /^(certo|cert|serto)$/);
  const hasComo = hasWord(normalized, /^(como|cm|com)$/);
  const hasVoce = hasWord(normalized, /^(voce|vc|ce|c)$/);
  const hasEsta = hasWord(normalized, /^(esta|ta|tas|tá)$/);
  const hasCasual = hasWord(normalized, /^(beleza|blz|tranquilo|tranq|suave)$/);

  return (
    (hasTudo && (hasBem || hasCerto)) ||
    (hasGreeting && hasTudo) ||
    (hasComo && (hasVoce || hasEsta)) ||
    hasCasual
  );
}

function buildSocialResponse(normalized) {
  if (hasWord(normalized, /^(certo|cert|serto)$/)) return 'Tudo certo por aqui. Qual equipamento está na bancada?';
  if (hasWord(normalized, /^(bem|be|bm|ben)$/)) return 'Tudo certo! E aí, o que vamos consertar hoje?';
  if (normalized.includes('como')) return 'Tudo funcionando por aqui. E na bancada, qual equipamento vamos analisar?';
  if (hasWord(normalized, /^(beleza|blz|tranquilo|tranq|suave)$/)) return 'Tranquilo por aqui. O que temos na bancada hoje?';
  return 'Tudo certo por aqui. Qual equipamento e sintoma vamos analisar?';
}

function buildBasicNoPowerResponse(normalized) {
  const isNotebook = /\b(notebook|note|laptop|vaio)\b/.test(normalized);
  const isPc = /\b(pc|computador|desktop)\b/.test(normalized);
  const hasBoardOrModel = /\b(placa|board|mbx|la|da|a\d{3,4}|[a-z]{2,}\d{2,})\b/.test(normalized);

  if (hasAny(normalized, ['fonte desarma', 'desarma a fonte', 'fonte desarmando', 'derruba a fonte'])) {
    if (hasBoardOrModel) {
      return 'Fonte desarmando aponta primeiro para curto/sobrecorrente na entrada. Siga o analisador: confirme 19V/DCIN, veja se passa ao shunt e depois separe se o curto está antes ou depois dos MOSFETs.';
    }
    return 'Isso indica forte suspeita de curto ou sobrecorrente na entrada. Qual é o modelo da placa? Se tiver o esquema cadastrado, vou usar o circuito de entrada na análise.';
  }

  if (isNotebook) {
    if (hasAny(normalized, ['sem led', 'nao acende nada', 'sem sinal de vida', 'morto'])) {
      return 'Notebook sem LED/sem reação. Quando conecta a fonte ela permanece normal ou desarma? E qual é o modelo da placa?';
    }
    if (hasAny(normalized, ['fonte fica normal', 'fonte normal', 'carregador fica normal', 'nao desarma'])) {
      if (hasBoardOrModel) {
        return 'Beleza, já identifiquei código/modelo de placa. Siga o analisador: confirme 19V na entrada, veja se passa pelos MOSFETs e depois confira o resistor shunt/lado da linha principal.';
      }
      return 'Beleza, a fonte permanece normal. Você tem o código/modelo da placa? Se informar, procuro no banco e nos esquemas antes de seguir para o shunt.';
    }
    if (hasBoardOrModel) {
      return 'Notebook não liga. Já identifiquei o código/modelo da placa. Siga o analisador: comece pelo circuito de entrada, confirme 19V na entrada e veja se a tensão passa pelos MOSFETs. Depois me diga se a fonte fica normal ou desarma.';
    }
    return 'Notebook não liga. Você tem o código/modelo da placa? Também me diga se ao conectar a fonte ela permanece normal ou desarma.';
  }

  if (isPc) {
    return [
      'PC que não liga: comece pela fonte ATX e sinais básicos.',
      'Confira 5VSB, PS_ON, PWR_OK, curto nas linhas 12V/5V/3.3V e botão power.',
      'Se 5VSB não existir, investigue fonte; se existir, siga para placa-mãe e circuito de power.',
    ].join('\n');
  }

  return [
    'Beleza. Qual é a marca/modelo do equipamento ou o código da placa?',
    'Quando conecta a fonte, ela permanece normal, acende algum LED, aparece consumo ou desarma?',
  ].join('\n');
}

function buildEquipmentOnlyResponse(normalized) {
  if (/\b(sony|vaio)\b/.test(normalized)) {
    return 'Beleza, Sony Vaio. Qual é o sintoma? Ele não liga, não dá imagem, desarma a fonte ou apresenta outro comportamento?';
  }

  const equipment = normalized.match(/\b(notebook|note|laptop|pc|computador|desktop|tv|televisao|monitor|fonte|placa)\b/)?.[1] || 'equipamento';
  if (equipment === 'notebook' || equipment === 'note' || equipment === 'laptop') {
    return 'Qual é a marca/modelo do notebook ou o código da placa? E qual sintoma ele apresenta?';
  }
  if (equipment === 'pc' || equipment === 'computador' || equipment === 'desktop') {
    return 'Beleza. É desktop/placa-mãe de PC. Qual é o sintoma: não liga, liga sem vídeo, reinicia ou outro?';
  }
  if (equipment === 'placa') {
    return 'Qual é o código/modelo da placa e qual sintoma ela apresenta?';
  }
  return `Beleza. Qual é a marca/modelo desse ${equipment} e qual sintoma ele apresenta?`;
}

function buildSymptomOnlyResponse(normalized) {
  if (/\b(nao liga|nao ta ligando|nao esta ligando|sem ligar|morto|sem sinal de vida|nao acende nada)\b/.test(normalized)) {
    return 'Beleza. Qual é o equipamento ou código da placa? Quando conecta a fonte, ela permanece normal, acende LED, aparece consumo ou desarma?';
  }
  if (/\b(sem imagem|nao da video|nao da imagem|tela preta|liga sem video)\b/.test(normalized)) {
    return 'Ele permanece ligado sem imagem ou liga e desliga depois de alguns segundos?';
  }
  if (/\b(liga e desliga|liga por alguns segundos|tenta ligar|starta e corta|consumo sobe e cai)\b/.test(normalized)) {
    return 'Até que ponto ele chega: acende LED, gira cooler ou aparece consumo antes de desligar?';
  }
  return 'Qual é o equipamento ou código da placa? Com isso eu direciono a próxima pergunta sem chutar.';
}

function buildUnknownBoardModelResponse() {
  return [
    'Sem problema. Vou seguir com uma triagem geral sem modelo de placa.',
    '',
    'Primeiro escolha o sintoma principal: não liga, liga sem vídeo ou outro fluxo.',
    'Se for não liga, comece pela entrada: tensão no DC jack, passagem para o shunt e resistência da linha principal para GND.',
  ].join('\n');
}

function buildRecentText(messages = []) {
  return normalizeMessage(
    messages
      .slice(-6)
      .map((message) => message?.text || '')
      .join(' ')
  );
}

function buildSymptomTriageResponse(normalized, recentText = '') {
  const conversation = `${recentText} ${normalized}`.trim();
  const inputStageContext = hasAny(conversation, [
    'circuito de entrada',
    'resistor shunt',
    'shunt',
    'mosfets',
    'linha principal',
    '19v',
    'dcin',
  ]);
  const hasBoardOrModel = /\b(placa|board|mbx|la|da|a\d{3,4}|[a-z]{2,}\d{2,})\b/.test(conversation);
  const sourceNormal = hasAny(normalized, [
    'fonte fica normal',
    'fonte normal',
    'carregador fica normal',
    'nao desarma',
    'permanece normal',
    'fica normal',
  ]);
  const saysNoVoltage = hasAny(normalized, ['nao chega', 'nao tem tensao', 'sem tensao', '0v', 'zero volt']);
  const saysHasVoltage = hasAny(normalized, ['chega tensao', 'tem tensao', '19v', 'tensao chega', 'chega 19', 'tem 19']);

  if (sourceNormal && (hasBoardOrModel || /\b(notebook|note|laptop|vaio)\b/.test(conversation))) {
    return 'Beleza, a fonte permanece normal. Agora separe a entrada das fontes always: a tensão principal chega ao resistor shunt/lado de saída dos MOSFETs? Quanto mede ali?';
  }

  if (saysNoVoltage && inputStageContext) {
    return 'Se não chega tensão no shunt, vamos separar bloqueio na entrada de curto na linha. Com a placa desligada, meça a resistência da linha principal no shunt para GND e me passe em ohms.';
  }

  if (saysHasVoltage && inputStageContext) {
    return 'Se a tensão principal chega ao shunt, a entrada atravessou os MOSFETs. Próximo filtro: meça +3VALW e +5VALW nas bobinas/pontos do schematic.';
  }

  if (/\b(shunt|resistor shunt|resistor de corrente)\b/.test(normalized)) {
    if (saysNoVoltage) {
      return 'Se não chega tensão no shunt, vamos separar bloqueio na entrada de curto na linha. Com a placa desligada, meça a resistência da linha principal no shunt para GND e me passe em ohms.';
    }
    if (saysHasVoltage) {
      return 'Se a tensão principal chega ao shunt, a entrada atravessou os MOSFETs. Próximo filtro: meça +3VALW e +5VALW nas bobinas/pontos do schematic.';
    }
    return 'No circuito de entrada, quanto você mede no resistor shunt/lado de saída dos MOSFETs? Isso separa entrada bloqueada de falha nas fontes always.';
  }

  if (/\b(3valw|3v_alw|3v alw|5valw|5v_alw|5v alw|always|standby)\b/.test(normalized)) {
    if (hasAny(normalized, ['ausente', 'nao tem', 'sem', '0v'])) {
      return 'Se 3VALW/5VALW está ausente, primeiro meça resistência dessa linha para GND. Se não houver baixa resistência, seguimos para alimentação, enable e saída do CI regulador no schematic.';
    }
    return 'Beleza. Com 3VALW/5VALW presentes, ao apertar power aparecem as linhas VS/S0 correspondentes ou algum consumo muda?';
  }

  if (/\b(sem imagem|nao da video|nao da imagem|tela preta|liga sem video)\b/.test(normalized)) {
    return 'Ele permanece ligado sem imagem ou desliga depois de alguns segundos? Tem consumo estável, vídeo externo ou backlight na tela?';
  }

  if (/\b(placa em curto|tem curto|linha em curto|resistencia muito baixa|zerado para o terra)\b/.test(normalized)) {
    return 'Se o curto está na linha principal, faça assim: 1) inspeção visual na entrada e capacitores; 2) se nada aparecer, injete 1V com corrente limitada; 3) procure aquecimento em capacitor, MOSFET ou CI próximo da linha.';
  }

  if (/\b(curto na linha principal|linha principal em curto|curto na alimentacao principal|curto na alimentação principal)\b/.test(normalized)) {
    return 'Curto na linha principal: primeiro inspeção visual da placa. Se não achar componente torrado, injete 1V com corrente limitada na linha e procure aquecimento em capacitor, MOSFET ou CI para localizar o curto.';
  }

  if (/\b(so na entrada|só na entrada|tem tensao so na entrada|tem tensão só na entrada|na entrada tem tensao|na entrada tem tensão)\b/.test(normalized)) {
    return 'Se há tensão só na entrada e não passa adiante, foque nos MOSFETs de entrada. Verifique gate, source e drain, e também se existe curto depois do resistor shunt na alimentação principal.';
  }

  if (/\b(nao passa tensao|não passa tensao|não passa tensão|nao passa tensão|nao tem tensao no shunt|não tem tensão no shunt)\b/.test(normalized)) {
    return 'Se a tensão não passa para o shunt/linha principal, separe bloqueio de curto: confira gate/source/drain dos MOSFETs de entrada e meça resistência da linha principal para GND com a placa desligada.';
  }

  if (/\b(notebook aquecendo|aquecimento geral|esquenta muito)\b/.test(normalized)) {
    return 'É aquecimento de processador/GPU durante uso ou algum componente específico aquece mesmo em standby?';
  }

  if (/\b(componente aquecendo|ci esquentando|mosfet aquecendo|capacitor aquecendo|chip ferve|aquece|aquecendo|esquentando)\b/.test(normalized)) {
    const ref = normalized.match(/\b(pu|pq|pc|pr|pl|pd)\d+\b/i)?.[0]?.toUpperCase();
    if (ref) return `Entendido. O ${ref} aquece apenas ao conectar a fonte ou somente depois de apertar power?`;
    return 'Qual é a referência do componente na placa, por exemplo PU301, PQ10 ou PC45, e em que momento ele aquece?';
  }

  if (/\b(liga e desliga|liga por alguns segundos|tenta ligar|starta e corta|consumo sobe e cai)\b/.test(normalized)) {
    return 'Esse é ramo de liga/desliga. Me passe três dados: consumo antes do power, pico ao tentar ligar e qual tensão/rail aparece antes de cair.';
  }

  if (/\b(reinicia|reiniciando)\b/.test(normalized)) {
    return 'Ele reinicia antes de dar imagem ou já funcionando? Acontece parado ou somente sob carga?';
  }

  if (/\b(nao carrega bateria|nao carrega|bateria nao carrega|sem carga na bateria)\b/.test(normalized)) {
    return 'O notebook funciona normalmente pela fonte e apenas não carrega a bateria, ou também existe problema para ligar?';
  }

  if (/\b(usb nao funciona|usb sem funcionar|porta usb)\b/.test(normalized)) {
    return 'É uma porta USB específica ou todas? Existe 5 V nessa porta?';
  }

  if (/\b(sem som|audio nao funciona|nao sai som)\b/.test(normalized)) {
    return 'O sistema reconhece o dispositivo de áudio? O defeito é nos alto-falantes, no fone ou em todas as saídas?';
  }

  return null;
}

function getInstantIntent(prompt, options = {}) {
  if (options.analyzerContext) return null;

  const normalized = normalizeMessage(prompt);
  const model = options.model || 'llama3.2:3b';
  const recentText = buildRecentText(options.recentMessages || []);

  const unknownBoardModel = /\b(nao sei|não sei|nao tenho|não tenho|desconheco|desconheço|sem modelo|nao identifiquei|não identifiquei)\b/.test(normalized)
    && /\b(modelo|codigo|código|placa|board)\b/.test(normalized);
  if (unknownBoardModel) {
    return {
      type: 'instant:unknown-board-model',
      response: buildUnknownBoardModelResponse(),
    };
  }

  const mosfetAnswer = answerMosfetQuery(prompt, recentText);
  if (mosfetAnswer) {
    return {
      type: 'instant:mosfet',
      response: mosfetAnswer,
    };
  }

  const greetings = new Set([
    'oi', 'ola', 'e ai', 'eai', 'opa', 'bom dia', 'boa tarde',
    'boa noite', 'fala', 'salve', 'hello', 'hi',
  ]);

  const thanks = new Set([
    'obrigado', 'obrigada', 'valeu', 'vlw', 'show', 'beleza',
    'top', 'perfeito', 'deu certo',
  ]);

  const confirmations = new Set([
    'ok', 'sim', 'nao', 'não', 'certo', 'entendi', 'pode ser',
    'manda', 'bora', 'continuar',
  ]);

  const help = new Set(['ajuda', 'help', 'comandos', 'menu']);
  const analyzeOnly = new Set(['analisar', 'analise', 'análise']);

  const socialQuestions = /^(tudo bem|tudo certo|como vai|como vc esta|como voce esta|como esta|ta tudo bem|esta tudo bem|e ai tudo bem|oi tudo bem|ola tudo bem|bom dia tudo bem|boa tarde tudo bem|boa noite tudo bem)$/;

  if (socialQuestions.test(normalized) || isApproxSocial(normalized)) {
    return {
      type: 'instant:social',
      response: buildSocialResponse(normalized),
    };
  }

  if (greetings.has(normalized)) {
    return {
      type: 'instant:greeting',
      response: 'E ai! Pronto pra bancada. Me diga o equipamento e o sintoma, por exemplo: "notebook nao liga", "TV sem imagem" ou "fonte em curto".',
    };
  }

  if (thanks.has(normalized)) {
    return {
      type: 'instant:thanks',
      response: 'Fechado. Quando quiser, manda o equipamento, sintoma e qualquer medicao que eu te ajudo a seguir o diagnostico.',
    };
  }

  if (confirmations.has(normalized)) {
    return {
      type: 'instant:confirmation',
      response: 'Beleza. Me passa o proximo detalhe da bancada: equipamento, sintoma ou medicao.',
    };
  }

  if (help.has(normalized)) {
    return {
      type: 'instant:commands',
      response: buildCommandsResponse(),
    };
  }

  if (analyzeOnly.has(normalized)) {
    return {
      type: 'instant:analyze-needs-context',
      response: 'Beleza. Para iniciar a analise eu preciso primeiro do codigo/modelo da placa e do sintoma principal. Exemplo: "placa LA-6901P nao liga" ou "Acer A515 liga sem video". Depois disso abro o checklist com perguntas Sim/Nao. Se ja houver medicoes no mapa tecnico, use "analisar circuito".',
    };
  }

  if (/^(quem e voce|quem voce e|o que voce e|qual seu nome|me fale sobre voce)$/.test(normalized)) {
    return {
      type: 'instant:identity',
      response: 'Sou o Volt, seu assistente de bancada. Ajudo a organizar diagnósticos, consultar placas e esquemas, analisar medições e acompanhar o reparo passo a passo. O que temos para consertar hoje?',
    };
  }

  if (/^(o que voce faz|como voce ajuda|pra que voce serve|para que voce serve)$/.test(normalized)) {
    return {
      type: 'instant:capabilities',
      response: 'Eu ajudo a diagnosticar defeitos, organizar placas, consultar checklists, salvar contexto técnico e comparar casos de reparo. O que temos na bancada hoje?',
    };
  }

  const hasBasicNoPower = /\b(nao liga|nao ta ligando|nao esta ligando|não liga|sem ligar|morto)\b/.test(normalized);
  const hasBasicEquipment = /\b(notebook|note|laptop|pc|computador|desktop|placa|fonte|tv|televisao|monitor)\b/.test(normalized);
  const hasPowerTrip = hasAny(normalized, ['fonte desarma', 'desarma a fonte', 'fonte desarmando', 'derruba a fonte']);

  if ((hasBasicNoPower && hasBasicEquipment) || hasPowerTrip) {
    return {
      type: 'instant:basic-diagnostic',
      response: buildBasicNoPowerResponse(normalized),
    };
  }

  const symptomTriage = buildSymptomTriageResponse(normalized, recentText);
  if (symptomTriage && isShortMessage(normalized, 12)) {
    return {
      type: 'instant:symptom-triage',
      response: symptomTriage,
    };
  }

  const equipmentOnly = /\b(notebook|note|laptop|pc|computador|desktop|tv|televisao|monitor|fonte|placa)\b/.test(normalized)
    && !/\b(nao|não|sem|desarma|curto|imagem|video|liga|reinicia|aquece|carrega|usb|som)\b/.test(normalized)
    && isShortMessage(normalized, 8);

  if (equipmentOnly) {
    return {
      type: 'instant:equipment-only',
      response: buildEquipmentOnlyResponse(normalized),
    };
  }

  const symptomOnly = !hasBasicEquipment && /\b(nao liga|nao ta ligando|nao esta ligando|morto|sem sinal de vida|sem imagem|nao da video|tela preta|liga e desliga|tem curto)\b/.test(normalized);
  if (symptomOnly && isShortMessage(normalized, 10)) {
    return {
      type: 'instant:symptom-only',
      response: buildSymptomOnlyResponse(normalized),
    };
  }

  if (/^(qual modelo|modelo|modelo atual|qual ia|qual ai|qual llm)/.test(normalized)) {
    return {
      type: 'instant:model',
      response: `Modelo configurado: ${model}. O Ollama roda localmente no projeto, usando a pasta resources/ollama.`,
    };
  }

  if (/^(status|esta online|ta online|ollama|backend)$/.test(normalized)) {
    return {
      type: 'instant:status',
      response: `Estou online. Backend ativo, Ollama local configurado e modelo padrao: ${model}.`,
    };
  }

  if (isShortMessage(normalized) && /^(duvida|pergunta|problema|defeito|diagnostico|diagnostico rapido)$/.test(normalized)) {
    return {
      type: 'instant:needs-context',
      response: 'Me passa um pouco mais de contexto: qual equipamento, qual sintoma e quais tensoes ou sinais voce ja mediu?',
    };
  }

  return null;
}

module.exports = {
  getInstantIntent,
  normalizeMessage,
};
