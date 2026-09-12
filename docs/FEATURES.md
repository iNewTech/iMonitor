# iMonitor feature access

iMonitor uses a simple Free/Premium feature boundary. The application keeps Premium controls visible so users can understand what is available, but protected operations are disabled until Premium is active.

## Current experience

- One active-job workspace with filters, issue labels, owner names, and priority focus.
- Deterministic incident correlation groups related signals for the same job within a five-minute window and shows a priority score with the reasons behind it.
- Separate job task windows with workflow actions, AI guidance, and history.
- Respond, Investigate, and Resolve brief with impact, owner, next check, evidence, and a compact L2/L3 handoff workflow.
- Explainable routing recommendations match active support grants to incident skills, system scope, permission, availability, and support windows, with an SLA state beside the suggested owner.
- Job AI helpers grounded to the selected job and its linked incident only.
- Timestamped incident evidence for the trigger job, job log, messages, queue, and subsystem, with visible missing or permission statuses.
- Evidence-backed resource relationships in the job Details tab, with compact flow and accessible table views for incidents, jobs, queues, subsystems, message waits, and lock owners.
- Customer-owned business service mappings with deterministic precedence, owner, timezone-aware operating window, and deadline-risk context in the task response.
- Customer-scoped Resolution Memory turns an incident investigation into a draft procedure. Operators can explicitly approve, retire, retrieve, and export versioned knowledge for the connected system; it is never added to a shared pool by default.
- Compact AI composer with provider/model availability checks.
- Job queues remain in their own section below the main workspace.
- Client-controlled background collector for read-only monitoring, per-system local snapshots, retention, inventory, health, and confirmed purge.
- Local and IBM i source analysis, evidence-based call graphs, approved reports mapped to source programs, and saved compile plans. Compile commands are never run automatically.
- A macOS WidgetKit scaffold is available under `macos-widget/`; signing and native installation remain separate from the Electron app.

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
