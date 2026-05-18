# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Chrome Manifest V3 extension for autofilling an internal weekly timesheet. It is a plain JavaScript/HTML project with no npm package, bundler, or transpilation step. The extension is loaded directly into Chrome via `chrome://extensions/` using **Load unpacked**.

## Common Commands

- `make help` — show available Makefile targets and current manifest version.
- `make test` — run the automated test suite (`node --test tests/*.js`).
- `node --test tests/popup-core.test.js` — run the existing test file directly.
- `make zip` or `make package` — build the distributable extension zip from the current `manifest.json` version.
- `make clean` — remove generated zip packages.
- `make changelog MSG="Describe the change"` — prepend a release note for the current manifest version.
- `make release MSG="Describe the change"` — run tests, update changelog, build zip, and commit.
- `python3 gen_icons.py` — regenerate extension icons from the source logo.

For local manual testing, reload the extension card in `chrome://extensions/` after code changes, then refresh the target timesheet page so the content script is reinjected.

## Architecture

The extension has three main runtime surfaces:

- `popup.html` / `popup.js` implement the popup UI, state management, presets, theme settings, project search, import/export, and user-triggered actions.
- `popup-core.js` contains shared, testable logic. It is written as a UMD-style module: Node tests import it with `module.exports`, while extension scripts access it as `window.TimesheetCore`.
- `content.js` is injected on the internal timesheet host. It reads messages from the popup, locates and mutates the timesheet DOM, creates rows, assigns field values, dispatches page events, clears forms, and extracts/searches page project data.

`manifest.json` wires these together: `popup-core.js` is loaded before `content.js` as a content script, and `popup.html` is the default extension action. Host permissions are intentionally narrow and include the internal timesheet host plus GitHub raw content for changelog/version checks.

## State and Data Flow

Popup state is persisted in `chrome.storage.local` under `timesheetState`. The popup builds a payload from enabled days and task rows, then sends messages to the active tab where `content.js` performs DOM changes on the timesheet page.

Day codes are lowercase three-letter identifiers (`mon`, `tue`, `wed`, `thu`, `fri`, `sat`, `sun`). Existing timesheet field naming patterns matter; preserve names such as `monProject_0`, `monTask0`, and `monFinish_0` when changing DOM-fill logic.

## Testing Guidance

Tests live in `tests/` and use Node's built-in `node:test` plus `node:assert/strict`. Logic-heavy behavior should generally be placed in `popup-core.js` so it can be tested outside Chrome. Browser APIs such as `chrome.storage`, tab messaging, and real page DOM interactions still require manual extension testing.

Before reporting UI/content-script changes as complete, manually check that the popup opens, settings persist, the extension can send messages to the timesheet tab, and the page recalculates after input/change events.

## Release Notes

When releasing a new version, update `manifest.json` and add a matching heading to `CHANGELOG.md` in the form:

```md
## [1.0.1] - 2026-05-15
```

`README.md` notes that the extension checks GitHub `CHANGELOG.md` for update availability, so keep changelog formatting consistent.
