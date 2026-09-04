/**
 * Phase 4 reliability guardrails: rate limits, cost/latency/step budgets.
 * Pure helpers + env parsing — used by agent, API enqueue, and worker.
 */

export function envNumber(name, fallback) {
  const v = process.env[name];
  if (v == null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Max agent loop steps (default 25). */
export function maxSteps() {
  return envNumber('MAX_STEPS', 25);
}

/** Max LLM latency budget per task in ms (0 = disabled). */
export function maxLatencyMs() {
  return envNumber('MAX_LATENCY_MS', 0);
}

/** Max total tokens per task (0 = disabled). */
export function maxTokensPerTask() {
  return envNumber('MAX_TOKENS_PER_TASK', 0);
}

/** Dollar-equivalent budget per task (0 = disabled). Uses COST_PER_1K_TOKENS. */
export function maxCostUsd() {
  return envNumber('MAX_COST_USD', 0);
}

/** Assumed USD per 1k tokens for estimate (local Ollama → 0). */
export function costPer1kTokens() {
  return envNumber('COST_PER_1K_TOKENS', 0);
}

/** Per-user enqueue rate limit (tasks / rolling hour). 0 = disabled. */
export function rateLimitTasksPerHour() {
  return envNumber('RATE_LIMIT_TASKS_PER_HOUR', 30);
}

export function estimateCostUsd(cost) {
  if (!cost) return 0;
  const tokens = cost.total_tokens || (cost.prompt_tokens || 0) + (cost.completion_tokens || 0);
  const per1k = costPer1kTokens();
  if (per1k > 0 && tokens > 0) return (tokens / 1000) * per1k;
  // Latency proxy when tokens missing: treat 60s LLM time ≈ $0.01 if COST_PER_1K unset but MAX_COST set
  if (maxCostUsd() > 0 && (!tokens || per1k <= 0) && cost.latency_ms) {
    return (cost.latency_ms / 60000) * 0.01;
  }
  return per1k > 0 ? (tokens / 1000) * per1k : 0;
}

/**
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function checkBudgets(cost, stepCount) {
  const stepsCap = maxSteps();
  if (stepCount > stepsCap) {
    return { ok: false, reason: `max steps exceeded (${stepCount} > ${stepsCap})` };
  }
  const latCap = maxLatencyMs();
  if (latCap > 0 && cost?.latency_ms > latCap) {
    return {
      ok: false,
      reason: `max latency exceeded (${cost.latency_ms}ms > ${latCap}ms)`,
    };
  }
  const tokCap = maxTokensPerTask();
  const tokens = cost?.total_tokens || 0;
  if (tokCap > 0 && tokens > tokCap) {
    return { ok: false, reason: `max tokens exceeded (${tokens} > ${tokCap})` };
  }
  const usdCap = maxCostUsd();
  if (usdCap > 0) {
    const est = estimateCostUsd(cost);
    if (est > usdCap) {
      return {
        ok: false,
        reason: `max cost exceeded (est $${est.toFixed(4)} > $${usdCap})`,
      };
    }
  }
  return { ok: true };
}

export function guardrailSnapshot() {
  return {
    MAX_STEPS: maxSteps(),
    MAX_LATENCY_MS: maxLatencyMs() || null,
    MAX_TOKENS_PER_TASK: maxTokensPerTask() || null,
    MAX_COST_USD: maxCostUsd() || null,
    COST_PER_1K_TOKENS: costPer1kTokens() || null,
    RATE_LIMIT_TASKS_PER_HOUR: rateLimitTasksPerHour() || null,
  };
}
