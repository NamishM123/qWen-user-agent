/**
 * Autonomous exploration runner.
 *
 * Instead of a preset job, you give it a URL (and optionally a persona) and it
 * roams the app on its own — opening navigation, trying representative features,
 * avoiding destructive actions — then writes a coverage report of what it saw.
 *
 * Usage:
 *   node --env-file=.env src/explore.js <url> [--persona <id>] [--max-steps N] [--headed] [--no-summary]
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import OpenAI from 'openai';
import { run } from './agent.js';
import { loadPersona } from './persona.js';

const client = new OpenAI({
  baseURL: process.env.LLM_BASE_URL || 'http://localhost:11434/v1',
  apiKey: process.env.LLM_API_KEY || 'ollama',
});
const MODEL = process.env.LLM_MODEL || 'qwen2.5:7b';

function sessionStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${ms}`
  );
}

// The open-ended instruction that replaces a preset job. Breadth over depth, and
// explicitly safe: no irreversible actions.
export function buildExploreTask() {
  return [
    'EXPLORE MODE: there is no single task. Your goal is to discover and briefly try the',
    'main features of this web app, like a new user taking a self-guided tour.',
    '',
    'How to explore:',
    '- Start from the landing page and read what is on it.',
    '- Open the primary navigation and visit the main areas one at a time.',
    '- Try representative features: search or browse, open a detail/item page,',
    '  open (but do not submit) a key form, follow the main call-to-action.',
    '- Prefer BREADTH: after you have seen an area, use back/navigate to try a',
    '  different one instead of going deep into the same place.',
    '- Do not repeat the same action on the same page; if nothing new appears, move on.',
    '',
    'NEVER do anything destructive or irreversible:',
    '- no purchasing, checkout, or entering payment details',
    '- no deleting, no logging out, no changing account settings or passwords',
    '- no submitting real personal data, no posting/publishing content',
    '- opening a form to see its fields is fine; actually submitting it is not,',
    '  unless it is a harmless search.',
    '',
    'Emit done when you have covered the main areas, or stuck if you cannot proceed.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = { url: null, persona: null, maxSteps: null, headless: null, summary: true };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--persona') args.persona = argv[++i];
    else if (a === '--max-steps') args.maxSteps = Number(argv[++i]);
    else if (a === '--headed') args.headless = false;
    else if (a === '--headless') args.headless = true;
    else if (a === '--no-summary') args.summary = false;
    else if (a.startsWith('-')) console.warn('unknown flag', a);
    else rest.push(a);
  }
  args.url = rest[0] || null;
  return args;
}

async function loadActions(runDir) {
  const p = join(runDir, 'actions.jsonl');
  if (!existsSync(p)) return [];
  const raw = await readFile(p, 'utf8');
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return { raw: l }; } });
}

// Deterministic coverage report straight from the logs — no LLM needed.
function buildCoverage(actions, final) {
  const urls = [];
  const seenUrls = new Set();
  const byType = {};
  const touched = [];
  const frictions = [];

  for (const a of actions) {
    if (a.url && !seenUrls.has(a.url)) { seenUrls.add(a.url); urls.push(a.url); }
    const t = a.action?.type || 'unknown';
    byType[t] = (byType[t] || 0) + 1;
    if (['click', 'type', 'select_option', 'hover'].includes(t) && a.action?.name) {
      touched.push({ step: a.step, type: t, target: a.action.name, url: a.url });
    }
    if (a.error) {
      frictions.push({ step: a.step, action: a.action?.type, target: a.action?.name, url: a.url, error: String(a.error).slice(0, 160) });
    }
  }

  return {
    pages_visited: urls,
    pages_visited_count: urls.length,
    actions_by_type: byType,
    features_touched: touched.slice(0, 40),
    friction_moments: frictions.slice(0, 20),
    steps: final?.stepCount ?? actions.length,
    terminalReason: final?.terminalReason ?? null,
    covered: final?.doneCheck?.achieved ?? null,
  };
}

// Best-effort LLM narrative. Degrades to null if the model is unavailable.
async function narrate(coverage, persona) {
  const personaLine = persona
    ? `You are summarizing for ${persona.name} (${persona.id}); use their voice: ${persona.voice || 'plain and practical'}.`
    : 'Summarize plainly for a product team.';
  const prompt = [
    'Write a short exploration summary of a web app, using ONLY the evidence below.',
    'Do not invent features that are not in the evidence.',
    personaLine,
    '',
    'Evidence (from the run logs):',
    `- Pages visited (${coverage.pages_visited_count}): ${coverage.pages_visited.join(', ') || '(none)'}`,
    `- Features touched: ${coverage.features_touched.map((f) => f.target).slice(0, 20).join(', ') || '(none)'}`,
    `- Friction: ${coverage.friction_moments.map((f) => `${f.target || f.action} failed`).slice(0, 10).join('; ') || '(none)'}`,
    '',
    'Give: 1) a 2-3 sentence overview of what the app offers, 2) up to 3 rough spots noticed, 3) up to 3 suggestions. Keep it tight.',
  ].join('\n');

  try {
    const res = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
    });
    return res.choices[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.warn('narrative skipped:', err.message);
    return null;
  }
}

function toMarkdown(report) {
  const c = report.coverage;
  const lines = [];
  lines.push('# Autonomous exploration report');
  lines.push('');
  lines.push('**URL:** ' + report.url);
  if (report.persona_name) lines.push('**Persona:** ' + report.persona_name + ' (`' + report.persona_id + '`)');
  lines.push('**Session:** `' + report.session_id + '`');
  lines.push('**Steps:** ' + c.steps + ' · **Pages visited:** ' + c.pages_visited_count + ' · **Ended:** ' + (c.terminalReason || 'n/a'));
  lines.push('');
  if (report.narrative) {
    lines.push('## Summary');
    lines.push(report.narrative);
    lines.push('');
  }
  lines.push('## Pages visited');
  for (const u of c.pages_visited) lines.push('- ' + u);
  if (!c.pages_visited.length) lines.push('_none recorded_');
  lines.push('');
  lines.push('## Features touched');
  for (const f of c.features_touched) lines.push('- step ' + f.step + ': ' + f.type + ' **' + f.target + '** @ ' + (f.url || ''));
  if (!c.features_touched.length) lines.push('_none recorded_');
  lines.push('');
  lines.push('## Friction');
  for (const f of c.friction_moments) lines.push('- step ' + f.step + ': ' + (f.target || f.action) + ' — ' + f.error);
  if (!c.friction_moments.length) lines.push('_none recorded_');
  lines.push('');
  lines.push('_Evidence-only: pages and features are from the run logs, not invented._');
  return lines.join('\n');
}

export async function runExplore({
  url,
  personaId = null,
  maxSteps = null,
  headless = null,
  sessionId: sessionIdOverride = null,
  summary = true,
  onProgress = null,
} = {}) {
  if (!url) throw new Error('runExplore requires a url');
  const persona = personaId ? await loadPersona(personaId) : null;

  const sessionId = sessionIdOverride || `explore-${sessionStamp()}`;
  const runDir = join(process.cwd(), 'runs', 'explore', sessionId);
  await mkdir(runDir, { recursive: true });

  const isHeadless =
    headless != null ? Boolean(headless) : process.env.HEADLESS === '1' || process.env.HEADLESS === 'true';
  const steps = Number(maxSteps) || Number(process.env.EXPLORE_MAX_STEPS) || 20;

  console.log(`\n=== explore ${sessionId} ===`);
  console.log(`url: ${url}  persona: ${persona ? persona.id : '(none)'}  maxSteps: ${steps}`);

  let final = {};
  let runError = null;
  try {
    final = await run({
      url,
      task: buildExploreTask(),
      persona,
      maxSteps: steps,
      headless: isHeadless,
      runDir,
      compareMeta: { session_id: sessionId, app_id: 'explore', job_id: 'explore' },
      onProgress: onProgress ? (ev) => onProgress({ ...ev, session_id: sessionId }) : undefined,
    });
  } catch (err) {
    // A failed browse (e.g. navigation/network error) still gets a report from
    // whatever was logged, so the run is never a silent crash.
    runError = err.message;
    console.error(`explore run failed: ${err.message}`);
  }

  const actions = await loadActions(runDir);
  const coverage = buildCoverage(actions, final);
  const narrative = summary ? await narrate(coverage, persona) : null;

  const report = {
    session_id: sessionId,
    url,
    persona_id: persona?.id ?? null,
    persona_name: persona?.name ?? null,
    created_at: new Date().toISOString(),
    success: Boolean(final.success),
    error: runError,
    coverage,
    narrative,
  };

  await writeFile(join(runDir, 'exploration.json'), JSON.stringify(report, null, 2), 'utf8');
  await writeFile(join(runDir, 'exploration.md'), toMarkdown(report), 'utf8');

  console.log(`\n=== exploration complete ===`);
  console.log(`pages visited: ${coverage.pages_visited_count} · features touched: ${coverage.features_touched.length}`);
  console.log(`report: ${join(runDir, 'exploration.md')}`);
  return { sessionId, runDir, report };
}

function isMain() {
  const entry = process.argv[1];
  if (!entry) return false;
  try { return import.meta.url === pathToFileURL(entry).href; } catch { return false; }
}

if (isMain()) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url) {
    console.log('Usage: node --env-file=.env src/explore.js <url> [--persona <id>] [--max-steps N] [--headed] [--no-summary]');
    process.exit(1);
  }
  runExplore({
    url: args.url,
    personaId: args.persona,
    maxSteps: args.maxSteps,
    headless: args.headless,
    summary: args.summary,
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
