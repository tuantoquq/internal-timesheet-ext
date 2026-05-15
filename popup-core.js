(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TimesheetCore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const EMPTY_TASK = { project: '', task: '', startTime: '', breakTime: '', finishTime: '' };
  const DAY_MINUTES = 1440;
  const MAX_FINISH_MINUTES = 23 * 60 + 30;
  const DEFAULT_SCHEDULE = {
    startTime: '09:00',
    lunchStart: '12:00',
    lunchEnd: '13:30',
  };

  function createEmptyTask() {
    return { ...EMPTY_TASK };
  }

  function addTaskToDay(state, dayCode) {
    if (!state.days[dayCode]) {
      state.days[dayCode] = { enabled: true, expanded: true, tasks: [] };
    }
    if (!state.days[dayCode].tasks) state.days[dayCode].tasks = [];
    state.days[dayCode].tasks.push(createEmptyTask());
    state.days[dayCode].expanded = true;
  }

  function removeTaskFromDay(state, dayCode, index) {
    const day = state.days[dayCode];
    if (!day?.tasks) return;
    day.tasks.splice(index, 1);
    if (day.tasks.length === 0) day.tasks = [createEmptyTask()];
  }

  function clearTasks(state, days) {
    days.forEach(day => {
      if (state.days[day.code]) {
        state.days[day.code].tasks = [createEmptyTask()];
      }
    });
  }

  function setProjectForAllDays(state, days, rowIndex, project) {
    days.forEach(day => {
      const dayState = state.days[day.code];
      if (!dayState?.enabled || !dayState.tasks?.[rowIndex]) return;
      dayState.tasks[rowIndex].project = project;
    });
  }

  function setTaskForAllDays(state, days, rowIndex, task) {
    days.forEach(day => {
      const dayState = state.days[day.code];
      if (!dayState?.enabled || !dayState.tasks?.[rowIndex]) return;
      dayState.tasks[rowIndex].task = task;
    });
  }

  function normalizeProject(project) {
    return String(project || '')
      .replace(/&amp;/g, '&')
      .replace(/&nbsp;/g, ' ')
      .trim();
  }

  function parseArrayItems(raw) {
    const items = [];
    const re = /'((?:\\'|[^'])*)'/g;
    let match;
    while ((match = re.exec(raw)) !== null) {
      const value = normalizeProject(match[1].replace(/\\'/g, "'"));
      if (value && value !== '/0') items.push(value);
    }
    return items;
  }

  function extractProjects(source) {
    const text = String(source || '');
    const projects = new Set();
    const re = /Project_\d+_text\s*=\s*new Array\(([\s\S]*?)\);/g;
    let match;
    while ((match = re.exec(text)) !== null) {
      parseArrayItems(match[1]).forEach(project => projects.add(project));
    }
    return Array.from(projects).sort((a, b) => a.localeCompare(b));
  }

  function searchProjects(source, keyword, limit = 30) {
    const needle = normalizeProject(keyword).toLowerCase();
    if (!needle) return [];
    return extractProjects(source)
      .filter(project => project.toLowerCase().includes(needle))
      .slice(0, limit);
  }

  function searchProjectSources(sources, keyword, limit = 30) {
    return searchProjects((sources || []).join('\n'), keyword, limit);
  }

  function isBlankSearch(keyword) {
    return normalizeProject(keyword) === '';
  }

  function normalizeTimeValue(value) {
    const text = String(value || '').trim();
    const match = text.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return text;
    return `${match[1].padStart(2, '0')}:${match[2]}`;
  }

  function timeToMinutes(value) {
    const normalized = normalizeTimeValue(value);
    const match = normalized.match(/^(\d{2}):(\d{2})$/);
    if (!match) throw new Error(`Invalid time: ${value}`);
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      throw new Error(`Invalid time: ${value}`);
    }
    if (minutes % 15 !== 0) {
      throw new Error('Time must use a 15-minute step');
    }
    return hours * 60 + minutes;
  }

  function minutesToTime(minutes) {
    const bounded = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
    const hours = Math.floor(bounded / 60);
    const mins = bounded % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  }

  function parseWorkHours(value) {
    const text = String(value || '').trim();
    const hours = Number(text);
    if (!Number.isFinite(hours) || hours <= 0) {
      throw new Error('Work hours must be greater than 0');
    }
    const minutes = Math.round(hours * 60);
    if (Math.abs(minutes - hours * 60) > 0.0001 || minutes % 15 !== 0) {
      throw new Error('Work hours must use a 15-minute increment');
    }
    return minutes;
  }

  function formatWorkHours(minutes) {
    const hours = minutes / 60;
    return Number.isInteger(hours) ? String(hours) : String(hours).replace(/0+$/, '').replace(/\.$/, '');
  }

  function dayStartOf(absMinutes) {
    return Math.floor(absMinutes / DAY_MINUTES) * DAY_MINUTES;
  }

  function skipLunchStart(absMinutes, schedule) {
    const lunchStart = dayStartOf(absMinutes) + schedule.lunchStart;
    const lunchEnd = dayStartOf(absMinutes) + schedule.lunchEnd;
    return absMinutes >= lunchStart && absMinutes < lunchEnd ? lunchEnd : absMinutes;
  }

  function addWorkMinutes(absStart, workMinutes, schedule) {
    let cursor = skipLunchStart(absStart, schedule);
    let remaining = workMinutes;
    let breakMinutes = 0;

    while (remaining > 0) {
      cursor = skipLunchStart(cursor, schedule);
      const lunchStart = dayStartOf(cursor) + schedule.lunchStart;
      const lunchEnd = dayStartOf(cursor) + schedule.lunchEnd;
      const nextPause = cursor < lunchStart ? lunchStart : Infinity;
      const available = nextPause - cursor;

      if (available >= remaining) {
        cursor += remaining;
        remaining = 0;
      } else {
        cursor = lunchEnd;
        remaining -= available;
        breakMinutes += lunchEnd - lunchStart;
      }
    }

    return { finish: cursor, breakMinutes };
  }

  function segmentWorkAcrossDays(startAbs, workMinutes, schedule) {
    const segments = [];
    let cursor = startAbs;
    let remaining = workMinutes;

    while (remaining > 0) {
      cursor = skipLunchStart(cursor, schedule);
      const dayStart = dayStartOf(cursor);
      const latestFinish = dayStart + MAX_FINISH_MINUTES;
      if (cursor >= latestFinish) {
        cursor = dayStart + DAY_MINUTES;
        continue;
      }

      let best = 0;
      let bestResult = null;

      for (let candidate = remaining; candidate >= 15; candidate -= 15) {
        const result = addWorkMinutes(cursor, candidate, schedule);
        if (result.finish <= latestFinish) {
          best = candidate;
          bestResult = result;
          break;
        }
      }

      if (best === 0) {
        cursor = dayStart + DAY_MINUTES;
        continue;
      }

      segments.push({
        dayOffset: Math.floor(cursor / DAY_MINUTES),
        start: cursor % DAY_MINUTES,
        finish: bestResult.finish % DAY_MINUTES,
        breakMinutes: bestResult.breakMinutes,
        workMinutes: best,
      });
      remaining -= best;
      cursor = bestResult.finish;
    }

    return segments;
  }

  function scheduleTasksForDay(state, days, dayCode, options = {}) {
    const dayIndex = days.findIndex(day => day.code === dayCode);
    if (dayIndex < 0) throw new Error(`Unknown day: ${dayCode}`);
    const sourceDay = state.days[dayCode];
    if (!sourceDay?.tasks?.length) return { segments: 0 };

    const schedule = {
      startTime: timeToMinutes(options.startTime || DEFAULT_SCHEDULE.startTime),
      lunchStart: timeToMinutes(options.lunchStart || DEFAULT_SCHEDULE.lunchStart),
      lunchEnd: timeToMinutes(options.lunchEnd || DEFAULT_SCHEDULE.lunchEnd),
    };
    const generated = new Map();
    let cursor = dayIndex * DAY_MINUTES + schedule.startTime;

    sourceDay.tasks.forEach(task => {
      const totalMinutes = parseWorkHours(task.workHours);
      const segments = segmentWorkAcrossDays(cursor, totalMinutes, schedule);
      if (segments.length === 0) throw new Error('No schedulable time segment found');
      segments.forEach(segment => {
        const targetIndex = segment.dayOffset;
        const targetDay = days[targetIndex];
        if (!targetDay) throw new Error('Auto time exceeds the configured week');
        if (!generated.has(targetDay.code)) generated.set(targetDay.code, []);
        const nextTask = {
          ...task,
          workHours: formatWorkHours(segment.workMinutes),
          startTime: minutesToTime(segment.start),
          breakTime: minutesToTime(segment.breakMinutes),
          finishTime: minutesToTime(segment.finish),
        };
        delete nextTask.autoCarryFrom;
        if (targetDay.code !== dayCode) nextTask.autoCarryFrom = dayCode;
        generated.get(targetDay.code).push(nextTask);
      });
      const last = segments[segments.length - 1];
      cursor = last.dayOffset * DAY_MINUTES + last.finish;
    });

    days.slice(dayIndex).forEach(day => {
      if (!state.days[day.code]) {
        state.days[day.code] = { enabled: false, expanded: false, tasks: [] };
      }
      state.days[day.code].tasks = (state.days[day.code].tasks || [])
        .filter(task => task.autoCarryFrom !== dayCode);
    });

    const sourceTasks = generated.get(dayCode) || [];
    sourceDay.tasks = sourceTasks;
    sourceDay.enabled = true;
    sourceDay.expanded = true;

    generated.forEach((tasks, targetCode) => {
      if (targetCode === dayCode) return;
      const targetDay = state.days[targetCode];
      targetDay.enabled = true;
      targetDay.expanded = true;
      targetDay.tasks = [...tasks, ...(targetDay.tasks || [])];
    });

    return {
      segments: Array.from(generated.values()).reduce((total, tasks) => total + tasks.length, 0),
    };
  }

  function isTabView(search) {
    return new URLSearchParams(String(search || '')).get('view') === 'tab';
  }

  function getPopupPageUrl(baseUrl) {
    const url = new URL(baseUrl);
    url.searchParams.set('view', 'tab');
    return url.toString();
  }

  function shouldClosePopupAfterOpen(search) {
    return !isTabView(search);
  }

  function normalizeBaseUrl(baseUrl) {
    return String(baseUrl || '').replace(/\/$/, '');
  }

  function isTimesheetUrl(url, baseUrl) {
    const normalizedBase = normalizeBaseUrl(baseUrl);
    return Boolean(url && normalizedBase && String(url).startsWith(normalizedBase));
  }

  function selectTimesheetTab(tabs, baseUrl) {
    const list = tabs || [];
    return (
      list.find(tab => tab.active && isTimesheetUrl(tab.url || tab.pendingUrl, baseUrl)) ||
      list.find(tab => isTimesheetUrl(tab.url || tab.pendingUrl, baseUrl)) ||
      null
    );
  }

  function collectProjectOptions(savedProjects, selectedProject) {
    const values = new Set();
    (savedProjects || []).forEach(project => {
      const normalized = normalizeProject(project);
      if (normalized) values.add(normalized);
    });
    const selected = normalizeProject(selectedProject);
    if (selected) values.add(selected);
    return Array.from(values);
  }

  function addSavedProject(state, project) {
    const normalized = normalizeProject(project);
    if (!normalized) return false;
    if (!Array.isArray(state.savedProjects)) state.savedProjects = [];
    if (state.savedProjects.includes(normalized)) return false;
    state.savedProjects.push(normalized);
    state.savedProjects.sort((a, b) => a.localeCompare(b));
    return true;
  }

  function removeSavedProject(state, project) {
    const normalized = normalizeProject(project);
    if (!Array.isArray(state.savedProjects)) return;
    state.savedProjects = state.savedProjects.filter(item => item !== normalized);
  }

  function getWeekEndingDate() {
    const now = new Date();
    const day = now.getDay(); // 0: Sun, 1: Mon, ...
    const sunday = new Date(now);
    if (day === 1) { // Monday
      sunday.setDate(now.getDate() - 1);
    } else {
      const diff = day === 0 ? 0 : 7 - day;
      sunday.setDate(now.getDate() + diff);
    }
    const d = String(sunday.getDate()).padStart(2, '0');
    const m = String(sunday.getMonth() + 1).padStart(2, '0');
    const y = sunday.getFullYear();
    return `${d}/${m}/${y}`;
  }

  return {
    addSavedProject,
    addTaskToDay,
    clearTasks,
    collectProjectOptions,
    createEmptyTask,
    extractProjects,
    getPopupPageUrl,
    getWeekEndingDate,
    isBlankSearch,
    isTabView,
    isTimesheetUrl,
    normalizeTimeValue,
    parseWorkHours,
    removeSavedProject,
    removeTaskFromDay,
    scheduleTasksForDay,
    searchProjectSources,
    searchProjects,
    selectTimesheetTab,
    setProjectForAllDays,
    setTaskForAllDays,
    shouldClosePopupAfterOpen,
  };
});
