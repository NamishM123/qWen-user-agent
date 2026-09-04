import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import OpenAI from 'openai';
import { loadPersona } from './persona.js';

const client = new OpenAI({
  baseURL: process.env.LLM_BASE_URL || 'http://localhost:11434/v1',
  apiKey: process.env.LLM_API_KEY || 'ollama',
});
const MODEL = process.env.LLM_MODEL || 'qwen2.5:7b';

function sessionRoot(sessionId) {
  return join(process.cwd(), 'runs', 'compare', sessionId);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function loadActions(runDir) {
  const p = join(runDir, 'actions.jsonl');
  if (!existsSync(p)) return [];
  const raw = await readFile(p, 'utf8');
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try { return JSON.parse(l); } catch { return { raw: l }; }
    });
}

async function loadRunBundle(entry) {
  const runDir = entry.runDir;
  let final = null;
  let taskTxt = '';
  try { final = await readJson(join(runDir, 'final.json')); } catch {}
  try { taskTxt = await readFile(join(runDir, 'task.txt'), 'utf8'); } catch {}
  const actions = await loadActions(runDir);
  return {
    app_id: entry.app_id,
    app_name: entry.app_name,
    url: entry.url,
    job_id: entry.job_id,
    runDir,
    success: entry.success ?? final?.success,
    terminalReason: entry.terminalReason ?? final?.terminalReason,
    finalUrl: entry.finalUrl ?? final?.finalUrl,
    stepCount: entry.stepCount ?? final?.stepCount,
    doneCheck: entry.doneCheck ?? final?.doneCheck,
    taskTxt: taskTxt.slice(0, 1500),
    actions: actions.slice(0, 40).map((a) => ({
      step: a.step,
      url: a.url,
      action: a.action,
      error: a.error,
      result: a.result ? { terminal: a.result.terminal, reason: a.result.reason } : undefined,
    })),
    finalTitle: final?.finalTitle,
    finalNodes: (final?.finalNodes || []).slice(0, 25).map((n) => ({
      role: n.role,
      name: n.name,
      value: n.value,
    })),
    screenshotPath: final?.screenshotPath || null,
  };
}

function extractJson(raw) {
  const trimmed = String(raw ?? '').trim();
  try { return JSON.parse(trimmed); } catch {}
  const stripped = trimmed.replace(/```(?:json)?/gi, '').trim();
  try { return JSON.parse(stripped); } catch {}
  const match = stripped.match(/\{[\s\S]*\}/);
  if (match) return JSON.parse(match[0]);
  throw new Error('Model returned non-JSON feedback');
}

function fallbackReport(session, bundles, persona) {
  const apps = [...new Set(bundles.map((b) => b.app_id))];
  const scores = {};
  for (const id of apps) {
    const runs = bundles.filter((b) => b.app_id === id);
    const ok = runs.filter((r) => r.success).length;
    const effort = runs.reduce((a, r) => a + (r.stepCount || 0), 0);
    scores[id] = {
      clarity: ok ? 3 : 2,
      trust: 3,
      speed_effort: effort <= 6 ? 4 : 2,
      fit_to_persona: ok ? 3 : 2,
      delight: 2,
    };
  }
  const frictions = bundles.flatMap((b) => {
    const moments = [];
    for (const a of b.actions || []) {
      if (a.error) {
        moments.push({
          app_id: b.app_id,
          job_id: b.job_id,
          step: a.step,
          url: a.url,
          evidence: String(a.error).slice(0, 200),
          note: 'Action failed',
        });
      }
    }
    if (!b.success) {
      moments.push({
        app_id: b.app_id,
        job_id: b.job_id,
        step: b.stepCount,
        url: b.finalUrl,
        evidence: b.terminalReason || 'unsuccessful',
        note: 'Job did not complete successfully',
      });
    }
    return moments;
  });
  const primary = apps[0];
  const others = apps.slice(1);
  return {
    persona_id: persona?.id || session.persona?.id,
    persona_name: persona?.name || session.persona?.name,
    session_id: session.session_id,
    executive_summary:
      'I ran the same jobs across ' +
      apps.join('/') +
      '. Success markers and step counts are from the run logs — not invented UI.',
    friction_moments: frictions.slice(0, 20),
    comparison_table: apps.map((id) => {
      const runs = bundles.filter((b) => b.app_id === id);
      return {
        app_id: id,
        jobs_ok: runs.filter((r) => r.success).length,
        jobs_total: runs.length,
        total_steps: runs.reduce((a, r) => a + (r.stepCount || 0), 0),
        notes: runs
          .map((r) => r.job_id + ':' + (r.success ? 'ok' : 'fail') + ' @' + (r.finalUrl || r.url || ''))
          .join('; '),
      };
    }),
    feature_suggestions_for_app_a: others.length
      ? [
          {
            for_app: primary,
            inspired_by: others,
            suggestion: 'Surface the primary CTA and price/next-step earlier — competitors made the next action easier to spot in the same jobs.',
            evidence: bundles
              .filter((b) => others.includes(b.app_id) && b.success)
              .map((b) => b.app_id + '/' + b.job_id + ' succeeded in ' + (b.stepCount || '?') + ' steps')
              .slice(0, 5),
          },
        ]
      : [],
    rubric_scores: scores,
    evidence_only: true,
    generator: 'fallback',
  };
}

function toMarkdown(report) {
  const lines = [];
  lines.push('# Persona UX research report');
  lines.push('');
  lines.push('**Persona:** ' + (report.persona_name || '') + ' (`' + (report.persona_id || '') + '`)');
  lines.push('**Session:** `' + (report.session_id || '') + '`');
  lines.push('');
  lines.push('## Executive summary');
  lines.push(report.executive_summary || '(none)');
  lines.push('');
  lines.push('## Rubric scores (1-5)');
  lines.push('| App | Clarity | Trust | Speed/effort | Fit to persona | Delight |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const [app, s] of Object.entries(report.rubric_scores || {})) {
    lines.push('| ' + app + ' | ' + (s.clarity ?? '') + ' | ' + (s.trust ?? '') + ' | ' + (s.speed_effort ?? '') + ' | ' + (s.fit_to_persona ?? '') + ' | ' + (s.delight ?? '') + ' |');
  }
  lines.push('');
  lines.push('## Side-by-side');
  lines.push('| App | Jobs ok | Total steps | Notes |');
  lines.push('| --- | ---: | ---: | --- |');
  for (const row of report.comparison_table || []) {
    const notes = String(row.notes || '').replace(/\|/g, '/');
    lines.push('| ' + row.app_id + ' | ' + row.jobs_ok + '/' + row.jobs_total + ' | ' + row.total_steps + ' | ' + notes + ' |');
  }
  lines.push('');
  lines.push('## Friction moments');
  for (const f of report.friction_moments || []) {
    lines.push('- **' + f.app_id + '/' + f.job_id + '** step ' + f.step + ' @ ' + (f.url || '') + ' — ' + (f.note || '') + ' _(evidence: ' + (f.evidence || '') + ')_');
  }
  if (!(report.friction_moments || []).length) lines.push('_No friction moments recorded._');
  lines.push('');
  lines.push('## Feature suggestions for App A');
  for (const s of report.feature_suggestions_for_app_a || []) {
    lines.push('- ' + s.suggestion + ' _(inspired by: ' + (s.inspired_by || []).join(', ') + '; evidence: ' + (s.evidence || []).join('; ') + ')_');
  }
  if (!(report.feature_suggestions_for_app_a || []).length) lines.push('_None derived from logs._');
  lines.push('');
  lines.push('_Evidence-only: do not treat missing UI as present. Generator: ' + (report.generator || 'llm') + '._');
  return lines.join('\n') + '\n';
}

export async function generateFeedback(sessionId) {
  if (!sessionId) throw new Error('sessionId required');
  const root = sessionRoot(sessionId);
  const sessionPath = join(root, 'session.json');
  if (!existsSync(sessionPath)) throw new Error('session not found: ' + root);
  const session = await readJson(sessionPath);
  let persona = null;
  try {
    persona = await loadPersona(session.persona?.id || session.config?.persona);
  } catch (err) {
    console.warn('persona load failed:', err.message);
    persona = session.persona || { id: 'unknown', name: 'Unknown', voice: '' };
  }
  const bundles = [];
  for (const entry of session.runs || []) {
    bundles.push(await loadRunBundle(entry));
  }

  const system = [
    'You are writing a competitive UX research report IN THE VOICE of this persona:',
    persona.name + ' (' + persona.id + '). Voice: ' + (persona.voice || ''),
    'Demographic: ' + (persona.demographic || ''),
    'CRITICAL RULES:',
    '1) Use ONLY evidence from the provided run logs (actions, urls, terminalReason, final nodes).',
    '2) NEVER invent UI elements, copy, or pages that are not in the logs.',
    '3) Every friction moment MUST cite app_id, job_id, step and/or url from the logs.',
    '4) Feature suggestions for App A must be inspired by gaps vs B/C that appear in the evidence.',
    '5) Rubric scores are integers 1-5 for clarity, trust, speed_effort, fit_to_persona, delight.',
    'Reply with ONLY JSON matching the schema described by the user.'
  ].join('\n');
  const user = {
    session_id: session.session_id,
    apps: session.config?.apps || [],
    jobs: session.config?.jobs || [],
    runs: bundles,
    schema: {
      executive_summary: 'string in persona voice',
      friction_moments: [{ app_id: '', job_id: '', step: 0, url: '', evidence: '', note: '' }],
      comparison_table: [{ app_id: '', jobs_ok: 0, jobs_total: 0, total_steps: 0, notes: '' }],
      feature_suggestions_for_app_a: [{ for_app: '', inspired_by: [], suggestion: '', evidence: [] }],
      rubric_scores: { '<app_id>': { clarity: 1, trust: 1, speed_effort: 1, fit_to_persona: 1, delight: 1 } },
    },
  };

  let report;
  try {
    const res = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(user, null, 2) },
      ],
    });
    const raw = res.choices[0]?.message?.content ?? '{}';
    report = extractJson(raw);
    report.generator = 'llm';
  } catch (err) {
    console.warn('LLM feedback failed, using evidence fallback:', err.message);
    report = fallbackReport(session, bundles, persona);
  }

  report.persona_id = report.persona_id || persona.id;
  report.persona_name = report.persona_name || persona.name;
  report.session_id = session.session_id;
  report.evidence_only = true;
  if (!report.rubric_scores) report.rubric_scores = fallbackReport(session, bundles, persona).rubric_scores;
  if (!report.comparison_table) report.comparison_table = fallbackReport(session, bundles, persona).comparison_table;
  if (!report.friction_moments) report.friction_moments = [];
  if (!report.feature_suggestions_for_app_a) report.feature_suggestions_for_app_a = [];
  if (!report.executive_summary) report.executive_summary = fallbackReport(session, bundles, persona).executive_summary;

  const md = toMarkdown(report);
  await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  await writeFile(join(root, 'report.md'), md, 'utf8');
  session.report = { path_md: join(root, 'report.md'), path_json: join(root, 'report.json'), generated_at: new Date().toISOString() };
  await writeFile(sessionPath, JSON.stringify(session, null, 2), 'utf8');
  console.log('report written:', join(root, 'report.md'));
  return { root, report, markdown: md };
}

function isMain() {
  const entry = process.argv[1];
  if (!entry) return false;
  try { return import.meta.url === pathToFileURL(entry).href; } catch { return false; }
}

if (isMain()) {
  const sessionId = process.argv[2];
  if (!sessionId) {
    console.error('Usage: node src/feedback.js <sessionId>');
    process.exit(1);
  }
  generateFeedback(sessionId).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

