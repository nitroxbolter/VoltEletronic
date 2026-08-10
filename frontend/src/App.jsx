import { useState } from 'react';
import Sidebar from './components/Sidebar';
import BoardForm from './components/BoardForm';
import BoardList from './components/BoardList';
import BoardDetail from './components/BoardDetail';
import ChatPanel from './components/ChatPanel';
import CircuitAnalyzer from './components/CircuitAnalyzer';

const API_URL = import.meta.env.VITE_API_URL || '/api';

function mergeDiagnosticChecklist(previous, patch) {
  if (!patch) return previous;
  if (patch.reset) return null;

  const next = previous ? { ...previous } : {
    boardModel: '',
    deviceModel: '',
    matchedSchematic: '',
    schematicStatus: '',
    summary: '',
    symptom: '',
    sourceBehavior: '',
    findings: [],
    steps: {},
  };

  if (patch.boardModel) next.boardModel = patch.boardModel;
  if (patch.deviceModel) next.deviceModel = patch.deviceModel;
  if (patch.matchedSchematic) next.matchedSchematic = patch.matchedSchematic;
  if (patch.schematicStatus !== undefined) next.schematicStatus = patch.schematicStatus;
  if (patch.summary) next.summary = patch.summary;
  if (patch.symptom) next.symptom = patch.symptom;
  if (patch.sourceBehavior) next.sourceBehavior = patch.sourceBehavior;

  next.steps = {
    ...(previous?.steps || {}),
    ...(patch.steps || {}),
  };

  const mergedFindings = [
    ...(previous?.findings || []),
    ...(patch.findings || []),
  ].filter(Boolean);
  next.findings = [...new Set(mergedFindings)];
  next.updatedAt = Date.now();

  return next;
}

export default function App() {
  // 'welcome' | 'form' | 'list' | 'detail'
  const [view, setView] = useState('welcome');
  const [selectedBoard, setSelectedBoard] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeSchematic, setActiveSchematic] = useState(null);
  const [diagnosticChecklist, setDiagnosticChecklist] = useState(null);

  function handleBoardCreated() {
    setView('list');
  }

  function handleBoardSelected(board) {
    setSelectedBoard(board);
    setView('detail');
  }

  async function handleRefreshBoard(boardId) {
    try {
      const res = await fetch(`${API_URL}/boards/${boardId}`);
      const updated = await res.json();
      setSelectedBoard(updated);
    } catch {
      // mantém os dados atuais em caso de erro de rede
    }
  }

  function handleOpenSchematic(schematic) {
    setActiveSchematic(schematic);
    setView('analyzer');
  }

  function handleActivateAnalyzer() {
    setView('analyzer');
  }

  function handleDiagnosticChecklistUpdate(patch) {
    setDiagnosticChecklist((current) => mergeDiagnosticChecklist(current, patch));
    if (patch?.activate) setView('analyzer');
  }

  return (
    <div className="flex h-screen overflow-hidden bg-surface-900 text-gray-100">
      {/* ── Sidebar esquerda ── */}
      <Sidebar
        activeView={view}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(v => !v)}
        onNewBoard={() => setView('form')}
        onListBoards={() => setView('list')}
        onAnalyzer={() => setView('analyzer')}
      />

      {/* ── Conteúdo principal ── */}
      <main className={`flex-1 ${view === 'analyzer' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
        {view === 'welcome' && <WelcomeScreen />}
        {view === 'form' && <BoardForm onCreated={handleBoardCreated} />}
        {view === 'list' && <BoardList onSelect={handleBoardSelected} />}
        {view === 'detail' && selectedBoard && (
          <BoardDetail
            board={selectedBoard}
            onBack={() => setView('list')}
            onRefresh={handleRefreshBoard}
          />
        )}
        {view === 'analyzer' && (
          <CircuitAnalyzer
            onBack={() => setView('welcome')}
            schematic={activeSchematic}
            diagnosticChecklist={diagnosticChecklist}
          />
        )}
      </main>

      {/* ── Chat IA (lateral direita) ── */}
      <ChatPanel
        analyzerActive={view === 'analyzer'}
        onOpenSchematic={handleOpenSchematic}
        onDiagnosticChecklist={handleDiagnosticChecklistUpdate}
        onActivateAnalyzer={handleActivateAnalyzer}
      />
    </div>
  );
}

function WelcomeScreen() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-gray-400 select-none">
      <span className="text-6xl mb-4">🔧</span>
      <h2 className="text-xl font-semibold text-gray-300">Assistente de Eletrônica IA</h2>
      <p className="text-sm mt-2 text-center max-w-xs leading-relaxed">
        Use o menu lateral para cadastrar placas ou carregar o banco de placas.
        O assistente IA está disponível no painel à direita.
      </p>
    </div>
  );
}
