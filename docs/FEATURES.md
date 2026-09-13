# iMonitor feature access

iMonitor uses a simple Free/Premium feature boundary. The application keeps Premium controls visible so users can understand what is available, but protected operations are disabled until Premium is active.

## Current experience

- Compact saved-system Connect flow with protected credentials, in-place profile rename, load/connection retry, and first-use setup. After connecting, shared ActionBoard/Knowledge/Settings navigation preserves monitoring and the board draft within the window session. Knowledge provides Analyze code and scoped hybrid retrieval for job and incident context.

- Live activity overview opens above jobs after connecting, with Job volume, Peak job CPU and Wait states charts; collapse it for more job-list space.

- One active-job workspace with filters, issue labels, owner names, and priority focus.
- Deterministic incident correlation groups related signals for the same job within a five-minute window and shows a priority score with the reasons behind it.
- Separate compact job task windows with Overview/History, contextual workflow actions, AI guidance, runbooks, handoff, and on-demand technical details; one window is reused per qualified job identity.
- Respond, Investigate, and Resolve brief with impact, owner, next check, evidence, and a compact L2/L3 handoff workflow.
- Explainable routing recommendations match active support grants to incident skills, system scope, permission, availability, and support windows, with an SLA state beside the suggested owner.
- Versioned scenario policies cover message waits, lock waits, high CPU, and monitoring disconnects with required evidence, safe checks, verification criteria, and escalation guidance.
- Guarded runbook execution advances through persisted check, approved action, and independent verification checkpoints; stale evidence, unsupported actions, and unresolved recovery stop the runbook explicitly.
- L3 known-error workspace groups compatible recurring incidents with explainable matches, captures root cause/workaround/ticket evidence, and reopens resolved problems when a later occurrence is recorded.
- Isolated incident replay provides ten versioned training scenarios with sanitized evidence, expected outcomes, and an explicit no-live-action boundary.
- Job AI helpers grounded to the selected job, linked incident evidence, and matching scoped knowledge only. Responses separate observed facts, matching evidence, interpretation, missing evidence, suggested checks, approved procedure, and next safe action with stable citations and retrieval health.
- Timestamped incident evidence for the trigger job, job log, messages, queue, and subsystem, with visible missing or permission statuses.
- Evidence-backed resource relationships in the job Details tab, with compact flow and accessible table views for incidents, jobs, queues, subsystems, message waits, and lock owners.
- Customer-owned business service mappings with deterministic precedence, owner, timezone-aware operating window, and deadline-risk context in the task response.
- Customer-scoped Resolution Memory turns an incident investigation into a draft procedure. Operators can explicitly approve, retire, retrieve, and export versioned knowledge for the connected system; it is never added to a shared pool by default.
- Minimal ActionBoard with one health strip, four-column jobs list, My work/status/subsystem filters, and per-profile session view restoration.
- Full-width growing AI composer with compact model menu, explicit system/job scope, availability checks, and optional floating IBMEye.
- Job queues remain in their own section below the main workspace.
- Client-controlled background collector for read-only monitoring, per-system local snapshots, retention, inventory, health, and confirmed purge.
- Compact Settings categories for General, Monitoring, AI & knowledge, Integrations, Skills & MCP, Access, and Storage; existing feature panels keep their current setup and permission boundaries. Skills & MCP now has a customer-controlled registry for approved read-only skills and connections, with inspect, configure, health-check, enable/disable, and revoke actions.
- Evidence-first Support outcomes panel with date windows, incident/stage samples, unknown outcomes, AI request availability, previous-window comparison, and customer-scoped JSON export. Operator-verified recovery is measured separately from future autonomous recovery.
- Local and IBM i source analysis, evidence-based call graphs, approved reports mapped to source programs, and saved compile plans. Compile commands are never run automatically.
- A macOS WidgetKit scaffold is available under `macos-widget/`; signing and native installation remain separate from the Electron app.
- The AI + ActionBoard knowledge layer defines scoped records, evidence references, review statuses, freshness, incremental redacted ingestion, a local-first rebuildable lexical store, pluggable index adapters, hybrid retrieval, bounded ranking, relevance reasons, stable citations, bounded context packs, explicit missing evidence, provider health, selected-job grounding, and one main-process access boundary that filters before and after retrieval for local owners and delegated support (#41–#48, AIAB-01–08, Project 8).
- Knowledge quality is checked by a versioned deterministic golden suite covering MSGW, LCKW, high CPU, queue waits, disconnects, recurring problems, unknowns, stale/conflicting evidence, and prompt-injection text. The suite records retrieval recall/precision proxies, citation coverage, uncertainty/refusal correctness, scope violations, latency, context size, and sanitized comparison artifacts (#49, AIAB-09, Project 8).
- Knowledge provides a compact library with source search, Needs review filtering, add-source validation, source details and version history, delete, index refresh, and a secondary Analyze code entry. It groups chunks into one source row so operational context stays easy to scan.

## Free plan

- Job, subsystem, wait, SQL, message, and log information
- IBMEye alert detection and incident history
- Alert acknowledgement, ownership, return to queue, notes, and recheck
- Desktop notifications
- IBMEye AI explanations and recommendations with local Open Models

## Premium plan

- IBM i job actions such as hold, release, end, and MSGW reply
- ClickUp action tracking
- Slack alert delivery
- Jira incident tracking
- SMS notifications
- Hosted AI providers such as OpenAI, Claude, and Grok
- Email notifications using the user's SMTP server remain available on Free.

## Development license

Development builds accept this local test key:

```text
IMONITOR-DEV-PREMIUM-2026
```

The Connect screen includes a development plan selector so Free and Premium behavior can be previewed. Selecting Premium enables the development override; entering the key validates the Premium path explicitly.

The key is validated in the Electron main process and is intentionally rejected by packaged production builds. Development builds also include a development override so Premium workflows can be tested without changing production licensing behavior.

Production licensing should replace this path with signed license validation before release.

## Provider-neutral SMS

Premium users can connect any REST-based SMS gateway from Settings → SMS alerts. The adapter supports HTTPS endpoints, POST/PUT/PATCH/GET requests, JSON/form/text bodies, bearer/API-key/Basic authentication, custom headers, multiple recipients, and optional response ID extraction. Request templates can use alert tokens such as `{{recipient}}`, `{{message}}`, `{{title}}`, `{{timestamp}}`, `{{connection}}`, and `{{alertId}}`; configured credentials are also available when a provider requires them in a body or custom header.

Credentials are encrypted in local app storage. The development build can use a localhost endpoint for testing; production endpoints must use HTTPS. The shared IBMEye Alerts channel rules decide when SMS delivery is enabled, and repeated alerts are protected by the normal notification cooldown.
