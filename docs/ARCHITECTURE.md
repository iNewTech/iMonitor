# Architecture

## High-Level Flow

1. User fills the connection form.
2. Renderer sends `connect-to-system` through preload.
3. Main process checks whether Mapepire is:
   - already running
   - installed but stopped
   - missing
4. Main process starts or deploys Mapepire as needed.
5. Main process opens the IBM i session through Mapepire.
6. Monitor page starts polling active job data.
7. Alerts, history, and logs update from each poll.

## Main Data Areas

### Connection state

- current session
- saved profiles
- current resolved Mapepire port

### Monitoring state

- latest jobs
- job status history
- monitoring history snapshots

### Alert state

- active and resolved alerts
- dismissed alerts
- notification cooldown tracking

### Logging state

- in-memory operator log for UI
- readable daily log file
- structured daily `.jsonl` log file

## Module Direction

Feature logic should live in dedicated modules:

- `features/alerts`
- `features/monitoring`
- `utils/mapepire-*`

This keeps business rules separate from Electron wiring.
