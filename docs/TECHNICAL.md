# Technical guide

## Stack and commands

Electron, TypeScript main/preload, browser ES modules, Bootstrap, Mapepire, `electron-store`, `ssh2`, and `nodemailer`.

```bash
npm install
npm start
npm run build
npm run check:renderers
npm run test:unit
npm run test:e2e
npm test
npm run docs:api
```

Build checks TypeScript **and** parses every JavaScript module in `public/`, including its relative imports. TypeScript alone does not validate renderer JavaScript. `check:renderers` parses modules without evaluating them or contacting providers. Electron UI tests are still required for DOM, CSS, preload, and navigation changes.

## Source layout

| Location | Responsibility |
|---|---|
| `src/main.ts` | Composition and application lifecycle |
| `src/main/ipc/` | IPC registration and request boundaries |
| `src/main/runtime/` | Monitoring, analysis, sessions, AI, notifications, integrations, support |
| `src/main/state/` | Shared in-memory connection, monitoring, and alert state |
| `src/main/window/` | Main and standalone job windows |
| `src/features/` | Domain models, validation, parsers, action planning, persistence |
| `src/services/` | IBM i, demo database, local/live analysis providers |
| `src/preload.ts` | Renderer-facing API contract |
| `public/monitor/` | Job/queue views, formatters, history, AI modules |
| `public/object-analysis/` | Async actions, report view, call graph |
| `public/job-task.js` | Standalone task behavior and request coordination |
| `public/styles/` | Feature styles loaded by the ordered `styles.css` manifest |
| `tests/e2e/` | Isolated Electron integration and UI tests |
| `macos-widget/` | Native WidgetKit scaffold and setup instructions |

## Local source layout

Supported exports include `root/userlib/LIB/SRCPF/member.rpgle`, `root/LIB/SRCPF/member.rpgle`, or a directly selected library containing source files. `user-libraries` is supported for older exports. Source-file directory names are not prescribed. Disk casing is preserved; IBM i names and lookup lists are normalized for matching.

A root setup file can contain:

```json
{ "libraryList": ["ORDERLIB", "COMMONLIB", "INVENTORY"] }
```

`librarylist` and the legacy `libraries` key are accepted. Setup precedence is `setup.json`, `settings.json`, then legacy `library-list.json`. Without a setup file, library discovery supplies the initial list. Session changes do not rewrite these files; only the permanent-save action writes `setup.json`.

The source browser lists discovered members independently of the object list. The list determines object resolution order. Reports/build output under `imonitor-analysis` and hidden directories are excluded from discovery.

## Analysis artifacts

```text
<source-root>/imonitor-analysis/
  reports/
    <LIBRARY>/<PROGRAM>.analysis.json
    <LIBRARY>/<PROGRAM>.analysis.md
    program-map.json
  build/
    <LIBRARY>/<PROGRAM>.build.json
    <LIBRARY>/<PROGRAM>.cl
```

Verify the artifact paths displayed by the app: local reports use the source directory when writable; reports can fall back to app storage, and remote build artifacts use app storage. `report-storage.ts` defines report/mapping formats. Compile output is produced by `compile-plan.ts`.

Reports start in draft. Approval persists the current result with source identity and hash mapping. Adding an AI explanation requires approval of the updated result. Compile generation is separate; there is no automatic execution path.

## Evidence and build limits

Incident evidence is collected by `src/features/alerts/incident-evidence.ts` after alert creation. The collector uses the existing IBM i or demo job context, job log, and message services, runs them in parallel under a bounded budget, caps each source at 100 records, redacts secret-shaped keys and values, and records explicit source status. The trigger job snapshot is retained separately from later refreshes and normalized before it enters the incident ledger. Evidence is passed into the AI context and displayed in the alert and task views; it remains read-only.

The initial RPG parser recognizes common declarations, calls, files, SQL, and runtime resources. It is not a complete RPG/COBOL/CL compiler. Local catalogs help resolve references but do not prove runtime execution. Live metadata collection depends on available IBM i services and permissions.

The call graph keeps actual recorded `from`/`to` call and binding relationships between executable objects. It does not turn source ordering into a chain, include tables/queues as calls, or infer procedure calls from declarations. Confidence and evidence remain visible.

Compile plans order supported dependencies, validate names, and turn unsupported or uncertain steps into review comments. Cycles and their dependent steps are flagged. Service-program binding, missing sources, target release/options, and environment-specific compilation require review. The app does not execute generated CL.

## Maintenance rules

- Keep entry files focused on composition and page state; place feature behavior in its existing feature directory.
- Extract a module for one coherent responsibility, not a file per small function. Reuse shared formatters and views.
- Favor a few clear APIs with explicit inputs over wrappers, generic frameworks, or duplicated state.
- Keep generated artifacts separate from source inputs.
- Preserve IPC/API contracts during extraction; check the application from the checkout actually being run.
- Serialize conflicting requests and ignore late responses after selection changes.
- Add behavioral tests for bugs, not tests that merely repeat implementation details.
- Update relevant guides with behavior changes. Generated API docs are refreshed separately with `docs:api`.

## Verification boundaries

Unit tests cover domain behavior. Electron tests use temporary application stores, demo jobs, and mocked external services. They exercise loading, window navigation, workflow failures, AI feedback, source selection, graphs, and responsive layouts. They do not establish successful live IBM i compilation, external delivery, or signed widget installation.

`public/monitor.js` and the preload remain larger integration surfaces. Continue extracting coherent features when changing them; avoid a broad rewrite solely to meet an arbitrary line count.
