# Approved UI design: AI + ActionBoard

The user approved the seven interactive screen sketches on 13 September 2026. This document and the [saved sketch](design/approved-ui.html) are the UI acceptance reference for [Project 8](https://github.com/orgs/iNewTech/projects/8), parent [#40](https://github.com/iNewTech/iMonitor/issues/40).

The sketch is a design reference with illustrative data and local interactions. It does not prove a feature is implemented or connected. Run `npm run docs:serve`, then open `/design/approved-ui.html` to explore it. The original screen layout has been preserved in the standalone reference.

## Shared design rules

- Main navigation contains **ActionBoard, Knowledge, Settings**. Independent job windows do not repeat that navigation.
- The daily workspace contains one health strip, one jobs toolbar/table, and an AI composer. Show details, configuration, and explanations only when requested.
- Use quiet surfaces, subtle separators, restrained teal accents, readable text, and compact controls. Show a label with each status color. Use both comfortable and compact density without shrinking text to fit.
- Keep native window controls once, with no decorative duplicate traffic lights. Maintain spacing between real sections; avoid large empty banners or nested cards.
- The composer uses a full-width growing textarea. Attachments/context are bottom-left; compact provider/model selection and Send are bottom-right. Controls must never reduce the text area's width.
- Preserve all existing operational features through a documented entry point. Collapsing UI must not remove access checks, persistent history, ticket synchronization, or recovery verification.
- Unavailable features show honest setup/loading/empty/error states. Do not display fictional sources, recommendations, connected integrations, or success messages from the sketch in production.
- Match the approved information hierarchy and spacing; use responsive behavior where an exact desktop arrangement cannot fit. Keep feature code within coherent modules instead of accumulating unrelated changes in entry files.

## Screen contract and ownership

| Sketch | Required modification | Delivery owner |
|---|---|---|
| 1. Connect | Bounded saved-profile form; Connect first; Edit and Add system reveal fields; first use opens setup | [#57](https://github.com/iNewTech/iMonitor/issues/57) |
| 2. ActionBoard | Slim system strip, searchable jobs list, actual issue, owner, Focus next, compact AI dock, queues before Support | [#58](https://github.com/iNewTech/iMonitor/issues/58) |
| 3. Job task | Independent native window; Overview/History; contextual actions; collapsible technical details | [#59](https://github.com/iNewTech/iMonitor/issues/59) |
| 4. AI & evidence | Expanded conversation inside the same job window; clickable sources; freshness and uncertainty | [#47](https://github.com/iNewTech/iMonitor/issues/47), [#48](https://github.com/iNewTech/iMonitor/issues/48) |
| 5. Knowledge | Searchable rows, review state, source detail, Add knowledge and review workflows | [#44](https://github.com/iNewTech/iMonitor/issues/44), [#54](https://github.com/iNewTech/iMonitor/issues/54) |
| 6. Settings | One active category, compact setting rows, integration icons and detail/configure flow | [#60](https://github.com/iNewTech/iMonitor/issues/60); configuration in [#45](https://github.com/iNewTech/iMonitor/issues/45), [#48](https://github.com/iNewTech/iMonitor/issues/48), [#55](https://github.com/iNewTech/iMonitor/issues/55) |
| 7. Skills & MCP | Settings subpage; separate instruction skills and tool connections; scoped detail and activity | [#50](https://github.com/iNewTech/iMonitor/issues/50), [#51](https://github.com/iNewTech/iMonitor/issues/51), [#52](https://github.com/iNewTech/iMonitor/issues/52) |

### 1. Connect

UI-01 (#57) delivers this bounded form, shared destination navigation, profile edit identity fix, retry states, and per-profile board draft restoration. [Validation and screenshots](design/ui57/README.md) record the implementation.

The form stays near 450 CSS px on a large desktop and reflows within smaller windows. Show the selected saved system, operator, and **Connect & monitor**. Edit reveals existing connection fields; Add another system opens the new-profile flow. With no profiles, show that flow immediately. Keep profile rename/delete, connection failure/retry, protected credentials, version, entitlement, theme, and pre-connection Support accessible through compact controls.

### 2. ActionBoard

UI-02 implements the subsequently approved [minimal board sketch](design/minimal-actionboard.html); see [implementation screenshots and feature entry points](design/ui58/README.md). The operator chose this board as the first runtime delivery; Connect/shared navigation is now delivered in #57; the job-window redesign (#59) and Settings categories (#60) remain separate. UI-01 now opens Knowledge as a clearly labelled library placeholder with Analyze code; no ingestion or retrieval is claimed. Existing Resolution Memory is available in job tasks.

Move basic system information into one top strip. Show CPU, job count, incident count, connection state, and observation time without duplicate statistic cards. Keep one search/filter toolbar and the jobs table. Show the specific condition, such as **Lock wait** or **High CPU · 62%**, instead of a generic ISSUE badge alongside a reassuring Running badge. Technical execution state remains available in details.

Search, status/subsystem filters, My work, Focus next, owner, and polling controls remain available. Polling must preserve selection, scrolling, focus, text, and open task windows. The growing composer sits under the list. Routine provider-ready copy stays out of the idle view; setup problems remain discoverable. Job queues stay collapsed near the bottom before Support. Background health, support outcomes, and the companion remain available through compact entry points.

### 3. Job task

Use one independent window per qualified job identity. Opening another job creates another window; reopening the same job focuses it. Begin around 680 CSS px of content, subject to platform limits. Use Overview and History as the only persistent tabs. The header identifies the system and job; Overview explains the issue, owner, support stage, configured impact or Unknown, freshness, and next check.

Show **Claim work** when unassigned. After claiming, the primary action becomes the applicable investigation step. **Explain & resolve** opens the conversation within the same window. Place Handoff, linked ticket, Mark work done, Remove claim, and eligible job operations under More or a compact responsive row. High-impact operations still show a specific preview/confirmation. During handoff, the original operator remains responsible until the recipient accepts. Monitoring-confirmed recovery controls issue removal.

Keep notes and all history events. Technical details expand. Resource graphs, runbook execution, Resolution Memory, recurring-problem work, and replay training remain reachable contextually. Each migrated capability must have a tested entry point. Polling, reconnect, and switching views must not erase work in progress.

### 4. AI & evidence

This is a conversation state inside the job window, not a fourth main navigation item or another permanent tab. Show a concise answer, source chips, observation time, unknowns, and the recommended check. Expand the source excerpt, provenance, and review history only when a citation is selected. Read-only inspection and mutating action previews must be distinguishable.

The composer remains full-width and grows as the operator types. Provider/model selection opens compact choices; models that are unconfigured or unavailable cannot be selected. Preserve board versus job scope. Returning to Overview must retain the conversation and draft. Handle no evidence, conflicting/stale evidence, cancellation, and provider failures without fabricating guidance. Valid citation IDs alone do not prove a factual claim is supported; the grounding evaluation must test support.

### 5. Knowledge

Use a searchable list with name, type, review/readiness state, reviewer/source, and update time. Add knowledge opens one short document/type/scope form. Show indexing progress or failure inline with the source. Selecting a row opens its content and review history. Verified incident outcomes enter Needs review before approval; retired content cannot masquerade as current approved guidance.

Keep original documents and scoped deletion/reindex controls reachable. Approved reports from object analysis can enter the same library; **Analyze code** remains a secondary entry point for the existing source browser, call graph, compile plan, and report tools. Vectors, chunk tuning, and debugging scores do not become permanent operator panels.

### 6. Settings

Use General, Monitoring, AI & knowledge, Integrations, Skills & MCP, Access, and Storage categories. Only the selected category opens. On narrow windows the category navigation wraps or collapses without hiding the current section. Each row shows its value/status and Manage. Editing a different item must not silently discard unsaved input.

Monitoring holds custom polling seconds, watch rules, channels, and background/login collection. AI & knowledge holds model and storage connections. Integrations show installed icons with accessible names and configured status. Available items open detail, configuration, test/save, then move to installed only after valid persisted setup. Keep ClickUp/Jira/Slack/Email/SMS and existing entitlement behavior. Skills & MCP has its own subpage. Access holds scope and permission management. Storage holds counts, retention, purge/reindex previews, and health.

### 7. Skills & MCP

Keep two lists within this Settings area: **Skills** are reviewed reusable instructions; **MCP connections** expose tools/resources/prompts. They may be linked but are not interchangeable concepts or separate dashboard panels.

Add lets the operator choose a skill package or an approved server connection. Inspect reveals instructions or capabilities, version, owner, scope, permissions, health, and activity. Enable/disable, safe read-only tests, and revoke appear in the selected item's detail. A skill cannot grant itself tool access. Write tools remain behind the existing action preview, permission check, approval, and verification flow.

## Feature-ticket integration

Every existing ticket #41–#56 includes a UI acceptance section or an explicit consumer/UI boundary. Backend contracts feed these screens; they do not each get a new panel. #44 owns the Knowledge library foundation, #47 evidence detail, #48 grounded conversation, #50 Skills & MCP management, #53 action-preview integration, #54 resolution review, and #55 operational settings. #49 evaluates grounding behavior; #56 owns the full cross-screen UI regression and release evidence.

## Implementation order and estimates

1. **#57** shared shell and Connect: 8 points.
2. **#58** ActionBoard using current monitoring/AI services: 8 points.
3. **#59** job window using current workflow/actions: 8 points.
4. **#60** Settings categories and existing integrations: 5 points.
5. **#41 onward** deliver the knowledge/RAG/MCP contracts and feature-owned UI in dependency order. New features populate the agreed screen slots as they become available.

This starts with visible simplification. #57–#60 do not wait for RAG or MCP implementation, and must preserve the current feature set. The parent #40 groups delivery; it is not a blocking prerequisite for its children.

Existing feature estimates were revised for added UI and tests: #44 8→13, #45 5→8, #47 5→8, #48 8→13, #50 8→13, #55 5→8, #56 8→13. The 16 original feature tickets now total **139 points**; four layout tickets add **29**, for **168 points** overall. These are relative estimates, not hours or delivery promises.

## Acceptance and test evidence

For each screen ticket and each feature that changes it:

- Check supported minimum native window sizes, 1024×768 and 1440×900 desktop layouts, light/dark themes, keyboard navigation, focus restoration, long job/model/provider names, and text scaling. Compact mode reduces spacing rather than type size. 320px sketch reflow is reference behavior, not a claim that the desktop app supports a 320px native window.
- Verify empty/loading/offline/error/permission-denied states, first-use setup, unavailable models, stale evidence, retries, and unsaved inputs. Do not hide an actionable error to preserve a clean layout.
- Exercise polling during typing, multiple task windows, reconnect with the same profile, owner/history persistence, ticket creation idempotency, handoff acceptance, and recovery verification with isolated fixtures.
- Test Add knowledge, review/retire, source citations, skill enable/disable/revoke, connection configuration, storage/purge preview, and denied/approved action flows in the owning feature ticket.
- Capture before/after screenshots against the saved sketch and attach focused test evidence. Run the full suite at the shared-UI milestone and the final feature milestone. Use live IBM i/client evidence separately for deployment claims.
- Update user and developer docs as behavior ships. Close a ticket only after implementation, review, appropriate tests, documentation, and ticket-referenced commit/tag/push are recorded. Project 8 Done means the ticket acceptance criteria are met, not that a client deployment occurred.

## Approval record

Approved reference: the seven-screen sketch accepted in this conversation. This supersedes the initial plan's five persistent job tabs, provider controls beside the textarea, and permanently expanded settings panels. The future application should follow this design; current runtime behavior remains described by the user and technical guides until implementation tickets ship.
