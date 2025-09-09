// Minimal client for the dark task manager
// Front-end hard-coded feature flag mirroring backend
const ENABLE_TIME_TRACKING = false;
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const taskListEl = $('#task-list');
const newTaskForm = $('#new-task-form'); // now contains only a + button
const deleteTaskBtn = $('#delete-task');
const markClosedBtn = $('#mark-closed');
const markWaitingBtn = $('#mark-waiting');
// Timer control moved into updates list (start row + stop inside running entry)

const emptyState = $('#empty-state');
const taskView = $('#task-view');
const taskTitleEl = $('#task-title');
const taskDailyTotalEl = $('#task-daily-total');
const tasksUpdatedTodayEl = $('#updated-today');
const updatesEl = $('#updates');
const newUpdateForm = $('#new-update-form');
const newUpdateInput = $('#new-update');
const submitUpdateBtn = $('#submit-update');
const dailyTotalEl = $('#daily-total');
const collapseBtn = $('#collapse-sidebar');
const expandFloatBtn = $('#expand-sidebar-float');
const expandBtn = $('#expand-sidebar');

let state = {
  tasks: [],
  selectedId: null,
  currentUpdates: [], // updates + time entries combined
  filter: 'open',
  tickingInterval: null
};

function countTasks(){
  let open = 0, waiting = 0, closed = 0;
  for (const t of state.tasks){
    if (t.closed_at) closed++; else if (t.waiting_since) waiting++; else open++;
  }
  return { open, waiting, closed };
}

function updateFilterCounts(){
  const group = document.getElementById('task-filters');
  if (!group) return;
  const counts = countTasks();
  group.querySelectorAll('.filter-btn').forEach(btn => {
    const f = btn.dataset.filter;
    if (!f || counts[f] === undefined) return;
    const label = f.charAt(0).toUpperCase() + f.slice(1);
    btn.textContent = `${label} (${counts[f]})`;
  });
}

function isSameLocalDay(d1, d2){
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
}

function updateTasksUpdatedToday(){
  if (!tasksUpdatedTodayEl) return;
  const today = new Date();
  let count = 0;
  for (const t of state.tasks){
    if (!t.updated_at) continue;
    const d = parseServerDate(t.updated_at);
    if (!d) continue;
    if (isSameLocalDay(d, today)) count++;
  }
  tasksUpdatedTodayEl.innerHTML = count ? `<strong>${count}</strong> updated today` : '';
}

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
  updateFilterCounts();
  updateTasksUpdatedToday();
}

function renderTaskList(){
  // Ensure ordering latest updated first (client-side) without relying solely on initial fetch order
  state.tasks.sort((a,b) => {
    const ad = parseServerDate(a.updated_at || a.latest_at || a.created_at) || new Date(0);
    const bd = parseServerDate(b.updated_at || b.latest_at || b.created_at) || new Date(0);
    return bd.getTime() - ad.getTime() || (b.id - a.id);
  });
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
    const baseIso = t.updated_at || t.latest_at || t.created_at;
    let rel = '';
    let abs = '';
    if (baseIso){
      abs = formatDate(baseIso);
      const d = parseServerDate(baseIso);
      if (d && isSameLocalDay(d, new Date())) rel = 'today';
      else rel = relativeTime(baseIso);
    }
    li.innerHTML = `
      <div class="task-item-line">
        <div class="task-item-title">${escapeHtml(t.title)}</div>
        ${baseIso ? `<time class="last-update" title="${abs}" datetime="${baseIso}">${rel}</time>` : ''}
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
  refreshTaskDailyTotal();
  updateStatusButtons(task);
  const entries = await fetchJSON(`/api/tasks/${id}/updates`);
  renderUpdates(entries);
  newUpdateInput.focus();
}

function renderUpdates(items){
  state.currentUpdates = items;
  updatesEl.innerHTML = '';
  // Recompute tasks updated today in case latest_at changed via deletion or edit
  try { updateTasksUpdatedToday(); } catch {}
  let runningEntry = null;
  items.forEach(item => {
    if (item.type === 'update') {
      const li = document.createElement('li');
      li.className = 'update';
      li.dataset.id = String(item.id);
      const abs = formatDate(item.created_at);
      const rel = relativeTime(item.created_at);
      li.innerHTML = `
        <div class="update-body markdown-body">${markdownToHtml(item.content)}</div>
        <div class="update-meta-line">
          <time title="${abs}" datetime="${item.created_at}">${rel}</time>
          <button class="mini-delete-update" title="Delete update" aria-label="Delete update">×</button>
        </div>
      `;
      const delBtn = li.querySelector('.mini-delete-update');
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('Delete this update?')) return;
        try {
          await fetchJSON(`/api/updates/${item.id}`, { method: 'DELETE' });
          // Remove locally
          const idx = state.currentUpdates.findIndex(u => u.id === item.id && u.type === 'update');
            if (idx >= 0) state.currentUpdates.splice(idx,1);
          // Refresh tasks preview if this was the latest
          const task = state.tasks.find(t => t.id === state.selectedId);
          if (task && task.latest_at === item.created_at){
            // Re-fetch latest update for that task
            try {
              const updates = await fetchJSON(`/api/tasks/${state.selectedId}/updates`);
              renderUpdates(updates);
              // Update sidebar preview
              const latestUpdate = updates.find(u => u.type === 'update');
              if (latestUpdate){
                task.latest_update = latestUpdate.content;
                task.latest_at = latestUpdate.created_at;
              } else {
                task.latest_update = null;
                task.latest_at = null;
              }
              renderTaskList();
            } catch(err){ console.error(err); }
          } else {
            li.remove();
          }
        } catch(err){ console.error(err); }
      });
      li.addEventListener('dblclick', (e) => {
        const target = e.target;
        if (target.closest('button') || target.closest('input') || target.closest('a')) return;
        startEditUpdate(item.id);
      });
      updatesEl.appendChild(li);
    } else if (item.type === 'time' && ENABLE_TIME_TRACKING) {
      if (item.running) runningEntry = item; // capture running entry for unified control
      else {
        const li = document.createElement('li');
        li.className = 'time-entry';
        li.dataset.id = 'te-' + item.id;
        li.dataset.entryId = item.id;
        const startAbs = formatDate(item.start_at);
        const endAbs = formatDate(item.end_at);
        const relStart = relativeTime(item.start_at);
        const startClock = formatClock(item.start_at);
        const endClock = formatClock(item.end_at);
        const duration = formatDuration(item.duration_seconds || 0);
  li.innerHTML = `<div class="te-line"><time class="te-rel" title="${startAbs}" datetime="${item.start_at}">${relStart}</time> <span class="te-start" title="${startAbs}">${startClock}</span><span class="te-sep">→</span><span class="te-end" title="${endAbs}">${endClock}<span class="te-colon">:</span></span><span class="te-duration" data-start="${item.start_at}" data-running="false">${duration}</span><button class="te-trim" title="Trim 15m from end" aria-label="Trim 15 minutes">−15m</button><button class="te-delete" title="Delete time entry" aria-label="Delete time entry">×</button></div>`;
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
        const trimBtn = li.querySelector('.te-trim');
        trimBtn && trimBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            await fetchJSON(`/api/time_entries/${item.id}/trim`, { method: 'POST', body: JSON.stringify({ seconds: 900 }) });
            const refreshed = await fetchJSON(`/api/tasks/${state.selectedId}/updates`);
            renderUpdates(refreshed);
          } catch(err){ console.error(err); }
        });
        updatesEl.appendChild(li);
      }
    }
  });
  if (ENABLE_TIME_TRACKING) {
    const controlLi = document.createElement('li');
    controlLi.className = 'timer-control-row' + (runningEntry ? ' running' : '');
    const duration = runningEntry ? liveDuration(runningEntry.start_at) : '';
    controlLi.innerHTML = `
      <button type="button" class="timer-control-btn" aria-label="${runningEntry ? 'End timer' : 'Start time'}" title="${runningEntry ? 'End timer' : 'Start time'}">
        ${runningEntry ? `<span class="timer-duration" data-start="${runningEntry.start_at}" data-running="true">${duration}</span>` : ''}
        <span class="timer-label">${runningEntry ? 'End timer' : 'Start time'}</span>
      </button>
    `;
    const controlBtn = controlLi.querySelector('.timer-control-btn');
    controlBtn.addEventListener('click', async () => {
      if (!state.selectedId) return;
      try {
        if (runningEntry) {
          await fetchJSON(`/api/tasks/${state.selectedId}/time/stop`, { method: 'POST' });
        } else {
          await fetchJSON(`/api/tasks/${state.selectedId}/time/start`, { method: 'POST' });
        }
        const refreshed = await fetchJSON(`/api/tasks/${state.selectedId}/updates`);
        renderUpdates(refreshed);
      } catch(err){ console.error(err); }
    });
    updatesEl.prepend(controlLi);
    ensureTicking(!!runningEntry);
  }
}

function liveDuration(startIso){
  const start = parseServerDate(startIso)?.getTime() || Date.now();
  const diff = Math.max(0, Date.now() - start);
  return formatDuration(Math.floor(diff/1000));
}

function formatClock(iso){
  const d = parseServerDate(iso);
  if(!d) return '';
  let h = d.getHours();
  const m = d.getMinutes();
  const suffix = h >= 12 ? 'pm' : 'am';
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2,'0')}${suffix}`;
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
    if (!ENABLE_TIME_TRACKING){ dailyTotalEl.innerHTML = ''; return; }
    const data = await fetchJSON('/api/time_entries/summary/today');
    const secs = data.total_seconds || 0;
    dailyTotalEl.innerHTML = secs ? `<strong>${formatDuration(secs)}</strong> today` : '';
  } catch { /* ignore */ }
}

async function refreshTaskDailyTotal(){
  if (!taskDailyTotalEl || !state.selectedId) return;
  try {
    if (!ENABLE_TIME_TRACKING){ taskDailyTotalEl.innerHTML = ''; return; }
    const data = await fetchJSON(`/api/tasks/${state.selectedId}/time/summary/today`);
    const secs = data.total_seconds || 0;
    taskDailyTotalEl.innerHTML = secs ? `<strong>${formatDuration(secs)}</strong> today` : '';
  } catch { /* ignore */ }
}

function tickRunning(){
  $$('.timer-control-row.running .timer-duration').forEach(span => {
    const start = span.getAttribute('data-start');
    if (start) span.textContent = liveDuration(start);
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
  if (!ENABLE_TIME_TRACKING) return;
  if (hasRunning && !state.tickingInterval){
    state.tickingInterval = setInterval(tickRunning, 60000);
  } else if (!hasRunning && state.tickingInterval){
    clearInterval(state.tickingInterval);
    state.tickingInterval = null;
  }
}

// Header time track button removed; start/stop now inline

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
function markdownToHtml(raw){
  // Trim and collapse multiple blank lines to avoid stray empty paragraphs / gaps
  if (typeof raw === 'string') {
    raw = raw.trim().replace(/\n{3,}/g, '\n\n');
  }
  try {
    if (window.marked) {
      // Support both marked.parse() and legacy invocation
      const parser = typeof window.marked.parse === 'function' ? window.marked.parse : window.marked;
      const html = parser(raw, { gfm: true, breaks: true });
      if (window.DOMPurify) {
        return window.DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
      }
      return html;
    }
  } catch { /* ignore */ }
  return linkify(escapeHtml(raw));
}

// Dynamically ensure markdown libs are loaded (in case CDN blocked or cached old index.html)
(function ensureMarkdownLibs(){
  function rerender(){
    if (state.currentUpdates && state.currentUpdates.length){
      try { renderUpdates(state.currentUpdates); } catch(e){ console.warn('[Simply] Re-render after markdown libs load failed:', e); }
    }
  }
  if (!window.marked){
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js';
    s.onload = () => { console.log('[Simply] marked loaded dynamically'); rerender(); };
    document.head.appendChild(s);
  }
  if (!window.DOMPurify){
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/dompurify@3.0.9/dist/purify.min.js';
    s.onload = () => { console.log('[Simply] DOMPurify loaded dynamically'); rerender(); };
    document.head.appendChild(s);
  }
})();

newTaskForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = (prompt('Task title?') || '').trim();
  if (!title) return;
  const task = await fetchJSON('/api/tasks', { method: 'POST', body: JSON.stringify({ title }) });
  state.tasks.unshift({ ...task, latest_update: null, latest_at: null });
  renderTaskList();
  updateFilterCounts();
  updateTasksUpdatedToday();
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

newUpdateInput.addEventListener('input', () => {
  autoResize(newUpdateInput);
  if (submitUpdateBtn){
    const has = newUpdateInput.value.trim().length > 0;
    submitUpdateBtn.disabled = !has;
  }
  // stray fragment removed
});

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
    // updated_at will be refreshed on refetch, but optimistically set
    state.tasks[idx].updated_at = update.created_at;
  }
  renderTaskList();
  updateTasksUpdatedToday();
  newUpdateInput.value = '';
  if (submitUpdateBtn) submitUpdateBtn.disabled = true;
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
  updateFilterCounts();
  updateTasksUpdatedToday();
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
  updateTasksUpdatedToday();
}

async function toggleWaiting(){
  if (!state.selectedId) return;
  const task = state.tasks.find(t => t.id === state.selectedId);
  const waiting = !task.waiting_since;
  const updated = await fetchJSON(`/api/tasks/${state.selectedId}/status`, { method: 'PATCH', body: JSON.stringify({ waiting }) });
  mergeTask(updated);
  updateStatusButtons(updated);
  renderTaskList();
  updateTasksUpdatedToday();
}

function mergeTask(updated){
  const idx = state.tasks.findIndex(t => t.id === updated.id);
  if (idx >= 0) {
    state.tasks[idx] = { ...state.tasks[idx], ...updated };
  }
  updateFilterCounts();
  updateTasksUpdatedToday();
}

markClosedBtn.addEventListener('click', toggleClosed);
markWaitingBtn.addEventListener('click', toggleWaiting);
// Old header time-track button logic removed

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
        state.tasks[idx].updated_at = entries[0].created_at; // optimistic
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

// Inline task title editing
if (taskTitleEl){
  taskTitleEl.addEventListener('click', () => {
    if (!state.selectedId) return;
    // Avoid multiple inputs
    if (taskTitleEl.querySelector('input')) return;
    const task = state.tasks.find(t => t.id === state.selectedId);
    if (!task) return;
    const current = task.title;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = current;
    input.setAttribute('maxlength','200');
    input.style.width = '100%';
    input.style.font = 'inherit';
    input.style.background = 'transparent';
    input.style.border = '1px solid var(--border)';
    input.style.borderRadius = '4px';
    input.style.padding = '4px 6px';
    input.style.color = 'var(--text)';
    taskTitleEl.innerHTML = '';
    taskTitleEl.appendChild(input);
    input.focus();
    input.select();
    let cancelled = false;
    const finish = async (commit) => {
      if (cancelled) return;
      cancelled = true;
      const newTitle = input.value.trim();
      if (commit && newTitle && newTitle !== current){
        try {
          const updated = await fetchJSON(`/api/tasks/${state.selectedId}`, { method: 'PUT', body: JSON.stringify({ title: newTitle }) });
          mergeTask(updated);
          renderTaskList();
          taskTitleEl.textContent = updated.title;
          updateTasksUpdatedToday();
        } catch(err){ console.error(err); taskTitleEl.textContent = current; }
      } else {
        taskTitleEl.textContent = current;
      }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape'){ e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  });
}

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
setInterval(() => { refreshTaskDailyTotal(); }, 300000);

// Sidebar collapse/expand
function applySidebarCollapsed(collapsed){
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  try { localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0'); } catch{}
  if (expandFloatBtn){
    expandFloatBtn.textContent = collapsed ? '»' : '«';
    expandFloatBtn.title = collapsed ? 'Expand task list' : 'Collapse task list';
    expandFloatBtn.setAttribute('aria-label', expandFloatBtn.title);
  }
  void document.body.offsetWidth;
}
collapseBtn && collapseBtn.addEventListener('click', () => {
  const isCollapsed = document.body.classList.contains('sidebar-collapsed');
  applySidebarCollapsed(!isCollapsed);
});
expandBtn && expandBtn.addEventListener('click', () => applySidebarCollapsed(false));
// Restore persisted state
try {
  const stored = localStorage.getItem('sidebarCollapsed');
  if (stored === '1') applySidebarCollapsed(true);
  else applySidebarCollapsed(false);
} catch{}

// Slide-out toggle hover logic over top title bar / left edge
let slideVisible = false;
let hideTimeout = null;
function showSlideButton(){
  if (!expandFloatBtn) return;
  if (!slideVisible){
    expandFloatBtn.classList.add('visible');
    slideVisible = true;
  }
  if (hideTimeout){ clearTimeout(hideTimeout); hideTimeout = null; }
}
function scheduleHide(){
  if (!expandFloatBtn) return;
  if (hideTimeout) clearTimeout(hideTimeout);
  hideTimeout = setTimeout(() => {
    expandFloatBtn.classList.remove('visible');
    slideVisible = false;
  }, 260);
}
// Hover zones: top title bar region (0-60px from top) OR narrow left edge (0-16px)
window.addEventListener('mousemove', (e) => {
  const topZone = e.clientY <= 60; // title bar area
  const leftZone = e.clientX <= 16; // left edge
  if (topZone || leftZone){
    showSlideButton();
  } else if (slideVisible){
    scheduleHide();
  }
});
expandFloatBtn && expandFloatBtn.addEventListener('mouseenter', showSlideButton);
expandFloatBtn && expandFloatBtn.addEventListener('mouseleave', scheduleHide);
expandFloatBtn && expandFloatBtn.addEventListener('click', () => {
  const isCollapsed = document.body.classList.contains('sidebar-collapsed');
  applySidebarCollapsed(!isCollapsed);
  showSlideButton();
});
