/**
 * Sidebar — menu lateral esquerdo com navegação principal.
 * Suporta colapso (collapsed=true → apenas ícones, w-14).
 */
export default function Sidebar({ activeView, collapsed, onToggleCollapse, onNewBoard, onListBoards, onAnalyzer }) {
  const navItems = [
    {
      id: 'form',
      label: 'Armazenar Placa',
      onClick: onNewBoard,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 shrink-0">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M12 8v8M8 12h8" />
        </svg>
      ),
    },
    {
      id: 'list',
      label: 'Carregar Placas',
      onClick: onListBoards,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 shrink-0">
          <rect x="2" y="5" width="20" height="3" rx="1" />
          <rect x="2" y="11" width="20" height="3" rx="1" />
          <rect x="2" y="17" width="20" height="3" rx="1" />
        </svg>
      ),
    },
    {
      id: 'analyzer',
      label: 'Analisador',
      onClick: onAnalyzer,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 shrink-0">
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          <line x1="11" y1="8" x2="11" y2="14"/>
          <line x1="8" y1="11" x2="14" y2="11"/>
        </svg>
      ),
    },
  ];

  return (
    <nav className={`flex flex-col shrink-0 bg-surface-800 border-r border-surface-600 transition-all duration-200 ${collapsed ? 'w-14' : 'w-56'}`}>
      {/* Logo + botão de colapso */}
      <div className={`flex items-center border-b border-surface-600 ${collapsed ? 'justify-center py-3 px-2' : 'px-3 py-4 gap-2'}`}>
        {!collapsed && (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-xl">🔧</span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-gray-100 leading-tight truncate">Eletrônica IA</p>
              <p className="text-xs text-gray-400">Assistente técnico</p>
            </div>
          </div>
        )}
        <button
          onClick={onToggleCollapse}
          title={collapsed ? 'Expandir menu' : 'Recolher menu'}
          className="p-1.5 rounded-lg text-gray-400 hover:bg-surface-700 hover:text-gray-100 transition-colors shrink-0"
        >
          {collapsed ? (
            /* seta para direita (expandir) */
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          ) : (
            /* seta para esquerda (recolher) */
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          )}
        </button>
      </div>

      {/* Navegação */}
      <div className="flex flex-col gap-1 p-2 flex-1">
        {!collapsed && (
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-2 mb-1 mt-1">
            Placas
          </p>
        )}
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={item.onClick}
            title={collapsed ? item.label : undefined}
            className={[
              'flex items-center rounded-lg font-medium w-full transition-colors duration-150',
              collapsed ? 'justify-center p-2.5' : 'gap-3 px-3 py-2.5 text-sm text-left',
              activeView === item.id
                ? 'bg-accent text-white'
                : 'text-gray-300 hover:bg-surface-700 hover:text-white',
            ].join(' ')}
          >
            {item.icon}
            {!collapsed && item.label}
          </button>
        ))}

        {/* Dica de comandos — só quando expandida */}
        {!collapsed && (
          <div className="mt-auto pt-4 border-t border-surface-600">
            <p className="text-xs text-gray-500 px-2 leading-relaxed">
              💬 No chat, use:<br />
              <code className="text-gray-400">armazenar: &lt;fato&gt;</code><br />
              para ensinar a IA
            </p>
          </div>
        )}
      </div>
    </nav>
  );
}
