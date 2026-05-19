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

// ── Build submit payload ───────────────────────────────────────────────────

function buildSubmitPayload(meta, config, weekEnding) {
  const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

  const params = new URLSearchParams();

  // Core fields
  params.set('action', 'updateTimeSheet');
  if (meta.timesheetId) params.set('id', meta.timesheetId);

  params.set('ctl00$ContentPlaceHolder1$hdfId', meta.timesheetId || '');
  params.set('ctl00$ContentPlaceHolder1$hdfStatus', '');
  params.set('ctl00$ContentPlaceHolder1$hdfObjectId', '');
  params.set('ctl00$ContentPlaceHolder1$txtWeekEnding', weekEnding);
  params.set('ctl00$ContentPlaceHolder1$hdfEmployeeId', meta.employeeId || '');
  params.set(
    'ctl00$ContentPlaceHolder1$hdfEmployeeName',
    meta.employeeName || '',
  );
  params.set(
    'ctl00$ContentPlaceHolder1$hdfEmployeeCode',
    meta.employeeCode || '',
  );
  params.set(
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
    const records = meta.dayRecordIds?.[day] || [0]; // fallback to [0]
    const count = records.length;

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

    params.set(
      `ctl00$ContentPlaceHolder1$hdf${day}`,
      records.map((_, i) => i).join(',') + '*',
    );
    params.set(`ctl00$ContentPlaceHolder1$hdfTotal_${day}`, dayTotal);

    // Each row
    for (
      let i = 0;
      i < Math.max(count, tasks.length > 0 ? tasks.length : 1);
      i++
    ) {
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

      params.set(`${day}Project_${suffix}`, project);
      params.set(`${day}Start_${suffix}`, startTime);
      params.set(`${day}Break_${suffix}`, breakTime);
      params.set(`${day}Finish_${suffix}`, finishTime);
      params.set(`hdfTotal${day}_${suffix}`, rowTotal);
      params.set(`hdf${day}_${suffix}`, String(recId));
    }

    // Note: hdfwedcount vs hdfwedCount (lowercase 'c' for wed — confirmed from HAR!)
    const countKey = day === 'wed' ? `hdf${day}count` : `hdf${day}Count`;
    params.set(
      countKey,
      String(Math.max(count, tasks.length > 0 ? tasks.length : 1)),
    );
  });

  // Grand total
  params.set(
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
        (meta.dayRecordIds?.[day] || [0]).length,
        tasks.length > 0 ? tasks.length : 1,
      );
      i++
    ) {
      params.set(`${day}Task${i}`, tasks[i]?.task || '\n');
    }
  });

  return params;
}

// ── Submit timesheet ───────────────────────────────────────────────────────

async function submitTimesheet(config) {
  const cookieSession = await loadSessionFromBrowserCookies();
  const session = cookieSession || (await loadSession());
  if (!session?.cookies) {
    return { success: false, needLogin: true, message: 'Chưa đăng nhập' };
  }

  // Get week ending (Sunday of current week in DD/MM/YYYY)
  const weekEnding = config.weekEnding || getWeekEnding();

  // Fetch current timesheet page to get record IDs
  let meta;
  try {
    const page = await fetchTimesheetPage(session.cookies, weekEnding);
    meta = { ...page.meta, ...session };
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

  // POST to server
  const url = `${BASE_URL()}/Admin/Pages/TimeSheetOnline/TimeSheetEdit.aspx`;
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

  // Server returns: {success:true,message:'Object đã được cập nhật thành công'}
  if (text.includes('success:true') || text.includes('"success":true')) {
    return {
      success: true,
      message: 'Đã lưu timesheet thành công ✓',
      detailUrl: meta.timesheetId
        ? `${BASE_URL()}/Admin/Pages/TimeSheetOnline/MyTimeSheetDetail.aspx?id=${meta.timesheetId}`
        : '',
    };
  }

  // Session expired → redirect to login page
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

async function addTimesheetRow(dayCode) {
  const session = await loadSession();
  if (!session?.cookies) return { success: false, needLogin: true };

  const url = `${BASE_URL()}/Admin/Pages/TimeSheetOnline/TimeSheetEdit.aspx`;
  const params = new URLSearchParams({
    action: 'addTimeSheetRecord',
    dayCode,
    id: `'tbl_${capitalize(dayCode)}'`, // matches page JS: args.id
    dayCount: '0', // server will return actual newDayCount
    recIdList: `ctl00_ContentPlaceHolder1_hdf${dayCode}`,
  });

  const res = await fetch(url, {
    method: 'POST',
    credentials: 'omit',
    headers: {
      ...buildHeaders(session.cookies),
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: params.toString(),
  });

  const text = await res.text();
  try {
    // Server returns JSON-like: {success:true, newDayCount:1, ...}
    // Use eval-safe parse
    const result = JSON.parse(text.replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":'));
    return result;
  } catch (e) {
    return { success: false, message: text.slice(0, 100) };
  }
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
