# AI + ActionBoard plan

## Product goal

Make iMonitor the trusted AI workbench for IBM i production support. The product should understand the current system, job, incident, business service, and support history; retrieve the most relevant evidence; explain what is known and unknown; and guide an operator through a verified action.

The differentiator is the complete evidence-to-action loop:

```text
IBM i signals → scoped knowledge → hybrid retrieval → cited guidance
             → approved action → recovery verification → reusable memory
```

This is more valuable than a generic chat window because every answer is tied to the connected IBM i system, the selected job, the customer's approved knowledge, and the current operational state.

## Operating model

The first release keeps the support model explicit.

| Level | System responsibility | Human responsibility |
|---|---|---|
| L1 | Detect conditions, collect evidence, correlate signals, create the incident record, retrieve known guidance, and prepare a triage report. | Review exceptions and take ownership when policy requires it. |
| L2 | Assemble a grounded brief, suggest checks, show an approved runbook, and verify the result after an action. | Investigate, approve production actions, record the outcome, and escalate uncertainty. |
| L3 | Surface recurring patterns, linked history, object or service impact, and unresolved evidence gaps. | Handle high risk or novel cases and turn verified solutions into reusable knowledge. |
| Future autonomy | Propose supervised automation after enough verified outcomes exist. | Set policy, approve the scope, and retain an emergency stop. |

Fully autonomous recovery is a later product decision. The RAG and MCP foundations must make that decision safer, but must not assume that autonomy is enabled.

## Why this can stand out

1. **IBM i operational context is first class.** Retrieval starts with qualified job identity, subsystem, queue, message key, lock context, workload signal, system release, and current evidence rather than a generic prompt.
2. **Evidence is visible.** Every material answer contains citations to the source snapshot, incident, runbook, or verified resolution. Unsupported conclusions are labelled as unknown.
3. **Recovery is measured.** A suggested action is separate from execution, and execution is separate from monitoring-confirmed recovery.
4. **Memory earns trust.** Only an approved, customer-scoped resolution can influence later guidance. A draft, stale, retired, or conflicting entry is excluded or shown as such.
5. **MCP is an operating boundary.** Skills declare their tools, permissions, scopes, risk class, schemas, and evidence requirements. AI cannot silently install a skill or invoke a write tool.
6. **The app remains useful locally.** A customer can begin with local evidence and an embedded index, then add a hosted model or vector service through an adapter when scale or policy requires it.
7. **The workflow improves with outcomes.** Verified resolutions, failed checks, escalations, and evidence gaps become structured data for better retrieval and runbooks.

## Target operator flow

1. iMonitor connects to one customer-selected IBM i system and establishes the current system scope.
2. The read-only monitor collects jobs, waits, queues, messages, locks, subsystem context, and configured business-service mappings.
3. L1 correlation creates or updates an incident and stores a sanitized evidence snapshot with timestamps.
4. The knowledge pipeline indexes eligible incident evidence, approved runbooks, verified Resolution Memory, object reports, service mappings, and customer documents.
5. The operator opens a job task. The task builds a retrieval query from the live job and incident context.
6. Retrieval applies scope and permission filters before hybrid search. A reranker selects a bounded evidence pack.
7. IBMEye returns a structured answer: observed facts, matching evidence, interpretation, missing evidence, suggested checks, approved procedures, and next action.
8. For a write action, the operator sees a preview, required permission, current evidence age, expected effect, and verification rule. The action needs explicit approval.
9. iMonitor executes through the existing main-process action boundary, records the audit event, and performs a fresh read to verify recovery.
10. The operator marks the outcome. A verified outcome can become a draft Resolution Memory entry for review; it does not immediately become trusted knowledge.

## Architecture direction

Keep the current Electron boundary and add small, replaceable services inside it:

```text
Renderer
  └─ preload (typed requests only)
       └─ main IPC
            ├─ context builder and authorization
            ├─ knowledge ingestion and redaction
            ├─ index adapter (local first or external)
            ├─ retrieval and context pack
            ├─ model/provider adapter
            ├─ MCP skill registry and tool gateway
            └─ action planner → IBM i connector → verification
```

The renderer receives view models and citations. It does not connect to a vector database, call an MCP server, hold credentials, or execute IBM i commands. The main process remains the owner of credentials, external services, permissions, actions, audit, and persistence.

### Recommended storage strategy

Use a provider-neutral interface rather than committing the product to one database.

- **Default:** local application storage with lexical search and an embedded vector index when available. This supports offline investigation and a small pilot.
- **Optional:** Qdrant, pgvector, or another customer-approved service behind the same adapter. The adapter must support metadata filtering, delete/reindex, health checks, and scoped collections or partitions.
- **Never:** send raw cross-customer data to a shared index without an enforced tenant and system filter.

Vector search alone is not enough for operations. Use hybrid retrieval: lexical matching for exact job names, message IDs, object names, and CL commands; vector similarity for symptoms and natural-language descriptions; metadata filters for customer, system, time, source type, permissions, and freshness.

## Knowledge contract

Create one versioned internal schema for everything eligible for retrieval. A record should include:

```text
KnowledgeRecord
  id, schemaVersion, sourceType, title, content
  customerScope, systemScope, serviceScope, permissions
  sourceRef, evidenceRefs, observedAt, indexedAt, expiresAt
  contentHash, redactionProfile, confidence, status
  incidentKind, qualifiedJob, subsystem, queue, objectNames
  runbookId/runbookVersion, reviewer, reviewAt
```

Required rules:

- `customerScope` and `systemScope` are mandatory for operational records.
- Source references are stable and open the relevant local detail without exposing secrets.
- Content is sanitized before embedding and before being sent to a model.
- A record can be `draft`, `approved`, `stale`, `retired`, `blocked`, or `unknown`.
- Retrieval defaults to approved, in-scope, unexpired records. Drafts and stale records may be displayed as review context but cannot be presented as verified procedures.
- The original source remains authoritative. The index is a derived, rebuildable view.

## Ingestion and indexing

### First source categories

- Incident timelines and sanitized evidence snapshots.
- Active and historical job context, job logs, waits, queues, messages, locks, and subsystem observations.
- Approved Resolution Memory and versioned runbook policies.
- Object analysis reports, call graphs, compile plans, and source identity mappings.
- Customer business-service mappings, support windows, severity rules, and escalation policy.
- Customer-provided operator guides, runbooks, and IBM i notes.
- Redacted ClickUp, Jira, and Slack handoff history when the customer explicitly enables it.

### Pipeline

```text
source event → normalize → redact → classify → chunk → hash
            → attach scope/provenance → embed → upsert → verify
```

Ingestion must be incremental and idempotent. A content hash prevents duplicate chunks. A changed source retires the old derived record and indexes the new version. Deleting a customer or system must delete its index records and the local source mapping.

Chunk by operational meaning: one incident evidence item, one runbook step, one message explanation, one object-flow section, or one bounded timeline slice. Do not split a command, message key, or evidence citation across unrelated chunks.

## Retrieval and grounded AI

The retrieval service should accept a typed `SupportContext` containing the current customer, system, job, incident, signal, business service, operator permissions, and requested task. It should return a typed `ContextPack` with ranked records, citations, freshness, and excluded-record reasons.

Retrieval sequence:

1. Build the current context from fresh monitor state and the selected job.
2. Apply authorization and customer/system filters before search.
3. Run lexical and vector retrieval with bounded limits.
4. Apply freshness, status, source, and permission filters.
5. Rerank for job identity, message/condition match, runtime compatibility, verified outcome, and recency.
6. Deduplicate related records and cap the context budget.
7. Return citations and explicit missing-evidence reasons.

The model prompt must demand this response shape:

```text
Observed facts
Matching evidence [citations]
Interpretation
Missing or stale evidence
Suggested checks
Approved procedure, if any [runbook citation]
Next safe action
```

The provider adapter must treat retrieved text as untrusted data. Retrieved content cannot override system instructions, create permissions, or become a command payload. Structured output validation must reject missing citations for factual claims, unsupported procedure steps, and content outside the selected job or requested support context.

## MCP Skills area

Add **Settings → Skills & MCP**, also reachable from the AI & knowledge category. The approved design uses separate lists for reusable instruction skills and MCP tool/resource connections within this Settings area. Its selected-item detail should show:

- Installed skills and available customer-approved skills.
- Skill name, ID, version, owner, transport/provider, status, and last health check.
- Exposed tools, resources, and prompts with their input/output schemas.
- Scope: customer, IBM i system, business service, job, incident, or read-only global.
- Capability class: `read`, `investigate`, `prepare`, `write`, or `admin`.
- Required permissions, evidence requirements, timeout, rate limit, and approval class.
- Enable, disable, configure, test a safe read-only capability, and revoke.

Use a declarative manifest. A minimal skill definition includes:

```text
id, name, version, owner, provider, transport
tools[], resources[], prompts[]
scopes[], capability, requiredPermissions, approvalClass
inputSchema, outputSchema, evidenceRequirements
healthCheck, timeoutMs, rateLimit, enabled
```

Initial support should be local and internal skills that reuse existing iMonitor services. Remote MCP support can follow after authentication, transport, secret handling, and customer review are complete.

### MCP safety boundary

- Resources and prompts are read-only by default and still pass scope checks.
- A write tool is `approvalRequired` and can only be called through the action planner.
- AI may recommend a skill but cannot install, enable, grant, or revoke one.
- Every invocation records skill version, tool, actor, scope, input hash, approval, result, and error.
- Each invocation gets a timeout, rate limit, cancellation path, and replay protection.
- A skill can be disabled immediately; future calls fail closed.
- Secrets remain in the protected main-process store and are never placed in prompts, embeddings, logs, or external tickets.

## Action intelligence

RAG should improve decisions without becoming an uncontrolled execution channel. Keep the action lifecycle explicit:

```text
retrieve → propose → preview → authorize → preflight
         → execute → fresh read → verify → record outcome
```

The preview must show the target job, command family, current evidence, expected effect, risk class, required permission, and verification rule. A failed or unknown verification pauses the workflow and offers escalation. A retrieved runbook can guide the action but cannot bypass the existing authorization and IBM i authority checks.

## UI and operator experience

The user-approved [UI design contract](UI_DESIGN.md) and [seven-screen sketch](design/approved-ui.html) define the target layout. Existing features retain contextual entry points as the screens are simplified.

- Main navigation is ActionBoard, Knowledge, Settings. Connect is compact and profile-first.
- The board has a slim health strip, one job list with actual conditions and owners, and a compact AI dock. Job queues stay collapsed before Support.
- Independent job windows have Overview and History. Technical details expand; AI conversation is an in-window state. Additional actions are contextual.
- The textarea uses the full width and grows with input. Attachments sit bottom-left; small provider/model selection and Send sit bottom-right. Unavailable models cannot be selected.
- Source chips expand evidence, freshness, and uncertainty only when requested.
- Knowledge uses searchable rows and a short Add/review flow. Skills and MCP connections have distinct lists inside Settings.
- Settings opens one category at a time. Retention, storage/provider health, access, and integrations belong there rather than on the daily board.

The shared layouts are owned by #57–#60. Feature-specific UI and tests are part of #41–#56, with backend-only work explicitly mapped to its consuming screen.

## Delivery phases and ticket map

The GitHub project **AI + ActionBoard** is the execution source of truth. The parent story is issue #40. Begin with #57 → #58 → #59 → #60 using current services, then deliver #41–#56 in dependency order. The parent groups work and is not a blocking prerequisite for its children.

| Phase | Outcome | Tickets | Estimate |
|---|---|---|---:|
| Shared UI first | Approved shell/Connect, ActionBoard, job window, and Settings | #57–#60 | 29 |
| Foundation | Scoped contracts and safe storage boundaries | #41–#43 | 21 |
| Knowledge | Ingestion, library UI, and index/provider configuration | #44–#45 | 21 |
| Retrieval | Hybrid search, context packs, and evidence detail | #46–#47 | 16 |
| Grounded AI | Job-scoped conversation and retrieval evaluation | #48–#49 | 18 |
| MCP Skills | Registry UI, safe resources, and controlled tools | #50–#52 | 26 |
| Controlled Actions | Verified action planning and learning loop | #53–#54 | 16 |
| Operations and pilot | Operational settings, docs, UI regression, and live validation | #55–#56 | 21 |

Total: **168 story points**, including the approved UI work and tests. Estimates are relative planning values, not hours or promises. Each ticket includes its own acceptance criteria and dependency references.

## Review gate: revised decisions

The draft was reviewed against the current iMonitor architecture, the L1/L2/L3 operating model, and production-support risks. These decisions are part of the plan:

1. **Vector database:** provider-neutral adapter; local-first default; optional Qdrant/pgvector-style backends. This keeps pilots usable and avoids a vendor lock-in decision before data shape and scale are known.
2. **Search:** hybrid lexical plus vector retrieval with metadata filters. Exact IBM i identifiers must not depend on semantic similarity.
3. **Truth:** IBM i observations and approved customer records are evidence; model output and unapproved memory are interpretations or suggestions.
4. **Isolation:** customer and system scope is enforced before retrieval and again before display/action. No shared cross-customer memory in the first release.
5. **MCP:** start with local/internal, read-only capabilities. Write tools require explicit approval, fresh preflight, verification, audit, and revocation.
6. **Learning:** verified outcomes create drafts for review. The system does not automatically promote a successful action into trusted memory.
7. **Autonomy:** fully automatic recovery stays future scope until retrieval quality, runbook coverage, permissions, recovery verification, and rollback evidence meet a separate release gate.
8. **Code shape:** add small feature modules around the existing main-process boundaries. Do not create a framework or split every function into its own file.
9. **Approved UI:** follow the seven-screen reference in `UI_DESIGN.md`. Shared layout work lands first, while each feature owns the UI and tests in its assigned screen. The accepted Overview/History task layout and controls beneath a full-width composer supersede the initial UI draft.

## Definition of done for the program

- The app can ingest an approved source, index it, retrieve it for the correct customer/system, and show a citation.
- A missing, stale, out-of-scope, or redacted record is handled explicitly.
- A selected-job AI response cannot answer from unrelated job or customer context.
- A configured MCP skill can be inspected, scoped, health checked, disabled, and audited.
- A write capability cannot run without the required operator permission and approval.
- Every production action has a preflight, an audit record, and a fresh verification result.
- Retrieval and grounding quality are measured with a golden query set and regression tests.
- Retention, purge, reindex, export, and provider failure behavior are documented and tested.
- Beginner user documentation and developer documentation explain the same supported boundaries.
- Live IBM i/client validation is recorded separately from automated demo evidence before deployment claims are made.

## References

- [Model Context Protocol tools specification](https://modelcontextprotocol.io/specification/draft/server/tools)
- [Model Context Protocol schema reference](https://modelcontextprotocol.io/specification/2025-06-18/schema)
- [Qdrant filtering](https://qdrant.tech/documentation/search/filtering/)
- [Qdrant multitenancy](https://qdrant.tech/documentation/manage-data/multitenancy/)
- [pgvector filtering and multitenancy notes](https://github.com/pgvector/pgvector#filtering)
