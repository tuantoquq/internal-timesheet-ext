// Timesheet AutoFill — background.js
// Headless login + submit flow (no tab required)

const BASE_URL = () =>
  (self.__timesheetBaseUrl || 'http://10.145.48.117:9099').replace(/\/$/, '');

// ── Session storage (in-memory, persisted to chrome.storage) ──────────────

let _session = null; // { cookies: string, employeeId, employeeName, employeeCode }

async function loadSession() {
  if (_session) return _session;
  const cookieSession = await loadSessionFromBrowserCookies();
  if (cookieSession) return cookieSession;
  const r = await chrome.storage.local.get(['timesheetSession']);
  _session = r.timesheetSession || null;
  return _session;
}

async function saveSession(session) {
  _session = session;
  await chrome.storage.local.set({ timesheetSession: session });
}

async function clearSession() {
  _session = null;
  await chrome.storage.local.remove('timesheetSession');
  await clearAuthCookies();
}

async function loadSessionFromBrowserCookies() {
  let allCookies;
  try {
    allCookies = await getAuthCookies();
  } catch (e) {
    return null;
  }
  const aspxAuth = allCookies.find((c) => c.name === '.ASPXAUTH');
  if (!aspxAuth?.value) return null;
  const sessionId = allCookies.find((c) => c.name === 'ASP.NET_SessionId');
  const cookieStr = [
    sessionId ? `ASP.NET_SessionId=${sessionId.value}` : '',
    `.ASPXAUTH=${aspxAuth.value}`,
  ]
    .filter(Boolean)
    .join('; ');

  const employeeInfo = await fetchEmployeeInfo(cookieStr);
  const session = {
    cookies: cookieStr,
    ...employeeInfo,
    loginAt: Date.now(),
    source: 'browser-cookie',
  };
  await saveSession(session);
  return session;
}

// ── Login ──────────────────────────────────────────────────────────────────

async function login(username, password) {
  const existingSession = await loadSessionFromBrowserCookies();
  if (existingSession?.cookies)
    return { success: true, session: existingSession, reused: true };

  const loginUrl = `${BASE_URL()}/Admin/Pages/Login.aspx`;

  // Step 1: GET login page (may need hidden fields)
  const getRes = await fetch(loginUrl, {
    method: 'GET',
    credentials: 'include',
  });
  const html = await getRes.text();
  if (!getRes.ok) {
    return {
      success: false,
      message: `Không mở được trang login: HTTP ${getRes.status}`,
      debug: {
        loginUrl,
        getStatus: getRes.status,
        getPreview: html.slice(0, 300),
      },
    };
  }

  // Extract any hidden fields (__VIEWSTATE etc) if present
  const viewstate = extractInput(html, '__VIEWSTATE');
  const viewstategen = extractInput(html, '__VIEWSTATEGENERATOR');
  const eventvalidation = extractInput(html, '__EVENTVALIDATION');

  // Build login POST body matching the captured Login.aspx request.
  const params = new URLSearchParams();
  params.set('vsKey', extractInput(html, 'vsKey') || '150');
  params.set('__VIEWSTATE', viewstate || '');
  if (viewstategen) params.set('__VIEWSTATEGENERATOR', viewstategen);
  params.set('__EVENTVALIDATION', eventvalidation || '');
  params.set('txt_Username', username);
  params.set('txt_Password', password);
  params.set('btn_Login', 'Đăng nhập');

  // Step 2: POST login
  const postRes = await fetch(loginUrl, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      Origin: BASE_URL(),
      Referer: loginUrl,
    },
    body: params.toString(),
    redirect: 'manual', // browser stores cookies; extension reads them via chrome.cookies
  });

  const cookieHeader = postRes.headers.get('set-cookie') || '';
  const allCookies = await getAuthCookies();

  // Check if login succeeded: look for .ASPXAUTH cookie
  const aspxAuth = allCookies.find((c) => c.name === '.ASPXAUTH');
  const sessionId = allCookies.find((c) => c.name === 'ASP.NET_SessionId');

  if (!aspxAuth) {
    const failure =
      extractLoginFailure(html) ||
      extractLoginFailure(await safeResponseText(postRes));
    return {
      success: false,
      message:
        failure ||
        `Login không nhận được cookie xác thực (HTTP ${postRes.status}, Set-Cookie: ${cookieHeader ? 'có' : 'không'})`,
      debug: {
        loginUrl,
        getStatus: getRes.status,
        postStatus: postRes.status,
        postType: postRes.type,
        hasViewstate: !!viewstate,
        hasEventValidation: !!eventvalidation,
        hasCookieHeader: !!cookieHeader,
        cookieNames: allCookies.map((c) => c.name),
      },
    };
  }

  const cookieStr = [
    sessionId ? `ASP.NET_SessionId=${sessionId.value}` : '',
    `.ASPXAUTH=${aspxAuth.value}`,
  ]
    .filter(Boolean)
    .join('; ');

  // Step 3: GET timesheet page to extract employee info
  const employeeInfo = await fetchEmployeeInfo(cookieStr);

  const session = {
    cookies: cookieStr,
    ...employeeInfo,
    loginAt: Date.now(),
  };

  await saveSession(session);
  return { success: true, session };
}

// ── Fetch employee info from timesheet page ────────────────────────────────

async function fetchEmployeeInfo(cookieStr) {
  try {
    const html = await fetchTimesheetHtml(cookieStr);
    return parseEmployeeInfo(html);
  } catch (e) {
    console.error('[BG] fetchEmployeeInfo error:', e);
    return {};
  }
}

async function fetchTimesheetHtml(cookieStr) {
  const url = `${BASE_URL()}/Admin/Pages/TimeSheetOnline/TimeSheetEdit.aspx`;
  const res = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: buildHeaders(cookieStr),
  });
  const html = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (/Login\.aspx|txt_Username|txt_Password/i.test(html)) {
    throw new Error('Server trả về trang login, cookie không còn hợp lệ');
  }
  return html;
}

function parseEmployeeInfo(html) {
  return {
    employeeId: extractHiddenValue(html, 'hdfEmployeeId'),
    employeeName: extractHiddenValue(html, 'hdfEmployeeName'),
    employeeCode: extractHiddenValue(html, 'hdfEmployeeCode'),
    projectList: extractProjectList(html),
  };
}

// ── GET existing timesheet for a week ─────────────────────────────────────
// Returns the page HTML + parsed metadata needed for submit

async function fetchTimesheetPage(cookieStr, weekEnding) {
  // weekEnding format: DD/MM/YYYY
  const html = await fetchTimesheetHtml(cookieStr);

  // Parse all hidden fields needed for submit
  const meta = {
    timesheetId: extractHiddenValue(html, 'hdfId') || '',
    employeeId: extractHiddenValue(html, 'hdfEmployeeId'),
    employeeName: extractHiddenValue(html, 'hdfEmployeeName'),
    employeeCode: extractHiddenValue(html, 'hdfEmployeeCode'),
    dateSubmitted: extractHiddenValue(html, 'hdfdateSubmitted') || '',
    // Per-day record IDs (hdfmon_0, hdftue_0, etc.)
    dayRecordIds: parseDayRecordIds(html),
    // Per-day counts
    dayCounts: parseDayCounts(html),
  };

  return { html, meta };
}

function encodePayloadValue(value) {
  return encodeURIComponent(String(value ?? ''));
}

// ── Build submit payload ───────────────────────────────────────────────────

function buildSubmitPayload(meta, config, weekEnding) {
  const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

  const params = new URLSearchParams();
  const setParam = (key, value) => params.set(key, encodePayloadValue(value));

  // Core fields
  setParam('action', 'updateTimeSheet');
  if (meta.timesheetId) setParam('id', meta.timesheetId);

  setParam('ctl00$ContentPlaceHolder1$hdfId', meta.timesheetId || '');
  setParam('ctl00$ContentPlaceHolder1$hdfStatus', '');
  setParam('ctl00$ContentPlaceHolder1$hdfObjectId', '');
  setParam('ctl00$ContentPlaceHolder1$txtWeekEnding', weekEnding);
  setParam('ctl00$ContentPlaceHolder1$hdfEmployeeId', meta.employeeId || '');
  setParam(
    'ctl00$ContentPlaceHolder1$hdfEmployeeName',
    meta.employeeName || '',
  );
  setParam(
    'ctl00$ContentPlaceHolder1$hdfEmployeeCode',
    meta.employeeCode || '',
  );
  setParam(
    'ctl00$ContentPlaceHolder1$hdfdateSubmitted',
    meta.dateSubmitted || '',
  );

  // Build per-day fields
  const dayTasksMap = {};
  (config.days || []).forEach((d) => {
    dayTasksMap[d.dayCode] = d.tasks || [];
  });

  let grandTotalMinutes = 0;

  DAYS.forEach((day) => {
    const tasks = dayTasksMap[day] || [];
    const existingRecords = meta.dayRecordIds?.[day] || [];
    const rowCount = Math.max(
      existingRecords.length,
      tasks.length > 0 ? tasks.length : 1,
    );
    const records = Array.from(
      { length: rowCount },
      (_, i) => existingRecords[i] || 0,
    );
    const suffixes = records.map((_, i) => i);

    // Calculate total hours for the day
    let dayTotalMinutes = 0;
    tasks.forEach((t, i) => {
      const start = parseTime(t.startTime || config.defaultStartTime);
      const brk = parseTime(t.breakTime || config.defaultBreakTime);
      const finish = parseTime(t.finishTime || config.defaultFinishTime);
      if (start !== null && finish !== null && brk !== null) {
        const mins = finish - start - brk;
        if (mins > 0) dayTotalMinutes += mins;
      }
    });
    grandTotalMinutes += dayTotalMinutes;

    const dayTotal = formatMinutes(dayTotalMinutes);

    setParam(`ctl00$ContentPlaceHolder1$hdf${day}`, suffixes.map((suffix) => `${suffix}*`).join(''));
    setParam(`ctl00$ContentPlaceHolder1$hdfTotal_${day}`, dayTotal);

    // Each row
    for (let i = 0; i < rowCount; i++) {
      const task = tasks[i] || {};
      const recId = records[i] ?? 0;
      const suffix = i; // use sequential for new timesheets; server maps by recId

      const project = task.project || '';
      const startTime =
        task.startTime || (tasks.length ? config.defaultStartTime : '');
      const breakTime =
        task.breakTime || (tasks.length ? config.defaultBreakTime : '');
      const finishTime =
        task.finishTime || (tasks.length ? config.defaultFinishTime : '');

      // Calculate row total
      let rowMins = 0;
      const s = parseTime(startTime),
        b = parseTime(breakTime),
        f = parseTime(finishTime);
      if (s !== null && f !== null && b !== null)
        rowMins = Math.max(0, f - s - b);
      const rowTotal = rowMins > 0 ? ` ${formatMinutes(rowMins)}` : '';

      setParam(`${day}Project_${suffix}`, project);
      setParam(`${day}Start_${suffix}`, startTime);
      setParam(`${day}Break_${suffix}`, breakTime);
      setParam(`${day}Finish_${suffix}`, finishTime);
      setParam(`hdfTotal${day}_${suffix}`, rowTotal);
      setParam(`hdf${day}_${suffix}`, String(recId));
    }

    // Note: hdfwedcount vs hdfwedCount (lowercase 'c' for wed — confirmed from HAR!)
    const countKey = day === 'wed' ? `hdf${day}count` : `hdf${day}Count`;
    setParam(countKey, String(rowCount));
  });

  // Grand total
  setParam(
    'ctl00$ContentPlaceHolder1$hdftotal',
    formatMinutes(grandTotalMinutes),
  );

  // Task text fields (at end, matching HAR structure)
  DAYS.forEach((day) => {
    const tasks = dayTasksMap[day] || [];
    for (
      let i = 0;
      i <
      Math.max(
        (meta.dayRecordIds?.[day] || []).length,
        tasks.length > 0 ? tasks.length : 1,
      );
      i++
    ) {
      setParam(`${day}Task${i}`, tasks[i]?.task || '\n');
    }
  });

  return params;
}

// ── Fetch timesheet record ID for a given weekEnding ──────────────────────
// Flow:
//   1. GET MyTimeSheetList.aspx filtered by weekEnding week
//   2. Find records matching weekEnding exactly
//   3. Prefer record with totalHrs > 0; fallback to latest (first row)
//   4. Return record id, or null if none found (→ create new)

async function fetchTimesheetRecord(cookieStr, weekEnding) {
  // weekEnding: DD/MM/YYYY  e.g. "25/05/2026"
  const [dd, mm, yyyy] = weekEnding.split('/').map(Number);
  const endDate = new Date(yyyy, mm - 1, dd);
  const startDate = new Date(endDate);
  startDate.setDate(endDate.getDate() - 6);

  const fmt = (d) =>
    `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

  const fromStr = fmt(startDate);
  const toStr = fmt(endDate);

  console.log(
    `[BG] fetchTimesheetRecord: weekEnding=${weekEnding} range=${fromStr}→${toStr}`,
  );

  const listUrl = `${BASE_URL()}/Admin/Pages/TimeSheetOnline/MyTimeSheetList.aspx`;

  // ── Step 1: GET the list page to obtain valid __EVENTVALIDATION token ──
  let getHtml = '';
  try {
    const getRes = await fetch(listUrl, {
      method: 'GET',
      credentials: 'include',
      headers: buildHeaders(cookieStr),
    });
    getHtml = await getRes.text();
  } catch (e) {
    console.error('[BG] fetchTimesheetRecord GET error:', e.message);
    return null;
  }

  // Extract tokens from the GET response
  const eventValidation = extractInput(getHtml, '__EVENTVALIDATION') || '';
  const viewState = extractInput(getHtml, '__VIEWSTATE') || '';
  const vsKey = extractInput(getHtml, 'vsKey') || '33';

  console.log(
    `[BG] tokens: vsKey=${vsKey} eventValidation=${eventValidation.slice(0, 30)}...`,
  );

  // ── Step 2: POST with real tokens and date filter ─────────────────────
  const params = new URLSearchParams({
    __EVENTTARGET: '',
    __EVENTARGUMENT: '',
    __LASTFOCUS: '',
    vsKey: vsKey,
    __VIEWSTATE: viewState,
    __EVENTVALIDATION: eventValidation,
    ctl00$AccountInfo1$ddl_Language: 'vi-VN',
    ctl00$ContentPlaceHolder1$txtWeekEndingFrom: fromStr,
    ctl00$ContentPlaceHolder1$txtWeekEndingTo: toStr,
    ctl00$ContentPlaceHolder1$btn_Submit: '',
    ctl00$ContentPlaceHolder1$UcPageList1$hdf_PageSize: '20',
    ctl00$ContentPlaceHolder1$UcPageList1$hdf_PageNumber: '1',
    ctl00$ContentPlaceHolder1$UcPageList1$DropDownList_Pages: '1',
  });

  let html = '';
  try {
    const res = await fetch(listUrl, {
      method: 'POST',
      credentials: 'include',
      headers: {
        ...buildHeaders(cookieStr),
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Referer: listUrl,
      },
      body: params.toString(),
    });
    html = await res.text();
  } catch (e) {
    console.error('[BG] fetchTimesheetRecord POST error:', e.message);
    return null;
  }

  // Parse rows from the list HTML
  // Table columns: Week Ending | Employer Code | Employee Name | Date Submitted | Total Hrs
  // Row structure per spec:
  //   <td><a href='MyTimeSheetDetail.aspx?id=354102'>24/05/2026</a></td>
  //   <td>tuannha</td>
  //   <td>Nguyen Hoang Anh Tuan</td>
  //   <td>11:31:SA, 19/05/2026</td>   ← dateSubmitted
  //   <td>00:00</td>                   ← totalHrs

  const rowRegex =
    /<tr[^>]*>\s*<td>\s*<a href='MyTimeSheetDetail\.aspx\?id=(\d+)'>\s*([\d\/]+)\s*<\/a>\s*<\/td>\s*<td>[^<]*<\/td>\s*<td>[^<]*<\/td>\s*<td>\s*([^<]+?)\s*<\/td>\s*<td>\s*([\d:]+)\s*<\/td>/gi;

  const records = [];
  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const id = match[1];
    const weekEnd = match[2].trim(); // DD/MM/YYYY
    const dateSubmitted = match[3].trim(); // e.g. "11:31:SA, 19/05/2026"
    const totalHrs = match[4].trim(); // HH:MM

    records.push({ id, weekEnd, dateSubmitted, totalHrs });
    console.log(
      `[BG] Found record: id=${id} weekEnd=${weekEnd} dateSubmitted=${dateSubmitted} totalHrs=${totalHrs}`,
    );
  }

  if (records.length === 0) {
    console.log('[BG] No records found → will create new');
    return null;
  }

  // Filter to records matching exactly our weekEnding
  const matching = records.filter((r) => r.weekEnd === weekEnding);
  console.log(`[BG] Matching weekEnding="${weekEnding}":`, matching);

  if (matching.length === 0) {
    console.log('[BG] No matching weekEnding → will create new');
    return null;
  }

  // Parse dateSubmitted "11:31:SA, 19/05/2026" → Date object for sorting
  // Format: HH:MM:AM/PM, DD/MM/YYYY  (SA=AM, CH=PM in Vietnamese)
  function parseDateSubmitted(ds) {
    try {
      const m = ds.match(/(\d+):(\d+):(SA|CH),\s*(\d+)\/(\d+)\/(\d+)/i);
      if (!m) return new Date(0);
      let [, hh, min, ampm, dd, mo, yyyy] = m;
      hh = parseInt(hh, 10);
      if (ampm.toUpperCase() === 'CH' && hh < 12) hh += 12;
      if (ampm.toUpperCase() === 'SA' && hh === 12) hh = 0;
      return new Date(
        parseInt(yyyy),
        parseInt(mo) - 1,
        parseInt(dd),
        hh,
        parseInt(min),
      );
    } catch {
      return new Date(0);
    }
  }

  const parseHrs = (hhmm) => {
    const [h, m] = (hhmm || '0:0').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };

  // Sort by dateSubmitted descending (newest first)
  const sorted = [...matching].sort(
    (a, b) =>
      parseDateSubmitted(b.dateSubmitted) - parseDateSubmitted(a.dateSubmitted),
  );

  console.log(
    '[BG] Sorted by dateSubmitted (newest first):',
    sorted.map((r) => `id=${r.id} date=${r.dateSubmitted} hrs=${r.totalHrs}`),
  );

  // Prefer newest record with totalHrs > 0; fallback to newest overall
  const withHours = sorted.filter((r) => parseHrs(r.totalHrs) > 0);
  const chosen = withHours.length > 0 ? withHours[0] : sorted[0];

  console.log(
    `[BG] Chosen: id=${chosen.id} dateSubmitted=${chosen.dateSubmitted} totalHrs=${chosen.totalHrs}`,
  );
  return chosen;
}

async function loadExistingTimesheet(weekEnding) {
  const session = await loadSession();
  if (!session?.cookies) {
    return { success: false, needLogin: true, message: 'Chưa đăng nhập' };
  }

  const record = await fetchTimesheetRecord(session.cookies, weekEnding);
  if (!record?.id) {
    return {
      success: true,
      found: false,
      message: 'Không tìm thấy timesheet đã submit',
    };
  }

  const detailUrl = `${BASE_URL()}/Admin/Pages/TimeSheetOnline/MyTimeSheetDetail.aspx?id=${encodeURIComponent(record.id)}`;
  const res = await fetch(detailUrl, {
    method: 'GET',
    credentials: 'include',
    headers: {
      ...buildHeaders(session.cookies),
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      Referer: `${BASE_URL()}/Admin/Pages/TimeSheetOnline/MyTimeSheetList.aspx`,
    },
    redirect: 'manual',
  });
  const html = await res.text();
  if (
    res.status === 302 ||
    /Login\.aspx|txt_Username|txt_Password/i.test(html)
  ) {
    return {
      success: false,
      needLogin: true,
      message: 'Server yêu cầu đăng nhập lại',
    };
  }
  if (!res.ok) {
    return {
      success: false,
      message: `Không đọc được detail timesheet: HTTP ${res.status}`,
    };
  }

  const days = parseTimesheetDetailTasks(html);
  const taskCount = Object.values(days).reduce(
    (sum, tasks) => sum + tasks.length,
    0,
  );
  console.warn('[Timesheet Detail Debug] Loaded existing timesheet detail', {
    record,
    detailUrl,
    taskCount,
    days,
  });
  return {
    success: true,
    found: true,
    record,
    detailUrl,
    weekEnding,
    days,
    taskCount,
    hasData: taskCount > 0,
  };
}

function parseTimesheetDetailTasks(html) {
  const mapping = {
    Monday: 'mon',
    Tuesday: 'tue',
    Wednesday: 'wed',
    Thursday: 'thu',
    Friday: 'fri',
    Saturday: 'sat',
    Sunday: 'sun',
  };
  const result = {
    mon: [],
    tue: [],
    wed: [],
    thu: [],
    fri: [],
    sat: [],
    sun: [],
  };
  for (const [dayName, dayCode] of Object.entries(mapping)) {
    const table = extractTableById(html, `tbl_${dayName}`);
    if (!table) continue;
    const rowRe =
      /<tr\b[^>]*id=['"]tr(?:mon|tue|wed|thu|fri|sat|sun)_\d+['"][^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRe.exec(table)) !== null) {
      const cells = extractTableCells(rowMatch[1]).map(stripHtml);
      if (cells.length < 5) continue;
      result[dayCode].push({
        project: cells[0] || '',
        task: cells[1] || '',
        startTime: normalizeDetailTime(cells[2]),
        breakTime: normalizeDetailTime(cells[3]),
        finishTime: normalizeDetailTime(cells[4]),
        workHours: '',
        status: extractDetailRowStatus(cells),
      });
    }
  }
  return result;
}

function extractDetailRowStatus(cells) {
  for (let i = cells.length - 1; i >= 0; i--) {
    const value = String(cells[i] || '').trim();
    if (/^(new|approved)$/i.test(value)) return value;
  }
  return '';
}

function extractTableCells(row) {
  const cells = [];
  const re = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
  let match;
  while ((match = re.exec(row || '')) !== null) cells.push(match[1]);
  return cells;
}

function extractTableById(html, id) {
  const markerRe = new RegExp(`<table\\b[^>]*id=["']${id}["'][^>]*>`, 'i');
  const marker = markerRe.exec(html || '');
  if (!marker) return '';
  const start = marker.index;
  let depth = 0;
  const tagRe = /<\/?table\b[^>]*>/gi;
  tagRe.lastIndex = start;
  let match;
  while ((match = tagRe.exec(html)) !== null) {
    if (match[0][1] === '/') depth--;
    else depth++;
    if (depth === 0) return html.slice(start, tagRe.lastIndex);
  }
  return '';
}

function normalizeDetailTime(value) {
  const match = String(value || '').match(/\b(\d{1,2}):(\d{2})\b/);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : '';
}


async function ensureServerRows(session, meta, config) {
  let changed = false;
  for (const { dayCode, tasks } of config.days || []) {
    const needed = tasks?.length || 0;
    if (needed <= 0) continue;
    const current = meta.dayRecordIds?.[dayCode]?.length || 0;
    for (let dayCount = current; dayCount < needed; dayCount++) {
      const result = await addTimesheetRow(dayCode, {
        session,
        timesheetId: meta.timesheetId,
        dayCount,
      });
      if (!result?.success) {
        throw new Error(result?.message || `Không tạo được row ${dayCode} #${dayCount + 1}`);
      }
      changed = true;
    }
  }
  return changed;
}

async function fetchEditMeta(session, timesheetId) {
  const editUrl = timesheetId
    ? `${BASE_URL()}/Admin/Pages/TimeSheetOnline/TimeSheetEdit.aspx?id=${encodeURIComponent(timesheetId)}`
    : `${BASE_URL()}/Admin/Pages/TimeSheetOnline/TimeSheetEdit.aspx`;

  console.log(`[BG] Loading edit page: ${editUrl}`);

  const res = await fetch(editUrl, {
    method: 'GET',
    credentials: 'include',
    headers: buildHeaders(session.cookies),
  });
  const html = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (/Login\.aspx|txt_Username|txt_Password/i.test(html)) {
    throw new Error('Server trả về trang login, cookie không còn hợp lệ');
  }

  return {
    timesheetId: timesheetId || extractHiddenValue(html, 'hdfId') || '',
    employeeId: extractHiddenValue(html, 'hdfEmployeeId'),
    employeeName: extractHiddenValue(html, 'hdfEmployeeName'),
    employeeCode: extractHiddenValue(html, 'hdfEmployeeCode'),
    dateSubmitted: extractHiddenValue(html, 'hdfdateSubmitted') || '',
    dayRecordIds: parseDayRecordIds(html),
    dayCounts: parseDayCounts(html),
    ...session,
  };
}

// ── Submit timesheet ───────────────────────────────────────────────────────

async function submitTimesheet(config) {
  const session = await loadSession();
  if (!session?.cookies) {
    return { success: false, needLogin: true, message: 'Chưa đăng nhập' };
  }

  const weekEnding = config.weekEnding || getWeekEnding();

  // ── Step 1: Find existing record for this weekEnding ──────────────────
  let existingRecord = null;
  try {
    existingRecord = await fetchTimesheetRecord(session.cookies, weekEnding);
  } catch (e) {
    console.warn(
      '[BG] fetchTimesheetRecord failed, will create new:',
      e.message,
    );
  }

  // ── Step 2: Fetch the edit page (new or existing) ─────────────────────
  let meta;
  try {
    meta = await fetchEditMeta(session, existingRecord?.id || '');
    const addedRows = await ensureServerRows(session, meta, config);
    if (addedRows) {
      meta = await fetchEditMeta(session, meta.timesheetId || existingRecord?.id || '');
    }

    console.log('[BG] meta:', {
      timesheetId: meta.timesheetId,
      employeeCode: meta.employeeCode,
      dayRecordIds: meta.dayRecordIds,
    });
  } catch (e) {
    _session = null;
    await chrome.storage.local.remove('timesheetSession');
    return {
      success: false,
      needLogin: true,
      message: `Không đọc được trang timesheet: ${e.message}`,
    };
  }

  // Build payload
  const payload = buildSubmitPayload(meta, config, weekEnding);

  // ── DEBUG: Log payload và tạm dừng — UNCOMMENT đoạn fetch bên dưới khi test OK ──
  console.log('[BG] ══════════ DEBUG SUBMIT ══════════');
  console.log('[BG] weekEnding   :', weekEnding);
  console.log('[BG] existingRecord:', existingRecord);
  console.log('[BG] timesheetId  :', meta.timesheetId);
  console.log('[BG] payload entries:');
  for (const [k, v] of payload.entries()) {
    console.log(`  ${k} = ${v}`);
  }
  console.log('[BG] ════════════════════════════════');

  // ── TODO: Uncomment block này khi debug xong ──────────────────────────
  // return {
  //   success: false,
  //   debug: true,
  //   message:
  //     '[DEBUG] Payload đã log ra console — kiểm tra rồi uncomment phần POST trong background.js',
  //   timesheetId: meta.timesheetId,
  //   weekEnding,
  //   existingRecord,
  // };
  // ── END TODO ──────────────────────────────────────────────────────────

  const url = meta.timesheetId
    ? `${BASE_URL()}/Admin/Pages/TimeSheetOnline/TimeSheetEdit.aspx?id=${encodeURIComponent(meta.timesheetId)}`
    : `${BASE_URL()}/Admin/Pages/TimeSheetOnline/TimeSheetEdit.aspx`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        ...buildHeaders(session.cookies),
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: meta.timesheetId
          ? `${BASE_URL()}/Admin/Pages/TimeSheetOnline/TimeSheetEdit.aspx?id=${meta.timesheetId}`
          : `${BASE_URL()}/Admin/Pages/TimeSheetOnline/TimeSheetEdit.aspx`,
      },
      body: payload.toString(),
    });
  } catch (e) {
    return { success: false, message: `Network error: ${e.message}` };
  }

  const text = await res.text();

  if (text.includes('success:true') || text.includes('"success":true')) {
    return {
      success: true,
      message: meta.timesheetId
        ? 'Đã cập nhật timesheet thành công ✓'
        : 'Đã tạo timesheet thành công ✓',
      detailUrl: meta.timesheetId
        ? `${BASE_URL()}/Admin/Pages/TimeSheetOnline/MyTimeSheetDetail.aspx?id=${meta.timesheetId}`
        : '',
    };
  }

  if (
    res.status === 302 ||
    /Login\.aspx|txt_Username|txt_Password|btn_Login/i.test(text)
  ) {
    _session = null;
    await chrome.storage.local.remove('timesheetSession');
    return {
      success: false,
      needLogin: true,
      message: 'Server yêu cầu đăng nhập lại',
      debug: { status: res.status, responsePreview: text.slice(0, 300) },
    };
  }

  return {
    success: false,
    message: `Server trả về: ${text.slice(0, 100)}`,
    debug: { status: res.status, responsePreview: text.slice(0, 300) },
  };
}

// ── addTimeSheetRecord headless ────────────────────────────────────────────
// For multi-task: call server to create a new row, get back newDayCount + recId

async function addTimesheetRow(dayCode, options = {}) {
  const session = options.session || (await loadSession());
  if (!session?.cookies) return { success: false, needLogin: true };

  const url = options.timesheetId
    ? `${BASE_URL()}/Admin/Pages/TimeSheetOnline/TimeSheetEdit.aspx?id=${encodeURIComponent(options.timesheetId)}`
    : `${BASE_URL()}/Admin/Pages/TimeSheetOnline/TimeSheetEdit.aspx`;
  const params = new URLSearchParams({
    action: 'addTimeSheetRecord',
    dayCode,
    id: `'tbl_${capitalize(dayCode)}'`,
    dayCount: String(options.dayCount ?? 0),
    recIdList: `ctl00_ContentPlaceHolder1_hdf${dayCode}`,
  });

  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      ...buildHeaders(session.cookies),
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: params.toString(),
  });

  const text = await res.text();
  return parseAddTimesheetRowResult(text);
}

function htmlDecode(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function parseAddTimesheetRowResult(text) {
  const raw = String(text || '');
  const success = /success\s*:\s*true/i.test(raw) || /["']success["']\s*:\s*true/i.test(raw);
  if (!success) return { success: false, message: raw.slice(0, 200) };
  return {
    success: true,
    dayCode: extractJsObjectValue(raw, 'dayCode') || '',
    newDayCount: Number(extractJsObjectValue(raw, 'newDayCount') || 0),
    inputName: extractJsObjectValue(raw, 'inputName') || '',
    projectInput: extractJsObjectValue(raw, 'projectInput') || '',
  };
}

function extractJsObjectValue(raw, key) {
  const quoted = new RegExp(`${key}\s*:\s*['"]([\s\S]*?)['"]\s*(?:,|})`, 'i').exec(raw);
  if (quoted) return htmlDecode(quoted[1]);
  const bare = new RegExp(`${key}\s*:\s*([^,}]+)`, 'i').exec(raw);
  return bare ? htmlDecode(bare[1].trim()) : '';
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function getAuthCookies() {
  const url = BASE_URL();
  const names = ['ASP.NET_SessionId', '.ASPXAUTH'];
  const cookies = [];
  for (const name of names) {
    const cookie = await getCookie({ url, name });
    if (cookie) cookies.push(cookie);
  }
  return cookies;
}

async function clearAuthCookies() {
  const url = BASE_URL();
  const cookies = await getAuthCookies();
  await Promise.all(
    cookies.map((cookie) => removeCookie({ url, name: cookie.name })),
  );
}

function getCookie(details) {
  return new Promise((resolve, reject) => {
    if (!chrome.cookies?.get) {
      reject(
        new Error('Thiếu quyền cookies hoặc chrome.cookies API không khả dụng'),
      );
      return;
    }
    chrome.cookies.get(details, (cookie) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(cookie);
    });
  });
}

function removeCookie(details) {
  return new Promise((resolve) => {
    if (!chrome.cookies?.remove) {
      resolve(null);
      return;
    }
    chrome.cookies.remove(details, () => resolve(null));
  });
}

function buildHeaders(cookieStr) {
  return {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:150.0) Gecko/20100101 Firefox/150.0',
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    Origin: BASE_URL(),
    Cookie: cookieStr,
  };
}

async function safeResponseText(response) {
  try {
    return await response.clone().text();
  } catch (e) {
    return '';
  }
}

function extractLoginFailure(html) {
  if (!html) return '';
  const patterns = [
    /<span[^>]*(?:id|class)=["'][^"']*(?:error|message|validation|lbl)[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
    /<div[^>]*(?:id|class)=["'][^"']*(?:error|message|validation|alert)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      const text = stripHtml(match[1]);
      if (text) return text;
    }
  }
  return '';
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractInput(html, name) {
  const m =
    html.match(
      new RegExp(
        `<input[^>]+name=["']${name}["'][^>]+value=["']([^"']*)["']`,
        'i',
      ),
    ) ||
    html.match(
      new RegExp(
        `<input[^>]+value=["']([^"']*)["'][^>]+name=["']${name}["']`,
        'i',
      ),
    );
  return m ? m[1] : '';
}

function extractHiddenValue(html, fieldId) {
  // Match id="hdfEmployeeId" value="30120" or name="...hdfEmployeeId" value="..."
  const patterns = [
    new RegExp(
      `id=["'](?:ctl00_ContentPlaceHolder1_)?${fieldId}["'][^>]*value=["']([^"']*)["']`,
      'i',
    ),
    new RegExp(
      `name=["'](?:ctl00\\$ContentPlaceHolder1\\$)?${fieldId}["'][^>]*value=["']([^"']*)["']`,
      'i',
    ),
    new RegExp(
      `value=["']([^"']*)["'][^>]*id=["'](?:ctl00_ContentPlaceHolder1_)?${fieldId}["']`,
      'i',
    ),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return decodeURIComponent(m[1].replace(/\+/g, ' '));
  }
  return '';
}

function parseDayRecordIds(html) {
  // Extract hdfmon_0=353713, hdftue_0=353714, etc.
  const result = {};
  const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  DAYS.forEach((day) => {
    const ids = [];
    let i = 0;
    while (true) {
      const val = extractHiddenValue(html, `hdf${day}_${i}`);
      if (!val && i > 0) break;
      ids.push(val || '0');
      i++;
      if (i > 20) break; // safety
    }
    result[day] = ids;
  });
  return result;
}

function parseDayCounts(html) {
  const result = {};
  const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  DAYS.forEach((day) => {
    // Note: wed uses lowercase 'count' (hdfwedcount) — confirmed from HAR
    const key = day === 'wed' ? `hdf${day}count` : `hdf${day}Count`;
    result[day] = parseInt(extractHiddenValue(html, key) || '1', 10);
  });
  return result;
}

function extractProjectList(html) {
  const text = String(html || '');
  const projects = new Set();
  const re = /Project_\d+_text\s*=\s*new Array\(([\s\S]*?)\);/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    parseProjectArrayItems(match[1]).forEach((project) =>
      projects.add(project),
    );
  }
  return Array.from(projects).sort((a, b) => a.localeCompare(b));
}

function parseProjectArrayItems(raw) {
  const items = [];
  const re = /'((?:\\'|[^'])*)'/g;
  let match;
  while ((match = re.exec(raw || '')) !== null) {
    const value = normalizeProject(match[1].replace(/\\'/g, "'"));
    if (value && value !== '/0') items.push(value);
  }
  return items;
}

function normalizeProject(project) {
  return String(project || '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

async function searchProjects(keyword, limit = 30) {
  const session = await loadSession();
  if (!session?.cookies)
    return {
      success: false,
      needLogin: true,
      projects: [],
      message: 'Chưa đăng nhập',
    };

  let projects = Array.isArray(session.projectList) ? session.projectList : [];
  if (projects.length === 0) {
    const html = await fetchTimesheetHtml(session.cookies);
    projects = extractProjectList(html);
    if (projects.length === 0) {
      return {
        success: false,
        projects: [],
        message: 'Không tìm thấy project list trong timesheet HTML',
        debug: { htmlPreview: html.slice(0, 500) },
      };
    }
    await saveSession({ ...session, projectList: projects });
  }

  const needle = normalizeProject(keyword).toLowerCase();
  return {
    success: true,
    projects: projects
      .filter((project) => project.toLowerCase().includes(needle))
      .slice(0, limit),
  };
}

function parseCookies(setCookieHeader) {
  // Handle multiple Set-Cookie headers merged as string
  return setCookieHeader
    .split(/,(?=[^;]+=[^;]+)/)
    .map((part) => {
      const [nameVal] = part.trim().split(';');
      const [name, ...rest] = nameVal.split('=');
      return { name: name.trim(), value: rest.join('=').trim() };
    })
    .filter((c) => c.name);
}

function parseTime(timeStr) {
  if (!timeStr) return null;
  const m = timeStr.match(/^(\d{1,2})[:\.](\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function formatMinutes(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function getWeekEnding() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const diff = day === 0 ? 0 : 7 - day;
  const sunday = new Date(now);
  sunday.setDate(now.getDate() + diff);
  const d = String(sunday.getDate()).padStart(2, '0');
  const mo = String(sunday.getMonth() + 1).padStart(2, '0');
  const y = sunday.getFullYear();
  return `${d}/${mo}/${y}`;
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Verify session against server ─────────────────────────────────────────
// Lightweight check: GET a small page, detect redirect to login

async function verifySession() {
  const session = await loadSession();
  if (!session?.cookies) {
    return { loggedIn: false, reason: 'no_session' };
  }

  const url = `${BASE_URL()}/Admin/Pages/TimeSheetOnline/TimeSheetEdit.aspx`;
  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      credentials: 'omit',
      headers: buildHeaders(session.cookies),
      redirect: 'manual',
    });
  } catch (e) {
    // Network error — can't reach server, assume session still valid
    return { loggedIn: true, session, offline: true };
  }

  // Server redirects to login page when session expired
  if (res.type === 'opaqueredirect' || res.status === 302) {
    await clearSession();
    return { loggedIn: false, reason: 'session_expired' };
  }

  // Read first 600 chars to detect login page HTML
  let preview = '';
  try {
    const reader = res.body.getReader();
    const { value } = await reader.read();
    reader.cancel();
    preview = new TextDecoder().decode(value || new Uint8Array()).slice(0, 600);
  } catch (e) {
    /* ignore */
  }

  const isLoginPage =
    preview.includes('Login.aspx') ||
    preview.includes('txt_Username') ||
    preview.includes('btn_Login') ||
    (res.url && res.url.includes('Login'));

  if (isLoginPage) {
    await clearSession();
    return { loggedIn: false, reason: 'session_expired' };
  }

  return { loggedIn: true, session };
}

// ── Message listener ───────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
  if (req.action === 'login') {
    login(req.username, req.password)
      .then(sendResponse)
      .catch((e) => sendResponse({ success: false, message: e.message }));
    return true;
  }

  if (req.action === 'logout') {
    clearSession().then(() => sendResponse({ success: true }));
    return true;
  }

  if (req.action === 'checkSession') {
    loadSession()
      .then((session) => {
        sendResponse({ loggedIn: !!session?.cookies, session });
      })
      .catch((e) => sendResponse({ loggedIn: false, message: e.message }));
    return true;
  }

  if (req.action === 'verifySession') {
    verifySession()
      .then(sendResponse)
      .catch((e) => sendResponse({ loggedIn: false, message: e.message }));
    return true;
  }

  if (req.action === 'loadExistingTimesheet') {
    loadExistingTimesheet(req.weekEnding)
      .then(sendResponse)
      .catch((e) => sendResponse({ success: false, message: e.message }));
    return true;
  }

  if (req.action === 'submitTimesheetHeadless') {
    submitTimesheet(req.config)
      .then(sendResponse)
      .catch((e) => sendResponse({ success: false, message: e.message }));
    return true;
  }

  if (req.action === 'searchProjects') {
    searchProjects(req.keyword || '', req.limit || 30)
      .then(sendResponse)
      .catch((e) =>
        sendResponse({ success: false, projects: [], message: e.message }),
      );
    return true;
  }

  if (req.action === 'addRowHeadless') {
    addTimesheetRow(req.dayCode)
      .then(sendResponse)
      .catch((e) => sendResponse({ success: false, message: e.message }));
    return true;
  }

  if (req.action === 'setBaseUrl') {
    self.__timesheetBaseUrl = req.url;
    sendResponse({ success: true });
    return true;
  }
});

console.log('[Timesheet AutoFill] background service worker ready');
