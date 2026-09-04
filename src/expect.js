/**
 * Deterministic expectation checks against final.json (+ embedded finalNodes).
 * Avoids flaky vision; optional success flag from done-check.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function loadFinal(runDir) {
  const raw = await readFile(join(runDir, 'final.json'), 'utf8');
  return JSON.parse(raw);
}

/**
 * @param {object} final - final.json contents
 * @param {object} expect - expectation object from task def
 * @returns {{ pass: boolean, checks: Array<{name:string, pass:boolean, detail:string}> }}
 */
export function evaluateExpect(final, expect = {}) {
  const checks = [];
  const url = final.finalUrl || '';
  const title = final.finalTitle || '';
  const nodes = final.finalNodes || [];
  const nodeBlob = nodes
    .map((n) => `${n.role}|${n.name}|${n.value ?? ''}`)
    .join('\n')
    .toLowerCase();

  function add(name, pass, detail) {
    checks.push({ name, pass: Boolean(pass), detail: String(detail ?? '') });
  }

  if (expect.urlContains != null) {
    const want = String(expect.urlContains);
    add('urlContains', url.toLowerCase().includes(want.toLowerCase()), `url=${url} want~=${want}`);
  }
  if (expect.urlNotContains != null) {
    const want = String(expect.urlNotContains);
    add('urlNotContains', !url.toLowerCase().includes(want.toLowerCase()), `url=${url} forbid~=${want}`);
  }
  if (expect.urlMatches != null) {
    const re = new RegExp(expect.urlMatches, 'i');
    add('urlMatches', re.test(url), `url=${url} re=${expect.urlMatches}`);
  }
  if (expect.titleContains != null) {
    const want = String(expect.titleContains);
    add('titleContains', title.toLowerCase().includes(want.toLowerCase()), `title=${title} want~=${want}`);
  }
  if (expect.nodeNameIncludes != null) {
    const want = String(expect.nodeNameIncludes).toLowerCase();
    const hit = nodes.some((n) => String(n.name || '').toLowerCase().includes(want));
    add('nodeNameIncludes', hit, `want name~=${want}`);
  }
  if (expect.nodeValueIncludes != null) {
    const want = String(expect.nodeValueIncludes).toLowerCase();
    const hit = nodes.some((n) => String(n.value || '').toLowerCase().includes(want));
    add('nodeValueIncludes', hit, `want value~=${want}`);
  }
  if (expect.anyNodeTextIncludes != null) {
    const want = String(expect.anyNodeTextIncludes).toLowerCase();
    add('anyNodeTextIncludes', nodeBlob.includes(want), `want~=${want}`);
  }
  if (expect.minDeleteButtons != null) {
    const n = nodes.filter((x) => x.role === 'button' && /^delete$/i.test(x.name || '')).length;
    add('minDeleteButtons', n >= Number(expect.minDeleteButtons), `deleteButtons=${n}`);
  }
  if (expect.minCheckedCheckboxes != null) {
    const n = nodes.filter((x) => x.role === 'checkbox' && /checked=true/i.test(String(x.value || ''))).length;
    add('minCheckedCheckboxes', n >= Number(expect.minCheckedCheckboxes), `checked=${n}`);
  }
  if (expect.comboboxValueIncludes != null) {
    const want = String(expect.comboboxValueIncludes).toLowerCase();
    const combo = nodes.find((n) => n.role === 'combobox');
    const val = String(combo?.value || '').toLowerCase();
    add('comboboxValueIncludes', val.includes(want), `value=${combo?.value}`);
  }
  if (expect.minTextboxesWithValue != null) {
    const n = nodes.filter((x) => x.role === 'textbox' && x.value && String(x.value).trim()).length;
    // For todos, items may appear as other roles; also count checkbox list items loosely
    add('minTextboxesWithValue', n >= Number(expect.minTextboxesWithValue), `filledTextboxes=${n}`);
  }
  if (expect.minListItems != null) {
    // TodoMVC exposes todos as checkboxes or list-ish names in a11y; also count submitted history via success.
    const checksBoxes = nodes.filter((x) => x.role === 'checkbox').length;
    const byName = nodes.filter((x) => /todo|milk|dog|report|phase|item/i.test(x.name || '')).length;
    const n = Math.max(checksBoxes, byName);
    add('minListItems', n >= Number(expect.minListItems), `approxItems=${n}`);
  }
  if (expect.success === true) {
    add('success', final.success === true, `success=${final.success}`);
  }
  if (expect.success === false) {
    add('successFalse', final.success === false, `success=${final.success}`);
  }
  if (expect.modelSaidDone === true) {
    add('modelSaidDone', final.modelSaidDone === true, `modelSaidDone=${final.modelSaidDone}`);
  }

  // If no checks defined, fall back to done-check success
  if (checks.length === 0) {
    add('success', final.success === true, `success=${final.success} (default)`);
  }

  const pass = checks.every((c) => c.pass);
  return { pass, checks };
}
