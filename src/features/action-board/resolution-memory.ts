import type { ActiveJobRecord } from '../../services/ibmi';
import type { AlertKind, MonitorAlert } from '../alerts/alert-model';

export type ResolutionMemoryStatus = 'draft' | 'approved' | 'retired';

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
    reviewer?: string;
    createdAt: string;
    approvedAt?: string;
    retiredAt?: string;
    reviewDueAt?: string;
    supersedesId?: string;
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
    now: string;
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
        createdAt: input.now
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
    if (entry.status === 'retired') return entry;
    const reviewDueAt = validDate(now)
        ? new Date(Date.parse(now) + 90 * 24 * 60 * 60 * 1000).toISOString()
        : entry.reviewDueAt;
    return {
        ...entry,
        status: 'approved',
        reviewer: reviewer.trim() || 'Unknown reviewer',
        approvedAt: now,
        reviewDueAt
    };
}

export function retireResolution(entry: ResolutionMemoryEntry, now: string): ResolutionMemoryEntry {
    return { ...entry, status: 'retired', retiredAt: now };
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
    scopedEntries
        .filter((entry) => entry.status !== 'draft')
        .forEach((entry) => {
            currentVersionByProcedure.set(
                entry.procedureKey,
                Math.max(currentVersionByProcedure.get(entry.procedureKey) || 0, entry.version)
            );
        });
    return scopedEntries
        .filter((entry) => entry.status === 'approved')
        .filter((entry) => entry.version === currentVersionByProcedure.get(entry.procedureKey))
        .filter((entry) => !input.alert || entry.incidentKind === input.alert.kind)
        .filter((entry) => !entry.jobPattern || matchesPattern(jobName, entry.jobPattern))
        .sort((left, right) => matchScore(right, input, jobName) - matchScore(left, input, jobName));
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
        status: ['draft', 'approved', 'retired'].includes(candidate.status) ? candidate.status : 'draft',
        systemId: String(candidate.systemId || '').trim().slice(0, 120),
        title: String(candidate.title).trim().slice(0, 160),
        symptoms: normalizeStrings(candidate.symptoms),
        evidenceRefs: normalizeStrings(candidate.evidenceRefs),
        failedAttempts: normalizeStrings(candidate.failedAttempts),
        successfulAction: String(candidate.successfulAction || '').trim().slice(0, 2000),
        verifiedOutcome: String(candidate.verifiedOutcome || '').trim().slice(0, 2000),
        environment: candidate.environment || {},
        createdAt: validDate(candidate.createdAt) ? candidate.createdAt : new Date(0).toISOString()
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

function validDate(value: string | undefined) {
    return Boolean(value) && !Number.isNaN(Date.parse(value as string));
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
