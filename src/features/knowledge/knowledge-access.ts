import {
    getKnowledgeFreshness,
    validateKnowledgeRecord,
    validateKnowledgeSourceRef,
    type ContextPack,
    type ContextPackBudget,
    type ContextPackRelevanceReason,
    type ContextPackScope,
    type KnowledgeRecord
} from './knowledge-contract';
import type { SupportAccessGrant, SupportAccessPermission, SupportAccessStatus } from '../action-board/support-access';

export type KnowledgeAccessIdentity = 'local-owner' | 'delegated';
export type KnowledgeAccessFailure =
    | 'missing-scope'
    | 'missing-identity'
    | 'invalid-context'
    | 'permission-denied'
    | 'missing-grant'
    | 'pending-access'
    | 'expired-access'
    | 'revoked-access'
    | 'out-of-scope-customer'
    | 'out-of-scope-system';

export interface KnowledgeGrantSnapshot {
    organizationId: string;
    operatorId: string;
    systemIds: string[];
    permissions: SupportAccessPermission[];
    status: SupportAccessStatus;
    expiresAt: string;
}

/** Main-process context used for every knowledge read, including delegated support. */
export interface KnowledgeAccessContext {
    customerScope: string;
    systemScope: string;
    operatorId: string;
    operatorPermissions: string[];
    identity: KnowledgeAccessIdentity;
    grant?: KnowledgeGrantSnapshot;
    now?: string;
}

export interface KnowledgeAccessDecision {
    allowed: boolean;
    code?: KnowledgeAccessFailure;
    reason?: string;
}

export interface KnowledgeExclusion {
    recordId: string;
    reason: string;
}

export interface KnowledgeAccessAuditEvent {
    event: 'knowledge-read-denied' | 'knowledge-record-excluded';
    result: 'denied' | 'excluded';
    timestamp: string;
    operatorId: string;
    customerScope?: string;
    systemScope?: string;
    recordId?: string;
    reason: string;
}

export interface ScopedKnowledgeRecords {
    decision: KnowledgeAccessDecision;
    records: KnowledgeRecord[];
    excluded: KnowledgeExclusion[];
    audit: KnowledgeAccessAuditEvent[];
}

export interface ScopedKnowledgeSearchResult {
    success: boolean;
    contextPack?: ContextPack;
    excluded: KnowledgeExclusion[];
    audit: KnowledgeAccessAuditEvent[];
    error?: string;
}

type ReadContextInput = KnowledgeAccessContext | unknown;

const REQUIRED_PERMISSION = /^[a-z][a-z0-9:_-]{0,80}$/i;
const SECRET_MARKER = /(password|passphrase|secret|token|api[_-]?key|authorization|credential)/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const ACCESS_MESSAGES: Record<KnowledgeAccessFailure, string> = {
    'missing-scope': 'An active customer and IBM i system scope are required.',
    'missing-identity': 'An authenticated operator identity is required.',
    'invalid-context': 'The knowledge access context is invalid.',
    'permission-denied': 'The operator is not allowed to read this knowledge.',
    'missing-grant': 'The delegated support grant is missing.',
    'pending-access': 'The delegated support grant has not been accepted.',
    'expired-access': 'The delegated support grant has expired.',
    'revoked-access': 'The delegated support grant was revoked.',
    'out-of-scope-customer': 'The record belongs to another customer.',
    'out-of-scope-system': 'The record belongs to another IBM i system.'
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown, max = 240) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function list(value: unknown) {
    return Array.isArray(value)
        ? Array.from(new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)))
        : [];
}

function nowFor(context: unknown, override?: string) {
    const candidate = override || (isRecord(context) ? context.now : undefined);
    return candidate === undefined ? new Date().toISOString() : String(candidate);
}

function normalizeGrant(value: unknown): KnowledgeGrantSnapshot | undefined {
    if (!isRecord(value)) return undefined;
    const status = value.status;
    if (!['pending', 'active', 'revoked', 'expired'].includes(String(status))) return undefined;
    return {
        organizationId: text(value.organizationId, 160),
        operatorId: text(value.operatorId, 160),
        systemIds: list(value.systemIds),
        permissions: list(value.permissions).filter((item): item is SupportAccessPermission => (
            ['read', 'investigate', 'execute'].includes(item)
        )),
        status: status as SupportAccessStatus,
        expiresAt: text(value.expiresAt, 40)
    };
}

function normalizeContext(input: ReadContextInput): KnowledgeAccessContext | null {
    if (!isRecord(input)) return null;
    const identity = input.identity;
    if (identity !== 'local-owner' && identity !== 'delegated') return null;
    const customerScope = text(input.customerScope, 160);
    const systemScope = text(input.systemScope, 160);
    const operatorId = text(input.operatorId, 160);
    const operatorPermissions = list(input.operatorPermissions);
    const grant = normalizeGrant(input.grant);
    if (SECRET_MARKER.test([customerScope, systemScope, operatorId, operatorPermissions.join(' ')].join(' '))) return null;
    return {
        customerScope,
        systemScope,
        operatorId,
        operatorPermissions,
        identity,
        grant,
        now: nowFor(input)
    };
}

function denied(code: KnowledgeAccessFailure): KnowledgeAccessDecision {
    return { allowed: false, code, reason: ACCESS_MESSAGES[code] };
}

/**
 * Authorizes a knowledge read from trusted main-process identity and grant data.
 * Renderer state alone cannot satisfy this check.
 */
export function authorizeKnowledgeRead(input: ReadContextInput, requiredPermission = 'read', now?: string): KnowledgeAccessDecision {
    if (!REQUIRED_PERMISSION.test(requiredPermission)) return denied('invalid-context');
    const context = normalizeContext(input);
    if (!context) return denied('invalid-context');
    if (!context.customerScope || !context.systemScope) return denied('missing-scope');
    if (!context.operatorId) return denied('missing-identity');
    const timestamp = now || context.now || new Date().toISOString();
    if (!ISO_DATE.test(timestamp) || Number.isNaN(Date.parse(timestamp))) return denied('invalid-context');
    if (!context.operatorPermissions.includes(requiredPermission)) return denied('permission-denied');

    if (context.identity === 'local-owner') return { allowed: true };

    const grant = context.grant;
    if (!grant) return denied('missing-grant');
    if (grant.operatorId !== context.operatorId
        || grant.organizationId !== context.customerScope) return denied('out-of-scope-customer');
    if (!grant.systemIds.includes(context.systemScope)) return denied('out-of-scope-system');
    if (!grant.permissions.includes(requiredPermission as SupportAccessPermission)) return denied('permission-denied');
    if (grant.status === 'revoked') return denied('revoked-access');
    if (grant.status === 'pending') return denied('pending-access');
    if (grant.status === 'expired' || !ISO_DATE.test(grant.expiresAt) || Date.parse(grant.expiresAt) <= Date.parse(timestamp)) {
        return denied('expired-access');
    }
    if (grant.status !== 'active') return denied('permission-denied');
    return { allowed: true };
}

function auditEvent(
    context: unknown,
    event: KnowledgeAccessAuditEvent['event'],
    result: KnowledgeAccessAuditEvent['result'],
    reason: string,
    recordId?: string
): KnowledgeAccessAuditEvent {
    const source = isRecord(context) ? context : {};
    return {
        event,
        result,
        timestamp: nowFor(context),
        operatorId: text(source.operatorId, 160) || 'unknown',
        customerScope: text(source.customerScope, 160) || undefined,
        systemScope: text(source.systemScope, 160) || undefined,
        recordId,
        reason
    };
}

function recordId(value: unknown) {
    if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) return 'unknown-record';
    return value.id.trim().slice(0, 240);
}

function exclusion(id: string, reason: string): KnowledgeExclusion {
    return { recordId: id || 'unknown-record', reason };
}

/** Filters records before a lexical or vector adapter sees them. */
export function filterKnowledgeRecords(
    candidates: readonly unknown[],
    input: ReadContextInput,
    requiredPermission = 'read'
): ScopedKnowledgeRecords {
    const decision = authorizeKnowledgeRead(input, requiredPermission);
    if (!decision.allowed) {
        const excluded = candidates.map((candidate) => exclusion(recordId(candidate), decision.code || 'permission-denied'));
        return {
            decision,
            records: [],
            excluded,
            audit: [auditEvent(input, 'knowledge-read-denied', 'denied', decision.code || 'permission-denied')]
        };
    }

    const context = normalizeContext(input) as KnowledgeAccessContext;
    const records: KnowledgeRecord[] = [];
    const excluded: KnowledgeExclusion[] = [];
    const audit: KnowledgeAccessAuditEvent[] = [];
    candidates.forEach((candidate) => {
        const id = recordId(candidate);
        const validation = validateKnowledgeRecord(candidate);
        if (!validation.valid || !validation.value) {
            const item = exclusion(id, 'invalid-record');
            excluded.push(item);
            audit.push(auditEvent(input, 'knowledge-record-excluded', 'excluded', item.reason, item.recordId));
            return;
        }
        const record = validation.value;
        if (record.customerScope !== context.customerScope) {
            const item = exclusion(record.id, 'out-of-scope-customer');
            excluded.push(item);
            audit.push(auditEvent(input, 'knowledge-record-excluded', 'excluded', item.reason, item.recordId));
            return;
        }
        const systemVisible = record.systemScope === context.systemScope
            || (record.systemScope === '*' && record.operational === false);
        if (!systemVisible) {
            const item = exclusion(record.id, 'out-of-scope-system');
            excluded.push(item);
            audit.push(auditEvent(input, 'knowledge-record-excluded', 'excluded', item.reason, item.recordId));
            return;
        }
        if (!record.permissions.includes(requiredPermission)) {
            const item = exclusion(record.id, 'record-read-permission');
            excluded.push(item);
            audit.push(auditEvent(input, 'knowledge-record-excluded', 'excluded', item.reason, item.recordId));
            return;
        }
        records.push(record);
    });
    return { decision, records, excluded, audit };
}

function safeCitation(record: KnowledgeRecord, citation: unknown, now: string) {
    if (!isRecord(citation) || text(citation.recordId, 240) !== record.id) return undefined;
    const sourceRef = validateKnowledgeSourceRef(citation.sourceRef);
    if (!sourceRef.valid || !sourceRef.value) return undefined;
    if (sourceRef.value.kind !== record.sourceRef.kind
        || sourceRef.value.id !== record.sourceRef.id
        || sourceRef.value.locator !== record.sourceRef.locator) return undefined;
    const label = text(citation.label, 240) || record.title;
    const excerpt = typeof citation.excerpt === 'string' && !SECRET_MARKER.test(citation.excerpt)
        ? citation.excerpt.trim().slice(0, 500) || undefined
        : undefined;
    const computedStatus = getKnowledgeFreshness(record, now);
    return {
        id: text(citation.id, 240) || `citation:${record.id}`,
        recordId: record.id,
        label,
        sourceRef: sourceRef.value,
        sourceType: record.sourceType,
        status: citation.status === 'stale' ? 'stale' : computedStatus,
        excerpt,
        observedAt: record.observedAt
    };
}

function freshness(records: KnowledgeRecord[], citations: ContextPack['citations'] = []): ContextPack['freshness'] {
    if (!records.length) return 'unknown';
    const statuses = records.map((record) => citations.find((citation) => citation.recordId === record.id)?.status || getKnowledgeFreshness(record));
    const stale = statuses.filter((status) => status === 'stale').length;
    if (!stale) return 'current';
    if (stale === statuses.length) return 'stale';
    return 'mixed';
}

/** Sanitizes the adapter result before it can reach the model or renderer. */
export function filterContextPack(pack: ContextPack, input: ReadContextInput, requiredPermission = 'read'): ContextPack {
    const scoped = filterKnowledgeRecords(pack.records, input, requiredPermission);
    const visibleIds = new Set(scoped.records.map((record) => record.id));
    const current = nowFor(input);
    const citations = scoped.records
        .map((record) => {
            const supplied = pack.citations.find((citation) => citation.recordId === record.id);
            return safeCitation(record, supplied || {
                id: `citation:${record.id}`,
                recordId: record.id,
                label: record.title,
                sourceRef: record.sourceRef,
                status: record.status
            }, current);
        })
        .filter((citation): citation is NonNullable<typeof citation> => Boolean(citation));
    const adapterExclusions = Array.isArray(pack.excluded)
        ? pack.excluded
            .filter((item) => visibleIds.has(item.recordId))
            .map((item) => exclusion(item.recordId, 'search-excluded'))
        : [];
    const allExcluded = Array.from(new Map(
        [...scoped.excluded, ...adapterExclusions].map((item) => [`${item.recordId}:${item.reason}`, item])
    ).values());
    const sourceScope = (isRecord(pack.scope) ? pack.scope : {}) as Record<string, unknown>;
    const scope: ContextPackScope = {
        customerScope: text(input && isRecord(input) ? input.customerScope : '', 160),
        systemScope: text(input && isRecord(input) ? input.systemScope : '', 160),
        operatorId: text(input && isRecord(input) ? input.operatorId : '', 160) || undefined,
        qualifiedJob: text(sourceScope.qualifiedJob, 240) || undefined,
        incidentId: text(sourceScope.incidentId, 240) || undefined
    };
    const budget = isRecord(pack.budget) ? {
        maxCharacters: Math.max(0, Math.min(Number(pack.budget.maxCharacters) || 0, 100_000)),
        characters: Math.max(0, Math.min(Number(pack.budget.characters) || 0, 100_000)),
        estimatedTokens: Math.max(0, Math.min(Number(pack.budget.estimatedTokens) || 0, 25_000)),
        recordCount: Math.max(0, Math.min(Number(pack.budget.recordCount) || 0, 100))
    } satisfies ContextPackBudget : undefined;
    const relevanceReasons = Array.isArray(pack.relevanceReasons)
        ? pack.relevanceReasons
            .filter((item): item is ContextPackRelevanceReason => isRecord(item) && visibleIds.has(text(item.recordId, 240)))
            .map((item) => ({
                recordId: text(item.recordId, 240),
                reasons: Array.from(new Set((Array.isArray(item.reasons) ? item.reasons : [])
                    .filter((reason): reason is string => typeof reason === 'string')
                    .map((reason) => reason.trim().slice(0, 240)).filter(Boolean))).slice(0, 8),
                source: ['lexical', 'semantic', 'hybrid'].includes(String(item.source)) ? item.source : 'lexical'
            }))
        : undefined;
    return {
        schemaVersion: pack.schemaVersion,
        generatedAt: pack.generatedAt,
        records: scoped.records,
        citations,
        excluded: allExcluded,
        freshness: freshness(scoped.records, citations),
        missingEvidence: Array.from(new Set((Array.isArray(pack.missingEvidence) ? pack.missingEvidence : [])
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim().slice(0, 240))
            .filter(Boolean))).slice(0, 100),
        scope,
        budget,
        relevanceReasons
    };
}

/** Enforces the pre-adapter and post-adapter checks at a retrieval/IPC boundary. */
export async function runScopedKnowledgeSearch(
    candidates: readonly unknown[],
    input: ReadContextInput,
    searchAdapter: (records: KnowledgeRecord[]) => ContextPack | Promise<ContextPack>,
    requiredPermission = 'read'
): Promise<ScopedKnowledgeSearchResult> {
    const beforeSearch = filterKnowledgeRecords(candidates, input, requiredPermission);
    if (!beforeSearch.decision.allowed) {
        return {
            success: false,
            excluded: beforeSearch.excluded,
            audit: beforeSearch.audit,
            error: beforeSearch.decision.reason
        };
    }
    try {
        const adapterPack = await searchAdapter(beforeSearch.records);
        const returnedPack = filterContextPack(adapterPack, input, requiredPermission);
        const postSearchAudit = returnedPack.excluded.map((item) => (
            auditEvent(input, 'knowledge-record-excluded', 'excluded', item.reason, item.recordId)
        ));
        return {
            success: true,
            contextPack: returnedPack,
            excluded: [...beforeSearch.excluded, ...returnedPack.excluded],
            audit: [...beforeSearch.audit, ...postSearchAudit]
        };
    } catch {
        const failure = auditEvent(input, 'knowledge-read-denied', 'denied', 'search-failed');
        return {
            success: false,
            excluded: beforeSearch.excluded,
            audit: [...beforeSearch.audit, failure],
            error: 'Knowledge search failed safely.'
        };
    }
}

/** Keeps grant snapshots structurally aligned with the existing support grant model. */
export function toKnowledgeGrantSnapshot(grant: SupportAccessGrant): KnowledgeGrantSnapshot {
    return {
        organizationId: grant.organizationId,
        operatorId: grant.operatorId,
        systemIds: grant.systemIds.slice(),
        permissions: grant.permissions.slice(),
        status: grant.status,
        expiresAt: grant.expiresAt
    };
}
