/**
 * PDF Service — Preparado para implementação futura.
 *
 * Para ativar, instale: npm install pdf-parse
 *
 * Funcionalidades planejadas:
 *  - Carregar e extrair texto de manuais técnicos em PDF
 *  - Segmentar o conteúdo em chunks para busca eficiente
 *  - Integrar com aiService para responder baseado no conteúdo do PDF
 */

/**
 * Extrai o texto de um arquivo PDF.
 *
 * @param {string} filePath - Caminho absoluto para o arquivo PDF
 * @returns {Promise<string>} Texto extraído do PDF
 */
async function extractTextFromPDF(filePath) {
  // TODO: Implementar com pdf-parse
  // const pdfParse = require('pdf-parse');
  // const fs = require('fs');
  // const dataBuffer = fs.readFileSync(filePath);
  // const data = await pdfParse(dataBuffer);
  // return data.text;

  throw new Error('Suporte a PDF ainda não implementado. Instale pdf-parse para habilitar.');
}

/**
 * Divide um texto longo em partes menores para processamento.
 *
 * @param {string} text      - Texto completo
 * @param {number} chunkSize - Tamanho máximo de cada chunk (em caracteres)
 * @returns {string[]} Array de chunks de texto
 */
function splitIntoChunks(text, chunkSize = 2000) {
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Busca trechos relevantes dentro de um texto com base em uma query.
 *
 * @param {string} text  - Texto completo (ex: conteúdo de um PDF)
 * @param {string} query - Termo ou pergunta a buscar
 * @returns {string} Trecho mais relevante encontrado
 */
function searchInText(text, query) {
  // TODO: Implementar busca semântica (ex: com transformers.js ou embeddings locais)
  // Por enquanto, busca simples por palavras-chave

  const lowerQuery = query.toLowerCase();
  const sentences = text.split(/[.\n]/);

  const matching = sentences.filter((s) =>
    lowerQuery.split(' ').some((word) => s.toLowerCase().includes(word))
  );

  return matching.slice(0, 5).join('. ') || 'Nenhum trecho relevante encontrado.';
}

module.exports = { extractTextFromPDF, splitIntoChunks, searchInText };
