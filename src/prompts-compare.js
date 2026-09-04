#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

async function walkFinals(root) {
  const out = [];
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(root, e.name);
    if (!e.isDirectory() || e.name === "eval" || e.name === "node_modules") continue;
    const finalPath = join(p, "final.json");
    try {
      await stat(finalPath);
      const raw = JSON.parse(await readFile(finalPath, "utf8"));
      out.push({
        source: "run",
        runDir: p,
        prompt_version: raw.prompt_version || "unknown",
        success: Boolean(raw.success),
        terminalReason: raw.terminalReason,
      });
    } catch {}
  }
  return out;
}

async function loadEvalSummaries(evalDir) {
  const out = [];
  let files;
  try {
    files = (await readdir(evalDir)).filter((f) => f.startsWith("summary-") && f.endsWith(".json"));
  } catch { return out; }
  for (const f of files) {
    try {
      const summary = JSON.parse(await readFile(join(evalDir, f), "utf8"));
      for (const r of summary.results || []) {
        out.push({
          source: "eval",
          id: r.id,
          prompt_version: r.prompt_version || summary.prompt_version || "unknown",
          success: Boolean(r.pass ?? r.success),
          terminalReason: r.terminalReason,
        });
      }
    } catch {}
  }
  return out;
}

function group(rows) {
  const g = {};
  for (const r of rows) {
    const v = r.prompt_version || "unknown";
    if (!g[v]) g[v] = { total: 0, pass: 0, fail: 0 };
    g[v].total += 1;
    if (r.success) g[v].pass += 1;
    else g[v].fail += 1;
  }
  return g;
}

async function main() {
  const runsDir = join(process.cwd(), "runs");
  const rows = [...(await walkFinals(runsDir)), ...(await loadEvalSummaries(join(runsDir, "eval")))];
  console.log("prompt_version comparison — " + rows.length + " samples");
  if (!rows.length) {
    console.log("No runs with final.json found.");
    return;
  }
  const g = group(rows);
  const versions = Object.keys(g).sort();
  console.log("version\tpass\tfail\ttotal\trate");
  for (const v of versions) {
    const s = g[v];
    const rate = s.total ? ((s.pass / s.total) * 100).toFixed(1) : "0.0";
    console.log(v + "\t" + s.pass + "\t" + s.fail + "\t" + s.total + "\t" + rate + "%");
  }
  if (versions.length < 2) {
    console.log("Tip: set PROMPT_VERSION=v2 and re-run eval to compare.");
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
