import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch, snapshot, act, takeScreenshot } from './browser.js';
import {
  nextAction,
  nextActionWithVision,
  checkDone,
  visionModelAvailable,
  VISION_MODEL,
  getModelName,
  structuredOutputMode,
  getPromptVersion,
} from './qwen.js';
import { maxSteps as envMaxSteps, checkBudgets, guardrailSnapshot, estimateCostUsd } from './guardrails.js';

const MAX_STEPS = envMaxSteps();
const STUCK_WINDOW = 3;
const FAIL_STREAK_FOR_VISION = 2;

function sameState(a, b) {
  if (!a || !b) return false;
  if (a.url !== b.url) return false;
  if (a.nodes.length !== b.nodes.length) return false;
  return a.nodes.every(
    (n, i) => n.role === b.nodes[i].role && n.name === b.nodes[i].name && n.value === b.nodes[i].value,
  );
}

function runTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

async function createRunDir(url, task) {
  const root = join(process.cwd(), 'runs', runTimestamp());
  await mkdir(join(root, 'snapshots'), { recursive: true });
  await mkdir(join(root, 'screenshots'), { recursive: true });
  await writeFile(join(root, 'task.txt'), `URL: ${url}\nTask: ${task}\n`, 'utf8');
  await writeFile(join(root, 'actions.jsonl'), '', 'utf8');
  return root;
}

async function saveSnapshot(runDir, step, snap, extra = {}) {
  const path = join(runDir, 'snapshots', `${String(step).padStart(3, '0')}.json`);
  await writeFile(path, JSON.stringify({ step, ...snap, ...extra }, null, 2), 'utf8');
  return path;
}

async function logAction(runDir, record) {
  await appendFile(join(runDir, 'actions.jsonl'), JSON.stringify(record) + '\n', 'utf8');
}

function emptyCost() {
  return {
    steps: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    latency_ms: 0,
    by_model: {},
  };
}

function addUsage(cost, usage) {
  if (!usage) return;
  cost.steps += 1;
  const pt = usage.prompt_tokens || 0;
  const ct = usage.completion_tokens || 0;
  const tt = usage.total_tokens || pt + ct;
  const lat = usage.latency_ms || 0;
  cost.prompt_tokens += pt;
  cost.completion_tokens += ct;
  cost.total_tokens += tt;
  cost.latency_ms += lat;
  const m = usage.model || 'unknown';
  if (!cost.by_model[m]) {
    cost.by_model[m] = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, latency_ms: 0, calls: 0 };
  }
  cost.by_model[m].prompt_tokens += pt;
  cost.by_model[m].completion_tokens += ct;
  cost.by_model[m].total_tokens += tt;
  cost.by_model[m].latency_ms += lat;
  cost.by_model[m].calls += 1;
}

/**
 * Run the agent loop. Importable for runner + eval + worker.
 * @param {{ url: string, task: string, maxSteps?: number, headless?: boolean, onProgress?: (ev: object) => void }} opts
 */
export async function run({ url, task, maxSteps = MAX_STEPS, headless, onProgress } = {}) {
  if (!url || !task) throw new Error('run({ url, task }) requires url and task');

  const emit = (ev) => {
    if (!onProgress) return;
    try {
      const ret = onProgress({ ts: new Date().toISOString(), ...ev });
      if (ret && typeof ret.then === 'function') ret.catch(() => {});
    } catch {
      // never break the agent on progress callback errors
    }
  };

  const isHeadless =
    headless != null
      ? Boolean(headless)
      : process.env.HEADLESS === '1' || process.env.HEADLESS === 'true';

  const promptVersion = getPromptVersion();
  const runDir = await createRunDir(url, task);
  console.log(`run dir: ${runDir}`);
  console.log(`browser headless=${isHeadless}`);
  console.log(`model=${getModelName()} structured=${structuredOutputMode()} prompt_version=${promptVersion}`);
  console.log('guardrails:', guardrailSnapshot());
  emit({
    type: 'start',
    url,
    task,
    runDir,
    headless: isHeadless,
    model: getModelName(),
    prompt_version: promptVersion,
    guardrails: guardrailSnapshot(),
  });

  const hasVision = await visionModelAvailable();
  console.log(
    `vision model ${VISION_MODEL}: ${hasVision ? 'available' : 'NOT available (will skip vision recovery)'}`,
  );

  const { browser, page } = await launch({ headless: isHeadless });
  const history = [];
  const postActionStates = [];
  let terminalReason = null;
  let stepCount = 0;
  let visionUsed = false;
  let consecutiveFailures = 0;
  let finalSnap = null;
  let lastScreenshotPath = null;
  let modelSaidDone = false;
  const cost = emptyCost();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    for (let step = 1; step <= maxSteps; step++) {
      stepCount = step;
      const snap = await snapshot(page);
      finalSnap = snap;

      if (
        postActionStates.length >= STUCK_WINDOW &&
        postActionStates.slice(-STUCK_WINDOW).every((s) => sameState(s, postActionStates.at(-1)))
      ) {
        terminalReason = 'stuck: page state unchanged after 3 attempts';
        break;
      }

      console.log(`\n--- step ${step} @ ${snap.url} (${snap.nodes.length} elements) ---`);

      const emptyTree = snap.nodes.length === 0;
      const wantVision =
        hasVision && !visionUsed && (emptyTree || consecutiveFailures >= FAIL_STREAK_FOR_VISION);

      let action;
      let usedVisionThisStep = false;
      let stepUsage = null;

      try {
        if (wantVision) {
          const shotPath = join(runDir, 'screenshots', `vision-step-${String(step).padStart(3, '0')}.png`);
          await takeScreenshot(page, shotPath);
          lastScreenshotPath = shotPath;
          console.log(`vision recovery: screenshot ${shotPath}`);
          const visionResult = await nextActionWithVision({
            task,
            snapshot: snap,
            history,
            screenshotPath: shotPath,
          });
          action = visionResult.action;
          stepUsage = visionResult.usage;
          usedVisionThisStep = true;
          visionUsed = true;
        } else {
          const result = await nextAction({ task, snapshot: snap, history });
          action = result.action;
          stepUsage = result.usage;
        }
      } catch (err) {
        console.error('model error:', err.message);
        if (err.usage) {
          stepUsage = err.usage;
          addUsage(cost, err.usage);
        }
        if (wantVision && !action) {
          try {
            console.warn('falling back to text model after vision error');
            const result = await nextAction({ task, snapshot: snap, history });
            action = result.action;
            stepUsage = result.usage;
          } catch (err2) {
            if (err2.usage) addUsage(cost, err2.usage);
            terminalReason = `model error: ${err2.message}`;
            await saveSnapshot(runDir, step, snap, { visionUsed: usedVisionThisStep, error: err2.message });
            break;
          }
        } else {
          terminalReason = `model error: ${err.message}`;
          await saveSnapshot(runDir, step, snap, { visionUsed: usedVisionThisStep, error: err.message });
          break;
        }
      }

      if (action?.type === 'stuck' && hasVision && !visionUsed) {
        try {
          const shotPath = join(runDir, 'screenshots', `vision-stuck-${String(step).padStart(3, '0')}.png`);
          await takeScreenshot(page, shotPath);
          lastScreenshotPath = shotPath;
          console.log(`vision recovery after stuck: ${shotPath}`);
          const visionResult = await nextActionWithVision({
            task,
            snapshot: snap,
            history: [...history, action],
            screenshotPath: shotPath,
          });
          action = visionResult.action;
          stepUsage = visionResult.usage;
          usedVisionThisStep = true;
          visionUsed = true;
        } catch (err) {
          console.warn('vision after stuck failed:', err.message);
          if (err.usage) addUsage(cost, err.usage);
        }
      }

      addUsage(cost, stepUsage);

      const budget = checkBudgets(cost, step);
      if (!budget.ok) {
        terminalReason = budget.reason;
        console.warn('budget kill:', budget.reason);
        await saveSnapshot(runDir, step, snap, { visionUsed: usedVisionThisStep, budgetKill: budget.reason });
        await logAction(runDir, {
          step,
          ts: new Date().toISOString(),
          action: action || { type: 'stuck', reason: budget.reason },
          visionUsed: usedVisionThisStep,
          url: snap.url,
          usage: stepUsage,
          prompt_version: promptVersion,
          budgetKill: budget.reason,
        });
        emit({ type: 'budget_kill', step, reason: budget.reason, cost });
        break;
      }

      await saveSnapshot(runDir, step, snap, { visionUsed: usedVisionThisStep });
      console.log('action:', action);
      if (stepUsage) {
        console.log(
          `  llm: model=${stepUsage.model} latency_ms=${stepUsage.latency_ms} tokens=${stepUsage.prompt_tokens ?? '?'}/${stepUsage.completion_tokens ?? '?'} fmt=${stepUsage.response_format}`,
        );
      }
      emit({
        type: 'action',
        step,
        action,
        url: snap.url,
        title: snap.title,
        visionUsed: usedVisionThisStep,
        usage: stepUsage,
      });
      history.push(action);

      const actionRecord = {
        step,
        ts: new Date().toISOString(),
        action,
        visionUsed: usedVisionThisStep,
        url: snap.url,
        usage: stepUsage,
        prompt_version: promptVersion,
      };

      try {
        const result = await act(page, action, { runDir });
        actionRecord.result = result;
        if (result.screenshotPath) {
          lastScreenshotPath = result.screenshotPath;
          actionRecord.screenshotPath = result.screenshotPath;
        }
        await logAction(runDir, actionRecord);
        consecutiveFailures = 0;
        emit({
          type: 'step',
          step,
          action,
          result: { ok: true, terminal: result.terminal, reason: result.reason, screenshotPath: result.screenshotPath },
          url: snap.url,
        });

        if (result.terminal) {
          terminalReason = result.reason;
          if (action.type === 'done') modelSaidDone = true;
          break;
        }
      } catch (err) {
        console.warn('action failed:', err.message);
        consecutiveFailures += 1;
        actionRecord.error = err.message;
        await logAction(runDir, actionRecord);
        emit({ type: 'step', step, action, result: { ok: false, error: err.message }, url: snap.url });
        history.push({ error: err.message });
      }

      const after = await snapshot(page);
      finalSnap = after;
      postActionStates.push(after);
      if (postActionStates.length > STUCK_WINDOW) postActionStates.shift();
    }

    if (!terminalReason) {
      terminalReason = `max steps reached (${maxSteps})`;
    }

    try {
      const finalShot = join(runDir, 'screenshots', 'final.png');
      await takeScreenshot(page, finalShot);
      lastScreenshotPath = finalShot;
    } catch {
      // ignore
    }

    if (!finalSnap) {
      finalSnap = await snapshot(page).catch(() => ({ url: page.url(), title: '', nodes: [] }));
    }

    console.log('\n=== done-check ===');
    const doneCheck = await checkDone({
      task,
      snapshot: finalSnap,
      history,
      terminalReason,
      screenshotPath: lastScreenshotPath,
    });
    if (doneCheck.usage) addUsage(cost, doneCheck.usage);
    console.log('done-check:', { achieved: doneCheck.achieved, why: doneCheck.why });

    const success = Boolean(doneCheck.achieved);

    const final = {
      terminalReason,
      success,
      modelSaidDone,
      stepCount,
      visionUsed,
      visionModel: visionUsed ? VISION_MODEL : null,
      doneCheck: {
        achieved: doneCheck.achieved,
        why: doneCheck.why,
        error: doneCheck.error,
      },
      finalUrl: finalSnap?.url ?? null,
      finalTitle: finalSnap?.title ?? null,
      finalNodes: (finalSnap?.nodes || []).slice(0, 80),
      screenshotPath: lastScreenshotPath,
      runDir,
      cost: { ...cost, estimated_usd: estimateCostUsd(cost) },
      structuredOutput: structuredOutputMode(),
      model: getModelName(),
      prompt_version: promptVersion,
      guardrails: guardrailSnapshot(),
    };
    await writeFile(join(runDir, 'final.json'), JSON.stringify(final, null, 2), 'utf8');

    console.log('\n=== finished ===');
    console.log('reason:', terminalReason);
    console.log('success:', success);
    console.log(
      `cost: steps=${cost.steps} latency_ms=${cost.latency_ms} tokens=${cost.prompt_tokens}/${cost.completion_tokens}`,
    );
    console.log('run dir:', runDir);
    emit({
      type: 'done',
      success,
      terminalReason,
      finalUrl: final.finalUrl,
      finalTitle: final.finalTitle,
      stepCount,
      cost,
      runDir,
      doneCheck: final.doneCheck,
    });
    return final;
  } finally {
    await browser.close();
  }
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
  const url = process.argv[2] ?? 'https://example.com';
  const task = process.argv[3] ?? 'Explore the page and report what you find.';
  run({ url, task }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
