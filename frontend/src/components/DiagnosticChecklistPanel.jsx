import { useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL || '/api';

const CHECKLIST_ITEMS = [
  { id: 'genericTriage', label: 'Triagem geral sem modelo iniciada' },
  { id: 'boardIdentified', label: 'Modelo da placa identificado' },
  { id: 'noPower', label: 'Sintoma classificado: nao liga' },
  { id: 'adapterDisarms', label: 'Fonte desarma ao conectar' },
  { id: 'shortInput', label: 'Suspeita de curto na entrada' },
  { id: 'check19v', label: 'Verificar linha principal de 19V' },
  { id: 'checkDcin', label: 'Verificar DCIN / VIN / B+' },
  { id: 'checkInputMosfets', label: 'Verificar MOSFETs de entrada' },
  { id: 'checkCharger', label: 'Verificar CI charger / gate drive' },
];

function itemStatus(state) {
  if (state === 'done') {
    return {
      badge: 'OK',
      row: 'border-emerald-700/40 bg-emerald-950/30',
      dot: 'bg-emerald-400',
      text: 'text-emerald-200',
      badgeClass: 'bg-emerald-900/60 text-emerald-300',
    };
  }

  if (state === 'current') {
    return {
      badge: 'Agora',
      row: 'border-amber-700/40 bg-amber-950/20',
      dot: 'bg-amber-400',
      text: 'text-amber-100',
      badgeClass: 'bg-amber-900/60 text-amber-300',
    };
  }

  return {
    badge: 'Pendente',
    row: 'border-slate-800 bg-slate-900/60',
    dot: 'bg-slate-600',
    text: 'text-slate-400',
    badgeClass: 'bg-slate-800 text-slate-500',
  };
}

function DecisionCard({ question, value, onChange, yesLabel = 'Sim', noLabel = 'Nao' }) {
  return (
    <div className="border border-slate-800 rounded-lg bg-slate-900/60 px-4 py-3">
      <p className="text-sm text-slate-200 font-medium mb-3">{question}</p>
      <div className="flex gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => onChange('yes')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${value === 'yes' ? 'bg-emerald-700 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
        >
          {yesLabel}
        </button>
        <button
          type="button"
          onClick={() => onChange('no')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${value === 'no' ? 'bg-rose-700 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
        >
          {noLabel}
        </button>
      </div>
    </div>
  );
}

function GuidanceBox({ tone = 'amber', title, children }) {
  const classes = tone === 'blue'
    ? 'border-blue-800/40 bg-blue-950/20 text-blue-300'
    : tone === 'red'
      ? 'border-rose-800/40 bg-rose-950/20 text-rose-300'
      : 'border-amber-800/40 bg-amber-950/20 text-amber-300';
  const titleClass = tone === 'blue' ? 'text-blue-200' : tone === 'red' ? 'text-rose-200' : 'text-amber-200';

  return (
    <div className={`border rounded-lg px-4 py-3 ${classes}`}>
      <p className={`text-sm font-medium ${titleClass}`}>{title}</p>
      <div className="text-xs mt-2 leading-relaxed">{children}</div>
    </div>
  );
}

function buildComponentAnalysisContext({ ref, checklist, state, activeSchematic, componentContext, entryComponents }) {
  const matchedEntry = entryComponents.find((item) => String(item.ref || '').toUpperCase().includes(ref));
  const circuitBlock = componentContext?.circuitBlock || {};
  const formatRefs = (items, emptyText) => Array.isArray(items) && items.length
    ? items.map((item) => `- ${item.ref}: ${item.role || 'referencia do bloco'}`).join('\n')
    : emptyText;
  const pins = Array.isArray(componentContext?.pins) && componentContext.pins.length
    ? componentContext.pins.map((pin) => `- pino ${pin.number}: ${pin.name} (${pin.kind || 'sinal'})`).join('\n')
    : 'Nenhum pino foi extraido automaticamente do texto do PDF.';
  const powerPins = Array.isArray(componentContext?.powerPins) && componentContext.powerPins.length
    ? componentContext.powerPins.map((pin) => `- pino ${pin.number}: ${pin.name} (${pin.kind || 'alimentacao/sense'})`).join('\n')
    : 'Nenhum pino de alimentacao/GND/sense foi identificado automaticamente.';
  const snippets = componentContext?.snippets?.length
    ? componentContext.snippets.map((snippet, index) => `Trecho ${index + 1}:\n${snippet}`).join('\n\n')
    : 'Nenhum trecho especifico encontrado no texto extraido do PDF.';
  const circuitSnippets = Array.isArray(circuitBlock.snippets) && circuitBlock.snippets.length
    ? circuitBlock.snippets.join('\n')
    : 'Nenhum trecho do bloco foi extraido automaticamente.';

  return [
    '=== ANALISE AVANCADA DE COMPONENTE AQUECENDO ===',
    `Componente informado: ${ref}`,
    `Placa: ${checklist?.boardModel || checklist?.deviceModel || 'nao informada'}`,
    `Sintoma: ${checklist?.symptom || 'nao informado'}`,
    `Esquema aberto: ${activeSchematic?.label || activeSchematic?.title || activeSchematic?.path || 'nao informado'}`,
    `Fluxo: powerOn=${state.powerOn || '-'} | noVideo=${state.noVideo || '-'} | dcin=${state.dcinPresent || '-'} | shunt=${state.shuntPresent || '-'} | curtoShunt=${state.shortAtShunt || '-'} | curtoAposShunt=${state.shortAfterShunt || '-'} | injecao=${state.injectionDone || '-'}`,
    matchedEntry ? `Componente no painel local: ${matchedEntry.ref} — ${matchedEntry.role}` : 'Componente nao estava na lista local de entrada.',
    componentContext?.component ? `Classificacao pelo PDF: ${componentContext.component.ref} — ${componentContext.component.role}` : 'Sem classificacao direta pelo PDF.',
    `Nome/part number extraido: ${componentContext?.partNumber || componentContext?.component?.partNumber || 'nao encontrado'}`,
    `Circuito provavel: ${circuitBlock.title || componentContext?.circuit || componentContext?.component?.circuit || 'nao classificado'}`,
    `Rails/nets principais: ${Array.isArray(circuitBlock.rails) && circuitBlock.rails.length ? circuitBlock.rails.join(', ') : 'nao extraido'}`,
    `Sinais principais: ${Array.isArray(circuitBlock.keySignals) && circuitBlock.keySignals.length ? circuitBlock.keySignals.slice(0, 45).join(', ') : 'nao extraido'}`,
    '',
    '=== PINOS EXTRAIDOS DO COMPONENTE ===',
    pins,
    '',
    '=== PINOS DE ALIMENTACAO/GND/SENSE DESTACADOS ===',
    powerPins,
    '',
    '=== COMPONENTES DO BLOCO DO CIRCUITO ===',
    'Controladores:',
    formatRefs(circuitBlock.controllers, 'Nenhum controlador extraido.'),
    '',
    'MOSFETs:',
    formatRefs(circuitBlock.mosfets, 'Nenhum MOSFET extraido.'),
    '',
    'Indutores:',
    formatRefs(circuitBlock.inductors, 'Nenhum indutor extraido.'),
    '',
    'Sense/feedback/passivos relevantes:',
    formatRefs(circuitBlock.senseAndFeedback, 'Nenhum passivo relevante extraido.'),
    '',
    '=== TRECHOS DO BLOCO DO CIRCUITO ===',
    circuitSnippets,
    '',
    '=== TRECHOS FILTRADOS DO ESQUEMA ===',
    snippets,
  ].join('\n');
}

function ComponentHeatingAnalysis({ state, onChange, checklist, activeSchematic, entryComponents }) {
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState('');
  const [error, setError] = useState('');
  const [meta, setMeta] = useState(null);
  const [componentContext, setComponentContext] = useState(null);
  const ref = String(state.heatingComponent || '').trim().toUpperCase();

  async function analyzeComponent() {
    if (!ref) {
      setError('Informe qual componente aqueceu, por exemplo PQ302, PR14 ou PU301.');
      return;
    }

    setLoading(true);
    setError('');
    setAnalysis('');
    setMeta(null);
    setComponentContext(null);

    try {
      let nextComponentContext = { ref, snippets: [], component: null };
      if (activeSchematic?.path) {
        const contextRes = await fetch(`${API_URL}/schematic/component-context`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: activeSchematic.path, ref }),
        });
        const contextData = await contextRes.json();
        if (contextRes.ok) nextComponentContext = contextData;
      }
      setComponentContext(nextComponentContext);

      const analyzerContext = buildComponentAnalysisContext({
        ref,
        checklist,
        state,
        activeSchematic,
        componentContext: nextComponentContext,
        entryComponents,
      });

      const res = await fetch(`${API_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          forceApi: true,
          analyzerContext,
          message:
            `O componente ${ref} aqueceu durante injecao baixa de tensao em uma placa com suspeita de curto. ` +
            'Analise o circuito usando obrigatoriamente os campos estruturados do contexto: nome/part number, circuito provavel, rails/nets, pinos extraidos, pinos de alimentacao/GND/sense e componentes do bloco. Explique o que e o componente, qual setor ele pertence, quais pinos medir para GND, quais pinos parecem alimentacao, quais MOSFETs/indutores/passivos do bloco podem estar relacionados, se faz sentido remover para isolar o curto, e quais testes fazer depois de remover. Nao invente tensao ou pino ausente; quando faltar dado, diga exatamente o que faltou.',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao analisar componente.');
      setAnalysis(data.response || '');
      setMeta(data.meta || null);
    } catch (err) {
      setError(err.message || 'Erro ao analisar componente.');
    } finally {
      setLoading(false);
    }
  }

  const usage = meta?.usage;
  const circuitBlock = componentContext?.circuitBlock || {};
  const powerPins = componentContext?.powerPins || [];

  return (
    <div className="border border-blue-900/50 bg-blue-950/20 rounded-lg px-4 py-3">
      <p className="text-sm font-medium text-blue-100 mb-2">Qual componente aqueceu?</p>
      <div className="flex gap-2 flex-wrap">
        <input
          value={state.heatingComponent || ''}
          onChange={(event) => onChange('heatingComponent', event.target.value.toUpperCase())}
          placeholder="Ex: PQ302, PR14, PU301"
          className="min-w-[180px] flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500 font-mono"
        />
        <button
          type="button"
          onClick={analyzeComponent}
          disabled={loading || !ref}
          className="px-3 py-2 rounded-lg text-xs font-semibold bg-blue-700 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Analisando...' : 'Analisar pela API'}
        </button>
      </div>
      <p className="text-xs text-slate-400 mt-2">
        Essa etapa envia somente o componente e trechos filtrados do esquema para a API, para identificar setor, linha de alimentacao e proximos testes.
      </p>

      {error && <p className="text-xs text-rose-300 mt-3">{error}</p>}
      {componentContext && (
        <div className="mt-3 border border-slate-800 bg-slate-950/70 rounded-lg p-3">
          <p className="text-xs font-semibold text-blue-300 mb-2">Pacote local do circuito</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <div className="border border-slate-800 rounded-md px-3 py-2">
              <p className="text-slate-500">Componente</p>
              <p className="font-mono text-slate-200">{componentContext.ref}</p>
              <p className="text-slate-400 break-words">{componentContext.partNumber || 'part number nao extraido'}</p>
            </div>
            <div className="border border-slate-800 rounded-md px-3 py-2">
              <p className="text-slate-500">Circuito</p>
              <p className="text-slate-200 break-words">{circuitBlock.title || componentContext.circuit || 'nao classificado'}</p>
              <p className="text-slate-500">{componentContext.component?.role || ''}</p>
            </div>
          </div>
          {powerPins.length > 0 && (
            <div className="mt-2">
              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500 mb-1">Pinos alimentacao/GND/sense</p>
              <div className="flex flex-wrap gap-1.5">
                {powerPins.slice(0, 16).map((pin) => (
                  <span key={`${pin.number}-${pin.name}`} className="px-2 py-1 rounded bg-slate-900 border border-slate-800 text-[11px] text-slate-300">
                    {pin.number}: {pin.name}
                  </span>
                ))}
              </div>
            </div>
          )}
          {Array.isArray(circuitBlock.mosfets) && circuitBlock.mosfets.length > 0 && (
            <div className="mt-2">
              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500 mb-1">MOSFETs do bloco</p>
              <p className="text-xs text-slate-300 font-mono break-words">{circuitBlock.mosfets.slice(0, 18).map((item) => item.ref).join(', ')}</p>
            </div>
          )}
        </div>
      )}
      {analysis && (
        <div className="mt-3 border border-slate-800 bg-slate-950/70 rounded-lg p-3">
          <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
            <p className="text-xs font-semibold text-blue-300">Analise avancada do componente</p>
            {usage && (
              <span className="text-[11px] text-rose-300">
                API tokens: entrada {usage.promptTokens ?? usage.prompt_tokens ?? usage.input_tokens ?? '-'} · saida {usage.completionTokens ?? usage.completion_tokens ?? usage.output_tokens ?? '-'} · total {usage.totalTokens ?? usage.total_tokens ?? '-'}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-200 whitespace-pre-wrap leading-relaxed">{analysis}</p>
        </div>
      )}
    </div>
  );
}

function FlowQuestions({ state = {}, onChange = () => {}, entryComponents = [], checklist, activeSchematic }) {
  const route = state.powerState || '';
  const isNoPower = route === 'no-power' || state.powerOn === 'no';
  const isNoVideo = route === 'no-video' || state.noVideo === 'yes';

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <DecisionCard
          question="Liga?"
          value={state.powerOn}
          onChange={(value) => onChange('powerOn', value)}
        />
        <DecisionCard
          question="Liga sem video?"
          value={state.noVideo}
          onChange={(value) => onChange('noVideo', value)}
        />
      </div>

      {isNoPower && (
        <DecisionCard
          question="Tem tensao no DC jack / entrada principal?"
          value={state.dcinPresent}
          onChange={(value) => onChange('dcinPresent', value)}
        />
      )}

      {isNoPower && state.dcinPresent === 'yes' && (
        <DecisionCard
          question="A tensao chega ao resistor shunt / lado da linha principal?"
          value={state.shuntPresent}
          onChange={(value) => onChange('shuntPresent', value)}
        />
      )}

      {isNoPower && state.dcinPresent === 'yes' && state.shuntPresent === 'no' && (
        <DecisionCard
          question="Existe curto no shunt / entrada da linha principal?"
          value={state.shortAtShunt}
          onChange={(value) => onChange('shortAtShunt', value)}
        />
      )}

      {isNoPower && state.dcinPresent === 'yes' && state.shuntPresent === 'no' && state.shortAtShunt === 'yes' && (
        <GuidanceBox tone="red" title="Circuito de entrada / alimentacao principal em curto">
          Trate como curto na linha principal: inspecao visual, resistencia para GND e, se nada aparecer, injecao baixa de tensao com corrente limitada para localizar aquecimento.
        </GuidanceBox>
      )}

      {isNoPower && state.dcinPresent === 'yes' && state.shuntPresent === 'no' && state.shortAtShunt === 'no' && (
        <GuidanceBox title="Sem curto no shunt">
          Medir continuidade dos MOSFETs de entrada. Se eles nao estiverem em curto, avance para as fontes secundarias 3V e 5V always-on.
        </GuidanceBox>
      )}

      {isNoPower && state.dcinPresent === 'yes' && state.shuntPresent === 'yes' && (
        <DecisionCard
          question="Existe curto apos o shunt / na linha principal?"
          value={state.shortAfterShunt}
          onChange={(value) => onChange('shortAfterShunt', value)}
        />
      )}

      {isNoPower && (state.shortAtShunt === 'yes' || state.shortAfterShunt === 'yes') && (
        <DecisionCard
          question="Na inspecao visual apareceu capacitor ou componente suspeito?"
          value={state.visualFound}
          onChange={(value) => onChange('visualFound', value)}
        />
      )}

      {isNoPower && (state.shortAtShunt === 'yes' || state.shortAfterShunt === 'yes') && state.visualFound === 'no' && (
        <DecisionCard
          question="Fez injecao de 1V com corrente limitada para procurar aquecimento?"
          value={state.injectionDone}
          onChange={(value) => onChange('injectionDone', value)}
        />
      )}

      {isNoPower && state.injectionDone === 'yes' && (
        <ComponentHeatingAnalysis
          state={state}
          onChange={onChange}
          checklist={checklist}
          activeSchematic={activeSchematic}
          entryComponents={entryComponents}
        />
      )}

      {isNoVideo && (
        <DecisionCard
          question="Tem imagem em monitor externo?"
          value={state.externalVideo}
          onChange={(value) => onChange('externalVideo', value)}
        />
      )}

      {isNoVideo && (
        <DecisionCard
          question="A tela acende / tem backlight?"
          value={state.screenLight}
          onChange={(value) => onChange('screenLight', value)}
          yesLabel="Acende"
          noLabel="Apagada"
        />
      )}

      {isNoVideo && state.externalVideo === 'yes' && (
        <GuidanceBox tone="blue" title="Video externo presente">
          Foque em tela, flat, conector LCD/eDP/LVDS, alimentacao do display e circuito de backlight.
        </GuidanceBox>
      )}

      {isNoVideo && state.externalVideo === 'no' && (
        <GuidanceBox title="Sem video interno e externo">
          Trate como falha de inicializacao: RAM, BIOS, tensoes always/on, power good e sequencia de start.
        </GuidanceBox>
      )}

      <div className="border border-slate-800 rounded-lg bg-slate-900/60 px-4 py-3">
        <p className="text-sm text-slate-200 font-medium mb-2">Leitura atual</p>
        <ul className="space-y-1 text-xs text-slate-300">
          {!state.powerOn && !state.noVideo && <li>Comece respondendo se a placa liga e se liga sem video.</li>}
          {state.powerOn === 'no' && !state.dcinPresent && <li>Ramo de nao liga: primeiro confirmar tensao no DC jack.</li>}
          {state.dcinPresent === 'no' && <li>Sem tensao no DC jack: verificar fonte, jack, fusivel/protecao inicial.</li>}
          {state.dcinPresent === 'yes' && state.shuntPresent === 'no' && !state.shortAtShunt && <li>Tensao nao chega ao shunt: antes dos MOSFETs, medir se ha curto no proprio shunt/entrada da linha.</li>}
          {state.shuntPresent === 'no' && state.shortAtShunt === 'yes' && <li>Curto confirmado no shunt/entrada: alimentacao principal em curto.</li>}
          {state.shuntPresent === 'no' && state.shortAtShunt === 'no' && <li>Sem curto no shunt: verificar MOSFETs de entrada e depois 3V/5V always.</li>}
          {state.shuntPresent === 'yes' && state.shortAfterShunt === 'yes' && <li>Curto apos shunt: inspecao visual, depois injecao controlada.</li>}
          {state.injectionDone === 'yes' && !state.heatingComponent && <li>Injecao feita: informe qual componente aqueceu para analise avancada do setor.</li>}
          {state.heatingComponent && <li>Componente aquecendo informado: {state.heatingComponent}.</li>}
          {state.noVideo === 'yes' && !state.externalVideo && <li>Ramo de liga sem video: separar video externo e backlight.</li>}
        </ul>
      </div>

      {entryComponents.length > 0 && (
        <div className="border border-slate-800 rounded-lg bg-slate-900/60 px-4 py-3">
          <p className="text-sm text-slate-200 font-medium mb-2">Circuito de entrada encontrado/sugerido</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {entryComponents.map((item) => (
              <div key={`${item.ref}-${item.role}`} className="border border-slate-800 rounded-md bg-slate-950/60 px-3 py-2">
                <p className="text-xs font-mono text-blue-300">{item.ref}</p>
                <p className="text-xs text-slate-400 mt-0.5">{item.role}</p>
                {item.evidence && <p className="text-[11px] text-slate-600 mt-1 line-clamp-2">{item.evidence}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function buildDerivedChecklistItems(state = {}, steps = {}) {
  const items = [];
  const add = (id, label, status) => {
    if (!status || steps[id]) return;
    items.push({ id, label, status });
  };

  const isNoPower = state.powerState === 'no-power' || state.powerOn === 'no';
  const isNoVideo = state.powerState === 'no-video' || state.noVideo === 'yes';

  if (state.powerOn === 'yes') add('flowPowerOn', 'Equipamento liga', 'done');
  if (state.powerOn === 'no') add('flowPowerOff', 'Equipamento não liga', 'done');
  if (state.noVideo === 'yes') add('flowNoVideo', 'Liga sem vídeo confirmado', 'done');
  if (state.noVideo === 'no') add('flowNotNoVideo', 'Não está no fluxo de liga sem vídeo', 'done');

  if (isNoPower) {
    add('flowDcin', 'Medir tensão no DC jack / entrada principal', state.dcinPresent ? 'done' : 'current');
    if (state.dcinPresent === 'yes') {
      add('flowShunt', 'Medir tensão no resistor shunt / linha principal', state.shuntPresent ? 'done' : 'current');
    }
    if (state.dcinPresent === 'no') {
      add('flowJack', 'Verificar fonte, DC jack, fusível e proteção inicial', 'current');
    }
    if (state.shuntPresent === 'no') {
      add('flowShortAtShunt', 'Medir curto no shunt / entrada da linha principal', state.shortAtShunt ? 'done' : 'current');
    }
    if (state.shuntPresent === 'yes') {
      add('flowShortAfterShunt', 'Medir curto após o shunt / linha principal', state.shortAfterShunt ? 'done' : 'current');
    }
    if (state.shortAtShunt === 'yes' || state.shortAfterShunt === 'yes') {
      add('flowVisual', 'Inspeção visual por capacitor ou componente aquecido/torrado', state.visualFound ? 'done' : 'current');
    }
    if ((state.shortAtShunt === 'yes' || state.shortAfterShunt === 'yes') && state.visualFound === 'no') {
      add('flowInjection', 'Injeção baixa de tensão com corrente limitada', state.injectionDone ? 'done' : 'current');
      if (state.injectionDone === 'yes') {
        add('flowHeatingComponent', 'Informar componente que aqueceu', state.heatingComponent ? 'done' : 'current');
      }
    }
    if (state.shuntPresent === 'no' && state.shortAtShunt === 'no') {
      add('flowInputMosfets', 'Medir continuidade dos MOSFETs de entrada', 'current');
      add('flowAlwaysRails', 'Se MOSFETs ok, verificar fontes 3V/5V always-on', 'current');
    }
  }

  if (isNoVideo) {
    add('flowExternalVideo', 'Testar imagem em monitor externo', state.externalVideo ? 'done' : 'current');
    add('flowBacklight', 'Verificar backlight / tela acende', state.screenLight ? 'done' : 'current');
  }

  return items;
}

export default function DiagnosticChecklistPanel({ checklist, guidedState, onGuidedChange, entryComponents = [], activeSchematic }) {
  const steps = checklist?.steps || {};
  const title = checklist?.boardModel || checklist?.deviceModel || 'Triagem automatica';
  const subtitle = checklist?.summary || 'Painel preenchido conforme a conversa do chat.';
  const schematicStatus = checklist?.schematicStatus || '';
  const schematicLabel = checklist?.matchedSchematic || '';
  const visibleItems = CHECKLIST_ITEMS.filter((item) => Boolean(steps[item.id]));
  const derivedItems = buildDerivedChecklistItems(guidedState, steps);
  const renderedItems = [
    ...visibleItems.map((item) => ({ ...item, status: steps[item.id] })),
    ...derivedItems,
  ];
  const schematicText = schematicStatus === 'found'
    ? (schematicLabel || 'Localizado')
    : schematicStatus === 'missing'
      ? 'Nao encontrado'
      : 'Aguardando busca';

  return (
    <div className="h-full overflow-y-auto bg-[#070d18] text-slate-100">
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="border border-slate-800 bg-slate-950/70 rounded-xl p-5 mb-5">
          <div className="flex items-start gap-4 flex-wrap">
            <div className="w-11 h-11 rounded-lg bg-blue-900/40 border border-blue-800/50 flex items-center justify-center text-lg shrink-0">
              IA
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500 mb-1">Checklist Visual</p>
              <h2 className="text-xl font-semibold text-slate-100 break-words">{title}</h2>
              <p className="text-sm text-slate-400 mt-1 break-words">{subtitle}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-5">
            <div className="border border-slate-800 rounded-lg bg-slate-900/70 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 mb-1">Placa</p>
              <p className="text-sm font-semibold text-slate-200">{checklist?.boardModel || 'Aguardando identificacao'}</p>
            </div>
            <div className="border border-slate-800 rounded-lg bg-slate-900/70 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 mb-1">Sintoma</p>
              <p className="text-sm font-semibold text-slate-200">{checklist?.symptom || 'Ainda nao classificado'}</p>
            </div>
            <div className="border border-slate-800 rounded-lg bg-slate-900/70 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 mb-1">Comportamento</p>
              <p className="text-sm font-semibold text-slate-200">{checklist?.sourceBehavior || 'Sem dado ainda'}</p>
            </div>
            <div className="border border-slate-800 rounded-lg bg-slate-900/70 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 mb-1">Esquema / boardview</p>
              <p className="text-sm font-semibold text-slate-200 break-words">{schematicText}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[390px_minmax(0,1fr)] gap-5">
          <div className="space-y-5">
            <div className="border border-slate-800 bg-slate-950/70 rounded-xl p-5">
              <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                <div>
                  <h3 className="text-sm font-semibold text-slate-200">Checklist</h3>
                  <p className="text-xs text-slate-500">Etapas ativadas pela conversa e pelas respostas.</p>
                </div>
                <div className="text-xs text-slate-500">
                  {renderedItems.filter((item) => item.status === 'done').length} concluida(s)
                </div>
              </div>

              <div className="space-y-3">
                {renderedItems.map((item, index) => {
                  const style = itemStatus(item.status);
                  return (
                    <div key={item.id} className={`border rounded-lg px-4 py-3 transition-colors ${style.row}`}>
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className={`w-2.5 h-2.5 rounded-full ${style.dot}`} />
                        <span className="text-xs text-slate-500 font-mono">{String(index + 1).padStart(2, '0')}</span>
                        <p className={`text-sm font-medium ${style.text}`}>{item.label}</p>
                        <span className={`ml-auto text-[11px] px-2 py-1 rounded-full ${style.badgeClass}`}>{style.badge}</span>
                      </div>
                    </div>
                  );
                })}

                {renderedItems.length === 0 && (
                  <div className="border border-dashed border-slate-800 rounded-lg px-4 py-4 bg-slate-950/40">
                    <p className="text-sm text-slate-400">O checklist aparece conforme o chat identifica sintomas e medições.</p>
                  </div>
                )}
              </div>
            </div>

            {checklist?.findings?.length > 0 && (
              <div className="border border-slate-800 bg-slate-950/70 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-slate-200 mb-3">Leituras capturadas</h3>
                <div className="flex flex-wrap gap-2">
                  {checklist.findings.map((finding) => (
                    <span key={finding} className="px-2.5 py-1 rounded-full text-xs bg-slate-900 border border-slate-800 text-slate-300">
                      {finding}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="border border-slate-800 bg-slate-950/70 rounded-xl p-5">
            <div className="mb-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500 mb-1">Perguntas do fluxo</p>
              <h3 className="text-sm font-semibold text-slate-200">Responda por botao ou pelo chat</h3>
            </div>
            <FlowQuestions
              state={guidedState}
              onChange={onGuidedChange}
              entryComponents={entryComponents}
              checklist={checklist}
              activeSchematic={activeSchematic}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
