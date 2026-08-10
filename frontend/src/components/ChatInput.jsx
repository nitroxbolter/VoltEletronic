import { useState } from 'react';

/**
 * ChatInput
 * Campo de texto e botão para enviar mensagens ao assistente.
 * Suporta envio via botão ou tecla Enter (Shift+Enter insere nova linha).
 *
 * @param {{ onSend: (text: string) => void, isLoading: boolean }} props
 */
export default function ChatInput({ onSend, isLoading, compact = false }) {
  const [input, setInput] = useState('');
  const btnSize = compact ? 'w-9 h-9' : 'w-12 h-12';
  const iconSize = compact ? 'w-4 h-4' : 'w-5 h-5';

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    onSend(trimmed);
    setInput('');
  }

  function handleKeyDown(e) {
    // Enter sem Shift = enviar; Shift+Enter = nova linha
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-3">
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={1}
        placeholder="Descreva o problema ou faça uma pergunta técnica..."
        disabled={isLoading}
        className={[
          'flex-1 resize-none rounded-xl px-4 py-3 text-sm',
          'bg-surface-700 text-gray-100 placeholder-gray-500',
          'border border-surface-600 focus:border-accent',
          'transition-colors duration-200 outline-none',
          'max-h-36 overflow-y-auto',
          isLoading ? 'opacity-50 cursor-not-allowed' : '',
        ].join(' ')}
        style={{
          // Cresce conforme o conteúdo até max-h-36
          height: 'auto',
          minHeight: '48px',
        }}
        onInput={(e) => {
          e.target.style.height = 'auto';
          e.target.style.height = `${e.target.scrollHeight}px`;
        }}
      />

      <button
        type="submit"
        disabled={!input.trim() || isLoading}
        aria-label="Enviar mensagem"
        className={[
          `flex-shrink-0 ${btnSize} rounded-xl flex items-center justify-center`,
          'bg-accent hover:bg-accent-hover text-white font-bold',
          'transition-all duration-200',
          !input.trim() || isLoading
            ? 'opacity-40 cursor-not-allowed'
            : 'hover:scale-105 active:scale-95',
        ].join(' ')}
      >
        {isLoading ? (
          <svg className={`${iconSize} animate-spin`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
            <path d="M12 2a10 10 0 0 1 10 10" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor" className={iconSize}>
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        )}
      </button>
    </form>
  );
}
