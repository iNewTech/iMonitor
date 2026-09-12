# Architecture

## Runtime boundaries

The Electron main process owns connections, monitoring, credentials, actions, persistence, and external integration calls. The preload exposes typed IPC methods. Browser modules render data and manage user interaction; they do not directly access the IBM i session or credential store.

```text
Renderer pages → preload → main/ipc → main/runtime → features + services
```

`src/main.ts` composes these modules. Domain logic belongs in `src/features/`; IBM i and local source providers belong in `src/services/`. Window creation and navigation belong in `src/main/window/window-runtime.ts`.

## Monitoring and task windows

A shared monitoring runtime polls jobs and updates monitoring/alert state. After a successful poll it starts the queue-triage runtime, which reads held queues, waiting jobs, and subsystem context through the same service boundary. Queue mutations pass through an IPC preflight and a fresh post-action recovery read, so an accepted IBM i command and verified recovery remain separate states. The ActionBoard renders the active-job list, focus controls, compact AI composer, queues, and persisted triage evidence. Each standalone task window reads the selected job by its qualified name through the same backend; it does not create its own IBM i connection.

Task refreshes are serialized, stale snapshots are ignored, and action feedback survives later refreshes. Background updates preserve the selected task tab. Explicit workflow and job actions are separate from read-only inspection.

Claims, work completion, and system recovery are distinct states. The main process identifies the current operator and owns ClickUp creation. Renderer code must not create a second task after submitting a claim.

## Object analysis

- `src/services/object-analysis.ts`: local provider, graph resolution, ordered object lookup.
- `src/features/object-analysis/local-source.ts`: physical library discovery, file walking, member selection. Generated output is excluded.
- `src/services/object-analysis-live.ts`: live source members and IBM i metadata.
- `src/features/object-analysis/`: parser, detailed analysis, compile plans, report storage, and AI context.
- `public/object-analysis.js`: source browser, session scope, selection, and page initialization.
- `public/object-analysis/actions.js`: async source/analysis/AI/approval/build requests with selection-version guards.
- `public/object-analysis/report-view.js`: report presentation.
- `public/object-analysis/call-graph.js`: graph construction/rendering from recorded caller-target references.

A source directory and an object library list answer different questions. Browsing discovers source files; the ordered library list determines which object resolves an unqualified reference. Explicitly qualified references never fall back to a different library.

Changing the selection or scope invalidates pending renderer responses. Source order, procedure declarations, and data access must not be converted into invented caller/callee edges. Compile plans are artifacts for review, not an execution route.

## Styles and themes

`public/styles.css` is an ordered import manifest for eight stylesheets in `public/styles/`. The import order preserves existing overrides. Shared colors use theme tokens; compatibility aliases are evaluated on the themed body so night mode inherits the correct values.

Keep a feature's styles with its existing module. Do not append unrelated fixes indefinitely to the entry stylesheet or change import order without checking all affected screens.

## Storage

- Local configuration and workflow state: application store managed by main.
- Credentials: protected by the platform's credential/encryption support.
- Analysis artifacts: beneath the chosen source root, with application-storage fallback for reports when necessary.
- Monitoring/history and developer diagnostics: separate runtime-owned stores; raw developer diagnostics remain outside the renderer bridge.
- Widget: summary JSON written by the widget runtime for the native macOS extension.

This is a desktop architecture. Shared multi-operator authorization across machines, server-side coordination, and fully autonomous recovery remain separate product work.
