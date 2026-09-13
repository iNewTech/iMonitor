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
2. In **Saved system**, select the profile.
3. Check the system name and the operator, address, and port shown underneath. Connection fields stay collapsed until you select **Edit**.
4. Select **Connect & Monitor**.

### Create a profile

1. Select **Add another system**, then enter a clear **Connection Name**. With no saved profiles, the form opens automatically.
2. Enter the **System Address**.
3. Enter the **Mapepire Port**. Leave `8076` unless your Mapepire service uses another port.
4. Enter the IBM i **Username** and **Password**.
5. Select **Save Profile** if you want to reuse it.
6. Select **Connect & Monitor**.

**Edit** lets you rename the profile or update its connection details. **Update Profile** keeps the same profile identity; it does not create a second system. **Cancel** restores the saved values. **Delete** removes the selected local profile. If profiles fail to load, select **Retry loading profiles**; a connection failure leaves your entries available for retry.

Profiles are stored locally on this computer. The password is protected by the operating system secure-storage facility. Do not send a profile or password in a ticket, chat message, screenshot, or AI prompt.

During connection, iMonitor checks for Mapepire. Depending on the host, it can use an existing service, start an installed copy, or deploy Mapepire through SSH. The current automatic setup expects SSH on port `22`. If the service is not reachable, read the message shown on the connection page before retrying.

### Reconnect safely

After a disconnect, select the same saved profile and reconnect. Reconnection restores the local incident records and history for that system. Reconnection alone does not prove that an IBM i job recovered; wait for a fresh poll and verification result.

## 4. Learn the main screens

### Connect screen

This is where you select or create IBM i profiles. The form stays compact on a large screen. Plan, theme, version, and pre-connection Support remain available. Workspace navigation appears only after connecting. ActionBoard, Knowledge, and Settings require an active IBM i connection; disconnecting returns you to Connect.

### Knowledge

Knowledge is the local operations library for the connected IBM i system. It holds runbooks, incident evidence, approved resolutions, job context, object-analysis notes, and customer guides. It is scoped to the active system, so connect before opening it.

Knowledge answers show where supporting evidence came from and whether it is current. iMonitor also checks its retrieval and AI grounding rules against known IBM i support examples during each development release. This keeps an unknown condition, stale procedure, conflicting guidance, or evidence containing unsafe instructions visible for review instead of treating it as a trusted answer.

To add a source, select **Knowledge → Add knowledge**, enter a short name and type, then paste the text or choose a supported text file. Save only after reviewing the content. iMonitor accepts text, Markdown, JSON, CL, CLLE, RPG/RPGLE, SQL, and CSV files up to 200 KB from the screen. Credentials, bearer tokens, and connection-shaped values are removed before the source is stored.

The library shows one row per source even when the source is stored as several operational chunks. Search by job, message ID, object, queue, CL command, runbook, or symptom. Exact IBM i identifiers are prioritised when they are present; semantic matching can add similar evidence when a configured vector provider is available. Results carry short relevance reasons and stable citations inside the job or incident conversation. When an AI response has sources, select a source chip below the response to see its status, observation time, scope, provenance, and a bounded excerpt. Stale sources are labelled for verification; a deleted or inaccessible excerpt is shown as unavailable. Select **Needs review** to focus on observed, draft, stale, or unknown sources. Select a row to read the stored context and see its source history. **Refresh index** rebuilds the local search state. **Delete source** removes the source and all of its stored chunks after the main process checks your permission.

Select **Knowledge → Analyze code** when you need object analysis, a call graph, a conversion plan, or a compile plan. Analysis remains a separate, secondary workflow so the knowledge library stays small and easy to scan.

The AI + ActionBoard foundation records the scope and provenance rules that knowledge search uses. Operational evidence must identify both the customer and IBM i system. Every knowledge read is checked in the main process against the connected scope and the current operator's permission. Client owners can read their active system; outsourced support must use an accepted, unexpired grant for that customer and system. Records outside that boundary are removed before search and again before the result reaches AI or the screen. Stale evidence is labelled for verification and draft evidence is labelled for review. The local knowledge store keeps a rebuildable copy and still supports exact keyword search if a vector service is unavailable; the current status is shown as ready, rebuilding, degraded, or unavailable.

To review storage, open **Settings → AI & knowledge → Knowledge storage**, then choose **Manage**. Local lexical index is the first-use option and works offline for exact IBM i identifiers. The screen shows the active adapter and retrieval health, lets you test local retrieval, and keeps the provider key protected. Qdrant and Postgres + pgvector are shown only as future options until their adapters are installed, so they cannot be selected accidentally. If a configured provider later becomes unavailable, iMonitor keeps the job list and local keyword retrieval usable and reports degraded retrieval health.

### ActionBoard

This is the daily operator screen. It contains the live connection state, a slim system strip, one active-jobs list, job filters, and a compact AI composer. Job Queues stays collapsed below the list. Less frequent tools open from the **⋯** workspace menu.

### Job task window

Selecting a job opens a separate compact task window. The main ActionBoard keeps polling while task windows are open, and more than one job task can remain open.

The task window has two persistent tabs: **Overview** and **History**. Overview keeps the current issue, job facts, owner, response stage, AI helpers, workflow actions, and runbook context together. Expand **Technical details** only when you need logs, messages, or resource relationships. Use **History** for detection, evidence, ownership, AI, handoff, action, and recovery events.

When an incident is unassigned, **Claim Work** assigns it to the current operator. After claiming, the window shows the owner and the next investigation step. AI helpers stay inside the selected job context. Handoff, linked ticket, work completion, claim removal, and eligible IBM i operations remain available in the compact action area. A job operation is not treated as recovery until a fresh monitoring check confirms the expected state.

### Settings

Settings is organized into seven compact categories:

- **General:** active connection, theme, and plan summary.
- **Monitoring:** alert rules, notification channels, and business service mappings.
- **AI & knowledge:** provider and model setup.
- **Integrations:** installed and available ClickUp, Slack, Jira, Email, and SMS connections.
- **Skills & MCP:** the reserved home for reviewed skills and scoped MCP connections.
- **Access:** client-controlled support invitations, permissions, and revocation.
- **Storage:** the entry point for background collection, retention, inventory, and purge controls.

Only the selected category is shown. Category changes keep unsaved form values in the current page session; save a form before leaving the app if you want the change to persist.

### Object analysis

Object analysis is a separate workspace for RPG or database source. It explains source evidence, dependencies, business logic, program flow, call graph, and conversion readiness.

### Moving between workspaces

Moving between ActionBoard, Knowledge, and Settings keeps the IBM i connection and monitoring active. Returning to the board restores its selected job, filters, scroll position, and unsent AI input for the same profile/operator during this app-window session. Independent task windows stay open. An AI reply in progress finishes before the main navigation allows you to leave. Profile passwords are kept out of browser storage; only the existing protected profile store persists them. Closing the app ends the temporary board draft.


## 5. Monitor the system

### Read the system strip

The top strip shows the connection state, saved system name, **Peak job CPU**, active-job count, and work needing attention. Peak job CPU is the highest CPU value among active jobs, not total system CPU. The observation time and polling interval are below the table. Check that observation time continues to advance; changing filters does not make old data look new.

**Settings** and the theme control stay in the header. The **System activity → Live activity overview** opens above the jobs list after connecting, with live Job volume, Peak job CPU and Wait states charts. Select its heading to collapse or expand it; polling continues while collapsed. Reconnecting opens it again. Open **⋯** for Object analysis, Support outcomes, Incident history, the optional floating IBMEye, or Disconnect. **Knowledge** opens a clearly marked library placeholder with **Analyze code** for the existing source browser, graphs, compile plans, and reports. Search and ingestion will arrive in later tickets; existing Resolution Memory remains available in job tasks.

### Use the active jobs list

The four columns show **Job**, **Current condition**, **CPU**, and **Owner**. The job's subsystem and function appear under its name; open the job for its full identity, technical user, evidence, and actions.

1. Search by job, subsystem, user, function, status code, or owner. Direct matches take precedence; typo-tolerant search is used when there is no direct match.
2. Use **All jobs** to select Needs attention, High CPU, Running, or a specific wait state.
3. Select **My work** to show incidents owned by the connected operator; it combines with the other filters.
4. Open the **sliders** menu for subsystem filtering, polling intervals, **Custom seconds** (2–3600), **Pause/Resume**, and Comfortable/Compact row spacing.
5. Select **Focus next** to open the highest-priority job, clearing conflicting filters.
6. Select a row, or focus it with the keyboard and press Enter or Space, to open its independent task window.

The list scrolls inside its own area. Polling preserves keyboard focus, selected job, view filters, and your AI draft. Search, filters, density, selection, and scroll position also survive navigation or reconnect to the same profile during the app session. Incident ownership, notes, and history continue to use durable storage and survive app restarts.

### Read the current condition

An incident row names its actual condition, such as **High CPU**, **Message wait**, or **Lock wait**. High CPU can occur while the job executes; its technical Running state is available in task details. The board avoids presenting that as a second healthy-looking badge.

If the observed state has changed but recovery is not verified, the row says so. Monitoring-confirmed recovery still controls incident removal. An owner names the operator responsible for that work; **Unassigned** indicates an active incident without an owner, and **—** indicates no linked active incident.

### Ask IBMEye from the board

Write in the full-width input below the jobs list. It grows for longer questions. **Enter** sends; **Shift+Enter** inserts a new line. The **+** menu holds the existing incident summary, shift handoff, SQL activity, and job-health prompts.

The lower-left context label names the system or selected job. Opening a job selects it for AI; click its context label to return to the whole system. Job-scoped requests use the same backend scope checks as the job helper. The compact model label opens provider/model choices and **Configure AI**. Unavailable providers/models cannot be selected; configure them in Settings first. Setup and request failures remain visible.

The conversation appears after a question and can be hidden or shown without losing the messages. Routine provider-ready messages do not occupy the idle composer. The floating chatbot is optional: **⋯ → Show floating IBMEye** opens the existing quick chat, and **Hide floating IBMEye** removes it from view. Both chat surfaces share the conversation. AI helpers inside job tasks remain available.

The footer reports monitoring health and background collection separately. **Background collection off** means the collector is not running; clicking it opens Settings. Closing the window only continues collection when that feature is configured and enabled.

### Use Job Queues

**WRKJOBQ · Job Queues** remains a separate panel below the main workflow.

1. Open the panel.
2. Search by queue, library, job, or user.
3. Filter by **All queues**, **Released**, or **Held**.
4. Expand a queue to inspect waiting jobs and its subsystem.
5. Use a queue action only when the action is available, your permission is active, and the confirmation describes the exact queue or job.

Automatic queue triage only reads queue, waiting-job, and subsystem evidence. It does not release or hold a queue. Queue changes require a separate confirmation and a fresh verification read.

### Review support outcomes

Open **⋯ → Support outcomes** in the ActionBoard header. Choose a **From** and **To** date, then select **Refresh**. The panel shows incident volume, acknowledgement and investigation timing, verified recovery, recurrence, escalation, AI availability, sample sizes, unknown results, and a comparison with the previous equal period.

Use **Export JSON** when a support lead needs a customer-owned report. The report is scoped to the connected system. An operator-verified recovery remains separate from future autonomous recovery.

## 6. Work a job or incident as an L2 operator

Use this sequence when a row shows an issue.

### Step 1: Open the job

Select the job row or choose **Focus next**. The task window opens with the job in context. Do not start by opening a different job or relying on a copied screenshot; the task window keeps the current evidence and identity together.

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

Open **AI helper** and choose **Job health summary** or **How to resolve**. These buttons use only the selected job, its linked incident, its evidence, status history, and matching scoped knowledge. The response shows observed facts, matching evidence, interpretation, missing evidence, suggested checks, an approved procedure when available, and the next safe action. The source strip also shows retrieval health and stale or unavailable evidence.

The answer should separate observed facts, matching evidence, interpretation, missing evidence, suggested checks, an approved procedure, and the next safe action. Treat the interpretation as advice. Verify every important fact in the task window before acting. If the knowledge status is stale, degraded, or unavailable, use the live job evidence and confirm the condition before relying on a stored procedure.

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

Open **Settings → AI & knowledge**.

1. Turn on **Enable IBMEye AI**.
2. Choose a provider family.
3. Choose a model that is shown as available or installed.
4. Select **Refresh** if the provider status is stale.
5. Enter the endpoint and API key when the provider requires them.
6. Set the response style, history limit, and default reply style if needed.
7. Select **Save AI Settings**.

The current provider choices are local **Open Models** and hosted adapters for **Codex / OpenAI**, **Claude**, and **Grok / xAI**, subject to plan and configuration. A model that is not configured or unavailable cannot be selected for use.

Click the compact model label below the ActionBoard input to choose a currently usable model or open Configure AI. A job selected in the board supplies job scope; click the context label to return to system scope. A task window’s AI helper always uses job scope and must not answer unrelated questions.

AI can explain and recommend. It cannot claim work, create a ticket, send a message reply, change a queue, end a job, or bypass confirmation.

## 13. Configure alerts and notifications

Open **Settings → Monitoring**.

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

The client owner controls access from **Settings → Access**.

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

Open **Settings → Monitoring → Business service mappings**.

1. Enter a business service and owner.
2. Add one or more matching job, resource, queue, or subsystem patterns.
3. Optionally specify systems, alert kinds, timezone, working days, expected start/end, and response deadline.
4. Select **Add mapping**.

Use `*` for a wildcard. More specific mappings win. When no mapping matches, iMonitor shows **Unknown impact** instead of inventing a business priority.

## 17. Keep monitoring after closing the dashboard

Open **Settings → Storage**, then select **Manage collector**.

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

Open **⋯ → Object analysis** from the ActionBoard.

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

Open **Settings → AI & knowledge**, enable a provider, refresh provider status, choose an available model, and save. Hosted providers also need a valid endpoint or API key. The composer will not offer an unavailable model.

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
