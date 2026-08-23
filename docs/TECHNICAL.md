# Technical Guide

## Stack

- Electron
- TypeScript for main and preload
- Plain JavaScript for renderer pages
- Bootstrap for UI primitives
- `electron-store` for local app state
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
      alert-workflow.ts
    demo/
      demo-runtime.ts
    monitoring/
      monitoring-model.ts
  services/
    ibmi.ts
  utils/
    connections.ts
    crypto.ts
    demo-system.ts
    mapepire-deploy.ts
    password-store.ts
  main.ts
  preload.ts
```

## Main Process Responsibilities

- owns connection lifecycle
- owns Mapepire detect/start/deploy flow
- owns demo-mode gating for development vs packaged builds
- owns alert state, monitoring state, and persistent logs
- exposes renderer APIs through IPC

## Preload Responsibilities

- safe API bridge between renderer and main
- no business logic

## Renderer Responsibilities

- page rendering
- button handlers
- showing current connection action status
- alert and monitor interactions

## Documentation Model

- Markdown in `docs/` for human guides
- JSDoc on exported TypeScript functions for generated API docs
- TypeDoc configuration in `typedoc.json`

## Demo Mode Boundary

- `src/features/demo/demo-runtime.ts` decides whether demo mode is available at runtime
- `src/utils/demo-system.ts` contains the generated snapshot writer and reader
- packaged production builds disable demo requests and the renderer removes the demo button

## Next Refactor Targets

- split `src/main.ts` into:
  - `src/main/ipc`
  - `src/main/store`
  - `src/main/services`
- move renderer page logic into `src/renderer/*`
- reduce global state in main process
