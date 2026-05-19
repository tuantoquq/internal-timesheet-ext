// Timesheet AutoFill — content.js (fixed v2)

(function () {
  if (window.__timesheetAutoFillInjected) return;
  window.__timesheetAutoFillInjected = true;

  const DAY_ADD_BTN = {
    mon: 'A1',
    tue: 'A2',
    wed: 'A3',
    thu: 'A4',
    fri: 'A5',
    sat: 'A6',
    sun: 'A7',
  };

  // ── Helpers ────────────────────────────────────────────────────────────────

  function setInputValue(el, value) {
    if (!el) return false;
    const proto =
      el.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function firstVisible(selectors) {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && window.getComputedStyle(el).display !== 'none') return el;
    }
    return null;
  }

  async function loginTimesheet({ username, password }) {
    const userEl = firstVisible([
      'input[name="txt_Username"]',
      'input[id="txt_Username"]',
      'input[name$="txtUsername"]',
      'input[id$="txtUsername"]',
      'input[name*="User"]',
      'input[id*="User"]',
      'input[type="text"]',
    ]);
    const passEl = firstVisible([
      'input[name="txt_Password"]',
      'input[id="txt_Password"]',
      'input[name$="txtPassword"]',
      'input[id$="txtPassword"]',
      'input[type="password"]',
    ]);
    if (!userEl || !passEl) {
      return { success: false, message: 'Không tìm thấy form login trên tab timesheet' };
    }

    setInputValue(userEl, username);
    setInputValue(passEl, password);

    const form = passEl.closest('form') || userEl.closest('form') || document.querySelector('form');
    const controls = Array.from(document.querySelectorAll('input[type="submit"], button[type="submit"], input[type="button"], button'));
    const submit =
      controls.find((el) => /btn_Login|login|đăng nhập|sign in/i.test(`${el.name || ''} ${el.id || ''} ${el.value || ''} ${el.textContent || ''}`)) ||
      controls.find((el) => el.type === 'submit');

    if (submit) submit.click();
    else if (form?.requestSubmit) form.requestSubmit();
    else if (form) form.submit();
    else return { success: false, message: 'Không tìm thấy nút submit login' };

    await sleep(1500);
    const stillHasPassword = !!document.querySelector('input[type="password"]');
    return {
      success: !stillHasPassword,
      message: stillHasPassword ? 'Trang vẫn ở màn hình login sau khi submit' : 'Đã submit login trên tab',
    };
  }

  // ── Key insight: row index ≠ sequential number ─────────────────────────────
  // Server assigns newDayCount from DB — can be 0, 2, 3, 5...
  // So we must read actual row IDs from DOM, not assume 0,1,2...

  /**
   * Get all existing row suffix numbers for a day, sorted ascending.
   * e.g. for Monday with rows trmon_0, trmon_2, trmon_3 → [0, 2, 3]
   */
  function getExistingRowSuffixes(dayCode) {
    const rows = document.querySelectorAll(`tr[id^="tr${dayCode}_"]`);
    return Array.from(rows)
      .map((r) => {
        const m = r.id.match(new RegExp(`^tr${dayCode}_(\\d+)$`));
        return m ? parseInt(m[1], 10) : null;
      })
      .filter((n) => n !== null)
      .sort((a, b) => a - b);
  }

  /**
   * Count how many rows currently exist for a day.
   */
  function getRowCount(dayCode) {
    return document.querySelectorAll(`tr[id^="tr${dayCode}_"]`).length;
  }

  // Wait for a new row to appear (count increases by 1)
  function waitForNewRow(dayCode, previousCount, timeout = 12000) {
    return new Promise((resolve, reject) => {
      if (getRowCount(dayCode) > previousCount) {
        resolve();
        return;
      }
      const obs = new MutationObserver(() => {
        if (getRowCount(dayCode) > previousCount) {
          obs.disconnect();
          resolve();
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => {
        obs.disconnect();
        reject(new Error(`Timeout waiting for new row for ${dayCode}`));
      }, timeout);
    });
  }

  // ── Click + button ─────────────────────────────────────────────────────────

  function clickAddButton(dayCode) {
    const btnId = DAY_ADD_BTN[dayCode];
    let btn = document.getElementById(btnId);
    if (!btn) btn = document.querySelector(`a[id='${btnId}']`);
    if (!btn) btn = document.querySelector(`[id='${btnId}']`);
    if (!btn) {
      btn = Array.from(document.querySelectorAll('a')).find((a) => {
        const oc = a.getAttribute('onclick') || '';
        return oc.includes(`dayCode:"${dayCode}"`);
      });
    }
    if (btn) {
      btn.click();
      return true;
    }
    console.error(`[AutoFill] Add button not found for ${dayCode}`);
    return false;
  }

  // ── Ensure N rows exist, return array of all suffix numbers ───────────────

  async function ensureRows(dayCode, neededCount) {
    // Keep clicking + until we have enough rows
    while (getRowCount(dayCode) < neededCount) {
      const before = getRowCount(dayCode);
      const clicked = clickAddButton(dayCode);
      if (!clicked) {
        console.error(`[AutoFill] Cannot add row for ${dayCode}`);
        break;
      }
      try {
        await waitForNewRow(dayCode, before, 12000);
        await sleep(300); // let actb/JS initialize
      } catch (e) {
        console.error(`[AutoFill] New row timeout for ${dayCode}:`, e.message);
        break;
      }
    }
    return getExistingRowSuffixes(dayCode);
  }

  // ── Fill one task row ──────────────────────────────────────────────────────
  // suffix = the actual number in the row ID (e.g. 0, 2, 3...)

  async function fillRow(dayCode, suffix, taskData, defaults) {
    const project = taskData.project || '';
    const task = taskData.task || '';
    const startTime = taskData.startTime || defaults.defaultStartTime || '';
    const breakTime = taskData.breakTime || defaults.defaultBreakTime || '';
    const finishTime = taskData.finishTime || defaults.defaultFinishTime || '';

    let filled = 0;
    const row = document.getElementById(`tr${dayCode}_${suffix}`);
    const rowInputs = row ? Array.from(row.querySelectorAll('input[type="text"], input:not([type]), textarea')) : [];
    const findInRow = (re, fallback) => rowInputs.find((el) => re.test(el.name || el.id || '')) || fallback?.();
    const fallbackTextInputs = () => row ? Array.from(row.querySelectorAll('input[type="text"], input:not([type])')) : [];

    // Project: monProject_0, monProject_2, ...
    if (project) {
      const el =
        document.querySelector(`[name="${dayCode}Project_${suffix}"]`) ||
        findInRow(/Project/i, () => fallbackTextInputs().find((input) => !/(Start|Break|Finish|Total|hdf)/i.test(input.name || input.id || '')));
      if (el) {
        setInputValue(el, project);
        const textEl = document.querySelector(
          `[name="${dayCode}Project_${suffix}_text"]`,
        );
        if (textEl) setInputValue(textEl, project);
        filled++;
      } else {
        console.warn(
          `[AutoFill] Project field not found: ${dayCode}Project_${suffix}`,
        );
      }
    }

    // Task textarea: monTask0, monTask2, ... (NO underscore — confirmed from source)
    if (task) {
      const el =
        document.querySelector(`[name="${dayCode}Task${suffix}"]`) ||
        findInRow(/Task/i, () => row?.querySelector('textarea'));
      if (el) {
        setInputValue(el, task);
        filled++;
      } else
        console.warn(
          `[AutoFill] Task field not found: ${dayCode}Task${suffix}`,
        );
    }

    // Time fields: monStart_0, monBreak_0, monFinish_0
    const textInputs = fallbackTextInputs();
    const timeInputs = textInputs.filter((input) => !/Project|Task|Total|hdf/i.test(input.name || input.id || ''));
    const startEl =
      document.querySelector(`[name="${dayCode}Start_${suffix}"]`) ||
      findInRow(/Start/i, () => timeInputs[0]);
    const breakEl =
      document.querySelector(`[name="${dayCode}Break_${suffix}"]`) ||
      findInRow(/Break/i, () => timeInputs[1]);
    const finishEl =
      document.querySelector(`[name="${dayCode}Finish_${suffix}"]`) ||
      findInRow(/Finish/i, () => timeInputs[2]);

    if (startTime && startEl) {
      setInputValue(startEl, startTime);
      filled++;
    }
    if (breakTime && breakEl) {
      setInputValue(breakEl, breakTime);
      filled++;
    }
    if (finishTime && finishEl) {
      setInputValue(finishEl, finishTime);
      filled++;
    }

    // Trigger total hours recalculation
    try {
      if (typeof window.timeValueChange === 'function') {
        window.timeValueChange(`${dayCode}_${suffix}`, dayCode);
      }
    } catch (e) {
      /* ignore */
    }

    return { success: filled > 0, filled, suffix };
  }

  // ── Submit form ────────────────────────────────────────────────────────────

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
  }

  async function postTimesheetForm() {
    const controls = Array.from(
      document.querySelectorAll('input[type="submit"], button[type="submit"], input[type="button"], button'),
    );
    const keywords = /submit|save|post|send|create|update|lưu|gửi|cập nhật/i;
    const control =
      controls.find((el) => isVisible(el) && el.type === 'submit') ||
      controls.find((el) => {
        const text = `${el.name || ''} ${el.id || ''} ${el.value || ''} ${el.textContent || ''}`;
        return isVisible(el) && keywords.test(text);
      });

    if (control) {
      control.click();
      await sleep(500);
      return { success: true, message: 'Đã submit timesheet' };
    }

    const form = document.querySelector('form');
    if (!form) return { success: false, message: 'Không tìm thấy form để submit' };
    if (form.requestSubmit) form.requestSubmit();
    else form.submit();
    await sleep(500);
    return { success: true, message: 'Đã submit timesheet' };
  }

  // ── Main fill ──────────────────────────────────────────────────────────────

  async function fillTimesheet(config) {
    const weekEndingEl = document.querySelector("[name$='txtWeekEnding']");
    if (weekEndingEl) {
      const weekEnding = config.weekEnding || (window.TimesheetCore || TimesheetCore).getWeekEndingDate();
      setInputValue(weekEndingEl, weekEnding);
      console.log('[AutoFill] Set Week Ending to:', weekEnding);
    }

    let totalSuccess = 0,
      totalFailed = 0;
    const results = {};

    for (const { dayCode, tasks } of config.days) {
      if (!tasks || tasks.length === 0) continue;
      results[dayCode] = { rows: [] };

      // Step 1: ensure we have enough rows (add only what's missing)
      const neededCount = tasks.length;
      const suffixes = await ensureRows(dayCode, neededCount);

      console.log(
        `[AutoFill] ${dayCode}: needed=${neededCount}, rows found=${suffixes}`,
      );

      if (suffixes.length < neededCount) {
        console.error(
          `[AutoFill] ${dayCode}: only got ${suffixes.length}/${neededCount} rows`,
        );
      }

      // Step 2: fill each task into the corresponding row by position
      for (let i = 0; i < tasks.length; i++) {
        const suffix = suffixes[i];
        if (suffix === undefined) {
          results[dayCode].rows.push({
            success: false,
            message: `No row at position ${i}`,
          });
          totalFailed++;
          continue;
        }

        const res = await fillRow(dayCode, suffix, tasks[i], config);
        results[dayCode].rows.push(res);
        res.success ? totalSuccess++ : totalFailed++;
        await sleep(100);
      }
    }

    let postResult = null;
    if (config.autoPost && totalFailed === 0) {
      postResult = await postTimesheetForm();
    }

    return {
      success: totalFailed === 0 && (!config.autoPost || postResult?.success === true),
      totalSuccess,
      totalFailed,
      results,
      postResult,
      message: postResult?.success
        ? `${totalSuccess} row(s) filled and submitted`
        : `${totalSuccess} row(s) filled${totalFailed > 0 ? `, ${totalFailed} failed` : ''}`,
    };
  }

  // ── Clear form ─────────────────────────────────────────────────────────────

  async function clearFormOnPage() {
    let count = 0;
    document.querySelectorAll('input[type="text"], textarea').forEach((el) => {
      const name = el.name || '';
      if (
        /^(mon|tue|wed|thu|fri|sat|sun)/.test(name) &&
        /Project|Task|Start|Break|Finish/.test(name)
      ) {
        setInputValue(el, '');
        count++;
      }
    });
    return { success: true, count, message: `Cleared ${count} fields` };
  }

  // ── Search projects ────────────────────────────────────────────────────────

  function searchProjectsOnPage(keyword) {
    if (!window.TimesheetCore) return [];
    const sources = Array.from(document.scripts).map(
      (s) => s.textContent || '',
    );
    sources.push(document.documentElement.innerHTML);
    return window.TimesheetCore.searchProjectSources(sources, keyword);
  }

  // ── Expose & message listener ──────────────────────────────────────────────

  window.TimesheetContent = {
    clickAddButton,
    clearFormOnPage,
    ensureRows,
    fillRow,
    fillTimesheet,
    getExistingRowSuffixes,
    loginTimesheet,
    postTimesheetForm,
    searchProjectsOnPage,
    setInputValue,
  };

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
      if (req.action === 'loginTimesheet') {
        loginTimesheet(req.credentials || {})
          .then(sendResponse)
          .catch((e) => sendResponse({ success: false, message: e.message }));
        return true;
      }
      if (req.action === 'fillTimesheet') {
        fillTimesheet(req.config)
          .then(sendResponse)
          .catch((e) => sendResponse({ success: false, message: e.message }));
        return true;
      }
      if (req.action === 'clearForm') {
        clearFormOnPage().then(sendResponse);
        return true;
      }
      if (req.action === 'searchProjects') {
        try {
          sendResponse({
            success: true,
            projects: searchProjectsOnPage(req.keyword || ''),
          });
        } catch (e) {
          sendResponse({ success: false, projects: [], message: e.message });
        }
        return true;
      }
    });
  }

  console.log('[Timesheet AutoFill] content script ready v2');
})();
