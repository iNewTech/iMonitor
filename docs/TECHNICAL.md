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
| `src/main/runtime/collection-runtime.ts` | Per-system poll storage, inventory, retention, and audited purge |
| `src/main/runtime/background-collector-runtime.ts` | Collector lifecycle, reconnect, health, and OS-login startup |
| `src/features/` | Domain models, validation, parsers, action planning, persistence |
| `src/services/` | IBM i, demo database, local/live analysis providers |
| `src/preload.ts` | Renderer-facing API contract |
| `public/monitor/` | Job/queue views, formatters, history, AI modules |
| `public/object-analysis/` | Async actions, report view, call graph |
| `public/job-task.js` | Standalone task behavior and request coordination |
| `public/styles/` | Feature styles loaded by the ordered `styles.css` manifest |
| `tests/e2e/` | Isolated Electron integration and UI tests |
| `macos-widget/` | Native WidgetKit scaffold and setup instructions |

The standalone task response workspace is split between `src/features/alerts/incident-response.ts`, `src/features/alerts/incident-handoff.ts`, and `public/job-task.js`. The main process builds a deterministic response snapshot from the selected job, linked alert, and status history. Handoffs are versioned records persisted with the alert workflow state. A request validates the recipient, reason, pending checks, and optional ISO response target; acceptance is restricted to the addressed operator. Both events enter the incident timeline, and ownership changes only on acceptance. The renderer keeps the handoff form limited to the fields needed to transfer work. It does not copy or export handoff documents. The main process synchronizes handoff comments, ClickUp status/assignee changes, Jira comments, and optional Slack notifications through bounded delivery keys.

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

## Background collector storage

`collection-runtime.ts` writes one JSONL record for each successful read-only monitoring poll under the application data directory:

```text
imonitor-collection/
  <system-id>/monitoring/<UTC-date>.jsonl
  purge-audit.jsonl
```

Records include the system identity, safe connection metadata, timestamp, interval, and the active-job snapshot. Inventory reports counts, bytes, dates, categories, and systems. Retention removes records older than the configured period; the storage limit removes the oldest system records until the limit is met. Purge rewrites affected files atomically and appends a hash-linked audit record. The IPC purge handler requires explicit confirmation. The background runtime reconnects with bounded retry and starts the existing monitor loop; it does not run job or queue mutations.

## Integration delivery

`src/features/integrations/delivery.ts` is the shared outbound delivery contract for external incident and work-item events. `buildDeliveryEventKey()` combines provider, event, source ID, and event revision into a stable key. `createDeliveryRegistry()` persists `pending`, `sent`, `skipped`, and `failed` states, suppresses a successful duplicate, retries a failed operation at most twice by default, and bounds the ledger size. Stored errors are truncated and credential-shaped values are redacted.

The local incident workflow is the source of truth. New Slack alerts and Jira issues are delivered independently, so a provider outage cannot block incident creation. A successful Jira response is mapped to `jiraIssue` on the durable workflow state. ClickUp task references remain mapped in the same state. iMonitor owns lifecycle, owner, evidence, and timeline fields; providers own their external ticket IDs, URLs, assignees, statuses, and channel presentation. Claim, handoff, manual recovery, and automatic recovery updates use a new provider/event key and are sent as compact comments or permitted assignee/status changes. Provider payloads contain workflow fields only; raw evidence, credentials, and local diagnostic files are excluded from workflow updates.

## Evidence and build limits

Incident evidence is collected by `src/features/alerts/incident-evidence.ts` after alert creation. The collector uses the existing IBM i or demo job context, job log, and message services, runs them in parallel under a bounded budget, caps each source at 100 records, redacts secret-shaped keys and values, and records explicit source status. The trigger job snapshot is retained separately from later refreshes and normalized before it enters the incident ledger. Evidence is passed into the AI context and displayed in the alert and task views; it remains read-only.

Incident grouping and priority are calculated in `src/features/ibmeyeai/incident-correlation.ts`. Alerts for the same qualified job are grouped when their latest observations are within five minutes; signals on different jobs are never merged by matching text. Each group has a stable fingerprint, related signal labels, a suggested flag for system-only matches, and a 0–100 priority with factor values and human-readable reasons. The score is technical and provisional until business-service mapping is implemented. `alert-state.ts` attaches the current snapshot to active alerts so the ActionBoard row, task window, and AI context use the same explanation.

`src/features/alerts/resource-graph.ts` is the single builder for the job Details relationship view. It produces a versioned, bounded graph from current evidence, with observed confidence and source timestamps on every edge. The builder avoids self-links and inferred relationships, warns about missing lock-owner data, and marks evidence older than the freshness window. `get-job-resource-graph` performs the same read authorization as other task details before the renderer displays the flow and table.

Shared collaboration is defined by `src/features/alerts/shared-incident-model.ts` and `src/features/alerts/shared-incident-service.ts`. A versioned event contains a stable incident identity, organisation/system scope, source revision, occurrence time, and either an incident upsert or removal. The service merges events by event ID, ignores events from another scope, reduces them to the latest incident view, queues unsent events, pulls through an injected adapter cursor, and keeps an explicit sync state. It also retains the latest revision during history purge and returns a portable cache for export. The transport and customer authentication are intentionally adapter responsibilities for the shared-service and access-control phases.

Mutation IPC uses `src/features/action-board/operator-access.ts` and `action-leases.ts`. The main process checks the active operator, system scope, action grant, and expiry before changing incident workflow or executing job/queue commands. Each request gets a unique execution identifier; a lease prevents concurrent work on the same target and a completed identifier cannot be replayed. IBM i authority and command execution still remain in the existing service boundary.

## Support access

`src/features/action-board/support-access.ts` is the small policy module for client-controlled outsourced support. A grant names an operator, organisation, exact system IDs, one or more of `read`, `investigate`, and `execute`, and a future expiry. A grant starts as `pending`; only the exact invited operator can accept it. The client owner can revoke it, and the main process evaluates expiry and revocation again at every read or action boundary. Permission mapping is additive: read exposes data, investigate adds incident workflow and handoff, and execute adds job and queue commands. The existing IBM i connection identity remains responsible for final command authority.

`src/features/action-board/incident-routing.ts` consumes the same active grants for explainable recommendations. Default rules map alert kinds to response skills and target minutes. Operator eligibility requires exact system scope (or the local owner), incident-workflow permission, active access, availability, every required skill, and a matching timezone-aware support window. The response snapshot carries the recommendation, exclusions, and `on_track`/`at_risk`/`overdue` SLA state to the task renderer. It is advisory and does not mutate workflow ownership.

`src/main/ipc/support-access-ipc.ts` persists invitations, acceptance, revocation, and audit events through the application store. The settings page exposes the same workflow without credentials or tokens. In this desktop release, the current OS/demo identity is the local owner; `IMONITOR_OPERATOR_ID` is an identity injection seam for service and integration tests. A future shared access service must authenticate a remote operator and supply the organisation/system context before this boundary is used across machines. The desktop does not claim to provide remote authentication by itself.

Incident handoff IPC uses the same authorization and per-incident lease boundary. `create-incident-handoff` records a pending destination without changing the current owner; `accept-incident-handoff` verifies the addressed operator and transfers ownership. Acceptance can ensure the external incident link exists before publishing the accepted state, so the new owner receives the linked work item. The handoff schema is intentionally small so a future shared access service can carry it between authenticated clients without coupling the task window to an external ticket provider.

ClickUp stores `handoffStatus` and `activeStatus` with each operator's integration settings. A pending handoff uses the first value; an accepted handoff uses the second. Status changes and assignee replacement are separate from the local workflow and use the same bounded delivery registry. Slack handoff notifications use stable keys derived from the incident, handoff ID, and event so retries do not duplicate a notification.

Task-window AI helpers pass `scope: 'job'` through preload and IPC. The main process verifies that the selected job is still present, filters alerts and operator activity to that job, includes only its status history, omits global monitoring history and arbitrary conversation context, and instructs the provider to decline unrelated questions. The main ActionBoard composer remains monitor-scoped.

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
