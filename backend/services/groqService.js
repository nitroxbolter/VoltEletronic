const axios = require('axios');
const {
  estimateTokens,
  registerGroqUse,
  summarizeRateLimitHeaders,
  getLimits,
} = require('./tokenBudgetService');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

function hasGroqConfig() {
  return Boolean(process.env.GROQ_API_KEY);
}

async function generateGroqResponse({
  system,
  prompt,
  model = DEFAULT_GROQ_MODEL,
  temperature = 0.2,
  maxCompletionTokens = getLimits().maxOutputTokens,
}) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY não configurada. Defina a chave em backend/.env ou variável de ambiente.');
  }

  const estimatedInputTokens = estimateTokens(system) + estimateTokens(prompt);
  const response = await axios.post(
    GROQ_URL,
    {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      temperature,
      max_completion_tokens: maxCompletionTokens,
    },
    {
      timeout: 90000,
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  );

  const text = response.data?.choices?.[0]?.message?.content || '';
  const usage = response.data?.usage || {};
  const promptTokens = Number(usage.prompt_tokens || estimatedInputTokens);
  const completionTokens = Number(usage.completion_tokens || estimateTokens(text));
  const totalTokens = Number(usage.total_tokens || (promptTokens + completionTokens));

  registerGroqUse(promptTokens, completionTokens);

  return {
    model,
    text,
    usage: {
      promptTokens,
      completionTokens,
      totalTokens,
      estimated: !usage.total_tokens,
    },
    rateLimit: summarizeRateLimitHeaders(response.headers),
    raw: response.data,
  };
}

module.exports = {
  DEFAULT_GROQ_MODEL,
  hasGroqConfig,
  generateGroqResponse,
};
