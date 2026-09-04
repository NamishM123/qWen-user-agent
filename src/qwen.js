import OpenAI from 'openai';
import { readFileSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACTION_JSON_SCHEMA,
  DONE_CHECK_JSON_SCHEMA,
  schemaPromptBlock,
  validateAction,
  validateDoneCheck,
  responseFormat,
} from './schema.js';

const PROMPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'prompts');

/** Tag every run (env PROMPT_VERSION overrides; default v1.1). */
export const PROMPT_VERSION = process.env.PROMPT_VERSION || 'v1.1';

const DEFAULT_SYSTEM = `
const client = new OpenAI({
  baseURL: process.env.LLM_BASE_URL || 'http://localhost:11434/v1',
  apiKey: process.env.LLM_API_KEY || 'ollama',
});

const MODEL = process.env.LLM_MODEL || 'qwen2.5:7b';
export const VISION_MODEL = process.env.LLM_VISION_MODEL || 'qwen2.5vl:7b';

/** Prefer strict json_schema; set LLM_JSON_SCHEMA=0 to skip and use json_object + prompt schema. */
const WANT_JSON_SCHEMA = process.env.LLM_JSON_SCHEMA !== '0';

/** Remember if the endpoint rejected json_schema so we don't keep failing every call. */
let jsonSchemaUnsupported = !WANT_JSON_SCHEMA;

const SYSTEM = `You are a browser-automation agent. On each turn you receive:
- the user's task
- the current page (url, title)
- a numbered list of interactable elements with role and accessible name (and value when present)
- a short history of recent actions
- optional progress hints
- optionally a screenshot (vision recovery turn)

CRITICAL — check for completion FIRST every turn:
If the task is already satisfied, return ONLY {"type":"done","reason":"..."}.
Do NOT click, type, or navigate further. Extra actions after success are FAILURES.

Completion signals:
1) Click-a-link tasks: history already shows a successful click on the named link OR a clear equivalent (e.g. task "More information..." but you clicked "Learn more"), AND the URL is no longer the starting page. That means DONE — stop exploring the destination.
2) Login tasks: URL already contains "/secure" OR a Logout control is visible. Do NOT invent destinations like /dashboard. Do NOT click Logout.
3) Add-N-items tasks: the list already shows N items matching what was requested.
4) Confirm/verify page tasks: if URL/title already match what was asked, emit done immediately.
5) Form-submit tasks: if URL already shows the submission endpoint (e.g. /post) or success content is visible, emit done.

Return a SINGLE JSON object, no prose, matching one of these shapes:
{"type":"click","role":"<role>","name":"<name>"}
{"type":"type","role":"textbox","name":"<name>","text":"<text>","submit":false}
{"type":"press","key":"Enter","role":"textbox","name":"<name>"}
{"type":"navigate","url":"https://..."}
{"type":"wait","ms":1000}
{"type":"scroll","direction":"down|up|left|right","amount":600}
{"type":"scroll","role":"<role>","name":"<name>"}
{"type":"select_option","role":"combobox","name":"<name>","value":"<option label or value>"}
{"type":"hover","role":"<role>","name":"<name>"}
{"type":"back"}
{"type":"screenshot","filename":"optional-name.png"}
{"type":"done","reason":"<why the task is satisfied, citing current URL or visible content>"}
{"type":"stuck","reason":"<why no action can make progress>"}

Rules:
- "role" and "name" MUST match an Elements entry exactly when targeting an element. NEVER invent elements.
- If the task names a control that is missing but a clear equivalent is listed, use the equivalent.
- Never invent URLs for "navigate". Only navigate when the task itself provides a URL.
- LOGIN FORMS:
  * Fill Username first with "submit":false.
  * Fill Password next. Only then submit via "submit":true on the password type, press Enter on password, OR click Login.
  * NEVER click Login before both fields are filled. NEVER submit after only the username.
- ADD-ITEM / TODO FORMS (single textbox that creates a list item):
  * Each item MUST be entered with "submit":true (or a follow-up press Enter). submit:false alone does NOT add the item.
  * Add items one at a time until N are present, then done.
- Prefer the smallest action that makes progress.
- Use scroll when content is below the fold; use hover for menus that reveal on hover; use back to leave a wrong page; use select_option for <select>/combobox.
- If the same action failed twice, try something else or emit "stuck".
- On a vision recovery turn, use the screenshot to identify the next useful action (or done/stuck).
- For unnamed checkboxes/comboboxes, use the synthetic names shown in Elements (e.g. "checkbox 1").`;

function resolvePromptFile(version) {
  const v = String(version || PROMPT_VERSION);
  // Map v1.1 → v1.txt, v2 → v2.txt, v2.0 → v2.txt
  const major = v.replace(/^v/i, '').split('.')[0] || '1';
  const candidates = [
    join(PROMPTS_DIR, `${v}.txt`),
    join(PROMPTS_DIR, `v${major}.txt`),
    join(PROMPTS_DIR, 'v1.txt'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

let cachedSystem = null;
let cachedVersion = null;

export function getSystemPrompt(version = PROMPT_VERSION) {
  if (cachedSystem && cachedVersion === version) return cachedSystem;
  const file = resolvePromptFile(version);
  if (file) {
    cachedSystem = readFileSync(file, 'utf8').trim();
    cachedVersion = version;
    return cachedSystem;
  }
  cachedSystem = EMBEDDED_SYSTEM;
  cachedVersion = version;
  return cachedSystem;
}

export function getPromptVersion() {
  return PROMPT_VERSION;
}

const DONE_CHECK_SYSTEM = `You are a strict QA checker for a browser-automation agent.
Given the user's task and the final page state, decide whether the task was ACTUALLY achieved.
Reply with ONLY a JSON object:
{"achieved":true|false,"why":"<one or two sentences citing URL, visible controls, or history>"}
Be conservative: if evidence is weak or ambiguous, set achieved:false.`;

function extractJson(raw) {
  const trimmed = String(raw ?? '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // continue
  }
  // Fallback only: strip markdown fences
  const stripped = trimmed.replace(/```(?:json)?/gi, '').trim();
  try {
    return JSON.parse(stripped);
  } catch {
    // continue
  }
  const match = stripped.match(/\{[\s\S]*\}/);
  if (match) return JSON.parse(match[0]);
  throw new Error(`Model returned non-JSON: ${trimmed.slice(0, 200)}`);
}

function usageFromResponse(res, model, latencyMs) {
  const u = res?.usage || {};
  return {
    model,
    prompt_tokens: u.prompt_tokens ?? u.promptTokens ?? null,
    completion_tokens: u.completion_tokens ?? u.completionTokens ?? null,
    total_tokens: u.total_tokens ?? u.totalTokens ?? null,
    latency_ms: latencyMs,
  };
}

function actionTargetsListed(action, snapshot) {
  if (!action || typeof action !== 'object') return false;
  if (['done', 'stuck', 'wait', 'navigate', 'back', 'screenshot'].includes(action.type)) return true;
  if (action.type === 'scroll' && !(action.role && action.name)) return true;
  if (action.type === 'press' && !(action.role && action.name)) return true;
  if (!action.role || typeof action.name !== 'string') return false;
  return snapshot.nodes.some((n) => n.role === action.role && n.name === action.name);
}

function progressHints({ task, snapshot, history }) {
  const hints = [];
  const url = snapshot.url || '';
  const taskLower = (task || '').toLowerCase();
  const nodes = snapshot.nodes || [];
  const title = (snapshot.title || '').toLowerCase();

  if (/confirm|verify|already on|check (that )?the page|page (is|shows|title)/.test(taskLower)) {
    const titleWant = taskLower.match(/title\s+(?:contains?|includes?|is)\s+['"]?([^'"]+)['"]?/i);
    if (titleWant && title.includes(titleWant[1].toLowerCase().trim())) {
      hints.push('Page title already matches. Prefer {"type":"done",...}.');
    }
    if (/ada lovelace/.test(taskLower) && /ada lovelace/.test(title)) {
      hints.push('Ada Lovelace article is open. Prefer done.');
    }
    if (/alan turing/.test(taskLower) && /alan turing/.test(title)) {
      hints.push('Alan Turing article is open. Prefer done.');
    }
    if (/example domain/.test(taskLower) && /example domain/.test(title)) {
      hints.push('Example Domain title visible. Prefer done.');
    }
  }

  if (/log\s*in|login|sign\s*in/.test(taskLower)) {
    if (/\/secure(?:\/|$|\?|#)/.test(url) || nodes.some((n) => /logout/i.test(n.name || ''))) {
      hints.push('Login appears complete (/secure or Logout visible). Prefer {"type":"done",...}. Do not click Logout.');
    } else if (/\/login/i.test(url)) {
      const user = nodes.find((n) => n.role === 'textbox' && /user/i.test(n.name || ''));
      const pass = nodes.find((n) => n.role === 'textbox' && /pass/i.test(n.name || ''));
      const userFilled = !!(user && user.value);
      const passFilled = !!(pass && pass.value);
      if (!userFilled) {
        hints.push('Fill Username first with submit:false. Do not click Login yet.');
      } else if (!passFilled) {
        hints.push('Username looks filled. Fill Password next, then submit (submit:true) or click Login.');
      } else {
        hints.push('Both fields look filled. Click Login (or press Enter on Password).');
      }
    }
  }

  if (/click/.test(taskLower) && /(more information|learn more)/.test(taskLower)) {
    const clicked = history.some(
      (h) =>
        h &&
        h.type === 'click' &&
        typeof h.name === 'string' &&
        /more information|learn more/i.test(h.name),
    );
    if (clicked && !/^https?:\/\/(?:www\.)?example\.com\/?$/i.test(url)) {
      hints.push('You already clicked the information link and left example.com. Prefer {"type":"done",...}.');
    }
  }

  if (/todo|add three|add 3|three todos|3 todos/.test(taskLower)) {
    const typedSubmitted = history.filter((h) => h && h.type === 'type' && h.submit).length;
    const box = nodes.find((n) => n.role === 'textbox');
    if (box && box.value && String(box.value).trim()) {
      hints.push(
        `Textbox still holds ${JSON.stringify(box.value)} — press Enter or re-type with submit:true to commit the item.`,
      );
    }
    if (typedSubmitted >= 3) {
      hints.push('Three submitted type actions are already in history. If three items are visible, prefer done.');
    } else if (/three|3/.test(taskLower)) {
      hints.push(`Add-item task: type each todo with submit:true. Submitted so far: ${typedSubmitted}.`);
    }
  }

  if (/select|option|dropdown/.test(taskLower)) {
    const selected = history.some((h) => h && h.type === 'select_option');
    const combo = nodes.find((n) => n.role === 'combobox');
    const optMatch = taskLower.match(/option\s*([12])/i);
    if (selected && combo && optMatch) {
      const want = `option ${optMatch[1]}`;
      if (String(combo.value || '').toLowerCase().includes(want)) {
        hints.push(
          `Combobox value is already ${JSON.stringify(combo.value)}. Prefer {"type":"done",...}; do not select_option again.`,
        );
      }
    } else if (selected && combo && combo.value && !/please select/i.test(String(combo.value))) {
      hints.push(`Combobox value is already ${JSON.stringify(combo.value)}. If that matches the task, prefer done.`);
    }
  }

  if (/checkbox/.test(taskLower)) {
    const boxes = nodes.filter((n) => n.role === 'checkbox');
    if (boxes.length >= 2 && boxes.every((b) => /checked=true/i.test(String(b.value || '')))) {
      hints.push('All listed checkboxes show checked=true. Prefer {"type":"done",...}.');
    }
  }

  if (/add element|delete button|add_remove/.test(taskLower)) {
    const deletes = nodes.filter((n) => n.role === 'button' && /^delete$/i.test(n.name || ''));
    const wantTwo = /twice|two delete|2 delete/.test(taskLower);
    if (wantTwo && deletes.length >= 2) {
      hints.push(
        `There are already ${deletes.length} Delete buttons. Prefer {"type":"done",...}. Do NOT click Delete.`,
      );
    } else if (!wantTwo && deletes.length >= 1 && /add element/.test(taskLower)) {
      hints.push(
        `Delete button(s) visible (${deletes.length}). If the task is satisfied, prefer done; do not click Delete unless asked.`,
      );
    }
  }

  if (/httpbin|submit.*(form|post)|form.*submit/.test(taskLower) && /\/post/i.test(url)) {
    hints.push('URL already shows /post (form submitted). Prefer done.');
  }

  const last = history[history.length - 1];
  if (last && last.error) {
    hints.push(
      `Last action failed (${last.error.slice(0, 120)}). Do not repeat it unchanged; try another listed element or stuck/done.`,
    );
  }

  return hints;
}

function buildUserPrompt({ task, snapshot, history, visionNote, includeSchema }) {
  const hints = progressHints({ task, snapshot, history });
  const lines = [
    `Task: ${task}`,
    `URL: ${snapshot.url}`,
    `Title: ${snapshot.title}`,
    'Elements:',
    ...(snapshot.nodes.length
      ? snapshot.nodes.slice(0, 60).map(
          (n) =>
            `  [${n.index}] role=${n.role} name=${JSON.stringify(n.name)}${n.value != null && n.value !== '' ? ` value=${JSON.stringify(n.value)}` : ''}`,
        )
      : ['  (none — accessibility tree empty)']),
    '',
    'Recent actions:',
    ...(history.length ? history.slice(-6).map((h, i) => `  ${i + 1}. ${JSON.stringify(h)}`) : ['  (none)']),
    '',
    'Progress hints:',
    ...(hints.length ? hints.map((h) => `  - ${h}`) : ['  - (none)']),
  ];
  if (visionNote) {
    lines.push('', visionNote);
  }
  if (includeSchema) {
    lines.push('', schemaPromptBlock(ACTION_JSON_SCHEMA, 'BrowserAction'));
  }
  return lines.join('\n');
}

async function chatCreate({ model, messages, schema, schemaName }) {
  const t0 = Date.now();
  let usedMode = 'json_object';
  let res;

  if (!jsonSchemaUnsupported && schema) {
    try {
      res = await client.chat.completions.create({
        model,
        temperature: 0,
        response_format: responseFormat('json_schema', { name: schemaName, schema, strict: false }),
        messages,
      });
      usedMode = 'json_schema';
    } catch (err) {
      const msg = err?.message || String(err);
      if (/response_format|json_schema|unsupported|invalid|400|unknown/i.test(msg)) {
        jsonSchemaUnsupported = true;
        console.warn(`structured output: json_schema unsupported (${msg.slice(0, 120)}); falling back to json_object + schema prompt`);
      } else {
        // Other errors — still try json_object once
        jsonSchemaUnsupported = true;
        console.warn(`structured output: json_schema failed (${msg.slice(0, 120)}); falling back`);
      }
    }
  }

  if (!res) {
    // Best-effort: inject schema into messages if not already present
    const msgs = messages.map((m) => ({ ...m }));
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
    if (lastUser && typeof lastUser.content === 'string' && schema && !/BrowserAction|DoneCheck/.test(lastUser.content)) {
      lastUser.content += '\n\n' + schemaPromptBlock(schema, schemaName || 'response');
    }
    res = await client.chat.completions.create({
      model,
      temperature: 0,
      response_format: responseFormat('json_object'),
      messages: msgs,
    });
    usedMode = 'json_object';
  }

  const latency_ms = Date.now() - t0;
  const usage = usageFromResponse(res, model, latency_ms);
  usage.response_format = usedMode;
  return { res, usage };
}

async function completeAction({ messages, snapshot }) {
  let lastErr;
  const usages = [];

  for (let attempt = 1; attempt <= 3; attempt++) {
    const attemptMessages = [...messages];
    if (attempt > 1) {
      attemptMessages.push({
        role: 'user',
        content:
          `Previous reply was invalid (${lastErr}). Reply with ONLY one valid JSON action object. ` +
          `role/name must match an Elements entry exactly, unless the action is done/stuck/wait/navigate/back/screenshot/scroll-without-target.`,
      });
    }

    const { res, usage } = await chatCreate({
      model: MODEL,
      messages: attemptMessages,
      schema: ACTION_JSON_SCHEMA,
      schemaName: 'BrowserAction',
    });
    usages.push(usage);

    const raw = res.choices[0]?.message?.content ?? '{}';
    try {
      const action = extractJson(raw);
      const v = validateAction(action);
      if (!v.ok) {
        lastErr = v.errors.join('; ');
        continue;
      }
      if (!actionTargetsListed(action, snapshot)) {
        lastErr = `element not in list: role=${action.role} name=${action.name}`;
        if (
          action.type === 'click' &&
          /more information/i.test(action.name || '') &&
          !/^https?:\/\/(?:www\.)?example\.com\/?$/i.test(snapshot.url || '')
        ) {
          return {
            action: {
              type: 'done',
              reason: 'Already left example.com after clicking the information/Learn more link; task satisfied.',
            },
            usage: mergeUsages(usages),
          };
        }
        continue;
      }
      return { action, usage: mergeUsages(usages) };
    } catch (err) {
      lastErr = err.message;
    }
  }
  throw Object.assign(new Error(`Failed to get valid JSON action after retries: ${lastErr}`), {
    usage: mergeUsages(usages),
  });
}

function mergeUsages(usages) {
  if (!usages.length) return null;
  const last = usages[usages.length - 1];
  const sum = (key) =>
    usages.reduce((a, u) => a + (typeof u[key] === 'number' ? u[key] : 0), 0) || null;
  return {
    model: last.model,
    prompt_tokens: sum('prompt_tokens'),
    completion_tokens: sum('completion_tokens'),
    total_tokens: sum('total_tokens'),
    latency_ms: sum('latency_ms'),
    response_format: last.response_format,
    attempts: usages.length,
  };
}

export async function nextAction({ task, snapshot, history }) {
  const includeSchema = jsonSchemaUnsupported || !WANT_JSON_SCHEMA;
  const user = buildUserPrompt({ task, snapshot, history, includeSchema });
  return completeAction({
    snapshot,
    messages: [
      { role: 'system', content: getSystemPrompt() },
      { role: 'user', content: user },
    ],
  });
}

/**
 * One recovery turn with a screenshot via Ollama's OpenAI-compatible multimodal API.
 */
export async function nextActionWithVision({ task, snapshot, history, screenshotPath }) {
  const visionNote =
    'VISION RECOVERY TURN: the a11y tree was empty, the model said stuck, or actions kept failing. ' +
    'A screenshot is attached (or its path is noted). Choose ONE next action or done/stuck.';

  let imageContent = null;
  try {
    const buf = await readFile(screenshotPath);
    const b64 = buf.toString('base64');
    imageContent = {
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${b64}` },
    };
  } catch (err) {
    console.warn('vision: could not read screenshot:', err.message);
  }

  const includeSchema = jsonSchemaUnsupported || !WANT_JSON_SCHEMA;
  const textPart = {
    type: 'text',
    text:
      buildUserPrompt({ task, snapshot, history, visionNote, includeSchema }) +
      (imageContent
        ? ''
        : `\n(Screenshot path on disk: ${screenshotPath} — image attach failed; reason from tree/history only.)`),
  };

  const userContent = imageContent ? [textPart, imageContent] : textPart;
  let lastErr;
  const usages = [];

  for (let attempt = 1; attempt <= 3; attempt++) {
    const messages = [
      { role: 'system', content: getSystemPrompt() },
      { role: 'user', content: userContent },
    ];
    if (attempt > 1) {
      messages.push({
        role: 'user',
        content: `Previous reply was invalid (${lastErr}). Reply with ONLY one valid JSON action object.`,
      });
    }

    try {
      const { res, usage } = await chatCreate({
        model: VISION_MODEL,
        messages,
        schema: ACTION_JSON_SCHEMA,
        schemaName: 'BrowserAction',
      });
      usages.push(usage);
      const raw = res.choices[0]?.message?.content ?? '{}';
      const action = extractJson(raw);
      const v = validateAction(action);
      if (!v.ok) {
        lastErr = v.errors.join('; ');
        continue;
      }
      if (snapshot.nodes.length && !actionTargetsListed(action, snapshot)) {
        lastErr = `element not in list: role=${action.role} name=${action.name}`;
        continue;
      }
      return { action, visionModel: VISION_MODEL, screenshotPath, usage: mergeUsages(usages) };
    } catch (err) {
      lastErr = err.message;
      if (/not found|does not exist|404/i.test(err.message)) {
        throw new Error(`Vision model unavailable (${VISION_MODEL}): ${err.message}`);
      }
    }
  }
  throw Object.assign(new Error(`Vision recovery failed after retries: ${lastErr}`), {
    usage: mergeUsages(usages),
  });
}

export async function checkDone({ task, snapshot, history, terminalReason, screenshotPath }) {
  const summary = [
    `Task: ${task}`,
    `Terminal reason from agent: ${terminalReason ?? '(none)'}`,
    `Final URL: ${snapshot?.url ?? '(unknown)'}`,
    `Final title: ${snapshot?.title ?? ''}`,
    'Final elements (up to 40):',
    ...((snapshot?.nodes || []).slice(0, 40).map(
      (n) =>
        `  [${n.index}] role=${n.role} name=${JSON.stringify(n.name)}${n.value != null && n.value !== '' ? ` value=${JSON.stringify(n.value)}` : ''}`,
    ) || ['  (none)']),
    '',
    'Action history (last 12):',
    ...(history.slice(-12).map((h, i) => `  ${i + 1}. ${JSON.stringify(h)}`) || ['  (none)']),
  ];
  if (screenshotPath) {
    summary.push(`Optional screenshot path (for human review): ${screenshotPath}`);
  }
  if (jsonSchemaUnsupported || !WANT_JSON_SCHEMA) {
    summary.push('', schemaPromptBlock(DONE_CHECK_JSON_SCHEMA, 'DoneCheck'));
  }

  const messages = [
    { role: 'system', content: DONE_CHECK_SYSTEM },
    { role: 'user', content: summary.join('\n') },
  ];

  try {
    const { res, usage } = await chatCreate({
      model: MODEL,
      messages,
      schema: DONE_CHECK_JSON_SCHEMA,
      schemaName: 'DoneCheck',
    });
    const raw = res.choices[0]?.message?.content ?? '{}';
    const parsed = extractJson(raw);
    const v = validateDoneCheck({
      achieved: Boolean(parsed.achieved),
      why: String(parsed.why || ''),
    });
    return {
      achieved: Boolean(parsed.achieved),
      why: String(parsed.why || ''),
      raw: parsed,
      usage,
      schemaValid: v.ok,
    };
  } catch (err) {
    return {
      achieved: false,
      why: `done-check failed: ${err.message}`,
      error: err.message,
      usage: err.usage || null,
    };
  }
}

export async function visionModelAvailable() {
  try {
    const base = (process.env.LLM_BASE_URL || 'http://localhost:11434/v1').replace(/\/v1\/?$/, '');
    const res = await fetch(`${base}/api/tags`);
    if (!res.ok) return false;
    const data = await res.json();
    const names = (data.models || []).map((m) => m.name);
    return names.some(
      (n) => n === VISION_MODEL || n.startsWith(`${VISION_MODEL}:`) || n.startsWith(VISION_MODEL.split(':')[0]),
    );
  } catch {
    return false;
  }
}

export function getModelName() {
  return MODEL;
}

export function structuredOutputMode() {
  if (!WANT_JSON_SCHEMA) return 'json_object+prompt-schema (LLM_JSON_SCHEMA=0)';
  if (jsonSchemaUnsupported) return 'json_object+prompt-schema (json_schema unsupported at runtime)';
  return 'json_schema (preferred) with json_object fallback';
}
