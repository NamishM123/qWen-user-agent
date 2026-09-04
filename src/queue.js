/**
 * Task queue for Phase 2/3.
 * Prefers better-sqlite3; falls back to sql.js (WASM).
 * When DATABASE_URL is set, uses Postgres (Neon-ready).
 * Phase 3: user_id + task_events for live streaming / history.
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DB = join(REPO_ROOT, 'data', 'tasks.db');

let impl = null; // 'better-sqlite3' | 'sql.js' | 'postgres'
let db = null;
let SQL = null;
let dbPath = DEFAULT_DB;
let pgPool = null;

async function loadBetterSqlite3() {
  try {
    const mod = await import('better-sqlite3');
    return mod.default || mod;
  } catch {
    return null;
  }
}

async function loadSqlJs() {
  const mod = await import('sql.js');
  const initSqlJs = mod.default || mod;
  return initSqlJs({});
}

async function loadPg() {
  try {
    const mod = await import('pg');
    return mod.default || mod;
  } catch {
    return null;
  }
}

function ensureSchemaBetter(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      task TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','running','done','failed')),
      result TEXT,
      run_dir TEXT,
      expect TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const cols = database.prepare(`PRAGMA table_info(tasks)`).all().map((c) => c.name);
  if (!cols.includes('user_id')) {
    database.exec(`ALTER TABLE tasks ADD COLUMN user_id TEXT`);
  }
  if (!cols.includes('prompt_version')) {
    database.exec(`ALTER TABLE tasks ADD COLUMN prompt_version TEXT`);
  }
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);
    CREATE TABLE IF NOT EXISTS task_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      ts TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_events_task ON task_events(task_id);
  `);
}

function ensureSchemaSqlJs(database) {
  database.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      task TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      result TEXT,
      run_dir TEXT,
      expect TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  try {
    database.run(`ALTER TABLE tasks ADD COLUMN user_id TEXT`);
  } catch {
    // already exists
  }
  try {
    database.run(`ALTER TABLE tasks ADD COLUMN prompt_version TEXT`);
  } catch {
    // already exists
  }
  database.run(`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);`);
  database.run(`
    CREATE TABLE IF NOT EXISTS task_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      ts TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT
    );
  `);
  database.run(`CREATE INDEX IF NOT EXISTS idx_events_task ON task_events(task_id);`);
}

async function ensureSchemaPostgres(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      url TEXT NOT NULL,
      task TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','running','done','failed')),
      result TEXT,
      run_dir TEXT,
      expect TEXT,
      user_id TEXT,
      prompt_version TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS prompt_version TEXT;
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);
    CREATE TABLE IF NOT EXISTS task_events (
      id SERIAL PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      type TEXT NOT NULL,
      payload TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_events_task ON task_events(task_id);
  `);
}

function persistSqlJs() {
  if (impl !== 'sql.js' || !db) return;
  const data = db.export();
  writeFileSync(dbPath, Buffer.from(data));
}

export async function openQueue(path = DEFAULT_DB) {
  const pgUrl = process.env.DATABASE_URL || '';
  if (pgUrl) {
    const pg = await loadPg();
    if (!pg) throw new Error('Install pg to use DATABASE_URL');
    impl = 'postgres';
    pgPool = new pg.Pool({ connectionString: pgUrl });
    const client = await pgPool.connect();
    try { await ensureSchemaPostgres(client); }
    finally { client.release(); }
    return { impl, path: 'postgres' };
  }
  dbPath = path;
  mkdirSync(dirname(dbPath), { recursive: true });
  const Better = await loadBetterSqlite3();
  if (Better) {
    impl = 'better-sqlite3';
    db = new Better(dbPath);
    db.pragma('journal_mode = WAL');
    ensureSchemaBetter(db);
    return { impl, path: dbPath };
  }
  SQL = await loadSqlJs();
  impl = 'sql.js';
  db = existsSync(dbPath) ? new SQL.Database(readFileSync(dbPath)) : new SQL.Database();
  ensureSchemaSqlJs(db);
  persistSqlJs();
  return { impl, path: dbPath };
}

export function syncFromDisk() {
  if (impl !== 'sql.js' || !SQL) return;
  if (!existsSync(dbPath)) return;
  if (db) db.close();
  db = new SQL.Database(readFileSync(dbPath));
}

function nowIso() { return new Date().toISOString(); }

function safeJson(s) {
  try { return JSON.parse(s); } catch { return s; }
}

function rowFromDb(r) {
  if (!r) return null;
  return {
    ...r,
    id: Number(r.id),
    expect: r.expect ? safeJson(r.expect) : null,
    result: r.result ? safeJson(r.result) : null,
    user_id: r.user_id ?? null,
    prompt_version: r.prompt_version ?? null,
  };
}

export function enqueue({ url, task, expect = null, user_id = null, prompt_version = null }) {
  if (impl === 'postgres') throw new Error('Use enqueueAsync for postgres');
  if (!db) throw new Error('openQueue() first');
  const created = nowIso();
  const expectStr = expect == null ? null : typeof expect === 'string' ? expect : JSON.stringify(expect);
  if (impl === 'better-sqlite3') {
    const info = db.prepare(
      `INSERT INTO tasks (url, task, status, result, run_dir, expect, user_id, prompt_version, created_at, updated_at)
       VALUES (?, ?, 'pending', NULL, NULL, ?, ?, ?, ?, ?)`,
    ).run(url, task, expectStr, user_id, prompt_version, created, created);
    return Number(info.lastInsertRowid);
  }
  db.run(
    `INSERT INTO tasks (url, task, status, result, run_dir, expect, user_id, prompt_version, created_at, updated_at)
     VALUES (?, ?, 'pending', NULL, NULL, ?, ?, ?, ?, ?)`,
    [url, task, expectStr, user_id, prompt_version, created, created],
  );
  const res = db.exec('SELECT last_insert_rowid() AS id');
  persistSqlJs();
  return Number(res[0].values[0][0]);
}

export async function enqueueAsync(opts) {
  if (impl !== 'postgres') return enqueue(opts);
  const { url, task, expect = null, user_id = null, prompt_version = null } = opts;
  const expectStr = expect == null ? null : typeof expect === 'string' ? expect : JSON.stringify(expect);
  const res = await pgPool.query(
    `INSERT INTO tasks (url, task, status, result, run_dir, expect, user_id, prompt_version, created_at, updated_at)
     VALUES ($1, $2, 'pending', NULL, NULL, $3, $4, $5, NOW(), NOW()) RETURNING id`,
    [url, task, expectStr, user_id, prompt_version],
  );
  return Number(res.rows[0].id);
}

export function getTask(id) {
  if (impl === 'postgres') throw new Error('Use getTaskAsync for postgres');
  if (impl === 'better-sqlite3') {
    return rowFromDb(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id));
  }
  const stmt = db.prepare('SELECT * FROM tasks WHERE id = ?');
  stmt.bind([id]);
  if (!stmt.step()) { stmt.free(); return null; }
  const obj = stmt.getAsObject();
  stmt.free();
  return rowFromDb(obj);
}

export async function getTaskAsync(id) {
  if (impl !== 'postgres') return getTask(id);
  const res = await pgPool.query('SELECT * FROM tasks WHERE id = $1', [id]);
  return rowFromDb(res.rows[0] || null);
}

export function listTasks({ status = null, limit = 50, user_id = null } = {}) {
  if (impl === 'postgres') throw new Error('Use listTasksAsync for postgres');
  if (impl === 'better-sqlite3') {
    if (user_id && status) {
      return db.prepare('SELECT * FROM tasks WHERE user_id = ? AND status = ? ORDER BY id DESC LIMIT ?')
        .all(user_id, status, limit).map(rowFromDb);
    }
    if (user_id) {
      return db.prepare('SELECT * FROM tasks WHERE user_id = ? ORDER BY id DESC LIMIT ?')
        .all(user_id, limit).map(rowFromDb);
    }
    if (status) {
      return db.prepare('SELECT * FROM tasks WHERE status = ? ORDER BY id ASC LIMIT ?')
        .all(status, limit).map(rowFromDb);
    }
    return db.prepare('SELECT * FROM tasks ORDER BY id DESC LIMIT ?').all(limit).map(rowFromDb);
  }
  const rows = [];
  let sql = 'SELECT * FROM tasks';
  const where = [];
  if (user_id) where.push(`user_id = '${String(user_id).replace(/'/g, "''")}'`);
  if (status) where.push(`status = '${String(status).replace(/'/g, "''")}'`);
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  sql += status && !user_id ? ' ORDER BY id ASC' : ' ORDER BY id DESC';
  sql += ` LIMIT ${Number(limit) || 50}`;
  const res = db.exec(sql);
  if (!res[0]) return rows;
  const cols = res[0].columns;
  for (const values of res[0].values) {
    const obj = {};
    cols.forEach((c, i) => { obj[c] = values[i]; });
    rows.push(rowFromDb(obj));
  }
  return rows;
}

export async function listTasksAsync(opts = {}) {
  if (impl !== 'postgres') return listTasks(opts);
  const { status = null, limit = 50, user_id = null } = opts;
  const params = [];
  const where = [];
  if (user_id) { params.push(user_id); where.push(`user_id = $${params.length}`); }
  if (status) { params.push(status); where.push(`status = $${params.length}`); }
  params.push(limit);
  const order = status && !user_id ? 'ASC' : 'DESC';
  const sql = `SELECT * FROM tasks${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY id ${order} LIMIT $${params.length}`;
  const res = await pgPool.query(sql, params);
  return res.rows.map(rowFromDb);
}

export function claimNext() {
  if (impl === 'postgres') throw new Error('Use claimNextAsync for postgres');
  if (impl === 'sql.js') syncFromDisk();
  const updated = nowIso();
  if (impl === 'better-sqlite3') {
    // BEGIN IMMEDIATE serializes multi-process workers under WAL
    const claim = db.transaction(() => {
      const row = db.prepare(`SELECT * FROM tasks WHERE status = 'pending' ORDER BY id ASC LIMIT 1`).get();
      if (!row) return null;
      const info = db.prepare(
        `UPDATE tasks SET status = 'running', updated_at = ? WHERE id = ? AND status = 'pending'`,
      ).run(updated, row.id);
      if (!info.changes) return null; // lost race
      return rowFromDb(db.prepare('SELECT * FROM tasks WHERE id = ?').get(row.id));
    });
    return claim.immediate();
  }
  // sql.js: best-effort atomicity via re-read + conditional update + persist
  const pending = listTasks({ status: 'pending', limit: 1 })[0];
  if (!pending) return null;
  db.run(
    `UPDATE tasks SET status = 'running', updated_at = ? WHERE id = ? AND status = 'pending'`,
    [updated, pending.id],
  );
  persistSqlJs();
  const got = getTask(pending.id);
  if (!got || got.status !== 'running') return null;
  return got;
}

export async function claimNextAsync() {
  if (impl !== 'postgres') return claimNext();
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    const sel = await client.query(
      `SELECT * FROM tasks WHERE status = 'pending' ORDER BY id ASC LIMIT 1 FOR UPDATE SKIP LOCKED`,
    );
    if (!sel.rows[0]) { await client.query('COMMIT'); return null; }
    const id = sel.rows[0].id;
    await client.query(`UPDATE tasks SET status = 'running', updated_at = NOW() WHERE id = $1`, [id]);
    const again = await client.query('SELECT * FROM tasks WHERE id = $1', [id]);
    await client.query('COMMIT');
    return rowFromDb(again.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export function completeTask(id, { status, result = null, run_dir = null }) {
  if (impl === 'postgres') throw new Error('Use completeTaskAsync for postgres');
  if (!['done', 'failed'].includes(status)) throw new Error('status must be done|failed');
  const updated = nowIso();
  const resultStr = result == null ? null : typeof result === 'string' ? result : JSON.stringify(result);
  if (impl === 'better-sqlite3') {
    db.prepare(`UPDATE tasks SET status = ?, result = ?, run_dir = ?, updated_at = ? WHERE id = ?`)
      .run(status, resultStr, run_dir, updated, id);
    return getTask(id);
  }
  db.run(`UPDATE tasks SET status = ?, result = ?, run_dir = ?, updated_at = ? WHERE id = ?`,
    [status, resultStr, run_dir, updated, id]);
  persistSqlJs();
  return getTask(id);
}

export async function completeTaskAsync(id, opts) {
  if (impl !== 'postgres') return completeTask(id, opts);
  const { status, result = null, run_dir = null } = opts;
  if (!['done', 'failed'].includes(status)) throw new Error('status must be done|failed');
  const resultStr = result == null ? null : typeof result === 'string' ? result : JSON.stringify(result);
  await pgPool.query(
    `UPDATE tasks SET status = $1, result = $2, run_dir = $3, updated_at = NOW() WHERE id = $4`,
    [status, resultStr, run_dir, id],
  );
  return getTaskAsync(id);
}

export function appendEvent(taskId, event) {
  if (impl === 'postgres') throw new Error('Use appendEventAsync for postgres');
  const ts = event.ts || nowIso();
  const type = event.type || 'message';
  const payload = JSON.stringify(event);
  if (impl === 'better-sqlite3') {
    const info = db.prepare(`INSERT INTO task_events (task_id, ts, type, payload) VALUES (?, ?, ?, ?)`)
      .run(taskId, ts, type, payload);
    return Number(info.lastInsertRowid);
  }
  db.run(`INSERT INTO task_events (task_id, ts, type, payload) VALUES (?, ?, ?, ?)`, [taskId, ts, type, payload]);
  persistSqlJs();
  const res = db.exec('SELECT last_insert_rowid() AS id');
  return Number(res[0].values[0][0]);
}

export async function appendEventAsync(taskId, event) {
  if (impl !== 'postgres') return appendEvent(taskId, event);
  const ts = event.ts || nowIso();
  const type = event.type || 'message';
  const payload = JSON.stringify(event);
  const res = await pgPool.query(
    `INSERT INTO task_events (task_id, ts, type, payload) VALUES ($1, $2, $3, $4) RETURNING id`,
    [taskId, ts, type, payload],
  );
  return Number(res.rows[0].id);
}

export function listEvents(taskId, { afterId = 0, limit = 500 } = {}) {
  if (impl === 'postgres') throw new Error('Use listEventsAsync for postgres');
  if (impl === 'sql.js') syncFromDisk();
  if (impl === 'better-sqlite3') {
    return db.prepare(
      `SELECT id, task_id, ts, type, payload FROM task_events
       WHERE task_id = ? AND id > ? ORDER BY id ASC LIMIT ?`,
    ).all(taskId, afterId, limit).map((r) => ({
      id: Number(r.id), task_id: Number(r.task_id), ts: r.ts, type: r.type, payload: safeJson(r.payload),
    }));
  }
  const res = db.exec(
    `SELECT id, task_id, ts, type, payload FROM task_events
     WHERE task_id = ${Number(taskId)} AND id > ${Number(afterId)}
     ORDER BY id ASC LIMIT ${Number(limit) || 500}`,
  );
  if (!res[0]) return [];
  const cols = res[0].columns;
  return res[0].values.map((values) => {
    const obj = {};
    cols.forEach((c, i) => { obj[c] = values[i]; });
    return {
      id: Number(obj.id), task_id: Number(obj.task_id), ts: obj.ts, type: obj.type, payload: safeJson(obj.payload),
    };
  });
}

export async function listEventsAsync(taskId, opts = {}) {
  if (impl !== 'postgres') return listEvents(taskId, opts);
  const { afterId = 0, limit = 500 } = opts;
  const res = await pgPool.query(
    `SELECT id, task_id, ts, type, payload FROM task_events
     WHERE task_id = $1 AND id > $2 ORDER BY id ASC LIMIT $3`,
    [taskId, afterId, limit],
  );
  return res.rows.map((r) => ({
    id: Number(r.id),
    task_id: Number(r.task_id),
    ts: r.ts instanceof Date ? r.ts.toISOString() : r.ts,
    type: r.type,
    payload: safeJson(r.payload),
  }));
}

export function countRecentTasks({ user_id, sinceIso }) {
  if (impl === 'postgres') throw new Error('Use countRecentTasksAsync for postgres');
  if (!user_id) return 0;
  if (impl === 'better-sqlite3') {
    const row = db.prepare(
      `SELECT COUNT(*) AS n FROM tasks WHERE user_id = ? AND created_at >= ?`,
    ).get(user_id, sinceIso);
    return Number(row?.n || 0);
  }
  if (impl === 'sql.js') syncFromDisk();
  const uid = String(user_id).replace(/'/g, "''");
  const since = String(sinceIso).replace(/'/g, "''");
  const res = db.exec(
    `SELECT COUNT(*) AS n FROM tasks WHERE user_id = '${uid}' AND created_at >= '${since}'`,
  );
  if (!res[0]) return 0;
  return Number(res[0].values[0][0] || 0);
}

export async function countRecentTasksAsync({ user_id, sinceIso }) {
  if (impl !== 'postgres') return countRecentTasks({ user_id, sinceIso });
  if (!user_id) return 0;
  const res = await pgPool.query(
    `SELECT COUNT(*)::int AS n FROM tasks WHERE user_id = $1 AND created_at >= $2::timestamptz`,
    [user_id, sinceIso],
  );
  return Number(res.rows[0]?.n || 0);
}

export function closeQueue() {
  if (impl === 'postgres') {
    if (pgPool) { pgPool.end().catch(() => {}); pgPool = null; }
    return;
  }
  if (!db) return;
  if (impl === 'better-sqlite3') db.close();
  else { persistSqlJs(); db.close(); }
  db = null;
}

export function queueImpl() { return impl; }
export function isPostgres() { return impl === 'postgres'; }
