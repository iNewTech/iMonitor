# Architecture

## Runtime boundaries

The Electron main process owns connections, monitoring, credentials, actions, persistence, and external integration calls. The preload exposes typed IPC methods. Browser modules render data and manage user interaction; they do not directly access the IBM i session or credential store.

```text
Renderer pages → preload → main/ipc → main/runtime → features + services
```

`src/main.ts` composes these modules. Domain logic belongs in `src/features/`; IBM i and local source providers belong in `src/services/`. Window creation and navigation belong in `src/main/window/window-runtime.ts`.

## Monitoring and task windows

A shared monitoring runtime polls jobs and updates monitoring/alert state. After a successful poll it starts the queue-triage runtime, which reads held queues, waiting jobs, and subsystem context through the same service boundary. Queue mutations pass through an IPC preflight and a fresh post-action recovery read, so an accepted IBM i command and verified recovery remain separate states. The ActionBoard renders the active-job list, focus controls, compact AI composer, queues, and persisted triage evidence. Each standalone task window reads the selected job by its qualified name through the same backend; it does not create its own IBM i connection.

Task refreshes are serialized, stale snapshots are ignored, and action feedback survives later refreshes. Background updates preserve the selected task tab. Explicit workflow and job actions are separate from read-only inspection.

The background collector is composed from `background-collector-runtime.ts`, `collection-runtime.ts`, and the existing monitoring runtime. It reconnects to a client-selected saved profile, starts the same authoritative read-only poll and incident preparation path, writes JSONL snapshots per system, exposes health and inventory through IPC, and keeps the main window optional. OS-login startup uses Electron's login item with a hidden window; closing the window leaves collection running while the app process remains active. Credential loss, connection gaps, and write failures are reported as degraded health. No corrective action is scheduled by this path.

`src/features/ibmeyeai/incident-correlation.ts` is the single deterministic correlation path used by the live alert state and AI context. It groups signals by qualified job identity within a five-minute window, keeps similar messages from different jobs separate, attaches a stable fingerprint, and calculates a bounded priority score from technical severity, affected jobs, workload signal, recurrence, and workflow state. Business impact remains explicitly provisional until service mapping is available. System-only matches are marked as suggestions for operator review; this path only prepares evidence and never executes recovery.

`src/features/action-board/incident-routing.ts` is the deterministic routing path for the task response brief. It matches an alert to an incident rule and active support operators by exact system scope, incident-workflow permission, required skill, availability, expiry, and localised support window. It calculates a bounded response SLA and returns reasons for both matches and exclusions. Routing recommends a person but never changes ownership or claims work.

`src/features/alerts/resource-graph.ts` builds the selected job's bounded resource relationship graph from the current alert, job poll, and job-context evidence. It records only observed incident/job, queue, subsystem, message-wait, and lock-owner edges, carries observation timestamps, marks stale snapshots, and reports missing lock-owner evidence. The task Details tab renders the flow and an accessible table through `get-job-resource-graph` IPC; it never infers or executes a relationship.

`src/features/action-board/business-service-mapping.ts` is the customer-owned mapping boundary. It resolves a job to one explicit service using system, alert-kind, resource, queue, subsystem, and specificity precedence, then evaluates the configured timezone-aware schedule and response deadline. Settings are persisted through the alert settings IPC; the task response consumes the result without changing technical alert detection or action authority.

## Shared incident boundary

`src/features/alerts/shared-incident-service.ts` defines the customer-controlled collaboration contract used by future unattended collection and delegated support clients. It carries versioned incident events scoped by organisation and IBM i system, merges duplicate or out-of-order events deterministically, keeps a local read cache, tracks pending writes, and exposes online, offline, and stale states. The service accepts an adapter rather than choosing a transport, so a customer-owned service or shared store can be added without making the desktop process the long-term authority. Retention and export operate on the same versioned cache.

Claims, work completion, and system recovery are distinct states. The main process identifies the current operator and owns ClickUp creation. Renderer code must not create a second task after submitting a claim.

Escalation is a durable two-step workflow. `incident-handoff.ts` validates a recipient, reason, pending checks, and response target; a pending handoff leaves the original owner accountable and moves the incident lifecycle to `awaiting_escalation`. The addressed operator must accept through the main process before ownership changes. Request and acceptance are separate timeline events, so the incident history and external work-item comment preserve who transferred the incident, who accepted it, and what remained to be checked.

External delivery is a separate reliability boundary. `src/features/integrations/delivery.ts` gives outbound ClickUp, Jira, and Slack events stable keys, bounded retries, duplicate suppression, and durable delivery status. The incident record remains authoritative: an unavailable integration records a skip or failure and never prevents local detection, triage, recovery, or operator actions. iMonitor owns lifecycle, owner, evidence, and timeline fields; the provider owns its external ticket ID, URL, assignees, and channel presentation. Jira and ClickUp references are stored on the incident workflow so later claim, handoff, and recovery updates use the same mapped work item.

Protected incident, job, queue, and AI data paths pass through a main-process operator authorization check and a per-target execution lease. `src/features/action-board/support-access.ts` models client-owned grants for named operators, exact IBM i system IDs, read/investigate/execute permissions, acceptance, expiry, and revocation. The client owner has the local full-access session; a delegated identity receives only the matching active grant. Grant changes are persisted and written to the activity audit without storing shared credentials. Execution identifiers are replay-protected, concurrent requests are rejected, and revocation blocks future reads and actions while an already-running command is reported truthfully. IBM i authority remains the final permission check at command execution. The current desktop establishes the boundary locally; a shared authenticated service must provide cross-machine identity before outsourced users can connect remotely.

## Object analysis

- `src/services/object-analysis.ts`: local provider, graph resolution, ordered object lookup.
- `src/features/object-analysis/local-source.ts`: physical library discovery, file walking, member selection. Generated output is excluded.
- `src/services/object-analysis-live.ts`: live source members and IBM i metadata.
- `src/features/object-analysis/`: parser, detailed analysis, compile plans, report storage, and AI context.
- `public/object-analysis.js`: source browser, session scope, selection, and page initialization.
- `public/object-analysis/actions.js`: async source/analysis/AI/approval/build requests with selection-version guards.
- `public/object-analysis/report-view.js`: report presentation.
- `public/object-analysis/call-graph.js`: graph construction/rendering from recorded caller-target references.

A source directory and an object library list answer different questions. Browsing discovers source files; the ordered library list determines which object resolves an unqualified reference. Explicitly qualified references never fall back to a different library.

Changing the selection or scope invalidates pending renderer responses. Source order, procedure declarations, and data access must not be converted into invented caller/callee edges. Compile plans are artifacts for review, not an execution route.

## Styles and themes

`public/styles.css` is an ordered import manifest for eight stylesheets in `public/styles/`. The import order preserves existing overrides. Shared colors use theme tokens; compatibility aliases are evaluated on the themed body so night mode inherits the correct values.

Keep a feature's styles with its existing module. Do not append unrelated fixes indefinitely to the entry stylesheet or change import order without checking all affected screens.

## Storage

- Local configuration and workflow state: application store managed by main.
- Credentials: protected by the platform's credential/encryption support.
- Analysis artifacts: beneath the chosen source root, with application-storage fallback for reports when necessary.
- Monitoring/history and developer diagnostics: separate runtime-owned stores; raw developer diagnostics remain outside the renderer bridge.
- Background collection: local `imonitor-collection/<system>/monitoring/*.jsonl` snapshots plus a tamper-evident purge audit; credentials remain in protected app storage.
- Widget: summary JSON written by the widget runtime for the native macOS extension.

This is a desktop architecture. Shared multi-operator authorization across machines, server-side coordination, and fully autonomous recovery remain separate product work.
