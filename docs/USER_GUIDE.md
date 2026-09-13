# iMonitor user guide

iMonitor is a desktop workspace for IBM i production support. It watches active work, detects operator-impacting conditions, collects evidence, brings the right job context into one task window, and records what happened.

This guide is written for someone using iMonitor for the first time. Follow the first section once, then use the later sections as a daily operating reference.

## 1. Understand the workflow

The normal iMonitor flow is:

**Connect → Monitor → Detect → Investigate → Ask AI → Approve → Act → Verify → Record**

iMonitor performs first-line observation and read-only preparation automatically. A named, authorised operator remains responsible for production corrections. A command being accepted by IBM i does not by itself mean that the problem is fixed; iMonitor checks the system again and records the result.

The support model is:

- **L1 is automatic.** iMonitor detects enabled conditions, creates one incident, groups related observations, captures evidence, runs bounded read-only checks, and prepares the AI context.
- **L2 is operator-led.** One authorised client or delegated support person claims the work, reviews the evidence, asks AI for guidance, chooses an approved action, and verifies recovery.
- **L3 handles uncertainty and risk.** A specialist investigates recurrence, records the root cause and workaround, reviews known problems, and turns successful solutions into approved knowledge.
- **Fully autonomous recovery is future scope.** This release does not independently reply to messages, release queues, end jobs, or run corrective commands.

## 2. Before first use

You need:

1. An IBM i host and an operator account that Mapepire can use.
2. The Mapepire port, normally `8076`.
3. Permission from the client owner for the IBM i reads and actions your role needs.
4. Optional provider or integration credentials if your team wants AI, ClickUp, Jira, Slack, email, or SMS delivery.

Start with the **Demo connection** if you are learning the screens. Demo data is safe for practice, but it does not prove that a live IBM i account, command permission, or external integration works.

## 3. Connect to IBM i

### Use a saved profile

1. Open iMonitor.
2. In **Saved systems**, select the profile.
3. Check the system name, host, port, and operator shown in the form.
4. Select **Connect & Monitor**.

### Create a profile

1. Enter a clear **Connection Name**.
2. Enter the **System Address**.
3. Enter the **Mapepire Port**. Leave `8076` unless your Mapepire service uses another port.
4. Enter the IBM i **Username** and **Password**.
5. Select **Save Profile** if you want to reuse it.
6. Select **Connect & Monitor**.

Profiles are stored locally on this computer. The password is protected by the operating system secure-storage facility. Do not send a profile or password in a ticket, chat message, screenshot, or AI prompt.

During connection, iMonitor checks for Mapepire. Depending on the host, it can use an existing service, start an installed copy, or deploy Mapepire through SSH. The current automatic setup expects SSH on port `22`. If the service is not reachable, read the message shown on the connection page before retrying.

### Reconnect safely

After a disconnect, select the same saved profile and reconnect. Reconnection restores the local incident records and history for that system. Reconnection alone does not prove that an IBM i job recovered; wait for a fresh poll and verification result.

## 4. Learn the main screens

### Connect screen

This is where you select or create IBM i profiles. It also shows the current plan, theme control, and support link.

### ActionBoard

This is the daily operator screen. It contains the live connection state, system summary, active jobs, job filters, AI composer, support outcomes, and the separate Job Queues panel.

### Job task window

Selecting a job opens a separate compact task window. The main ActionBoard keeps polling while task windows are open, and more than one job task can remain open.

### Settings

Settings contains four areas: **Alerts**, **IBMEye AI**, **Integrations**, and **Support access**. Alert settings also contain the background collector and business service mappings.

### Object analysis

Object analysis is a separate workspace for RPG or database source. It explains source evidence, dependencies, business logic, program flow, call graph, and conversion readiness.

## 5. Monitor the system

### Read the ActionBoard header

The header shows:

- whether the connection is **Live** or disconnected
- the active system and operator
- the last update time
- **Object analysis**, **Outcomes**, **Settings**, **Disconnect**, and theme controls

The page is healthy only when the connection is live and the update time continues to change. If polling fails, read the status message and use **Retry** or reconnect as directed.

### Read the system cards

The Active Jobs panel places the high-signal cards at the top:

- total active jobs
- peak CPU
- running jobs
- waiting jobs
- latest poll time

These cards describe the current poll. They are not a historical performance report; use **Outcomes** for a date range.

### Use the active jobs list

The **WRKACTJOB · Active Jobs** list is the main work surface. It shows the job, user, subsystem, CPU, business or technical function, and health/state.

Use the controls to:

1. Choose the polling interval: `5 seconds`, `10 seconds`, `30 seconds`, `1 minute`, or **Custom**.
2. For Custom, enter seconds within the allowed range and wait for the polling label to update.
3. Filter by subsystem.
4. Search by job, subsystem, user, function, `MSGW`, `LCKW`, or another visible term.
5. Use the quick filters for running, waiting, `MSGW`, `LCKW`, `DLYW`, and `DEQW`.
6. Use **Focus Next Job** to bring the highest-priority incident into the task workflow.

### Understand “Running” and “Issue” together

A job can be **Running** and still have an issue. Running describes the IBM i job state. An issue badge describes a condition that needs attention, such as high CPU, a lock wait, a message wait, or a queue condition.

For example, `Running + High CPU` means the job is active but consuming more CPU than the configured threshold. It does not mean the job is stopped. Open the row to see the actual condition, evidence, and recommended next check.

If a row shows an owner, that named operator currently has the work claimed. If no owner is shown, the work is available to an authorised operator.

### Use Job Queues

**WRKJOBQ · Job Queues** remains a separate panel below the main workflow.

1. Open the panel.
2. Search by queue, library, job, or user.
3. Filter by **All queues**, **Released**, or **Held**.
4. Expand a queue to inspect waiting jobs and its subsystem.
5. Use a queue action only when the action is available, your permission is active, and the confirmation describes the exact queue or job.

Automatic queue triage only reads queue, waiting-job, and subsystem evidence. It does not release or hold a queue. Queue changes require a separate confirmation and a fresh verification read.

### Review support outcomes

Open **Outcomes** in the ActionBoard header. Choose a **From** and **To** date, then select **Refresh**. The panel shows incident volume, acknowledgement and investigation timing, verified recovery, recurrence, escalation, AI availability, sample sizes, unknown results, and a comparison with the previous equal period.

Use **Export JSON** when a support lead needs a customer-owned report. The report is scoped to the connected system. An operator-verified recovery remains separate from future autonomous recovery.

## 6. Work a job or incident as an L2 operator

Use this sequence when a row shows an issue.

### Step 1: Open the job

Select the job row or choose **Focus Next Job**. The task window opens with the job in context. Do not start by opening a different job or relying on a copied screenshot; the task window keeps the current evidence and identity together.

### Step 2: Read Overview

The **Overview** tab shows the current job state, wait reason, issue summary, owner, and captured evidence. Confirm that the job name, user, subsystem, and issue are the one you intend to work on.

### Step 3: Acknowledge the issue

Choose **Acknowledge** when you have seen the issue. This records awareness in the incident timeline. Acknowledgement does not claim the work and does not change the IBM i job.

### Step 4: Claim the work

Choose **Claim Work** to assign the incident to the current named operator. The owner appears in the task window and in the ActionBoard job row. If ClickUp is configured and available, iMonitor creates or reuses the linked work item from the main workflow.

Do not use a shared operator identity. If you should not own the work, leave it unclaimed or use a handoff.

### Step 5: Read the Actions brief

Open **Actions**. The response brief groups the work into **Respond**, **Investigate**, and **Resolve** and shows:

- technical or business impact
- current owner and workflow status
- business service and deadline when a mapping matches
- the next check
- evidence used to build the recommendation
- routing and runbook guidance

If business context says **Unknown impact**, do not guess the business priority. Ask the client owner to add a mapping in Settings.

### Step 6: Inspect evidence and history

Use **History** for the incident timeline and recent job status changes. Use **Details** to load information only when needed:

- **Load job log** for the selected job’s log
- **Load MSGW context** for the current message identity and queue
- **Resource relationships** for the observed relationship flow and accessible table

Fresh evidence is required before a production action. An old screenshot, an earlier poll, or a successful command submission is not a recovery proof.

### Step 7: Ask the job-scoped AI helper

Open **AI helper** and choose **Job health summary** or **How to resolve**. These buttons use only the selected job, its linked incident, its evidence, status history, and matching approved procedures.

The answer should separate observed facts, interpretation, missing evidence, suggested checks, and approved procedures. Treat the interpretation as advice. Verify every important fact in the task window before acting.

### Step 8: Choose an approved action

Available operations depend on the job state, plan, IBM i permission, incident type, and fresh evidence. Possible actions include:

- **Reply to MSGW** after the current message identity and inquiry queue are checked
- **Hold Job**
- **Release Job**
- **End Job**
- **Inspect Locks**

The action may be unavailable because the plan, permission, evidence, or current state does not allow it. A confirmation and command preview appear before a production mutation. Read the target carefully and confirm only when you intend to run it.

### Step 9: Verify the result

After an action, iMonitor reads the job or queue again. The result is reported as **Recovered**, **Still blocked**, **Failed**, or **Unknown**. If verification is unknown, investigate or hand off; do not report recovery to the business as a fact.

### Step 10: Mark work done and wait for clearing

Choose **Mark Work Done** when your operator work is complete. This records progress; it does not clear the incident. The issue remains visible until monitoring or a manual recheck confirms that the underlying condition is resolved. Remove claim only when the work should return to the queue.

## 7. Use guided recovery and runbooks

When a supported procedure matches, the Actions tab shows **Guided recovery checkpoints**.

1. Read the runbook policy and required evidence.
2. Select **Start runbook**.
3. Complete one checkpoint at a time.
4. Enter the requested values, such as the current MSGW message key, message queue, and approved reply.
5. Select **Run current checkpoint**.
6. Read the independent verification result before continuing.

For MSGW, iMonitor checks the current message identity and inquiry queue and asks for explicit confirmation before sending a reply. A still-blocked result pauses the runbook. An unknown or failed verification escalates it. A runbook never silently retries a production mutation and does not provide automatic rollback.

## 8. Hand off work to another support person

Use the handoff area in **Actions** when the incident needs another operator.

1. Enter the named recipient.
2. Explain why the work needs another operator.
3. List the pending checks.
4. Add a response target if one is useful.
5. Select **Send handoff**.

The current owner remains accountable while the handoff is pending. The recipient opens the same incident and selects **Accept handoff**. Ownership changes only after acceptance, and both events are recorded in History.

If configured, ClickUp receives the handoff and assignee update, Jira receives the workflow comment, and Slack receives the focused notification. A delivery failure does not erase the local handoff. Handoff context stays in the incident workflow; there is no copy or export handoff document in the current release.

## 9. Perform L3 problem management

For recurring or uncertain incidents, the Actions tab can show **Known problem & recurrence**.

1. Select **Track candidate** for a new possible problem, or **Add recurrence** for an existing compatible problem.
2. Confirm the match: same customer system, job, condition, and runtime shape.
3. Record the confirmed **Root cause** and **Workaround / fix**.
4. Add a related ClickUp, Jira, vendor, GitHub, or other ticket when useful.
5. Select **Confirm known problem** only after reviewing the evidence.
6. After the fix is independently verified, select **Mark fix verified**.

A later matching occurrence reopens a resolved problem for review. A similar message on another job or system is not silently grouped.

## 10. Save reusable Resolution Memory

After recovery is verified, use **Save resolution draft** in the Actions tab.

1. Review the symptoms, evidence references, attempts, action, outcome, environment, and operator.
2. Keep the entry as a draft while the information is uncertain.
3. Select **Approve** only when the procedure is reviewed and safe to reuse.
4. Select **Retire** when it is no longer valid.

Approved knowledge is customer- and system-scoped. It is suggested only when the current incident and environment match. AI cannot publish a runbook by itself.

## 11. Practise with Incident replay

**Incident replay** is training mode.

1. Choose a prepared scenario.
2. Choose the response you want to practise.
3. Select **Run replay**.
4. Read the sanitized evidence, passed or blocked checks, and expected result.

Replay is labelled **Training only**. It never calls IBM i and never sends updates to ClickUp, Jira, or Slack.

## 12. Configure IBMEye AI

Open **Settings → IBMEye AI**.

1. Turn on **Enable IBMEye AI**.
2. Choose a provider family.
3. Choose a model that is shown as available or installed.
4. Select **Refresh** if the provider status is stale.
5. Enter the endpoint and API key when the provider requires them.
6. Set the response style, history limit, and default reply style if needed.
7. Select **Save AI Settings**.

The current provider choices are local **Open Models** and hosted adapters for **Codex / OpenAI**, **Claude**, and **Grok / xAI**, subject to plan and configuration. A model that is not configured or unavailable cannot be selected for use.

The small provider and model controls in the ActionBoard and floating IBMEye helper show the currently usable choices. The main composer is monitor-scoped. A task window’s AI helper is job-scoped and must not answer unrelated questions.

AI can explain and recommend. It cannot claim work, create a ticket, send a message reply, change a queue, end a job, or bypass confirmation.

## 13. Configure alerts and notifications

Open **Settings → Alerts**.

### Choose what to watch

Enable only the conditions your team needs:

- High CPU
- MSGW
- LCKW
- DLYW
- DEQW
- Poll failures
- Disconnects

Set the **High CPU threshold** and the number of healthy polls required before recovery when those controls are relevant. Save with **Save Alert Settings**.

### Choose notification channels

Available channels are **Desktop**, **Slack**, **Email**, **Jira**, and **SMS**. Enable a channel here only after its connection is configured. Premium channels remain visible with a clear plan indicator when they are unavailable.

### Configure email

Expand **Email notification setup**, enter the SMTP host, port, security option, sender, and recipients, then save. Use **Send Test Email** only when you are ready to send a real message.

## 14. Configure integrations

Open **Settings → Integrations**. Installed apps appear in the installed section. Available apps appear separately. Select an available app, choose **Install**, enter its configuration, and save; after a successful configuration it appears as installed.

The current catalog provides:

- **ClickUp action tracking:** creates or updates operator work items from the incident workflow. Configure the workspace, space, list, operator, and handoff/accepted statuses.
- **Slack channel alerts:** sends incident and handoff notifications through an Incoming Webhook. Configure the webhook URL and channel label.
- **Jira incident tracking:** creates and tracks incident issues through Jira Cloud REST API. Configure the site, account email, API token, project key, and issue type.
- **Email:** sends alerts through the SMTP setup in Alerts.
- **SMS alerts:** sends messages through a compatible HTTP API. Configure the endpoint, recipients, authentication, body format, templates, and headers.

Use each integration’s **Send Test**, **Create Test Issue**, or equivalent test control carefully; test delivery may contact a real external system. Integration failure does not remove the local incident record.

## 15. Give an outsourced support person limited access

The client owner controls access from **Settings → Support access**.

1. Enter the person’s display name and authenticated operator ID.
2. Enter the exact IBM i system IDs they may access.
3. Choose only the permissions required:
   - **Read:** jobs, alerts, logs, and evidence
   - **Investigate:** AI context, incident workflow, and handoff
   - **Execute:** approved job and queue actions
4. Set an expiry date and time.
5. Select **Create invitation**.

The named operator must accept the invitation before access starts. The client can revoke it at any time. Revocation blocks future reads and actions. Never share a common administrator password. The current desktop release enforces grants locally; a future shared service will extend this across machines.

## 16. Add business service context

Open **Settings → Alerts → Business service mappings**.

1. Enter a business service and owner.
2. Add one or more matching job, resource, queue, or subsystem patterns.
3. Optionally specify systems, alert kinds, timezone, working days, expected start/end, and response deadline.
4. Select **Add mapping**.

Use `*` for a wildcard. More specific mappings win. When no mapping matches, iMonitor shows **Unknown impact** instead of inventing a business priority.

## 17. Keep monitoring after closing the dashboard

Open **Settings → Alerts → Background collector**.

1. Turn on **Keep collecting in the background**.
2. Choose a saved IBM i profile.
3. Set the polling interval in seconds.
4. Set how many days to retain records.
5. Set the storage limit in MB.
6. Optionally enable **Start with this computer**.
7. Select **Save collector settings**.

The collector stores read-only poll snapshots locally for each system. The panel shows its state, last successful write, record count, storage size, and errors. It does not run corrective IBM i actions while the desktop is closed.

To remove collected snapshots, select **Purge all records**, review the record and size preview, and confirm. Purge is permanent and does not delete saved connection profiles.

## 18. Analyse RPG or database source

Open **Object analysis** from the ActionBoard.

### Choose the source

1. Choose **Local directory** to inspect an exported source tree, or **IBM i library** when connected to a live system.
2. Use the ordered library list to control object lookup.
3. Use **Apply for this session** for a temporary list or **Save permanently** to write the setup for future sessions.
4. Select a source file in the loaded source tree.
5. Select **Load source** to read the source, or **Analyze object** to build the report.

If the source tree is empty, confirm the selected directory, library list, connection, and source format. Demo mode uses its bundled source tree; live IBM i source needs a live connection and suitable read permission.

### Read the result

The analysis includes:

- conversion readiness, blockers, review notes, and confirmed evidence
- business logic findings
- program flow steps
- dependency inventory
- a call graph showing the selected program calling other programs, modules, procedures, and subprocedures when those relationships are evidenced
- source signals and conversion actions

The graph is a call graph only. It does not invent a relationship when source or catalog evidence is missing. Use the accessible relationship table when the visual graph is difficult to read.

### Explain, approve, and compile

- **Explain with IBMEye AI** adds an optional evidence-based explanation. Review it as an interpretation, not as source truth.
- **Approve & map report** saves the reviewed report under the source program’s analysis folder and maps it to that program.
- **Compile plan** becomes available after analysis. It generates the dependency order and saves `*.build.json` and `*.cl` under the same `imonitor-analysis` area.
- **Download report** saves the operator-facing report.

Compile plan generation only writes the order and CL commands. It does not execute compilation automatically. Cycles, missing sources, unsupported commands, or uncertain metadata stay visible for manual review.

## 19. Use the macOS widget

The repository includes a native WidgetKit scaffold for a small or medium macOS widget. When the signed native widget is installed and the App Group is configured:

1. Let iMonitor connect and complete at least one poll.
2. Open macOS widget editing and choose the iMonitor widget.
3. Add the small or medium widget to the desktop or Notification Center.
4. Read live/idle state, peak CPU, total/running/waiting jobs, MSGW count, and the top issue or CPU job.
5. Select the widget to open the ActionBoard.

iMonitor writes the latest summary after each poll, but macOS controls when the widget redraws. The widget is not automatically installed by the Electron app; native signing and App Group setup are required.

## 20. Common problems

### The connection fails

Check the host, Mapepire port, IBM i username, password, and SSH availability. If automatic setup reports that Mapepire cannot be started, ask the IBM i administrator to verify the service and port. Reconnect only after correcting the reported cause.

### The page shows no jobs

Confirm that the connection is live, monitoring is started, and the subsystem, status, or search filters are not hiding all rows. Clear the search and choose **All**. Check the last poll status.

### A running job also shows an issue

This is expected when the job is active but has a condition such as high CPU or a lock wait. Open the row and read the issue summary and evidence.

### AI has no usable model

Open **Settings → IBMEye AI**, enable a provider, refresh provider status, choose an available model, and save. Hosted providers also need a valid endpoint or API key. The composer will not offer an unavailable model.

### An action is disabled

The plan, current job state, IBM i permission, support grant, evidence freshness, or required confirmation may prevent the action. Read the task message. AI advice cannot unlock a restricted action.

### The issue does not disappear after work is done

**Mark Work Done** records the operator’s work. Monitoring must observe the underlying condition as clear before the incident is removed from the active issue view.

### Source is not loading

Select a source from the left tree, confirm that the selected directory or IBM i library is correct, and check the active library list. Local analysis needs readable source files. IBM i analysis needs a live connection and source permission.

### Notifications or tickets are missing

Check that the integration is installed, configured, enabled in **Alert delivery & watch rules**, and allowed by the current plan. Use the integration test control, then read its status. A provider failure is recorded separately from the local incident.

## 21. Safety and data rules

- Treat demo results as practice evidence, not live IBM i validation.
- Verify the system, job, message, queue, and operator before every production action.
- Never share passwords, API keys, or administrator identities.
- AI suggestions are advisory and may be incomplete.
- A command accepted by IBM i is not the same as verified recovery.
- Training replay never touches production.
- Customer incident records and approved knowledge stay scoped to the connected system.
- Background collection is read-only and can be purged only after confirmation.

## 22. Quick glossary

- **ActionBoard:** the main iMonitor screen for active jobs, issues, AI, outcomes, and queues.
- **WRKACTJOB:** IBM i active-job information shown in the main job list.
- **WRKJOBQ:** IBM i job-queue information shown in the separate queue panel.
- **MSGW:** message wait; a job is waiting for a message response.
- **LCKW:** lock wait; a job is waiting for a resource lock.
- **DLYW:** delay wait.
- **DEQW:** dequeue wait.
- **Mapepire:** the service boundary iMonitor uses to communicate with IBM i.
- **Incident:** the durable record for an operator-impacting condition, its evidence, owner, actions, and timeline.
- **Runbook:** a reviewed sequence of checks, an approved action, and independent verification.
- **Resolution Memory:** customer-scoped verified knowledge that can help with a matching future incident.
- **UAT:** user acceptance testing against the intended environment and operator workflow.

## 23. Getting help

Use the support area in the footer to contact support or send encrypted diagnostics. Tell support whether the problem occurred with the Demo connection or a live IBM i system, and include the visible status message, system label, time, and affected job if safe to share. Do not include passwords, API keys, or unredacted logs.
