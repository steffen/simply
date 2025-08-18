// Minimal client for the dark task manager
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const taskListEl = $('#task-list');
const newTaskForm = $('#new-task-form');
const newTaskTitle = $('#new-task-title');
const deleteTaskBtn = $('#delete-task');

const emptyState = $('#empty-state');
const taskView = $('#task-view');
const taskTitleEl = $('#task-title');
const updatesEl = $('#updates');
const newUpdateForm = $('#new-update-form');
const newUpdateInput = $('#new-update');

let state = {
  tasks: [],
  selectedId: null
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
  state.tasks.forEach(t => {
    const li = document.createElement('li');
    li.className = 'task-item' + (t.id === state.selectedId ? ' active' : '');
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
  const updates = await fetchJSON(`/api/tasks/${id}/updates`);
  renderUpdates(updates);
  newUpdateInput.focus();
}

function renderUpdates(updates){
  updatesEl.innerHTML = '';
  updates.forEach(u => {
    const li = document.createElement('li');
    li.className = 'update';
    li.innerHTML = `
      <div>${linkify(escapeHtml(u.content))}</div>
      <time>${formatDate(u.created_at)}</time>
    `;
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

// Init
loadTasks().then(() => updateEmpty());
