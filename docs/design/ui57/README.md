# UI-01 delivery evidence

[#57](https://github.com/iNewTech/iMonitor/issues/57) · [AI + ActionBoard, Project 8](https://github.com/orgs/iNewTech/projects/8).

## Screenshots

Actual Electron renderings with an isolated demo profile: [1440 desktop](connect-1440.png), [1024 desktop](connect-1024.png), [560 narrow window](connect-560.png), [dark theme](connect-dark.png). Native dimensions are in CSS pixels; the host display scale doubles image pixel dimensions. These screenshots show the completed Connect implementation, not a live client connection.

## Code and review

- One 450px form, saved-system default, Edit/Add reveals credentials; first use opens setup.
- Profile updates include their existing ID. Renaming no longer creates a duplicate request. Real encryption and on-disk persistence are retained.
- Profile load retry, connection retry, invalid ports, cancellation, and background profile refresh preserve input. Navigation protects unfinished edits.
- Shared ActionBoard/Knowledge/Settings navigation keeps the connection, monitoring, task windows, board selection/filter state, and unsent board draft. Drafts are profile/operator scoped and limited to the window session; no profile credentials go into browser storage.
- Knowledge is a clearly labelled placeholder with Analyze code, retaining the source browser, call graph, compile plan, and reports. The existing board menu also keeps Object analysis. Document search, ingestion and RAG are separate feature tickets.
- Native job-window redesign and Settings categories remain #59 and #60.

## Automated operator acceptance checks

`tests/e2e/connection-shell.spec.ts` exercises: saved-profile selection; bounded native desktop/narrow sizes; light/dark rendering; keyboard menu dismissal; plan-menu bounds; Support availability; unfinished edits and profile notifications; rename with stable ID; encrypted storage and reload; deletion to first-use setup; new profile and invalid port; failed profile reads and retries; failed connection and preserved credentials; cross-screen navigation with active monitoring, open job task, selected scope, filters and AI draft.

The save scenario stubs only the IBM i network transport while keeping main-process validation, duplicate checks, encryption, save IPC and the local store real. Other scenarios use disposable app stores and demo jobs. No client connection, real external delivery or deployment is claimed.

Focused unit checks cover navigation's active-connection boundary and audit entry, alongside the existing profile helpers. The full build, unit and Electron suite results are recorded on the issue before closure.

Final validation: TypeScript build and all 44 renderer modules passed. The full unit suite passed **404 tests across 85 files**. The complete Electron suite passed **57 scenarios** including the four new operator acceptance cases. Code review, screenshot review, automated UAT and documentation are complete; live client UAT and deployment are not claimed.
