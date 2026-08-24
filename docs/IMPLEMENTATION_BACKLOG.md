# iMonitor Implementation Backlog

Last updated: August 23, 2026

This file is the working feature queue for iMonitor and its IBMEye alert module.
It is the source of truth for remaining feature work, refactors, and testing expectations.

## Delivery Rules

For every feature:

1. add or update unit tests first where practical
2. implement the feature in clear feature-based modules
3. run verification before closing the work
4. keep docs updated if behavior changes

Minimum verification target per feature:

- `npm run build`
- `npm run test:unit`
- `npm run test:e2e` when UI or Electron behavior changed

Code expectations:

- keep logic split by feature
- prefer clear file names and function names
- use JSDoc on exported functions
- keep comments minimal and useful
- keep demo-only code isolated from production paths

## Status Key

- `todo`
- `in-progress`
- `blocked`
- `done`

## Priority Queue

### 1. IBM i Operator Actions

Status: `in-progress`

Goal:

- move from passive monitoring to actionable operations

Scope:

- reply to `MSGW`
- hold and release jobs
- end jobs safely
- basic lock investigation actions
- action result logging in Operator Log

Testing:

- unit tests for action request shaping and validation
- Electron smoke tests for action buttons and success or error states

Current slice:

- action model and execution planning added
- hold, release, and end-job flow wired through the job drawer
- operator log records action success or failure
- `MSGW` reply still blocked until message-level context is fetched safely

### 2. Historical Incident Timeline

Status: `in-progress`

Goal:

- rebuild dashboard history from daily structured log files

Scope:

- load historical `.jsonl` logs
- reconstruct job count, peak CPU, wait history, and incident windows
- show cross-session charts and timeline replay

Testing:

- unit tests for log parsing and history reconstruction
- UI tests for chart loading and empty-state handling

Current slice:

- structured log parser and trend reconstruction helpers added
- timeline replay UI still pending

### 3. Root Cause Guidance

Status: `in-progress`

Goal:

- explain likely cause and next steps for operator-impacting conditions

Scope:

- hints for `MSGW`
- hints for `LCKW`
- failed poll and disconnect guidance
- SQL and wait interpretation notes

Testing:

- unit tests for recommendation builders
- UI tests for rendered hint panels

Current slice:

- root-cause guidance builder added
- guidance now renders in the job detail drawer
- poll and disconnect guidance model is in place for later UI wiring

### 4. Team Audit Trail

Status: `todo`

Goal:

- make alert handling attributable and exportable

Scope:

- operator ownership
- better alert notes history
- incident export format
- improved handoff visibility

Testing:

- unit tests for workflow persistence and export shaping
- UI tests for ownership and note history rendering

### 5. Main Process Modular Split

Status: `done`

Goal:

- reduce `src/main.ts` size and centralize runtime concerns cleanly

Scope:

- split IPC handlers
- split monitoring runtime
- split alert runtime
- split persistent logging
- split Mapepire connect and deploy flow

Testing:

- preserve existing tests
- add unit coverage for extracted modules

Completed:

- `src/main.ts` reduced to app wiring and startup composition
- IPC handlers moved into `src/main/ipc`
- monitoring, logging, and session flows moved into `src/main/runtime`
- connection, monitoring, and alert state moved into `src/main/state`
- window lifecycle moved into `src/main/window`

### 6. Renderer Modular Split

Status: `todo`

Goal:

- reduce page-script sprawl in renderer files

Scope:

- break `public/monitor.js` into feature modules
- break `public/renderer.js` into connection and setup modules
- keep DOM wiring readable

Testing:

- preserve current Electron smoke tests
- add focused UI logic tests where possible

### 7. Docs Surface Completion

Status: `in-progress`

Goal:

- make docs feel like part of the product, not an afterthought

Scope:

- themed docs home
- themed technical guide
- TypeDoc visual overrides
- light and dark support across docs surfaces
- verify docs serve path

Testing:

- manual local verification
- follow-up automated checks if we add docs UI behavior worth testing

### 8. Test Coverage Expansion

Status: `todo`

Goal:

- improve confidence after every feature change

Scope:

- alert scroll stability tests
- docs theme persistence tests
- operator log action tests
- connection/setup state tests
- theme switching tests on both pages

Testing:

- this item is itself test work and should expand both unit and Electron coverage

### 9. Credential Security Hardening

Status: `todo`

Goal:

- replace weak fallback-style credential protection with OS-backed storage

Scope:

- move to secure OS-backed secret storage where possible
- remove insecure fallback dependency for production use
- document migration behavior

Testing:

- unit tests for migration and failure behavior
- manual verification on supported platforms

### 10. Package and Release Cleanup

Status: `todo`

Goal:

- keep packaged builds lean and release output predictable

Scope:

- dependency audit
- package size review
- release artifact cleanup
- final packaging verification

Testing:

- packaging smoke test
- artifact inspection

## Recommended Execution Order

1. IBM i Operator Actions
2. Test Coverage Expansion
3. Historical Incident Timeline
4. Root Cause Guidance
5. Team Audit Trail
6. Main Process Modular Split
7. Renderer Modular Split
8. Docs Surface Completion
9. Credential Security Hardening
10. Package and Release Cleanup

## Working Notes

- The app already has alert workflow, theme support, demo mode, share and download log actions, and sticky alerts.
- Demo-only behavior must remain easy to disable for production.
- Structured logs should remain compatible with future history reconstruction work.
- UI changes should stay compact and operator-focused.
