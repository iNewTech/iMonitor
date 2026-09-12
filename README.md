# iMonitor

iMonitor is an Electron desktop app for IBM i operations. Its ActionBoard brings live jobs, incident ownership, job queues, and IBMEye AI assistance into one workspace.

## Operator workflow

- Connect through Mapepire using a saved system profile.
- Scan active jobs, filter by subsystem/status, or use **Focus Next Job** to inspect a priority job.
- Open a job in its own task window. Multiple job windows can stay open together.
- Read the issue, claim work, inspect history, ask AI for an explanation or resolution guidance, and deliberately choose an available job action.
- **Mark Work Done** records the operator's progress. Monitoring must confirm recovery before the incident is cleared.
- Inspect queued work in the separate **Job queues** panel before Support.

Polling supports preset intervals and a custom interval in seconds. Job rows show incident context and the assigned operator when available; a running job can still have a high-CPU incident.

## Run locally

```bash
npm install
npm start
```

`npm start` builds TypeScript, checks browser JavaScript syntax/imports, and launches Electron from this checkout. In development, the saved **Demo connection** lets you connect without an IBM i host. Packaged builds disable demo access.

For renderer-only edits, reload the app window. Main-process/preload changes require an app restart. When using a Git worktree, launch from the checkout containing your changes.

## AI and integrations

Settings contains provider setup, notification rules, and integrations. IBMEye supports local Ollama models and hosted provider adapters for OpenAI, Claude, and Grok. Availability depends on the provider's configuration and the active entitlement. AI provides guidance; it does not automatically execute IBM i recovery actions.

- **ClickUp:** a claim creates a linked work item when configured; later workflow activity is synchronized. The main process owns task creation.
- **Slack:** shared-channel webhook alerts.
- **Jira:** incident issues for enabled watch conditions.
- **Email:** SMTP notifications.
- **SMS:** a configured compatible HTTP provider.

Test delivery controls send real external messages or create work items. Local tests use isolated stores and mock external integrations.

## Object analysis

Browse local exported sources or choose an IBM i source library. The ordered library list controls **object lookup**, independently of the source browser. It loads from `setup.json`/`settings.json` when available; **Apply for this session** changes the active list, while **Save permanently** writes `setup.json`.

**Analyze object** produces dependency inventory, business-rule findings, program flow, a call graph, and a conversion plan. Local analysis uses source and available catalog evidence. Live analysis additionally collects supported IBM i metadata. AI explanations are optional and distinguish source evidence from inferred behavior.

**Compile plan** becomes available after analysis. It saves ordered build JSON and CL under `imonitor-analysis/build/<LIBRARY>/`. Unsupported commands, cycles, missing sources, and uncertain build metadata require manual review. Generation does not run compilation.

**Approve & map report** saves the report and its source mapping under `imonitor-analysis/reports/`. An AI addition returns the report to draft for approval. Generated output directories are excluded from source discovery. See [the technical guide](docs/TECHNICAL.md) for paths and boundaries.

## macOS widget

A native WidgetKit scaffold lives in [`macos-widget/`](macos-widget/README.md). Electron writes job/CPU summaries for it; building and signing the native extension still requires the documented Xcode/App Group setup. It is not an automatically installed widget, and macOS controls its refresh schedule.

## Checks

```bash
npm run build           # TypeScript plus renderer syntax/import checks
npm run test:unit       # Domain and runtime tests
npm run test:e2e        # Isolated Electron UI tests
npm test               # All of the above
```

UI tests exercise the development demo, not a production IBM i host. Live commands, credentials, platform signing, and real integration delivery still need environment-specific validation.

## Documentation

- [Features and access](docs/FEATURES.md)
- [Technical guide and maintenance rules](docs/TECHNICAL.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Incident lifecycle and integrations](docs/ALERT_WORKFLOW.md)
- [Mapepire setup](docs/MAPEPIRE_SETUP.md)
- [Change log](CHANGELOG.md)

Support is available before and after connection. Developer diagnostics are encrypted locally; support bundles are redacted and encrypted for the configured support public key. No renderer API exposes raw developer logs.
