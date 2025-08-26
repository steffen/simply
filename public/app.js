// Minimal client for the dark task manager
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const taskListEl = $('#task-list');
const newTaskForm = $('#new-task-form'); // now contains only a + button
const deleteTaskBtn = $('#delete-task');
const markClosedBtn = $('#mark-closed');
const markWaitingBtn = $('#mark-waiting');
const timeTrackBtn = $('#time-track');

const emptyState = $('#empty-state');
const taskView = $('#task-view');
const taskTitleEl = $('#task-title');
const updatesEl = $('#updates');
const newUpdateForm = $('#new-update-form');
const newUpdateInput = $('#new-update');
const dailyTotalEl = $('#daily-total');
const collapseBtn = $('#collapse-sidebar');

let state = {
  tasks: [],
  selectedId: null,
  currentUpdates: [], // updates + time entries combined
  filter: 'open',
  tickingInterval: null
};

function parseServerDate(s){
  try {
    if(!s) return null;
    // If already ISO with zone info
    if(/T.*(Z|[+-]\d\d:?\d\d)$/.test(s)) return new Date(s);
    // SQLite CURRENT_TIMESTAMP gives 'YYYY-MM-DD HH:MM:SS' (UTC). Mark as UTC.
    if(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return new Date(s.replace(' ', 'T') + 'Z');
    // Fallback: let Date parse
    return new Date(s);
  } catch { return null; }
}

function formatDate(iso){
  try { const d = parseServerDate(iso); return d ? d.toLocaleString() : iso; } catch { return iso; }
}

function relativeTime(iso){
  try {
    const now = Date.now();
    const then = parseServerDate(iso)?.getTime();
    if(!then) return '';
    const diff = Math.max(0, now - then);
    const sec = Math.floor(diff/1000);
    if (sec < 45) return 'just now';
    if (sec < 90) return 'a minute ago';
    const min = Math.floor(sec/60);
    if (min < 45) return `${min}m ago`;
    if (min < 90) return '1h ago';
    const hr = Math.floor(min/60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr/24);
    if (day < 7) return `${day}d ago`;
    const week = Math.floor(day/7);
    if (week < 5) return `${week}w ago`;
    const month = Math.floor(day/30);
    if (month < 12) return `${month}mo ago`;
    const year = Math.floor(day/365);
    return `${year}y ago`;
  } catch { return ''; }
}

async function fetchJSON(url, options){
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function loadTasks(){
  state.tasks = await fetchJSON('/api/tasks');
  renderTaskList();
}

function renderTaskList(){
  taskListEl.innerHTML = '';
  const filtered = state.tasks.filter(t => {
    if (state.filter === 'open') return !t.closed_at && !t.waiting_since;
    if (state.filter === 'waiting') return !!t.waiting_since && !t.closed_at;
    if (state.filter === 'closed') return !!t.closed_at;
    return true;
  });
  filtered.forEach(t => {
    const li = document.createElement('li');
  let cls = 'task-item';
  if (t.closed_at) cls += ' closed';
  else if (t.waiting_since) cls += ' waiting';
  if (t.id === state.selectedId) cls += ' active';
  li.className = cls;
    li.dataset.id = t.id;
    const rel = t.latest_at ? relativeTime(t.latest_at) : '';
    const abs = t.latest_at ? formatDate(t.latest_at) : '';
    li.innerHTML = `
      <div class="task-item-line">
        <div class="task-item-title">${escapeHtml(t.title)}</div>
        ${t.latest_at ? `<time class="last-update" title="${abs}" datetime="${t.latest_at}">${rel}</time>` : ''}
      </div>
      <div class="task-item-preview">${t.latest_update ? escapeHtml(t.latest_update) : 'No updates yet'}</div>
    `;
    li.addEventListener('click', () => selectTask(t.id));
    taskListEl.appendChild(li);
  });
}

function updateEmpty(){
  const hasSelection = !!state.selectedId;
  emptyState.classList.toggle('hidden', hasSelection);
  taskView.classList.toggle('hidden', !hasSelection);
}

async function selectTask(id){
  state.selectedId = id;
  try { localStorage.setItem('selectedTaskId', String(id)); } catch {}
  renderTaskList();
  updateEmpty();
  const task = state.tasks.find(t => t.id === id);
  taskTitleEl.textContent = task ? task.title : '';
  updateStatusButtons(task);
  const entries = await fetchJSON(`/api/tasks/${id}/updates`);
  renderUpdates(entries);
  newUpdateInput.focus();
}

function renderUpdates(items){
  state.currentUpdates = items;
  updatesEl.innerHTML = '';
  let hasRunning = false;
  items.forEach(item => {
    if (item.type === 'update') {
      const li = document.createElement('li');
      li.className = 'update';
      li.dataset.id = String(item.id);
      const abs = formatDate(item.created_at);
      const rel = relativeTime(item.created_at);
      li.innerHTML = `
        <div class="update-body">${linkify(escapeHtml(item.content))}</div>
        <time title="${abs}" datetime="${item.created_at}">${rel}</time>
      `;
      li.addEventListener('click', (e) => {
        const target = e.target;
        if (target.closest('button') || target.closest('input') || target.closest('a')) return;
        startEditUpdate(item.id);
      });
      updatesEl.appendChild(li);
    } else if (item.type === 'time') {
      const li = document.createElement('li');
      const running = item.running;
      if (running) hasRunning = true;
      li.className = 'time-entry' + (running ? ' running' : '');
      li.dataset.id = 'te-' + item.id;
      li.dataset.entryId = item.id;
      const startAbs = formatDate(item.start_at);
      const relStart = relativeTime(item.start_at);
      const duration = running ? liveDuration(item.start_at) : formatDuration(item.duration_seconds || 0);
  const leftInitial = running ? computeNextHourLabel() : '';
      li.innerHTML = `
        <div class="te-line"><time title="${startAbs}" datetime="${item.start_at}">${relStart}</time><span class="te-sep">→</span><span class="te-duration" data-start="${item.start_at}" data-running="${running}">${duration}</span>${running ? `<span class=\"te-left\" data-start=\"${item.start_at}\">${leftInitial}</span>` : ''}${!running ? `<button class=\"te-trim\" title=\"Trim 15m from end\" aria-label=\"Trim 15 minutes\">−15m</button>` : ''}<button class="te-delete" title="Delete time entry" aria-label="Delete time entry">×</button></div>
      `;
      const delBtn = li.querySelector('.te-delete');
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('Delete this time entry?')) return;
        try {
          await fetchJSON(`/api/time_entries/${item.id}`, { method: 'DELETE' });
          const refreshed = await fetchJSON(`/api/tasks/${state.selectedId}/updates`);
          renderUpdates(refreshed);
        } catch(err){ console.error(err); }
      });
      if (!running) {
        const trimBtn = li.querySelector('.te-trim');
        trimBtn && trimBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            await fetchJSON(`/api/time_entries/${item.id}/trim`, { method: 'POST', body: JSON.stringify({ seconds: 900 }) });
            const refreshed = await fetchJSON(`/api/tasks/${state.selectedId}/updates`);
            renderUpdates(refreshed);
          } catch(err){ console.error(err); }
        });
      }
      updatesEl.appendChild(li);
    }
  });
  updateTimeTrackButton(hasRunning);
  ensureTicking(hasRunning);
}

function liveDuration(startIso){
  const start = parseServerDate(startIso)?.getTime() || Date.now();
  const diff = Math.max(0, Date.now() - start);
  return formatDuration(Math.floor(diff/1000));
}

function computeNextHourLabel(){
  const now = new Date();
  const mins = now.getMinutes();
  let minsLeft = 60 - mins; // at :00 => 60
  const nextHourDate = new Date(now);
  nextHourDate.setHours(now.getHours() + 1, 0, 0, 0); // always future hour
  let h = nextHourDate.getHours();
  const suffix = h >= 12 ? 'pm' : 'am';
  h = h % 12; if (h === 0) h = 12;
  return `· ${minsLeft}m → ${h}${suffix}`;
}

function formatDuration(sec){
  if (sec < 60) return '<1m';
  const totalMin = Math.floor(sec/60);
  const h = Math.floor(totalMin/60);
  const m = totalMin % 60;
  if (h === 0) return `${totalMin}m`;
  return `${h}h${m ? ' ' + m + 'm' : ''}`;
}

async function refreshDailyTotal(){
  if (!dailyTotalEl) return;
  try {
    const data = await fetchJSON('/api/time_entries/summary/today');
    const secs = data.total_seconds || 0;
    dailyTotalEl.innerHTML = secs ? `<strong>${formatDuration(secs)}</strong> today` : '';
  } catch { /* ignore */ }
}

function tickRunning(){
  $$('.time-entry.running .te-duration').forEach(span => {
    const start = span.getAttribute('data-start');
    if (start) span.textContent = liveDuration(start);
  });
  $$('.time-entry.running .te-left').forEach(span => {
  const start = span.getAttribute('data-start');
  if (!start) return;
  span.textContent = computeNextHourLabel();
  });
}

function updatePageTitleHour(){
  try {
    const now = new Date();
    const mins = now.getMinutes();
    const minsLeft = 60 - mins; // at :00 => 60
    const nextHourDate = new Date(now);
    nextHourDate.setHours(now.getHours() + 1, 0, 0, 0);
    let h = nextHourDate.getHours();
    const suffix = h >= 12 ? 'pm' : 'am';
    h = h % 12; if (h === 0) h = 12;
  const info = `${minsLeft}m → ${h}${suffix}`;
  document.title = `Simply (${info})`;
  } catch { /* ignore */ }
}

function ensureTicking(hasRunning){
  if (hasRunning && !state.tickingInterval){
    state.tickingInterval = setInterval(tickRunning, 60000); // update every minute
  } else if (!hasRunning && state.tickingInterval){
    clearInterval(state.tickingInterval);
    state.tickingInterval = null;
  }
}

function updateTimeTrackButton(running){
  if (!timeTrackBtn) return;
  timeTrackBtn.classList.toggle('running', running);
  timeTrackBtn.textContent = running ? 'Stop' : 'Time';
  timeTrackBtn.title = running ? 'Stop timer' : 'Start time tracking';
}

function escapeHtml(str){
  return str
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function linkify(text){
  const urlRegex = /(https?:\/\/[\w.-]+(?:\/[\w\-._~:/?#[\]@!$&'()*+,;=]*)?)/gi;
  return text.replace(urlRegex, (url) => `<a href="${url}" target="_blank" rel="noreferrer noopener">${url}</a>`);
}

newTaskForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = (prompt('Task title?') || '').trim();
  if (!title) return;
  const task = await fetchJSON('/api/tasks', { method: 'POST', body: JSON.stringify({ title }) });
  state.tasks.unshift({ ...task, latest_update: null, latest_at: null });
  renderTaskList();
  selectTask(task.id);
});

function autoResize(el){
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 220) + 'px';
}

// Handle Shift+Enter for newline, Enter to submit
newUpdateInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    newUpdateForm.requestSubmit();
  }
});

newUpdateInput.addEventListener('input', () => autoResize(newUpdateInput));
autoResize(newUpdateInput);

newUpdateForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.selectedId) return;
  const content = newUpdateInput.value.trim();
  if (!content) return;
  const update = await fetchJSON(`/api/tasks/${state.selectedId}/updates`, { method: 'POST', body: JSON.stringify({ content }) });
  const entries = await fetchJSON(`/api/tasks/${state.selectedId}/updates`);
  renderUpdates(entries);
  // Update preview in sidebar
  const idx = state.tasks.findIndex(t => t.id === state.selectedId);
  if (idx >= 0) {
    state.tasks[idx].latest_update = update.content;
    state.tasks[idx].latest_at = update.created_at;
  }
  renderTaskList();
  newUpdateInput.value = '';
  autoResize(newUpdateInput);
  newUpdateInput.focus();
});

deleteTaskBtn.addEventListener('click', async () => {
  if (!state.selectedId) return;
  if (!confirm('Delete this task and all its updates?')) return;
  await fetchJSON(`/api/tasks/${state.selectedId}`, { method: 'DELETE' });
  state.tasks = state.tasks.filter(t => t.id !== state.selectedId);
  state.selectedId = null;
  try { localStorage.removeItem('selectedTaskId'); } catch {}
  renderTaskList();
  updateEmpty();
});

function updateStatusButtons(task){
  document.body.classList.remove('status-closed', 'status-waiting');
  markClosedBtn.classList.remove('active');
  markWaitingBtn.classList.remove('active');
  if (!task) return;
  if (task.closed_at) {
    document.body.classList.add('status-closed');
    markClosedBtn.classList.add('active');
  } else if (task.waiting_since) {
    document.body.classList.add('status-waiting');
    markWaitingBtn.classList.add('active');
  }
}

async function toggleClosed(){
  if (!state.selectedId) return;
  const task = state.tasks.find(t => t.id === state.selectedId);
  const closed = !task.closed_at;
  const updated = await fetchJSON(`/api/tasks/${state.selectedId}/status`, { method: 'PATCH', body: JSON.stringify({ closed }) });
  mergeTask(updated);
  updateStatusButtons(updated);
  renderTaskList();
}

async function toggleWaiting(){
  if (!state.selectedId) return;
  const task = state.tasks.find(t => t.id === state.selectedId);
  const waiting = !task.waiting_since;
  const updated = await fetchJSON(`/api/tasks/${state.selectedId}/status`, { method: 'PATCH', body: JSON.stringify({ waiting }) });
  mergeTask(updated);
  updateStatusButtons(updated);
  renderTaskList();
}

function mergeTask(updated){
  const idx = state.tasks.findIndex(t => t.id === updated.id);
  if (idx >= 0) {
    state.tasks[idx] = { ...state.tasks[idx], ...updated };
  }
}

markClosedBtn.addEventListener('click', toggleClosed);
markWaitingBtn.addEventListener('click', toggleWaiting);
timeTrackBtn && timeTrackBtn.addEventListener('click', async () => {
  if (!state.selectedId) return;
  const running = state.currentUpdates.some(e => e.type === 'time' && e.running);
  try {
    if (running) {
      await fetchJSON(`/api/tasks/${state.selectedId}/time/stop`, { method: 'POST' });
    } else {
      await fetchJSON(`/api/tasks/${state.selectedId}/time/start`, { method: 'POST' });
    }
    const entries = await fetchJSON(`/api/tasks/${state.selectedId}/updates`);
    renderUpdates(entries);
  } catch(e){ console.error(e); }
});

async function startEditUpdate(updateId){
  // Prevent multiple edits at once
  if (updatesEl.querySelector('.update.editing')) return;
  const u = state.currentUpdates.find(x => x.id === updateId);
  if (!u) return;
  const li = updatesEl.querySelector(`.update[data-id="${updateId}"]`);
  if (!li) return;
  li.classList.add('editing');
  const originalHtml = li.innerHTML;
  li.innerHTML = '';
  const row = document.createElement('div');
  row.className = 'edit-row';
  const input = document.createElement('textarea');
  input.className = 'edit-textarea';
  input.value = u.content;
  input.setAttribute('maxlength', '2000');
  const saveBtn = document.createElement('button');
  saveBtn.className = 'mini-btn save';
  saveBtn.textContent = 'Save';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'mini-btn cancel';
  cancelBtn.textContent = 'Cancel';
  row.appendChild(input);
  row.appendChild(saveBtn);
  row.appendChild(cancelBtn);
  li.appendChild(row);
  input.focus();
  // Auto-size existing content
  const resize = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 300) + 'px'; };
  resize();
  input.addEventListener('input', resize);

  const cleanup = () => {
    li.classList.remove('editing');
  li.innerHTML = originalHtml;
  };

  cancelBtn.addEventListener('click', () => cleanup());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') cleanup();
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveBtn.click(); }
  });
  saveBtn.addEventListener('click', async () => {
    const content = input.value.trim();
    if (!content) { input.focus(); return; }
    // Persist change
    await fetchJSON(`/api/updates/${updateId}`, { method: 'PUT', body: JSON.stringify({ content }) });
  // Reload updates to reflect server state
  const entries = await fetchJSON(`/api/tasks/${state.selectedId}/updates`);
    renderUpdates(entries);
    if (entries.length && entries[0].type === 'update' && entries[0].id === updateId) {
      const idx = state.tasks.findIndex(t => t.id === state.selectedId);
      if (idx >= 0) {
        state.tasks[idx].latest_update = entries[0].content;
      }
      renderTaskList();
    }
  });
}

// Init
// Initial load then attempt restoration of previously selected task
loadTasks().then(() => {
  let storedId = null;
  try { storedId = Number(localStorage.getItem('selectedTaskId')) || null; } catch {}
  if (storedId && state.tasks.some(t => t.id === storedId)) {
    const task = state.tasks.find(t => t.id === storedId);
    // Adjust filter so task is visible
    if (task.closed_at && state.filter !== 'closed') state.filter = 'closed';
    else if (task.waiting_since && state.filter !== 'waiting') state.filter = 'waiting';
    else if (!task.closed_at && !task.waiting_since && state.filter !== 'open') state.filter = 'open';
    // Update filter button classes
    const filterGroup = $('#task-filters');
    if (filterGroup) {
      [...filterGroup.querySelectorAll('.filter-btn')].forEach(b => {
        b.classList.toggle('active', b.dataset.filter === state.filter);
      });
    }
    selectTask(storedId);
  } else {
    updateEmpty();
  }
});

// Filter controls
const filterGroup = $('#task-filters');
if (filterGroup){
  filterGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    const filter = btn.dataset.filter;
    if (!filter || filter === state.filter) return;
    state.filter = filter;
    [...filterGroup.querySelectorAll('.filter-btn')].forEach(b => b.classList.toggle('active', b === btn));
    renderTaskList();
  });
}

// Refresh relative times every 60 seconds
function refreshRelativeTimes(){
  // Update update list times
  $$('#updates time').forEach(t => {
    const iso = t.getAttribute('datetime');
    if (iso) t.textContent = relativeTime(iso);
  });
  // Update task list last-update times
  $('#task-list') && $$('#task-list time.last-update').forEach(t => {
    const iso = t.getAttribute('datetime');
    if (iso) t.textContent = relativeTime(iso);
  });
  updatePageTitleHour();
}
setInterval(refreshRelativeTimes, 60000);
// Initial title update
updatePageTitleHour();
// Daily total initial + periodic (every 5 min) refresh
refreshDailyTotal();
setInterval(refreshDailyTotal, 300000);

// Sidebar collapse/expand
function applySidebarCollapsed(collapsed){
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  try { localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0'); } catch{}
  if (collapseBtn){
    collapseBtn.textContent = collapsed ? '»' : '«';
    collapseBtn.title = collapsed ? 'Expand task list' : 'Collapse task list';
    collapseBtn.setAttribute('aria-label', collapseBtn.title);
  }
  // Force reflow for some browsers to apply grid change
  void document.body.offsetWidth;
}
collapseBtn && collapseBtn.addEventListener('click', () => {
  const isCollapsed = document.body.classList.contains('sidebar-collapsed');
  applySidebarCollapsed(!isCollapsed);
});
// Restore persisted state
try {
  const stored = localStorage.getItem('sidebarCollapsed');
  if (stored === '1') applySidebarCollapsed(true);
  else applySidebarCollapsed(false);
} catch{}
