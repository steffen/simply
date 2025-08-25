// Minimal client for the dark task manager
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const taskListEl = $('#task-list');
const newTaskForm = $('#new-task-form');
const newTaskTitle = $('#new-task-title');
const deleteTaskBtn = $('#delete-task');
const markClosedBtn = $('#mark-closed');
const markWaitingBtn = $('#mark-waiting');

const emptyState = $('#empty-state');
const taskView = $('#task-view');
const taskTitleEl = $('#task-title');
const updatesEl = $('#updates');
const newUpdateForm = $('#new-update-form');
const newUpdateInput = $('#new-update');

let state = {
  tasks: [],
  selectedId: null,
  currentUpdates: [],
  filter: 'open'
};

function formatDate(iso){
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
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
    li.innerHTML = `
      <div class="task-item-title">${escapeHtml(t.title)}</div>
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
  renderTaskList();
  updateEmpty();
  const task = state.tasks.find(t => t.id === id);
  taskTitleEl.textContent = task ? task.title : '';
  updateStatusButtons(task);
  const updates = await fetchJSON(`/api/tasks/${id}/updates`);
  renderUpdates(updates);
  newUpdateInput.focus();
}

function renderUpdates(updates){
  state.currentUpdates = updates;
  updatesEl.innerHTML = '';
  updates.forEach((u) => {
    const li = document.createElement('li');
    li.className = 'update';
    li.dataset.id = String(u.id);
    li.innerHTML = `
      <div class="update-body">${linkify(escapeHtml(u.content))}</div>
      <time>${formatDate(u.created_at)}</time>
    `;
    li.addEventListener('click', (e) => {
      // Avoid triggering when clicking inside buttons/inputs
      const target = e.target;
      if (target.closest('button') || target.closest('input')) return;
      startEditUpdate(u.id);
    });
    updatesEl.appendChild(li);
  });
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
  const title = newTaskTitle.value.trim();
  if (!title) return;
  const task = await fetchJSON('/api/tasks', { method: 'POST', body: JSON.stringify({ title }) });
  state.tasks.unshift({ ...task, latest_update: null, latest_at: null });
  newTaskTitle.value = '';
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
  // Prepend to updates list visually by reloading updates
  const updates = await fetchJSON(`/api/tasks/${state.selectedId}/updates`);
  renderUpdates(updates);
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
    const updates = await fetchJSON(`/api/tasks/${state.selectedId}/updates`);
    renderUpdates(updates);
    // If this was the latest update, update sidebar preview
    if (updates.length && updates[0].id === updateId) {
      const idx = state.tasks.findIndex(t => t.id === state.selectedId);
      if (idx >= 0) {
        state.tasks[idx].latest_update = updates[0].content;
      }
      renderTaskList();
    }
  });
}

// Init
loadTasks().then(() => updateEmpty());

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
