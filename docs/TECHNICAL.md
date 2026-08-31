# Technical Guide

## Stack

- Electron
- TypeScript for main and preload
- Plain JavaScript for renderer pages
- Bootstrap for UI primitives
- `electron-store` for local app state
- `nodemailer` for SMTP email delivery
- `ssh2` for remote Mapepire setup actions

## Run Commands

```bash
npm install
npm start
```

Other commands:

```bash
npm run build
npm test
npm run docs:api
```

## Current Source Layout

```text
src/
  features/
    alerts/
      alert-model.ts
      alert-operator-workflow.ts
      alert-workflow.ts
    demo/
      demo-runtime.ts
    guidance/
      root-cause-guidance.ts
    history/
      history-model.ts
    monitoring/
      monitoring-model.ts
    notifications/
      email-notification.ts
    operator-actions/
      operator-actions.ts
    theme/
      theme-model.ts
  services/
    ibmi.ts
  utils/
    connections.ts
    crypto.ts
    demo-system.ts
    mapepire-deploy.ts
    password-store.ts
  main/
    ipc/
      alerts-ipc.ts
      connection-ipc.ts
      jobs-ipc.ts
      logs-ipc.ts
      navigation-ipc.ts
    runtime/
      email-notification-runtime.ts
      logging-runtime.ts
      monitoring-runtime.ts
      session-runtime.ts
    state/
      alert-state.ts
      connection-state.ts
      monitoring-state.ts
    window/
      window-runtime.ts
    store.ts
    types.ts
  main.ts
  preload.ts
```

## Main Process Responsibilities

- `src/main.ts` is the composition root for the `iMonitor` app
- `src/main/ipc/*` owns Electron IPC registration
- `src/main/runtime/session-runtime.ts` owns saved connections, Mapepire setup, connect, and disconnect
- `src/main/runtime/monitoring-runtime.ts` owns poll cadence, demo polling, snapshots, and failure handling
- `src/main/runtime/email-notification-runtime.ts` owns SMTP email delivery, cooldowns, and test-email sends
- `src/main/runtime/logging-runtime.ts` owns in-memory activity events and daily persistent logs
- `src/main/state/*` owns short-lived in-memory connection, alert, and monitoring state
- `src/main/window/window-runtime.ts` owns the Electron window lifecycle and page navigation

## Preload Responsibilities

- safe API bridge between renderer and main
- no business logic

## Renderer Responsibilities

- page rendering
- button handlers
- showing current connection action status
- alert and monitor interactions
- job drawer guidance and operator action UI
- ActionBoard operator actions and structured audit records

## Documentation Model

- Markdown in `docs/` for human guides
- JSDoc on exported TypeScript functions for generated API docs
- TypeDoc configuration in `typedoc.json`
- themed docs home and technical guide live in `docs/index.html` and `docs/technical.html`

## Current Feature Foundations

- `src/features/operator-actions/operator-actions.ts` builds supported IBM i job action plans
- `src/features/history/history-model.ts` parses structured `.jsonl` records and rebuilds history trends
- `src/features/guidance/root-cause-guidance.ts` generates operator-facing cause and next-step guidance
- `src/features/notifications/email-notification.ts` normalizes SMTP settings and builds outbound email messages for `IBMEye Alerts`

## Demo Mode Boundary

- `src/features/demo/demo-runtime.ts` decides whether demo mode is available at runtime
- `src/utils/demo-system.ts` contains the generated snapshot writer and reader
- packaged production builds disable demo requests and the renderer removes the demo button

## Current Refactor Focus

- keep `session-runtime.ts` shrinking as new delivery channels like email notifications are added
- continue moving renderer page logic into smaller feature modules
- extend job detail fetches with IBM i message-level context for real `MSGW` replies
- add direct unit coverage around extracted main-process modules
