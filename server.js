// Simple Express + SQLite (better-sqlite3) server for a dark-mode task manager
// Hard-coded feature flag to enable/disable time tracking without removing code
const ENABLE_TIME_TRACKING = false;
const path = require('path');
const fs = require('fs');
const express = require('express');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Init DB
const dbPath = path.join(dataDir, 'taskmanager.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS time_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  start_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  end_at DATETIME,
  duration_seconds INTEGER,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS daily_plan_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_date TEXT NOT NULL, /* YYYY-MM-DD in local user timezone */
  content TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_daily_plan_date_position ON daily_plan_items(plan_date, position);
`);

// Lightweight migration for new status / updated_at / desired_outcome columns
try {
  const cols = db.prepare("PRAGMA table_info(tasks)").all().map(c => c.name);
  if (!cols.includes('closed_at')) {
    db.prepare('ALTER TABLE tasks ADD COLUMN closed_at DATETIME').run();
  }
  if (!cols.includes('waiting_since')) {
    db.prepare('ALTER TABLE tasks ADD COLUMN waiting_since DATETIME').run();
  }
  if (!cols.includes('updated_at')) {
    db.prepare('ALTER TABLE tasks ADD COLUMN updated_at DATETIME').run();
    // Backfill
    db.prepare('UPDATE tasks SET updated_at = created_at WHERE updated_at IS NULL').run();
  }
  if (!cols.includes('desired_outcome')) {
    db.prepare('ALTER TABLE tasks ADD COLUMN desired_outcome TEXT').run();
  }
} catch (e) {
  console.error('Migration error:', e);
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helpers
const MAX_UPDATE_LENGTH = 65536; // Match GitHub style comment limit
const rowToTask = (row) => ({ id: row.id, title: row.title, desired_outcome: row.desired_outcome || null, created_at: row.created_at, closed_at: row.closed_at || null, waiting_since: row.waiting_since || null, updated_at: row.updated_at || null });
function bumpTaskUpdated(id){
  db.prepare('UPDATE tasks SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
}
const rowToUpdate = (row) => ({ id: row.id, task_id: row.task_id, content: row.content, created_at: row.created_at });
const rowToTimeEntry = (row) => ({ id: row.id, task_id: row.task_id, start_at: row.start_at, end_at: row.end_at, duration_seconds: row.duration_seconds, running: !row.end_at });
const rowToPlanItem = (row) => ({ id: row.id, plan_date: row.plan_date, content: row.content, done: !!row.done, position: row.position, created_at: row.created_at, updated_at: row.updated_at });

// ---- Daily Plan Helpers ----
function validatePlanDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  return true;
}
function nextPlanPosition(planDate){
  const row = db.prepare('SELECT COALESCE(MAX(position), -1) AS maxp FROM daily_plan_items WHERE plan_date = ?').get(planDate);
  return (row.maxp || 0) + 1;
}


// Routes
// Get all tasks with latest update content preview
app.get('/api/tasks', (req, res) => {
  const tasks = db.prepare(`
    SELECT id, title, desired_outcome, created_at, closed_at, waiting_since, updated_at
    FROM tasks
    ORDER BY COALESCE(updated_at, created_at) DESC, id DESC
  `).all();
  const latestStmt = db.prepare(`
    SELECT content, created_at FROM updates WHERE task_id = ? ORDER BY created_at DESC, id DESC LIMIT 1
  `);
  const withPreview = tasks.map((t) => {
    const latest = latestStmt.get(t.id);
    return { ...rowToTask(t), latest_update: latest ? latest.content : null, latest_at: latest ? latest.created_at : null };
  });
  res.json(withPreview);
});

// Create task
app.post('/api/tasks', (req, res) => {
  const { title } = req.body || {};
  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'Title is required' });
  }
  const info = db.prepare('INSERT INTO tasks (title, updated_at) VALUES (?, CURRENT_TIMESTAMP)').run(title.trim());
  const task = db.prepare('SELECT id, title, desired_outcome, created_at, closed_at, waiting_since, updated_at FROM tasks WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(rowToTask(task));
});

// Get updates for task (latest first)
app.get('/api/tasks/:id/updates', (req, res) => {
  const id = Number(req.params.id);
  const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const updates = db.prepare('SELECT * FROM updates WHERE task_id = ?').all(id).map(r => ({ type: 'update', ...rowToUpdate(r) }));
  let times = [];
  if (ENABLE_TIME_TRACKING) {
    times = db.prepare('SELECT * FROM time_entries WHERE task_id = ?').all(id).map(r => ({ type: 'time', ...rowToTimeEntry(r), created_at: r.end_at || r.start_at }));
  }
  const combined = ENABLE_TIME_TRACKING ? [...updates, ...times] : updates;
  combined.sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime() || (b.id - a.id));
  res.json(combined);
});

// Start time tracking for a task (if not already running)
app.post('/api/tasks/:id/time/start', (req, res) => {
  if (!ENABLE_TIME_TRACKING) return res.status(404).json({ error: 'Time tracking disabled' });
  const id = Number(req.params.id);
  const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const existing = db.prepare('SELECT * FROM time_entries WHERE task_id = ? AND end_at IS NULL').get(id);
  if (existing) {
    return res.status(200).json({ type: 'time', ...rowToTimeEntry(existing), created_at: existing.start_at });
  }
  const startISO = new Date().toISOString();
  const info = db.prepare('INSERT INTO time_entries (task_id, start_at) VALUES (?, ?)').run(id, startISO);
  const entry = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ type: 'time', ...rowToTimeEntry(entry), created_at: entry.start_at });
});

// Stop currently running time tracking
app.post('/api/tasks/:id/time/stop', (req, res) => {
  if (!ENABLE_TIME_TRACKING) return res.status(404).json({ error: 'Time tracking disabled' });
  const id = Number(req.params.id);
  const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const running = db.prepare('SELECT * FROM time_entries WHERE task_id = ? AND end_at IS NULL').get(id);
  if (!running) return res.status(404).json({ error: 'No active timer' });
  const end = new Date().toISOString();
  const parseDb = (s) => {
    if (!s) return null;
    if (/T.*(Z|[+-]\d\d:?\d\d)$/.test(s)) return new Date(s);
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return new Date(s.replace(' ', 'T') + 'Z');
    return new Date(s);
  };
  const startDate = parseDb(running.start_at);
  const endDate = parseDb(end);
  const duration = Math.floor((endDate.getTime() - startDate.getTime())/1000);
  db.prepare('UPDATE time_entries SET end_at = ?, duration_seconds = ? WHERE id = ?').run(end, duration, running.id);
  const entry = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(running.id);
  res.json({ type: 'time', ...rowToTimeEntry(entry), created_at: entry.end_at });
});

// Delete a time entry
app.delete('/api/time_entries/:id', (req, res) => {
  if (!ENABLE_TIME_TRACKING) return res.status(404).json({ error: 'Time tracking disabled' });
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM time_entries WHERE id = ?').run(id);
  res.json({ ok: true });
});

// Trim time off the end of a completed time entry (default 15m)
app.post('/api/time_entries/:id/trim', (req, res) => {
  if (!ENABLE_TIME_TRACKING) return res.status(404).json({ error: 'Time tracking disabled' });
  const id = Number(req.params.id);
  const entry = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(id);
  if (!entry) return res.status(404).json({ error: 'Not found' });
  if (!entry.end_at) return res.status(400).json({ error: 'Cannot trim a running time entry' });
  const seconds = Number(req.body && req.body.seconds) || 900; // default 15m
  if (seconds <= 0) return res.status(400).json({ error: 'seconds must be > 0' });
  const parseDb = (s) => {
    if (!s) return null;
    if (/T.*(Z|[+-]\d\d:?\d\d)$/.test(s)) return new Date(s);
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return new Date(s.replace(' ', 'T') + 'Z');
    return new Date(s);
  };
  const startDate = parseDb(entry.start_at);
  const endDate = parseDb(entry.end_at);
  if (!startDate || !endDate) return res.status(500).json({ error: 'Corrupt timestamps' });
  let newEndMs = endDate.getTime() - seconds * 1000;
  if (newEndMs < startDate.getTime()) newEndMs = startDate.getTime();
  const newEnd = new Date(newEndMs).toISOString();
  const newDuration = Math.floor((newEndMs - startDate.getTime()) / 1000);
  db.prepare('UPDATE time_entries SET end_at = ?, duration_seconds = ? WHERE id = ?').run(newEnd, newDuration, id);
  const updated = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(id);
  res.json({ type: 'time', ...rowToTimeEntry(updated), created_at: updated.end_at });
});

// Daily summary (current day in server local time)
app.get('/api/time_entries/summary/today', (req, res) => {
  if (!ENABLE_TIME_TRACKING) return res.json({ total_seconds: 0 });
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 86400000);
  const startISO = startOfDay.toISOString();
  const endISO = endOfDay.toISOString();
  const candidates = db.prepare('SELECT * FROM time_entries WHERE start_at < ? AND (end_at IS NULL OR end_at > ?)').all(endISO, startISO);
  const parseDb = (s) => {
    if (!s) return null;
    if (/T.*(Z|[+-]\d\d:?\d\d)$/.test(s)) return new Date(s);
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return new Date(s.replace(' ', 'T') + 'Z');
    return new Date(s);
  };
  let total = 0;
  for (const e of candidates){
    const s = parseDb(e.start_at);
    const rawEnd = e.end_at ? parseDb(e.end_at) : now;
    if (!s || !rawEnd) continue;
    let segStart = Math.max(s.getTime(), startOfDay.getTime());
    let segEnd = Math.min(rawEnd.getTime(), endOfDay.getTime());
    if (segEnd > segStart) total += (segEnd - segStart)/1000;
  }
  res.json({ total_seconds: Math.floor(total) });
});

// Per-task daily summary
app.get('/api/tasks/:id/time/summary/today', (req, res) => {
  if (!ENABLE_TIME_TRACKING) return res.json({ total_seconds: 0 });
  const taskId = Number(req.params.id);
  const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 86400000);
  const startISO = startOfDay.toISOString();
  const endISO = endOfDay.toISOString();
  const candidates = db.prepare('SELECT * FROM time_entries WHERE task_id = ? AND start_at < ? AND (end_at IS NULL OR end_at > ?)').all(taskId, endISO, startISO);
  const parseDb = (s) => {
    if (!s) return null;
    if (/T.*(Z|[+-]\d\d:?\d\d)$/.test(s)) return new Date(s);
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return new Date(s.replace(' ', 'T') + 'Z');
    return new Date(s);
  };
  let total = 0;
  for (const e of candidates){
    const s = parseDb(e.start_at);
    const rawEnd = e.end_at ? parseDb(e.end_at) : now;
    if (!s || !rawEnd) continue;
    let segStart = Math.max(s.getTime(), startOfDay.getTime());
    let segEnd = Math.min(rawEnd.getTime(), endOfDay.getTime());
    if (segEnd > segStart) total += (segEnd - segStart)/1000;
  }
  res.json({ total_seconds: Math.floor(total) });
});

// Add update to task
app.post('/api/tasks/:id/updates', (req, res) => {
  const id = Number(req.params.id);
  const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const { content } = req.body || {};
  if (!content || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'Content is required' });
  }
  if (content.length > MAX_UPDATE_LENGTH) {
    return res.status(400).json({ error: `Content too long (max ${MAX_UPDATE_LENGTH} chars)` });
  }
  const info = db.prepare('INSERT INTO updates (task_id, content) VALUES (?, ?)').run(id, content.trim());
  bumpTaskUpdated(id);
  const update = db.prepare('SELECT * FROM updates WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(rowToUpdate(update));
});

// Edit an update's content
app.put('/api/updates/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM updates WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Update not found' });
  const { content } = req.body || {};
  if (!content || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'Content is required' });
  }
  if (content.length > MAX_UPDATE_LENGTH) {
    return res.status(400).json({ error: `Content too long (max ${MAX_UPDATE_LENGTH} chars)` });
  }
  db.prepare('UPDATE updates SET content = ? WHERE id = ?').run(content.trim(), id);
  bumpTaskUpdated(existing.task_id);
  const updated = db.prepare('SELECT * FROM updates WHERE id = ?').get(id);
  res.json(rowToUpdate(updated));
});

// Update task title
app.put('/api/tasks/:id', (req, res) => {
  const id = Number(req.params.id);
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const { title } = req.body || {};
  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'Title is required' });
  }
  const trimmed = title.trim();
  if (trimmed.length > 200) return res.status(400).json({ error: 'Title too long (max 200 chars)' });
  db.prepare('UPDATE tasks SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(trimmed, id);
  const updated = db.prepare('SELECT id, title, desired_outcome, created_at, closed_at, waiting_since, updated_at FROM tasks WHERE id = ?').get(id);
  res.json(rowToTask(updated));
});

// Delete an update
app.delete('/api/updates/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM updates WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Update not found' });
  db.prepare('DELETE FROM updates WHERE id = ?').run(id);
  bumpTaskUpdated(existing.task_id);
  res.json({ ok: true });
});

// Update task status (closed / waiting)
app.patch('/api/tasks/:id/status', (req, res) => {
  const id = Number(req.params.id);
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const { closed, waiting } = req.body || {};
  if (typeof closed !== 'boolean' && typeof waiting !== 'boolean') {
    return res.status(400).json({ error: 'No status fields provided' });
  }
  if (closed && waiting) {
    return res.status(400).json({ error: 'Task cannot be both closed and waiting' });
  }
  const now = new Date().toISOString();
  let closed_at = task.closed_at;
  let waiting_since = task.waiting_since;
  if (typeof closed === 'boolean') {
    closed_at = closed ? now : null;
    if (closed) waiting_since = null; // clear waiting if closing
  }
  if (typeof waiting === 'boolean') {
    waiting_since = waiting ? now : null;
    if (waiting) closed_at = null; // clear closed if waiting
  }
  db.prepare('UPDATE tasks SET closed_at = ?, waiting_since = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(closed_at, waiting_since, id);
  const updated = db.prepare('SELECT id, title, desired_outcome, created_at, closed_at, waiting_since, updated_at FROM tasks WHERE id = ?').get(id);
  res.json(rowToTask(updated));
});

// Update desired outcome text
app.patch('/api/tasks/:id/outcome', (req, res) => {
  const id = Number(req.params.id);
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const { desired_outcome } = req.body || {};
  if (typeof desired_outcome !== 'string') return res.status(400).json({ error: 'desired_outcome must be a string' });
  const trimmed = desired_outcome.trim();
  if (trimmed.length > 1000) return res.status(400).json({ error: 'Desired outcome too long (max 1000 chars)' });
  db.prepare('UPDATE tasks SET desired_outcome = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(trimmed || null, id);
  const updated = db.prepare('SELECT id, title, desired_outcome, created_at, closed_at, waiting_since, updated_at FROM tasks WHERE id = ?').get(id);
  res.json(rowToTask(updated));
});

// Delete task (and cascading updates)
app.delete('/api/tasks/:id', (req, res) => {
  const id = Number(req.params.id);
  const info = db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  if (info.changes === 0) return res.status(404).json({ error: 'Task not found' });
  res.json({ ok: true });
});

// ---- Daily Plan Routes ----
app.get('/api/daily_plans/:date', (req, res) => {
  const date = req.params.date;
  if (!validatePlanDate(date)) return res.status(400).json({ error: 'Invalid date' });
  const items = db.prepare('SELECT * FROM daily_plan_items WHERE plan_date = ? ORDER BY position ASC, id ASC').all(date).map(rowToPlanItem);
  const total = items.length;
  const remaining = items.filter(i => !i.done).length;
  res.json({ date, items, total, remaining });
});

app.post('/api/daily_plans/:date/items', (req, res) => {
  const date = req.params.date;
  if (!validatePlanDate(date)) return res.status(400).json({ error: 'Invalid date' });
  const { content } = req.body || {};
  if (!content || typeof content !== 'string' || !content.trim()) return res.status(400).json({ error: 'Content required' });
  if (content.length > 500) return res.status(400).json({ error: 'Too long (max 500 chars)' });
  const pos = nextPlanPosition(date);
  const info = db.prepare('INSERT INTO daily_plan_items (plan_date, content, position) VALUES (?, ?, ?)').run(date, content.trim(), pos);
  const row = db.prepare('SELECT * FROM daily_plan_items WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(rowToPlanItem(row));
});

app.patch('/api/daily_plan_items/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM daily_plan_items WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { content, done, position, plan_date } = req.body || {};
  const sets = [];
  const params = [];
  if (typeof content === 'string') {
    const trimmed = content.trim();
    if (!trimmed) return res.status(400).json({ error: 'Content cannot be empty' });
    if (trimmed.length > 500) return res.status(400).json({ error: 'Too long (max 500 chars)' });
    sets.push('content = ?'); params.push(trimmed);
  }
  if (typeof done === 'boolean') { sets.push('done = ?'); params.push(done ? 1 : 0); }
  if (Number.isInteger(position)) { sets.push('position = ?'); params.push(position); }
  if (typeof plan_date === 'string') {
    if (!validatePlanDate(plan_date)) return res.status(400).json({ error: 'Invalid plan_date' });
    if (plan_date !== existing.plan_date){
      // moving to new date -> assign next position at end of that date
      const newPos = nextPlanPosition(plan_date);
      sets.push('plan_date = ?'); params.push(plan_date);
      sets.push('position = ?'); params.push(newPos);
    }
  }
  if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
  sets.push('updated_at = CURRENT_TIMESTAMP');
  const sql = `UPDATE daily_plan_items SET ${sets.join(', ')} WHERE id = ?`;
  params.push(id);
  db.prepare(sql).run(...params);
  const row = db.prepare('SELECT * FROM daily_plan_items WHERE id = ?').get(id);
  res.json(rowToPlanItem(row));
});

app.post('/api/daily_plan_items/:id/toggle', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM daily_plan_items WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const newVal = existing.done ? 0 : 1;
  db.prepare('UPDATE daily_plan_items SET done = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newVal, id);
  const row = db.prepare('SELECT * FROM daily_plan_items WHERE id = ?').get(id);
  res.json(rowToPlanItem(row));
});

app.delete('/api/daily_plan_items/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM daily_plan_items WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM daily_plan_items WHERE id = ?').run(id);
  res.json({ ok: true });
});

// Summary for yesterday, today, tomorrow
app.get('/api/daily_plans/summary', (req, res) => {
  function format(d){ return d.toISOString().slice(0,10); }
  const now = new Date();
  const todayStr = format(now);
  const y = new Date(now.getTime() - 86400000); const yesterdayStr = format(y);
  const t = new Date(now.getTime() + 86400000); const tomorrowStr = format(t);
  const q = db.prepare('SELECT plan_date, COUNT(*) AS total, SUM(CASE WHEN done = 0 THEN 1 ELSE 0 END) AS remaining FROM daily_plan_items WHERE plan_date IN (?,?,?) GROUP BY plan_date');
  const rows = q.all(yesterdayStr, todayStr, tomorrowStr);
  const map = {}; for (const r of rows){ map[r.plan_date] = { total: r.total, remaining: r.remaining || 0 }; }
  res.json({
    yesterday: map[yesterdayStr] || { total:0, remaining:0 },
    today: map[todayStr] || { total:0, remaining:0 },
    tomorrow: map[tomorrowStr] || { total:0, remaining:0 }
  });
});

// Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Task Manager running on http://localhost:${PORT}`);
});
