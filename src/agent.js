import { launch, snapshot, act } from './browser.js';
import { nextAction } from './qwen.js';

const MAX_STEPS = 25;
const STUCK_WINDOW = 3;

function sameState(a, b) {
  if (!a || !b) return false;
  if (a.url !== b.url) return false;
  if (a.nodes.length !== b.nodes.length) return false;
  return a.nodes.every((n, i) => n.role === b.nodes[i].role && n.name === b.nodes[i].name);
}

async function run({ url, task }) {
  const { browser, page } = await launch({ headless: false });
  const history = [];
  const stateWindow = [];
  let terminalReason = null;

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    for (let step = 1; step <= MAX_STEPS; step++) {
      const snap = await snapshot(page);
      stateWindow.push(snap);
      if (stateWindow.length > STUCK_WINDOW) stateWindow.shift();

      if (stateWindow.length === STUCK_WINDOW && stateWindow.every((s) => sameState(s, stateWindow[0]))) {
        terminalReason = 'stuck: page state unchanged after 3 attempts';
        break;
      }

      console.log(`\n--- step ${step} @ ${snap.url} (${snap.nodes.length} elements) ---`);

      let action;
      try {
        action = await nextAction({ task, snapshot: snap, history });
      } catch (err) {
        console.error('model error:', err.message);
        terminalReason = `model error: ${err.message}`;
        break;
      }
      console.log('action:', action);
      history.push(action);

      try {
        const result = await act(page, action);
        if (result.terminal) {
          terminalReason = result.reason;
          break;
        }
      } catch (err) {
        console.warn('action failed:', err.message);
        history.push({ error: err.message });
      }
    }

    console.log('\n=== finished ===');
    console.log('reason:', terminalReason ?? 'max steps reached');
  } finally {
    await browser.close();
  }
}

const url = process.argv[2] ?? 'https://example.com';
const task = process.argv[3] ?? 'Explore the page and report what you find.';
run({ url, task }).catch((err) => {
  console.error(err);
  process.exit(1);
});
