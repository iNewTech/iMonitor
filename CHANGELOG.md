# Changelog

## Unreleased

- Simplified startup, job-task, and preload responsibilities while preserving the existing UI and IPC API (#61, Project 8).
- Fixed stale task responses and action previews, duplicate workflow ticket requests, export visibility and permission rechecks, telemetry scope/persistence/retention, and Storage failure/retry feedback (#61).
- Required fresh monitoring evidence for MCP verification and restricted external links to supported web/email destinations (#61).
- Applied data-directory overrides before initializing storage and added a bounded telemetry flush on explicit Quit (#61).

- Added scoped AI + ActionBoard observability for RAG/MCP health, redacted metrics, audit continuity, retention, export, purge, and index rebuild controls (#55, AIAB-15, Project 8).
- Added the Project 8 AI + ActionBoard release record with automated evidence boundaries, pilot scenarios, UAT fields, deployment smoke, rollback, and documentation links (#56, AIAB-16, Project 8).

### 2026-09-14

- Added reviewed Resolution Memory lifecycle for verified outcomes, including operator/source-incident lineage, approve/revise/reject/retire actions, review history, freshness and environment signals, conflict detection, scoped retrieval protection, and compact task-window review controls (#54, AIAB-14, Project 8).

### 2026-09-13

- Organized Settings into seven compact categories with General theme management, honest Skills & MCP and Storage entry points, and preserved existing alert, AI, integration, collector, and access flows (#60, UI-04, Project 8).
- Added the versioned scoped knowledge/evidence contract for future RAG and MCP work, including source validation, review lifecycle, freshness, citations, and credential-free support context (#41, AIAB-01, Project 8).
- Added the main-process knowledge access boundary for exact customer/system scope, local-owner and delegated grants, expiry/revocation checks, pre/post retrieval filtering, safe exclusion diagnostics, citation sanitization, and fail-closed search behavior (#42, AIAB-02, Project 8).
- Added the local-first rebuildable knowledge store with content-hash deduplication, atomic persistence, offline lexical search, lifecycle controls, scoped purge/delete, reindex markers, and degraded-state statistics (#43, AIAB-03, Project 8).
- Added incremental Knowledge ingestion for incident evidence, runbooks, approved resolutions, job context, object analysis, and customer documents, with operational chunk boundaries, secret redaction, idempotent versioning, partial-failure isolation, cancellation, and a compact library/detail UI (#44, AIAB-04, Project 8).
- Added the pluggable knowledge-index contract with a local lexical adapter, explicit future vector-provider catalog, scoped provider payloads, protected settings, and degraded local fallback when a provider is unavailable or returns unsafe data (#45, AIAB-05, Project 8).
- Added hybrid IBM i knowledge retrieval with bounded job/incident query context, exact identifier ranking, provider-backed semantic source labelling, deduplication, freshness/review states, relevance reasons, stable citations, no-match states, and local fallback (#46, AIAB-06, Project 8).
- Added bounded cited context packs with source-type freshness windows, explicit missing evidence, safe exclusions, citation-complete records, and compact on-demand evidence details below job AI responses (#47, AIAB-07, Project 8).
- Grounded selected-job AI in scoped retrieved support context with bounded SupportContext, retrieval health, full response-shape validation, citation requirements, stale/fallback visibility, and prompt-injection-safe evidence formatting (#48, AIAB-08, Project 8).
- Added a versioned deterministic knowledge regression harness with golden IBM i support scenarios, retrieval recall/precision proxies, citation and uncertainty checks, scope isolation, latency/context metrics, and sanitized comparison artifacts (#49, AIAB-09, Project 8).
- Added a customer-controlled Skills and MCP registry with validated manifests, scoped operator-only install/configure/health/enable/disable/revoke controls, separate installed/available Settings lists, and safe read-only checks (#50, AIAB-10, Project 8).
- Added bounded, scoped read-only MCP resource and prompt previews for current jobs, incident evidence, verified runbooks, and approved Resolution Memory with provenance, freshness, redaction, timeout, and cancellation handling (#51, AIAB-11, Project 8).
- Added the controlled MCP action gateway for approved IBM i Job Control tools, with declared risk/effect/evidence contracts, job-scoped previews, explicit approval, fresh authorization, replay/lease protection, bounded cancellation, independent verification, sanitized audit records, and selected-task UI (#52, AIAB-12, Project 8).
- Added a shared job-scoped ActionBoard planner that combines operator actions, runbooks, approved Resolution Memory, and MCP proposals into one compact recommendation with effect, risk, evidence, permissions, verification, citations, and escalation state; proposals remain advisory until the existing approval gateway is used (#53, AIAB-13, Project 8).
- Refined job tasks into compact independent windows with only Overview/History tabs, contextual actions and AI, expandable technical details, saved theme inheritance, and per-job window reuse (#59, UI-03, Project 8).
- Show the compact live activity overview above jobs by default after connecting; retain live chart updates while collapsed (#58, UI-02, Project 8).

- Removed workspace navigation from Connect and blocked Settings/Knowledge routes until connected (#57, UI-01, Project 8). Profile controls, theme, plan and Support remain available before connection.
- Added the explicit UAT stage before Done for Project 8; completed implementation awaits user acceptance.
- Added the compact Connect screen and shared ActionBoard/Knowledge/Settings navigation (#57, UI-01, Project 8).
- Fixed saved-profile rename identity and retained board drafts across destination navigation; protected unfinished edits and added profile loading retries.

- Added customer-scoped support outcome reporting with stage definitions, unknown samples, previous-window comparison, AI availability, and JSON export.
- Added a pilot validation and compatibility record for exact client, IBM i release/PTF, authority, scale, provider, integration, defect, and approval evidence.
- Added P2, P3, and P4 release-gate records with candidate, automated-test, UAT, review, deployment, smoke, and rollback checklists.
- Added recurring-problem management, sanitized incident replay training, and verified runbook checkpoint execution to the ActionBoard roadmap documentation.
- Kept autonomous production recovery as future research; current production mutations remain authenticated, approved, and independently verified.

- Split analysis rendering, request coordination, source discovery, and main-process analysis setup into focused modules.
- Organized styles by feature behind an ordered import manifest and reused shared monitor formatters.
- Fixed source discovery for common IBM i export layouts, preserved disk casing, and excluded generated analysis output.
- Prevented late analysis/source responses from replacing a newly selected program and restored draft approval after AI changes.
- Added evidence-based executable call graphs, conservative compile-plan validation, and artifact-path checks.
- Improved task-window retry, action feedback, keyboard navigation, history, and request coordination.
- Fixed immediate job-owner updates, AI preset menu layering, and a floating AI widget resize loop.
- Improved analysis panel spacing, sidebar scrolling, responsive action rows, and theme tokens.
- Added renderer syntax/import validation to builds and expanded domain and Electron regression coverage.
- Added bounded, redacted incident evidence capture with durable source status in alerts, task windows, and AI context.
- Added deterministic incident correlation, explainable technical priority scoring, and compact priority explanations in job rows and task windows.
- Added explainable incident routing recommendations with support-grant checks, required skills, timezone-aware support windows, and SLA state in task windows.
- Updated architecture, technical, feature, and alert-workflow documentation.

- Renamed the main monitor workspace to `iMonitor ActionBoard`.
- Added structured ActionBoard audit records for IBM i job actions.

## 2026-08-30

### Changed

- ClickUp settings now save per operator instead of one shared app-wide value
- Settings now show which operator owns the current ClickUp configuration
- Demo mode now uses `GajenderT` as the operator identity for alert ownership and per-user settings
- ClickUp assignee email now resolves once to a cached, read-only member ID per IBM i operator
- ClickUp now creates tickets when an operator starts work instead of when alerts are detected
- Settings and dashboard panels now use subtle category colors when collapsed
- Slack alerts now use one structured, severity-colored card per webhook message
- Slack alert defaults now include MSGW, LCKW, high CPU, DLYW, DEQW, and poll failures

### Fixed

- Alert workflow mutations now use the same current-operator resolver as the rest of the app
- Legacy shared ClickUp settings now migrate forward into the current operator's saved settings on first read
- Legacy ClickUp email values are no longer displayed or used as numeric member IDs

## 2026-08-29

### Added

- Slack channel alert delivery through encrypted per-operator Incoming Webhook settings
- Independent Slack routing rules and test delivery action for alert types
- AI diagnostic comments and readable daily log attachments on operator-started ClickUp tasks
- Unit and Electron coverage for alert rule persistence and diagnostic delivery
- Dedicated `iMonitor Settings` page for AI and integration setup
- ClickUp action tracking with saved workspace, space, and list selection
- `Create ClickUp Task` alert action that links one task back to the incident
- Automatic ClickUp comment sync for later notes and workflow updates
- End-to-end smoke test coverage for the new Settings page

### Changed

- Starting work creates and assigns a linked ClickUp ticket to the active operator, then reuses it for updates
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
