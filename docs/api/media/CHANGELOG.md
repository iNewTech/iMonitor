# Changelog

## 2026-08-30

### Changed

- ClickUp settings now save per operator instead of one shared app-wide value
- Settings now show which operator owns the current ClickUp configuration
- Demo mode now uses `GajenderT` as the operator identity for alert ownership and per-user settings

### Fixed

- Alert workflow mutations now use the same current-operator resolver as the rest of the app
- Legacy shared ClickUp settings now migrate forward into the current operator's saved settings on first read

## 2026-08-29

### Added

- Slack channel alert delivery through encrypted per-operator Incoming Webhook settings
- Independent Slack routing rules and test delivery action for alert types
- Per-alert ClickUp ticket rules for MSGW, LCKW, high CPU, DLYW, DEQW, and poll failures
- Automatic AI diagnostic comments and readable daily log attachments on new ClickUp alert tasks
- DLYW and DEQW alert monitoring with safe opt-in ticket creation
- Unit and Electron coverage for alert rule persistence and diagnostic delivery
- Dedicated `iMonitor Settings` page for AI and integration setup
- ClickUp action tracking with saved workspace, space, and list selection
- `Create ClickUp Task` alert action that links one task back to the incident
- Automatic ClickUp comment sync for later notes and workflow updates
- End-to-end smoke test coverage for the new Settings page

### Changed

- Automatic ClickUp ticket creation now assigns the authenticated ClickUp user and reuses linked incident tasks
- Support diagnostics and ClickUp delivery failures are retained in `iMonitor Logs` without losing the incident task
- Alert workflow now separates `Acknowledge`, `Start Work`, `Mark Work Done`, and `Return To Queue`
- `Mark Work Done` keeps the alert with the assigned operator until it is explicitly returned
- AI provider setup now uses provider-specific selection with provider-to-model mapping on the Settings page

### Fixed

- Preserved linked ClickUp task references when alerts clear from later system polls
- Fixed alert workflow behavior that dropped a worked alert out of the operator area before it could be returned
- Simplified the ClickUp API runtime base URL handling

## 2026-08-28

### Added

- Ollama-backed `IBMEye Watch` AI analyst panel on the monitor screen
- Persisted AI settings for endpoint, model, enable toggle, and response style
- AI context builders and prompt builders with unit coverage

### Changed

- AI analysis now uses current alerts, jobs, monitoring history, and operator log context from the running session
- Activity log can now record AI analysis success and failure events

## 2026-08-23

### Added

- Auto-check, auto-start, and auto-deploy Mapepire during `Connect Now`
- Connection action status bar under the main connect controls
- Dual daily logging in readable `.log` and structured `.jsonl`
- Operator log download, share, and logs-folder actions
- Sticky alert queue with clear action, resolved state, and newest-first ordering
- Demo mode backed by generated JSON snapshots

### Changed

- Visible product name updated to `IBMEye`
- Monitor header and summary cards simplified and tightened
- Alerts panel layout no longer stretches to match the alert-rules column
- History card note spacing fixed to avoid clipping against rounded corners

### Refactoring

- Extracted monitoring helpers into `src/features/monitoring/monitoring-model.ts`
- Extracted alert settings and workflow helpers into:
  - `src/features/alerts/alert-model.ts`
  - `src/features/alerts/alert-workflow.ts`
- Extracted demo runtime gating into `src/features/demo/demo-runtime.ts`
- Separated development-only demo availability from the generated snapshot utilities in `src/utils/demo-system.ts`
- Added TypeDoc support scaffolding for JSDoc-driven docs generation
