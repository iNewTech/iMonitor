# P4 release gate

This document is the release record for Project 7 issue [#30](https://github.com/iNewTech/iMonitor/issues/30). It collects candidate evidence for L3 problem management, operator training, support outcome measurement, and pilot validation.

## Candidate

- Candidate commit: `a0ecdd7` (`ticket-24`)
- Product version: `1.1.1`
- Included feature work: #26, #27, #28, and #29
- Project source of truth: [Project 7](https://github.com/orgs/iNewTech/projects/7)
- Release status: **Ready for UAT**

The candidate gives L3 a confirmed recurring-problem workspace, isolates training replay from production connectors, reports support outcomes with explicit sample sizes and unknowns, and defines the evidence-first pilot and compatibility record. Human-approved work remains distinct from autonomous recovery; autonomous production remediation is outside this release.

## Change and rollback record

- Database migrations: none.
- Feature flags: none added for this candidate; training replay has no live action boundary and support reporting is read-only.
- Local data: problem records, replay state, support metrics, and pilot evidence are customer-scoped or documented as environment evidence; historical records are not silently rewritten.
- External credentials: no new credential schema is required.
- Rollback: stop distribution of the candidate and restore the previous installer after preserving candidate evidence. Existing records are backward compatible; no data migration rollback is needed.

## Automated evidence

Run from the repository root:

```text
npm run build
npm run test:unit
npm run test:e2e
```

Recorded automated evidence for commit `a0ecdd7` on 13 September 2026:

- `npm run build` — passed; TypeScript and 40 renderer modules.
- `npm run test:unit` — passed; 83 files and 394 tests.
- `npm run test:e2e` — passed; 49 Electron tests.
- Environment: local macOS demo runtime.
- Defects: none found in automated validation.

Automated coverage exercises exact problem matching, recurrence, confirmation, training safety, support metric definitions, customer/system scope, explicit zero or unknown values, pilot documentation links, and responsive operator surfaces. It does not certify live pilot performance, compatibility, or deployment.

## UAT evidence

| Field | Result |
| --- | --- |
| Client/system owner | Pending named client |
| Reviewer/operator | Pending named L2/L3 reviewer and support lead |
| Date | Pending |
| Build and commit | Pending UAT build; candidate baseline `a0ecdd7` |
| Environment | Pending exact IBM i release/PTFs, partition, client OS, provider configuration, and pilot team |
| Result | Pending |
| Defects | None recorded yet |

The UAT must use approved pilot environments and attach the exact evidence record from [PILOT_VALIDATION.md](PILOT_VALIDATION.md). Demo validation is kept separate from live IBM i validation.

## UAT scenarios

| Scenario | Expected result | Result |
| --- | --- | --- |
| Recurring problem | L3 confirms a compatible repeated incident, records root cause/workaround/ticket evidence, and a later occurrence reopens the problem for review | Pending |
| False match | A changed system, job, subsystem, or runtime shape remains a candidate or separate problem until a person confirms it | Pending |
| Training replay | A trainee can complete sanitized scenarios and an unsafe response is visibly blocked without any IBM i or integration call | Pending |
| Support outcomes | A support lead selects a window, sees stage sample sizes/unknowns, compares the previous equal window, and sees autonomous recovery as zero | Pending |
| Pilot compatibility | The exact client/IBM i release, PTFs, authorities, scale, provider versions, and integration results are recorded for the scenarios used | Pending |
| Pilot outage | A connection or AI outage shows a coverage/preparation gap, preserves evidence, and does not fabricate missed results | Pending |
| Data boundary | A second customer/system cannot see the first customer's problems, training context, outcomes, or pilot evidence | Pending |

## Review checklist

- [ ] Review problem matching, confirmation, recurrence, evidence references, and customer scope.
- [ ] Review training isolation and confirm no live connector, command runner, or integration path is reachable.
- [ ] Review metric denominators, time windows, unknown outcomes, and the autonomous-recovery boundary.
- [ ] Review pilot evidence for exact versions, authority, scale, defects, redaction, and named approval.
- [ ] Review keyboard use, responsive layout, failure states, and readability of the L3/outcomes surfaces.
- [ ] Record reviewer, date, build, findings, and accepted follow-up issues.

## Deploy checklist

- [ ] Link the approved UAT record and resolved blocker issues.
- [ ] Record release version, installer hashes, migration/feature-flag statement, and rollback reference.
- [ ] Deploy to the approved pilot environment.
- [ ] Record post-deploy problem, training, outcomes, collector, integration, and recovery smoke checks.
- [ ] Move the Project 7 item to **Deployed** only after the above evidence exists.

P4 remains in UAT until the named client/operator records live pilot evidence. Passing automated demo tests is not sufficient to close the gate.

Related records: [P3 release gate](P3_RELEASE_GATE.md), [pilot validation](PILOT_VALIDATION.md), [technical guide](TECHNICAL.md), and [Project 7](https://github.com/orgs/iNewTech/projects/7).
