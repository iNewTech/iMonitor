# IBMEye

IBMEye is a desktop operator app for IBM i teams. It connects to a system through Mapepire, watches active jobs, shows alerts such as `MSGW`, `LCKW`, and high CPU, and keeps a visible operator log so the user can see what the app is doing.

## What The App Does

- Connects to IBM i systems through Mapepire
- Auto-starts live monitoring after connect
- Shows active job health, waits, CPU, and SQL details
- Raises operator alerts and desktop notifications
- Keeps a local operator log and daily log files
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
3. IBMEye will:
   - check whether Mapepire is already running
   - start it if it is installed but stopped
   - deploy it if it is missing
   - connect and open the monitor
4. Watch the action bar below the button for the current step.

## Demo Mode

Use `Launch Demo` to open a local test system with generated jobs, waits, alerts, and logs.

This is only available in development builds. Packaged production builds do not expose demo mode and will ignore demo connection requests.

## Logs

IBMEye writes:

- a readable daily log: `ibm-eye-YYYY-MM-DD.log`
- a structured daily log: `ibm-eye-YYYY-MM-DD.log.jsonl`

These are stored in the app logs directory and can be opened from the monitor screen.

## Project Notes

- User guide and setup notes: [docs/FEATURES.md](docs/FEATURES.md)
- Technical developer guide: [docs/TECHNICAL.md](docs/TECHNICAL.md)
- Architecture overview: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Alert workflow notes: [docs/ALERT_WORKFLOW.md](docs/ALERT_WORKFLOW.md)
- Mapepire setup notes: [docs/MAPEPIRE_SETUP.md](docs/MAPEPIRE_SETUP.md)
- Change log: [CHANGELOG.md](CHANGELOG.md)
