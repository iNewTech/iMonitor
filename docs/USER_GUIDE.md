# iMonitor user guide

iMonitor is an IBM i operations workspace. It connects to a system, watches active work, explains incidents with evidence, and gives an authorised operator a safe place to take and verify action.

## Connect

1. Open iMonitor and choose a saved IBM i profile, or use the development Demo connection.
2. Check the system name, address, port, and operator before connecting.
3. Select **Connect & Monitor**.

Connection profiles are stored locally on the machine. The password is protected by the operating system's secure storage.

## Monitor

The ActionBoard shows the live system in one work area:

- **Active jobs** lists running and waiting work. Use filters, search, or **Focus Next Job** to find the highest-priority incident.
- A job can be running and still have an issue, such as high CPU or a lock wait. The incident badge explains what needs attention.
- A `P##` badge shows the technical priority used by **Focus Next Job**. Open the job and choose **Actions** to see which signals were grouped and why the score was assigned. The score is provisional until a business service is mapped.
- **Job queues** stays separate so waiting work can be inspected without hiding the active-job feed.
- Open a job to work in its own task window. The main board continues monitoring while task windows are open.

To keep monitoring available when the dashboard is closed, open **Settings → Alerts → Background collector**. Enable collection, choose a saved profile, set the polling interval, and choose whether iMonitor starts with the computer. The collector stores read-only poll snapshots locally for each system and shows its last successful write, record count, storage size, retention period, and any connection or write issue. Use **Purge all records** only after reviewing the confirmation; purge is permanent and does not remove saved credentials.

## Work an incident

The task window keeps the selected job in context:

1. **Overview** shows the current issue, owner, job state, and captured evidence.
2. **Actions** lets an operator acknowledge, claim, add a note, mark work done, and use approved IBM i actions when available.
3. **AI helper** explains the selected job and suggests checks or a resolution using its incident evidence.
4. **History** shows the incident timeline, operator actions, and evidence changes.
5. **Details** shows the underlying job context.

Claiming work assigns it to the current named operator. Configured ClickUp workflows can create a linked work item. An incident remains visible until monitoring or a manual recheck confirms the underlying condition is clear.

When the current operator needs another person, use **Send handoff** in the task window. Choose the recipient, add the reason and pending checks, and optionally set a response target. The current owner remains accountable while the handoff is pending. The recipient opens the same incident and selects **Accept handoff**; only then does ownership move to that operator. The timeline records both the request and acceptance. Handoff context stays inside the incident workflow and is synchronized through configured integrations.

The Actions view also shows a routing recommendation for an active incident. It checks active support access, IBM i system scope, incident skills, availability, support window, and the response SLA. The recommendation is guidance only: the receiving operator must still accept or claim the work. If access is expired, no operator matches, or the SLA is overdue, the view explains why the incident should be escalated.

Only the client owner or a named support operator with an active grant for the connected IBM i system can change workflow or run a job/queue action. iMonitor rejects a stale incident update, a request for another system, a duplicate request that is still running, and a replay of a completed request. IBM i permissions are checked again when a command is executed.

## Grant support access

Open **Settings → Support access** to invite an internal or outsourced specialist. Enter the person’s authenticated operator ID, the exact IBM i system IDs they may use, the permissions they need, and an expiry time. **Read** allows inspection, **Investigate** adds AI and incident workflow, and **Execute** adds approved job and queue actions. The invitation must be accepted by that operator before it becomes active. The client owner can revoke it at any time; revocation blocks future data access and actions, while an already-running command is allowed to finish and is reported honestly. No shared IBM i administrator password is stored or sent.

This release stores and enforces grants in the desktop application. Cross-machine outsourced access needs the future authenticated shared service, which will provide the remote operator identity and customer boundary.

Queue actions show a confirmation and command preview. iMonitor checks the exact queue or queued job again immediately before execution, prevents duplicate in-flight actions, and reads the system again afterward. The result is reported as **recovered**, **still blocked**, **failed**, or **unknown**. A successful command submission alone is not shown as recovery.

## Use AI safely

Use the compact AI composer or the task-window helpers for incident summary, explanation, SQL activity, job health, and resolution guidance. The task-window AI is limited to the selected job and its incident evidence. It declines unrelated questions in that context.

AI is advisory. It cannot claim work, create a ticket, release a queue, end a job, reply to a message, or bypass operator confirmation. The operator decides whether to use a suggested action.

## Support levels

- **L1 is automatic:** iMonitor detects enabled conditions, creates or updates the incident, captures read-only evidence, runs bounded triage, and prepares AI context. No one needs to create an L1 ticket by email.
- **L2 is operator-led:** one authorised client or delegated support operator claims the incident, checks the evidence and runbook, approves an action, and verifies the outcome.
- **L3 handles uncertainty and risk:** a specialist reviews difficult or high-risk incidents, adds deeper findings, and hands back a verified solution or reusable procedure.
- **Fully autonomous recovery is future scope:** production corrections always require current permission and a human approval in this release.

## Integrations

Configure integrations from **Settings**:

- **ClickUp** creates and updates operator work items. Set the handoff and accepted statuses in the ClickUp settings so they match your list.
- **Slack** sends incident and handoff alerts to a configured channel.
- **Jira** creates and tracks incident issues.
- **Email** sends notifications through SMTP.
- **SMS** sends notifications through a compatible provider-neutral HTTP API.

Integration credentials and settings are kept separate for the named operator where supported. Test controls can send real messages or create real work items.

iMonitor keeps the incident record locally even when an integration is disabled or unavailable. Configured outbound events show a durable delivery outcome internally, retry short-lived failures within a bounded limit, and do not create a second external ticket when the same event is retried. Linked Jira and ClickUp work items receive approved claim, handoff, and recovery updates from the iMonitor workflow.

## Data and support

Incident records, action history, and monitoring summaries are retained locally for the current desktop workflow. The shared incident service is designed for customer-controlled storage and synchronisation between clients; its scope is always tied to an organisation and IBM i system, and it reports offline or stale state when synchronisation is unavailable.

Use the support tools when a provider or connection fails. Record whether a result came from the Demo connection or a live IBM i system. Demo success does not prove live IBM i permissions, recovery, or external delivery.
