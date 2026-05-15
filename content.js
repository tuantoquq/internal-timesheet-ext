// Timesheet AutoFill — content.js

(function() {
  if (window.__timesheetAutoFillInjected) return;
  window.__timesheetAutoFillInjected = true;

  const DAY_MAP = {
    mon: { name: 'Monday',    addBtnId: 'A1' },
    tue: { name: 'Tuesday',   addBtnId: 'A2' },
    wed: { name: 'Wednesday', addBtnId: 'A3' },
    thu: { name: 'Thursday',  addBtnId: 'A4' },
    fri: { name: 'Friday',    addBtnId: 'A5' },
    sat: { name: 'Saturday',  addBtnId: 'A6' },
    sun: { name: 'Sunday',    addBtnId: 'A7' },
  };

  // ── Helpers ────────────────────────────────────────────────────────────────

  function setInputValue(el, value) {
    if (!el) return false;
    const proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function waitFor(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector);
      if (el) { resolve(el); return; }
      const obs = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) { obs.disconnect(); resolve(el); }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { obs.disconnect(); reject(new Error('timeout: ' + selector)); }, timeout);
    });
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ── Row management ─────────────────────────────────────────────────────────

  function clickAddButton(dayCode) {
    const btn = document.getElementById(DAY_MAP[dayCode].addBtnId);
    if (btn) {
      btn.click();
      return true;
    }
    const links = Array.from(document.querySelectorAll('a[id^="A"]'));
    const targetLink = links.find(l => l.onclick && l.onclick.toString().includes(`dayCode:"${dayCode}"`));
    if (targetLink) {
      targetLink.click();
      return true;
    }
    return false;
  }

  async function ensureRow(dayCode, rowIndex) {
    if (rowIndex === 0) return true;

    for (let target = 1; target <= rowIndex; target++) {
      const rowId = 'tr' + dayCode + '_' + target;
      if (document.getElementById(rowId)) continue; 

      console.log(`[AutoFill] Creating row ${target} for ${dayCode}...`);
      const clicked = clickAddButton(dayCode);
      if (!clicked) {
        console.error('[AutoFill] Could not find add button for', dayCode);
        return false;
      }

      try {
        await waitFor('#' + rowId, 10000);
        console.log(`[AutoFill] Row ${rowId} appeared.`);
      } catch (e) {
        console.error('[AutoFill] Row did not appear within timeout:', rowId);
        return false;
      }
      await sleep(1000); 
    }
    return true;
  }

  // ── Fill one task row ──────────────────────────────────────────────────────

  async function fillRow(dayCode, rowIndex, taskData, defaults) {
    const project = taskData.project;
    const task = taskData.task;
    const startTime = taskData.startTime || defaults.defaultStartTime;
    const breakTime = taskData.breakTime || defaults.defaultBreakTime;
    const finishTime = taskData.finishTime || defaults.defaultFinishTime;
    
    let filled = 0;
    const q = (suffix) => document.querySelector(`[name$='${suffix}']`);

    const projectEl = q(`${dayCode}Project_${rowIndex}`);
    if (project && projectEl) { setInputValue(projectEl, project); filled++; }

    const taskEl = q(`${dayCode}Task${rowIndex}`);
    if (task && taskEl) { setInputValue(taskEl, task); filled++; }

    const startEl  = q(`${dayCode}Start_${rowIndex}`);
    const breakEl  = q(`${dayCode}Break_${rowIndex}`);
    const finishEl = q(`${dayCode}Finish_${rowIndex}`);

    if (startTime  && startEl)  { setInputValue(startEl,  startTime);  filled++; }
    if (breakTime  && breakEl)  { setInputValue(breakEl,  breakTime);  filled++; }
    if (finishTime && finishEl) { setInputValue(finishEl, finishTime); filled++; }

    if (startEl) startEl.dispatchEvent(new Event('change', { bubbles: true }));
    
    return { success: filled > 0, filled };
  }

  // ── Main actions ───────────────────────────────────────────────────────────

  async function fillTimesheet(config) {
    // Set Week Ending if not set or if we want to auto-calc
    const weekEndingEl = document.querySelector("[name$='txtWeekEnding']");
    if (weekEndingEl && !weekEndingEl.value) {
      const autoDate = (window.TimesheetCore || TimesheetCore).getWeekEndingDate();
      setInputValue(weekEndingEl, autoDate);
      console.log('[AutoFill] Set Week Ending to:', autoDate);
    }

    let totalSuccess = 0, totalFailed = 0;
    const results = {};

    for (const { dayCode, tasks } of config.days) {
      if (!tasks || tasks.length === 0) continue;
      results[dayCode] = { rows: [] };

      for (let i = 0; i < tasks.length; i++) {
        if (i > 0) {
          const ok = await ensureRow(dayCode, i);
          if (!ok) {
            results[dayCode].rows.push({ success: false, message: `Row ${i} creation failed` });
            totalFailed++;
            continue;
          }
        }

        const res = await fillRow(dayCode, i, tasks[i], config);
        results[dayCode].rows.push(res);
        if (res.success) totalSuccess++; else totalFailed++;
        await sleep(300);
      }
    }
    return { success: totalFailed === 0, totalSuccess, totalFailed, results, message: `${totalSuccess} row(s) filled` };
  }

  async function clearFormOnPage() {
    const inputs = document.querySelectorAll('input[type="text"], textarea');
    let count = 0;
    inputs.forEach(input => {
      const name = input.name || "";
      if (name.includes('Project') || name.includes('Task') || name.includes('Start') || name.includes('Break') || name.includes('Finish')) {
         input.value = '';
         input.dispatchEvent(new Event('input', { bubbles: true }));
         input.dispatchEvent(new Event('change', { bubbles: true }));
         count++;
      }
    });
    return { success: true, count, message: `Cleared ${count} fields on page` };
  }

  function searchProjectsOnPage(keyword) {
    if (!window.TimesheetCore) return [];
    const sources = Array.from(document.scripts).map(s => s.textContent || '');
    sources.push(document.documentElement.innerHTML);
    return window.TimesheetCore.searchProjectSources(sources, keyword);
  }

  // ── Message listener ───────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
    if (req.action === 'fillTimesheet') {
      fillTimesheet(req.config).then(sendResponse).catch(e => sendResponse({ success: false, message: e.message }));
      return true;
    }
    if (req.action === 'clearForm') {
      clearFormOnPage().then(sendResponse);
      return true;
    }
    if (req.action === 'ping') {
      sendResponse({ alive: true, url: location.href });
      return true;
    }
    if (req.action === 'searchProjects') {
      try {
        sendResponse({ success: true, projects: searchProjectsOnPage(req.keyword || '') });
      } catch (e) {
        sendResponse({ success: false, projects: [], message: e.message });
      }
      return true;
    }
  });

  console.log('[Timesheet AutoFill] content script ready');
})();
