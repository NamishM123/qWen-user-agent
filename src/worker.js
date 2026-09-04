#!/usr/bin/env node
/** Phase 4 worker — concurrent pool + safe claim + live events. */
import {
  openQueue,
  claimNext,
  claimNextAsync,
  completeTask,
  completeTaskAsync,
  appendEvent,
  appendEventAsync,
  closeQueue,
  queueImpl,
  isPostgres,
} from './queue.js';
import { run } from './agent.js';
import { getPromptVersion } from './qwen.js';
import { guardrailSnapshot } from './guardrails.js';

const POLL_MS = Number(process.env.WORKER_POLL_MS) || 1500;
const CONCURRENCY = Math.max(1, Number(process.env.WORKER_CONCURRENCY) || 1);
const HEADLESS =
  process.env.HEADLESS === '1' ||
  process.env.HEADLESS === 'true' ||
  process.env.WORKER_HEADLESS === '1';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function emit(taskId, event) {
  const payload = { ts: new Date().toISOString(), ...event };
  if (isPostgres()) await appendEventAsync(taskId, payload);
  else appendEvent(taskId, payload);
  console.log(
    `[task ${taskId}] ${event.type}` +
      (event.step != null ? ` step=${event.step}` : ''),
    event.action?.type || event.message || event.terminalReason || event.reason || '',
  );
}

async function processOne(task) {
  console.log(`\n=== processing task #${task.id} ===`);
  console.log(`url: ${task.url}`);
  console.log(`task: ${task.task}`);
  console.log(`prompt_version: ${task.prompt_version || getPromptVersion()}`);
  await emit(task.id, {
    type: 'claimed',
    url: task.url,
    task: task.task,
    prompt_version: task.prompt_version || getPromptVersion(),
  });
  try {
    const final = await run({
      url: task.url,
      task: task.task,
      headless: HEADLESS,
      onProgress: async (ev) => {
        await emit(task.id, ev);
      },
    });
    const status = final.success ? 'done' : 'failed';
    const result = {
      success: final.success,
      terminalReason: final.terminalReason,
      finalUrl: final.finalUrl,
      finalTitle: final.finalTitle,
      stepCount: final.stepCount,
      cost: final.cost,
      doneCheck: final.doneCheck,
      expect: task.expect,
      prompt_version: final.prompt_version || task.prompt_version || getPromptVersion(),
    };
    if (isPostgres()) {
      await completeTaskAsync(task.id, { status, run_dir: final.runDir, result });
    } else {
      completeTask(task.id, { status, run_dir: final.runDir, result });
    }
    await emit(task.id, { type: 'finished', status, result, runDir: final.runDir });
    console.log(`task #${task.id} -> ${status}`);
  } catch (err) {
    console.error(`task #${task.id} crashed:`, err.message);
    const result = { error: err.message, stack: err.stack };
    if (isPostgres()) await completeTaskAsync(task.id, { status: 'failed', result });
    else completeTask(task.id, { status: 'failed', result });
    await emit(task.id, { type: 'error', message: err.message });
  }
}

async function claim() {
  return isPostgres() ? await claimNextAsync() : claimNext();
}

async function main() {
  const info = await openQueue();
  console.log(
    `worker started impl=${info.impl} headless=${HEADLESS} poll=${POLL_MS}ms concurrency=${CONCURRENCY}`,
  );
  console.log(`db: ${info.path}`);
  console.log(`prompt_version=${getPromptVersion()}`);
  console.log('guardrails:', guardrailSnapshot());

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    console.log('\nshutting down (waiting for in-flight)...');
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  /** @type {Set<Promise<void>>} */
  const inFlight = new Set();

  while (!stopping || inFlight.size > 0) {
    // fill pool
    while (!stopping && inFlight.size < CONCURRENCY) {
      const task = await claim();
      if (!task) break;
      const p = processOne(task)
        .catch((err) => console.error('worker slot error:', err))
        .finally(() => inFlight.delete(p));
      inFlight.add(p);
    }
    if (stopping) {
      if (inFlight.size) await Promise.race([...inFlight, sleep(200)]);
      continue;
    }
    if (inFlight.size === 0) {
      await sleep(POLL_MS);
      continue;
    }
    // wait for any slot to free, or poll for more work
    await Promise.race([...inFlight, sleep(POLL_MS)]);
  }

  closeQueue();
  console.log('worker stopped');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
