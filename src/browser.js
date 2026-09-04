import { chromium } from 'playwright';

export async function launch({ headless = false } = {}) {
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  const page = await context.newPage();
  return { browser, context, page };
}

// Flatten the accessibility tree into a numbered list of interactable nodes.
// Each entry gets a stable index the model refers to when picking an action.
// Uses CDP because page.accessibility.snapshot() was removed in recent Playwright.
const INTERACTABLE = new Set([
  'button',
  'link',
  'textbox',
  'combobox',
  'checkbox',
  'radio',
  'menuitem',
  'tab',
  'option',
  'listbox',
  'spinbutton',
  'searchbox',
]);

export async function snapshot(page) {
  const client = await page.context().newCDPSession(page);
  let axNodes;
  try {
    ({ nodes: axNodes } = await client.send('Accessibility.getFullAXTree'));
  } finally {
    await client.detach().catch(() => {});
  }

  const nodes = [];
  const unnamedCount = Object.create(null);
  for (const n of axNodes) {
    const role = n.role?.value;
    if (!role || !INTERACTABLE.has(role)) continue;
    // Keep unnamed interactables (e.g. herokuapp checkboxes/combobox often have empty names).
    let name = (n.name?.value ?? '').trim();
    let value = n.value?.value ?? null;
    const checkedProp = (n.properties || []).find((p) => p.name === 'checked');
    if (checkedProp != null) {
      const cv = checkedProp.value?.value ?? checkedProp.value;
      value = value == null ? `checked=${cv}` : value;
    }
    if (!name) {
      unnamedCount[role] = (unnamedCount[role] || 0) + 1;
      // Synthetic stable name so the model can target nth(role) via locate().
      name = `${role} ${unnamedCount[role]}`;
    }
    nodes.push({ index: nodes.length, role, name, value });
  }

  return {
    url: page.url(),
    title: await page.title().catch(() => ''),
    nodes,
  };
}

async function locate(page, role, name) {
  // Synthetic names from snapshot: "checkbox 1", "combobox 1" -> nth among that role.
  const syn = String(name || '').match(/^(button|link|textbox|combobox|checkbox|radio|menuitem|tab|option|listbox|spinbutton|searchbox)\s+(\d+)$/i);
  if (syn && syn[1].toLowerCase() === String(role).toLowerCase()) {
    const nth = Math.max(0, Number(syn[2]) - 1);
    const byNth = page.getByRole(role).nth(nth);
    if (await byNth.count().catch(() => 0)) return byNth;
  }

  // Unnamed interactables: match by role only (first).
  if (name == null || String(name).trim() === '') {
    const unnamed = page.getByRole(role).first();
    if (await unnamed.count().catch(() => 0)) return unnamed;
    return unnamed;
  }

  const byRole = page.getByRole(role, { name }).first();
  if (await byRole.count().catch(() => 0)) return byRole;

  // Exact accessible-name mismatches (whitespace / hidden ancestors): fall back.
  const byLabel = page.getByLabel(name, { exact: true }).first();
  if (await byLabel.count().catch(() => 0)) return byLabel;

  const byPlaceholder = page.getByPlaceholder(name, { exact: true }).first();
  if (await byPlaceholder.count().catch(() => 0)) return byPlaceholder;

  const byText = page.getByText(name, { exact: true }).first();
  if (await byText.count().catch(() => 0)) return byText;

  // Labels sometimes include a trailing colon/space in the AX name.
  const trimmed = String(name).replace(/[:\s]+$/u, '').trim();
  if (trimmed && trimmed !== name) {
    const byTrim = page.getByRole(role, { name: trimmed }).first();
    if (await byTrim.count().catch(() => 0)) return byTrim;
    const byLabelTrim = page.getByLabel(trimmed, { exact: false }).first();
    if (await byLabelTrim.count().catch(() => 0)) return byLabelTrim;
  }

  // Last resort: substring text match for links/buttons.
  if (role === 'link' || role === 'button') {
    const loose = page.getByRole(role, { name: new RegExp(escapeRegExp(name), 'i') }).first();
    if (await loose.count().catch(() => 0)) return loose;
  }

  return byRole; // let the later click/fill surface the timeout with a clear error
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Save a PNG screenshot. When path is provided, writes there; otherwise returns a Buffer.
 */
export async function takeScreenshot(page, path) {
  if (path) {
    await page.screenshot({ path, fullPage: false });
    return path;
  }
  return page.screenshot({ fullPage: false });
}

// Execute one action returned by the model. Actions are intentionally small.
// opts.runDir: when set, screenshot actions write under runs/<ts>/screenshots/
export async function act(page, action, opts = {}) {
  const { type } = action;
  if (type === 'click') {
    const target = await locate(page, action.role, action.name);
    await target.click({ timeout: 5000 });
  } else if (type === 'type') {
    const target = await locate(page, action.role, action.name);
    await target.fill(action.text ?? '', { timeout: 5000 });
    if (action.submit) await target.press('Enter');
  } else if (type === 'press') {
    if (action.role && action.name) {
      const target = await locate(page, action.role, action.name);
      await target.press(action.key, { timeout: 5000 });
    } else {
      await page.keyboard.press(action.key);
    }
  } else if (type === 'navigate') {
    await page.goto(action.url, { waitUntil: 'domcontentloaded' });
  } else if (type === 'wait') {
    await page.waitForTimeout(Math.min(action.ms ?? 1000, 5000));
  } else if (type === 'scroll') {
    if (action.role && action.name) {
      const target = await locate(page, action.role, action.name);
      await target.scrollIntoViewIfNeeded({ timeout: 5000 });
    } else {
      const direction = (action.direction || 'down').toLowerCase();
      const amount = Math.min(Math.max(Number(action.amount) || 600, 50), 3000);
      const dx = direction === 'left' ? -amount : direction === 'right' ? amount : 0;
      const dy = direction === 'up' ? -amount : direction === 'down' ? amount : amount;
      await page.mouse.wheel(dx, dy);
    }
  } else if (type === 'select_option') {
    const target = await locate(page, action.role || 'combobox', action.name);
    const value = action.value ?? action.option ?? action.label;
    if (value == null) throw new Error('select_option requires value/option/label');
    // Prefer accessible label; fall back to value attribute.
    try {
      await target.selectOption({ label: String(value) }, { timeout: 5000 });
    } catch {
      await target.selectOption({ value: String(value) }, { timeout: 5000 });
    }
  } else if (type === 'hover') {
    const target = await locate(page, action.role, action.name);
    await target.hover({ timeout: 5000 });
  } else if (type === 'back') {
    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(async () => {
      await page.waitForTimeout(200);
    });
  } else if (type === 'screenshot') {
    const { mkdir } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const runDir = opts.runDir;
    if (!runDir) throw new Error('screenshot action requires runDir');
    const shotDir = join(runDir, 'screenshots');
    await mkdir(shotDir, { recursive: true });
    const name = action.filename || `manual-${Date.now()}.png`;
    const path = join(shotDir, name.replace(/[^a-zA-Z0-9._-]/g, '_'));
    await takeScreenshot(page, path);
    return { terminal: false, screenshotPath: path };
  } else if (type === 'done' || type === 'stuck') {
    return { terminal: true, reason: action.reason ?? type };
  } else {
    throw new Error(`Unknown action type: ${type}`);
  }
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  // Give SPAs a beat to update the a11y tree after Enter/submit.
  await page.waitForTimeout(150).catch(() => {});
  return { terminal: false };
}
