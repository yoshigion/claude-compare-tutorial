'use strict';

// ── State ──────────────────────────────────────────────────────────────────

const state = {
  tasks: loadTasks(),
  filter: 'all',
  dark: localStorage.getItem('theme') === 'dark',
  // Fix #1: track which task was just added so only it animates
  newTaskId: null,
};

// ── Persistence ────────────────────────────────────────────────────────────

function loadTasks() {
  try {
    return JSON.parse(localStorage.getItem('tasks')) ?? [];
  } catch {
    return [];
  }
}

function saveTasks() {
  // Fix #4: guard against QuotaExceededError and sandboxed contexts
  try {
    localStorage.setItem('tasks', JSON.stringify(state.tasks));
  } catch {
    // Storage unavailable — changes persist in memory only for this session
  }
}

// ── Theme ──────────────────────────────────────────────────────────────────

function applyTheme(dark) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  try {
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  } catch {
    // ignore
  }
}

// ── DOM refs ───────────────────────────────────────────────────────────────

const form        = document.getElementById('task-form');
const input       = document.getElementById('task-input');
const list        = document.getElementById('task-list');
const emptyState  = document.getElementById('empty-state');
const summary     = document.getElementById('task-summary');
const clearBtn    = document.getElementById('clear-completed');
const filterBtns  = document.querySelectorAll('.filter-btn');
const themeToggle = document.getElementById('theme-toggle');

// Fix #9: single helper keeps button label, icon, and aria-pressed in sync
function syncThemeButton(dark) {
  themeToggle.setAttribute('aria-pressed', String(dark));
  themeToggle.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  themeToggle.querySelector('.theme-icon').textContent = dark ? '☀️' : '🌙';
}

// ── Rendering ──────────────────────────────────────────────────────────────

function createTaskEl(task) {
  const li = document.createElement('li');
  // Fix #1: only attach animation class for the newly added task
  li.className = `task-item${task.completed ? ' completed' : ''}${task.id === state.newTaskId ? ' is-new' : ''}`;
  li.dataset.id = task.id;

  const checkboxId = `task-${task.id}`;

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'task-checkbox';
  checkbox.id = checkboxId;
  checkbox.checked = task.completed;
  checkbox.setAttribute('aria-label', `Mark "${task.text}" as ${task.completed ? 'active' : 'completed'}`);
  checkbox.addEventListener('change', () => toggleTask(task.id));

  const label = document.createElement('label');
  label.className = 'task-label';
  label.htmlFor = checkboxId;
  label.textContent = task.text;

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'task-delete';
  deleteBtn.setAttribute('aria-label', `Delete task: ${task.text}`);
  // Fix #10: textContent avoids unnecessary HTML parsing
  deleteBtn.textContent = '×';
  deleteBtn.addEventListener('click', () => deleteTask(task.id));

  li.append(checkbox, label, deleteBtn);
  return li;
}

function render() {
  const visible = state.tasks.filter(task => {
    if (state.filter === 'active') return !task.completed;
    if (state.filter === 'completed') return task.completed;
    return true;
  });

  list.innerHTML = '';
  visible.forEach(task => list.appendChild(createTaskEl(task)));

  // Fix #1: clear newTaskId after render so re-renders don't re-animate
  state.newTaskId = null;

  const isEmpty = visible.length === 0;
  emptyState.hidden = !isEmpty;
  list.hidden = isEmpty;

  const activeCount = state.tasks.filter(t => !t.completed).length;
  summary.textContent = `${activeCount} task${activeCount !== 1 ? 's' : ''} remaining`;

  const hasCompleted = state.tasks.some(t => t.completed);
  clearBtn.hidden = !hasCompleted;

  filterBtns.forEach(btn => {
    const isActive = btn.dataset.filter === state.filter;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', String(isActive));
  });
}

// ── Task operations ─────────────────────────────────────────────────────────

function addTask(text) {
  const task = {
    id: crypto.randomUUID(),
    text: text.trim(),
    completed: false,
    createdAt: Date.now(),
  };
  // Fix #1: mark this ID so render() knows to animate only this item
  state.newTaskId = task.id;
  state.tasks.unshift(task);
  saveTasks();
  render();
}

function toggleTask(id) {
  const task = state.tasks.find(t => t.id === id);
  if (task) {
    task.completed = !task.completed;
    saveTasks();
    render();
  }
}

function deleteTask(id) {
  state.tasks = state.tasks.filter(t => t.id !== id);
  saveTasks();
  render();
}

function clearCompleted() {
  state.tasks = state.tasks.filter(t => !t.completed);
  saveTasks();
  render();
}

// ── Event listeners ─────────────────────────────────────────────────────────

form.addEventListener('submit', e => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) {
    input.focus();
    return;
  }
  addTask(text);
  input.value = '';
  input.focus();
});

filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    state.filter = btn.dataset.filter;
    render();
  });
});

clearBtn.addEventListener('click', clearCompleted);

themeToggle.addEventListener('click', () => {
  state.dark = !state.dark;
  applyTheme(state.dark);
  // Fix #9: use shared helper instead of duplicated attribute assignments
  syncThemeButton(state.dark);
});

// ── Init ────────────────────────────────────────────────────────────────────

// Fix #3: theme was already applied by the inline <head> script to avoid FOUC;
// applyTheme here just ensures localStorage is consistent.
applyTheme(state.dark);
// Fix #9: use shared helper for initial button state
syncThemeButton(state.dark);
render();
