// options.js — external script, MV3 CSP compliant

document.addEventListener('DOMContentLoaded', function () {

  // ── Accordion ──────────────────────────────────────────
  document.querySelectorAll('.card-head').forEach(function (head) {
    head.addEventListener('click', function () {
      var card = head.parentElement; // .card
      card.classList.toggle('is-open');
    });
  });

  // ── Open Extension button ───────────────────────────────
  var btn = document.getElementById('btnOpenExt');
  if (btn) {
    btn.addEventListener('click', function () {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.tabs) {
        chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?view=tab') });
      }
    });
  }

  // ── Auto-open card from URL hash ────────────────────────
  if (location.hash) {
    var id = location.hash.slice(1); // e.g. "g-project"
    var target = document.getElementById(id);
    if (target) target.classList.add('is-open');
  }

});
