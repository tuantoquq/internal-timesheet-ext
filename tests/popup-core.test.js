const assert = require('node:assert/strict');
const test = require('node:test');

const {
  addTaskToDay,
  clearTasks,
  collectProjectOptions,
  getPopupPageUrl,
  isTabView,
  isBlankSearch,
  normalizeTimeValue,
  parseWorkHours,
  removeTaskFromDay,
  scheduleTasksForDay,
  searchProjectSources,
  searchProjects,
  selectTimesheetTab,
  setProjectForAllDays,
  setTaskForAllDays,
  shouldClosePopupAfterOpen,
} = require('../popup-core');

const days = [{ code: 'mon' }, { code: 'tue' }, { code: 'wed' }];

function makeState() {
  return {
    savedProjects: [
      '_Internal Support /167632',
      '_ACB-MAINTENANCE /269251',
    ],
    days: {
      mon: {
        enabled: true,
        expanded: true,
        tasks: [
          { project: '_Internal Support /167632', task: 'A' },
          { project: '', task: 'B' },
        ],
      },
      tue: {
        enabled: true,
        expanded: false,
        tasks: [{ project: '', task: 'C' }],
      },
      wed: {
        enabled: false,
        expanded: false,
        tasks: [],
      },
    },
  };
}

test('project search parses page arrays and filters by keyword', () => {
  const source = `
    var monProject_0_text = new Array('',' /0','_Internal Support /167632','_ACB-MAINTENANCE /269251');
    var tueProject_0_text = new Array('_Internal Support /167632','_Local Training /237606');
  `;

  assert.deepEqual(searchProjects(source, 'support'), ['_Internal Support /167632']);
});

test('project search combines source fragments from an active tab scrape', () => {
  const fragments = [
    "var monProject_0_text = new Array('INTA-3578_Self Study (Hanoi) /147382');",
    "var tueProject_0_text = new Array('INTA-3578_Self Study (Ho Chi Minh) /157561');",
  ];

  assert.deepEqual(searchProjectSources(fragments, 'INTA-3578'), [
    'INTA-3578_Self Study (Hanoi) /147382',
    'INTA-3578_Self Study (Ho Chi Minh) /157561',
  ]);
});

test('blank project search keys should clear existing results', () => {
  assert.equal(isBlankSearch(''), true);
  assert.equal(isBlankSearch('   '), true);
  assert.equal(isBlankSearch('INTA-3578'), false);
});

test('time values are padded to HH:mm for saved defaults', () => {
  assert.equal(normalizeTimeValue('9:00'), '09:00');
  assert.equal(normalizeTimeValue('1:30'), '01:30');
  assert.equal(normalizeTimeValue('18:30'), '18:30');
  assert.equal(normalizeTimeValue(''), '');
});

test('work hours accept only 15-minute increments', () => {
  assert.equal(parseWorkHours('1'), 60);
  assert.equal(parseWorkHours('1.25'), 75);
  assert.equal(parseWorkHours('1.5'), 90);
  assert.throws(() => parseWorkHours('1.1'), /15-minute/);
});

test('project options include saved projects and selected value once', () => {
  assert.deepEqual(
    collectProjectOptions(['A /1', 'B /2'], 'C /3'),
    ['A /1', 'B /2', 'C /3']
  );
});

test('task mutations update state without re-collecting stale DOM rows', () => {
  const state = makeState();

  addTaskToDay(state, 'tue');
  assert.equal(state.days.tue.tasks.length, 2);
  assert.equal(state.days.tue.expanded, true);

  removeTaskFromDay(state, 'mon', 0);
  assert.deepEqual(state.days.mon.tasks, [{ project: '', task: 'B' }]);

  clearTasks(state, days);
  assert.deepEqual(state.days.mon.tasks, [{ project: '', task: '', startTime: '', breakTime: '', finishTime: '' }]);
  assert.deepEqual(state.days.tue.tasks, [{ project: '', task: '', startTime: '', breakTime: '', finishTime: '' }]);
});

test('set project for all applies to enabled days with matching row index only', () => {
  const state = makeState();

  setProjectForAllDays(state, days, 0, '_ACB-MAINTENANCE /269251');

  assert.equal(state.days.mon.tasks[0].project, '_ACB-MAINTENANCE /269251');
  assert.equal(state.days.tue.tasks[0].project, '_ACB-MAINTENANCE /269251');
  assert.equal(state.days.mon.tasks[1].project, '');
  assert.deepEqual(state.days.wed.tasks, []);
});

test('set task for all applies content to enabled days with matching row index only', () => {
  const state = makeState();

  setTaskForAllDays(state, days, 0, 'Daily support');

  assert.equal(state.days.mon.tasks[0].task, 'Daily support');
  assert.equal(state.days.tue.tasks[0].task, 'Daily support');
  assert.equal(state.days.mon.tasks[1].task, 'B');
  assert.deepEqual(state.days.wed.tasks, []);
});

test('auto time skips lunch break when task crosses 12:00 to 13:30', () => {
  const state = {
    days: {
      mon: {
        enabled: true,
        expanded: true,
        tasks: [{ project: 'P', task: 'Build', workHours: '4' }],
      },
      tue: { enabled: false, expanded: false, tasks: [] },
      wed: { enabled: false, expanded: false, tasks: [] },
    },
  };

  const result = scheduleTasksForDay(state, days, 'mon');

  assert.equal(result.segments, 1);
  assert.deepEqual(state.days.mon.tasks[0], {
    project: 'P',
    task: 'Build',
    workHours: '4',
    startTime: '09:00',
    breakTime: '01:30',
    finishTime: '14:30',
  });
});

test('auto time splits overnight work at 23:30 and carries remaining work to next day', () => {
  const state = {
    days: {
      mon: {
        enabled: true,
        expanded: true,
        tasks: [{ project: 'P', task: 'Golive', workHours: '20' }],
      },
      tue: { enabled: false, expanded: false, tasks: [] },
      wed: { enabled: false, expanded: false, tasks: [] },
    },
  };

  const result = scheduleTasksForDay(state, days, 'mon');

  assert.equal(result.segments, 2);
  assert.deepEqual(state.days.mon.tasks[0], {
    project: 'P',
    task: 'Golive',
    workHours: '13',
    startTime: '09:00',
    breakTime: '01:30',
    finishTime: '23:30',
  });
  assert.deepEqual(state.days.tue.tasks[0], {
    project: 'P',
    task: 'Golive',
    workHours: '7',
    startTime: '00:00',
    breakTime: '00:00',
    finishTime: '07:00',
    autoCarryFrom: 'mon',
  });
  assert.equal(state.days.tue.enabled, true);
});

test('tab view helpers identify and build the expanded popup URL', () => {
  assert.equal(isTabView('?view=tab'), true);
  assert.equal(isTabView('?view=popup'), false);
  assert.equal(getPopupPageUrl('chrome-extension://abc/popup.html'), 'chrome-extension://abc/popup.html?view=tab');
  assert.equal(getPopupPageUrl('chrome-extension://abc/popup.html?x=1'), 'chrome-extension://abc/popup.html?x=1&view=tab');
  assert.equal(shouldClosePopupAfterOpen(''), true);
  assert.equal(shouldClosePopupAfterOpen('?view=tab'), false);
});

test('timesheet tab selection prefers active timesheet, then another matching tab', () => {
  const tabs = [
    { id: 1, active: true, url: 'chrome-extension://abc/popup.html?view=tab' },
    { id: 2, active: false, url: 'http://10.145.48.117:9099/TimeSheetEdit.aspx' },
  ];

  assert.equal(selectTimesheetTab(tabs, 'http://10.145.48.117:9099').id, 2);
  assert.equal(selectTimesheetTab([{ ...tabs[1], active: true }, tabs[0]], 'http://10.145.48.117:9099').id, 2);
  assert.equal(selectTimesheetTab(tabs, 'http://example.local'), null);
});
