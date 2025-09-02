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
`);

// Lightweight migration for new status columns
try {
  const cols = db.prepare("PRAGMA table_info(tasks)").all().map(c => c.name);
  if (!cols.includes('closed_at')) {
    db.prepare('ALTER TABLE tasks ADD COLUMN closed_at DATETIME').run();
  }
  if (!cols.includes('waiting_since')) {
    db.prepare('ALTER TABLE tasks ADD COLUMN waiting_since DATETIME').run();
  }
} catch (e) {
  console.error('Migration error:', e);
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helpers
const rowToTask = (row) => ({ id: row.id, title: row.title, created_at: row.created_at, closed_at: row.closed_at || null, waiting_since: row.waiting_since || null });
const rowToUpdate = (row) => ({ id: row.id, task_id: row.task_id, content: row.content, created_at: row.created_at });
const rowToTimeEntry = (row) => ({ id: row.id, task_id: row.task_id, start_at: row.start_at, end_at: row.end_at, duration_seconds: row.duration_seconds, running: !row.end_at });

// Routes
// Get all tasks with latest update content preview
app.get('/api/tasks', (req, res) => {
  const tasks = db.prepare('SELECT id, title, created_at, closed_at, waiting_since FROM tasks ORDER BY created_at DESC').all();
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
  const info = db.prepare('INSERT INTO tasks (title) VALUES (?)').run(title.trim());
  const task = db.prepare('SELECT id, title, created_at, closed_at, waiting_since FROM tasks WHERE id = ?').get(info.lastInsertRowid);
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
  const info = db.prepare('INSERT INTO updates (task_id, content) VALUES (?, ?)').run(id, content.trim());
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
  db.prepare('UPDATE updates SET content = ? WHERE id = ?').run(content.trim(), id);
  const updated = db.prepare('SELECT * FROM updates WHERE id = ?').get(id);
  res.json(rowToUpdate(updated));
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
  db.prepare('UPDATE tasks SET closed_at = ?, waiting_since = ? WHERE id = ?')
    .run(closed_at, waiting_since, id);
  const updated = db.prepare('SELECT id, title, created_at, closed_at, waiting_since FROM tasks WHERE id = ?').get(id);
  res.json(rowToTask(updated));
});

// Delete task (and cascading updates)
app.delete('/api/tasks/:id', (req, res) => {
  const id = Number(req.params.id);
  const info = db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  if (info.changes === 0) return res.status(404).json({ error: 'Task not found' });
  res.json({ ok: true });
});

// Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Task Manager running on http://localhost:${PORT}`);
});
