# P1 release gate

This document is the release record for Project 7 issue [#11](https://github.com/iNewTech/iMonitor/issues/11). It keeps the candidate evidence in one place before the first ActionBoard phase is released.

## Candidate

- Product version: `1.1.1`
- Candidate baseline: `ab59bf8` (`ticket-10`)
- Included work: #6, #7, #8, #9, #10, and #31
- Project source of truth: [Project 7](https://github.com/orgs/iNewTech/projects/7)
- Release status: **Ready for UAT**

The candidate includes automatic incident evidence and read-only triage, structured operator response, authorised queue actions, and post-action recovery verification. AI prepares context and guidance; it does not execute production corrections.

## Change and rollback record

- Database migrations: none.
- Feature flags: none added for this candidate.
- Local data: existing `electron-store` incident and action records remain backward compatible.
- External integrations: no new credentials or schema changes are required.
- Rollback: stop distribution of the candidate and restore the previous installer. If a source rollback is required, reset the release branch to the last approved release commit after preserving the candidate evidence. No data migration rollback is needed.

## Automated evidence

Run from the repository root:

```text
npm run build
npm run test:unit
npm run test:e2e
```

Recorded candidate evidence for commit `ab59bf8` on 12 September 2026:

- `npm run build` — passed; 36 renderer modules parsed.
- `npm run test:unit` — passed; 63 files and 313 tests.
- `npm run test:e2e` — passed; 42 Electron tests.
- Environment: local macOS demo runtime.
- Defects: none found in automated validation.

Live IBM i validation remains a UAT requirement.

## UAT evidence

| Field | Result |
|---|---|
| Reviewer | Pending |
| Date | Pending |
| Build and commit | Pending |
| Environment | Demo or live IBM i; record which one |
| Result | Pending |
| Defects | None recorded yet |

The UAT scenario must show one held queue incident moving through automatic detection, read-only evidence, AI preparation, operator confirmation, authorised action, and recovery verification. Repeat the investigation path with AI unavailable. Include a still-blocked outcome, a stale target, denied authority or connection failure where the environment supports it, and confirm that the incident timeline remains available after refresh and reconnect.

Demo results prove UI and IPC behavior only. Live IBM i results are required before production deployment.

## Review and deploy checklist

- [ ] Build and unit results attached.
- [ ] Electron E2E results attached for UI and IPC changes.
- [ ] UAT reviewer, date, environment, result, and defects recorded.
- [ ] Permissions, error handling, data boundaries, keyboard use, and responsive layout reviewed.
- [ ] Previous installer retained for rollback.
- [ ] Release version and candidate commit recorded.
- [ ] Deployment smoke check recorded before marking the gate Deployed.
