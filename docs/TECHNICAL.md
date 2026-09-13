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

## Minimal ActionBoard workspace (UI-02 / #58)

`public/monitor.html` retains existing IPC element contracts while moving infrequent tools behind the workspace menu. `public/monitor/board-workspace.js` owns disclosure controls, optional companion visibility, collection status, and per-profile session view preferences. It stores no profile credentials or incident records. Its per-profile session data includes the unsent AI draft, which expires with the window. The connection name/host/port/operator isolate those preferences; incident persistence remains main-process owned.

`public/monitor/job-rows.js` patches rows by qualified identity and describes active conditions separately from technical states. It preserves focus and scroll even when row order changes. Filtering in `jobs-filter.js` combines subsystem, status, owner and text; direct matches win over fuzzy fallback. Filter/owner updates never advance observation time. `monitor.js` composes these views with the unchanged actions and monitoring services.

`ibmeyeai/panel.js` owns the full-width autogrowing input, on-demand conversation and compact model disclosure. Discovery-backed ready providers/models alone are selectable; configuration stays in Settings. `store.js` passes explicit monitor/job scope. The existing shared widget conversation remains available from the workspace menu and is hidden on initial load. `styles/board-workspace.css` scopes the approved layout to `body.board-minimal`, preserving other windows.

Validation lives in `jobs-workspace.test.ts` and `tests/e2e/board-workspace.spec.ts`, alongside the existing workflow/provider/queue tests. Electron fixtures cover view restoration, polling focus/scroll/drafts, search and ownership, theme/size changes, model setup, and accessible secondary entry points. Screenshots use isolated illustrative data; they do not establish live IBM i or external-service deployment.

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

## Support outcomes

`src/features/history/support-metrics.ts` is the pure reporting model for Project 7 support outcomes. It accepts incident records and AI request observations, filters by `systemId` and a half-open `[from, to)` window, and returns schema `support-metrics` version 1. Each stage carries `sampleSize`, `measured`, `unknown`, average minutes, and median minutes. The report counts incidents created in the window, distinguishes unresolved and reopened cycles, and reports monitoring-confirmed recovery separately from operator-verified recovery. `autonomousResolutionCount` is deliberately fixed at zero in this release.

`src/main/ipc/support-metrics-ipc.ts` builds the report from the local incident ledger, scopes AI activity records to the current system, enforces read authorization, and writes a customer-scoped JSON export through the native save dialog. The renderer panel defaults to the last seven local calendar days, includes a previous equal-window comparison, and does not display a percentage when its denominator is zero. Exported reports contain no credentials, raw job logs, or command payloads.

`PILOT_VALIDATION.md` is the evidence-first compatibility and pilot record for Project 7 issue #29. It separates automated demo evidence from live IBM i observations, records exact client/IBM i releases, PTFs, authorities, scale, provider versions, and integration results, and provides the scenario, defect, approval, and release exit records. A target package or passing demo test never becomes a certified compatibility claim by itself.

`P2_RELEASE_GATE.md` records the shared-support candidate for issue #17. It keeps the automated evidence for shared incidents, authenticated ownership, accepted handoffs, integration delivery, scoped support access, and background collection separate from the live two-client, permission, IBM i, outage, and deployment results that still require named UAT.

`P3_RELEASE_GATE.md` records the Resolution Memory and runbook candidate for issue #24. It separates automated graph, mapping, memory, AI, runbook, and recovery evidence from the live IBM i authority, partition, procedure, and deployment checks required for UAT.

`P4_RELEASE_GATE.md` records the L3 and measured-outcomes candidate for issue #30. It keeps recurring-problem, training, support-metrics, pilot, and compatibility evidence separate from the named client UAT and deployment records still required for release.

## Integration delivery

`src/features/integrations/delivery.ts` is the shared outbound delivery contract for external incident and work-item events. `buildDeliveryEventKey()` combines provider, event, source ID, and event revision into a stable key. `createDeliveryRegistry()` persists `pending`, `sent`, `skipped`, and `failed` states, suppresses a successful duplicate, retries a failed operation at most twice by default, and bounds the ledger size. Stored errors are truncated and credential-shaped values are redacted.

The local incident workflow is the source of truth. New Slack alerts and Jira issues are delivered independently, so a provider outage cannot block incident creation. A successful Jira response is mapped to `jiraIssue` on the durable workflow state. ClickUp task references remain mapped in the same state. iMonitor owns lifecycle, owner, evidence, and timeline fields; providers own their external ticket IDs, URLs, assignees, statuses, and channel presentation. Claim, handoff, manual recovery, and automatic recovery updates use a new provider/event key and are sent as compact comments or permitted assignee/status changes. Provider payloads contain workflow fields only; raw evidence, credentials, and local diagnostic files are excluded from workflow updates.

## Evidence and build limits

Incident evidence is collected by `src/features/alerts/incident-evidence.ts` after alert creation. The collector uses the existing IBM i or demo job context, job log, and message services, runs them in parallel under a bounded budget, caps each source at 100 records, redacts secret-shaped keys and values, and records explicit source status. The trigger job snapshot is retained separately from later refreshes and normalized before it enters the incident ledger. Evidence is passed into the AI context and displayed in the alert and task views; it remains read-only.

Selected-job AI context is assembled by `src/features/ibmeyeai/grounded-guidance.ts`. It includes only the selected job, its linked alert, selected-job history, job-related activity, bounded evidence excerpts, and `findApplicableResolutions()` results for the connected system. Stable references use `[job]`, `[incident:id]`, `[evidence:source]`, and `[runbook:id:vN]`; unsupported sources appear in Missing evidence. Evidence and runbook text is sanitized as untrusted data, credential-shaped values are redacted, and instruction-like text is removed before the provider sees it. `validateGroundedReply()` bounds provider output and records missing required sections. The job task still renders the response as advisory text and has no path from AI output to command execution.

Incident grouping and priority are calculated in `src/features/ibmeyeai/incident-correlation.ts`. Alerts for the same qualified job are grouped when their latest observations are within five minutes; signals on different jobs are never merged by matching text. Each group has a stable fingerprint, related signal labels, a suggested flag for system-only matches, and a 0–100 priority with factor values and human-readable reasons. The score is technical and provisional until business-service mapping is implemented. `alert-state.ts` attaches the current snapshot to active alerts so the ActionBoard row, task window, and AI context use the same explanation.

`src/features/alerts/resource-graph.ts` is the single builder for the job Details relationship view. It produces a versioned, bounded graph from current evidence, with observed confidence and source timestamps on every edge. The builder avoids self-links and inferred relationships, warns about missing lock-owner data, and marks evidence older than the freshness window. `get-job-resource-graph` performs the same read authorization as other task details before the renderer displays the flow and table.

### Scoped knowledge contract (AIAB-01 / #41)

`src/features/knowledge/knowledge-contract.ts` is the shared versioned boundary for future ingestion, indexes, retrieval, and MCP consumers. It validates bounded `KnowledgeRecord` content, mandatory customer/system scope for operational records, stable credential-free source references, evidence references, timestamps, redaction profile, confidence, review metadata, and explicit statuses. It also validates `SupportContext` before retrieval and defines `KnowledgeCitation` and `ContextPack` values for observed, approved, stale, draft, retired, blocked, and unknown evidence. Status changes use an explicit lifecycle; retired records cannot be reopened. The contract carries no credentials, provider state, vectors, or renderer-specific data.

### Knowledge access boundary (AIAB-02 / #42)

`src/features/knowledge/knowledge-access.ts` is the single main-process policy for reads that will feed search, source detail, citations, export, or MCP resources. `authorizeKnowledgeRead()` requires an explicit customer scope, IBM i system scope, authenticated operator ID, read permission, and either the local-owner identity or an accepted delegated `SupportAccessGrant`. Delegated grants are checked for exact organisation and system membership, permission, revocation, and expiry on every request. No grant credential or provider secret is part of the context.

`filterKnowledgeRecords()` runs before a lexical or vector adapter receives candidates. It removes invalid, cross-customer, cross-system, and record-permission failures while returning only stable IDs and safe reason codes for audit diagnostics. Generic non-operational records may use `systemScope: '*'` only when their customer scope still matches. `filterContextPack()` repeats the check on the adapter response, sanitizes citations, recomputes freshness, and prevents late or malicious adapter data from reaching the model or renderer. `runScopedKnowledgeSearch()` is the boundary helper and does not call an adapter when scope or permission is missing. Access failures and exclusions produce audit events without titles, content, or credentials.

### Local knowledge store (AIAB-03 / #43)

`src/features/knowledge/knowledge-store.ts` keeps rebuildable knowledge data under the user data directory in `imonitor-knowledge/knowledge-store.json`. The record list is the durable source; compact lexical search entries are derived and rebuilt on load, so local search remains available when embeddings or a remote vector service is unavailable. `upsert()` validates records, deduplicates by content hash, replaces a changed stable ID atomically, and marks the record for indexing work. `get()`, exact scoped `list()`, `retire()`, `delete()`, cutoff `purge()`, `markReindex()`, `completeReindex()`, and `rebuildIndex()` update record metadata and derived entries together.

Writes use a temporary file followed by rename and are serialized through one queue. A repeated source event does not create a second record. Store statistics expose state (`empty`, `ready`, `rebuilding`, `degraded`, or `unavailable`), record count, bytes, oldest/newest observation, pending indexing, and last reindex time. Invalid or corrupt persisted data fails closed as `degraded`; a later successful write can recover the store. This module does not own renderer state or authorization: callers must apply the AIAB-02 access boundary before returning records to a user or model.

### Incremental knowledge ingestion (AIAB-04 / #44)

`src/features/knowledge/knowledge-ingestion.ts` is the source adapter boundary. It accepts incident evidence, runbooks, approved resolutions, job context, object analysis, and customer documents as bounded inputs. The normalizer redacts credential-shaped keys, bearer values, and connection strings before chunking or hashing. Chunk boundaries preserve operational headings such as jobs, messages, evidence, timeline events, runbook steps, procedures, commands, calls, errors, and warnings; every chunk keeps the same stable source reference and adds a bounded locator.

`ingestKnowledgeSource()` uses the source identity and redacted content hash to make repeated events idempotent. A changed source retires old chunks that are no longer present before persisting the new version. `ingestKnowledgeSources()` continues unrelated sources after one failure and stops cleanly when its abort signal is cancelled. Supported customer documents are plain text, Markdown, JSON, CL, CLLE, RPG/RPGLE, SQL, and CSV; binary or unsupported extensions are rejected before storage.

`src/main/ipc/knowledge-ipc.ts` is the renderer boundary. It authorizes reads and maintenance against the current customer/system scope, uses the same pre/post filter for lexical search, groups source chunks in the Knowledge UI, and deletes/reindexes all chunks for a selected source. The Add knowledge flow accepts bounded text or a supported local text file and reports progress/failure only after persistence. Activity entries contain source IDs and counts, never source titles, content, credentials, or file contents.

### Pluggable knowledge indexes (AIAB-05 / #45)

`src/features/knowledge/knowledge-index.ts` defines the adapter boundary for health, upsert, delete, scoped search, rebuild, and statistics. The local JSON store is wrapped by the default lexical adapter, which preserves exact IBM i identifiers such as qualified jobs, message IDs, queues, and object names. The gateway sends the same exact customer and system scopes to an external adapter, stores only redacted provider payloads with bounded source metadata, and verifies returned records with `filterKnowledgeRecords()` before they can reach the renderer or AI.

Qdrant and Postgres + pgvector are catalogued as future provider choices but remain disabled until their adapters are installed. Selecting an unavailable provider never silently changes storage. External upserts, deletes, and rebuilds are best effort after the local write; provider timeout, malformed data, or cross-scope results mark retrieval degraded and return local lexical results. `src/main/ipc/knowledge-index-ipc.ts` exposes only renderable settings, including `apiKeyConfigured`; encrypted provider keys stay in the main-process store and are never returned to renderer state.

### Hybrid knowledge retrieval (AIAB-06 / #46)

`src/features/knowledge/knowledge-retrieval.ts` builds a bounded retrieval query from the customer, IBM i system, operator scope, selected qualified job, incident kind, signal, object identifiers, runtime fingerprint, and the operator's natural-language question. The operator scope is retained in the query view model for audit and future MCP use; it is never sent to a renderer-owned provider client.

The local adapter supplies exact lexical matches for IBM i identifiers, while a configured external adapter supplies semantic candidates. The main-process IPC ranks either source with identifier and system relevance, approved-source preference, freshness, and bounded query terms. Results are deduplicated by content hash or stable ID, capped by the requested limit, and returned with stable citations and human-readable relevance reasons. Numeric ranking scores stay internal.

Retired and blocked records are excluded. Stale records are marked for verification, and draft or unknown lifecycle records are marked as needing review. Customer/system and permission filtering remains the access boundary before and after adapter search. If a vector provider is missing, unavailable, malformed, or returns an unsafe scope, the gateway reports degraded health and the local lexical result remains available. No persistent search-score panel is added; the retrieval view model is consumed inside the selected job or incident conversation by later AI work.

### Cited context packs and freshness (AIAB-07 / #47)

`src/features/knowledge/knowledge-context-pack.ts` converts ranked retrieval matches into a bounded `ContextPack`. It carries customer/system/operator and optional selected-job scope, selected records, one stable citation per record, relevance reasons, safe exclusions, explicit missing evidence, aggregate freshness, and a character budget with an estimated token count. Records are clipped for the provider context budget while their stored lifecycle remains unchanged.

Freshness combines explicit record expiry with configurable age windows by source type. Expired or over-age evidence is labelled `stale` and remains visible for operator verification; it is never silently presented as current. Retired and blocked records stay excluded, while draft and unknown records keep their review state. `filterContextPack()` rechecks scope and permissions, synthesizes a missing citation when a valid visible record has none, sanitizes source references and excerpts, preserves stale citation state, bounds reasons and missing-evidence text, and derives aggregate freshness from the returned citations.

The job task renders the pack’s citations as small source chips below an AI response. Selecting a chip opens one bounded detail view with source label, status, observation time, provenance, scope, and excerpt. Missing excerpts show an unavailable message. This is an on-demand view inside the existing task conversation; it does not add a permanent search or evidence panel.

### Grounded selected-job AI (AIAB-08 / #48)

`src/features/ibmeyeai/job-knowledge.ts` builds a `SupportContext` from the selected qualified job, linked incident, signal, system/customer scope, and operator permissions. It sends that scope to the main-process `KnowledgeIndexGateway`, ranks only matching records, builds the bounded cited pack, and runs `filterContextPack()` again before the model sees it. A retrieval timeout or disabled provider becomes an explicit evidence gap with retrieval health; it does not broaden the query or block the live job analysis.

`createAiRuntime()` calls this path only for `scope: 'job'`, passes the resulting pack into the selected-job prompt, and returns the pack plus sanitized retrieval health to the existing task renderer. The prompt treats retrieved content as untrusted data, requires the sections Observed facts, Matching evidence, Interpretation, Missing evidence, Suggested checks, Approved procedure, and Next safe action, and requires an exact citation marker whenever matching evidence exists. `validateGroundedReply()` records missing sections or citation markers without converting AI output into an action. Retrieved text is bounded, secrets are redacted, and instruction-like evidence is neutralized before provider submission.

The task UI keeps the existing compact conversation. It shows a small knowledge health/freshness status and source chips below the answer; selecting a chip opens the existing bounded source dialog with provenance, scope, observed time, status, and excerpt. No vector database or provider credential is exposed to the renderer, and no AI response can execute an IBM i command.

### Retrieval quality regression (AIAB-09 / #49)

`src/features/knowledge/knowledge-regression.ts` owns the versioned deterministic golden suite and evaluator. Cases cover the main IBM i support signals, recurring problems, no-result and stale evidence, conflicting guidance, cross-system records, and retrieved prompt-injection text. Each case declares its required customer/system/operator scope, allowed source types, expected records and citations, forbidden records/text, and uncertainty expectation.

The evaluator re-applies `filterKnowledgeRecords()` before and after the injected provider/index result, ranks through `rankKnowledgeRecords()`, builds the same bounded `ContextPack`, formats evidence through the provider-safe formatter, and validates the complete selected-job reply shape. The report contains only case IDs, stable record IDs, statuses, exclusions, metrics, latency, and context size; source content, prompts, credentials, and query text are excluded. An unrelated approved record cannot receive a relevance score by approval alone.

`npm run test:knowledge-regression` builds the app, runs the suite, and writes a comparison-safe JSON artifact under `test-results/knowledge-regression/`. `IMONITOR_KNOWLEDGE_BACKEND`, `IMONITOR_KNOWLEDGE_PROVIDER`, and `IMONITOR_KNOWLEDGE_REGRESSION_OUTPUT` label or redirect the artifact for provider/index comparisons. The unit suite also runs the golden evaluator, so a failed case blocks the normal test/promotion path.

`src/features/action-board/business-service-mapping.ts` normalizes at most 100 local mappings and resolves the most specific matching rule before priority and saved order. A mapping may constrain system IDs, alert kinds, job/resource/queue/subsystem patterns, expected days and timezone, and a response deadline. Deadline states are `on_track`, `at_risk`, `overdue`, `not_configured`, or `unknown`; missing mappings never create a synthetic business score. The settings form stores only customer configuration, while `buildIncidentResponseSnapshot` adds the resolved result to the selected task.

`src/features/action-board/runbook-policy.ts` exposes immutable v1 scenario policies for message wait, lock wait, high CPU, and monitoring disconnect (`pollFailure`). The response snapshot carries the policy's required evidence, safe actions, verification, and escalation text. `validateMessageReplyContext()` runs inside `run-job-action` before leasing or executing `SNDRPY`: the job must still be in MSGW with reply authority, the supplied queue and hexadecimal key must match a freshly read inquiry, and stale or unsupported messages are rejected. A reconnect or command submission is never treated as recovery without a separate verification read.

`src/features/action-board/runbook-execution.ts` defines the v1 runbook schema, ordered check/action/verify steps, execution state machine, bounded normalization, and generic job recovery classification. `runbook-ipc.ts` persists the latest 100 customer-scoped executions through `runbookExecutions` in the application store. The task window starts and resumes an execution, captures bounded step input/output and operator identity, requires confirmation for the reply step, and verifies the current job after the action. The first executable scenario is MSGW; lock, CPU, and disconnect procedures provide read-only or verification checkpoints until a reviewed mutating action exists.

### Action planner (AIAB-13 / #53)

`src/features/action-board/action-planner.ts` is the common proposal contract for the selected job. It merges live operator availability, the scenario runbook, approved Resolution Memory, and installed MCP action declarations by action identity. Each proposal carries its source, effect, risk class, permissions, evidence requirements, verification rule, citations, and ready/advisory/blocked state. An unassigned incident recommends Claim work first; a runbook can select the next eligible operation; an approved memory remains advisory until the operator reviews current evidence.

`jobs-ipc.ts` returns the planner snapshot with job details. The AI runtime returns the same snapshot with a job-scoped answer, and the task window renders one compact primary recommendation plus on-demand proposal context. MCP catalog entries carry the same proposal metadata before their separate preview flow. The planner only describes choices: it cannot run a command. Built-in runbooks and MCP writes continue through the existing operator action plan, authorization, approval, verification, and `createActionAuditEntry` contract, so retrieved text or model output never becomes an execution request.

`src/features/action-board/problem-management.ts` stores up to 250 customer-scoped problem records, each with up to 50 bounded occurrences. Matching requires exact system, alert kind, and job identity, then rejects conflicting job type or subsystem evidence. A matching fingerprint raises confidence but a different fingerprint stays an explicit operator-confirmed candidate. `problem-management-ipc.ts` exposes candidate, recurrence, confirmation, and verified-fix transitions behind the existing incident-workflow authorization; there is no automatic grouping or closure.

`src/features/action-board/incident-replay.ts` contains ten fixed v1 scenarios spanning recovered, still-blocked, missing-evidence, escalation, and unsafe-response outcomes. `runReplay()` returns sanitized scenario evidence, deterministic check results, and `executedLiveAction: false`; unsupported selections are blocked. `incident-replay-ipc.ts` intentionally has no live connector dependency, and the renderer uses it only for the task-window training panel.

`src/features/action-board/resolution-memory.ts` stores at most 500 normalized customer-owned entries. `createResolutionDraft` captures incident symptoms, evidence references, failed timeline attempts, the last recorded action, outcome, system, job, environment, operator, and source incident. Review history records creation, approval, revision, rejection, and retirement. `approveResolution`, `reviseResolution`, `rejectResolution`, and `retireResolution` are explicit lifecycle transitions; a revision creates the next version and keeps it out of retrieval until it is approved again. `findApplicableResolutionMatches` reports confidence, freshness, environment compatibility, and fingerprint/environment conflicts. `findApplicableResolutions` excludes non-current, stale, conflicting, incompatible, draft, rejected, and retired entries before AI retrieval. `exportScopedResolutionMemory` returns only the current system and global entries. The IPC uses read authorization for inspection/export and incident-workflow authorization for review mutations; it never executes a stored procedure, and approved memory remains advisory evidence.

Shared collaboration is defined by `src/features/alerts/shared-incident-model.ts` and `src/features/alerts/shared-incident-service.ts`. A versioned event contains a stable incident identity, organisation/system scope, source revision, occurrence time, and either an incident upsert or removal. The service merges events by event ID, ignores events from another scope, reduces them to the latest incident view, queues unsent events, pulls through an injected adapter cursor, and keeps an explicit sync state. It also retains the latest revision during history purge and returns a portable cache for export. The transport and customer authentication are intentionally adapter responsibilities for the shared-service and access-control phases.

Mutation IPC uses `src/features/action-board/operator-access.ts` and `action-leases.ts`. The main process checks the active operator, system scope, action grant, and expiry before changing incident workflow or executing job/queue commands. Each request gets a unique execution identifier; a lease prevents concurrent work on the same target and a completed identifier cannot be replayed. IBM i authority and command execution still remain in the existing service boundary.

## Support access

`src/features/action-board/support-access.ts` is the small policy module for client-controlled outsourced support. A grant names an operator, organisation, exact system IDs, one or more of `read`, `investigate`, and `execute`, and a future expiry. A grant starts as `pending`; only the exact invited operator can accept it. The client owner can revoke it, and the main process evaluates expiry and revocation again at every read or action boundary. Permission mapping is additive: read exposes data, investigate adds incident workflow and handoff, and execute adds job and queue commands. The existing IBM i connection identity remains responsible for final command authority.

`src/features/action-board/incident-routing.ts` consumes the same active grants for explainable recommendations. Default rules map alert kinds to response skills and target minutes. Operator eligibility requires exact system scope (or the local owner), incident-workflow permission, active access, availability, every required skill, and a matching timezone-aware support window. The response snapshot carries the recommendation, exclusions, and `on_track`/`at_risk`/`overdue` SLA state to the task renderer. It is advisory and does not mutate workflow ownership.

`src/main/ipc/support-access-ipc.ts` persists invitations, acceptance, revocation, and audit events through the application store. The settings page exposes the same workflow without credentials or tokens. In this desktop release, the current OS/demo identity is the local owner; `IMONITOR_OPERATOR_ID` is an identity injection seam for service and integration tests. A future shared access service must authenticate a remote operator and supply the organisation/system context before this boundary is used across machines. The desktop does not claim to provide remote authentication by itself.

Incident handoff IPC uses the same authorization and per-incident lease boundary. `create-incident-handoff` records a pending destination without changing the current owner; `accept-incident-handoff` verifies the addressed operator and transfers ownership. Acceptance can ensure the external incident link exists before publishing the accepted state, so the new owner receives the linked work item. The handoff schema is intentionally small so a future shared access service can carry it between authenticated clients without coupling the task window to an external ticket provider.

ClickUp stores `handoffStatus` and `activeStatus` with each operator's integration settings. A pending handoff uses the first value; an accepted handoff uses the second. Status changes and assignee replacement are separate from the local workflow and use the same bounded delivery registry. Slack handoff notifications use stable keys derived from the incident, handoff ID, and event so retries do not duplicate a notification.

Task-window AI helpers pass `scope: 'job'` through preload and IPC. The main process verifies that the selected job is still present, filters alerts and operator activity to that job, includes only its status history, omits global monitoring history and arbitrary conversation context, and instructs the provider to decline unrelated questions. The ActionBoard composer passes monitor scope by default and explicit job scope after selecting a job; its context control clears the selection. Task helpers always pass job scope.

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

## UI-01 Connect and shared navigation

`public/shared/app-navigation.js` supplies three destinations to the connected ActionBoard, Knowledge and Settings screens. Connect initializes only disclosure-menu dismissal for theme, plan and Support; it has no workspace navigation. The main-process navigation handlers reject ActionBoard, Settings and Knowledge requests without an active IBM i session, including direct IPC calls. This uses the existing connection state, not a separate app-account login. Allowed navigation never calls disconnect or resets the monitor loop. Knowledge provides the compact source library and Analyze code route; source content is loaded only through the scoped main-process IPC. Independent job windows retain their native title bar and existing lifecycle.

`public/connection/saved-connections.js` owns profile selection, edit/add/cancel/save/delete and load retry. The entry module retains connection execution, themes, entitlements and Support. A save includes the existing profile ID during edits, preserving backend duplicate checks and encryption. Background profile notifications do not replace unfinished input. Busy operations lock profile controls; the Connect screen has no workspace destinations that could discard unfinished edits. Credentials stay in renderer memory and the existing protected profile store, never browser session storage.

`public/styles/app-shell.css` scopes shared tokens, navigation and compact form patterns to migrated screens. The board keeps its feature styles. Settings categories and job-window layout remain separate tickets (#60 and #59). The shared navigation prevents departure while a board AI request is pending, and board session preferences restore its unsent draft after navigation without automatically sending it.

### Settings categories (UI-04 / #60)

`public/settings.html` exposes seven category values: `general`, `monitoring`, `ai`, `integrations`, `skills`, `access`, and `storage`. `public/settings.js` owns category visibility, one-open-panel behavior, compact cross-category routing, and integration catalog placement. Existing feature modules continue to own their forms and persistence. General uses the existing theme IPC contract. Storage links to the existing background collector and retention controls without duplicating their state. Category navigation hides inactive views while keeping unsaved DOM form values in memory.

### Skills and MCP registry (AIAB-10 / #50)

`src/features/mcp/mcp-registry.ts` is the small domain boundary for customer-approved skills and MCP connections. It validates a complete manifest before installation, rejects credential markers and unsupported permissions, normalizes persisted records, keeps scope/provider/transport/capability/approval metadata, and makes revoked capabilities irreversible. Newly installed capabilities start disabled; a safe health check only succeeds for enabled read-only capabilities and never runs an IBM i action.

`src/main/ipc/mcp-ipc.ts` is the only mutation boundary. Every registry read or mutation requires the existing authenticated `investigate` permission from the main-process knowledge access context. The AI request paths have no registry mutation access, so AI cannot install, enable, configure, or revoke a capability. Registry state is persisted in the existing encrypted-store location as `mcpRegistry` and returned to the renderer without secrets.

`public/settings/mcp-skills.js` renders separate Installed and Available lists for Skills and MCP connections. Selecting an item opens one compact detail dialog showing version, owner, provider, transport, scopes, approval class, capabilities, status, and health. Remote endpoints must be HTTPS; configuration changes require a new explicit safe test. The UI exposes Install, Enable/Disable, Safe read-only test, Configure, and Revoke only where the capability state allows them. The renderer uses text nodes for registry values and the scoped stylesheet keeps the lists usable at narrow widths.

### Scoped MCP resources and prompts (AIAB-11 / #51)

`src/features/mcp/mcp-resources.ts` is the read-only resource contract. It accepts only a manifest-declared resource or prompt on an enabled local capability, reuses `authorizeKnowledgeRead` for customer/system/operator scope, applies bounded input/output limits, redacts credential-shaped text, and attaches stable source references, observed timestamps, freshness, and redaction state to every returned item. Timeout and cancellation are handled inside the request promise so a slow preview cannot block the monitoring loop; malformed adapter data becomes an empty safe result. Remote transports remain unavailable until a future authenticated transport boundary is implemented.

`src/main.ts` supplies safe projections of current jobs, active incident evidence summaries, verified runbook policies, and approved Resolution Memory. It never forwards raw job or incident payloads, credentials, or cross-system records. `src/main/ipc/mcp-ipc.ts` exposes one operator-authorized `read-mcp-resource` handler beside the #50 registry controls. The Settings detail dialog reuses the existing capability selection and adds a small read-only preview with optional job scope and bounded input; output is displayed as a sanitized preview and errors remain recoverable.

### Controlled MCP actions (AIAB-12 / #52)

`src/features/mcp/mcp-actions.ts` is the single gateway for write-capable MCP tools. A manifest must declare each tool’s operator action, effect, risk class, required permissions, evidence requirements, input/output schemas, and verification rule. `preview()` validates the selected job and enabled capability, returns the scoped target and current evidence, hashes bounded input, and stores a short-lived pending preview without executing anything. `approveAndExecute()` requires explicit approval, repeats authorization and customer/system/operator scope checks, rejects stale or changed evidence, enforces the input hash and a per-job action lease, and bounds execution with cancellation and a deadline.

The gateway reports `recovered`, `failed`, or `unknown` only after `verify()` performs a separate current-state read. A timeout or cancellation is `unknown` because the underlying IBM i command may still be in flight. Replays, revoked capabilities, missing permissions, invalid input, and verification failures fail closed. `src/main/ipc/mcp-ipc.ts` exposes only catalog, preview, and approved-run handlers and writes sanitized phase, scope, input-hash, approval, verification, and error fields to the existing ActionBoard audit record. `src/main.ts` maps the built-in IBM i Job Control tools to the existing authenticated operator-action command and verification path; it does not introduce a second command executor.

`public/job-task.js` renders the catalog, preview, approval, and result in the selected Job Task alongside the existing actions. The UI keeps the effect, risk, scope, evidence, and verification rule visible and retains an unknown or failed result for investigation. Settings explains that write tools require explicit approval; installing or enabling a capability never enables execution by itself. There is no automatic MCP write path in this release.

### Live activity on the connected board

`public/monitor.html` opens the existing `board-history-panel` disclosure above jobs. `public/monitor/history.js` continues rendering the main-process polling history for Job volume, Peak job CPU and Wait states, including empty history; collapsing the overview does not stop collection or reopen the panel on updates. Each connection starts with it expanded. The scoped board stylesheet keeps three compact charts in light/dark and narrow layouts and reduces the job-list scroll height only while the overview is expanded. No additional polling loop, history store, or telemetry metric was added.

### Compact independent job task window (UI-03 / #59)

`src/main/window/window-runtime.ts` owns one native `BrowserWindow` per normalized qualified job identity. A repeated open focuses the existing entry in `jobTaskWindows`; a different identity receives its own window. The initial native size is 720×680 with a 560×460 minimum so the renderer has roughly 680 CSS px of working width while retaining a usable narrow reflow.

`public/job-task.html` keeps only Overview and History as persistent navigation. The workflow, AI helper, runbook, Resolution Memory, recurring-problem, replay, and handoff sections are contextual Overview sections. Logs, messages, and resource relationships are inside a native `details` disclosure. `setTab()` treats helper actions as Overview context, preserves the existing conversation, and hides contextual sections only while History is selected.

The task renderer loads the saved theme before displaying the window and keeps polling, action leases, authorization, ticket synchronization, and recovery verification in their existing main-process boundaries. Focused Electron tests cover window identity reuse/coexistence, two-tab keyboard navigation, contextual AI focus, technical disclosure, workflow failures, action confirmation, history escaping, refresh races, and minimum-size reflow.
