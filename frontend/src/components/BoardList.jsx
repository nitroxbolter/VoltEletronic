import { useState, useEffect } from 'react';

const API_URL = import.meta.env.VITE_API_URL || '/api';

/**
 * BoardList — lista de placas cadastradas.
 * @param {{ onSelect: (board) => void }} props
 */
export default function BoardList({ onSelect }) {
  const [boards, setBoards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch(`${API_URL}/boards`)
      .then((r) => r.json())
      .then((data) => setBoards(Array.isArray(data) ? data : []))
      .catch(() => setBoards([]))
      .finally(() => setLoading(false));
  }, []);

  async function handleDelete(e, id) {
    e.stopPropagation();
    if (!confirm('Remover esta placa e todos os seus defeitos?')) return;
    await fetch(`${API_URL}/boards/${id}`, { method: 'DELETE' });
    setBoards((prev) => prev.filter((b) => b.id !== id));
  }

  const filtered = boards.filter((b) =>
    `${b.marca} ${b.modelo}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-100">Placas Cadastradas</h2>
          <p className="text-sm text-gray-400">{boards.length} placa(s) no banco</p>
        </div>
      </div>

      {/* Busca */}
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar por marca ou modelo..."
        className="w-full bg-surface-700 border border-surface-600 rounded-lg px-4 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:border-accent outline-none transition-colors mb-4"
      />

      {loading && (
        <div className="text-center py-12 text-gray-400 text-sm">Carregando...</div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="text-center py-12">
          <span className="text-4xl block mb-3">📋</span>
          <p className="text-gray-400 text-sm">
            {boards.length === 0
              ? 'Nenhuma placa cadastrada ainda. Use "Armazenar Placa" para começar.'
              : 'Nenhuma placa encontrada para essa busca.'}
          </p>
        </div>
      )}

      <div className="space-y-3">
        {filtered.map((board) => (
          <button
            key={board.id}
            onClick={() => onSelect(board)}
            className="w-full text-left bg-surface-800 hover:bg-surface-700 border border-surface-600 hover:border-accent/50 rounded-xl p-4 transition-all group"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {/* Título */}
                <p className="font-semibold text-gray-100 group-hover:text-accent transition-colors">
                  {board.marca}{' '}
                  <span className="text-accent font-mono">{board.modelo}</span>
                </p>
                {/* Badges */}
                <div className="flex items-center gap-3 mt-1.5">
                  <span className="text-xs text-gray-400">
                    🐛 {board.defects?.length ?? 0} defeito(s)
                  </span>
                  {board.schematicName && (
                    <span className="text-xs text-gray-400">
                      📄 {board.schematicName}
                    </span>
                  )}
                </div>
              </div>

              {/* Botão remover */}
              <button
                onClick={(e) => handleDelete(e, board.id)}
                title="Remover placa"
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
          </button>
        ))}
      </div>
    </div>
  );
}
