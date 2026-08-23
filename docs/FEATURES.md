# Features

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
- job details drawer
- SQL detail display

### Alerts

- MSGW alerts
- LCKW alerts
- high CPU alerts
- failed poll alerts
- desktop notifications
- sticky queue with active and resolved alerts
- clear alert action

### Logs

- operator activity log
- share operator log
- download operator log
- open logs folder
- daily readable and structured logs

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

### 3. IBM i operator actions

- job control
- reply to MSGW
- lock investigation

### 4. Root cause hints

- explain waits and likely causes
- recommended next steps

### 5. Team audit trail

- operator attribution
- incident exports
