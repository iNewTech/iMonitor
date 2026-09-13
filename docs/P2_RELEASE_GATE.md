# P2 release gate

This document is the release record for Project 7 issue [#17](https://github.com/iNewTech/iMonitor/issues/17). It collects the candidate evidence for shared support, authenticated ownership, handoff, integrations, scoped external access, and always-on collection.

## Candidate

- Candidate commit: `9f002c0` (`ticket-29`)
- Product version: `1.1.1`
- Included feature work: #13, #14, #15, #16, #32, and #33
- Project source of truth: [Project 7](https://github.com/orgs/iNewTech/projects/7)
- Release status: **Ready for UAT**

The candidate includes a versioned incident synchronisation contract, authenticated ownership and action leases, accepted L2/L3 handoff, ClickUp/Jira/Slack delivery controls, scoped expiring support access, and a client-controlled read-only background collector. Corrective IBM i actions still require a current authenticated approval and permission check.

## Change and rollback record

- Database migrations: none.
- Feature flags: none added for this candidate.
- Local data: existing incident, action, handoff, delivery, support-access, and collector records remain backward compatible.
- External credentials: existing provider configuration is reused; no new credential schema is required.
- Rollback: stop distribution of the candidate and restore the previous installer. If a source rollback is required, return to the last approved release commit after preserving candidate evidence. No data migration rollback is needed.

## Automated evidence

Run from the repository root:

```text
npm run build
npm run test:unit
npm run test:e2e
```

Recorded automated evidence for commit `9f002c0` on 13 September 2026:

- `npm run build` — passed; TypeScript and 40 renderer modules.
- `npm run test:unit` — passed; 83 files and 394 tests.
- `npm run test:e2e` — passed; 49 Electron tests.
- Environment: local macOS demo runtime.
- Defects: none found in automated validation.

The unit coverage exercises shared sync, scope isolation, stale caches, concurrent leases, accepted handoff, delivery deduplication, access expiry/revocation, collector restart, retention, and purge boundaries. Electron coverage exercises the operator surfaces and demo IPC. These results do not certify a live IBM i release, a customer authority profile, or a second installed client.

## UAT evidence

| Field | Result |
| --- | --- |
| Client/system owner | Pending named client |
| Reviewer/operator | Pending named reviewer and support operator |
| Date | Pending |
| Build and commit | Pending UAT build; candidate baseline `9f002c0` |
| Environment | Pending exact IBM i release/PTFs, partition, Mapepire mode, client OS versions |
| Result | Pending |
| Defects | None recorded yet |

The UAT must use an approved test system and record the exact environment. Demo validation is kept separate from live IBM i validation.

## UAT scenarios

| Scenario | Expected result | Result |
| --- | --- | --- |
| Two clients share one system | An incident, evidence revision, owner, handoff, and action result converge without duplicate events or competing ownership | Pending |
| Automatic L1 preparation | A monitored condition creates one durable incident and prepares read-only evidence while no desktop client creates a manual ticket | Pending |
| Accepted handoff | A named recipient accepts; only then does the configured ClickUp/Jira ticket get created or linked, assigned, status-updated, and commented | Pending |
| Declined, expired, or unavailable handoff | Ownership stays unchanged, no external ticket is created, and the timeline records the outcome | Pending |
| Scoped outsourced support | A delegated user sees only the granted system and actions; expiry or revocation blocks later reads and queued actions | Pending |
| Concurrent action | Two clients cannot claim or mutate the same incident/job at once; a stale request is rejected without changing the owner | Pending |
| Background collection | With the desktop client closed, the approved collector continues read-only collection, reconnects after restart, and exposes heartbeat and stored-record evidence | Pending |
| IBM i outage and restoration | The coverage gap is visible, prior records remain intact, reconnect is bounded, and missed events are not fabricated | Pending |
| AI unavailable | L1 evidence and L2 operator work remain actionable without AI; no model output executes an IBM i action | Pending |
| Integration failure | A failed Slack, ClickUp, or Jira delivery is visible and retryable without blocking the local incident or creating a duplicate | Pending |

## Review checklist

- [ ] Review server-side scope, current permission checks, revocation, leases, and customer isolation.
- [ ] Review delivery idempotency, retries, external status/assignee updates, and failure visibility.
- [ ] Review collector lifecycle, retention, purge, restart, and monitoring-gap reporting.
- [ ] Review keyboard operation, compact task workflow, responsive layout, and clear failure states.
- [ ] Record reviewer, date, build, findings, and accepted follow-up issues.

## Deploy checklist

- [ ] Link the approved UAT record and resolved blocker issues.
- [ ] Record release version, installer hashes, migration/feature-flag statement, and rollback reference.
- [ ] Deploy to the approved environment.
- [ ] Record post-deploy connection, monitoring, handoff, integration, collector, and recovery smoke checks.
- [ ] Move the Project 7 item to **Deployed** only after the above evidence exists.

P2 remains in UAT until the named client/operator records the live result. Passing automated demo tests is not sufficient to close the gate.

Related records: [P1 release gate](P1_RELEASE_GATE.md), [pilot validation](PILOT_VALIDATION.md), [technical guide](TECHNICAL.md), and [Project 7](https://github.com/orgs/iNewTech/projects/7).
