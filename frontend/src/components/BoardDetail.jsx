import { useEffect, useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL || '/api';
const isElectron = typeof window !== 'undefined' && !!window.electronAPI;

/** Converte caminho local em URL file:// para o Electron */
function toFileUrl(filePath) {
  if (!filePath) return '';
  return 'file:///' + filePath.replace(/\\/g, '/');
}

/** Detecta a extensão de um arquivo */
function fileExt(p) {
  return (p || '').split('.').pop().toLowerCase();
}

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'bmp', 'gif', 'webp', 'svg'];
const COMMON_VOLTAGES = ['1.0V', '1.2V', '1.35V', '1.5V', '1.8V', '2.5V', '3.3V', '5.0V', '12V', '19V'];

export default function BoardDetail({ board, onBack, onRefresh }) {
  // ── Defeitos ────────────────────────────────────────────────────────────────
  const [nomeDefeito, setNomeDefeito]   = useState('');
  const [descDefeito, setDescDefeito]   = useState('');
  const [loadingDefect, setLoadingDefect] = useState(false);
  const [errorDefect, setErrorDefect]   = useState('');

  // ── Tensões ─────────────────────────────────────────────────────────────────
  const [vpRef, setVpRef]       = useState('');
  const [vpTensao, setVpTensao] = useState('');
  const [vpObs, setVpObs]       = useState('');
  const [loadingVp, setLoadingVp] = useState(false);
  const [errorVp, setErrorVp]   = useState('');

  // ── Esquema inline ───────────────────────────────────────────────────────────
  const [showSchematic, setShowSchematic] = useState(false);
  const [parsing, setParsing]             = useState(false);
  const [parseMsg, setParseMsg]           = useState('');

  // ── Tensão — campo componente ────────────────────────────────────────────
  const [vpComponente, setVpComponente] = useState('');

  // ── Casos de reparo ───────────────────────────────────────────────────────
  const [repairCases, setRepairCases] = useState([]);
  const [caseSymptom, setCaseSymptom] = useState('');
  const [caseMeasurements, setCaseMeasurements] = useState('');
  const [caseAnalysis, setCaseAnalysis] = useState('');
  const [caseCause, setCaseCause] = useState('');
  const [caseSolution, setCaseSolution] = useState('');
  const [caseResult, setCaseResult] = useState('');
  const [loadingCase, setLoadingCase] = useState(false);
  const [errorCase, setErrorCase] = useState('');

  useEffect(() => {
    loadRepairCases();
  }, [board.id]);

  async function loadRepairCases() {
    try {
      const res = await fetch(`${API_URL}/boards/${board.id}/repair-cases`);
      const data = await res.json();
      if (res.ok) setRepairCases(data);
    } catch {
      setRepairCases([]);
    }
  }

  function parseMeasurements(text) {
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [left, ...right] = line.split('=');
        if (right.length === 0) return { signal: line, measured: '', expected: '', note: '' };
        return { signal: left.trim(), measured: right.join('=').trim(), expected: '', note: '' };
      });
  }

  function handleToggleSchematic() {
    setShowSchematic(prev => !prev);
  }

  // ── Adicionar defeito ────────────────────────────────────────────────────────
  async function handleAddDefect(e) {
    e.preventDefault();
    setErrorDefect('');
    if (!nomeDefeito.trim() || !descDefeito.trim()) {
      setErrorDefect('Preencha o nome e a descrição do defeito.');
      return;
    }
    setLoadingDefect(true);
    try {
      const res = await fetch(`${API_URL}/boards/${board.id}/defects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: nomeDefeito, descricao: descDefeito }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setNomeDefeito('');
      setDescDefeito('');
      onRefresh(board.id);
    } catch (err) {
      setErrorDefect(err.message);
    } finally {
      setLoadingDefect(false);
    }
  }

  async function handleDeleteDefect(defectId) {
    if (!confirm('Remover este defeito?')) return;
    await fetch(`${API_URL}/boards/${board.id}/defects/${defectId}`, { method: 'DELETE' });
    onRefresh(board.id);
  }

  async function handleAddRepairCase(e) {
    e.preventDefault();
    setErrorCase('');
    if (!caseSymptom.trim()) {
      setErrorCase('Informe pelo menos o sintoma do caso.');
      return;
    }

    setLoadingCase(true);
    try {
      const res = await fetch(`${API_URL}/boards/${board.id}/repair-cases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symptom: caseSymptom,
          measurements: parseMeasurements(caseMeasurements),
          analysis: caseAnalysis,
          cause: caseCause,
          solution: caseSolution,
          result: caseResult,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCaseSymptom('');
      setCaseMeasurements('');
      setCaseAnalysis('');
      setCaseCause('');
      setCaseSolution('');
      setCaseResult('');
      loadRepairCases();
    } catch (err) {
      setErrorCase(err.message);
    } finally {
      setLoadingCase(false);
    }
  }

  async function handleDeleteRepairCase(caseId) {
    if (!confirm('Remover este caso de reparo?')) return;
    await fetch(`${API_URL}/repair-cases/${caseId}`, { method: 'DELETE' });
    loadRepairCases();
  }

  // ── Pontos de tensão ─────────────────────────────────────────────────────────
  async function handleAddVp(e) {
    e.preventDefault();
    setErrorVp('');
    if (!vpRef.trim() || !vpTensao.trim()) {
      setErrorVp('Referência e tensão são obrigatórias.');
      return;
    }
    setLoadingVp(true);
    try {
      const res = await fetch(`${API_URL}/boards/${board.id}/voltagepoints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: vpRef, tensao: vpTensao, observacao: vpObs, componente: vpComponente }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setVpRef(''); setVpTensao(''); setVpObs(''); setVpComponente('');
      onRefresh(board.id);
    } catch (err) {
      setErrorVp(err.message);
    } finally {
      setLoadingVp(false);
    }
  }

  async function handleDeleteVp(vpId) {
    await fetch(`${API_URL}/boards/${board.id}/voltagepoints/${vpId}`, { method: 'DELETE' });
    onRefresh(board.id);
  }

  // ── Auto-extrair PDF ─────────────────────────────────────────────────────────
  async function handleParseSchematic() {
    setParsing(true);
    setParseMsg('');
    try {
      const res = await fetch(`${API_URL}/boards/${board.id}/parse-schematic`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.byRef?.length > 0) {
        setParseMsg(`✅ ${data.byRef.length} ponto(s) extraído(s) e salvos automaticamente!`);
        onRefresh(board.id);
      } else {
        setParseMsg('⚠️ Nenhuma referência de tensão encontrada no PDF. Adicione manualmente.');
      }
    } catch (err) {
      setParseMsg(`⚠️ ${err.message}`);
    } finally {
      setParsing(false);
    }
  }

  const ext = fileExt(board.schematicPath);
  const isImage = IMAGE_EXTS.includes(ext);
  const isPDF   = ext === 'pdf';
  const voltagePoints = board.voltagePoints || [];

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">

      {/* Cabeçalho */}
      <div>
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-accent transition-colors mb-4"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Lista de Placas
        </button>
        <h2 className="text-2xl font-bold text-gray-100">
          {board.marca}{' '}
          <span className="text-accent font-mono">{board.modelo}</span>
        </h2>
        <p className="text-xs text-gray-500 mt-1">
          Cadastrada em {new Date(board.createdAt).toLocaleDateString('pt-BR')}
        </p>
      </div>

      {/* ─── Pontos de Tensão Esperados ─────────────────────────────────────── */}
      <div className="bg-surface-800 border border-surface-600 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            ⚡ Pontos de Tensão Esperados
          </p>
          {board.schematicPath && isPDF && (
            <button
              onClick={handleParseSchematic}
              disabled={parsing}
              title="Re-extrair pontos de tensão do PDF"
              className="text-xs px-2 py-1 rounded bg-surface-700 hover:bg-surface-600 text-accent border border-surface-600 transition-colors disabled:opacity-50"
            >
              {parsing ? 'Extraindo...' : '↻ Re-extrair PDF'}
            </button>
          )}
        </div>

        {parseMsg && (
          <p className="text-xs text-gray-300 bg-surface-700 rounded px-3 py-2">{parseMsg}</p>
        )}

        {/* Referências comuns para seleção rápida */}
        <div className="flex flex-wrap gap-1.5">
          {COMMON_VOLTAGES.map(v => (
            <button
              key={v}
              onClick={() => setVpTensao(v)}
              className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                vpTensao === v
                  ? 'bg-accent border-accent text-white'
                  : 'bg-surface-700 border-surface-600 text-gray-400 hover:text-gray-200'
              }`}
            >
              {v}
            </button>
          ))}
        </div>

        {/* Formulário de adição */}
        <form onSubmit={handleAddVp} className="space-y-2">
          <div className="flex gap-2 flex-wrap">
            <input
              value={vpRef}
              onChange={e => setVpRef(e.target.value)}
              placeholder="Rail (ex: +3VALWP)"
              className="flex-1 min-w-[120px] bg-surface-700 border border-surface-600 rounded-lg px-3 py-1.5 text-sm text-gray-100 placeholder-gray-500 focus:border-accent outline-none uppercase"
            />
            <input
              value={vpTensao}
              onChange={e => setVpTensao(e.target.value)}
              placeholder="Tensão (ex: 3.3V)"
              className="w-28 bg-surface-700 border border-surface-600 rounded-lg px-3 py-1.5 text-sm text-gray-100 placeholder-gray-500 focus:border-accent outline-none"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            <input
              value={vpComponente}
              onChange={e => setVpComponente(e.target.value)}
              placeholder="Componente (ex: SY8286BRAC PU301)"
              className="flex-1 min-w-[160px] bg-surface-700 border border-surface-600 rounded-lg px-3 py-1.5 text-sm text-gray-100 placeholder-gray-500 focus:border-accent outline-none uppercase"
            />
            <input
              value={vpObs}
              onChange={e => setVpObs(e.target.value)}
              placeholder="Obs. (opcional)"
              className="flex-1 min-w-[100px] bg-surface-700 border border-surface-600 rounded-lg px-3 py-1.5 text-sm text-gray-100 placeholder-gray-500 focus:border-accent outline-none"
            />
            <button
              type="submit"
              disabled={loadingVp}
              className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-sm rounded-lg transition-colors disabled:opacity-50 shrink-0"
            >
              +
            </button>
          </div>
        </form>
        {errorVp && <p className="text-xs text-red-400">{errorVp}</p>}

        {/* Tabela de pontos */}
        {voltagePoints.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-surface-600">
                  <th className="text-left pb-1 pr-4">Rail</th>
                  <th className="text-left pb-1 pr-3">Tensão</th>
                  <th className="text-left pb-1 pr-4">Componente</th>
                  <th className="text-left pb-1 flex-1">Obs.</th>
                  <th className="w-6" />
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-700">
                {voltagePoints.map(vp => (
                  <tr key={vp.id} className="group">
                    <td className="py-1.5 pr-4 font-mono text-accent text-xs">{vp.ref}</td>
                    <td className="py-1.5 pr-3 font-semibold text-yellow-400 text-xs">{vp.tensao}</td>
                    <td className="py-1.5 pr-4 text-blue-300 font-mono text-xs">{vp.componente || '—'}</td>
                    <td className="py-1.5 text-gray-400 text-xs">{vp.observacao}</td>
                    <td className="py-1.5 text-right">
                      <button
                        onClick={() => handleDeleteVp(vp.id)}
                        className="text-gray-700 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                          <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-gray-600 text-center py-1">
            Nenhum ponto registrado. Use o formulário acima ou extraia do PDF.
          </p>
        )}
      </div>

      {/* ─── Esquema Elétrico ────────────────────────────────────────────────── */}
      {board.schematicPath ? (
        <div className="bg-surface-800 border border-surface-600 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              📄 Esquema Elétrico
            </p>
            <button
              onClick={handleToggleSchematic}
              className="text-xs px-3 py-1.5 bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors"
            >
              {showSchematic ? 'Fechar' : 'Abrir'}
            </button>
          </div>

          <div className="flex items-center gap-2 text-sm text-gray-300">
            <span className="text-lg">📄</span>
            <span className="truncate flex-1" title={board.schematicPath}>
              {board.schematicName || board.schematicPath}
            </span>
          </div>

          {showSchematic && (
            <div className="fixed inset-0 z-50 bg-black flex flex-col">
              <div className="flex items-center justify-between px-4 py-2 bg-surface-800 border-b border-surface-600 shrink-0">
                <span className="text-sm text-gray-300 truncate">{board.schematicName || board.schematicPath}</span>
                <div className="flex items-center gap-3 shrink-0 ml-4">
                  {isElectron && (
                    <button
                      onClick={() => window.electronAPI.openPath(board.schematicPath)}
                      className="text-xs text-accent hover:underline"
                    >
                      Abrir externo
                    </button>
                  )}
                  <button
                    onClick={() => setShowSchematic(false)}
                    className="text-sm text-gray-400 hover:text-white bg-surface-700 hover:bg-surface-600 px-3 py-1 rounded transition-colors"
                  >
                    ✕ Fechar
                  </button>
                </div>
              </div>
              {isImage && (
                <img
                  src={`${API_URL}/boards/${board.id}/schematic`}
                  alt="Esquema elétrico"
                  className="flex-1 object-contain min-h-0"
                />
              )}
              {isPDF && (
                <iframe
                  src={`${API_URL}/boards/${board.id}/schematic`}
                  title="Esquema elétrico"
                  className="flex-1 w-full border-0 min-h-0"
                />
              )}
              {!isImage && !isPDF && (
                <div className="flex-1 flex items-center justify-center text-sm text-gray-500">
                  Pré-visualização não disponível para .{ext}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="bg-surface-800 border border-dashed border-surface-600 rounded-xl p-4 text-center text-sm text-gray-500">
          Nenhum esquema elétrico vinculado a esta placa.
        </div>
      )}

      {/* ─── Defeitos ────────────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-gray-100">Defeitos Conhecidos</h3>
          <span className="text-xs bg-surface-700 text-gray-400 px-2 py-0.5 rounded-full">
            {board.defects?.length ?? 0} registro(s)
          </span>
        </div>

        <form
          onSubmit={handleAddDefect}
          className="bg-surface-800 border border-surface-600 rounded-xl p-4 space-y-3 mb-4"
        >
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Adicionar Defeito
          </p>
          <input
            type="text"
            value={nomeDefeito}
            onChange={(e) => setNomeDefeito(e.target.value)}
            placeholder="Nome do defeito (ex: Não liga)"
            className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-accent outline-none transition-colors"
          />
          <textarea
            value={descDefeito}
            onChange={(e) => setDescDefeito(e.target.value)}
            rows={3}
            placeholder="Descrição detalhada: sintomas, componentes suspeitos, solução encontrada..."
            className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-accent outline-none transition-colors resize-none"
          />
          {errorDefect && <p className="text-xs text-red-400">{errorDefect}</p>}
          <button
            type="submit"
            disabled={loadingDefect}
            className="w-full bg-accent hover:bg-accent-hover text-white text-sm font-semibold py-2 rounded-lg transition-colors disabled:opacity-50"
          >
            {loadingDefect ? 'Adicionando...' : '+ Adicionar Defeito'}
          </button>
        </form>

        {board.defects?.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">
            Nenhum defeito registrado. Adicione o primeiro acima.
          </p>
        ) : (
          <div className="space-y-3">
            {board.defects.map((defect, idx) => (
              <div
                key={defect.id}
                className="bg-surface-800 border border-surface-600 rounded-xl p-4 group"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono text-gray-500">#{idx + 1}</span>
                      <p className="text-sm font-semibold text-gray-100">{defect.nome}</p>
                    </div>
                    <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
                      {defect.descricao}
                    </p>
                    <p className="text-xs text-gray-500 mt-2">
                      {new Date(defect.createdAt).toLocaleDateString('pt-BR', {
                        day: '2-digit', month: '2-digit', year: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDeleteDefect(defect.id)}
                    title="Remover defeito"
                    className="text-gray-600 hover:text-red-400 transition-colors p-1 rounded shrink-0 opacity-0 group-hover:opacity-100"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14H6L5 6" />
                      <path d="M10 11v6M14 11v6" />
                      <path d="M9 6V4h6v2" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Casos de Reparo ────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-gray-100">Casos de Reparo</h3>
          <span className="text-xs bg-surface-700 text-gray-400 px-2 py-0.5 rounded-full">
            {repairCases.length} caso(s)
          </span>
        </div>

        <form
          onSubmit={handleAddRepairCase}
          className="bg-surface-800 border border-surface-600 rounded-xl p-4 space-y-3 mb-4"
        >
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Registrar caso concluído
          </p>
          <input
            type="text"
            value={caseSymptom}
            onChange={(e) => setCaseSymptom(e.target.value)}
            placeholder="Sintoma (ex: Não liga, sem +5VALW)"
            className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-accent outline-none transition-colors"
          />
          <textarea
            value={caseMeasurements}
            onChange={(e) => setCaseMeasurements(e.target.value)}
            rows={3}
            placeholder={'Medições, uma por linha (ex: VIN = 19.4V)'}
            className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-accent outline-none transition-colors resize-none"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <textarea
              value={caseAnalysis}
              onChange={(e) => setCaseAnalysis(e.target.value)}
              rows={2}
              placeholder="Análise"
              className="bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-accent outline-none transition-colors resize-none"
            />
            <textarea
              value={caseCause}
              onChange={(e) => setCaseCause(e.target.value)}
              rows={2}
              placeholder="Causa encontrada"
              className="bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-accent outline-none transition-colors resize-none"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <textarea
              value={caseSolution}
              onChange={(e) => setCaseSolution(e.target.value)}
              rows={2}
              placeholder="Solução aplicada"
              className="bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-accent outline-none transition-colors resize-none"
            />
            <textarea
              value={caseResult}
              onChange={(e) => setCaseResult(e.target.value)}
              rows={2}
              placeholder="Resultado"
              className="bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-accent outline-none transition-colors resize-none"
            />
          </div>
          {errorCase && <p className="text-xs text-red-400">{errorCase}</p>}
          <button
            type="submit"
            disabled={loadingCase}
            className="w-full bg-accent hover:bg-accent-hover text-white text-sm font-semibold py-2 rounded-lg transition-colors disabled:opacity-50"
          >
            {loadingCase ? 'Salvando...' : '+ Salvar Caso de Reparo'}
          </button>
        </form>

        {repairCases.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">
            Nenhum caso concluído registrado para esta placa.
          </p>
        ) : (
          <div className="space-y-3">
            {repairCases.map((repairCase, idx) => (
              <div
                key={repairCase.id}
                className="bg-surface-800 border border-surface-600 rounded-xl p-4 group"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-gray-500">#{idx + 1}</span>
                      <p className="text-sm font-semibold text-gray-100">{repairCase.symptom}</p>
                    </div>
                    {repairCase.measurements?.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {repairCase.measurements.slice(0, 6).map((measurement, index) => (
                          <span key={index} className="text-xs bg-surface-700 text-yellow-300 border border-surface-600 rounded px-2 py-0.5">
                            {measurement.signal}: {measurement.measured || '-'}
                          </span>
                        ))}
                      </div>
                    )}
                    {repairCase.analysis && <p className="text-sm text-gray-300 whitespace-pre-wrap">Análise: {repairCase.analysis}</p>}
                    {repairCase.cause && <p className="text-sm text-red-300 whitespace-pre-wrap">Causa: {repairCase.cause}</p>}
                    {repairCase.solution && <p className="text-sm text-green-300 whitespace-pre-wrap">Solução: {repairCase.solution}</p>}
                    {repairCase.result && <p className="text-sm text-gray-400 whitespace-pre-wrap">Resultado: {repairCase.result}</p>}
                    <p className="text-xs text-gray-500">
                      {new Date(repairCase.createdAt).toLocaleDateString('pt-BR', {
                        day: '2-digit', month: '2-digit', year: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDeleteRepairCase(repairCase.id)}
                    title="Remover caso"
                    className="text-gray-600 hover:text-red-400 transition-colors p-1 rounded shrink-0 opacity-0 group-hover:opacity-100"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14H6L5 6" />
                      <path d="M10 11v6M14 11v6" />
                      <path d="M9 6V4h6v2" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
