/**
 * ChatMessage
 * Renderiza uma bolha de mensagem no estilo chat.
 * - Mensagens do usuário: alinhadas à direita (azul)
 * - Mensagens da IA: alinhadas à esquerda (cinza escuro)
 *
 * @param {{ message: { role: 'user'|'ai', text: string, isError?: boolean } }} props
 */
export default function ChatMessage({ message, compact = false }) {
  const isUser = message.role === 'user';
  const maxW = compact ? 'max-w-[90%]' : 'max-w-[75%]';
  const avatarSize = compact ? 'w-6 h-6 text-[10px]' : 'w-8 h-8 text-xs';
  const fontSize = compact ? 'text-xs' : 'text-sm';

  function renderText(text) {
    const parts = String(text || '').split(/(\[\[blue:[\s\S]*?\]\])/g);
    return parts.map((part, index) => {
      const match = part.match(/^\[\[blue:([\s\S]*?)\]\]$/);
      if (!match) return part;
      return (
        <span key={index} className="text-sky-300 font-semibold">
          {match[1]}
        </span>
      );
    });
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      {/* Avatar da IA */}
      {!isUser && (
        <div className={`flex-shrink-0 ${avatarSize} rounded-full bg-accent flex items-center justify-center text-white font-bold mr-2 mt-1`}>
          IA
        </div>
      )}

      <div
        className={[
          `${maxW} px-3 py-2 rounded-2xl ${fontSize} leading-relaxed whitespace-pre-wrap break-words`,
          isUser
            ? 'bg-accent text-white rounded-tr-sm'
            : message.isError
            ? 'bg-red-900/40 text-red-300 border border-red-700 rounded-tl-sm'
            : 'bg-surface-700 text-gray-100 rounded-tl-sm',
        ].join(' ')}
      >
        {renderText(message.text)}
      </div>

      {/* Avatar do usuário */}
      {isUser && (
        <div className={`flex-shrink-0 ${avatarSize} rounded-full bg-surface-600 flex items-center justify-center text-gray-300 font-bold ml-2 mt-1`}>
          EU
        </div>
      )}
    </div>
  );
}
