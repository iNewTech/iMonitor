# Alert and task workflow

## From detection to recovery

ActionBoard attaches detected issues to their jobs in the active-job table. The row distinguishes the job’s operating state from its issue, and shows the claimed owner. “Focus Next Job” opens the highest-priority available issue.

Held job queues also receive an automatic, bounded read-only triage after a monitoring poll. iMonitor checks the queue state, reads waiting work, and reads the associated subsystem context. Each check is persisted so an interrupted run can resume, and changed queue evidence starts a fresh run. The triage result records the expected outcome, stop condition, and proposed next steps for operator review. It never releases or holds a queue, changes a queued job, or treats a successful read as permission to execute a correction.

Queue actions are a separate authorised path. Before a queue mutation, iMonitor confirms the selected queue or queued job still exists at the requested library and current state, requires confirmation, and blocks duplicate submissions while one is in flight. After the command is accepted, fresh queue/job reads classify the outcome as recovered, still blocked, failed, or unknown. A released queue with waiting jobs is still blocked until progress is observed; command acceptance alone is not recovery.

Open a job to work in its separate task window. Multiple jobs can stay open while the main board continues polling. Overview, Actions, AI helper, History, and Details keep each task compact. Refresh failures offer retry; in-flight actions cannot be submitted twice, and background refresh preserves the current tab and feedback.

The Actions tab includes a compact Respond, Investigate, and Resolve brief for the selected job. It keeps impact, owner, current status, next check, and evidence visible beside the workflow buttons. A handoff sends only the recipient, reason, pending checks, and optional response target; the existing incident timeline and evidence remain the source for the rest of the context.

- **Acknowledge** records that an operator has seen the issue.
- **Claim Work** assigns it to the current operator. When configured and entitled, the main process creates or reuses its linked ClickUp task.
- **Remove Claim** releases ownership so another operator can take it.
- **Mark Work Done** records completion of the operator’s work. It does not prove system recovery.
- Monitoring confirms recovery before clearing the active issue. Its history remains available.

Workflow state and history are stored locally. This is a desktop workflow; it does not yet provide a shared multi-client assignment service or delegated support permissions across machines.

Each saved IBM i connection has its own durable incident ledger. A record uses the connection ID plus the monitored resource and condition as its stable identity. Repeated polls update that record, verified recovery resolves it, and a later recurrence increments the occurrence count while preserving the earlier timeline. The canonical lifecycle is detected, acknowledged, investigating, awaiting escalation, verifying, resolved, and reopened. The current operator actions cover every phase except awaiting escalation, which is reserved for the support-routing workflow.

When an incident is first observed, iMonitor asynchronously captures a bounded evidence snapshot for the trigger job, job context, job log, messages, job queue, and subsystem. Each snapshot carries its collection time, source, record count, and status. Missing, stale, permission-denied, unavailable, and partial results remain visible; capture does not block the monitoring poll. A reconnect also backfills older ledger records that have no evidence, while later polls preserve the original snapshot.

## Handoffs

The current operator chooses a recipient and sends the same incident to that person. The original owner remains accountable while the handoff is pending. The recipient must accept it in iMonitor before ownership changes; acceptance records both operators and the acceptance time in the incident timeline. No handoff document is copied or exported from the task window.

If an external integration is configured, the handoff is synchronized through the existing incident link. ClickUp can move the task to the configured handoff status, remove the previous assignee, add the accepting operator, and move the task to the configured accepted status. Jira receives the workflow comment, and Slack can receive a focused requested or accepted handoff notification. External delivery is retried and recorded separately, so a provider failure does not roll back the local ownership decision.

## Storage, retention, and export

The local Electron store retains operator-facing incident facts: system label, resource identity, severity, ownership, notes, external task link, resolution state, and a versioned event timeline. Invalid or incomplete records are ignored during startup so one damaged entry cannot prevent monitoring. Incident records remain after recovery and across app restarts; automated retention controls and incident export are planned before production rollout.

Operator evidence stays separate from encrypted developer diagnostics. Incident exports must include only the operator-facing ledger and must redact credentials, API keys, connection passwords, raw diagnostic logs, and unrelated source or SQL text. Developer support bundles continue through the encrypted diagnostics path.

## Actions and AI

Task windows offer issue explanation and resolution guidance with the configured AI provider. These helpers use a job-scoped context containing only the selected job, its linked incident, captured evidence, status history, and matching operator entries. Requests outside that job are declined. These are recommendations. IBM i operations follow the main-process action planner, entitlement checks, and confirmation flow. Unsupported actions remain unavailable. AI does not autonomously execute recovery commands.

Task actions report failures without dropping the selected job. The backend owns external ticket creation so opening or refreshing a task cannot duplicate a ClickUp request from the renderer.

## Integrations

ClickUp starts tracking on claim rather than on every monitoring poll. If a handoff is accepted before a task exists, the backend creates the task at acceptance, links it, assigns the accepting operator, and synchronizes the handoff. ClickUp handoff and accepted statuses are configurable because list status names differ between workspaces. Subsequent workflow updates synchronize through the link. External integration failures are recorded for diagnostics; they do not remove the local incident.

Slack uses a configured Incoming Webhook. Jira creates issues through its configured project. Email and SMS use their configured transports. Shared alert watch rules control delivery conditions, with notification suppression to avoid sending the same active condition on every poll.

Setup, licensing, and the selected provider determine availability. Electron tests use isolated stores and mocked external services; successful test delivery does not replace validation against a client’s live configuration.
