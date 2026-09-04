/**
 * Phase 5 persona compare runner.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { run } from './agent.js';
import {
  loadCompareConfig,
  loadPersona,
  loadJob,
  COMPARES_DIR,
} from './persona.js';

function sessionStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${ms}`
  );
}

function parseArgs(argv) {
  const args = { config: null, noFeedback: false, sessionId: null, headless: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-feedback') args.noFeedback = true;
    else if (a === '--session' || a === '--sessionId') args.sessionId = argv[++i];
    else if (a === '--headless') args.headless = true;
    else if (a === '--headed') args.headless = false;
    else if (a.startsWith('-')) console.warn('unknown flag', a);
    else rest.push(a);
  }
  args.config = rest[0] || join(COMPARES_DIR, 'demo-smoke.json');
  return args;
}

function jobGoalText(job) {
  const steps = job.steps || [];
  if (!steps.length) return job.description || job.name || job.id;
  return steps.map((s, i) => `${i + 1}. ${s.goal}`).join('\n');
}

export async function runCompare({
  configPath,
  sessionId: sessionIdOverride = null,
  noFeedback = false,
  headless = null,
  onProgress = null,
} = {}) {
  const { path: resolvedPath, config } = await loadCompareConfig(configPath);
  const persona = await loadPersona(config.persona);
  const jobs = [];
  for (const jid of config.jobs || []) {
    jobs.push(await loadJob(jid));
  }
  if (!config.apps?.length) throw new Error('compare config needs apps[]');
  if (!jobs.length) throw new Error('compare config needs jobs[]');

  const sessionId =
    sessionIdOverride ||
    `${config.id || basename(resolvedPath, '.json')}-${sessionStamp()}`;
  const sessionRoot = join(process.cwd(), 'runs', 'compare', sessionId);
  await mkdir(sessionRoot, { recursive: true });

  const session = {
    session_id: sessionId,
    created_at: new Date().toISOString(),
    config_path: resolvedPath,
    config,
    persona: {
      id: persona.id,
      name: persona.name,
      demographic: persona.demographic,
    },
    status: 'running',
    runs: [],
  };
  await writeFile(join(sessionRoot, 'session.json'), JSON.stringify(session, null, 2), 'utf8');
  console.log(`\n=== compare session ${sessionId} ===`);
  console.log(`persona: ${persona.id} · apps: ${config.apps.length} · jobs: ${jobs.length}`);
  console.log(`dir: ${sessionRoot}`);

  const isHeadless =
    headless != null
      ? Boolean(headless)
      : process.env.HEADLESS === '1' || process.env.HEADLESS === 'true';
  const maxSteps = Number(config.maxSteps) || Number(process.env.COMPARE_MAX_STEPS) || 8;

  for (const app of config.apps) {
    for (const job of jobs) {
      const runDir = join(sessionRoot, app.id, job.id);
      await mkdir(runDir, { recursive: true });
      const task = jobGoalText(job);
      const compareMeta = {
        session_id: sessionId,
        app_id: app.id,
        app_name: app.name,
        job_id: job.id,
        job_name: job.name,
      };
      console.log(`\n--- ${app.id} × ${job.id} @ ${app.url} ---`);
      const entry = {
        app_id: app.id,
        app_name: app.name,
        url: app.url,
        job_id: job.id,
        runDir,
        started_at: new Date().toISOString(),
      };
      try {
        const final = await run({
          url: app.url,
          task,
          persona,
          compareMeta,
          runDir,
          maxSteps,
          headless: isHeadless,
          onProgress: onProgress
            ? (ev) => onProgress({ ...ev, app_id: app.id, job_id: job.id, session_id: sessionId })
            : undefined,
        });
        entry.finished_at = new Date().toISOString();
        entry.success = Boolean(final.success);
        entry.terminalReason = final.terminalReason;
        entry.finalUrl = final.finalUrl;
        entry.stepCount = final.stepCount;
        entry.doneCheck = final.doneCheck;
      } catch (err) {
        entry.finished_at = new Date().toISOString();
        entry.success = false;
        entry.error = err.message;
        console.error(`run failed: ${err.message}`);
        await writeFile(
          join(runDir, 'final.json'),
          JSON.stringify(
            {
              success: false,
              terminalReason: `compare error: ${err.message}`,
              persona_id: persona.id,
              job_id: job.id,
              app_id: app.id,
              session_id: sessionId,
              error: err.message,
            },
            null,
            2,
          ),
          'utf8',
        );
      }
      session.runs.push(entry);
      session.updated_at = new Date().toISOString();
      await writeFile(join(sessionRoot, 'session.json'), JSON.stringify(session, null, 2), 'utf8');
    }
  }

  session.status = 'completed';
  session.finished_at = new Date().toISOString();
  await writeFile(join(sessionRoot, 'session.json'), JSON.stringify(session, null, 2), 'utf8');
  console.log(`\n=== compare complete: ${sessionRoot} ===`);

  if (!noFeedback) {
    try {
      const { generateFeedback } = await import('./feedback.js');
      await generateFeedback(sessionId);
    } catch (err) {
      console.warn('feedback generation failed:', err.message);
      session.feedback_error = err.message;
      await writeFile(join(sessionRoot, 'session.json'), JSON.stringify(session, null, 2), 'utf8');
    }
  }

  return { sessionId, sessionRoot, session };
}

function isMain() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}

if (isMain()) {
  const args = parseArgs(process.argv.slice(2));
  runCompare({
    configPath: args.config,
    sessionId: args.sessionId,
    noFeedback: args.noFeedback,
    headless: args.headless,
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

