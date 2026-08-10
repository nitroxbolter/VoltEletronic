const DEFAULT_LIMITS = {
  rpm: Number(process.env.GROQ_FREE_RPM || 30),
  rpd: Number(process.env.GROQ_FREE_RPD || 14400),
  tpm: Number(process.env.GROQ_FREE_TPM || 6000),
  tpd: Number(process.env.GROQ_FREE_TPD || 500000),
  maxInputTokens: Number(process.env.GROQ_MAX_INPUT_TOKENS || 4300),
  maxOutputTokens: Number(process.env.GROQ_MAX_OUTPUT_TOKENS || 700),
};

let minuteWindowStart = Date.now();
let minuteRequests = 0;
let minuteTokens = 0;
let dayWindowStart = startOfToday();
let dayRequests = 0;
let dayTokens = 0;

function estimateTokens(text) {
  const value = String(text || '');
  if (!value) return 0;

  // Aproximação conservadora para PT-BR + texto técnico: 1 token ~= 3.5 chars.
  return Math.ceil(value.length / 3.5);
}

function resetMinuteWindowIfNeeded() {
  if (Date.now() - minuteWindowStart < 60_000) return;
  minuteWindowStart = Date.now();
  minuteRequests = 0;
  minuteTokens = 0;
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function resetDayWindowIfNeeded() {
  const today = startOfToday();
  if (dayWindowStart === today) return;
  dayWindowStart = today;
  dayRequests = 0;
  dayTokens = 0;
}

function getLimits() {
  return { ...DEFAULT_LIMITS };
}

function canUseGroq(estimatedInputTokens, estimatedOutputTokens = DEFAULT_LIMITS.maxOutputTokens) {
  resetMinuteWindowIfNeeded();
  resetDayWindowIfNeeded();

  const estimatedTotal = estimatedInputTokens + estimatedOutputTokens;
  const now = Date.now();
  const nextDay = dayWindowStart + 24 * 60 * 60 * 1000;

  return {
    ok:
      minuteRequests + 1 <= DEFAULT_LIMITS.rpm &&
      minuteTokens + estimatedTotal <= DEFAULT_LIMITS.tpm &&
      dayRequests + 1 <= DEFAULT_LIMITS.rpd &&
      dayTokens + estimatedTotal <= DEFAULT_LIMITS.tpd,
    estimatedTotal,
    minuteRequests,
    minuteTokens,
    dayRequests,
    dayTokens,
    limits: getLimits(),
    resetInMs: Math.max(0, 60_000 - (now - minuteWindowStart)),
    dailyResetInMs: Math.max(0, nextDay - now),
  };
}

function registerGroqUse(estimatedInputTokens, estimatedOutputTokens = DEFAULT_LIMITS.maxOutputTokens) {
  resetMinuteWindowIfNeeded();
  resetDayWindowIfNeeded();
  minuteRequests += 1;
  minuteTokens += estimatedInputTokens + estimatedOutputTokens;
  dayRequests += 1;
  dayTokens += estimatedInputTokens + estimatedOutputTokens;
}

function trimToTokenBudget(text, maxTokens) {
  const value = String(text || '');
  if (estimateTokens(value) <= maxTokens) return value;

  const maxChars = Math.max(0, Math.floor(maxTokens * 3.5));
  return `${value.slice(0, maxChars)}\n\n[contexto truncado pelo limite de tokens configurado]`;
}

function summarizeRateLimitHeaders(headers = {}) {
  return {
    limitRequests: headers['x-ratelimit-limit-requests'],
    remainingRequests: headers['x-ratelimit-remaining-requests'],
    resetRequests: headers['x-ratelimit-reset-requests'],
    limitTokens: headers['x-ratelimit-limit-tokens'],
    remainingTokens: headers['x-ratelimit-remaining-tokens'],
    resetTokens: headers['x-ratelimit-reset-tokens'],
  };
}

module.exports = {
  estimateTokens,
  canUseGroq,
  registerGroqUse,
  trimToTokenBudget,
  summarizeRateLimitHeaders,
  getLimits,
};
