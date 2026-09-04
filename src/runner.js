#!/usr/bin/env node
/**
 * Task queue CLI: enqueue tasks and process pending ones with the agent.
 *
 *   node --env-file=.env src/runner.js enqueue --url URL --task "..." [--expect '{"urlContains":"x"}']
 *   node --env-file=.env src/runner.js process [--once] [--limit N]
 *   node --env-file=.env src/runner.js list [--status pending|running|done|failed]
 *   node --env-file=.env src/runner.js show <id>
 */
import { openQueue, enqueue, claimNext, completeTask, listTasks, getTask, closeQueue, queueImpl } from './queue.js';
import { run } from './agent.js';

function usage() {
  console.log(`Usage:
  runner enqueue --url <url> --task <task> [--expect <json>]
  runner process [--once] [--limit N]
  runner list [--status pending|running|done|failed] [--limit N]
  runner show <id>
`);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') args.url = argv[++i];
    else if (a === '--task') args.task = argv[++i];
    else if (a === '--expect') args.expect = argv[++i];
    else if (a === '--status') args.status = argv[++i];
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--once') args.once = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a.startsWith('--')) throw new Error(`Unknown flag: ${a}`);
    else args._.push(a);
  }
  return args;
}

async function cmdEnqueue(args) {
  if (!args.url || !args.task) {
    throw new Error('enqueue requires --url and --task');
  }
  let expect = null;
  if (args.expect) {
    expect = JSON.parse(args.expect);
  }
  const id = enqueue({ url: args.url, task: args.task, expect });
  console.log(`enqueued id=${id} impl=${queueImpl()}`);
  return id;
}

async function cmdProcess(args) {
  const limit = args.once ? 1 : args.limit || Infinity;
  let n = 0;
  while (n < limit) {
    const task = claimNext();
    if (!task) {
      console.log('no pending tasks');
      break;
    }
    n += 1;
    console.log(`\n=== processing task #${task.id} ===`);
    console.log(`url: ${task.url}`);
    console.log(`task: ${task.task}`);
    try {
      const final = await run({ url: task.url, task: task.task });
      const status = final.success ? 'done' : 'failed';
      completeTask(task.id, {
        status,
        run_dir: final.runDir,
        result: {
          success: final.success,
          terminalReason: final.terminalReason,
          finalUrl: final.finalUrl,
          finalTitle: final.finalTitle,
          stepCount: final.stepCount,
          cost: final.cost,
          doneCheck: final.doneCheck,
          expect: task.expect,
        },
      });
      console.log(`task #${task.id} → ${status}`);
    } catch (err) {
      console.error(`task #${task.id} crashed:`, err.message);
      completeTask(task.id, {
        status: 'failed',
        result: { error: err.message, stack: err.stack },
      });
    }
  }
}

async function cmdList(args) {
  const rows = listTasks({ status: args.status || null, limit: args.limit || 50 });
  for (const r of rows) {
    console.log(
      `#${r.id}\t${r.status}\t${(r.url || '').slice(0, 40)}\t${(r.task || '').slice(0, 50)}\t${r.updated_at}`,
    );
  }
  console.log(`(${rows.length} rows, impl=${queueImpl()})`);
}

async function cmdShow(args) {
  const id = Number(args._[1]);
  if (!id) throw new Error('show requires numeric id');
  const t = getTask(id);
  if (!t) {
    console.log('not found');
    return;
  }
  console.log(JSON.stringify(t, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args._[0]) {
    usage();
    process.exit(args.help ? 0 : 1);
  }
  await openQueue();
  try {
    const cmd = args._[0];
    if (cmd === 'enqueue') await cmdEnqueue(args);
    else if (cmd === 'process') await cmdProcess(args);
    else if (cmd === 'list') await cmdList(args);
    else if (cmd === 'show') await cmdShow(args);
    else {
      usage();
      throw new Error(`Unknown command: ${cmd}`);
    }
  } finally {
    closeQueue();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
