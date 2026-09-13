import type { ActiveJobRecord } from '../../services/ibmi';
import type { AlertKind, MonitorAlert } from '../alerts/alert-model';

export type ResolutionMemoryStatus = 'draft' | 'approved' | 'rejected' | 'retired';
export type ResolutionMemoryReviewAction = 'created' | 'approved' | 'revised' | 'rejected' | 'retired';

export interface ResolutionMemoryReviewEvent {
    action: ResolutionMemoryReviewAction;
    actor: string;
    at: string;
    note?: string;
    version: number;
}

export interface ResolutionMemoryEntry {
    id: string;
    procedureKey: string;
    version: number;
    status: ResolutionMemoryStatus;
    systemId: string;
    serviceName?: string;
    incidentKind: AlertKind;
    incidentFingerprint?: string;
    jobPattern?: string;
    title: string;
    symptoms: string[];
    evidenceRefs: string[];
    failedAttempts: string[];
    successfulAction: string;
    verifiedOutcome: string;
    environment: { systemLabel?: string; jobType?: string; subsystem?: string };
    operator?: string;
    sourceIncidentId?: string;
    reviewer?: string;
    createdAt: string;
    approvedAt?: string;
    retiredAt?: string;
    reviewDueAt?: string;
    supersedesId?: string;
    reviewHistory?: ResolutionMemoryReviewEvent[];
}

export interface ResolutionMemoryStore {
    entries: ResolutionMemoryEntry[];
}

export const DEFAULT_RESOLUTION_MEMORY: ResolutionMemoryStore = { entries: [] };

export interface CreateResolutionDraftInput {
    systemId: string;
    systemLabel?: string;
    job: ActiveJobRecord;
    alert: MonitorAlert;
    operator?: string;
    now: string;
}

export interface ResolutionMemoryRevisionInput {
    title?: string;
    symptoms?: string[];
    evidenceRefs?: string[];
    failedAttempts?: string[];
    successfulAction?: string;
    verifiedOutcome?: string;
    environment?: { systemLabel?: string; jobType?: string; subsystem?: string };
}

export type ResolutionMemoryFreshness = 'current' | 'due' | 'stale';
export type ResolutionMemoryConfidence = 'high' | 'medium' | 'low';

export interface ResolutionMemoryMatch {
    entry: ResolutionMemoryEntry;
    confidence: ResolutionMemoryConfidence;
    freshness: ResolutionMemoryFreshness;
    environmentCompatible: boolean;
    conflict?: string;
    reasons: string[];
}

/** Creates a reviewable memory draft from the durable incident evidence. */
export function createResolutionDraft(input: CreateResolutionDraftInput): ResolutionMemoryEntry {
    const jobName = String(input.job.JOB_NAME || input.job.SUBSYSTEM_JOB || 'job').trim();
    const failedAttempts = input.alert.timeline
        .filter((entry) => /fail|denied|error/i.test(`${entry.label} ${entry.detail || ''}`))
        .map((entry) => `${entry.label}${entry.detail ? `: ${entry.detail}` : ''}`)
        .slice(-10);
    const evidenceRefs = Object.entries(input.alert.evidence || {})
        .filter(([, source]) => source?.status === 'captured')
        .map(([source, value]) => `${source} @ ${value.collectedAt}`);
    return {
        id: `resolution-${Date.now()}`,
        procedureKey: `${input.systemId}:${input.alert.kind}:${jobName}`,
        version: 1,
        status: 'draft',
        systemId: input.systemId,
        incidentKind: input.alert.kind,
        incidentFingerprint: input.alert.correlation?.fingerprint,
        jobPattern: jobName,
        title: input.alert.title || `${input.alert.kind} resolution`,
        symptoms: [input.alert.message, input.alert.detail].filter(Boolean).map(String),
        evidenceRefs,
        failedAttempts,
        successfulAction: input.alert.lastActionSummary || '',
        verifiedOutcome: input.alert.isActive === false ? 'Monitoring confirmed the condition cleared.' : '',
        environment: {
            systemLabel: input.systemLabel,
            jobType: input.job.TYPE || undefined,
            subsystem: input.job.SUBSYSTEM || undefined
        },
        operator: input.operator?.trim() || input.alert.owner?.trim() || undefined,
        sourceIncidentId: input.alert.incidentId || input.alert.id,
        createdAt: input.now,
        reviewHistory: [{ action: 'created', actor: input.operator?.trim() || 'operator', at: input.now, version: 1 }]
    };
}

/** Normalizes persisted entries and caps the local customer-owned store. */
export function normalizeResolutionMemory(candidate?: Partial<ResolutionMemoryStore>): ResolutionMemoryStore {
    const entries = Array.isArray(candidate?.entries) ? candidate.entries : [];
    return {
        entries: entries.map(normalizeEntry).filter((entry): entry is ResolutionMemoryEntry => Boolean(entry)).slice(0, 500)
    };
}

export function approveResolution(entry: ResolutionMemoryEntry, reviewer: string, now: string): ResolutionMemoryEntry {
    if (entry.status !== 'draft') return entry;
    const reviewDueAt = validDate(now)
        ? new Date(Date.parse(now) + 90 * 24 * 60 * 60 * 1000).toISOString()
        : entry.reviewDueAt;
    return {
        ...entry,
        status: 'approved',
        reviewer: reviewer.trim() || 'Unknown reviewer',
        approvedAt: now,
        reviewDueAt,
        reviewHistory: appendReview(entry, { action: 'approved', actor: reviewer, at: now, version: entry.version })
    };
}

export function retireResolution(entry: ResolutionMemoryEntry, now: string): ResolutionMemoryEntry {
    if (entry.status !== 'approved') return entry;
    return {
        ...entry,
        status: 'retired',
        retiredAt: now,
        reviewHistory: appendReview(entry, { action: 'retired', actor: entry.reviewer || 'operator', at: now, version: entry.version })
    };
}

export function rejectResolution(entry: ResolutionMemoryEntry, reviewer: string, now: string, note?: string): ResolutionMemoryEntry {
    if (entry.status !== 'draft') return entry;
    return {
        ...entry,
        status: 'rejected',
        reviewer: reviewer.trim() || 'Unknown reviewer',
        reviewHistory: appendReview(entry, { action: 'rejected', actor: reviewer, at: now, note: cleanText(note, 300), version: entry.version })
    };
}

export function reviseResolution(
    entry: ResolutionMemoryEntry,
    input: ResolutionMemoryRevisionInput,
    reviewer: string,
    now: string
): ResolutionMemoryEntry {
    if (entry.status === 'retired') return entry;
    const nextVersion = entry.version + 1;
    return {
        ...entry,
        ...input,
        title: cleanText(input.title ?? entry.title, 160),
        symptoms: normalizeStrings(input.symptoms ?? entry.symptoms),
        evidenceRefs: normalizeStrings(input.evidenceRefs ?? entry.evidenceRefs),
        failedAttempts: normalizeStrings(input.failedAttempts ?? entry.failedAttempts),
        successfulAction: cleanText(input.successfulAction ?? entry.successfulAction, 2000),
        verifiedOutcome: cleanText(input.verifiedOutcome ?? entry.verifiedOutcome, 2000),
        environment: input.environment || entry.environment,
        version: nextVersion,
        status: 'draft',
        reviewer: reviewer.trim() || 'Unknown reviewer',
        approvedAt: undefined,
        retiredAt: undefined,
        reviewDueAt: undefined,
        reviewHistory: appendReview(entry, { action: 'revised', actor: reviewer, at: now, version: nextVersion })
    };
}

/** Finds approved procedures whose customer and incident applicability match. */
export function findApplicableResolutions(input: {
    systemId: string;
    job: ActiveJobRecord;
    alert?: MonitorAlert | null;
}, store: ResolutionMemoryStore) {
    const jobName = String(input.job.JOB_NAME || input.job.SUBSYSTEM_JOB || '').trim();
    const scopedEntries = store.entries
        .filter((entry) => entry.systemId === '*' || entry.systemId === input.systemId);
    const currentVersionByProcedure = new Map<string, number>();
    scopedEntries.forEach((entry) => {
        currentVersionByProcedure.set(
            entry.procedureKey,
            Math.max(currentVersionByProcedure.get(entry.procedureKey) || 0, entry.version)
        );
    });
    return findApplicableResolutionMatches(input, store)
        .filter((match) => match.entry.version === currentVersionByProcedure.get(match.entry.procedureKey))
        .filter((match) => match.environmentCompatible && !match.conflict && match.freshness !== 'stale')
        .sort((left, right) => matchScore(right.entry, input, jobName) - matchScore(left.entry, input, jobName))
        .map((match) => match.entry);
}

/** Returns approved matches with the review signals needed by operators. Conflicts stay visible to review but are excluded from default retrieval. */
export function findApplicableResolutionMatches(input: {
    systemId: string;
    job: ActiveJobRecord;
    alert?: MonitorAlert | null;
    now?: string;
}, store: ResolutionMemoryStore): ResolutionMemoryMatch[] {
    const jobName = String(input.job.JOB_NAME || input.job.SUBSYSTEM_JOB || '').trim();
    return store.entries
        .filter((entry) => entry.status === 'approved')
        .filter((entry) => entry.systemId === '*' || entry.systemId === input.systemId)
        .filter((entry) => !input.alert || entry.incidentKind === input.alert.kind)
        .filter((entry) => !entry.jobPattern || matchesPattern(jobName, entry.jobPattern))
        .map((entry) => {
            const environmentCompatible = isEnvironmentCompatible(entry, input.job);
            const currentFingerprint = input.alert?.correlation?.fingerprint;
            const conflict = entry.incidentFingerprint && currentFingerprint && entry.incidentFingerprint !== currentFingerprint
                ? 'Runtime incident fingerprint differs from this approved memory.'
                : !environmentCompatible ? 'Job environment differs from this approved memory.' : undefined;
            return {
                entry,
                confidence: getConfidence(entry, jobName, currentFingerprint),
                freshness: getFreshness(entry, input.now),
                environmentCompatible,
                conflict,
                reasons: buildMatchReasons(entry, input, jobName, environmentCompatible)
            };
        });
}

export function exportScopedResolutionMemory(store: ResolutionMemoryStore, systemId: string) {
    return {
        schema: 'imonitor-resolution-memory',
        version: 1,
        systemId,
        exportedAt: new Date().toISOString(),
        entries: store.entries.filter((entry) => entry.systemId === systemId || entry.systemId === '*')
    };
}

function normalizeEntry(candidate: ResolutionMemoryEntry): ResolutionMemoryEntry | null {
    if (!candidate || !String(candidate.id || '').trim() || !String(candidate.title || '').trim()) return null;
    const kinds: AlertKind[] = ['highCpu', 'messageWait', 'lockWait', 'delayWait', 'dequeueWait', 'pollFailure'];
    if (!kinds.includes(candidate.incidentKind)) return null;
    return {
        ...candidate,
        id: String(candidate.id).trim().slice(0, 100),
        procedureKey: String(candidate.procedureKey || candidate.id).trim().slice(0, 180),
        version: Number.isFinite(Number(candidate.version)) ? Math.max(1, Math.round(Number(candidate.version))) : 1,
        status: ['draft', 'approved', 'rejected', 'retired'].includes(candidate.status) ? candidate.status : 'draft',
        systemId: String(candidate.systemId || '').trim().slice(0, 120),
        title: String(candidate.title).trim().slice(0, 160),
        symptoms: normalizeStrings(candidate.symptoms),
        evidenceRefs: normalizeStrings(candidate.evidenceRefs),
        failedAttempts: normalizeStrings(candidate.failedAttempts),
        successfulAction: String(candidate.successfulAction || '').trim().slice(0, 2000),
        verifiedOutcome: String(candidate.verifiedOutcome || '').trim().slice(0, 2000),
        environment: normalizeEnvironment(candidate.environment),
        operator: cleanText(candidate.operator, 120) || undefined,
        sourceIncidentId: cleanText(candidate.sourceIncidentId, 160) || undefined,
        createdAt: validDate(candidate.createdAt) ? candidate.createdAt : new Date(0).toISOString(),
        reviewHistory: normalizeReviewHistory(candidate.reviewHistory, candidate)
    };
}

function matchScore(entry: ResolutionMemoryEntry, input: { systemId: string; alert?: MonitorAlert | null }, jobName: string) {
    return (entry.systemId === input.systemId ? 20 : 0)
        + (entry.incidentFingerprint && entry.incidentFingerprint === input.alert?.correlation?.fingerprint ? 20 : 0)
        + (entry.jobPattern ? 10 : 0)
        + entry.version;
}

function matchesPattern(value: string, pattern: string) {
    return new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}$`, 'i').test(value);
}

function normalizeStrings(values?: string[]) {
    return Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value).trim()).filter(Boolean))).slice(0, 20);
}

function normalizeReviewHistory(values: ResolutionMemoryReviewEvent[] | undefined, entry: ResolutionMemoryEntry) {
    const history = Array.isArray(values) ? values : [];
    return history.map((event) => ({
        action: ['created', 'approved', 'revised', 'rejected', 'retired'].includes(event?.action) ? event.action : 'created',
        actor: cleanText(event?.actor, 120) || 'unknown',
        at: validDate(event?.at) ? event.at : entry.createdAt,
        note: cleanText(event?.note, 300) || undefined,
        version: Number.isFinite(Number(event?.version)) ? Math.max(1, Math.round(Number(event.version))) : entry.version
    } as ResolutionMemoryReviewEvent)).slice(-30);
}

function normalizeEnvironment(environment?: ResolutionMemoryEntry['environment']) {
    return {
        systemLabel: cleanText(environment?.systemLabel, 120) || undefined,
        jobType: cleanText(environment?.jobType, 40) || undefined,
        subsystem: cleanText(environment?.subsystem, 40) || undefined
    };
}

function appendReview(entry: ResolutionMemoryEntry, event: ResolutionMemoryReviewEvent) {
    return [...(entry.reviewHistory || []), { ...event, actor: event.actor.trim() || 'operator' }].slice(-30);
}

function cleanText(value: unknown, max: number) {
    return String(value || '').trim().slice(0, max);
}

function isEnvironmentCompatible(entry: ResolutionMemoryEntry, job: ActiveJobRecord) {
    const expected = entry.environment || {};
    return (!expected.jobType || !job.TYPE || expected.jobType.toUpperCase() === String(job.TYPE).toUpperCase())
        && (!expected.subsystem || !job.SUBSYSTEM || expected.subsystem.toUpperCase() === String(job.SUBSYSTEM).toUpperCase());
}

function getConfidence(entry: ResolutionMemoryEntry, jobName: string, fingerprint?: string): ResolutionMemoryConfidence {
    if (entry.incidentFingerprint && fingerprint && entry.incidentFingerprint === fingerprint) return 'high';
    if (entry.jobPattern && entry.jobPattern.replace(/\*/g, '') === jobName) return 'high';
    if (entry.jobPattern) return 'medium';
    return 'low';
}

function getFreshness(entry: ResolutionMemoryEntry, now = new Date().toISOString()): ResolutionMemoryFreshness {
    if (!entry.reviewDueAt || !validDate(now) || !validDate(entry.reviewDueAt)) return 'current';
    const due = Date.parse(entry.reviewDueAt);
    const current = Date.parse(now);
    if (due <= current) return 'stale';
    return due - current <= 14 * 24 * 60 * 60 * 1000 ? 'due' : 'current';
}

function buildMatchReasons(entry: ResolutionMemoryEntry, input: { systemId: string; alert?: MonitorAlert | null }, jobName: string, environmentCompatible: boolean) {
    return [
        entry.systemId === input.systemId ? 'Same IBM i system.' : 'Global customer procedure.',
        entry.incidentFingerprint && entry.incidentFingerprint === input.alert?.correlation?.fingerprint ? 'Incident fingerprint matches.' : undefined,
        entry.jobPattern && matchesPattern(jobName, entry.jobPattern) ? `Job pattern matches: ${entry.jobPattern}.` : undefined,
        environmentCompatible ? 'Job environment is compatible.' : 'Job environment differs.'
    ].filter((reason): reason is string => Boolean(reason));
}

function validDate(value: string | undefined) {
    return Boolean(value) && !Number.isNaN(Date.parse(value as string));
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
