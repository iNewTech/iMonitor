# iMonitor

iMonitor is the desktop app for IBM i teams. Inside it, `IBMEye` is the alert and watch module that tracks conditions such as `MSGW`, `LCKW`, high CPU, and failed polls while iMonitor keeps connection, monitoring, and logs in one operator surface.

## What The App Does

- Connects to IBM i systems through Mapepire
- Auto-starts live monitoring after connect
- Shows active job health, waits, CPU, and SQL details
- Shows root-cause guidance in the job detail drawer
- Includes an Ollama-backed IBMEye AI analyst on the ActionBoard for alert, SQL, and selected-job analysis
- Includes a dedicated Settings page for AI providers and action integrations
- Supports drawer-based operator actions for hold, release, and end job
- Raises operator alerts, desktop notifications, and SMTP email notifications
- Keeps detailed developer diagnostics out of the operator UI
- Can detect, start, or deploy Mapepire during connect
- Includes a development-only demo system for UI testing without real credentials

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Start the app

```bash
npm start
```

### 3. Use the app

1. Enter a connection name, system address, user, password, and Mapepire port.
2. Click `Connect Now`.
3. iMonitor will:
   - check whether Mapepire is already running
   - start it if it is installed but stopped
   - deploy it if it is missing
   - connect and open the monitor
4. Watch the action bar below the button for the current step.

## Demo Mode

Use `Launch Demo` to open a local test system with generated jobs, waits, alerts, and monitoring history.

This is only available in development builds. Packaged production builds do not expose demo mode and will ignore demo connection requests.

## Logs And Diagnostics

The operator sees only a small status bar for monitoring health. Detailed application activity is kept in the main process and written to encrypted daily developer logs using Electron's local secure storage. There is no renderer bridge for reading, downloading, or opening those logs.

The Support menu creates a separate encrypted diagnostics file containing app metadata, monitoring summaries, and recent developer activity. Credentials are redacted before the file is encrypted. A support public key must be configured as `IMONITOR_SUPPORT_PUBLIC_KEY`; the corresponding private key remains with the application developer.

## Email Notifications

The iMonitor ActionBoard includes SMTP email notification settings for `IBMEye Alerts`.

You can:

- enable or disable alert emails
- set SMTP host, port, secure mode, username, and password
- set sender and recipient addresses
- send a test email before relying on it during incidents

Alert-triggering conditions such as `MSGW`, `LCKW`, high CPU, failed polls, and disconnects can now send email when the alert itself is enabled and the SMTP settings are valid.

## Alert Tickets And Diagnostics

`IBMEye Alerts` sends newly detected alerts to the configured Slack channel. ClickUp is an action-tracking destination, not an automatic alert sink: no ClickUp task is created when an alert first appears.

When an operator selects `Start Work`, iMonitor creates one ClickUp task for that incident, assigns it to the active operator, and links it back to the alert. The backend then adds an AI-generated diagnostic with the issue, likely cause, and resolution guidance, and attaches only the matching job history when captured history exists. If a task already exists, later workflow updates are added as comments instead of creating duplicates.

If AI or job-history attachment is unavailable, iMonitor keeps the ClickUp task and records the failure in encrypted developer diagnostics instead of losing the incident.

## AI Analysis

The `IBMEye Watch` area on the dashboard now includes a local AI analyst panel.

It can:

- summarize current alerts
- explain selected-job waits
- review recent SQL and diagnostic activity
- suggest likely cause and next best action

For now this uses local Ollama on `http://127.0.0.1:11434`. The feature is intentionally isolated so it can be licensed or removed later without changing the rest of iMonitor.

Use `Settings` to switch the active AI provider, choose that provider's model, and save its required setup values in one place. The dashboard keeps the chat and AI actions, while setup now lives off the main monitor screen.

## ClickUp Action Tracking

The new `Settings` page also includes ClickUp setup for action tracking.

You can:

- save one ClickUp token locally
- choose the workspace, space, and list used for alert tasks
- start work on an alert to create one assigned task
- keep later operator notes and workflow updates synced as ClickUp comments
- open the linked ClickUp task from the alert
- add AI diagnostic comments and the current readable log to the task created when work starts

## Slack Channel Alerts

`iMonitor` can send new `IBMEye Alerts` to one shared Slack operations channel through an Incoming Webhook. The webhook is connected to its channel in Slack, so the app does not need to select or message an individual user. Slack settings are saved per local operator.

In `Settings`, paste the webhook URL and channel label in the Slack card, then enable Slack in the `IBMEye Alerts` notification channels. The alert conditions enabled in that shared panel are the single source of truth for Desktop, Slack, and Email delivery. Use `Send Test` to verify the connection. Repeated polls for the same active condition are not sent repeatedly.

## Support Tools

The Support menu is available even before login. `Contact Only` opens a normal email draft. `Contact + Send Encrypted Diagnostics` creates a support bundle containing the app version, platform details, connection context, recent monitor snapshots, and developer activity. The bundle is encrypted for the application developer before it is written to disk.

The ActionBoard and job detail drawer are read-only for investigation until an operator deliberately chooses an IBM i action. Built-in guidance explains likely causes, impact, and safe checks for waits, high CPU, poll failures, and connection failures.

## Current Operator Actions

The job detail drawer currently supports:

- `Hold Job`
- `Release Job`
- `End Job`

These actions are recorded in encrypted developer diagnostics. In demo mode they are simulated safely for UI and workflow testing.

`Reply to MSGW` and deeper lock investigation are the next actions to finish and need additional IBM i message and lock context.

## Project Notes

- User guide and setup notes: [docs/FEATURES.md](docs/FEATURES.md)
- Technical developer guide: [docs/TECHNICAL.md](docs/TECHNICAL.md)
- Architecture overview: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Alert workflow notes: [docs/ALERT_WORKFLOW.md](docs/ALERT_WORKFLOW.md)
- Mapepire setup notes: [docs/MAPEPIRE_SETUP.md](docs/MAPEPIRE_SETUP.md)
- Change log: [CHANGELOG.md](CHANGELOG.md)
