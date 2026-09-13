# AI + ActionBoard release record

This is the Project 8 release record for [issue #56](https://github.com/iNewTech/iMonitor/issues/56). It joins the beginner guide, developer guide, approved UI contract, pilot matrix, and automated evidence into one reviewable release package.

## Candidate

| Field | Record |
| --- | --- |
| Product | iMonitor AI + ActionBoard |
| Project | [AI + ActionBoard, Project 8](https://github.com/orgs/iNewTech/projects/8) |
| Candidate baseline | `bddaea2` |
| Candidate tag | `ticket-56-uat` |
| Branch | `dev` |
| Release status | **Ready for UAT** |
| Scope | #41–#55 implementation, #56 release evidence, plus shared UI #57–#60 |
| Fully autonomous recovery | Disabled; future scope |

The candidate provides a connected IBM i monitoring workspace with automatic L1 observation, evidence-grounded L2 investigation, controlled actions, L3 handoff and learning, scoped RAG, approved MCP Skills, background collection, retention controls, and compact operator screens. AI can prepare evidence and recommendations; it cannot bypass permissions or execute production recovery by itself.

## Evidence rules

Keep these evidence classes separate in every review record:

| Evidence class | What it proves | What it does not prove |
| --- | --- | --- |
| `demo-automated` | The isolated Electron fixtures, unit contracts, and renderer behavior work as tested | Live IBM i compatibility, customer authority, external delivery, or deployment |
| `pilot-observed` | A named reviewer saw the behavior in an approved customer environment | Compatibility beyond the recorded environment |
| `certified` | The named owner accepted the recorded scope after review, UAT, deployment smoke, and rollback evidence | Future environments or unsupported configurations |

Never copy demo values into live evidence. Record the exact commit, installer, operating system, IBM i release/PTFs, Mapepire mode, permissions, provider, integration configuration, reviewer, date, and evidence location.

## Automated evidence

Run from the repository root:

```text
npm run build
npm run docs:check
npm run test:knowledge-regression
npm run test:unit
npm run test:e2e
```

Current candidate evidence:

| Check | Result | Evidence boundary |
| --- | --- | --- |
| TypeScript build and renderer validation | Passed; 48 renderer modules | Local source and isolated fixtures |
| Documentation link check | Passed; all local Markdown targets resolve | Repository documentation only |
| Knowledge regression suite | Passed; 10/10 golden cases | Deterministic golden data only |
| Unit suite | Passed; 105 files and 501 tests | Domain, main-process, and runtime contracts |
| Electron suite | Passed; 69 scenarios | Isolated local Electron demo |

### Automated run record

| Field | Record |
| --- | --- |
| Run date | 14 September 2026 |
| Runner | Local macOS development runtime |
| Validation baseline | `bddaea2` before the documentation-only #56 package |
| Defects found | None in the recorded automated run |
| Live IBM i evidence | Pending named pilot |
| External integration evidence | Mocked automated coverage; customer endpoints pending pilot |

Automated checks support UAT. They do not replace a live IBM i/client review.

## Pilot preparation

Complete these fields before collecting customer data:

| Field | Record |
| --- | --- |
| Client/system owner | Pending named owner |
| Pilot team | Pending internal or outsourced support team |
| Support participants | Pending named L2 and L3 operators |
| IBM i systems | Pending exact system IDs, release, and PTF level |
| Access scopes | Pending monitor, investigate, and approved action permissions |
| AI provider/model | Pending configured provider and model |
| Integrations | Pending enabled ClickUp/Jira/Slack/email settings |
| Retention/export approval | Pending client decision |
| UAT reviewer/date | Pending |

The client remains the system owner. Outsourced support receives a named, scoped, expiring and revocable grant. Shared credentials, unredacted customer data, unapproved mutations, and autonomous recovery are excluded.

## Pilot scenarios

Record one row per run with the reviewer, exact build, environment, result, defect link, and evidence location. The expected flow is **L1 automatic observation → L2 operator work → L3 specialist escalation when needed**.

| # | Scenario | Expected result | Status |
| ---: | --- | --- | --- |
| 1 | Happy path | A condition creates one durable incident, L1 evidence is prepared automatically, an L2 operator claims it, uses grounded AI/runbook guidance, approves a permitted action, and monitoring verifies recovery. | Pending |
| 2 | No evidence | The job remains visible, AI says evidence is unavailable, the operator sees the missing fields, and no unsupported cause or action is invented. | Pending |
| 3 | Stale evidence | Old evidence is labelled stale, the operator is asked to refresh or verify it, and stale context cannot authorize an action. | Pending |
| 4 | Provider outage | Monitoring and L2 controls remain usable when the model is unavailable; the UI shows the outage and no model response is treated as fact. | Pending |
| 5 | Wrong scope | A user, source, job, MCP resource, or memory record from another customer/system is filtered before retrieval and display. | Pending |
| 6 | Read-only MCP | An enabled read-only Skill returns bounded, cited current context with timeout handling and no write capability. | Pending |
| 7 | Denied write | A write proposal is blocked when permission, approval, scope, evidence, or lease checks fail; the denial is visible in the audit timeline. | Pending |
| 8 | Approved action | The operator sees target, effect, risk, evidence, permission, and verification rule; approval runs one controlled action and records the result. | Pending |
| 9 | Failed verification | An action whose next read is failed or unknown stays unresolved, offers escalation, and does not auto-retry a production mutation. | Pending |
| 10 | Recovery and L3 handoff | A verified outcome is recorded, a handoff transfers ownership only after acceptance, and the configured ClickUp/Jira/Slack update includes the scoped summary. | Pending |

Also exercise reconnect, refresh while typing, multiple task windows, background collection with the desktop closed, retention/purge, integration failure, keyboard/focus behavior, light/dark themes, and the approved seven-screen UI path. Use [PILOT_VALIDATION.md](PILOT_VALIDATION.md) for the compatibility matrix and expanded evidence fields.

## Review gate

- [ ] User guide covers Connect, Monitor, L1, L2, L3, AI, MCP Skills, actions, integrations, retention, and troubleshooting.
- [ ] Developer guide covers contracts, module boundaries, adapters, authorization, evaluation, observability, and safe Skill extension.
- [ ] Automated evidence is labelled `demo-automated` and kept separate from live client evidence.
- [ ] No open blocker exists for scope isolation, unsafe execution, data loss, duplicate action, or recovery verification.
- [ ] The approved UI contract is exercised at the supported minimum native size and at 1024×768 and 1440×900.
- [ ] Release version, installer hash, migration statement, and rollback target are recorded.
- [ ] Named client owner accepts the UAT result before the Project 8 item moves from UAT to Done.

## Deployment smoke and rollback

After deployment to the approved pilot environment, record:

1. Connect and reconnect with the saved profile.
2. Confirm live activity, job status, incident ownership, and History survive reconnect.
3. Confirm one read-only AI investigation shows current scoped evidence.
4. Confirm one approved action, independent verification, and audit entry where permitted.
5. Confirm handoff and configured integration delivery, including failure visibility.
6. Confirm background collection, retention inventory, and confirmed purge behavior.

If a release must be withdrawn, stop distribution, restore the previous installer, preserve the candidate evidence, and record the rollback reason. Do not delete customer evidence as part of a code rollback; use the documented retention and purge controls under the customer's instruction.

## Documentation map

- [Beginner user guide](USER_GUIDE.md)
- [Developer technical guide](TECHNICAL.md)
- [Architecture](ARCHITECTURE.md)
- [Approved UI contract](UI_DESIGN.md)
- [Knowledge and compatibility pilot matrix](PILOT_VALIDATION.md)
- [AI + ActionBoard implementation plan](AI_ACTIONBOARD_PLAN.md)

The final release decision remains evidence-based. Fully autonomous recovery stays outside the enabled scope until a separate future gate proves retrieval quality, permissions, rollback, and independently verified recovery at the intended scale.
