// Simple Express + SQLite (better-sqlite3) server for a dark-mode task manager
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
`);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helpers
const rowToTask = (row) => ({ id: row.id, title: row.title, created_at: row.created_at });
const rowToUpdate = (row) => ({ id: row.id, task_id: row.task_id, content: row.content, created_at: row.created_at });

// Routes
// Get all tasks with latest update content preview
app.get('/api/tasks', (req, res) => {
  const tasks = db.prepare('SELECT id, title, created_at FROM tasks ORDER BY created_at DESC').all();
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
  const task = db.prepare('SELECT id, title, created_at FROM tasks WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(rowToTask(task));
});

// Get updates for task (latest first)
app.get('/api/tasks/:id/updates', (req, res) => {
  const id = Number(req.params.id);
  const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const updates = db.prepare('SELECT * FROM updates WHERE task_id = ? ORDER BY created_at DESC, id DESC').all(id);
  res.json(updates.map(rowToUpdate));
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
