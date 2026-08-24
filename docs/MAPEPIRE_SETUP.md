# Mapepire Setup Logic

## Current Connect Flow

When the user clicks `Connect Now`, iMonitor now:

1. checks whether Mapepire is already reachable on the requested or fallback ports
2. if reachable, uses that service
3. if not reachable, opens SSH to the IBM i host
4. checks whether Mapepire is already installed
5. starts the installed copy if present
6. if missing, deploys Mapepire
7. verifies the final port
8. opens the IBM i session

## Current Deployment Modes

### Existing

- already running service
- no deployment needed

### RPM

- uses `/QOpenSys/pkgs/bin/mapepire`
- chosen when RPM install already exists
- preferred when `yum` is available

### Manual

- uses `/opt/mapepire/bin/mapepire`
- used when RPM tooling is not available

## Port Logic

- preferred port comes from the connection form
- if default `8076` is busy, iMonitor tries `+10` increments
- the resolved port is sent back to the connection form

## Current Limitation

- auto-setup currently assumes SSH port `22`
- a future advanced option can expose custom SSH port again without a large visible wizard
