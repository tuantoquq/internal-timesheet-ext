// ── Timesheet AutoFill — popup.js ──

const DAYS = [
  { code: 'mon', label: 'Monday', short: 'T2' },
  { code: 'tue', label: 'Tuesday', short: 'T3' },
  { code: 'wed', label: 'Wednesday', short: 'T4' },
  { code: 'thu', label: 'Thursday', short: 'T5' },
  { code: 'fri', label: 'Friday', short: 'T6' },
  { code: 'sat', label: 'Saturday', short: 'T7' },
  { code: 'sun', label: 'Sunday', short: 'CN' },
];

// Weekdays enabled by default
const DEFAULT_ENABLED = ['mon', 'tue', 'wed', 'thu', 'fri'];

// ── Theme colors (OpenWay logo) ───────────────────────
const THEME_COLORS = [
  { id: 'cyan', label: 'Cyan', hex: '#22B8F0', rgb: '34,184,240' },
  { id: 'teal', label: 'Teal', hex: '#10D2B0', rgb: '16,210,176' },
  { id: 'lime', label: 'Lime', hex: '#75E51B', rgb: '117,229,27' },
  { id: 'magenta', label: 'Magenta', hex: '#F018B8', rgb: '240,24,184' },
  { id: 'red', label: 'Red', hex: '#FF1F5B', rgb: '255,31,91' },
  { id: 'orange', label: 'Orange', hex: '#FF861A', rgb: '255,134,26' },
  { id: 'yellow', label: 'Yellow', hex: '#FFE12B', rgb: '255,225,43' },
];

function applyTheme(themeId, mode) {
  const t = THEME_COLORS.find((c) => c.id === themeId) || THEME_COLORS[0];
  const r = document.documentElement.style;
  r.setProperty('--accent', t.hex);
  r.setProperty('--accent2', t.hex);
  r.setProperty('--accent-bg', `rgba(${t.rgb}, 0.12)`);
  r.setProperty('--accent-border', `rgba(${t.rgb}, 0.25)`);
  // Update active swatch
  document.querySelectorAll('.theme-swatch').forEach((s) => {
    s.classList.toggle('active', s.dataset.theme === themeId);
  });
}

function applyThemeMode(mode) {
  document.body.classList.toggle('light-theme', mode === 'light');
  document.querySelectorAll('.mode-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
}

let state = {
  defaultStart: '09:00',
  defaultBreak: '01:30',
  defaultFinish: '18:30',
  savedProjects: ['INTA-3578_Self Study (Hanoi) /147382'],
  themeColor: 'cyan',
  themeMode: 'dark',
  settingUrl: 'http://10.145.48.117:9099',
  autoPost: false,
  weekEnding: '',
  auth: { loggedIn: false, username: '' },
  days: {},
};

const Core = window.TimesheetCore;
const REPO_URL = 'https://github.com/tuantoquq/internal-timesheet-ext';
const CHANGELOG_URL =
  'https://raw.githubusercontent.com/tuantoquq/internal-timesheet-ext/main/CHANGELOG.md';
const UPDATE_COMMAND = 'update.bat';
let lastSubmitDetailUrl = '';

// ── Init ──────────────────────────────────────────────
// ── Loading screen helpers ────────────────────────────────────────────────
function showLoadingScreen(text) {
  const el = document.getElementById('loadingScreen');
  const textEl = document.getElementById('loadingText');
  if (!el) return;
  if (textEl && text) textEl.textContent = text;
  el.classList.remove('fade-out', 'hidden');
}

function hideLoadingScreen() {
  const el = document.getElementById('loadingScreen');
  if (!el) return;
  el.classList.add('fade-out');
  setTimeout(() => el.classList.add('hidden'), 280);
}

document.addEventListener('DOMContentLoaded', async () => {
  applyViewMode();
  renderManifestVersion();

  // Show loading screen immediately
  showLoadingScreen('Đang kiểm tra phiên đăng nhập...');

  await loadState();
  applyTheme(state.themeColor || 'cyan');
  applyThemeMode(state.themeMode || 'dark');
  bindGlobalEvents();
  bindHeadlessEvents();

  // Fast path: read cached session from storage (~instant, no network)
  const cached = await new Promise((r) =>
    chrome.runtime.sendMessage({ action: 'checkSession' }, r),
  ).catch(() => ({ loggedIn: false }));

  if (cached?.loggedIn) {
    // Has cached session → show app screen immediately, verify in background
    state.auth = {
      loggedIn: true,
      username: cached.session?.employeeCode || state.auth?.username || '',
      displayName:
        cached.session?.employeeName ||
        cached.session?.employeeCode ||
        state.auth?.displayName ||
        '',
      lastLoginAt: cached.session?.loginAt || null,
    };
    renderAuthScreen();
    hideLoadingScreen();
    // Verify with server silently — only updates indicator or shows expired toast
    checkLoginStatus();
  } else {
    // No session → go straight to login
    renderAuthScreen();
    hideLoadingScreen();
  }
});

function renderManifestVersion() {
  const version = `v${chrome.runtime.getManifest().version}`;
  const headerVersion = document.getElementById('headerVersion');
  const footerVersion = document.getElementById('footerVersion');
  if (headerVersion) headerVersion.textContent = version;
  if (footerVersion) footerVersion.textContent = version;
}

function applyViewMode() {
  if (Core.isTabView(window.location.search)) {
    document.body.classList.add('tab-view');
    const logoImg = document.getElementById('logoImg');
    if (logoImg) logoImg.src = 'icons/icon256.png';
  }
}

// ── State persistence ─────────────────────────────────
async function loadState() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['timesheetState'], (result) => {
      if (result.timesheetState) {
        state = normalizeState({ ...state, ...result.timesheetState });
      } else {
        state = createDefaultState();
      }
      resolve();
    });
  });
}

function createDefaultState() {
  const next = {
    defaultStart: '09:00',
    defaultBreak: '01:30',
    defaultFinish: '18:30',
    savedProjects: ['INTA-3578_Self Study (Hanoi) /147382'],
    settingUrl: 'http://10.145.48.117:9099',
    autoPost: false,
    weekEnding: Core.getWeekEndingDate(),
    auth: { loggedIn: false, username: '' },
    days: {},
  };
  DAYS.forEach((d) => {
    const enabled = DEFAULT_ENABLED.includes(d.code);
    next.days[d.code] = {
      enabled,
      expanded: false,
      tasks: enabled ? [Core.createEmptyTask()] : [],
    };
  });
  return next;
}

function normalizeState(nextState) {
  nextState.defaultStart = Core.normalizeTimeValue(
    nextState.defaultStart || '09:00',
  );
  nextState.defaultBreak = Core.normalizeTimeValue(
    nextState.defaultBreak || '01:30',
  );
  nextState.defaultFinish = Core.normalizeTimeValue(
    nextState.defaultFinish || '18:30',
  );
  nextState.savedProjects = Array.isArray(nextState.savedProjects)
    ? nextState.savedProjects
    : [];
  nextState.themeColor = nextState.themeColor || 'cyan';
  nextState.themeMode = nextState.themeMode || 'dark';
  nextState.settingUrl = (
    nextState.settingUrl || 'http://10.145.48.117:9099'
  ).replace(/\/$/, '');
  nextState.autoPost = nextState.autoPost === true;
  nextState.weekEnding = nextState.weekEnding || Core.getWeekEndingDate();
  nextState.auth = nextState.auth || { loggedIn: false, username: '' };
  nextState.auth.loggedIn = nextState.auth.loggedIn === true;
  nextState.auth.username = nextState.auth.username || '';
  nextState.auth.displayName =
    nextState.auth.displayName || nextState.auth.username || '';
  delete nextState.auth.password;
  nextState.days = nextState.days || {};
  DAYS.forEach((d) => {
    if (!nextState.days[d.code]) {
      nextState.days[d.code] = { enabled: false, expanded: false, tasks: [] };
    }
    if (!Array.isArray(nextState.days[d.code].tasks)) {
      nextState.days[d.code].tasks = [];
    }
  });
  return nextState;
}

async function getConfiguredBaseUrl() {
  return (state.settingUrl || 'http://10.145.48.117:9099').replace(/\/$/, '');
}

async function findTimesheetTab() {
  const baseUrl = await getConfiguredBaseUrl();
  const tabs = await queryTabs({});
  return {
    baseUrl,
    tab: Core.selectTimesheetTab(tabs, baseUrl),
  };
}

function isLoggedIn() {
  return state.auth?.loggedIn === true;
}

function renderAuthScreen() {
  const loginScreen = document.getElementById('loginScreen');
  const appScreen = document.getElementById('appScreen');
  const loginUrl = document.getElementById('loginBaseUrl');
  const loginUsername = document.getElementById('loginUsernameMain');
  if (loginUrl)
    loginUrl.value = state.settingUrl || 'http://10.145.48.117:9099';
  if (loginUsername && state.auth?.username)
    loginUsername.value = state.auth.username;

  if (isLoggedIn()) {
    loginScreen?.classList.add('screen-hidden');
    appScreen?.classList.remove('screen-hidden');
    renderDays();
    renderPresetTab();
    updateActionFooterVisibility('fill');
    initUpdatePanel();
    scheduleLoadExistingTimesheet();
  } else {
    appScreen?.classList.add('screen-hidden');
    loginScreen?.classList.remove('screen-hidden');
  }
}

function setLoginError(message) {
  const el = document.getElementById('loginError');
  if (el) el.textContent = message || '';
}

function dateToDisplay(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}

function displayToDate(value) {
  const match = String(value || '')
    .trim()
    .match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : '';
}

function syncWeekEndingInputs(source) {
  const textInput = document.getElementById('weekEndingInput');
  const picker = document.getElementById('weekEndingPicker');
  if (!textInput || !picker) return;
  if (source === 'picker') {
    textInput.value = dateToDisplay(picker.value) || textInput.value;
  } else {
    picker.value = displayToDate(textInput.value) || '';
  }
  state.weekEnding = textInput.value.trim() || Core.getWeekEndingDate();
}


let lastLoadedWeekEnding = '';
let loadExistingTimer = null;

function scheduleLoadExistingTimesheet() {
  clearTimeout(loadExistingTimer);
  loadExistingTimer = setTimeout(() => loadExistingTimesheetIntoForm(), 250);
}


function showTimesheetLoadOverlay(text = 'Đang tải dữ liệu timesheet...') {
  const overlay = document.getElementById('timesheetLoadOverlay');
  const textEl = document.getElementById('timesheetLoadText');
  if (!overlay) return;
  if (textEl) textEl.textContent = text;
  overlay.classList.add('show');
}

function hideTimesheetLoadOverlay() {
  document.getElementById('timesheetLoadOverlay')?.classList.remove('show');
}

function resetTimesheetFormForWeek() {
  DAYS.forEach((day) => {
    state.days[day.code] = {
      enabled: false,
      expanded: false,
      tasks: [],
    };
  });
}

async function loadExistingTimesheetIntoForm() {
  if (!isLoggedIn()) return;
  const weekEnding = state.weekEnding || Core.getWeekEndingDate();
  if (!weekEnding || lastLoadedWeekEnding === weekEnding) return;
  lastLoadedWeekEnding = weekEnding;

  showTimesheetLoadOverlay(`Đang tải timesheet ${weekEnding}...`);
  let result;
  try {
    result = await chrome.runtime.sendMessage({
      action: 'loadExistingTimesheet',
      weekEnding,
    });
  } catch (e) {
    console.warn('[Timesheet Detail] load failed', e);
    return;
  } finally {
    hideTimesheetLoadOverlay();
  }

  if (!result?.success) {
    if (result?.needLogin) showToast('Phiên đăng nhập hết hạn, hãy đăng nhập lại', 'error');
    else if (result?.message) console.warn('[Timesheet Detail] load failed:', result.message);
    return;
  }

  if (!result.found || !result.hasData) {
    resetTimesheetFormForWeek();
    await persistState();
    renderDays();
    showToast('Không có timesheet cho tuần này, đã reset form', 'info');
    return;
  }
  applyExistingTimesheet(result.days || {});
  await persistState();
  renderDays();
  showToast(`Đã load dữ liệu từ timesheet #${result.record?.id}`, 'success');
}

function applyExistingTimesheet(days) {
  DAYS.forEach((day) => {
    const tasks = Array.isArray(days[day.code]) ? days[day.code] : [];
    state.days[day.code] = state.days[day.code] || { enabled: false, expanded: false, tasks: [] };
    if (tasks.length > 0) {
      state.days[day.code].enabled = true;
      state.days[day.code].expanded = true;
      state.days[day.code].tasks = tasks.map((task) => ({
        project: task.project || '',
        task: task.task || '',
        workHours: task.workHours || '',
        startTime: task.startTime || '',
        breakTime: task.breakTime || '',
        finishTime: task.finishTime || '',
      }));
      tasks.forEach((task) => {
        if (task.project && !state.savedProjects.includes(task.project)) {
          state.savedProjects.push(task.project);
        }
      });
    } else {
      state.days[day.code].enabled = false;
      state.days[day.code].expanded = false;
      state.days[day.code].tasks = [];
    }
  });
}

async function saveState(options = {}) {
  if (options.collect !== false) collectFromDOM();
  return persistState();
}

async function persistState() {
  return new Promise((resolve) => {
    chrome.storage.local.set({ timesheetState: state }, resolve);
  });
}

function collectFromDOM() {
  state.settingUrl = (
    document.getElementById('settingUrl')?.value ||
    document.getElementById('loginBaseUrl')?.value ||
    state.settingUrl ||
    'http://10.145.48.117:9099'
  ).replace(/\/$/, '');
  state.autoPost = document.getElementById('settingAutoPost')?.checked === true;
  state.weekEnding =
    document.getElementById('weekEndingInput')?.value.trim() ||
    state.weekEnding ||
    Core.getWeekEndingDate();
  state.defaultStart =
    document.getElementById('defaultStart')?.value || state.defaultStart;
  state.defaultBreak =
    document.getElementById('defaultBreak')?.value || state.defaultBreak;
  state.defaultFinish =
    document.getElementById('defaultFinish')?.value || state.defaultFinish;

  DAYS.forEach((d) => {
    if (!state.days[d.code]) return;
    const container = document.getElementById(`tasks-${d.code}`);
    if (!container) return;

    const rows = container.querySelectorAll('.task-row');
    state.days[d.code].tasks = Array.from(rows).map((row, i) => ({
      project: row.querySelector(`[data-field="project"]`)?.value || '',
      task: row.querySelector(`[data-field="task"]`)?.value || '',
      workHours: row.querySelector(`[data-field="workHours"]`)?.value || '',
      startTime: row.querySelector(`[data-field="startTime"]`)?.value || '',
      breakTime: row.querySelector(`[data-field="breakTime"]`)?.value || '',
      finishTime: row.querySelector(`[data-field="finishTime"]`)?.value || '',
    }));
  });
}

// ── Render days ───────────────────────────────────────
function renderDays() {
  const container = document.getElementById('daysContainer');
  container.innerHTML = '';

  // Sync defaults from state to inputs
  document.getElementById('defaultStart').value = state.defaultStart;
  document.getElementById('defaultBreak').value = state.defaultBreak;
  document.getElementById('defaultFinish').value = state.defaultFinish;
  document.getElementById('weekEndingInput').value =
    state.weekEnding || Core.getWeekEndingDate();
  syncWeekEndingInputs('text');
  if (state.settingUrl) {
    const urlInput = document.getElementById('settingUrl');
    const loginUrlInput = document.getElementById('loginBaseUrl');
    if (urlInput) urlInput.value = state.settingUrl;
    if (loginUrlInput) loginUrlInput.value = state.settingUrl;
  }
  const autoPostInput = document.getElementById('settingAutoPost');
  if (autoPostInput) autoPostInput.checked = state.autoPost === true;

  DAYS.forEach((d) => {
    const dayState = state.days[d.code] || {
      enabled: false,
      expanded: false,
      tasks: [],
    };
    const card = buildDayCard(d, dayState);
    container.appendChild(card);
  });
}

function buildDayCard(day, dayState) {
  const { code, label, short } = day;
  const enabled = dayState.enabled;
  const expanded = dayState.expanded && enabled;
  const taskCount = (dayState.tasks || []).length;
  const showWorkHours = taskCount > 1;

  const card = document.createElement('div');
  card.className = `day-card${enabled ? ' has-tasks' : ''}${!enabled ? ' disabled' : ''}`;
  card.id = `day-card-${code}`;

  card.innerHTML = `
    <div class="day-header" id="day-header-${code}">
      <div class="day-toggle${enabled ? ' on' : ''}" id="toggle-${code}" title="Bật/tắt ngày này">
        <div class="day-toggle-thumb"></div>
      </div>
      <span class="day-name">${label} <span style="color:var(--text-3);font-weight:400;font-size:11px;">${short}</span></span>
      ${enabled ? `<span class="day-badge active">${taskCount} task${taskCount !== 1 ? 's' : ''}</span>` : `<span class="day-badge">off</span>`}
      <span class="day-chevron${expanded ? ' open' : ''}">⌄</span>
    </div>
    <div class="day-body${expanded ? ' open' : ''}" id="body-${code}">
      <div class="tasks-container" id="tasks-${code}">
        ${(dayState.tasks || []).map((t, i) => buildTaskRow(code, i, t, showWorkHours)).join('')}
      </div>
      <div class="task-actions-row">
        <button class="btn-add-task" data-day="${code}" type="button">+ Add task</button>
        ${showWorkHours ? `<button class="btn-auto-time" data-day="${code}" type="button">Auto time</button>` : ''}
      </div>
    </div>
  `;

  // Events
  // Toggle enable/disable
  card.querySelector(`#toggle-${code}`).addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDay(code);
  });

  // Expand/collapse
  card.querySelector(`#day-header-${code}`).addEventListener('click', (e) => {
    if (e.target.closest(`#toggle-${code}`)) return;
    if (state.days[code]?.enabled) toggleExpand(code);
  });

  card.querySelector('.btn-add-task')?.addEventListener('click', (e) => {
    e.stopPropagation();
    addTask(code);
  });

  return card;
}

function buildTaskRow(dayCode, index, taskData = {}, showWorkHours = false) {
  const projectOptions = Core.collectProjectOptions(
    state.savedProjects,
    taskData.project,
  );
  return `
    <div class="task-row" id="task-row-${dayCode}-${index}">
      <div class="task-row-header">
        <span class="task-index">Task #${index + 1}</span>
        ${index > 0 ? `<button class="btn-remove-task" data-day="${dayCode}" data-index="${index}" title="Xoá task này">✕</button>` : ''}
      </div>
      <div class="task-fields">
        <div class="project-select-row">
          <select class="text-input project-select" data-field="project">
            <option value="">Không điền project</option>
            ${projectOptions
              .map(
                (project) => `
              <option value="${escHtml(project)}"${project === taskData.project ? ' selected' : ''}>${escHtml(project)}</option>
            `,
              )
              .join('')}
          </select>
          <button class="btn-apply-all btn-apply-project" data-day="${dayCode}" data-index="${index}" title="Apply project này cho các ngày đang bật">
            <span aria-hidden="true">⇉</span><span class="apply-all-text">Apply All</span>
          </button>
        </div>
        <div class="task-apply-row">
          <textarea class="text-input" data-field="task"
            placeholder="Mô tả công việc...">${escHtml(taskData.task || '')}</textarea>
          <button class="btn-apply-all btn-apply-task" data-day="${dayCode}" data-index="${index}" title="Apply nội dung task này cho các ngày đang bật">
            <span aria-hidden="true">⇉</span><span class="apply-all-text">Apply All</span>
          </button>
        </div>
        ${
          showWorkHours
            ? `
          <div class="work-hours-row">
            <span class="work-hours-label">Hours</span>
            <input type="number" class="time-input" data-field="workHours"
              min="0.25" step="0.25" placeholder="vd: 2.5"
              value="${escHtml(taskData.workHours || '')}" style="font-size:12px;padding:5px 7px;" />
          </div>
        `
            : ''
        }
        <div class="time-row">
          <div class="time-field-mini">
            <span class="time-label-mini">Start</span>
            <input type="text" class="time-input" data-field="startTime"
              placeholder="default" value="${escHtml(taskData.startTime || '')}" style="font-size:12px;padding:5px 7px;" />
            <span class="time-hint green">↳ ${state.defaultStart}</span>
          </div>
          <div class="time-field-mini">
            <span class="time-label-mini">Break</span>
            <input type="text" class="time-input" data-field="breakTime"
              placeholder="default" value="${escHtml(taskData.breakTime || '')}" style="font-size:12px;padding:5px 7px;" />
            <span class="time-hint green">↳ ${state.defaultBreak}</span>
          </div>
          <div class="time-field-mini">
            <span class="time-label-mini">Finish</span>
            <input type="text" class="time-input" data-field="finishTime"
              placeholder="default" value="${escHtml(taskData.finishTime || '')}" style="font-size:12px;padding:5px 7px;" />
            <span class="time-hint green">↳ ${state.defaultFinish}</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Day actions ───────────────────────────────────────
function toggleDay(code) {
  collectFromDOM();
  const d = state.days[code];
  d.enabled = !d.enabled;
  if (d.enabled) {
    d.expanded = true;
    if (!d.tasks || d.tasks.length === 0) {
      d.tasks = [Core.createEmptyTask()];
    }
  } else {
    d.expanded = false;
  }
  persistState().then(() => renderDays());
}

function toggleExpand(code) {
  collectFromDOM();
  state.days[code].expanded = !state.days[code].expanded;
  persistState().then(() => renderDays());
}

function addTask(code) {
  collectFromDOM();
  Core.addTaskToDay(state, code);
  persistState().then(() => renderDays());
}

// ── Global events ─────────────────────────────────────
function bindGlobalEvents() {
  // Tab switching
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document
        .querySelectorAll('.tab-btn')
        .forEach((b) => b.classList.remove('active'));
      document
        .querySelectorAll('.tab-panel')
        .forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
      updateActionFooterVisibility(btn.dataset.tab);
      if (btn.dataset.tab === 'presets') renderPresetTab();
    });
  });

  // Remove task buttons (delegated)
  document.getElementById('daysContainer').addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-remove-task');
    if (!btn) return;
    collectFromDOM();
    const { day, index } = btn.dataset;
    const idx = parseInt(index);
    Core.removeTaskFromDay(state, day, idx);
    persistState().then(() => renderDays());
  });

  document.getElementById('daysContainer').addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-auto-time');
    if (!btn) return;
    collectFromDOM();
    try {
      const result = Core.scheduleTasksForDay(state, DAYS, btn.dataset.day, {
        startTime: state.defaultStart,
      });
      persistState().then(() => renderDays());
      showToast(`Đã auto time ${result.segments} task row`, 'success');
    } catch (err) {
      showToast(err.message || 'Không auto time được', 'error');
    }
  });

  document.getElementById('daysContainer').addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-apply-project');
    if (!btn) return;
    collectFromDOM();
    const idx = parseInt(btn.dataset.index, 10);
    const project = state.days[btn.dataset.day]?.tasks?.[idx]?.project || '';
    if (!project) {
      showToast('Chọn project trước khi set all', 'info');
      return;
    }
    Core.setProjectForAllDays(state, DAYS, idx, project);
    persistState().then(() => renderDays());
    showToast('Đã set project cho các ngày đang bật', 'success');
  });

  document.getElementById('daysContainer').addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-apply-task');
    if (!btn) return;
    collectFromDOM();
    const idx = parseInt(btn.dataset.index, 10);
    const task = state.days[btn.dataset.day]?.tasks?.[idx]?.task || '';
    if (!task.trim()) {
      showToast('Nhập nội dung task trước khi apply all', 'info');
      return;
    }
    Core.setTaskForAllDays(state, DAYS, idx, task);
    persistState().then(() => renderDays());
    showToast('Đã set nội dung task cho các ngày đang bật', 'success');
  });

  // Default time changes → update hints
  ['defaultStart', 'defaultBreak', 'defaultFinish'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', () => {
      collectFromDOM();
      // Update hints in task rows
      document.querySelectorAll('.time-hint.green').forEach((hint, i) => {
        const hints = [
          state.defaultStart,
          state.defaultBreak,
          state.defaultFinish,
        ];
        hint.textContent = '↳ ' + hints[i % 3];
      });
    });
  });
  document.getElementById('weekEndingInput')?.addEventListener('change', () => {
    syncWeekEndingInputs('text');
    collectFromDOM();
    resetTimesheetFormForWeek();
    lastLoadedWeekEnding = '';
    persistState();
    renderDays();
    scheduleLoadExistingTimesheet();
  });
  document
    .getElementById('weekEndingPicker')
    ?.addEventListener('change', (e) => {
      const val = e.target.value; // YYYY-MM-DD
      if (!val) return;
      const d = new Date(val + 'T00:00:00');
      // Snap to nearest Sunday (forward)
      const dow = d.getDay(); // 0=Sun
      if (dow !== 0) {
        d.setDate(d.getDate() + (7 - dow));
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        e.target.value = `${yyyy}-${mm}-${dd}`;
      }
      syncWeekEndingInputs('picker');
      collectFromDOM();
      resetTimesheetFormForWeek();
      lastLoadedWeekEnding = '';
      persistState();
      renderDays();
      scheduleLoadExistingTimesheet();
    });

  // Footer buttons
  document.getElementById('btnOpenTab').addEventListener('click', openInTab);
  document.getElementById('btnHelp').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  document.getElementById('btnClear').addEventListener('click', clearForm);

  // Preset save
  document
    .getElementById('btnSavePreset')
    .addEventListener('click', savePreset);
  document
    .getElementById('btnSearchProjects')
    .addEventListener('click', searchProjectsFromPage);
  document.getElementById('projectKeyword').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') searchProjectsFromPage();
  });
  document
    .getElementById('projectKeyword')
    .addEventListener('input', clearProjectResultsWhenBlank);
  document
    .getElementById('projectResults')
    .addEventListener('click', handleProjectResultClick);
  document
    .getElementById('savedProjectsContainer')
    .addEventListener('click', handleSavedProjectClick);

  // Settings
  document.getElementById('btnExport').addEventListener('click', exportConfig);
  document
    .getElementById('btnImport')
    .addEventListener('click', () =>
      document.getElementById('importInput').click(),
    );
  document
    .getElementById('importInput')
    .addEventListener('change', importConfig);
  document
    .getElementById('btnClearAll')
    .addEventListener('click', clearAllData);
  document
    .getElementById('btnCheckUpdate')
    .addEventListener('click', checkForUpdates);
  document
    .getElementById('btnCopyUpdate')
    .addEventListener('click', copyUpdateCommand);
  document
    .getElementById('btnOpenRepo')
    .addEventListener('click', () => chrome.tabs.create({ url: REPO_URL }));
  document.getElementById('settingUrl').addEventListener('change', (e) => {
    state.settingUrl = e.target.value.replace(/\/$/, '');
    document.getElementById('loginBaseUrl').value = state.settingUrl;
    chrome.runtime.sendMessage({ action: 'setBaseUrl', url: state.settingUrl });
    saveState();
  });
  document
    .getElementById('settingAutoPost')
    ?.addEventListener('change', (e) => {
      state.autoPost = e.target.checked;
      saveState();
    });

  // Theme mode toggle
  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      state.themeMode = mode;
      applyThemeMode(mode);
      persistState();
    });
  });

  // Theme selector
  document.querySelectorAll('.theme-swatch').forEach((sw) => {
    sw.addEventListener('click', () => {
      const id = sw.dataset.theme;
      state.themeColor = id;
      applyTheme(id);
      persistState();
    });
  });
}

async function openInTab(options = {}) {
  const url = Core.getPopupPageUrl(chrome.runtime.getURL('popup.html'));
  await chrome.tabs.create({ url });
  if (
    options.keepPopupOpen !== true &&
    Core.shouldClosePopupAfterOpen(window.location.search)
  ) {
    window.close();
  }
}

function updateActionFooterVisibility(activeTab) {
  const footer = document.getElementById('actionFooter');
  if (!footer) return;
  footer.style.display = activeTab === 'fill' ? 'flex' : 'none';
}

async function executeScriptInTab(tabId, func) {
  if (chrome.scripting?.executeScript) {
    const frames = await chrome.scripting.executeScript({
      target: { tabId },
      func,
    });
    return frames.flatMap((frame) =>
      Array.isArray(frame.result) ? frame.result : [],
    );
  }
  return new Promise((resolve, reject) => {
    chrome.tabs.executeScript(
      tabId,
      { code: `(${func.toString()})()` },
      (results) => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else
          resolve(
            (results || []).flatMap((result) =>
              Array.isArray(result) ? result : [],
            ),
          );
      },
    );
  });
}

function initUpdatePanel() {
  const current = chrome.runtime.getManifest().version;
  const currentEl = document.getElementById('currentVersion');
  if (currentEl) currentEl.textContent = current;
  checkForUpdates();
}

async function checkForUpdates() {
  const current = chrome.runtime.getManifest().version;
  const latestEl = document.getElementById('latestVersion');
  const statusEl = document.getElementById('updateStatus');
  const actionsEl = document.getElementById('updateActions');
  const checkBtn = document.getElementById('btnCheckUpdate');

  latestEl.textContent = 'Đang kiểm tra...';
  statusEl.className = 'update-status';
  statusEl.textContent = 'Đang kiểm tra cập nhật từ GitHub...';
  actionsEl.classList.remove('show');
  checkBtn.disabled = true;

  try {
    const res = await fetch(`${CHANGELOG_URL}?t=${Date.now()}`, {
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const changelog = await res.text();
    const latest = Core.getLatestVersionFromChangelog(changelog);
    if (!latest) throw new Error('Không tìm thấy version trong CHANGELOG.md');

    latestEl.textContent = latest;
    const comparison = Core.compareVersions(current, latest);
    if (comparison < 0) {
      statusEl.className = 'update-status available';
      statusEl.textContent = `Có bản cập nhật mới ${latest}. Chạy ${UPDATE_COMMAND} trong thư mục extension, sau đó reload extension ở chrome://extensions.`;
      actionsEl.classList.add('show');
    } else {
      statusEl.className = 'update-status current';
      statusEl.textContent = 'Bạn đang dùng phiên bản mới nhất.';
    }
  } catch (err) {
    latestEl.textContent = '-';
    statusEl.className = 'update-status';
    statusEl.textContent =
      'Không kiểm tra được version mới. Hãy kiểm tra kết nối mạng hoặc quyền truy cập GitHub raw.';
  } finally {
    checkBtn.disabled = false;
  }
}

async function copyUpdateCommand() {
  const command = `cd /d "%~dp0"\r\ngit pull --ff-only\r\n`;
  try {
    await navigator.clipboard.writeText(`${UPDATE_COMMAND}\n\n${command}`);
    showToast('Đã copy hướng dẫn update', 'success');
  } catch (e) {
    showToast(`Chạy file ${UPDATE_COMMAND} trong thư mục extension`, 'info');
  }
}

// ── Fill action ───────────────────────────────────────
async function runFill() {
  collectFromDOM();
  await saveState();

  const btn = document.getElementById('btnFill');
  btn.disabled = true;
  btn.classList.add('loading');
  btn.innerHTML = '<div class="spinner"></div> Đang điền...';

  // Resolve timesheet page. In tab view, the active tab is the extension page.
  let tab;
  let baseUrl;
  try {
    const target = await findTimesheetTab();
    tab = target.tab;
    baseUrl = target.baseUrl;
  } catch (e) {
    showToast('Không lấy được danh sách tab', 'error');
    resetBtn();
    return;
  }

  if (!tab?.id) {
    showToast('Hãy mở trang Timesheet trước', 'error');
    resetBtn();
    return;
  }

  // Build config
  const config = {
    defaultStartTime: state.defaultStart,
    defaultBreakTime: state.defaultBreak,
    defaultFinishTime: state.defaultFinish,
    defaultProject: '',
    weekEnding: state.weekEnding || Core.getWeekEndingDate(),
    autoPost: state.autoPost === true,
    days: [],
  };

  DAYS.forEach((d) => {
    const ds = state.days[d.code];
    if (!ds?.enabled || !ds.tasks?.length) return;
    config.days.push({ dayCode: d.code, tasks: ds.tasks });
  });

  if (config.days.length === 0) {
    showToast('Chưa có ngày nào được bật', 'info');
    resetBtn();
    return;
  }

  // Send to content script
  try {
    const result = await chrome.tabs.sendMessage(tab.id, {
      action: 'fillTimesheet',
      config,
    });
    if (result?.success) {
      showToast(`✓ ${result.message}`, 'success');
    } else if (result?.postResult?.success === false) {
      showToast(
        result.postResult.message || 'Fill xong nhưng submit lỗi',
        'error',
      );
    } else {
      showToast(result?.message || 'Có lỗi xảy ra', 'error');
    }
  } catch (e) {
    showToast('Không kết nối được trang. Reload trang thử lại.', 'error');
  }

  resetBtn();

  function resetBtn() {
    btn.disabled = false;
    btn.classList.remove('loading');
    btn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M5 12l5 5L20 7"/></svg> Điền timesheet';
  }
}

// ── Clear form ────────────────────────────────────────
async function clearForm() {
  collectFromDOM();
  Core.clearTasks(state, DAYS);
  await persistState();
  renderDays();

  // Also clear on page
  try {
    const target = await findTimesheetTab();
    if (target.tab?.id) {
      await chrome.tabs.sendMessage(target.tab.id, { action: 'clearForm' });
    }
  } catch (e) {
    // Ignore if tab not connected
  }

  showToast('Đã xoá form', 'info');
}

// ── Presets ───────────────────────────────────────────
async function loadPresets() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['timesheetPresets'], (r) =>
      resolve(r.timesheetPresets || []),
    );
  });
}

async function savePresets(presets) {
  return new Promise((resolve) =>
    chrome.storage.local.set({ timesheetPresets: presets }, resolve),
  );
}

async function renderPresetTab() {
  renderSavedProjects();
  await renderPresets();
}

function renderSavedProjects() {
  const container = document.getElementById('savedProjectsContainer');
  if (!container) return;
  const projects = state.savedProjects || [];
  if (projects.length === 0) {
    container.innerHTML =
      '<div class="empty-presets" style="padding:10px 0;">Chưa lưu project nào.</div>';
    return;
  }
  container.innerHTML = projects
    .map(
      (project) => `
    <div class="saved-project">
      <span class="project-name" title="${escHtml(project)}">${escHtml(project)}</span>
      <button class="project-mini-btn danger" data-project="${escHtml(project)}">Xoá</button>
    </div>
  `,
    )
    .join('');
}

async function renderPresets() {
  const presets = await loadPresets();
  const container = document.getElementById('presetsContainer');
  container.innerHTML = '';

  if (presets.length === 0) {
    container.innerHTML = `
      <div class="empty-presets">
        <div class="big-icon">◈</div>
        <p>Chưa có preset nào.<br>Điền task rồi lưu thành preset!</p>
      </div>`;
    return;
  }

  presets.forEach((preset, idx) => {
    const activeDays =
      preset.days?.map(
        (d) => d.dayCode.toUpperCase().slice(0, 1) + d.dayCode.slice(1, 3),
      ) || [];
    const card = document.createElement('div');
    card.className = 'preset-card';
    card.innerHTML = `
      <div class="preset-card-header">
        <span class="preset-name">${escHtml(preset.name)}</span>
        <span style="font-size:10px;color:var(--text-3);font-family:'DM Mono',monospace;">${preset.defaultStartTime}–${preset.defaultFinishTime}</span>
      </div>
      <div class="preset-days-badges">
        ${activeDays.map((d) => `<span class="preset-day-pill">${d}</span>`).join('')}
      </div>
      <div class="preset-actions">
        <button class="preset-btn-apply" data-idx="${idx}">▶ Áp dụng</button>
        <button class="preset-btn-delete" data-idx="${idx}">✕</button>
      </div>
    `;

    card
      .querySelector('.preset-btn-apply')
      .addEventListener('click', () => applyPreset(idx));
    card
      .querySelector('.preset-btn-delete')
      .addEventListener('click', () => deletePreset(idx));
    container.appendChild(card);
  });
}

async function searchProjectsFromPage() {
  const keywordInput = document.getElementById('projectKeyword');
  const keyword = keywordInput.value.trim();
  const container = document.getElementById('projectResults');
  if (!keyword) {
    showToast('Nhập keyword project', 'info');
    return;
  }

  container.innerHTML =
    '<div class="empty-presets" style="padding:8px 0;">Đang tìm...</div>';
  try {
    let projects = [];
    const bgResult = await chrome.runtime.sendMessage({
      action: 'searchProjects',
      keyword,
      limit: 30,
    });
    if (bgResult?.success) {
      projects = bgResult.projects || [];
    } else {
      if (bgResult?.debug)
        console.warn('[Project Search] background debug', bgResult.debug);
      const { tab } = await findTimesheetTab();
      if (!tab?.id)
        throw new Error(bgResult?.message || 'Không có dữ liệu project');
      const sources = await executeScriptInTab(tab.id, () => {
        const scripts = Array.from(document.scripts).map(
          (script) => script.textContent || '',
        );
        scripts.push(document.documentElement.innerHTML || '');
        return scripts;
      });
      projects = Core.searchProjectSources(sources, keyword);
    }

    if (projects.length === 0) {
      container.innerHTML =
        '<div class="empty-presets" style="padding:8px 0;">Không tìm thấy project.</div>';
      return;
    }
    container.innerHTML = projects
      .map(
        (project) => `
      <div class="project-result">
        <span class="project-name" title="${escHtml(project)}">${escHtml(project)}</span>
        <button class="project-mini-btn" data-project="${escHtml(project)}">Add</button>
      </div>
    `,
      )
      .join('');
  } catch (e) {
    container.innerHTML = '';
    showToast(e.message || 'Không load được project data', 'error');
  }
}

function clearProjectResultsWhenBlank(e) {
  if (!Core.isBlankSearch(e.target.value)) return;
  document.getElementById('projectResults').innerHTML = '';
}

async function handleProjectResultClick(e) {
  const btn = e.target.closest('.project-mini-btn');
  if (!btn) return;
  const added = Core.addSavedProject(state, btn.dataset.project);
  if (!added) {
    showToast('Project đã tồn tại', 'info');
    return;
  }
  await persistState();
  renderSavedProjects();
  renderDays();
  showToast('Đã thêm project vào preset', 'success');
}

async function handleSavedProjectClick(e) {
  const btn = e.target.closest('.project-mini-btn.danger');
  if (!btn) return;
  Core.removeSavedProject(state, btn.dataset.project);
  await persistState();
  renderSavedProjects();
  renderDays();
  showToast('Đã xoá project', 'info');
}

async function savePreset() {
  collectFromDOM();

  const name = prompt('Đặt tên cho preset này:');
  if (!name || !name.trim()) return;

  const config = {
    name: name.trim(),
    defaultStartTime: state.defaultStart,
    defaultBreakTime: state.defaultBreak,
    defaultFinishTime: state.defaultFinish,
    savedProjects: [...(state.savedProjects || [])],
    days: [],
  };

  DAYS.forEach((d) => {
    const ds = state.days[d.code];
    if (ds?.enabled && ds.tasks?.length > 0) {
      config.days.push({ dayCode: d.code, tasks: [...ds.tasks] });
    }
  });

  const presets = await loadPresets();
  presets.push(config);
  await savePresets(presets);
  renderPresetTab();
  showToast(`Đã lưu preset "${name.trim()}"`, 'success');
}

async function applyPreset(idx) {
  const presets = await loadPresets();
  const preset = presets[idx];
  if (!preset) return;

  // Apply to state
  state.defaultStart = preset.defaultStartTime;
  state.defaultBreak = preset.defaultBreakTime;
  state.defaultFinish = preset.defaultFinishTime;
  state.savedProjects = Core.collectProjectOptions(state.savedProjects, '')
    .concat(preset.savedProjects || [])
    .filter((project, index, projects) => projects.indexOf(project) === index)
    .sort((a, b) => a.localeCompare(b));

  // Reset all days
  DAYS.forEach((d) => {
    state.days[d.code] = { enabled: false, expanded: false, tasks: [] };
  });

  preset.days.forEach((pd) => {
    state.days[pd.dayCode] = {
      enabled: true,
      expanded: true,
      tasks: pd.tasks || [Core.createEmptyTask()],
    };
  });

  await persistState();

  // Switch to fill tab
  document
    .querySelectorAll('.tab-btn')
    .forEach((b) => b.classList.remove('active'));
  document
    .querySelectorAll('.tab-panel')
    .forEach((p) => p.classList.remove('active'));
  document.querySelector('[data-tab="fill"]').classList.add('active');
  document.getElementById('tab-fill').classList.add('active');
  updateActionFooterVisibility('fill');

  renderDays();
  showToast(`Đã áp dụng preset "${preset.name}"`, 'success');
}

async function deletePreset(idx) {
  const presets = await loadPresets();
  const name = presets[idx]?.name;
  if (!confirm(`Xoá preset "${name}"?`)) return;
  presets.splice(idx, 1);
  await savePresets(presets);
  renderPresetTab();
  showToast(`Đã xoá preset "${name}"`, 'info');
}

// ── Export / Import ───────────────────────────────────
async function exportConfig() {
  collectFromDOM();
  const presets = await loadPresets();
  const data = { state, presets, exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `timesheet-config-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Đã xuất config', 'success');
}

async function importConfig(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (data.state) {
      state = normalizeState({ ...state, ...data.state });
      await persistState();
    }
    if (data.presets) {
      await savePresets(data.presets);
    }
    applyTheme(state.themeColor || 'cyan');
    applyThemeMode(state.themeMode || 'dark');
    renderDays();
    renderPresetTab();
    showToast('Đã nhập config thành công', 'success');
  } catch (e) {
    showToast('File không hợp lệ', 'error');
  }
  e.target.value = '';
}

async function clearAllData() {
  if (!confirm('Xoá toàn bộ dữ liệu và preset?')) return;
  await new Promise((r) => chrome.storage.local.clear(r));
  state = createDefaultState();
  await persistState();
  applyTheme(state.themeColor || 'cyan');
  applyThemeMode(state.themeMode || 'dark');
  renderDays();
  renderPresetTab();
  showToast('Đã xoá toàn bộ dữ liệu', 'info');
}

// ── Toast ─────────────────────────────────────────────
let toastTimeout;
function showToast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    el.classList.remove('show');
  }, 2800);
}

// ── Headless submit (không cần mở tab) ────────────────────────────
async function runHeadlessSubmit() {
  collectFromDOM();
  await saveState();

  const btn = document.getElementById('btnHeadlessSubmit');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Đang gửi...';

  // Build config giống runFill
  const config = {
    defaultStartTime: state.defaultStart,
    defaultBreakTime: state.defaultBreak,
    defaultFinishTime: state.defaultFinish,
    weekEnding: document.getElementById('weekEndingInput')?.value || '',
    days: DAYS.filter(
      (d) => state.days[d.code]?.enabled && state.days[d.code]?.tasks?.length,
    ).map((d) => ({ dayCode: d.code, tasks: state.days[d.code].tasks })),
  };

  if (config.days.length === 0) {
    showToast('Chưa có ngày nào được bật', 'info');
    resetBtn();
    return;
  }

  const result = await chrome.runtime.sendMessage({
    action: 'submitTimesheetHeadless',
    config,
  });

  if (result?.needLogin) {
    if (result.debug) console.warn('[Submit Timesheet] debug', result.debug);
    showToast(
      result.message || 'Phiên đăng nhập không hợp lệ, hãy đăng nhập lại',
      'error',
    );
  } else if (result?.success) {
    showToast(result.message, 'success');
    if (result.detailUrl) showSubmitSuccessPanel(result.detailUrl);
  } else {
    showToast(result?.message || 'Lỗi không xác định', 'error');
  }

  resetBtn();
  function resetBtn() {
    btn.disabled = false;
    btn.innerHTML = '☁ Submit timesheet';
  }
}

// ── Login panel ────────────────────────────────────────────────────
function showSubmitSuccessPanel(detailUrl) {
  lastSubmitDetailUrl = detailUrl || '';
  document.getElementById('submitSuccessPanel')?.classList.add('show');
}

function hideSubmitSuccessPanel() {
  document.getElementById('submitSuccessPanel')?.classList.remove('show');
}

async function openSubmitDetail() {
  if (!lastSubmitDetailUrl) return;
  await chrome.tabs.create({ url: lastSubmitDetailUrl });
  hideSubmitSuccessPanel();
}

function showLoginPanel() {
  document.getElementById('loginPanel').classList.add('show');
}

function hideLoginPanel() {
  document.getElementById('loginPanel').classList.remove('show');
}

// ── Update login indicator UI ─────────────────────────────────────────────
function updateLoginIndicator(loggedIn, displayName, expired = false) {
  const indicator = document.getElementById('loginIndicator');
  const logoutBtn = document.getElementById('btnLogout');
  if (!indicator) return;

  if (loggedIn) {
    indicator.className = 'login-indicator logged-in';
    indicator.textContent = `✓ ${displayName || 'User'}`;
    if (logoutBtn) logoutBtn.style.display = 'inline-flex';
  } else if (expired) {
    indicator.className = 'login-indicator expired';
    indicator.textContent = 'Phiên hết hạn';
    if (logoutBtn) logoutBtn.style.display = 'none';
  } else {
    indicator.className = 'login-indicator';
    indicator.textContent = 'Chưa đăng nhập';
    if (logoutBtn) logoutBtn.style.display = 'none';
  }
}

async function checkLoginStatus() {
  let result = { loggedIn: false };
  try {
    result = await chrome.runtime.sendMessage({ action: 'checkSession' });
  } catch (e) {
    result = { loggedIn: false };
  }
  const indicator = document.getElementById('loginIndicator');
  const logoutBtn = document.getElementById('btnLogout');
  const headlessBtn = document.getElementById('btnHeadlessSubmit');

  const sessionName =
    result?.session?.employeeName || result?.session?.employeeCode || '';
  state.auth = {
    loggedIn: result?.loggedIn === true,
    username: result?.session?.employeeCode || state.auth?.username || '',
    displayName:
      sessionName || state.auth?.displayName || state.auth?.username || '',
    lastLoginAt: result?.session?.loginAt || state.auth?.lastLoginAt || null,
  };
  await persistState();

  if (state.auth.loggedIn) {
    indicator.className = 'login-indicator logged-in';
    indicator.textContent = `✓ ${state.auth.displayName || state.auth.username || 'User'}`;
    if (logoutBtn) logoutBtn.style.display = 'inline-flex';
    if (headlessBtn) headlessBtn.disabled = false;
  } else {
    indicator.className = 'login-indicator';
    indicator.textContent = 'Chưa đăng nhập';
    if (logoutBtn) logoutBtn.style.display = 'none';
    if (headlessBtn) headlessBtn.disabled = true;
  }
}

async function doLogin() {
  const mainUsername = document.getElementById('loginUsernameMain');
  const mainPassword = document.getElementById('loginPasswordMain');
  const panelUsername = document.getElementById('loginUsername');
  const panelPassword = document.getElementById('loginPassword');
  const baseUrl = (
    document.getElementById('loginBaseUrl')?.value ||
    state.settingUrl ||
    ''
  )
    .trim()
    .replace(/\/$/, '');
  const username = (mainUsername?.value || panelUsername?.value || '').trim();
  const password = mainPassword?.value || panelPassword?.value || '';
  if (!baseUrl || !username || !password) {
    setLoginError('Nhập URL, username và password');
    showToast('Nhập URL, username và password', 'info');
    return;
  }

  state.settingUrl = baseUrl;
  setLoginError('');
  const btn =
    document.getElementById('btnLoginMain') ||
    document.getElementById('btnDoLogin');
  btn.disabled = true;
  btn.textContent = 'Đang đăng nhập...';

  try {
    await chrome.runtime.sendMessage({ action: 'setBaseUrl', url: baseUrl });
    let result = await chrome.runtime.sendMessage({
      action: 'login',
      username,
      password,
    });
    if (!result?.success) {
      result = await loginViaTimesheetTab(baseUrl, username, password);
    }

    if (result?.success) {
      state.auth = {
        loggedIn: true,
        username: result.session?.employeeCode || username,
        displayName:
          result.session?.employeeName ||
          result.session?.employeeCode ||
          username,
        lastLoginAt: Date.now(),
      };
      await persistState();
      hideLoginPanel();
      // Skip verifySession here — we just logged in, session is guaranteed valid.
      // Directly update indicator and switch screen.
      updateLoginIndicator(true, state.auth.displayName || state.auth.username);
      renderAuthScreen();
      showToast('Đăng nhập thành công ✓', 'success');
      if (mainPassword) mainPassword.value = '';
      if (panelPassword) panelPassword.value = '';
    } else {
      const message = formatLoginError(result);
      setLoginError(message);
      showToast(message, 'error');
    }
  } catch (e) {
    setLoginError(e.message || 'Đăng nhập thất bại');
    showToast(e.message || 'Đăng nhập thất bại', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Đăng nhập';
  }
}

async function loginViaTimesheetTab(baseUrl, username, password) {
  const loginUrl = `${baseUrl}/Admin/Pages/Login.aspx`;
  let tab = Core.selectTimesheetTab(await queryTabs({}), baseUrl);
  if (!tab?.id) {
    tab = await createTab({ url: loginUrl, active: false });
  } else if (!String(tab.url || '').includes('/Login.aspx')) {
    tab = await updateTab(tab.id, { url: loginUrl, active: false });
  }
  if (!tab?.id) return { success: false, message: 'Không mở được tab login' };

  await waitForTabComplete(tab.id);
  try {
    await injectContentScripts(tab.id);
    return await chrome.tabs.sendMessage(tab.id, {
      action: 'loginTimesheet',
      credentials: { username, password },
    });
  } catch (e) {
    return { success: false, message: e.message };
  }
}

function queryTabs(queryInfo) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query(queryInfo, (tabs) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(tabs || []);
    });
  });
}

function createTab(createProperties) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create(createProperties, (tab) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(tab);
    });
  });
}

function updateTab(tabId, updateProperties) {
  return new Promise((resolve, reject) => {
    chrome.tabs.update(tabId, updateProperties, (tab) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(tab);
    });
  });
}

function waitForTabComplete(tabId, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Timeout chờ tab login load'));
    }, timeout);
    const listener = (updatedTabId, info) => {
      if (updatedTabId === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) return;
      if (tab?.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });
}

async function injectContentScripts(tabId) {
  if (chrome.scripting?.executeScript) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['popup-core.js', 'content.js'],
    });
    return;
  }
  await new Promise((resolve, reject) => {
    chrome.tabs.executeScript(tabId, { file: 'popup-core.js' }, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve();
    });
  });
  await new Promise((resolve, reject) => {
    chrome.tabs.executeScript(tabId, { file: 'content.js' }, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve();
    });
  });
}

function formatLoginError(result) {
  const message = result?.message || 'Đăng nhập thất bại';
  if (!result?.debug) return message;
  const debug = result.debug;
  const details = [
    debug.getStatus ? `GET ${debug.getStatus}` : '',
    debug.postStatus ? `POST ${debug.postStatus}` : '',
    debug.hasViewstate === false ? 'thiếu VIEWSTATE' : '',
    debug.hasCookieHeader === false ? 'không có Set-Cookie' : '',
    debug.cookieNames?.length ? `cookies: ${debug.cookieNames.join(', ')}` : '',
  ].filter(Boolean);
  console.warn('[Timesheet Login] debug', debug);
  return details.length ? `${message} (${details.join('; ')})` : message;
}

async function doLogout() {
  await chrome.runtime.sendMessage({ action: 'logout' });
  state.auth = { loggedIn: false, username: '', displayName: '' };
  await persistState();
  await checkLoginStatus();
  renderAuthScreen();
  showToast('Đã đăng xuất', 'info');
}

// Bind thêm vào bindGlobalEvents():
function bindHeadlessEvents() {
  document
    .getElementById('btnHeadlessSubmit')
    ?.addEventListener('click', runHeadlessSubmit);
  document
    .getElementById('btnHideLogin')
    ?.addEventListener('click', hideLoginPanel);
  document.getElementById('btnDoLogin')?.addEventListener('click', doLogin);
  document.getElementById('btnLoginMain')?.addEventListener('click', doLogin);
  document
    .getElementById('btnCloseSubmitSuccess')
    ?.addEventListener('click', hideSubmitSuccessPanel);
  document
    .getElementById('btnOpenSubmitDetail')
    ?.addEventListener('click', openSubmitDetail);
  document
    .getElementById('btnLoginOpenTab')
    ?.addEventListener('click', () => openInTab());
  document.getElementById('btnLogout')?.addEventListener('click', doLogout);
  document.getElementById('loginPassword')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doLogin();
  });
  document
    .getElementById('loginPasswordMain')
    ?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doLogin();
    });
}
