# ActionBoard UI-02 delivery

Implementation evidence for [#58](https://github.com/iNewTech/iMonitor/issues/58), Project 8. Screenshots are from the actual Electron renderer with isolated illustrative jobs, a mock local model and a test operator. They do not depict a connected client or establish deployment.

- [Light desktop](actionboard-light.png): 1440×900 native window.
- [Dark desktop](actionboard-dark.png): 1440×900 native window.
- [Smaller desktop](actionboard-1024.png): 1024×768 native window.
- [Narrow window](actionboard-small.png): 560×600 native window, reflow and page scrolling.

Screenshots include the full page and use the host display scale; image pixel dimensions therefore differ from native window dimensions. The table scrolls independently. Model and context labels truncate with their complete value in a tooltip; they never narrow the input area.

## Existing feature entry points

| Capability | Entry point |
|---|---|
| Jobs, ownership, conditions and priority | Main table; priority explanation on condition hover; Focus next |
| Status, subsystem, custom polling, pause/resume, row density | Status selector and sliders menu |
| Claim/release, notes, history, handoff, external tickets, safe actions | Click or keyboard-open a job's existing independent task window |
| AI explanations, runbooks, Resolution Memory, L3 problems and replay | Existing task tabs; unchanged action and permission boundaries |
| Board/job AI, presets, model setup | Full-width composer, + menu, explicit context label, compact model menu |
| Floating IBMEye | Workspace ⋯ menu; optional, hidden on entry |
| Live activity: Job volume, Peak job CPU, Wait states | Expanded above jobs on connection; select the overview heading to collapse/expand |
| Incident history including system incidents, support outcomes | Workspace ⋯ menu |
| Object analysis, source loading, call graph, compile plan and reports | Workspace ⋯ → Object analysis |
| Integrations, support access, collection/retention | Settings; footer collection status opens Settings |
| Queue search, triage, inspection and safe actions | Queued work, collapsed below the composer |
| Support and encrypted diagnostics | Footer Support menu |

Knowledge, Connect redesign, Settings categories and the simplified two-tab job design remain separate tickets. No RAG feature or autonomous recovery is claimed by this UI delivery.

## Validation

- TypeScript build and renderer/import validation.
- Full unit suite: 401 tests across 84 files.
- Electron suite: 53 scenarios, covering the existing app plus UI-02 polling, profile reconnect, scroll/focus/drafts, exact/fuzzy search, owner filtering, custom seconds, model setup/availability, scope switching, themes, three native sizes, long models, empty states and collector/poll errors.
- The final complete run passed 52 Electron scenarios; a strict test locator was then corrected and all four board scenarios passed on rerun, covering all 53 scenarios.
- Tests isolate storage, use demo IBM i data, and mock external services where needed; existing confirmation, persistence and permission tests remain enabled.

The source of the board is `public/monitor.html`. Workspace state lives in `public/monitor/board-workspace.js`; keyed rows and current-condition rendering in `public/monitor/job-rows.js`; the layout in `public/styles/board-workspace.css`. AI behavior stays in the existing `public/monitor/ibmeyeai` modules.

## Current acceptance status

Implementation and automated test evidence are recorded above. #58 is open in **UAT**, pending user acceptance before Done. This stage does not imply client deployment.

## Live activity entry-screen update

The user requested System activity on the first screen after connection. The overview now opens above jobs with compact Job volume, Peak job CPU and Wait states charts. It remains keyboard collapsible, receives history updates while collapsed, and starts expanded again after reconnecting. The redundant Activity trends menu entry is removed. Chart backgrounds follow the board theme; accessible chart names include the latest value.

Validation: build and all 44 renderer modules passed; four monitoring unit checks passed; all ten focused board/Connect Electron scenarios passed. After the dark-theme chart-background correction, all five board scenarios passed again. Coverage includes three native window sizes, light/dark screenshots, first entry, empty history, multiple snapshots, keyboard collapse, updates while collapsed, reconnect, drafts, model availability and connection gates. These are isolated automated checks; user UAT remains pending.
