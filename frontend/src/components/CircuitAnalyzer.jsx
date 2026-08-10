import { useState, useEffect, useRef } from 'react';

import DiagnosticChecklistPanel from './DiagnosticChecklistPanel';

const API_URL = import.meta.env.VITE_API_URL || '/api';

// ── Estágios ──────────────────────────────────────────────────────────────────
const STAGES = [
  { id: 'charger', label: 'Só Carregador',       short: 'Carregador', icon: '🔌' },
  { id: 'battery', label: 'Só Bateria',           short: 'Bateria',    icon: '🔋' },
  { id: 'both',    label: 'Carregador + Bateria', short: 'Ambos',      icon: '⚡' },
];

// ── Definição padrão dos nós ──────────────────────────────────────────────────
// Esquema: Compal CHARGER sheet — CI BQ24735RGRR, bateria 4S 17.4V
// mosfet: true  → exibe 3 pinos (G/S/D)
// gnd: true     → exibe símbolo ▼ (Source ligado ao GND no esquema)
// pins: [{ id, label, desc, exp }]
const DEFAULT_NODES = [

  // ── Entrada ──────────────────────────────────────────────────────────────
  { id: 'dcin', x:35, y:270, w:135, h:58, signal:'+19V_VIN', comp:'DCIN / ADP_I', section:'entrada', color:'#3b82f6',
    desc:'Tensão bruta do adaptador AC na entrada. PR303 (0.02Ω) serve de shunt para ACN/ACP.',
    exp:{ charger:{v:'18–20V',min:17.5,max:20.5}, battery:{v:'0V',min:-0.2,max:0.5}, both:{v:'18–20V',min:17.5,max:20.5} } },

  { id: 'acdet', x:200, y:165, w:135, h:58, signal:'ACDET', comp:'PR318/PR319 → PU301p6', section:'entrada', color:'#3b82f6',
    desc:'Divisor resistivo PR318(422K)+PR319(66.5K) detecta presença do adaptador. Nível ~2.6V com AC.',
    exp:{ charger:{v:'~2.6V',min:2.2,max:3.2}, battery:{v:'0V',min:-0.1,max:0.3}, both:{v:'~2.6V',min:2.2,max:3.2} } },

  { id: 'acdrv_sig', x:200, y:345, w:135, h:70, signal:'ACDRV (CI pin4)', comp:'PU301p4 Charge Pump', section:'entrada', color:'#f59e0b',
    desc:'Saída charge pump do BQ24735. ACDRV = CMSRC + ~5V (bomba de carga interna). Com carregador: ~24V. Passa por R+C antes do gate dos MOSFETs — tensão DC no gate ≈ ACDRV.',
    exp:{ charger:{v:'~24V',min:21,max:26}, battery:{v:'0V',min:-0.5,max:1}, both:{v:'~24V',min:21,max:26} } },

  { id: 'acdrv_gate', x:200, y:440, w:135, h:70, signal:'ACDRV_GATE', comp:'Gate PQ302/PQ303 após RC', section:'entrada', color:'#f59e0b',
    desc:'Tensão no gate dos MOSFETs de entrada APÓS o resistor série + capacitor de filtragem. DC = ACDRV (~24V). Vgs = ACDRV_GATE − CMSRC ≈ 5V. Este nó é medido nos pinos gate de PQ302/PQ303.',
    exp:{ charger:{v:'~24V',min:21,max:26}, battery:{v:'0V',min:-0.5,max:1}, both:{v:'~24V',min:21,max:26} } },

  { id: 'cmsrc', x:200, y:538, w:135, h:58, signal:'CMSRC', comp:'PU301p3 / Source PQ302', section:'entrada', color:'#f59e0b',
    desc:'Referência common-source dos MOSFETs de entrada (~19V). Vgs real = ACDRV_GATE − CMSRC ≈ 5V. Monitorado pelo CI para controlar ACDRV.',
    exp:{ charger:{v:'~19V',min:17,max:21}, battery:{v:'0V',min:-0.5,max:0.5}, both:{v:'~19V',min:17,max:21} } },

  { id: 'threevlp', x:35, y:490, w:135, h:58, signal:'+3VLP', comp:'PR309/PC302', section:'aux', color:'#64748b',
    desc:'Tensão auxiliar 3V always-on — alimenta pull-ups e lógica sempre ativa.',
    exp:{ charger:{v:'3.0–3.6V',min:3.0,max:3.6}, battery:{v:'3.0–3.6V',min:3.0,max:3.6}, both:{v:'3.0–3.6V',min:3.0,max:3.6} } },

  // ── MOSFETs de entrada ────────────────────────────────────────────────────
  { id: 'pq302', x:385, y:155, w:148, h:132, signal:'PQ302', comp:'AON6366E DFN5x6', section:'mosfet', color:'#8b5cf6',
    desc:'MOSFET principal de proteção AC. Vds=30V, Id=7A, Rds(on)=30mΩ. Gate controlado por ACDRV.',
    mosfet:true, gnd:false,
    exp:{ charger:{v:'~19V',min:17,max:21}, battery:{v:'0V',min:-0.5,max:1}, both:{v:'~19V',min:17,max:21} },
    pins:[
      { id:'pq302_g', label:'G – Gate (ACDRV_GATE)', desc:'Gate — após R+C de ACDRV. Vgs = Gate − Source ≈ 5V. Medir vs. Source.',
        exp:{ charger:{v:'~24V',min:21,max:26}, battery:{v:'0V',min:-0.5,max:1}, both:{v:'~24V',min:21,max:26} } },
      { id:'pq302_s', label:'S – Source (CMSRC)',    desc:'Source — CMSRC ~19V. Vgs = Gate(~24V) − Source(~19V) = ~5V.',
        exp:{ charger:{v:'~19V',min:17,max:21}, battery:{v:'0V',min:-0.5,max:0.5}, both:{v:'~19V',min:17,max:21} } },
      { id:'pq302_d', label:'D – Drain (+19VB)',      desc:'Drain — saída para barramento +19VB',
        exp:{ charger:{v:'~19V',min:17,max:21}, battery:{v:'0V',min:-0.2,max:0.5}, both:{v:'~19V',min:17,max:21} } },
    ]},

  { id: 'pq303', x:385, y:315, w:148, h:132, signal:'PQ303', comp:'AON7506 DFN3x3', section:'mosfet', color:'#8b5cf6',
    desc:'Segundo MOSFET de caminho AC (em série/paralelo com PQ302). Mesmo gate e controle.',
    mosfet:true, gnd:false,
    exp:{ charger:{v:'~19V',min:17,max:21}, battery:{v:'0V',min:-0.5,max:1}, both:{v:'~19V',min:17,max:21} },
    pins:[
      { id:'pq303_g', label:'G – Gate (ACDRV_GATE)', desc:'Gate — mesmo nó ACDRV_GATE de PQ302. Após R+C. ~24V quando ON.',
        exp:{ charger:{v:'~24V',min:21,max:26}, battery:{v:'0V',min:-0.5,max:1}, both:{v:'~24V',min:21,max:26} } },
      { id:'pq303_s', label:'S – Source (+19V_P1)',  desc:'Source — barramento +19V entrada',
        exp:{ charger:{v:'~19V',min:17,max:21}, battery:{v:'0V',min:-0.5,max:0.5}, both:{v:'~19V',min:17,max:21} } },
      { id:'pq303_d', label:'D – Drain (+19VB)',      desc:'Drain — saída para +19VB',
        exp:{ charger:{v:'~19V',min:17,max:21}, battery:{v:'0V',min:-0.2,max:0.5}, both:{v:'~19V',min:17,max:21} } },
    ]},

  { id: 'v19vb', x:385, y:478, w:135, h:58, signal:'+19VB / +19VB_CHG', comp:'Barr. pós proteção', section:'mosfet', color:'#8b5cf6',
    desc:'Barramento +19V após os MOSFETs de proteção. Alimenta VCC do BQ24735 e buck converter.',
    exp:{ charger:{v:'~19V',min:17,max:21}, battery:{v:'0V',min:-0.2,max:0.5}, both:{v:'~19V',min:17,max:21} } },

  // ── CI BQ24735RGRR ────────────────────────────────────────────────────────
  { id: 'bq_vcc', x:585, y:148, w:135, h:58, signal:'VCC BQ24735', comp:'PU301 pin20', section:'ci', color:'#10b981',
    desc:'Alimentação do CI BQ24735. Deve estar em ~19V quando AC conectado.',
    exp:{ charger:{v:'~19V',min:17,max:21}, battery:{v:'0–17V',min:0,max:18}, both:{v:'~19V',min:17,max:21} } },

  { id: 'regn', x:585, y:236, w:135, h:58, signal:'REGN', comp:'PU301 pin16 / PC316', section:'ci', color:'#10b981',
    desc:'Regulador interno ~6V do BQ24735. Referência para bootstrap e gate drivers. PC316 filtro.',
    exp:{ charger:{v:'5.5–6.5V',min:5.4,max:6.6}, battery:{v:'0V',min:-0.2,max:0.5}, both:{v:'5.5–6.5V',min:5.4,max:6.6} } },

  { id: 'acok', x:585, y:324, w:135, h:58, signal:'ACOK', comp:'PU301 pin5', section:'ci', color:'#10b981',
    desc:'Sinal de saída AC OK (open-drain, pull-up externo). Alto = adaptador válido detectado.',
    exp:{ charger:{v:'~3.3V Hi',min:2.8,max:3.6}, battery:{v:'0V Lo',min:-0.1,max:0.5}, both:{v:'~3.3V Hi',min:2.8,max:3.6} } },

  { id: 'sda', x:585, y:412, w:135, h:58, signal:'SDA (EC_SMB_DA1)', comp:'PU301 pin8', section:'ci', color:'#10b981',
    desc:'SMBus dados — comunicação EC ↔ BQ24735 para controle de carga. Pull-up +3VLP.',
    exp:{ charger:{v:'~3.3V',min:2.8,max:3.6}, battery:{v:'~3.3V',min:2.8,max:3.6}, both:{v:'~3.3V',min:2.8,max:3.6} } },

  { id: 'scl', x:585, y:500, w:135, h:58, signal:'SCL (EC_SMB_CK1)', comp:'PU301 pin9', section:'ci', color:'#10b981',
    desc:'SMBus clock — EC controla frequência. Pull-up +3VLP.',
    exp:{ charger:{v:'~3.3V',min:2.8,max:3.6}, battery:{v:'~3.3V',min:2.8,max:3.6}, both:{v:'~3.3V',min:2.8,max:3.6} } },

  // ── Chaveamento Buck ──────────────────────────────────────────────────────
  { id: 'btst', x:785, y:130, w:135, h:58, signal:'BTST', comp:'PU301 pin17 / PC321', section:'chav', color:'#f97316',
    desc:'Bootstrap para gate do hi-side MOSFET. BTST = PHASE + REGN (~25V). PC321 cap bootstrap.',
    exp:{ charger:{v:'~25V',min:22,max:28}, battery:{v:'0V',min:-0.5,max:1}, both:{v:'~25V',min:22,max:28} } },

  { id: 'pq304', x:785, y:218, w:148, h:132, signal:'PQ304 Hi-Side', comp:'AON7506 DFN3x3', section:'chav', color:'#f97316',
    desc:'MOSFET hi-side do conversor buck. Gate=DH_CHG(HIDRV). Drain=+19VB, Source=PHASE.',
    mosfet:true, gnd:false,
    exp:{ charger:{v:'PWM',min:5,max:21}, battery:{v:'0V',min:-1,max:2}, both:{v:'PWM',min:5,max:21} },
    pins:[
      { id:'pq304_g', label:'G – Gate (DH_CHG)',  desc:'Gate — HIDRV pin18 do BQ24735',
        exp:{ charger:{v:'PWM ~25V',min:5,max:28}, battery:{v:'0V',min:-1,max:2}, both:{v:'PWM ~25V',min:5,max:28} } },
      { id:'pq304_s', label:'S – Source (PHASE)',  desc:'Source — nó PHASE (LX) — oscila',
        exp:{ charger:{v:'PWM ~17V',min:5,max:21}, battery:{v:'0V',min:-1,max:2}, both:{v:'PWM ~17V',min:5,max:21} } },
      { id:'pq304_d', label:'D – Drain (+19VB)',   desc:'Drain — barramento +19VB',
        exp:{ charger:{v:'~19V',min:17,max:21}, battery:{v:'0V',min:-1,max:2}, both:{v:'~19V',min:17,max:21} } },
    ]},

  { id: 'pq306', x:785, y:380, w:148, h:132, signal:'PQ306 Lo-Side', comp:'AON7506 DFN3x3', section:'chav', color:'#f97316',
    desc:'MOSFET lo-side do conversor buck. Source ligado ao GND ▼. Gate=DL_CHG(LODRV).',
    mosfet:true, gnd:true,
    exp:{ charger:{v:'PWM',min:0,max:6.5}, battery:{v:'0V',min:-0.5,max:1}, both:{v:'PWM',min:0,max:6.5} },
    pins:[
      { id:'pq306_g', label:'G – Gate (DL_CHG)',   desc:'Gate — LODRV pin15 do BQ24735',
        exp:{ charger:{v:'PWM 0–6V',min:0,max:6.5}, battery:{v:'0V',min:-0.5,max:1}, both:{v:'PWM 0–6V',min:0,max:6.5} } },
      { id:'pq306_s', label:'S – Source ▼ GND',    desc:'Source — referência GND ▼',
        exp:{ charger:{v:'0V',min:-0.2,max:0.3}, battery:{v:'0V',min:-0.2,max:0.3}, both:{v:'0V',min:-0.2,max:0.3} } },
      { id:'pq306_d', label:'D – Drain (PHASE)',    desc:'Drain — nó PHASE compartilhado com PQ304',
        exp:{ charger:{v:'PWM ~17V',min:5,max:21}, battery:{v:'0V',min:-1,max:2}, both:{v:'PWM ~17V',min:5,max:21} } },
    ]},

  { id: 'pl302', x:785, y:542, w:135, h:58, signal:'PL302 (PHASE→BAT)', comp:'4.7µH 5.5A Indutor', section:'chav', color:'#f97316',
    desc:'Indutor de saída do buck converter. Pin1=PHASE, Pin2=saída regulada +17.4V_BATT.',
    exp:{ charger:{v:'~17V',min:14,max:18.5}, battery:{v:'0V',min:-0.2,max:1}, both:{v:'~17V',min:14,max:18.5} } },

  // ── Bateria 4S ────────────────────────────────────────────────────────────
  { id: 'batt_chg', x:990, y:148, w:138, h:58, signal:'+17.4V_BATT_CHG', comp:'Saída PL302', section:'bat', color:'#06b6d4',
    desc:'Tensão regulada de saída do buck para carregar a bateria 4S. Max 4.35V/célula = 17.4V.',
    exp:{ charger:{v:'16–17.4V',min:15,max:18}, battery:{v:'0V',min:-0.2,max:0.5}, both:{v:'16–17.4V',min:15,max:18} } },

  { id: 'batt', x:990, y:236, w:138, h:58, signal:'BATT_4S', comp:'Pack 4S Li-ion', section:'bat', color:'#06b6d4',
    desc:'Pack de bateria 4S (4 células em série). Range: 14.8V (min) a 17.4V (cheio, 4.35V/céls).',
    exp:{ charger:{v:'—',min:null,max:null}, battery:{v:'14.8–17.4V',min:14,max:18}, both:{v:'14.8–17.4V',min:14,max:18} } },

  { id: 'pq305', x:990, y:318, w:148, h:132, signal:'PQ305 (BAT FET)', comp:'AON7506 DFN3x3', section:'bat', color:'#06b6d4',
    desc:'MOSFET de controle da bateria. Gate=BATDRV pin11 do CI. Controla conexão do pack.',
    mosfet:true, gnd:false,
    exp:{ charger:{v:'~17V',min:14,max:18}, battery:{v:'~17V',min:14,max:18}, both:{v:'~17V',min:14,max:18} },
    pins:[
      { id:'pq305_g', label:'G – Gate (BATDRV)',  desc:'Gate — BATDRV pin11 do BQ24735',
        exp:{ charger:{v:'~17V Hi',min:14,max:19}, battery:{v:'~17V Hi',min:14,max:19}, both:{v:'~17V Hi',min:14,max:19} } },
      { id:'pq305_s', label:'S – Source (BATSRC)', desc:'Source — nó BATSRC → shunt PR311',
        exp:{ charger:{v:'~17.4V',min:14,max:18}, battery:{v:'~17V',min:14,max:18}, both:{v:'~17.4V',min:14,max:18} } },
      { id:'pq305_d', label:'D – Drain',           desc:'Drain — pack de bateria BATT_4S',
        exp:{ charger:{v:'~17.4V',min:14,max:18}, battery:{v:'~17V',min:14,max:18}, both:{v:'~17.4V',min:14,max:18} } },
    ]},

  { id: 'srp', x:990, y:480, w:138, h:58, signal:'SRP / SRN', comp:'PR311 Shunt 10mΩ', section:'bat', color:'#06b6d4',
    desc:'Shunt PR311 (0.01Ω) — medição de corrente de carga. SRP≥SRN. Tensão dif. = I×0.01.',
    exp:{ charger:{v:'~17.4V',min:14,max:18}, battery:{v:'~17V',min:14,max:18}, both:{v:'~17.4V',min:14,max:18} } },
];

// Edges — conexões principais entre nós
const EDGES = [
  ['dcin','acdet'], ['dcin','acdrv_sig'], ['dcin','pq302'], ['dcin','threevlp'],
  ['acdrv_sig','acdrv_gate'],
  ['acdrv_gate','pq302'], ['acdrv_gate','pq303'],
  ['cmsrc','pq302'],
  ['acdet','bq_vcc'],
  ['pq302','v19vb'], ['pq303','v19vb'],
  ['v19vb','bq_vcc'], ['v19vb','pq304'],
  ['bq_vcc','regn'], ['bq_vcc','acok'], ['bq_vcc','sda'], ['bq_vcc','btst'],
  ['regn','acok'],
  ['btst','pq304'],
  ['pq304','pq306'],
  ['pq304','pl302'], ['pl302','batt_chg'],
  ['batt_chg','batt'],
  ['bq_vcc','pq305'],
  ['pq305','srp'],
];

const SECTION_LABELS = {
  entrada:'🔌 Entrada DCIN', mosfet:'🔀 MOSFETs de Entrada',
  ci:'🧠 CI BQ24735', chav:'⚡ Buck / PQ304-306',
  bat:'🔋 Bateria 4S', aux:'🔧 Auxiliares',
};

function buildEntryComponents(activeSchematic) {
  const schematicHint = activeSchematic?.label || activeSchematic?.title || activeSchematic?.path || '';
  const base = DEFAULT_NODES
    .filter((node) => ['entrada', 'mosfet', 'aux'].includes(node.section) || node.id === 'bq_vcc')
    .map((node) => ({
      ref: node.signal || node.id,
      role: node.comp ? `${node.comp} — ${node.desc}` : node.desc,
    }));

  const hints = [];
  const refs = schematicHint.match(/\b(?:PQ|PR|PU|PC|PL|F|R|Q|U|C)\d+[A-Z]?\b/gi) || [];
  for (const ref of refs) {
    const normalized = ref.toUpperCase();
    if (!base.some((item) => item.ref.toUpperCase().includes(normalized)) && !hints.some((item) => item.ref === normalized)) {
      hints.push({ ref: normalized, role: 'Referência citada no arquivo selecionado' });
    }
  }

  return [...base, ...hints].slice(0, 10);
}

// ── Status ─────────────────────────────────────────────────────────────────────
function getStatus(val, exp) {
  const v = parseFloat(String(val || '').replace(',', '.'));
  if (!val || String(val).trim() === '' || isNaN(v)) return 'empty';
  if (!exp || exp.min === null) return 'na';
  if (v >= exp.min && v <= exp.max) return 'ok';
  const margin = (exp.max - exp.min) * 0.35 + 0.4;
  if (v >= exp.min - margin && v <= exp.max + margin) return 'warn';
  return 'bad';
}

const ST_STYLE = {
  empty: { bg:'#0f1729', border:'#1e293b', text:'#475569', dot:'#1e293b' },
  ok:    { bg:'#052e16', border:'#16a34a', text:'#4ade80', dot:'#22c55e' },
  warn:  { bg:'#3b1c07', border:'#d97706', text:'#fbbf24', dot:'#f59e0b' },
  bad:   { bg:'#3b0404', border:'#dc2626', text:'#f87171', dot:'#ef4444' },
  na:    { bg:'#0f1729', border:'#1e293b', text:'#475569', dot:'#334155' },
};

// ── Painel de edição de tensões esperadas ─────────────────────────────────────
function ExpEditor({ nodes, customExp, onSave, onClose }) {
  const [draft, setDraft] = useState(() => {
    const d = {};
    for (const n of nodes) {
      const allPins = n.mosfet && n.pins ? [n, ...n.pins] : [n];
      for (const p of allPins) {
        d[p.id] = {};
        for (const st of ['charger','battery','both']) {
          const base = (customExp[p.id]?.[st]) || p.exp[st];
          d[p.id][st] = { v: base.v, min: String(base.min ?? ''), max: String(base.max ?? '') };
        }
      }
    }
    return d;
  });

  const update = (id, stage, field, val) =>
    setDraft(prev => ({ ...prev, [id]: { ...prev[id], [stage]: { ...prev[id][stage], [field]: val } } }));

  const handleSave = () => {
    const out = {};
    for (const [id, stages] of Object.entries(draft)) {
      out[id] = {};
      for (const [st, vals] of Object.entries(stages)) {
        out[id][st] = {
          v: vals.v,
          min: vals.min === '' || vals.min === 'null' ? null : parseFloat(vals.min),
          max: vals.max === '' || vals.max === 'null' ? null : parseFloat(vals.max),
        };
      }
    }
    onSave(out);
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700">
          <h2 className="text-sm font-bold text-slate-200">⚙ Editar Tensões Esperadas</h2>
          <div className="flex gap-2">
            <button onClick={handleSave} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg">💾 Salvar</button>
            <button onClick={onClose} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-lg">Fechar</button>
          </div>
        </div>
        <div className="overflow-y-auto flex-1 p-4">
          {nodes.map(n => {
            const allPins = n.mosfet && n.pins ? [{ ...n, label: n.signal + ' (geral)' }, ...n.pins.map(p=>({...p, label: n.signal+' / '+p.label}))] : [{ ...n, label: n.signal }];
            return (
              <div key={n.id} className="mb-5">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-3 h-3 rounded-full" style={{background:n.color}}/>
                  <span className="text-xs font-bold text-slate-300">{n.signal} — {n.comp}</span>
                  {n.mosfet && <span className="text-xs bg-purple-800/40 text-purple-300 px-2 py-0.5 rounded-full">MOSFET</span>}
                  {n.gnd && <span className="text-xs bg-slate-700 text-slate-400 px-2 py-0.5 rounded-full">▼ GND</span>}
                </div>
                {allPins.map(p => (
                  <div key={p.id} className="ml-4 mb-3">
                    <p className="text-xs text-slate-500 mb-1">{p.label}</p>
                    <div className="grid grid-cols-3 gap-2">
                      {['charger','battery','both'].map(st => (
                        <div key={st} className="bg-slate-800 rounded-xl p-2">
                          <p className="text-xs text-slate-600 mb-1 capitalize">{STAGES.find(s=>s.id===st)?.icon} {STAGES.find(s=>s.id===st)?.short}</p>
                          <input value={draft[p.id]?.[st]?.v ?? ''} onChange={e=>update(p.id,st,'v',e.target.value)}
                            placeholder="Label ex: ~19V"
                            style={{userSelect:'text'}}
                            className="w-full bg-slate-700 text-slate-200 text-xs rounded-lg px-2 py-1 mb-1 outline-none border border-slate-600 focus:border-blue-500 font-mono"/>
                          <div className="flex gap-1">
                            <input value={draft[p.id]?.[st]?.min ?? ''} onChange={e=>update(p.id,st,'min',e.target.value)}
                              placeholder="Min V"
                              style={{userSelect:'text'}}
                              className="w-full bg-slate-700 text-slate-200 text-xs rounded-lg px-2 py-1 outline-none border border-slate-600 focus:border-green-500 font-mono"/>
                            <input value={draft[p.id]?.[st]?.max ?? ''} onChange={e=>update(p.id,st,'max',e.target.value)}
                              placeholder="Max V"
                              style={{userSelect:'text'}}
                              className="w-full bg-slate-700 text-slate-200 text-xs rounded-lg px-2 py-1 outline-none border border-slate-600 focus:border-red-500 font-mono"/>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function GuidedDecision({ question, value, onChange, yesLabel = 'Sim', noLabel = 'Não' }) {
  return (
    <div className="border border-slate-800 rounded-lg bg-slate-900/60 px-4 py-3">
      <p className="text-sm text-slate-200 font-medium mb-3">{question}</p>
      <div className="flex gap-2">
        <button
          onClick={() => onChange('yes')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${value === 'yes' ? 'bg-emerald-700 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
        >
          {yesLabel}
        </button>
        <button
          onClick={() => onChange('no')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${value === 'no' ? 'bg-rose-700 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
        >
          {noLabel}
        </button>
      </div>
    </div>
  );
}

function buildGuidedFlowSummary(state) {
  const lines = [];
  if (state.powerOn === 'yes') lines.push('Equipamento liga');
  if (state.powerOn === 'no') lines.push('Equipamento não liga');
  if (state.noVideo === 'yes') lines.push('Liga sem vídeo confirmado');
  if (state.noVideo === 'no') lines.push('Não está no fluxo de liga sem vídeo');
  if (state.powerState === 'no-power') lines.push('Fluxo escolhido: não liga');
  if (state.powerState === 'no-video') lines.push('Fluxo escolhido: liga sem vídeo');
  if (state.powerState === 'other') lines.push('Fluxo escolhido: outro sintoma');
  if (state.dcinPresent === 'yes') lines.push('Há tensão no DC jack/entrada');
  if (state.dcinPresent === 'no') lines.push('Sem tensão no DC jack/entrada');
  if (state.shuntPresent === 'yes') lines.push('Tensão chega ao resistor shunt');
  if (state.shuntPresent === 'no') lines.push('Tensão não chega ao resistor shunt');
  if (state.shortAtShunt === 'yes') lines.push('Curto encontrado no shunt / entrada da linha principal');
  if (state.shortAtShunt === 'no') lines.push('Sem curto no shunt / entrada da linha principal');
  if (state.shortAfterShunt === 'yes') lines.push('Suspeita de curto após o shunt/linha principal');
  if (state.visualFound === 'yes') lines.push('Inspeção visual encontrou componente suspeito');
  if (state.injectionDone === 'yes') lines.push('Injeção de 1V realizada para localizar aquecimento');
  if (state.heatingComponent) lines.push(`Componente aquecendo: ${state.heatingComponent}`);
  if (state.heatingMeasurementValue) lines.push(`Medição do componente aquecendo: ${state.heatingMeasurementValue}`);
  if (state.externalVideo === 'yes') lines.push('Há vídeo em monitor externo');
  if (state.externalVideo === 'no') lines.push('Sem vídeo também no monitor externo');
  if (state.screenLight === 'yes') lines.push('Tela acende / backlight presente');
  if (state.screenLight === 'no') lines.push('Tela apagada / sem backlight');
  return lines;
}

function GuidedTriagePanel({ checklist, state, onChange }) {
  const boardLabel = checklist?.boardModel || checklist?.deviceModel || 'placa atual';
  const currentRoute = state.powerState || (checklist?.symptom === 'Não liga' ? 'no-power' : '');
  const isNoPower = currentRoute === 'no-power';
  const isNoVideo = currentRoute === 'no-video';

  return (
    <div className="border-b border-slate-700/60 bg-slate-950/70 px-4 py-4">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500 mb-1">Fluxo guiado</p>
          <h3 className="text-sm font-semibold text-slate-100">Triagem interativa para {boardLabel}</h3>
          <p className="text-xs text-slate-500 mt-1">Você pode seguir pelo chat ou clicar nas respostas aqui. Os dois caminhos se complementam.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <div className="border border-slate-800 rounded-lg bg-slate-900/60 px-4 py-3 xl:col-span-2">
          <p className="text-sm text-slate-200 font-medium mb-3">Qual é o sintoma principal?</p>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => onChange('powerState', 'no-power')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${currentRoute === 'no-power' ? 'bg-emerald-700 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
            >
              Não liga
            </button>
            <button
              onClick={() => onChange('powerState', 'no-video')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${currentRoute === 'no-video' ? 'bg-blue-700 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
            >
              Liga sem vídeo
            </button>
            <button
              onClick={() => onChange('powerState', 'other')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${currentRoute === 'other' ? 'bg-rose-700 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
            >
              Outro fluxo
            </button>
          </div>
        </div>

        {isNoPower && (
          <GuidedDecision
            question="Tem tensão no DC jack / entrada principal?"
            value={state.dcinPresent}
            onChange={(value) => onChange('dcinPresent', value)}
          />
        )}

        {isNoPower && state.dcinPresent === 'yes' && (
          <GuidedDecision
            question="A tensão chega ao resistor shunt / lado da linha principal?"
            value={state.shuntPresent}
            onChange={(value) => onChange('shuntPresent', value)}
          />
        )}

        {isNoPower && state.dcinPresent === 'yes' && state.shuntPresent === 'no' && (
          <GuidedDecision
            question="Existe curto no shunt / entrada da linha principal?"
            value={state.shortAtShunt}
            onChange={(value) => onChange('shortAtShunt', value)}
          />
        )}

        {isNoPower && state.dcinPresent === 'yes' && state.shuntPresent === 'no' && state.shortAtShunt === 'yes' && (
          <div className="border border-amber-800/40 rounded-lg bg-amber-950/20 px-4 py-3">
            <p className="text-sm text-amber-200 font-medium">Próximo passo</p>
            <p className="text-xs text-amber-300 mt-2">Se há curto já no shunt / entrada da linha principal, trate como suspeita de curto na linha principal: inspeção visual, localizar componente aquecendo e depois confirmar o setor em curto.</p>
          </div>
        )}

        {isNoPower && state.dcinPresent === 'yes' && state.shuntPresent === 'no' && state.shortAtShunt === 'no' && (
          <div className="border border-amber-800/40 rounded-lg bg-amber-950/20 px-4 py-3">
            <p className="text-sm text-amber-200 font-medium">Próximo passo</p>
            <p className="text-xs text-amber-300 mt-2">Sem curto no shunt, medir continuidade e comportamento dos MOSFETs de entrada. Se os MOSFETs não estiverem em curto, avance para as fontes secundárias de 3V e 5V always-on.</p>
          </div>
        )}

        {isNoPower && state.dcinPresent === 'yes' && state.shuntPresent === 'yes' && (
          <GuidedDecision
            question="Existe curto após o shunt / na linha principal?"
            value={state.shortAfterShunt}
            onChange={(value) => onChange('shortAfterShunt', value)}
          />
        )}

        {isNoPower && state.shortAfterShunt === 'yes' && (
          <GuidedDecision
            question="Na inspeção visual já apareceu capacitor ou componente suspeito?"
            value={state.visualFound}
            onChange={(value) => onChange('visualFound', value)}
          />
        )}

        {isNoPower && state.shortAfterShunt === 'yes' && state.visualFound === 'no' && (
          <GuidedDecision
            question="Fez injeção de 1V com corrente limitada para procurar aquecimento?"
            value={state.injectionDone}
            onChange={(value) => onChange('injectionDone', value)}
          />
        )}

        {isNoVideo && (
          <GuidedDecision
            question="Tem imagem em monitor externo?"
            value={state.externalVideo}
            onChange={(value) => onChange('externalVideo', value)}
          />
        )}

        {isNoVideo && (
          <GuidedDecision
            question="A tela acende / tem backlight?"
            value={state.screenLight}
            onChange={(value) => onChange('screenLight', value)}
            yesLabel="Acende"
            noLabel="Apagada"
          />
        )}

        {isNoVideo && state.externalVideo === 'yes' && (
          <div className="border border-blue-800/40 rounded-lg bg-blue-950/20 px-4 py-3">
            <p className="text-sm text-blue-200 font-medium">Próximo passo</p>
            <p className="text-xs text-blue-300 mt-2">Se há vídeo externo, foque no circuito LVDS/eDP, flat da tela, alimentação do display e backlight.</p>
          </div>
        )}

        {isNoVideo && state.externalVideo === 'no' && (
          <div className="border border-amber-800/40 rounded-lg bg-amber-950/20 px-4 py-3">
            <p className="text-sm text-amber-200 font-medium">Próximo passo</p>
            <p className="text-xs text-amber-300 mt-2">Sem vídeo interno e externo: verificar RAM, BIOS, tensões always/on, sinal de power good e sequência de start da placa.</p>
          </div>
        )}
      </div>

      <div className="mt-4 border border-slate-800 rounded-lg bg-slate-900/60 px-4 py-3">
        <p className="text-sm text-slate-200 font-medium mb-2">Leitura atual do fluxo</p>
        {isNoPower ? (
          <ul className="space-y-1 text-xs text-slate-300">
            {state.dcinPresent === 'no' && <li>• Sem tensão no DC jack: verificar jack, entrada e proteção inicial.</li>}
            {state.dcinPresent === 'yes' && state.shuntPresent === 'no' && !state.shortAtShunt && <li>• Tensão para antes do shunt: primeiro confirme se existe curto no shunt / entrada da linha principal.</li>}
            {state.shuntPresent === 'no' && state.shortAtShunt === 'yes' && <li>• Curto no shunt / entrada principal: seguir como curto na linha principal.</li>}
            {state.shuntPresent === 'no' && state.shortAtShunt === 'no' && <li>• Sem curto no shunt: medir continuidade dos MOSFETs de entrada e depois verificar 3V/5V always-on.</li>}
            {state.shuntPresent === 'yes' && state.shortAfterShunt === 'yes' && <li>• Curto na linha principal: inspeção visual primeiro, depois injeção de 1V para localizar aquecimento.</li>}
            {state.shortAfterShunt === 'yes' && state.visualFound === 'yes' && <li>• Há componente suspeito visualmente: priorizar esse ponto antes de avançar para charger.</li>}
            {state.shortAfterShunt === 'yes' && state.visualFound === 'no' && state.injectionDone === 'yes' && <li>• Com injeção feita, siga o aquecimento para localizar capacitor, MOSFET ou CI em curto.</li>}
            {state.shuntPresent === 'yes' && state.shortAfterShunt === 'no' && <li>• Sem curto após o shunt: aí sim avance para fontes always e depois charger/enable.</li>}
            {!state.dcinPresent && <li>• Comece escolhendo o estado da entrada para o fluxo ramificar.</li>}
          </ul>
        ) : isNoVideo ? (
          <ul className="space-y-1 text-xs text-slate-300">
            {state.externalVideo === 'yes' && <li>• Vídeo externo presente: suspeita mais forte em tela, flat, conector e backlight.</li>}
            {state.externalVideo === 'no' && <li>• Sem vídeo interno e externo: trate como falha de inicialização, RAM, BIOS ou sequência de power.</li>}
            {state.screenLight === 'no' && <li>• Tela apagada: medir alimentação da tela, habilitação do backlight e circuito do conector LCD.</li>}
            {state.screenLight === 'yes' && <li>• Tela acende sem imagem: verificar dados eDP/LVDS, painel, flat e saída gráfica.</li>}
            {!state.externalVideo && !state.screenLight && <li>• Comece separando se existe vídeo externo e se a tela local acende.</li>}
          </ul>
        ) : (
          <p className="text-xs text-slate-400">Escolha primeiro o sintoma principal para o Volt abrir o ramo certo da análise.</p>
        )}
      </div>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function CircuitAnalyzer({ onBack, schematic, diagnosticChecklist }) {
  const [stage, setStage]       = useState('charger');
  const [selected, setSelected] = useState(null);
  const [showEditor, setShowEditor] = useState(false);
  const [activeSchematic, setActiveSchematic] = useState(null);
  const [schematicDataUrl, setSchematicDataUrl] = useState('');
  const [schematicError, setSchematicError] = useState('');
  const [schematicEntryComponents, setSchematicEntryComponents] = useState([]);
  const [workspaceTab, setWorkspaceTab] = useState(() => (
    schematic?.path ? 'schematic' : diagnosticChecklist ? 'checklist' : 'analyzer'
  ));
  const [guidedState, setGuidedState] = useState({
    powerOn: diagnosticChecklist?.symptom === 'Não liga' ? 'no' : '',
    noVideo: diagnosticChecklist?.symptom === 'Liga sem vídeo' ? 'yes' : '',
    powerState: diagnosticChecklist?.symptom === 'Não liga' ? 'no-power' : '',
    dcinPresent: '',
    shuntPresent: '',
    shortAtShunt: '',
    shortAfterShunt: diagnosticChecklist?.findings?.includes('Suspeita de curto') ? 'yes' : '',
    visualFound: '',
    injectionDone: '',
    heatingComponent: '',
    heatingMeasurementValue: '',
    externalVideo: '',
    screenLight: '',
  });

  // Medições: { [nodeOrPinId]: string }
  const [measurements, setMeas] = useState(() => {
    try { return JSON.parse(localStorage.getItem('volt_analyzer_meas') || '{}'); } catch { return {}; }
  });

  // Tensões esperadas customizadas: { [id]: { charger:{v,min,max}, ... } }
  const [customExp, setCustomExp] = useState(() => {
    try { return JSON.parse(localStorage.getItem('volt_analyzer_exp') || '{}'); } catch { return {}; }
  });

  const [scale, setScale] = useState(0.72);
  const [pan,   setPan]   = useState({ x: 10, y: 20 });
  const panRef  = useRef({ x: 10, y: 20 });
  const scaleRef = useRef(0.72);
  // Posições customizadas dos nós (arrastáveis)
  const [nodePositions, setNodePositions] = useState(() => {
    try { return JSON.parse(localStorage.getItem('volt_analyzer_pos') || '{}'); } catch { return {}; }
  });
  // keep refs in sync so wheel handler never reads stale closure
  useEffect(() => { panRef.current = pan; }, [pan]);
  useEffect(() => { scaleRef.current = scale; }, [scale]);

  const [panMode, setPanMode] = useState(false);
  const [detailHidden, setDetailHidden] = useState(false);
  const isPanning = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const dragging  = useRef(null); // { id, lastX, lastY }
  const dragMoved = useRef(false);

  useEffect(() => {
    if (!schematic?.path) return;
    let cancelled = false;

    async function loadSchematic() {
      setActiveSchematic(schematic);
      setSchematicDataUrl('');
      setSchematicError('');
      try {
        if (!window.electronAPI?.readFileAsDataUrl) {
          throw new Error('Leitor local indisponível.');
        }
        const dataUrl = await window.electronAPI.readFileAsDataUrl(schematic.path);
        if (!cancelled) setSchematicDataUrl(dataUrl || '');
      } catch (error) {
        if (!cancelled) setSchematicError(error.message || 'Não foi possível carregar o esquema.');
      }
    }

    loadSchematic();
    return () => { cancelled = true; };
  }, [schematic]);

  useEffect(() => {
    if (!activeSchematic?.path || activeSchematic.kind === 'boardview') {
      setSchematicEntryComponents([]);
      return;
    }

    let cancelled = false;
    async function loadEntryComponents() {
      try {
        const res = await fetch(`${API_URL}/schematic/entry-components`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: activeSchematic.path }),
        });
        const data = await res.json();
        if (!cancelled && res.ok) setSchematicEntryComponents(Array.isArray(data.components) ? data.components : []);
      } catch (_) {
        if (!cancelled) setSchematicEntryComponents([]);
      }
    }

    loadEntryComponents();
    return () => { cancelled = true; };
  }, [activeSchematic]);

  useEffect(() => {
    if (schematic?.path) {
      setWorkspaceTab('schematic');
      return;
    }
    if (diagnosticChecklist) {
      setWorkspaceTab((current) => (current === 'schematic' || current === 'guided' ? 'checklist' : current || 'checklist'));
    }
  }, [schematic, diagnosticChecklist]);

  useEffect(() => {
    if (diagnosticChecklist?.symptom === 'Não liga') {
      setGuidedState((current) => ({
        ...current,
        powerOn: current.powerOn || 'no',
        powerState: current.powerState || 'no-power',
        shortAfterShunt: current.shortAfterShunt || (diagnosticChecklist?.findings?.includes('Suspeita de curto') ? 'yes' : ''),
      }));
    }
    if (diagnosticChecklist?.symptom === 'Liga sem vídeo') {
      setGuidedState((current) => ({
        ...current,
        powerOn: current.powerOn || 'yes',
        noVideo: current.noVideo || 'yes',
        powerState: current.powerState || 'no-video',
      }));
    }
  }, [diagnosticChecklist]);

  useEffect(() => {
    try { localStorage.setItem('volt_analyzer_meas', JSON.stringify(measurements)); } catch (_) {}
  }, [measurements]);
  useEffect(() => {
    try { localStorage.setItem('volt_analyzer_exp', JSON.stringify(customExp)); } catch (_) {}
  }, [customExp]);
  useEffect(() => {
    try { localStorage.setItem('volt_analyzer_pos', JSON.stringify(nodePositions)); } catch (_) {}
  }, [nodePositions]);

  // Publica estado atual em window.__analyzerCtx para o chat ler
  useEffect(() => {
    const stageLabel = STAGES.find(s => s.id === stage)?.label ?? stage;
    const points = [];
    for (const n of DEFAULT_NODES) {
      const items = n.mosfet && n.pins ? n.pins : [n];
      for (const item of items) {
        const exp = customExp[item.id]?.[stage] || item.exp[stage];
        const val = measurements[item.id] ?? '';
        const status = getStatus(val, exp);
        points.push({
          id: item.id,
          signal: item.signal || item.label || item.id,
          comp: n.comp,
          expLabel: exp?.v ?? '—',
          expMin: exp?.min,
          expMax: exp?.max,
          measured: val,
          status, // 'ok' | 'warn' | 'bad' | 'empty' | 'na'
        });
      }
    }
    window.__analyzerCtx = {
      stage,
      stageLabel,
      points,
      guidedFlow: buildGuidedFlowSummary(guidedState),
      timestamp: Date.now(),
    };
  }, [measurements, stage, customExp, guidedState]);

  const updateGuidedState = (key, value) => {
    setGuidedState((current) => {
      const next = { ...current, [key]: value };
      if (key === 'powerOn') {
        next.dcinPresent = '';
        next.shuntPresent = '';
        next.shortAtShunt = '';
        next.shortAfterShunt = '';
        next.visualFound = '';
        next.injectionDone = '';
        next.heatingComponent = '';
        next.heatingMeasurementValue = '';
        if (value === 'no') {
          next.powerState = 'no-power';
          next.noVideo = '';
          next.externalVideo = '';
          next.screenLight = '';
        } else if (current.powerState === 'no-power') {
          next.powerState = '';
        }
      }
      if (key === 'noVideo') {
        next.externalVideo = '';
        next.screenLight = '';
        if (value === 'yes') {
          next.powerOn = 'yes';
          next.powerState = 'no-video';
          next.dcinPresent = '';
          next.shuntPresent = '';
          next.shortAtShunt = '';
          next.shortAfterShunt = '';
          next.visualFound = '';
          next.injectionDone = '';
          next.heatingComponent = '';
          next.heatingMeasurementValue = '';
        } else if (current.powerState === 'no-video') {
          next.powerState = '';
        }
      }
      if (key === 'powerState') {
        next.dcinPresent = '';
        next.shuntPresent = '';
        next.shortAtShunt = '';
        next.shortAfterShunt = '';
        next.visualFound = '';
        next.injectionDone = '';
        next.heatingComponent = '';
        next.heatingMeasurementValue = '';
        next.externalVideo = '';
        next.screenLight = '';
      }
      if (key === 'dcinPresent' && value !== 'yes') {
        next.shuntPresent = '';
        next.shortAtShunt = '';
        next.shortAfterShunt = '';
        next.visualFound = '';
        next.injectionDone = '';
        next.heatingComponent = '';
        next.heatingMeasurementValue = '';
      }
      if (key === 'shuntPresent' && value !== 'yes') {
        next.shortAtShunt = '';
        next.shortAfterShunt = '';
        next.visualFound = '';
        next.injectionDone = '';
        next.heatingComponent = '';
        next.heatingMeasurementValue = '';
      }
      if (key === 'shortAtShunt' && value !== 'yes') {
        next.visualFound = '';
        next.injectionDone = '';
        next.heatingComponent = '';
        next.heatingMeasurementValue = '';
      }
      if (key === 'shortAfterShunt' && value !== 'yes') {
        next.visualFound = '';
        next.injectionDone = '';
        next.heatingComponent = '';
        next.heatingMeasurementValue = '';
      }
      if (key === 'visualFound' && value === 'yes') {
        next.injectionDone = '';
        next.heatingComponent = '';
        next.heatingMeasurementValue = '';
      }
      if (key === 'injectionDone' && value !== 'yes') {
        next.heatingComponent = '';
        next.heatingMeasurementValue = '';
      }
      if (key === 'heatingComponent' && value !== current.heatingComponent) {
        next.heatingMeasurementValue = '';
      }
      return next;
    });
  };

  // Resolve tensão esperada: custom > default
  const resolveExp = (nodeOrPin, st) => {
    if (customExp[nodeOrPin.id]?.[st]) return customExp[nodeOrPin.id][st];
    return nodeOrPin.exp[st];
  };

  const setMeasure = (id, val) => setMeas(prev => ({ ...prev, [id]: val }));

  // Coleta todos os IDs mensuráveis (nós + pinos MOSFET)
  const allMeasIds = DEFAULT_NODES.flatMap(n => n.mosfet && n.pins ? n.pins.map(p=>p.id) : [n.id]);
  const filled = allMeasIds.filter(id => measurements[id] && String(measurements[id]).trim() !== '');

  // Stats — conta pinos MOSFET também
  const counts = { ok: 0, warn: 0, bad: 0 };
  for (const n of DEFAULT_NODES) {
    const items = n.mosfet && n.pins ? n.pins : [n];
    for (const item of items) {
      const val = measurements[item.id] ?? '';
      const s = getStatus(val, resolveExp(item, stage));
      if (counts[s] !== undefined) counts[s]++;
    }
  }

  const selNode = DEFAULT_NODES.find(n => n.id === selected);

  // Posição efetiva do nó (custom ou padrão do DEFAULT_NODES)
  const npos = node => ({ x: nodePositions[node.id]?.x ?? node.x, y: nodePositions[node.id]?.y ?? node.y });

  // Drag de nó individual
  const onNodeDragStart = (e, nodeId) => {
    if (e.button !== 0 || showEditor || panMode) return;
    e.stopPropagation();
    dragMoved.current = false;
    dragging.current = { id: nodeId, lastX: e.clientX, lastY: e.clientY };
  };

  // Pan & drag handlers — mousemove/mouseup on window so pan works even if mouse leaves canvas
  const onMD = e => {
    if (e.button !== 0 || showEditor) return;
    isPanning.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
  };

  useEffect(() => {
    const onWinMM = e => {
      if (dragging.current) {
        const dx = (e.clientX - dragging.current.lastX) / scale;
        const dy = (e.clientY - dragging.current.lastY) / scale;
        const id = dragging.current.id;
        const base = DEFAULT_NODES.find(n => n.id === id);
        setNodePositions(prev => {
          const cur = prev[id] ?? { x: base.x, y: base.y };
          return { ...prev, [id]: { x: cur.x + dx, y: cur.y + dy } };
        });
        dragging.current = { ...dragging.current, lastX: e.clientX, lastY: e.clientY };
        dragMoved.current = true;
        return;
      }
      if (!isPanning.current) return;
      setPan(p => ({ x: p.x + e.clientX - lastMouse.current.x, y: p.y + e.clientY - lastMouse.current.y }));
      lastMouse.current = { x: e.clientX, y: e.clientY };
    };
    const onWinMU = () => { isPanning.current = false; dragging.current = null; };
    window.addEventListener('mousemove', onWinMM);
    window.addEventListener('mouseup',   onWinMU);
    return () => {
      window.removeEventListener('mousemove', onWinMM);
      window.removeEventListener('mouseup',   onWinMU);
    };
  }, [scale]);

  const onMU = () => {};
  const onWheel = e => {
    e.preventDefault();
    const delta    = e.deltaY > 0 ? -0.08 : 0.08;
    const s        = scaleRef.current;
    const newScale = Math.min(2, Math.max(0.3, s + delta));
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const cx = (mx - panRef.current.x) / s;
    const cy = (my - panRef.current.y) / s;
    const newPan = { x: mx - cx * newScale, y: my - cy * newScale };
    panRef.current = newPan;
    scaleRef.current = newScale;
    setPan(newPan);
    setScale(newScale);
  };

  const nc = n => { const p = npos(n); return { x: p.x + n.w / 2, y: p.y + n.h / 2 }; };

  // Node-level status for edges (uses pin statuses if MOSFET)
  const nodeStatus = (n) => {
    if (n.mosfet && n.pins) {
      const sts = n.pins.map(p => getStatus(measurements[p.id] ?? '', resolveExp(p, stage)));
      if (sts.some(s=>s==='bad')) return 'bad';
      if (sts.some(s=>s==='warn')) return 'warn';
      if (sts.every(s=>s==='ok')) return 'ok';
      return 'empty';
    }
    return getStatus(measurements[n.id] ?? '', resolveExp(n, stage));
  };

  // Representative status dot for node box
  const nodeDotStatus = nodeStatus;

  const showChecklistTab = Boolean(diagnosticChecklist);
  const showSchematicTab = Boolean(activeSchematic);
  const entryComponents = schematicEntryComponents.length > 0
    ? schematicEntryComponents
    : buildEntryComponents(activeSchematic);

  if (workspaceTab === 'checklist' && diagnosticChecklist) {
    return (
      <div className="flex flex-col h-full bg-[#070d18] text-gray-100 overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 py-2 border-b border-slate-700/60 shrink-0 flex-wrap">
          <button onClick={onBack} className="flex items-center gap-1.5 text-slate-400 hover:text-white text-sm transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
            Voltar
          </button>
          <div className="h-4 w-px bg-slate-700"/>
          <span className="text-sm font-semibold text-slate-200">Checklist visual de diagnóstico</span>

          <div className="ml-auto flex gap-1">
            <button className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white">
              Checklist
            </button>
            {showSchematicTab && (
              <button
                onClick={() => setWorkspaceTab('schematic')}
                className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
              >
                Esquema
              </button>
            )}
            <button
              onClick={() => setWorkspaceTab('analyzer')}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
            >
              Mapa técnico
            </button>
          </div>
        </div>
        <DiagnosticChecklistPanel
          checklist={diagnosticChecklist}
          guidedState={guidedState}
          onGuidedChange={updateGuidedState}
          entryComponents={entryComponents}
          activeSchematic={activeSchematic}
        />
      </div>
    );
  }

  if (activeSchematic && workspaceTab === 'schematic') {
    const title = activeSchematic.title || activeSchematic.label || 'Esquema';
    const label = activeSchematic.label || activeSchematic.path || '';
    const kind = activeSchematic.kind || 'pdf';

    return (
      <div className="flex flex-col h-full bg-[#070d18] text-gray-100 overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 py-2 border-b border-slate-700/60 shrink-0">
          <button onClick={onBack} className="flex items-center gap-1.5 text-slate-400 hover:text-white text-sm transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
            Voltar
          </button>
          <div className="h-4 w-px bg-slate-700"/>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-200 truncate">Esquema — {title}</p>
            <p className="text-xs text-slate-500 truncate">{label}</p>
          </div>
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            {showChecklistTab && (
              <button
                onClick={() => setWorkspaceTab('checklist')}
                className="px-2.5 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg transition-colors"
              >
                Checklist
              </button>
            )}
            <button
              onClick={() => setWorkspaceTab('analyzer')}
              className="px-2.5 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg transition-colors"
            >
              Mapa técnico
            </button>
            <button
              onClick={() => window.electronAPI?.openPath?.(activeSchematic.path)}
              className="px-2.5 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg transition-colors"
            >
              Abrir externo
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 bg-slate-950">
          {schematicError ? (
            <div className="h-full flex items-center justify-center text-center px-6">
              <div>
                <p className="text-sm text-red-300 font-semibold mb-2">Não consegui carregar o esquema no painel.</p>
                <p className="text-xs text-slate-500">{schematicError}</p>
              </div>
            </div>
          ) : !schematicDataUrl ? (
            <div className="h-full flex items-center justify-center text-slate-500 text-sm">Carregando esquema...</div>
          ) : kind === 'image' ? (
            <div className="h-full w-full overflow-auto flex items-start justify-center p-4">
              <img src={schematicDataUrl} alt={title} className="max-w-none min-w-[60%] bg-white" />
            </div>
          ) : (
            <iframe title={title} src={schematicDataUrl} className="w-full h-full border-0 bg-white" />
          )}
        </div>
      </div>
    );
  }

  if (workspaceTab === 'guided' && diagnosticChecklist) {
    return (
      <div className="flex flex-col h-full bg-[#070d18] text-gray-100 overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 py-2 border-b border-slate-700/60 shrink-0 flex-wrap">
          <button onClick={onBack} className="flex items-center gap-1.5 text-slate-400 hover:text-white text-sm transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
            Voltar
          </button>
          <div className="h-4 w-px bg-slate-700"/>
          <span className="text-sm font-semibold text-slate-200">Checklist visual de diagnóstico</span>

          <div className="ml-auto flex gap-1 flex-wrap">
            <button className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white">Checklist</button>
            {showSchematicTab && (
              <button
                onClick={() => setWorkspaceTab('schematic')}
                className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
              >
                Esquema
              </button>
            )}
            <button
              onClick={() => setWorkspaceTab('analyzer')}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
            >
              Mapa técnico
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <DiagnosticChecklistPanel
            checklist={diagnosticChecklist}
            guidedState={guidedState}
            onGuidedChange={updateGuidedState}
            entryComponents={entryComponents}
            activeSchematic={activeSchematic}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#070d18] text-gray-100 overflow-hidden select-none">

      {/* ── Barra superior ── */}
      <div className="flex items-center gap-2.5 px-4 py-2 border-b border-slate-700/60 shrink-0 flex-wrap">
        <button onClick={onBack} className="flex items-center gap-1.5 text-slate-400 hover:text-white text-sm transition-colors">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          Voltar
        </button>
        <div className="h-4 w-px bg-slate-700"/>
        <span className="text-sm font-semibold text-slate-200">🔬 Analisador — CSPRH LA-E921P / BQ24735RGRR (4S)</span>

        <div className="ml-auto flex gap-1">
          {showChecklistTab && (
            <button
              onClick={() => setWorkspaceTab('checklist')}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
            >
              Checklist
            </button>
          )}
          {showSchematicTab && (
            <button
              onClick={() => setWorkspaceTab('schematic')}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
            >
              Esquema
            </button>
          )}
          {STAGES.map(s => (
            <button key={s.id} onClick={() => setStage(s.id)}
              className={['px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors',
                stage===s.id ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'].join(' ')}>
              {s.icon} {s.short}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 ml-2">
          <button onClick={() => setScale(s => Math.min(2, s+0.1))} className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded text-slate-300">＋</button>
          <span className="text-xs text-slate-500 w-9 text-center">{Math.round(scale*100)}%</span>
          <button onClick={() => setScale(s => Math.max(0.3, s-0.1))} className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded text-slate-300">－</button>
          <button onClick={() => { scaleRef.current=0.72; panRef.current={x:10,y:20}; setScale(0.72); setPan({x:10,y:20}); }} className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded text-slate-400" title="Reset view">⌂</button>
          <button onClick={() => { if(window.confirm('Resetar posições dos blocos para o padrão?')) setNodePositions({}); }} className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded text-slate-400" title="Resetar layout dos blocos">⊞</button>
          <button onClick={() => setPanMode(v => !v)} className={`px-2 py-1 text-xs rounded transition-colors ${panMode ? 'bg-blue-600 text-white' : 'bg-slate-700 hover:bg-slate-600 text-slate-300'}`} title="Modo mover canvas (pan)">🖐</button>
        </div>
        <button onClick={() => setShowEditor(true)} className="ml-2 px-2.5 py-1.5 text-xs bg-slate-700 hover:bg-blue-700 text-slate-300 rounded-lg transition-colors" title="Editar tensões esperadas">⚙ Tensões</button>
        <button onClick={() => { if(window.confirm('Limpar todas as medições?')) setMeas({}); }} className="text-xs text-slate-600 hover:text-red-400 transition-colors ml-1">🗑</button>
      </div>

      {/* ── Corpo ── */}
      <div className="flex flex-col flex-1 overflow-hidden">

        {/* ── Canvas ── */}
        <div className="flex-1 overflow-hidden relative"
          style={{ cursor: panMode ? 'crosshair' : 'grab', background: '#070d18' }}
          onMouseDown={onMD}
          onWheel={onWheel}>

          <svg width="100%" height="100%">
            <defs>
              <pattern id="grid" width="36" height="36" patternUnits="userSpaceOnUse"
                patternTransform={`translate(${pan.x%36} ${pan.y%36})`}>
                <path d="M 36 0 L 0 0 0 36" fill="none" stroke="#0d1b2a" strokeWidth="1"/>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)"/>

            <g transform={`translate(${pan.x} ${pan.y}) scale(${scale})`}>

              {/* Faixas de seção */}
              {[
                { sec:'entrada', x:22,  y:105, w:168, h:510, color:'#3b82f620' },
                { sec:'mosfet',  x:368, y:105, w:170, h:475, color:'#8b5cf620' },
                { sec:'ci',      x:566, y:105, w:158, h:490, color:'#10b98118' },
                { sec:'chav',    x:758, y:105, w:170, h:435, color:'#f9731618' },
                { sec:'bat',     x:966, y:105, w:162, h:465, color:'#06b6d418' },
              ].map(z => (
                <g key={z.sec}>
                  <rect x={z.x} y={z.y} width={z.w} height={z.h} rx={10} fill={z.color} stroke="none"/>
                  <text x={z.x+z.w/2} y={z.y+13} fontSize={9} fill="#475569" textAnchor="middle" fontFamily="sans-serif" fontWeight="600">
                    {SECTION_LABELS[z.sec]}
                  </text>
                </g>
              ))}

              {/* Conexões */}
              {EDGES.map(([aId,bId],i) => {
                const a=DEFAULT_NODES.find(n=>n.id===aId), b=DEFAULT_NODES.find(n=>n.id===bId);
                if (!a||!b) return null;
                const {x:ax,y:ay}=nc(a), {x:bx,y:by}=nc(b);
                const mx=(ax+bx)/2;
                const stA=nodeStatus(a), stB=nodeStatus(b);
                const col = stA==='bad'||stB==='bad' ? '#ef4444' : stA==='ok'&&stB==='ok' ? '#16a34a' : '#1e3a5f';
                const dash = stA==='empty'||stB==='empty' ? '5 3' : 'none';
                return <path key={i} d={`M ${ax} ${ay} C ${mx} ${ay}, ${mx} ${by}, ${bx} ${by}`}
                  fill="none" stroke={col} strokeWidth={1.5} strokeDasharray={dash} opacity={0.65}/>;
              })}

              {/* Nós */}
              {DEFAULT_NODES.map(node => {
                const { x: nx, y: ny } = npos(node);
                const isSel = selected === node.id;
                const dSt   = nodeDotStatus(node);
                const dotColor = ST_STYLE[dSt].dot;

                if (node.mosfet && node.pins) {
                  // ── Caixa MOSFET com 3 pinos ──
                  const pinH = (node.h - 26) / node.pins.length;
                  return (
                    <g key={node.id}
                      onMouseDown={e => onNodeDragStart(e, node.id)}
                      onClick={e=>{ e.stopPropagation(); if (!dragMoved.current) setSelected(isSel?null:node.id); }}
                      style={{cursor:'grab'}}>
                      {isSel && <rect x={nx-5} y={ny-5} width={node.w+10} height={node.h+10} rx={11} fill="none" stroke={node.color} strokeWidth={2.5} opacity={0.4}/>}
                      <rect x={nx} y={ny} width={node.w} height={node.h} rx={8} fill="#0d1929" stroke={isSel?node.color:'#1e3a5f'} strokeWidth={isSel?2:1}/>
                      {/* Barra colorida */}
                      <rect x={nx} y={ny} width={4} height={node.h} rx={3} fill={node.color} opacity={0.9}/>
                      {/* Dot status */}
                      <circle cx={nx+node.w-10} cy={ny+12} r={4} fill={dotColor}/>
                      {/* GND symbol */}
                      {node.gnd && <text x={nx+node.w-22} cy={ny+12} fontSize={10} fill="#64748b" fontFamily="sans-serif">▼</text>}
                      {/* Header */}
                      <text x={nx+11} y={ny+13} fontSize={9} fontWeight="700" fill={node.color} fontFamily="'Courier New',monospace">
                        {node.signal}
                      </text>
                      <text x={nx+11} y={ny+23} fontSize={7.5} fill="#64748b" fontFamily="sans-serif">
                        {node.comp}{node.gnd ? ' ▼GND' : ''}
                      </text>
                      {/* Separador */}
                      <line x1={nx+4} y1={ny+28} x2={nx+node.w} y2={ny+28} stroke="#1e3a5f" strokeWidth={1}/>
                      {/* Pinos */}
                      {node.pins.map((pin, pi) => {
                        const py  = ny + 29 + pi * pinH;
                        const pval= measurements[pin.id] ?? '';
                        const pExp= resolveExp(pin, stage);
                        const pSt = getStatus(pval, pExp);
                        const ps  = ST_STYLE[pSt];
                        return (
                          <g key={pin.id}>
                            <rect x={nx+6} y={py+1} width={node.w-10} height={pinH-3} rx={5} fill={ps.bg} opacity={0.8}/>
                            <text x={nx+12} y={py+10} fontSize={7.5} fill="#64748b" fontFamily="sans-serif">{pin.label.split(' – ')[0]} –</text>
                            <text x={nx+12} y={py+20} fontSize={7.5} fill={pval&&String(pval).trim()!=='' ? ps.text : '#334155'} fontWeight="600" fontFamily="'Courier New',monospace">
                              {pval&&String(pval).trim()!=='' ? `${pval}V` : pExp.v}
                            </text>
                            <circle cx={nx+node.w-12} cy={py+11} r={3.5} fill={ps.dot}/>
                          </g>
                        );
                      })}
                    </g>
                  );
                }

                // ── Caixa normal ──
                const exp   = resolveExp(node, stage);
                const val   = measurements[node.id] ?? '';
                const status= getStatus(val, exp);
                const st    = ST_STYLE[status];
                return (
                  <g key={node.id}
                    onMouseDown={e => onNodeDragStart(e, node.id)}
                    onClick={e=>{ e.stopPropagation(); if (!dragMoved.current) setSelected(isSel?null:node.id); }}
                    style={{cursor:'grab'}}>
                    {isSel && <rect x={nx-5} y={ny-5} width={node.w+10} height={node.h+10} rx={11} fill="none" stroke={node.color} strokeWidth={2.5} opacity={0.4}/>}
                    <rect x={nx} y={ny} width={node.w} height={node.h} rx={8} fill={st.bg} stroke={isSel?node.color:st.border} strokeWidth={isSel?2:1}/>
                    <rect x={nx} y={ny} width={4} height={node.h} rx={3} fill={node.color} opacity={0.9}/>
                    <circle cx={nx+node.w-9} cy={ny+10} r={4} fill={st.dot}/>
                    <text x={nx+11} y={ny+16} fontSize={9.5} fontWeight="700" fill={node.color} fontFamily="'Courier New',monospace">
                      {node.signal.length>15 ? node.signal.slice(0,15)+'…' : node.signal}
                    </text>
                    <text x={nx+11} y={ny+27} fontSize={8} fill="#94a3b8" fontFamily="sans-serif">{node.comp}</text>
                    <text x={nx+11} y={ny+40} fontSize={7.5} fill="#475569" fontFamily="'Courier New',monospace">Esp: {exp.v}</text>
                    <text x={nx+11} y={ny+53} fontSize={9.5} fontWeight="700" fill={st.text} fontFamily="'Courier New',monospace">
                      {val&&String(val).trim()!=='' ? `${val} V` : '— V'}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>

          {/* Legenda */}
          <div className="absolute bottom-3 left-3 flex gap-2 pointer-events-none flex-wrap">
            {[['#22c55e','OK'],['#f59e0b','Atenção'],['#ef4444','Falha'],['#334155','Sem medição']].map(([c,l]) => (
              <div key={l} className="flex items-center gap-1.5 bg-black/70 rounded-full px-2.5 py-1 text-xs">
                <span className="w-2 h-2 rounded-full" style={{background:c}}/>
                <span className="text-slate-300">{l}</span>
              </div>
            ))}
            <div className="text-xs bg-black/70 rounded-full px-2.5 py-1 text-slate-500">🖱 Arraste fundo=pan · Bloco=mover · Scroll=zoom</div>
          </div>
        </div>

      </div>

      {/* ── Painel de detalhes (horizontal) ── */}
      {/* Toggle bar */}
      <div className="shrink-0 border-t border-slate-700/60 flex items-center bg-slate-900 px-3 py-1 gap-2">
        <button
          onClick={() => setDetailHidden(v => !v)}
          className="flex items-center gap-1.5 text-[10px] text-slate-500 hover:text-slate-300 transition-colors select-none"
          title={detailHidden ? 'Mostrar painel de detalhes' : 'Ocultar painel de detalhes'}
        >
          <span className={`inline-block transition-transform ${detailHidden ? 'rotate-180' : ''}`}>▾</span>
          {detailHidden ? 'Mostrar detalhes' : 'Ocultar detalhes'}
        </button>
      </div>
      <div className={`shrink-0 border-slate-700/60 flex bg-slate-900 overflow-hidden transition-all duration-200 ${detailHidden ? 'h-0' : 'h-[240px]'}`}>
        {selNode ? (
          <>
            {/* Col 1 – Info + estágios */}
            <div className="w-52 shrink-0 border-r border-slate-700/40 overflow-y-auto px-3 py-2">
              <div className="flex items-start justify-between mb-1">
                <div>
                  <p className="text-xs font-bold font-mono flex items-center gap-1 flex-wrap" style={{color:selNode.color}}>
                    {selNode.mosfet && <span className="text-[10px] bg-purple-800/40 text-purple-300 px-1 py-0.5 rounded-full font-sans font-normal">MOSFET</span>}
                    {selNode.gnd && <span className="text-[10px] bg-slate-700 text-slate-400 px-1 py-0.5 rounded-full font-sans font-normal">▼ GND</span>}
                    {selNode.signal}
                  </p>
                  <p className="text-[10px] text-slate-400">{selNode.comp}</p>
                </div>
                <button onClick={()=>setSelected(null)} className="text-slate-600 hover:text-slate-300 ml-1 shrink-0">✕</button>
              </div>
              <p className="text-[10px] text-slate-500 leading-relaxed mb-2">{selNode.desc}</p>
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Estágios</p>
              {STAGES.map(s => {
                const displayNode = selNode.mosfet && selNode.pins ? selNode.pins[0] : selNode;
                const e = resolveExp(displayNode, s.id);
                return (
                  <div key={s.id} className={['flex justify-between items-center rounded px-2 py-1 mb-0.5 text-[10px] transition-colors',
                    s.id===stage ? 'bg-slate-700 text-slate-200' : 'bg-slate-800/50 text-slate-500'].join(' ')}>
                    <span>{s.icon} {s.short}</span>
                    <span className="font-mono font-semibold">{e.v}</span>
                  </div>
                );
              })}
            </div>

            {/* Col 2 – Inputs de medição */}
            <div className="flex-1 overflow-y-auto px-3 py-2">
              {selNode.mosfet && selNode.pins ? (
                <div className="flex gap-2 h-full">
                  {selNode.pins.map(pin => {
                    const pExp = resolveExp(pin, stage);
                    const pVal = measurements[pin.id] ?? '';
                    const pSt  = getStatus(pVal, pExp);
                    const ps   = ST_STYLE[pSt];
                    return (
                      <div key={pin.id} className="flex-1 bg-slate-800 rounded-xl p-2 flex flex-col">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-[10px] font-semibold text-slate-300 leading-tight">{pin.label}</p>
                          <span className="w-2 h-2 rounded-full inline-block shrink-0" style={{background:ps.dot}}/>
                        </div>
                        <p className="text-[10px] text-slate-500 mb-1">
                          {pExp.v}{pExp.min!==null && <span className="text-slate-600 ml-1">({pExp.min}–{pExp.max})</span>}
                        </p>
                        <div className="flex items-center gap-1 mt-auto">
                          <input type="text" inputMode="decimal"
                            value={pVal}
                            onChange={e=>setMeasure(pin.id, e.target.value)}
                            placeholder="V"
                            style={{userSelect:'text'}} onMouseDown={e=>e.stopPropagation()}
                            className="flex-1 min-w-0 bg-slate-700 border border-slate-600 focus:border-blue-500 rounded-lg px-2 py-1.5 text-sm text-slate-100 placeholder-slate-600 outline-none font-mono"/>
                          <span className="text-[10px] text-slate-500 font-mono font-bold">V</span>
                          {pVal!=='' && <button onClick={()=>setMeasure(pin.id,'')} className="text-slate-600 hover:text-red-400 text-xs">✕</button>}
                        </div>
                        {pSt!=='empty'&&pSt!=='na' && (
                          <p className={['text-[10px] mt-1 font-semibold',
                            pSt==='ok'?'text-green-400':pSt==='warn'?'text-yellow-400':'text-red-400'].join(' ')}>
                            {pSt==='ok'?'✓ OK':pSt==='warn'?'⚠ Fora':'✗ Falha!'}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                (() => {
                  const exp = resolveExp(selNode, stage);
                  const val = measurements[selNode.id] ?? '';
                  const st  = getStatus(val, exp);
                  return (
                    <>
                      <div className="bg-slate-800 rounded-xl p-2 mb-2">
                        <p className="text-[10px] text-slate-500 mb-0.5">Esperado — {STAGES.find(s=>s.id===stage)?.label}</p>
                        <p className="text-xl font-bold font-mono text-slate-100">{exp.v}</p>
                        {exp.min!==null && <p className="text-[10px] text-slate-600">Faixa: {exp.min}V – {exp.max}V</p>}
                      </div>
                      <div className="mb-2">
                        <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1 block">📐 Tensão Medida</label>
                        <div className="flex items-center gap-2">
                          <input type="text" inputMode="decimal"
                            value={val}
                            onChange={e=>setMeasure(selNode.id, e.target.value)}
                            placeholder="Ex: 18.9"
                            className="flex-1 bg-slate-700 border border-slate-600 focus:border-blue-500 rounded-xl px-3 py-2 text-base text-slate-100 placeholder-slate-600 outline-none font-mono"
                            style={{userSelect:'text'}} onMouseDown={e=>e.stopPropagation()}
                            autoFocus/>
                          <span className="text-xs text-slate-500 font-mono font-bold">V</span>
                          {val!=='' && <button onClick={()=>setMeasure(selNode.id,'')} className="text-slate-600 hover:text-red-400">✕</button>}
                        </div>
                      </div>
                      {st!=='empty'&&st!=='na' && (
                        <div className={['rounded-xl p-2 text-xs font-semibold',
                          st==='ok'?'bg-green-900/30 text-green-400 border border-green-700/40':
                          st==='warn'?'bg-yellow-900/30 text-yellow-400 border border-yellow-700/40':
                          'bg-red-900/30 text-red-400 border border-red-700/40'].join(' ')}>
                          {st==='ok'?'✓ Tensão dentro do esperado.':st==='warn'?'⚠ Levemente fora da faixa.':'✗ Tensão fora do esperado!'}
                        </div>
                      )}
                      {selNode.id==='dcin'&&st==='bad'&&parseFloat(val)>0.5&&stage==='battery' && (
                        <div className="rounded-xl p-2 bg-red-950/40 border border-red-700/50 text-[10px] text-red-300 leading-relaxed mt-2">
                          🚨 <strong>Retorno de tensão para DCIN!</strong> Com só bateria DCIN deve ser 0V. Verifique pull-down, gate PQ302/PQ303.
                        </div>
                      )}
                      {selNode.id==='acdrv_sig'&&st==='bad'&&stage!=='battery' && (
                        <div className="rounded-xl p-2 bg-yellow-950/40 border border-yellow-700/50 text-[10px] text-yellow-300 leading-relaxed mt-2">
                          ⚠ ACDRV inativo! MOSFETs de entrada não abrem. Verifique ACDET e CI BQ24735.
                        </div>
                      )}
                      {selNode.id==='regn'&&st==='bad' && (
                        <div className="rounded-xl p-2 bg-yellow-950/40 border border-yellow-700/50 text-[10px] text-yellow-300 leading-relaxed mt-2">
                          ⚠ REGN ausente — CI charger sem alimentação ou defeituoso.
                        </div>
                      )}
                    </>
                  );
                })()
              )}
            </div>

            {/* Col 3 – Lista de pontos */}
            <div className="w-48 shrink-0 border-l border-slate-700/40 overflow-y-auto px-2 py-2">
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1 px-1">📋 Pontos</p>
              {DEFAULT_NODES.flatMap(node => {
                const items = node.mosfet && node.pins ? node.pins.map(p => ({ ...p, _nodeColor: node.color })) : [{ ...node, _nodeColor: node.color }];
                return items.map(item => {
                  const val    = measurements[item.id] ?? '';
                  const exp    = resolveExp(item, stage);
                  const status = getStatus(val, exp);
                  const st     = ST_STYLE[status];
                  return (
                    <button key={item.id}
                      onClick={() => setSelected(node.id)}
                      className={['w-full flex items-center gap-1.5 px-2 py-1 rounded text-left text-[10px] mb-0.5 transition-colors',
                        selected===node.id ? 'bg-slate-700' : 'hover:bg-slate-800'].join(' ')}>
                      <span className="w-2 h-2 rounded-full shrink-0" style={{background:st.dot}}/>
                      <span className="flex-1 font-mono text-slate-300 truncate">{item.signal || item.label}</span>
                      <span style={{color:st.text}} className="font-mono shrink-0">
                        {val&&String(val).trim()!=='' ? `${val}V` : '—'}
                      </span>
                    </button>
                  );
                });
              })}
            </div>
          </>
        ) : (
          <>
            <div className="flex-1 flex items-center justify-center text-slate-600 px-6 gap-4">
              <span className="text-3xl opacity-40">🖱</span>
              <p className="text-sm">Clique em um componente no mapa para ver detalhes e inserir a tensão medida</p>
              {counts.bad > 0 && (
                <p className="text-xs text-red-400 bg-red-900/20 rounded-xl px-3 py-2 border border-red-800/40 shrink-0">
                  ⚠ {counts.bad} ponto(s) com falha!
                </p>
              )}
            </div>
            <div className="w-48 shrink-0 border-l border-slate-700/40 overflow-y-auto px-2 py-2">
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1 px-1">📋 Pontos</p>
              {DEFAULT_NODES.flatMap(node => {
                const items = node.mosfet && node.pins ? node.pins.map(p => ({ ...p, _nodeColor: node.color })) : [{ ...node, _nodeColor: node.color }];
                return items.map(item => {
                  const val    = measurements[item.id] ?? '';
                  const exp    = resolveExp(item, stage);
                  const status = getStatus(val, exp);
                  const st     = ST_STYLE[status];
                  return (
                    <button key={item.id}
                      onClick={() => setSelected(node.id)}
                      className={['w-full flex items-center gap-1.5 px-2 py-1 rounded text-left text-[10px] mb-0.5 transition-colors',
                        selected===node.id ? 'bg-slate-700' : 'hover:bg-slate-800'].join(' ')}>
                      <span className="w-2 h-2 rounded-full shrink-0" style={{background:st.dot}}/>
                      <span className="flex-1 font-mono text-slate-300 truncate">{item.signal || item.label}</span>
                      <span style={{color:st.text}} className="font-mono shrink-0">
                        {val&&String(val).trim()!=='' ? `${val}V` : '—'}
                      </span>
                    </button>
                  );
                });
              })}
            </div>
          </>
        )}
      </div>

      {/* Resumo — barra inferior full-width */}
      <div className="border-t border-slate-700/60 shrink-0 px-3 py-2 flex gap-2">
        {[
          [`${filled.length}/${allMeasIds.length}`, 'Medidos', 'text-slate-300', 'bg-slate-800'],
          [counts.ok,   'OK',      'text-green-400',  'bg-green-900/30'],
          [counts.warn, 'Atenção', 'text-yellow-400', 'bg-yellow-900/30'],
          [counts.bad,  'Falha',   'text-red-400',    'bg-red-900/30'],
        ].map(([v,l,tc,bg]) => (
          <div key={l} className={`rounded-lg px-4 py-1.5 flex items-center gap-2 ${bg}`}>
            <span className={`text-sm font-bold font-mono leading-none ${tc}`}>{v}</span>
            <span className={`text-xs ${tc} opacity-60`}>{l}</span>
          </div>
        ))}
      </div>

      {/* ── Modal editor de tensões ── */}
      {showEditor && (
        <ExpEditor
          nodes={DEFAULT_NODES}
          customExp={customExp}
          onSave={data => { setCustomExp(data); setShowEditor(false); }}
          onClose={() => setShowEditor(false)}
        />
      )}
    </div>
  );
}
