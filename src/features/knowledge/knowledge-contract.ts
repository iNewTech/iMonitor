/** Shared, provider-neutral contracts for scoped knowledge and support context. */

export const KNOWLEDGE_SCHEMA_VERSION = 1;
export const MAX_KNOWLEDGE_CONTENT_LENGTH = 32_000;
export const MAX_KNOWLEDGE_TITLE_LENGTH = 240;
export const MAX_CONTEXT_TASK_LENGTH = 2_000;

export type KnowledgeSourceType =
    | 'incident'
    | 'evidence'
    | 'job'
    | 'runbook'
    | 'resolution'
    | 'object-analysis'
    | 'operator-guide'
    | 'integration-history';

export type KnowledgeStatus = 'observed' | 'approved' | 'stale' | 'draft' | 'retired' | 'blocked' | 'unknown';
export type KnowledgeConfidence = 'confirmed' | 'high' | 'medium' | 'low' | 'unknown';
export type SourceReferenceKind = 'file' | 'incident' | 'job' | 'record' | 'url';

export interface KnowledgeSourceRef {
    kind: SourceReferenceKind;
    id: string;
    locator: string;
}

export interface KnowledgeEvidenceRef {
    id: string;
    label: string;
    sourceRef: KnowledgeSourceRef;
}

export interface KnowledgeEnvironment {
    ibmiRelease?: string;
    ptfLevel?: string;
    jobType?: string;
    subsystem?: string;
}

export interface KnowledgeRecord {
    id: string;
    schemaVersion: number;
    sourceType: KnowledgeSourceType;
    title: string;
    content: string;
    operational: boolean;
    customerScope: string;
    systemScope: string;
    serviceScope?: string;
    permissions: string[];
    sourceRef: KnowledgeSourceRef;
    evidenceRefs: KnowledgeEvidenceRef[];
    observedAt: string;
    indexedAt?: string;
    expiresAt?: string;
    contentHash: string;
    redactionProfile: string;
    confidence: KnowledgeConfidence;
    status: KnowledgeStatus;
    incidentKind?: string;
    qualifiedJob?: string;
    subsystem?: string;
    queue?: string;
    objectNames: string[];
    runbookId?: string;
    runbookVersion?: number;
    reviewer?: string;
    reviewAt?: string;
    retiredAt?: string;
    blockedReason?: string;
    environment?: KnowledgeEnvironment;
}

export interface SupportJobContext {
    qualifiedName: string;
    subsystem?: string;
    user?: string;
}

export interface SupportIncidentContext {
    id: string;
    kind?: string;
    fingerprint?: string;
}

export interface SupportContext {
    customerScope: string;
    systemScope: string;
    selectedJob?: SupportJobContext;
    incident?: SupportIncidentContext;
    signal?: string;
    businessService?: string;
    operatorPermissions: string[];
    requestedTask: string;
}

export interface KnowledgeCitation {
    id: string;
    recordId: string;
    label: string;
    sourceRef: KnowledgeSourceRef;
    status: KnowledgeStatus;
    excerpt?: string;
    observedAt?: string;
}

export interface ContextPack {
    schemaVersion: number;
    generatedAt: string;
    records: KnowledgeRecord[];
    citations: KnowledgeCitation[];
    excluded: Array<{ recordId: string; reason: string }>;
    freshness: 'current' | 'mixed' | 'stale' | 'unknown';
    missingEvidence: string[];
}

export interface ContractValidation<T> {
    valid: boolean;
    errors: string[];
    value?: T;
}

const SOURCE_TYPES: KnowledgeSourceType[] = [
    'incident', 'evidence', 'job', 'runbook', 'resolution', 'object-analysis', 'operator-guide', 'integration-history'
];
const STATUSES: KnowledgeStatus[] = ['observed', 'approved', 'stale', 'draft', 'retired', 'blocked', 'unknown'];
const CONFIDENCE_LEVELS: KnowledgeConfidence[] = ['confirmed', 'high', 'medium', 'low', 'unknown'];
const SOURCE_KINDS: SourceReferenceKind[] = ['file', 'incident', 'job', 'record', 'url'];
const SECRET_MARKER = /(password|passphrase|secret|token|api[_-]?key|authorization|credential)/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

const STATUS_TRANSITIONS: Record<KnowledgeStatus, KnowledgeStatus[]> = {
    observed: ['approved', 'draft', 'stale', 'blocked', 'retired'],
    draft: ['approved', 'blocked', 'retired'],
    approved: ['stale', 'blocked', 'retired'],
    stale: ['draft', 'approved', 'retired', 'blocked'],
    blocked: ['draft', 'retired'],
    unknown: ['observed', 'draft', 'blocked', 'retired'],
    retired: []
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredText(value: unknown, name: string, max: number, errors: string[]) {
    if (typeof value !== 'string' || !value.trim()) {
        errors.push(`${name} is required.`);
        return '';
    }
    const normalized = value.trim();
    if (normalized.length > max) errors.push(`${name} exceeds ${max} characters.`);
    if (/\p{Cc}/u.test(normalized)) errors.push(`${name} contains control characters.`);
    return normalized;
}

function validateDate(value: unknown, name: string, errors: string[], optional = false) {
    if (value === undefined && optional) return;
    if (typeof value !== 'string' || !ISO_DATE.test(value) || Number.isNaN(Date.parse(value))) {
        errors.push(`${name} must be an ISO UTC timestamp.`);
    }
}

function validateSourceRef(candidate: unknown, name: string, errors: string[]): KnowledgeSourceRef | undefined {
    if (!isRecord(candidate)) {
        errors.push(`${name} is required.`);
        return undefined;
    }
    const kind = candidate.kind;
    if (!SOURCE_KINDS.includes(kind as SourceReferenceKind)) errors.push(`${name}.kind is invalid.`);
    const id = requiredText(candidate.id, `${name}.id`, 240, errors);
    const locator = requiredText(candidate.locator, `${name}.locator`, 500, errors);
    if (SECRET_MARKER.test(`${id} ${locator}`)) errors.push(`${name} must not contain credential markers.`);
    if (kind === 'url' && !/^https:\/\//i.test(locator)) errors.push(`${name}.locator must use HTTPS for URL sources.`);
    return {
        kind: kind as SourceReferenceKind,
        id,
        locator
    };
}

/** Validates a stable reference before it can be persisted or shown as a citation. */
export function validateKnowledgeSourceRef(candidate: unknown): ContractValidation<KnowledgeSourceRef> {
    const errors: string[] = [];
    const value = validateSourceRef(candidate, 'sourceRef', errors);
    return { valid: errors.length === 0, errors, value: errors.length === 0 ? value : undefined };
}

/** Validates a retrieval-eligible record and returns no partial success value on failure. */
export function validateKnowledgeRecord(candidate: unknown): ContractValidation<KnowledgeRecord> {
    const errors: string[] = [];
    if (!isRecord(candidate)) return { valid: false, errors: ['KnowledgeRecord must be an object.'] };

    const sourceType = candidate.sourceType;
    const status = candidate.status;
    const confidence = candidate.confidence;
    if (!Number.isInteger(candidate.schemaVersion) || candidate.schemaVersion !== KNOWLEDGE_SCHEMA_VERSION) errors.push('schemaVersion is unsupported.');
    if (!SOURCE_TYPES.includes(sourceType as KnowledgeSourceType)) errors.push('sourceType is invalid.');
    if (!STATUSES.includes(status as KnowledgeStatus)) errors.push('status is invalid.');
    if (!CONFIDENCE_LEVELS.includes(confidence as KnowledgeConfidence)) errors.push('confidence is invalid.');

    const id = requiredText(candidate.id, 'id', 240, errors);
    const title = requiredText(candidate.title, 'title', MAX_KNOWLEDGE_TITLE_LENGTH, errors);
    const content = requiredText(candidate.content, 'content', MAX_KNOWLEDGE_CONTENT_LENGTH, errors);
    const customerScope = requiredText(candidate.customerScope, 'customerScope', 160, errors);
    const systemScope = requiredText(candidate.systemScope, 'systemScope', 160, errors);
    const operational = candidate.operational;
    if (typeof operational !== 'boolean') errors.push('operational is required.');
    if (operational === true && (!customerScope || !systemScope)) errors.push('Operational records require customerScope and systemScope.');

    if (!Array.isArray(candidate.permissions) || candidate.permissions.some((item) => typeof item !== 'string' || !item.trim())) errors.push('permissions must be a list of names.');
    const sourceRef = validateSourceRef(candidate.sourceRef, 'sourceRef', errors);
    if (!Array.isArray(candidate.evidenceRefs) || candidate.evidenceRefs.length > 100) {
        errors.push('evidenceRefs must contain at most 100 references.');
    }
    const evidenceRefs = Array.isArray(candidate.evidenceRefs)
        ? candidate.evidenceRefs.map((item, index) => {
            const ref = isRecord(item) ? item : {};
            const evidenceId = requiredText(ref.id, `evidenceRefs[${index}].id`, 240, errors);
            const label = requiredText(ref.label, `evidenceRefs[${index}].label`, 240, errors);
            const evidenceSourceRef = validateSourceRef(ref.sourceRef, `evidenceRefs[${index}].sourceRef`, errors);
            return { id: evidenceId, label, sourceRef: evidenceSourceRef as KnowledgeSourceRef };
        })
        : [];

    validateDate(candidate.observedAt, 'observedAt', errors);
    validateDate(candidate.indexedAt, 'indexedAt', errors, true);
    validateDate(candidate.expiresAt, 'expiresAt', errors, true);
    validateDate(candidate.reviewAt, 'reviewAt', errors, true);
    validateDate(candidate.retiredAt, 'retiredAt', errors, true);
    const contentHash = requiredText(candidate.contentHash, 'contentHash', 64, errors);
    if (!/^[a-f0-9]{64}$/i.test(contentHash)) errors.push('contentHash must be a SHA-256 hex value.');
    const redactionProfile = requiredText(candidate.redactionProfile, 'redactionProfile', 120, errors);
    const objectNames = Array.isArray(candidate.objectNames) && candidate.objectNames.every((item) => typeof item === 'string')
        ? candidate.objectNames.map((item) => item.trim()).filter(Boolean).slice(0, 100)
        : [];
    if (!Array.isArray(candidate.objectNames)) errors.push('objectNames must be a list.');
    if (typeof candidate.runbookVersion !== 'undefined' && (!Number.isInteger(candidate.runbookVersion) || Number(candidate.runbookVersion) < 1)) errors.push('runbookVersion must be a positive integer.');

    if (status === 'approved' && (!String(candidate.reviewer || '').trim() || !candidate.reviewAt)) errors.push('Approved records require reviewer and reviewAt.');
    if (status === 'blocked' && !String(candidate.blockedReason || '').trim()) errors.push('Blocked records require blockedReason.');
    if (status === 'retired' && !candidate.retiredAt) errors.push('Retired records require retiredAt.');
    if (candidate.expiresAt && candidate.indexedAt && Date.parse(String(candidate.expiresAt)) < Date.parse(String(candidate.indexedAt))) errors.push('expiresAt cannot precede indexedAt.');

    if (errors.length) return { valid: false, errors };
    return {
        valid: true,
        errors: [],
        value: {
            id,
            schemaVersion: KNOWLEDGE_SCHEMA_VERSION,
            sourceType: sourceType as KnowledgeSourceType,
            title,
            content,
            operational: operational as boolean,
            customerScope,
            systemScope,
            serviceScope: optionalText(candidate.serviceScope, 160),
            permissions: normalizeList(candidate.permissions),
            sourceRef: sourceRef as KnowledgeSourceRef,
            evidenceRefs,
            observedAt: String(candidate.observedAt),
            indexedAt: optionalText(candidate.indexedAt),
            expiresAt: optionalText(candidate.expiresAt),
            contentHash,
            redactionProfile,
            confidence: confidence as KnowledgeConfidence,
            status: status as KnowledgeStatus,
            incidentKind: optionalText(candidate.incidentKind, 120),
            qualifiedJob: optionalText(candidate.qualifiedJob, 240),
            subsystem: optionalText(candidate.subsystem, 120),
            queue: optionalText(candidate.queue, 120),
            objectNames,
            runbookId: optionalText(candidate.runbookId, 240),
            runbookVersion: candidate.runbookVersion as number | undefined,
            reviewer: optionalText(candidate.reviewer, 160),
            reviewAt: optionalText(candidate.reviewAt),
            retiredAt: optionalText(candidate.retiredAt),
            blockedReason: optionalText(candidate.blockedReason, 500),
            environment: normalizeEnvironment(candidate.environment)
        }
    };
}

/** Validates context passed to retrieval without allowing credentials or provider internals. */
export function validateSupportContext(candidate: unknown): ContractValidation<SupportContext> {
    const errors: string[] = [];
    if (!isRecord(candidate)) return { valid: false, errors: ['SupportContext must be an object.'] };
    const customerScope = requiredText(candidate.customerScope, 'customerScope', 160, errors);
    const systemScope = requiredText(candidate.systemScope, 'systemScope', 160, errors);
    const requestedTask = requiredText(candidate.requestedTask, 'requestedTask', MAX_CONTEXT_TASK_LENGTH, errors);
    if (SECRET_MARKER.test(JSON.stringify(candidate))) errors.push('SupportContext must not contain credentials.');
    if (!Array.isArray(candidate.operatorPermissions) || candidate.operatorPermissions.some((item) => typeof item !== 'string' || !item.trim())) errors.push('operatorPermissions must be a list of names.');
    const selectedJob = normalizeJobContext(candidate.selectedJob, errors);
    const incident = normalizeIncidentContext(candidate.incident, errors);
    if (errors.length) return { valid: false, errors };
    return {
        valid: true,
        errors: [],
        value: {
            customerScope,
            systemScope,
            selectedJob,
            incident,
            signal: optionalText(candidate.signal, 240),
            businessService: optionalText(candidate.businessService, 160),
            operatorPermissions: normalizeList(candidate.operatorPermissions),
            requestedTask
        }
    };
}

/** Applies the explicit review lifecycle and rejects unsafe status jumps. */
export function transitionKnowledgeStatus(record: KnowledgeRecord, nextStatus: KnowledgeStatus, now: string, reviewer?: string): KnowledgeRecord {
    if (!STATUSES.includes(nextStatus)) throw new Error('Unknown knowledge status.');
    if (!STATUS_TRANSITIONS[record.status].includes(nextStatus)) throw new Error(`Cannot transition knowledge from ${record.status} to ${nextStatus}.`);
    const dateErrors: string[] = [];
    validateDate(now, 'now', dateErrors, false);
    if (dateErrors.length) throw new Error(dateErrors[0]);
    const next = { ...record, status: nextStatus };
    if (nextStatus === 'approved') {
        if (!reviewer?.trim()) throw new Error('Approved records require a reviewer.');
        next.reviewer = reviewer.trim();
        next.reviewAt = now;
    }
    if (nextStatus === 'retired') next.retiredAt = now;
    if (nextStatus === 'blocked' && !next.blockedReason) next.blockedReason = 'Blocked during review.';
    return next;
}

/** Returns the display status without mutating the persisted record. */
export function getKnowledgeFreshness(record: Pick<KnowledgeRecord, 'status' | 'expiresAt'>, now = new Date().toISOString()): KnowledgeStatus {
    if (record.status === 'approved' && record.expiresAt && Date.parse(record.expiresAt) <= Date.parse(now)) return 'stale';
    return record.status;
}

function optionalText(value: unknown, max = 240) {
    if (typeof value !== 'string' || !value.trim()) return undefined;
    return value.trim().slice(0, max);
}

function normalizeList(value: unknown) {
    return Array.from(new Set((Array.isArray(value) ? value : []).map((item) => String(item).trim()).filter(Boolean))).slice(0, 100);
}

function normalizeEnvironment(value: unknown): KnowledgeEnvironment | undefined {
    if (!isRecord(value)) return undefined;
    return {
        ibmiRelease: optionalText(value.ibmiRelease, 80),
        ptfLevel: optionalText(value.ptfLevel, 120),
        jobType: optionalText(value.jobType, 80),
        subsystem: optionalText(value.subsystem, 120)
    };
}

function normalizeJobContext(value: unknown, errors: string[]): SupportJobContext | undefined {
    if (value === undefined) return undefined;
    if (!isRecord(value)) {
        errors.push('selectedJob must be an object.');
        return undefined;
    }
    const qualifiedName = requiredText(value.qualifiedName, 'selectedJob.qualifiedName', 240, errors);
    return { qualifiedName, subsystem: optionalText(value.subsystem, 120), user: optionalText(value.user, 120) };
}

function normalizeIncidentContext(value: unknown, errors: string[]): SupportIncidentContext | undefined {
    if (value === undefined) return undefined;
    if (!isRecord(value)) {
        errors.push('incident must be an object.');
        return undefined;
    }
    const id = requiredText(value.id, 'incident.id', 240, errors);
    return { id, kind: optionalText(value.kind, 120), fingerprint: optionalText(value.fingerprint, 240) };
}
