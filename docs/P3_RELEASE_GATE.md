# P3 release gate

This document is the release record for Project 7 issue [#24](https://github.com/iNewTech/iMonitor/issues/24). It collects candidate evidence for customer-scoped operational knowledge, evidenced relationships, business-service impact, grounded AI, and verified runbooks.

## Candidate

- Candidate commit: `c2c8b04` (`ticket-17`)
- Product version: `1.1.1`
- Included feature work: #19, #20, #21, #22, #23, and #38
- Project source of truth: [Project 7](https://github.com/orgs/iNewTech/projects/7)
- Release status: **Ready for UAT**

The candidate connects observed IBM i relationships to the selected job, resolves customer-defined business-service context, stores scoped resolution history, grounds AI in current evidence and approved procedures, validates common runbooks, and executes only reviewed procedures with checkpoints, confirmation, and independent recovery verification. AI cannot publish a runbook or bypass an action approval.

## Change and rollback record

- Database migrations: none.
- Feature flags: none added for this candidate; protected runbook actions remain behind existing entitlement and authorization checks.
- Local data: resolution memory and runbook execution records are versioned and customer-scoped; historical executions are not rewritten by later runbook versions.
- External credentials: no new credential schema is required.
- Rollback: stop distribution of the candidate and restore the previous installer after preserving candidate evidence. Existing stored records are backward compatible; no data migration rollback is needed.

## Automated evidence

Run from the repository root:

```text
npm run build
npm run test:unit
npm run test:e2e
```

Recorded automated evidence for commit `c2c8b04` on 13 September 2026:

- `npm run build` — passed; TypeScript and 40 renderer modules.
- `npm run test:unit` — passed; 83 files and 394 tests.
- `npm run test:e2e` — passed; 49 Electron tests.
- Environment: local macOS demo runtime.
- Defects: none found in automated validation.

Automated coverage exercises evidence-backed graph edges and stale data, business-service matching and deadlines, memory scope and lifecycle, prompt redaction and references, runbook applicability and validation, checkpoint state, duplicate submissions, protected actions, and recovery verification. It does not certify a live IBM i release, customer authority profile, or production recovery procedure.

## UAT evidence

| Field | Result |
| --- | --- |
| Client/system owner | Pending named client |
| Reviewer/operator | Pending named L2/L3 reviewer |
| Date | Pending |
| Build and commit | Pending UAT build; candidate baseline `c2c8b04` |
| Environment | Pending exact IBM i release/PTFs, partition, Mapepire mode, and client OS |
| Result | Pending |
| Defects | None recorded yet |

The UAT must use an approved test partition and record the exact environment. Demo validation is kept separate from live IBM i validation.

## UAT scenarios

| Scenario | Expected result | Result |
| --- | --- | --- |
| Resource relationship | The operator opens the selected job details, follows only observed relationships, sees source and timestamp for each edge, and can use the table fallback | Pending |
| Business impact | A matching job/queue/subsystem mapping shows service owner, response deadline, and SLA state; unmatched impact remains unknown | Pending |
| Resolution Memory | The operator records evidence, failed attempts, action, outcome, environment, reviewer, and expiry; another system cannot see the record | Pending |
| Grounded AI | AI answers only from selected-job evidence and applicable approved knowledge, cites bounded references, and labels missing or stale evidence | Pending |
| Runbook lifecycle | A reviewed runbook is matched to the current incident and environment; draft, retired, or incompatible procedures are excluded | Pending |
| Checkpoint execution | The operator sees the exact protected effect, confirms it, and the system records step input/output, identity, timestamp, and outcome | Pending |
| Recovery verification | The system checks current IBM i state independently; recovered, blocked, failed, and unknown outcomes remain distinct | Pending |
| Stale or uncertain evidence | The runbook stops or escalates and does not retry a production mutation when evidence or permission is stale | Pending |
| AI unavailable | Evidence and approved operator work remain available without AI; no generated text executes a correction | Pending |

## Review checklist

- [ ] Review system scope, customer isolation, redaction, evidence references, and historical immutability.
- [ ] Review graph bounds, stale-data presentation, table accessibility, and missing relationship behavior.
- [ ] Review runbook applicability, protected command display, confirmation, leases, failure handling, and independent verification.
- [ ] Review AI prompt boundaries and confirm model output has no execution path.
- [ ] Record reviewer, date, build, findings, and accepted follow-up issues.

## Deploy checklist

- [ ] Link the approved UAT record and resolved blocker issues.
- [ ] Record release version, installer hashes, migration/feature-flag statement, and rollback reference.
- [ ] Deploy to the approved environment.
- [ ] Record post-deploy connection, evidence, AI, runbook, recovery, and memory smoke checks.
- [ ] Move the Project 7 item to **Deployed** only after the above evidence exists.

P3 remains in UAT until the named client/operator records live evidence. Passing automated demo tests is not sufficient to close the gate.

Related records: [P2 release gate](P2_RELEASE_GATE.md), [pilot validation](PILOT_VALIDATION.md), [technical guide](TECHNICAL.md), and [Project 7](https://github.com/orgs/iNewTech/projects/7).
