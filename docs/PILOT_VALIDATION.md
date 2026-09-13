# Pilot validation and compatibility matrix

This document is the evidence record for Project 7 issue [#29](https://github.com/iNewTech/iMonitor/issues/29). It gives Product, QA, and Support one place to plan pilot validation without turning a demo result into a support or release claim.

## What this pilot proves

The pilot validates the complete operator loop in an approved environment:

`connect → observe → create incident → prepare evidence → explain → approve → act → verify → retain outcome`

The client owns the IBM i system and chooses up to three willing pilot teams. A team may be internal or an outsourced support provider with a named, scoped, revocable account. No participant, deadline, approval, or supported platform is assumed until it is recorded here.

Automatic L1 observation and read-only preparation may continue without a desktop window when the client-controlled collector is enabled. Production changes remain an explicit action by an authenticated operator with current permission. AI guidance, integrations, and background collection do not expand that authority.

## Evidence status

Use one of these values in every matrix row and scenario record:

| Status | Meaning |
| --- | --- |
| `unverified` | No approved environment evidence exists yet. This is the starting value. |
| `demo-automated` | Covered by isolated demo, unit, or Electron tests. It does not prove live IBM i support. |
| `pilot-observed` | Observed by a named reviewer in an approved pilot environment; attach the exact build and evidence. |
| `certified` | Approved for the recorded scope after defects, review, UAT, deployment, and smoke checks are complete. |

## Pilot scope record

Complete one record for each team before collecting customer data.

| Field | Record |
| --- | --- |
| Pilot team | Pending named participant |
| Client/system owner | Pending |
| Support participants | Pending named internal or outsourced users |
| Systems in scope | Pending exact IBM i system IDs |
| Data permission | Pending read-only, investigation, and approved action scopes |
| Data retention and export approval | Pending client decision |
| Success criteria | Detect and retain one incident; complete one read-only investigation; complete one explicitly approved action where permitted; verify recovery; record one failure or escalation path |
| Exclusions | Unapproved production mutation, shared credentials, unredacted customer data, and autonomous recovery |

## Compatibility matrix

The matrix records the exact tested version and evidence. “Target” describes packaging or an intended surface; it is not a compatibility claim.

| Surface | Target or test dimension | Current evidence | Status | Evidence to record |
| --- | --- | --- | --- | --- |
| macOS desktop | Exact macOS version and signed/unsigned build | Electron demo coverage; packaging and live IBM i behavior still need a named pilot check | `demo-automated` | OS version, app build, install/upgrade result, reconnect result, smoke result |
| Windows desktop | Exact Windows version and NSIS build | Windows packaging is configured; no live pilot result is recorded in this repository | `unverified` | OS version, installer version, clean install/upgrade, reconnect, smoke result |
| IBM i platform | Exact IBM i release, PTF group, partition and language settings | No live IBM i release/ PTF evidence is recorded | `unverified` | `WRKLICINF`/release details as approved, PTF level, partition role, reviewer and date |
| Mapepire connection | Host, port, TLS/authentication mode, reconnect behavior | Connection and demo paths are automated; live network behavior remains pilot work | `demo-automated` | Mapepire version, connection mode, latency, outage and restoration evidence |
| Read-only IBM i reads | Jobs, queues, subsystem/status data, message waits, job logs, locks, and bounded diagnostics | Service contracts and demo fixtures exist; authority behavior needs live validation | `demo-automated` | Query/result status, row limits, elapsed time, denied-authority behavior |
| Object metadata used by analysis | Library list plus program/object reference and dependency lookups | Live object analysis is available behind the connected service; release coverage is unverified | `unverified` | IBM i release, library/object type, command/query result, missing-data behavior |
| Least privilege | Read-only monitor; separately scoped investigate and execute permission | Authorization boundaries are covered in automated tests; customer authority combinations need live checks | `demo-automated` | Account authority, allowed/denied operation, revocation/expiry result, audit entry |
| Background collector | Collector restart, app closed, IBM i outage, AI unavailable | Local collector lifecycle and storage are covered by automated tests; service-host deployment is unverified | `demo-automated` | Host/service lifecycle, heartbeat gap, restart, persisted record, recovery timestamp |
| Scale | 1, 100, and agreed large active-job/evidence sets | No customer scale limit is claimed | `unverified` | Dataset size, poll duration, memory, disk growth, UI responsiveness, dropped/unknown data |
| AI providers | Configured local Ollama or hosted provider, plus AI-offline fallback | Provider and fallback flows are covered in demo tests | `demo-automated` | Provider/model version, availability, prompt redaction, fallback, response latency |
| Work integrations | ClickUp, Jira, Slack, Email, and SMS only where configured | Adapter and delivery behavior is tested with mocks; customer endpoints need pilot validation | `demo-automated` | Endpoint type, delivery key, external ID, status/assignee/comment result, retry or failure |

The exact IBM i release, PTF level, partition size, query authority, and supported client versions remain customer evidence fields. They must not be filled from a demo fixture or inferred from a successful compile.

## Required pilot scenarios

Record every run with reviewer, build/commit, environment, date, result, defects, and evidence location.

| Scenario | Expected result |
| --- | --- |
| Connect and baseline | The named system connects, the active-job baseline is timestamped, and the monitoring status is visible. |
| Automatic L1 incident | An enabled condition creates one durable incident with evidence and no email or manual ticket. Repeated observations do not create duplicates. |
| AI preparation | Guidance is linked to the selected evidence and clearly marked unavailable or stale when the provider is offline. No production action runs from model output. |
| L2 investigation | An authorised operator claims the incident, inspects the task history, follows a safe check or approved runbook, and sees the owner in the job row. |
| Approved action and verification | The operator confirms a permitted action, the action is audited, and recovery is checked against the current IBM i state. A failed or uncertain check remains visible. |
| L3 escalation | A specialist receives a scoped handoff with the summary, owner transition, and configured ClickUp/Jira/Slack notification where enabled. |
| Access restriction | A read-only or expired/revoked user is denied investigation or execution according to the granted scope. Another customer/system remains inaccessible. |
| Outage and restart | A Mapepire or AI outage shows a monitoring gap or unavailable preparation, preserves prior evidence, reconnects with bounded retry, and does not fabricate missed events. |
| Closed-client collection | With the desktop client closed, the approved collector stores read-only observations and exposes record count, retention, and purge information after reconnect. |
| Large workload | The agreed job/evidence dataset stays within the recorded time, memory, disk, and UI limits, or the observed limit becomes a prioritised defect. |

## Defect and reliability log

Only approved pilot cases may be published. Use severity `blocker`, `high`, `medium`, or `low`; link the issue and exact evidence for every finding.

| ID | Severity | Area | Environment/build | Observed | Expected | Issue/link | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| — | — | No pilot defects recorded | — | Pilot has not been run | Record actual findings here | — | — |

Reliability findings are prioritised by customer impact, data loss or duplication, unsafe action risk, recovery difficulty, and frequency. A demo-only defect stays labelled as demo-only until reproduced or cleared in an approved environment.

## Exit criteria

Issue #29 may move forward only when:

- each participating team, system, permission scope, reviewer, build, date, and environment is recorded;
- the compatibility rows used by the pilot have `pilot-observed` evidence with exact versions and no unresolved blocker;
- all required scenarios have a result, including an outage, denied permission, AI-unavailable, and recovery-verification path;
- reliability defects are linked, prioritised, and either resolved or accepted by the named client owner;
- published case evidence is approved and redacted; and
- the applicable release gate contains the UAT, review, deployment, smoke, and rollback records.

The repository's automated checks remain valuable regression evidence, but they cannot complete the live IBM i, customer permission, pilot, or deployment records. Keep the Project 7 status as the delivery source of truth.

Related records: [Project 7](https://github.com/orgs/iNewTech/projects/7), [P1 release gate](P1_RELEASE_GATE.md), and [technical guide](TECHNICAL.md).
