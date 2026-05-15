# Repository Guidelines

## Project Structure & Module Organization

This repository is a Chrome Manifest V3 extension for autofilling an internal timesheet.

- `manifest.json` — metadata, permissions, host access, popup entry point, icons, and content scripts.
- `popup.html` / `popup.js` — extension popup UI: local storage state, presets, project search, tab-view toggle, and user actions.
- `popup-core.js` — shared logic module (task scheduling, project search helpers, time normalization) loaded by both the popup and the content script.
- `content.js` — runs on the timesheet page; performs DOM lookup, row creation, value assignment, and page event triggering.
- `icons/` — generated extension icons (16/48/128 px). Regenerate with `python3 gen_icons.py`.
- `data/` — supporting assets such as `preview.webp`, `timesheet.html`, and logo images.
- `tests/` — Node.js test files using `node:test` and `node:assert/strict`.

## Build, Test, and Development Commands

- `node --test tests/` — run the automated test suite.
- `python3 gen_icons.py` — regenerate extension icons from the source logo.
- Load locally in Chrome: open `chrome://extensions/`, enable **Developer mode**, choose **Load unpacked**, and select this directory.
- After changes, reload the extension card in `chrome://extensions/`, then refresh the target timesheet page.

No npm, make, or bundler workflow is configured.

## Coding Style & Naming Conventions

Plain JavaScript, HTML, and Python — no build tooling. Follow the existing patterns:

- Two-space indentation in JSON and HTML.
- Semicolons in JavaScript; `const`/`let` over `var`.
- Small, testable helper functions in `popup-core.js` for DOM and storage operations.
- Day codes use lowercase three-letter names: `mon`, `tue`, … `sun`.
- Preserve timesheet field patterns such as `monProject_0`, `monTask0`, `monFinish_0`.

## Testing Guidelines

Tests live in `tests/` and use Node's built-in `node:test` runner. Run with `node --test tests/`.

When adding logic-heavy features, export testable helpers from `popup-core.js` and add corresponding tests in `tests/`.

Manual verification checklist before submitting:

- Popup opens without console errors.
- Settings persist through `chrome.storage.local`.
- Autofill messages flow from `popup.js` to `content.js`.
- The target page receives input/change events and recalculates total hours.

## Commit & Pull Request Guidelines

Use clear, imperative commit messages: `Fix timesheet row creation`, `Add preset import validation`, `Update theme color selector`.

Pull requests should include a short summary, manual test steps, any changed host permissions, and screenshots or screen recordings for popup UI changes.

## Security & Configuration Tips

Keep host permissions narrow and update `manifest.json` deliberately. Do not commit real timesheet data, credentials, or exported configs containing private project details. Theme preferences and presets are stored in `chrome.storage.local` under `timesheetState.themeColor` and related keys.
