# iMonitor

iMonitor is an Electron desktop app for IBM i operations. Its ActionBoard brings live jobs, incident ownership, job queues, and IBMEye AI assistance into one workspace.

The product flow is **Connect → Monitor → Detect → Explain with AI → Approve → Act → Verify recovery**. iMonitor automates first-line observation and evidence collection while keeping production corrections under named operator control.

## Operator workflow

- Connect through Mapepire using a saved system profile. ActionBoard, Knowledge, and Settings become available after connecting; the Connect screen keeps only profile controls, theme, plan, and Support. Edit or Add another system reveals the compact connection form; renaming preserves the profile identity.
- Scan active jobs, filter by subsystem/status, or use **Focus next** to inspect a priority job.
- Open a job in its own task window. Multiple job windows can stay open together.
- In **Details**, load an observed resource call graph for the selected job, including linked incidents, queues, subsystems, message waits, and lock owners when IBM i evidence provides them.
- Read the issue, claim work, inspect history, ask AI for an explanation or resolution guidance, and deliberately choose an available job action.
- **Mark Work Done** records the operator's progress. Monitoring must confirm recovery before the incident is cleared.
- Inspect queued work in the separate **Job queues** panel before Support.

Task Actions recommend an eligible support operator by incident skill, IBM i scope, permission, availability, access expiry, and support window. The view shows the response SLA and escalation reason; claiming or accepting work is still an explicit operator action.

Polling supports preset intervals and a custom interval in seconds. Job rows show incident context and the assigned operator when available; a running job can still have a high-CPU incident.

Each incident row can show a compact technical priority badge. Related signals for the same job are correlated within a five-minute window, and the task window explains the grouping and score factors before an operator acts.

Common incident scenarios show a versioned runbook policy with required evidence, safe checks, verification criteria, and escalation guidance. MSGW replies are checked against the current message identity and inquiry queue immediately before execution.

Supported runbooks can be started from a job task and advanced one checkpoint at a time. Each execution stores its operator, evidence version, step outcome, and recovery verification; a blocked or uncertain verification pauses or escalates the runbook instead of retrying a production mutation.

The L3 workspace groups recurring incidents only when the system, job, condition, and runtime shape agree. An operator can confirm the known problem, record the root cause, workaround, and linked ticket, then mark the fix verified. A later occurrence reopens the record for review instead of silently treating it as solved.

The task window also includes isolated incident replay training with ten versioned scenarios. It uses sanitized evidence and expected checks for recovery, blocked work, missing evidence, escalation, and unsafe response attempts; replay never calls a live connector or executes a production action.

Resource relationships are evidence-backed and timestamped. The graph is bounded, marks stale snapshots, and includes an accessible relationship table; it never invents missing links.

Settings can map a job, resource, queue, or subsystem to a customer-defined business service and owner. The task response shows the configured deadline and expected operating window; unmatched impact stays unknown.

The compact ActionBoard keeps one jobs table and a full-width AI input. The **⋯** menu opens activity trends, incident history, object analysis, the optional floating IBMEye, and **Support outcomes** for team leads. Choose a date window to see incident volume, acknowledgement/investigation/recovery measurements, escalation and recurrence signals, AI request availability, sample sizes, unknown outcomes, and a comparison with the previous equal window. The report is scoped to the connected customer system and can be exported as JSON. It records operator-verified recovery separately and keeps autonomous recovery at zero until that future capability is deliberately introduced.

## Run locally

```bash
npm install
npm start
```

`npm start` builds TypeScript, checks browser JavaScript syntax/imports, and launches Electron from this checkout. In development, the saved **Demo connection** lets you connect without an IBM i host. Packaged builds disable demo access.

For renderer-only edits, reload the app window. Main-process/preload changes require an app restart. When using a Git worktree, launch from the checkout containing your changes.

The shared **ActionBoard / Knowledge / Settings** navigation keeps monitoring and independent task windows running. The board restores its per-profile filters, selection and unsent input within the window session. **Knowledge → Analyze code** opens existing object analysis; document ingestion and retrieval remain planned.

## AI and integrations

Settings contains provider setup, notification rules, and integrations. IBMEye supports local Ollama models and hosted provider adapters for OpenAI, Claude, and Grok. Availability depends on the provider's configuration and the active entitlement. Selected-job AI grounds its response in captured evidence and matching approved Resolution Memory, labels uncertainty, and keeps production actions behind operator confirmation. AI provides guidance; it does not automatically execute IBM i recovery actions.

- **ClickUp:** a claim creates a linked work item when configured; later workflow activity is synchronized. The main process owns task creation.
- **Slack:** shared-channel webhook alerts.
- **Jira:** incident issues for enabled watch conditions.
- **Email:** SMTP notifications.
- **SMS:** a configured compatible HTTP provider.

## Background collection

Settings can keep read-only monitoring running after the dashboard window is closed. Choose a saved IBM i profile, set a polling interval, and optionally start iMonitor quietly at OS login. Poll snapshots are stored locally per system under the application data directory, with a visible record count, storage limit, retention period, health status, and confirmed purge action. Background collection never executes corrective IBM i actions without an operator.

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

- [User guide](docs/USER_GUIDE.md)
- [AI + ActionBoard plan](docs/AI_ACTIONBOARD_PLAN.md)
- [Approved UI design and screen sketches](docs/UI_DESIGN.md)
- [Features and access](docs/FEATURES.md)
- [Technical guide and maintenance rules](docs/TECHNICAL.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Incident lifecycle and integrations](docs/ALERT_WORKFLOW.md)
- [Pilot validation and compatibility matrix](docs/PILOT_VALIDATION.md)
- [P2 release gate](docs/P2_RELEASE_GATE.md)
- [P3 release gate](docs/P3_RELEASE_GATE.md)
- [P4 release gate](docs/P4_RELEASE_GATE.md)
- [Mapepire setup](docs/MAPEPIRE_SETUP.md)
- [Change log](CHANGELOG.md)

Support is available before and after connection. Developer diagnostics are encrypted locally; support bundles are redacted and encrypted for the configured support public key. No renderer API exposes raw developer logs.
