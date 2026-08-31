# Features

`iMonitor` is the complete desktop application. `IBMEye` provides monitoring and incident detection, `IBMEye AI` provides analysis and guidance, and `iMonitor ActionBoard` is the operator workspace for taking and tracking action.

## Current Features

### Connection

- saved IBM i profiles
- local credential protection
- one-click connect
- development-only demo launch mode
- auto Mapepire detect/start/deploy during connect

### Monitoring

- active jobs table
- live refresh interval control
- peak CPU, running jobs, waiting jobs summary
- local AI analyst panel for alert and log analysis
- job details drawer
- root-cause guidance in job details
- SQL detail display
- hold, release, and end-job actions from the drawer

### Alerts

- `IBMEye Alerts` module inside `iMonitor`
- MSGW alerts
- LCKW alerts
- DLYW alerts
- DEQW alerts
- high CPU alerts
- failed poll alerts
- desktop notifications
- SMTP email notifications
- Slack channel alert notifications through an Incoming Webhook
- test email action from the monitor screen
- sticky queue with active and resolved alerts
- clear alert action

### Logs

- `iMonitor Logs`
- operator activity log
- share operator log
- download operator log
- open logs folder
- daily readable and structured logs
- structured poll history foundation for future cross-session replay

### Alert action tracking

- no ClickUp task is created when an alert first appears
- `Start Work` creates one ClickUp task for the incident
- the task is assigned to the operator who starts work
- one task reference is retained per incident
- AI diagnostic comment with issue, cause, and resolution guidance
- current readable daily log attached to the task
- later notes and workflow changes are synced as comments
- failures recorded locally without removing the ClickUp task

### Slack channel alerts

- encrypted per-operator webhook settings
- one shared channel destination per configured webhook
- all supported alert types enabled by default
- one structured Slack message per new alert
- independent routing rules for each alert type
- test delivery action from Settings
- asynchronous delivery that does not block polling

### Support

- one-click support diagnostics bundle
- support contact and diagnostics actions available before login
- read-only monitor and job investigation surfaces
- guided cause, impact, and next-step help for common failures

## Development-Only Features

- Demo mode uses generated JSON snapshots instead of live IBM i SQL calls
- Demo runtime controls live separately from production connection logic so the feature can be removed cleanly from packaged builds

## Planned Feature Track

### 1. Alert-to-action workflow

- acknowledge
- in progress
- resolve
- notes
- operator timeline

### 2. Historical incident timeline

- reconstruct history from structured logs
- trend and incident replay
- parser and reconstruction helpers already added, UI still pending

### 3. IBM i operator actions

- hold, release, and end job are implemented
- reply to MSGW is pending message-level context
- lock investigation UI is pending

### 4. Root cause hints

- drawer guidance is implemented for waits and high CPU
- poll and disconnect guidance model is added
- broader monitor-surface guidance is still pending

### 5. Team audit trail

- operator attribution
- incident exports
