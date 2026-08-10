import { useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL || '/api';
const isElectron = typeof window !== 'undefined' && !!window.electronAPI;

/**
 * BoardForm — formulário para cadastrar uma nova placa.
 * @param {{ onCreated: (board) => void }} props
 */
export default function BoardForm({ onCreated }) {
  const [marca, setMarca] = useState('');
  const [modelo, setModelo] = useState('');
  const [schematicPath, setSchematicPath] = useState('');
  const [schematicName, setSchematicName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [scanList, setScanList] = useState(null); // null = não aberto, [] = vazio, [...] = lista
  const [scanning, setScanning] = useState(false);

  async function handlePickSchematic() {
    if (isElectron) {
      const filePath = await window.electronAPI.openFileDialog();
      if (filePath) {
        setSchematicPath(filePath);
        setSchematicName(filePath.split(/[\/]/).pop());
        setScanList(null);
      }
    }
  }

  async function handleScanFolder() {
    if (!isElectron) return;
    setScanning(true);
    try {
      const files = await window.electronAPI.scanSchematics();
      setScanList(files);
    } catch (_) {
      setScanList([]);
    } finally {
      setScanning(false);
    }
  }

  function handleSelectFromList(e) {
    const idx = e.target.value;
    if (idx === '') return;
    const file = scanList[parseInt(idx, 10)];
    if (file) {
      setSchematicPath(file.path);
      setSchematicName(file.label);
      setScanList(null);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!marca.trim() || !modelo.trim()) {
      setError('Preencha a Marca e o Modelo.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/boards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marca, modelo, schematicPath, schematicName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Se vinculou um PDF, dispara extração automática de tensões em background
      if (schematicPath && schematicPath.toLowerCase().endsWith('.pdf')) {
        fetch(`${API_URL}/boards/${data.id}/parse-schematic`, { method: 'POST' })
          .catch(() => {}); // silencia erros — não bloqueia o cadastro
      }

      onCreated(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto p-8">
      <h2 className="text-xl font-bold text-gray-100 mb-1">Armazenar Placa</h2>
      <p className="text-sm text-gray-400 mb-6">
        Cadastre uma placa para registrar defeitos e vincular o esquema elétrico.
      </p>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Marca */}
        <div>
          <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
            Marca
          </label>
          <input
            type="text"
            value={marca}
            onChange={(e) => setMarca(e.target.value)}
            placeholder="Ex: Dell, HP, Lenovo"
            className="w-full bg-surface-700 border border-surface-600 rounded-lg px-4 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:border-accent outline-none transition-colors"
          />
        </div>

        {/* Modelo */}
        <div>
          <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
            Modelo
          </label>
          <input
            type="text"
            value={modelo}
            onChange={(e) => setModelo(e.target.value)}
            placeholder="Ex: LA-7891P, DA0R33MB6E0"
            className="w-full bg-surface-700 border border-surface-600 rounded-lg px-4 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:border-accent outline-none transition-colors"
          />
        </div>

        {/* Esquema elétrico */}
        <div>
          <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
            Esquema Elétrico <span className="text-gray-500 normal-case font-normal">(opcional)</span>
          </label>
          <div className="flex gap-2">
            {/* campo de texto: mostra nome do arquivo ou permite digitar o caminho */}
            <input
              type="text"
              value={schematicName || schematicPath}
              onChange={(e) => {
                setSchematicPath(e.target.value);
                setSchematicName(e.target.value.split(/[\\/]/).pop());
              }}
              readOnly={isElectron && !!schematicPath}
              placeholder={isElectron ? 'Clique em Procurar...' : 'Cole o caminho do arquivo'}
              className="flex-1 bg-surface-700 border border-surface-600 rounded-lg px-4 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:border-accent outline-none transition-colors"
            />
            {isElectron && (
              <>
                <button
                  type="button"
                  onClick={handlePickSchematic}
                  className="px-4 py-2.5 bg-surface-600 hover:bg-surface-500 text-gray-200 text-sm rounded-lg transition-colors whitespace-nowrap"
                >
                  Procurar...
                </button>
                <button
                  type="button"
                  onClick={handleScanFolder}
                  disabled={scanning}
                  title="Listar arquivos da pasta Schematic"
                  className="px-3 py-2.5 bg-surface-600 hover:bg-surface-500 text-gray-200 text-sm rounded-lg transition-colors whitespace-nowrap disabled:opacity-50"
                >
                  {scanning ? '⏳' : '📂'}
                </button>
              </>
            )}
          </div>
          {/* Lista de arquivos escaneados */}
          {scanList !== null && (
            <div className="mt-2">
              {scanList.length === 0 ? (
                <p className="text-xs text-gray-500">Nenhum arquivo encontrado na pasta Schematic.</p>
              ) : (
                <select
                  defaultValue=""
                  onChange={handleSelectFromList}
                  className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-gray-100 focus:border-accent outline-none"
                >
                  <option value="">— Selecione um arquivo ({scanList.length} encontrado{scanList.length !== 1 ? 's' : ''}) —</option>
                  {scanList.map((f, i) => (
                    <option key={i} value={i}>{f.label}</option>
                  ))}
                </select>
              )}
            </div>
          )}
          {schematicPath && (
            <p className="text-xs text-gray-500 mt-1 truncate" title={schematicPath}>
              📄 {schematicPath}
            </p>
          )}
        </div>

        {/* Erro */}
        {error && (
          <p className="text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-4 py-2">
            {error}
          </p>
        )}

        {/* Botões */}
        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={loading}
            className="flex-1 bg-accent hover:bg-accent-hover text-white font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-50"
          >
            {loading ? 'Salvando...' : 'Salvar Placa'}
          </button>
          <button
            type="button"
            onClick={() => { setMarca(''); setModelo(''); setSchematicPath(''); setSchematicName(''); setError(''); }}
            className="px-4 py-2.5 bg-surface-700 hover:bg-surface-600 text-gray-300 rounded-lg transition-colors text-sm"
          >
            Limpar
          </button>
        </div>
      </form>
    </div>
  );
}
