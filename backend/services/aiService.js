const axios = require('axios');
const { buildKnowledgeBlock } = require('./knowledgeService');
const { buildBaseKnowledgeBlock } = require('./baseKnowledgeService');
const boardService = require('./boardService');
const checklistService = require('./checklistService');
const repairCaseService = require('./repairCaseService');
const { getInstantIntent } = require('./intentService');
const { buildSchematicContext } = require('./schematicContextService');
const { DEFAULT_GROQ_MODEL, generateGroqResponse } = require('./groqService');
const {
  estimateTokens,
  canUseGroq,
  trimToTokenBudget,
  getLimits,
} = require('./tokenBudgetService');

const OLLAMA_URL = 'http://localhost:11434/api/generate';
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b';
const AI_PROVIDER = process.env.AI_PROVIDER || 'hybrid';
const LOCAL_FIRST_MAX_CHARS = Number(process.env.LOCAL_FIRST_MAX_CHARS || 900);
const LOCAL_FIRST_TIMEOUT_MS = Number(process.env.LOCAL_FIRST_TIMEOUT_MS || 8000);

// Prompt de sistema: técnico de bancada experiente — modo CONVERSACIONAL
const SYSTEM_PROMPT = `Você é o Volt, assistente técnico de eletrônica de bancada. Responda SEMPRE em português do Brasil.

PERSONALIDADE:
- Tom direto, prático e amigável — como um colega de bancada experiente.
- Use linguagem simples, sem exagero de termos rebuscados.
- Em saudações seja descontraído: "E aí!" / "Olá!" / "Oi, tudo bem?" são bem-vindos.
- Nunca seja formal demais nem robótico. Mostre que entende o dia a dia de bancada.
- Pode usar humor leve e reagir com empatia quando o problema for difícil.

MODO DE COMPORTAMENTO:
- Se a mensagem for uma saudação (oi, olá, bom dia, etc.) ou for vaga sem contexto técnico:
  Responda com uma saudação curta com personalidade e ofereça as opções disponíveis. Exemplo:
  "E aí! Pronto pra resolver esse defeito. O que tá acontecendo?
   • Equipamento não liga
   • Sem imagem / sem vídeo
   • Reinicia sozinho
   • Outro problema — descreva"

- Se a mensagem mencionar um problema técnico, mas NÃO informar equipamento/tipo de placa:
  Faça UMA pergunta objetiva para identificar o equipamento antes de dar diagnóstico.
  Exemplo: "Qual o equipamento? (notebook, TV, fonte, placa?)"

- Se a mensagem já informar equipamento ou tipo de placa + sintoma específico:
  Avance direto no diagnóstico inicial. Não pergunte de novo o equipamento.

- Se não tiver informação suficiente no contexto, diga claramente:
  "Não tenho dados cadastrados sobre isso."
  E então SEMPRE sugira o comando adequado para o usuário adicionar.

- NUNCA despeje listas longas de informação sem ser perguntado.
- NUNCA invente valores ou especificações técnicas.
- Respostas curtas e diretas — no máximo 5 linhas sem necessidade do usuário pedir mais.

SEÇÃO DE CONHECIMENTO TÉCNICO ARMAZENADO:
- Se o contexto incluir uma seção "## Conhecimento técnico armazenado", esses são REGISTROS DE DIAGNÓSTICO do banco de dados.
- Formato: [categoria/titulo] conteudo — são entradas técnicas de referência, NÃO perfis de pessoas.
- Use esse conhecimento APENAS se for relevante para o problema técnico descrito na mensagem.
- NUNCA inicie conversa sobre o conteúdo de uma entrada — aguarde uma pergunta técnica relacionada.
- Exemplo: a entrada [fonte/não liga] é um dado técnico sobre fontes, não sobre a palavra "fonte".

CASOS DE REPARO:
- Se o contexto incluir "=== CASOS DE REPARO RELEVANTES ===", trate como histórico real da bancada.
- Use esses casos para comparar sintomas, medições, causas e soluções anteriores.
- Não diga que é certeza: apresente como "caso parecido" ou "suspeita baseada no histórico".

SUGESTÃO DE COMANDOS (obrigatório ao final de respostas relevantes):
- Ao final de qualquer diagnóstico ou dica técnica, sugira 1 ou 2 comandos que o usuário pode usar.
- Use o formato: "💡 Dica: <comando> — <descrição curta>"
- Exemplos de sugestões:
  • Após diagnóstico: "💡 addcontexto — salva minha resposta para uso futuro"
  • Após mencionar placa: "💡 adicionar na placa <modelo>: <obs> — registra uma observação"
  • Após checklist: "💡 adicionar checklist: <problema> | <passo1>, <passo2> — cria novo checklist"
  • Quando não encontrar info: "💡 addcontexto: <fato> — adiciona essa informação ao meu contexto"
- Não sugira comandos em respostas de saudação ou mensagens muito simples.`;

// Palavras-chave que indicam uma pergunta técnica de eletrônica
const TECH_KEYWORDS = [
  'não liga', 'nao liga', 'sem imagem', 'sem video', 'sem vídeo', 'reinicia',
  'curto', 'tensão', 'tensao', 'voltagem', 'componente', 'resistor', 'capacitor',
  'transistor', 'diodo', 'mosfet', 'fonte', 'fusível', 'fusivel', 'multímetro',
  'multimetro', 'osciloscopio', 'placa', 'notebook', 'televisão', 'televisao',
  'defeito', 'queimado', 'esquema', 'circuito', 'medir', 'medição', 'medicao',
  'testar', 'diagnóstico', 'diagnostico', 'reparo', 'soldar', 'trilha', 'gnd',
  'vcc', 'ohm', '3.3v', '5v', '12v', '19v', 'aquece', 'esquenta', 'liga nao',
  'dcin', 'acdet', 'acdrv', 'bq24781', 'gate', 'source', 'drain', 'bootstrap',
  'charger', 'carregamento', 'analisador', 'falha', 'pino', 'medido', 'esperado',
];

/**
 * Detecta se a mensagem tem conteúdo técnico de eletrônica.
 * Se não tiver, não injeta a base estática para não poluir o modelo.
 */
function isTechMessage(message) {
  const lower = message.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return TECH_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Constrói contexto inteligente baseado na mensagem do usuário:
 * - Detecta placas cadastradas mencionadas
 * - Detecta checklists relevantes para o problema descrito
 */
function buildSmartContext(message) {
  let context = '';

  // ── Busca placas mencionadas ──────────────────────────────────────────────
  const mentionedBoards = boardService.findByMention(message);

  if (mentionedBoards.length > 0) {
    context += '\n\n=== PLACAS REGISTRADAS NO SISTEMA ===\n';
    for (const board of mentionedBoards) {
      context += `Placa: ${board.marca} ${board.modelo}\n`;
      if (board.defects?.length > 0) {
        context += `Defeitos registrados:\n`;
        board.defects.forEach(d => { context += `  - ${d.nome}: ${d.descricao}\n`; });
      }
      if (board.notas?.length > 0) {
        context += `Notas técnicas:\n`;
        board.notas.forEach(n => { context += `  - ${n.texto}\n`; });
      }
      if (board.voltagePoints?.length > 0) {
        context += `Pontos de tensão esperados:\n`;
        board.voltagePoints.forEach(vp => {
          const comp = vp.componente ? ` | Componente: ${vp.componente}` : '';
          const obs  = vp.observacao  ? ` (${vp.observacao})`            : '';
          context += `  - ${vp.ref}: ${vp.tensao}${comp}${obs}\n`;
        });
      }
      if (!board.defects?.length && !board.notas?.length && !board.voltagePoints?.length) {
        context += `  (Sem defeitos ou notas cadastradas)\n`;
      }
    }
  } else {
    // Verifica se a mensagem parece perguntar sobre uma placa/notebook não cadastrado
    const hasBoardTopic = /\b(placa|notebook|laptop|pc|computador)\b/i.test(message);
    const hasModelPattern = /\b[a-zA-Z]{2,}\s+\d{3,}\b/.test(message); // ex: "dell 3434"
    if (hasBoardTopic && hasModelPattern) {
      context += '\n\nNota ao assistente: nenhuma placa com esse modelo foi encontrada no banco de dados. Informe o usuário que não temos esse modelo cadastrado e prossiga com os checklists de diagnóstico básico disponíveis.\n';
    }
  }

  // ── Checklists relevantes ─────────────────────────────────────────────────
  context += checklistService.buildChecklistBlock(message);

  // ── Casos de reparo reais da bancada ──────────────────────────────────────
  if (isTechMessage(message)) {
    context += repairCaseService.buildRepairCasesBlock(message, mentionedBoards);
  }

  return context;
}

async function buildRemoteContext(message, analyzerContext = null) {
  const mentionedBoards = boardService.findByMention(message);
  const isTech = isTechMessage(message);

  const context = [
    isTech ? buildBaseKnowledgeBlock(message) : '',
    isTech ? buildKnowledgeBlock(message) : '',
    buildSmartContext(message),
    await buildSchematicContext(message, mentionedBoards),
    analyzerContext ? `\n\n=== CONTEXTO DO ANALISADOR ===\n${analyzerContext}` : '',
  ].filter(Boolean).join('\n');

  const limits = getLimits();
  const reservedSystemAndPromptTokens = estimateTokens(SYSTEM_PROMPT) + estimateTokens(message) + 450;
  const contextBudget = Math.max(700, limits.maxInputTokens - reservedSystemAndPromptTokens);

  return trimToTokenBudget(context, contextBudget);
}

function buildRemoteSystemPrompt(context) {
  return [
    'Você é o Volt, assistente técnico de eletrônica de bancada. Responda sempre em português do Brasil.',
    'Esta chamada já foi classificada pelo Volt como pergunta técnica; não responda com saudação, menu ou triagem inicial.',
    'Se a pergunta mencionar notebook, TV, fonte, placa, modelo ou marca, considere que o equipamento já foi informado.',
    'Se houver equipamento + sintoma, avance direto com hipótese provável, medições e próximos passos.',
    'Use o contexto local filtrado como prioridade. Se não houver placa ou esquema cadastrado, diga isso em uma frase e siga com checklist geral de bancada.',
    'Nunca invente valores específicos do esquema. Quando faltar dado, peça uma medição objetiva.',
    'Para fonte que desarma ao plugar em notebook, priorize curto na linha de entrada: DC JACK, DCIN, VIN, B+, MOSFETs de entrada, capacitor cerâmico em curto e charger.',
    'Resposta curta, técnica e acionável: 4 a 8 passos no máximo.',
    context ? `\n\n=== CONTEXTO LOCAL FILTRADO ===\n${context}` : '',
  ].filter(Boolean).join('\n');
}

function buildLocalFirstSystemPrompt(context) {
  return [
    'Você é o Volt em modo triagem local offline.',
    'Tente responder usando somente conhecimento local e contexto fornecido.',
    'Se a pergunta precisar de análise mais forte, esquema específico, contexto insuficiente ou você estiver inseguro, responda exatamente: NEED_API.',
    'Se conseguir ajudar de forma útil, responda em português do Brasil com no máximo 6 linhas, técnico e direto.',
    'Para fonte que desarma ao plugar em notebook, você pode responder localmente se souber orientar curto na entrada 19V, DCIN, VIN, B+, MOSFETs de entrada, capacitor em curto e charger.',
    context ? `\n\n=== CONTEXTO LOCAL ===\n${context}` : '',
  ].filter(Boolean).join('\n');
}

function shouldEscalateLocalAnswer(answer) {
  const text = String(answer || '').trim();
  if (!text) return true;
  if (/^NEED_API\b/i.test(text)) return true;
  if (text.length > LOCAL_FIRST_MAX_CHARS) return true;
  if (/nao tenho dados cadastrados|não tenho dados cadastrados|nao tenho informacao suficiente|não tenho informação suficiente/i.test(text)) return true;
  return false;
}

/**
 * Envia um prompt para o modelo Ollama local e retorna a resposta.
 *
 * @param {string} prompt           - Mensagem do usuário
 * @param {string} [model]          - Modelo Ollama a utilizar (padrão: Llama 3.2 3B)
 * @param {string|null} [analyzerContext] - Contexto do analisador de circuito (opcional)
 * @returns {Promise<string>} Resposta gerada pelo modelo
 */
async function generateResponse(prompt, model = DEFAULT_MODEL, analyzerContext = null, options = {}) {
  const startedAt = Date.now();
  const requestId = Math.random().toString(36).slice(2, 8);
  const forceApi = Boolean(options.forceApi);
  const flowId = options.chatId || requestId;
  const instantIntent = getInstantIntent(prompt, {
    analyzerContext,
    model,
    recentMessages: options.recentMessages || [],
  });

  if (instantIntent) {
    console.log(`[FLUXO IA:${flowId}] Atalho local instantaneo respondido | tipo=${instantIntent.type} | sem API | sem Ollama`);
    console.log(`[IA:${requestId}] ROTA: LOCAL-INSTANT | tipo=${instantIntent.type} | sem API | sem Ollama | prompt=${prompt.length} chars`);
    console.log(`[RESUMO IA:${flowId}] Usada: LOCAL-INSTANT | modelo=regra_local | tempo=${Date.now() - startedAt}ms | tokens_api=0`);
    return {
      text: instantIntent.response,
      meta: {
        route: 'LOCAL-INSTANT',
        provider: 'local-rule',
        model: 'regra_local',
        usedApi: false,
        requestId,
        flowId,
      },
    };
  }

  if (AI_PROVIDER === 'hybrid' || AI_PROVIDER === 'groq') {
    const remoteContext = await buildRemoteContext(prompt, analyzerContext);

    if (!forceApi && AI_PROVIDER === 'hybrid') {
      console.log(`[FLUXO IA:${flowId}] Modo avancado desligado: tentando Llama local primeiro`);
      console.log(`[IA:${requestId}] ROTA: LOCAL-OLLAMA tentativa_pre_api | modelo=${model} | api_forcada=false`);
      const localAttempt = await generateLocalResponse(
        prompt,
        model,
        analyzerContext,
        requestId,
        startedAt,
        {
          systemOverride: buildLocalFirstSystemPrompt(trimToTokenBudget(remoteContext, 900)),
          purpose: 'tentativa_pre_api',
          timeoutMs: LOCAL_FIRST_TIMEOUT_MS,
          ollamaOptions: { num_predict: 220 },
        }
      ).catch((error) => {
        const timedOut = error.code === 'ECONNABORTED' || /timeout/i.test(error.message);
        console.warn(`[FLUXO IA:${flowId}] Llama local nao entregou resposta util | motivo=${timedOut ? 'timeout' : 'erro'} | escalando para API`);
        console.warn(`[IA:${requestId}] LOCAL-OLLAMA tentativa_pre_api ${timedOut ? 'timeout' : 'falhou'} | ${error.message}`);
        return {
          text: 'NEED_API',
          meta: {
            route: 'LOCAL-OLLAMA',
            provider: 'ollama',
            model,
            usedApi: false,
            requestId,
            flowId,
          },
        };
      });

      if (!shouldEscalateLocalAnswer(localAttempt.text)) {
        console.log(`[FLUXO IA:${flowId}] Llama local respondeu e a API nao foi chamada | saida=${localAttempt.text.length} chars`);
        console.log(`[IA:${requestId}] ROTA: LOCAL-OLLAMA resposta_util | API nao chamada | resposta=${localAttempt.text.length} chars`);
        console.log(`[RESUMO IA:${flowId}] Usada: LLAMA-LOCAL | modelo=${model} | tempo=${Date.now() - startedAt}ms | tokens_api=0`);
        return localAttempt;
      }

      console.log(`[FLUXO IA:${flowId}] Llama local verificou, mas nao teve resposta util | chamando API Groq`);
      console.log(`[IA:${requestId}] ROTA: LOCAL-OLLAMA sem_resposta_util | escalando_para=API-GROQ`);
    } else if (forceApi) {
      console.log(`[FLUXO IA:${flowId}] Modo avancado ligado: pulando Llama local e chamando API Groq direto`);
      console.log(`[IA:${requestId}] ROTA: API-GROQ forçada pelo modo avançado`);
    }

    const remoteSystem = buildRemoteSystemPrompt(remoteContext);
    const inputTokens = estimateTokens(remoteSystem) + estimateTokens(prompt);
    const budget = canUseGroq(inputTokens);

    if (!budget.ok) {
      const waitSeconds = Math.ceil(budget.resetInMs / 1000);
      console.warn(`[FLUXO IA:${flowId}] API Groq bloqueada pelo limite local | aguardar≈${waitSeconds}s | usando local`);
      console.warn(`[IA:${requestId}] Groq pausada por limite local | input=${inputTokens} tokens | usados_min=${budget.minuteTokens}/${budget.limits.tpm} | usados_dia=${budget.dayTokens}/${budget.limits.tpd}`);
      if (AI_PROVIDER === 'groq') {
        throw new Error(`Limite local da Groq quase estourado. Aguarde cerca de ${waitSeconds}s e tente novamente.`);
      }
      console.log(`[IA:${requestId}] ROTA: LOCAL-OLLAMA | motivo=limite_api_groq | modelo=${model}`);
      return generateLocalResponse(prompt, model, analyzerContext, requestId, startedAt, { flowId });
    }

    console.log(`[FLUXO IA:${flowId}] API Groq processando | modelo=${DEFAULT_GROQ_MODEL} | entrada_estimada≈${inputTokens} tokens | saida_max=${getLimits().maxOutputTokens}`);
    console.log(`[IA:${requestId}] ROTA: API-GROQ | modelo=${DEFAULT_GROQ_MODEL} | input_estimado≈${inputTokens} tokens | contexto≈${estimateTokens(remoteContext)} tokens | saida_max=${getLimits().maxOutputTokens} tokens`);
    const groq = await generateGroqResponse({
      system: remoteSystem,
      prompt,
      model: DEFAULT_GROQ_MODEL,
      maxCompletionTokens: getLimits().maxOutputTokens,
    }).catch((error) => {
      console.error(`[IA:${requestId}] Falha na Groq apos ${Date.now() - startedAt}ms: ${error.message}`);
      if (AI_PROVIDER === 'hybrid') return null;
      throw error;
    });

    if (!groq) {
      console.log(`[FLUXO IA:${flowId}] API Groq falhou | voltando para Llama local`);
      console.log(`[IA:${requestId}] ROTA: LOCAL-OLLAMA | motivo=fallback_api_groq | modelo=${model}`);
      return generateLocalResponse(prompt, model, analyzerContext, requestId, startedAt, { flowId });
    }

    if (groq.rateLimit?.remainingTokens) {
      console.log(`[IA:${requestId}] Groq rate-limit | tokens_restantes_min=${groq.rateLimit.remainingTokens} | reset=${groq.rateLimit.resetTokens || '-'}`);
    }
    const usageNote = groq.usage?.estimated ? 'estimado' : 'api';
    console.log(`[FLUXO IA:${flowId}] API Groq respondeu | entrada=${groq.usage.promptTokens} tokens | saida=${groq.usage.completionTokens} tokens | total=${groq.usage.totalTokens} tokens | tempo=${Date.now() - startedAt}ms`);
    console.log(`[IA:${requestId}] ROTA: API-GROQ concluida | modelo=${groq.model} | tempo=${Date.now() - startedAt}ms | tokens_${usageNote}=entrada:${groq.usage.promptTokens} saida:${groq.usage.completionTokens} total:${groq.usage.totalTokens} | resposta=${groq.text.length} chars`);
    console.log(`[RESUMO IA:${flowId}] Usada: API-GROQ | modelo=${groq.model} | tempo=${Date.now() - startedAt}ms | entrada=${groq.usage.promptTokens} tokens | saida=${groq.usage.completionTokens} tokens | total=${groq.usage.totalTokens} tokens`);
    return {
      text: groq.text,
      meta: {
        route: 'API-GROQ',
        provider: 'groq',
        model: groq.model,
        usedApi: true,
        requestId,
        flowId,
        usage: groq.usage,
        rateLimit: groq.rateLimit || null,
      },
    };
  }

  return generateLocalResponse(prompt, model, analyzerContext, requestId, startedAt, { flowId });
}

async function generateLocalResponse(prompt, model = DEFAULT_MODEL, analyzerContext = null, requestId = Math.random().toString(36).slice(2, 8), startedAt = Date.now(), options = {}) {
  const flowId = options.flowId || requestId;
  // Injeta a data real e o conhecimento armazenado pelo operador
  const hoje = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const isTech = isTechMessage(prompt);
  const smartContext = buildSmartContext(prompt);

  // Só injeta trechos indexados da base técnica se a pergunta tiver conteúdo técnico.
  // Mensagens simples (Oi, obrigado, etc.) não recebem contexto técnico.
  const systemComData = [
    `${SYSTEM_PROMPT}\nData de hoje: ${hoje}.`,
    isTech ? buildBaseKnowledgeBlock(prompt) : '',
    isTech ? buildKnowledgeBlock(prompt) : '',  // busca contextual por similaridade
    smartContext, // contexto de placas/checklists sempre injeta se detectado
    analyzerContext ? `\n\n${analyzerContext}\n\nVocê tem acesso às medições reais de bancada acima. Use essas informações para diagnosticar o circuito de forma objetiva. Priorize pontos com FALHA. Sugira próximos passos de verificação para o técnico.` : '',
  ].filter(Boolean).join('\n');

  const systemPrompt = options.systemOverride || systemComData;
  const payload = {
    model,
    prompt,
    system: systemPrompt,
    stream: false,
    ...(options.ollamaOptions ? { options: options.ollamaOptions } : {}),
  };

  const purpose = options.purpose ? ` | tipo=${options.purpose}` : '';
  if (options.purpose === 'tentativa_pre_api') {
    console.log(`[FLUXO IA:${flowId}] Llama local processando triagem | modelo=${model} | timeout=${options.timeoutMs || 180000}ms`);
  } else {
    console.log(`[FLUXO IA:${flowId}] Llama local processando resposta | modelo=${model}`);
  }
  console.log(`[IA:${requestId}] ROTA: LOCAL-OLLAMA | modelo=${model}${purpose} | sem API | prompt=${prompt.length} chars | contexto=${String(systemPrompt).length} chars`);

  const response = await axios.post(OLLAMA_URL, payload, {
    timeout: options.timeoutMs || 180000, // 3 minutos no modo normal; curto na triagem local.
  }).catch((error) => {
    console.error(`[IA:${requestId}] Falha na chamada ao Ollama apos ${Date.now() - startedAt}ms: ${error.message}`);
    if (error.response?.status === 404) {
      throw new Error(
        `Modelo "${model}" não encontrado. Execute: ollama pull ${model}`
      );
    }
    if (error.response?.status === 500) {
      // Extrai a mensagem real do Ollama (ex: "model requires more system memory")
      const ollamaMsg = error.response?.data?.error || error.message;
      if (ollamaMsg.includes('system memory') || ollamaMsg.includes('memory')) {
        throw new Error(
          `RAM insuficiente para carregar o modelo "${model}".\n` +
          `Detalhe: ${ollamaMsg}\n\n` +
          `Solução: use um modelo menor. Execute:\n  ollama pull phi3.5:mini`
        );
      }
      throw new Error(`Ollama retornou erro: ${ollamaMsg}`);
    }
    if (error.code === 'ECONNREFUSED') {
      throw new Error('Não foi possível conectar ao Ollama. Certifique-se de que ele está rodando em http://localhost:11434');
    }
    throw error;
  });

  const answer = response.data.response || '';
  if (options.purpose === 'tentativa_pre_api') {
    console.log(`[FLUXO IA:${flowId}] Llama local respondeu na triagem | saida=${answer.length} chars | tempo=${Date.now() - startedAt}ms`);
  } else {
    console.log(`[FLUXO IA:${flowId}] Llama local respondeu ao usuario | saida=${answer.length} chars | tempo=${Date.now() - startedAt}ms`);
    console.log(`[RESUMO IA:${flowId}] Usada: LLAMA-LOCAL | modelo=${model} | tempo=${Date.now() - startedAt}ms | tokens_api=0`);
  }
  console.log(`[IA:${requestId}] ROTA: LOCAL-OLLAMA concluida | modelo=${model} | status=${response.status} | tempo=${Date.now() - startedAt}ms | resposta=${answer.length} chars`);

  return {
    text: answer,
    meta: {
      route: 'LOCAL-OLLAMA',
      provider: 'ollama',
      model,
      usedApi: false,
      requestId,
      flowId,
    },
  };
}

module.exports = { generateResponse };
