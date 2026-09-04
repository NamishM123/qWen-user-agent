#!/usr/bin/env node
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { run } from './agent.js';
import { evaluateExpect } from './expect.js';
import { getPromptVersion } from './qwen.js';

const TESTS_DIR = join(process.cwd(), 'tests');

function parseArgs(argv) {
  const args = { only: null, list: false, dryRun: false, limit: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--only') args.only = new Set(argv[++i].split(',').map((s) => s.trim()).filter(Boolean));
    else if (a === '--list') args.list = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

async function loadTasks() {
  const files = (await readdir(TESTS_DIR)).filter((f) => f.endsWith('.json') && f !== 'suite.json');
  const tasks = [];
  for (const f of files) {
    const raw = await readFile(join(TESTS_DIR, f), 'utf8');
    const t = JSON.parse(raw);
    if (!t.id) t.id = basename(f, '.json');
    tasks.push(t);
  }
  tasks.sort((a, b) => a.id.localeCompare(b.id));
  return tasks;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node src/eval.js [--only id1,id2] [--list] [--dry-run] [--limit N]');
    process.exitCode = 0;
    return;
  }

  let tasks = await loadTasks();
  if (args.only) tasks = tasks.filter((t) => args.only.has(t.id));
  if (args.limit) tasks = tasks.slice(0, args.limit);

  if (args.list) {
    for (const t of tasks) {
      console.log(`${t.id}\t${t.url}\t${t.task.slice(0, 60)}`);
    }
    console.log(`(${tasks.length} tasks)`);
    return;
  }

  console.log(`Eval suite: ${tasks.length} tasks  HEADLESS=${process.env.HEADLESS || ''}`);
  const results = [];
  const started = Date.now();

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    console.log(`\n######## [${i + 1}/${tasks.length}] ${t.id} ########`);
    console.log(t.url);
    console.log(t.task);

    if (args.dryRun) {
      results.push({ id: t.id, pass: null, dryRun: true });
      continue;
    }

    let final;
    let error = null;
    try {
      final = await run({
        url: t.url,
        task: t.task,
        maxSteps: t.maxSteps || Number(process.env.MAX_STEPS) || 25,
      });
    } catch (err) {
      error = err.message;
      console.error('run crashed:', error);
      final = {
        success: false,
        finalUrl: null,
        finalTitle: null,
        finalNodes: [],
        runDir: null,
        terminalReason: 'crash: ' + error,
        cost: null,
      };
    }

    const judged = evaluateExpect(final, t.expect || {});
    console.log(`result: ${judged.pass ? 'PASS' : 'FAIL'}`, judged.checks);
    results.push({
      id: t.id,
      pass: judged.pass,
      checks: judged.checks,
      runDir: final.runDir,
      finalUrl: final.finalUrl,
      success: final.success,
      terminalReason: final.terminalReason,
      cost: final.cost,
      prompt_version: final.prompt_version || getPromptVersion(),
      error,
    });
  }

  const judgedRows = results.filter((r) => r.pass != null);
  const passed = judgedRows.filter((r) => r.pass).length;
  const total = judgedRows.length;
  const rate = total ? passed / total : 0;
  const elapsed_ms = Date.now() - started;

  console.log('\n========== EVAL SUMMARY ==========');
  for (const r of results) {
    const mark = r.pass == null ? 'SKIP' : r.pass ? 'PASS' : 'FAIL';
    console.log(`${mark}\t${r.id}\t${(r.finalUrl || '').slice(0, 60)}\t${(r.terminalReason || r.error || '').slice(0, 80)}`);
  }
  console.log(`\nPass rate: ${passed}/${total} (${(rate * 100).toFixed(1)}%)`);
  console.log(`Elapsed: ${(elapsed_ms / 1000).toFixed(1)}s`);
  const met = rate >= 0.7;
  console.log(`Exit criterion >=70%: ${met ? 'MET' : 'NOT MET'}`);

  const outDir = join(process.cwd(), 'runs', 'eval');
  await mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = join(outDir, `summary-${stamp}.json`);
  await writeFile(
    outPath,
    JSON.stringify({ passed, total, rate, elapsed_ms, results, met70: met, prompt_version: getPromptVersion() }, null, 2),
    'utf8',
  );
  console.log(`Wrote ${outPath}`);

  if (total > 0 && !met) process.exitCode = 2;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
