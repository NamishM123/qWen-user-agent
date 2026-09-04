/**
 * JSON Schema for browser actions + helpers to request structured output from Ollama/OpenAI.
 *
 * Approach (Phase 2):
 * 1) Prefer response_format json_schema (OpenAI-style) when the endpoint supports it.
 * 2) If that fails (common with local Ollama + qwen2.5:7b), fall back to
 *    response_format json_object + schema text in the system/user prompt, then
 *    validate the parsed object in code.
 * 3) Fence-stripping (```json) remains last-resort parsing only.
 */

export const ACTION_TYPES = [
  'click',
  'type',
  'press',
  'navigate',
  'wait',
  'scroll',
  'select_option',
  'hover',
  'back',
  'screenshot',
  'done',
  'stuck',
];

export const ACTION_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'BrowserAction',
  type: 'object',
  additionalProperties: false,
  required: ['type'],
  properties: {
    type: { type: 'string', enum: ACTION_TYPES },
    role: { type: 'string' },
    name: { type: 'string' },
    text: { type: 'string' },
    submit: { type: 'boolean' },
    key: { type: 'string' },
    url: { type: 'string' },
    ms: { type: 'number' },
    direction: { type: 'string', enum: ['down', 'up', 'left', 'right'] },
    amount: { type: 'number' },
    value: { type: 'string' },
    option: { type: 'string' },
    label: { type: 'string' },
    filename: { type: 'string' },
    reason: { type: 'string' },
  },
};

export const DONE_CHECK_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'DoneCheck',
  type: 'object',
  additionalProperties: false,
  required: ['achieved', 'why'],
  properties: {
    achieved: { type: 'boolean' },
    why: { type: 'string' },
  },
};

/** Human-readable schema summary injected into prompts when strict json_schema is unavailable. */
export function schemaPromptBlock(schema, name = 'action') {
  return (
    `Return ONLY a single JSON object matching this JSON Schema (${name}). ` +
    `No markdown fences, no prose.\n` +
    JSON.stringify(schema)
  );
}

/**
 * Lightweight validate: required keys + type enum. Returns { ok, errors[], value }.
 * Not a full JSON-Schema engine — enough to reject garbage before acting.
 */
export function validateAction(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, errors: ['not an object'], value: obj };
  }
  if (!obj.type || typeof obj.type !== 'string') {
    errors.push('missing type');
  } else if (!ACTION_TYPES.includes(obj.type)) {
    errors.push(`invalid type: ${obj.type}`);
  }
  if (obj.submit != null && typeof obj.submit !== 'boolean') {
    errors.push('submit must be boolean');
  }
  if (obj.ms != null && typeof obj.ms !== 'number') {
    errors.push('ms must be number');
  }
  if (obj.amount != null && typeof obj.amount !== 'number') {
    errors.push('amount must be number');
  }
  return { ok: errors.length === 0, errors, value: obj };
}

export function validateDoneCheck(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, errors: ['not an object'], value: obj };
  }
  if (typeof obj.achieved !== 'boolean') errors.push('achieved must be boolean');
  if (obj.why != null && typeof obj.why !== 'string') errors.push('why must be string');
  return { ok: errors.length === 0, errors, value: obj };
}

/**
 * Build OpenAI-compatible response_format for structured outputs.
 * mode: 'json_schema' | 'json_object'
 */
export function responseFormat(mode, { name, schema, strict = false } = {}) {
  if (mode === 'json_schema' && schema) {
    return {
      type: 'json_schema',
      json_schema: {
        name: name || 'response',
        strict: Boolean(strict),
        schema,
      },
    };
  }
  return { type: 'json_object' };
}
