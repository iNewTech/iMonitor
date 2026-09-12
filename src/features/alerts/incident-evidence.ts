import type {
    ActiveJobRecord,
    JobLogRecord,
    JobMessageRecord
} from '../../services/ibmi';
import type { MonitorAlert } from './alert-model';

export const INCIDENT_EVIDENCE_VERSION = 1;
export const INCIDENT_EVIDENCE_BUDGET_MS = 1500;
export const INCIDENT_EVIDENCE_STALE_AFTER_MS = 5 * 60 * 1000;

export type IncidentEvidenceStatus =
    | 'captured'
    | 'missing'
    | 'stale'
    | 'permission-denied'
    | 'unavailable';

export type EvidenceRecord = Record<string, unknown>;

export interface IncidentEvidenceSnapshot {
    status: IncidentEvidenceStatus;
    collectedAt: string;
    source: 'ibmi' | 'demo' | 'monitoring-poll';
    recordCount: number;
    records: EvidenceRecord[];
    detail?: string;
}

export interface IncidentEvidence {
    version: number;
    capturedAt: string;
    source: 'ibmi' | 'demo';
    systemId?: string;
    systemLabel?: string;
    trigger: IncidentEvidenceSnapshot;
    job: IncidentEvidenceSnapshot;
    jobLog: IncidentEvidenceSnapshot;
    messages: IncidentEvidenceSnapshot;
    queue: IncidentEvidenceSnapshot;
    subsystem: IncidentEvidenceSnapshot;
}

export interface IncidentEvidenceCollectors {
    getJobContext: (jobName: string) => Promise<{
        jobInfo?: Record<string, unknown> | null;
        jobQueue?: Record<string, unknown> | null;
        subsystem?: Record<string, unknown> | null;
    }>;
    getJobLog: (jobName: string) => Promise<JobLogRecord[]>;
    getJobMessages: (jobName: string) => Promise<JobMessageRecord[]>;
}

interface CaptureIncidentEvidenceInput {
    alert: MonitorAlert;
    triggerJob?: ActiveJobRecord;
    source: 'ibmi' | 'demo';
    systemId?: string;
    systemLabel?: string;
    collectors: IncidentEvidenceCollectors;
    budgetMs?: number;
}

const REDACTED = '[REDACTED]';
const SECRET_KEY = /password|passphrase|secret|token|api[_-]?key|credential|authorization/i;
const SECRET_VALUE = /(password|passphrase|secret|token|api[_-]?key|credential)\s*[:=]\s*[^\s,;]+/gi;
const TIMESTAMP_KEY = /timestamp|time|date/i;
const MAX_RECORDS = 100;

/** Captures bounded, redacted evidence for one incident without blocking polling. */
export async function captureIncidentEvidence(input: CaptureIncidentEvidenceInput): Promise<IncidentEvidence> {
    const capturedAt = new Date().toISOString();
    const source = input.source;
    const collectionSource = source === 'demo' ? 'demo' : 'ibmi';
    const triggerRecords = input.triggerJob ? [toEvidenceRecord(input.triggerJob)] : [];
    const trigger = buildSnapshot(
        triggerRecords,
        capturedAt,
        'monitoring-poll',
        input.triggerJob ? 'captured' : 'missing',
        input.triggerJob ? undefined : 'The incident did not identify a live job.'
    );
    const job = buildSnapshot(triggerRecords, capturedAt, collectionSource, trigger.status, trigger.detail);
    const jobName = input.alert.jobName?.trim();
    const deadline = Date.now() + Math.max(250, input.budgetMs ?? INCIDENT_EVIDENCE_BUDGET_MS);

    if (!jobName) {
        return buildEvidence(input, capturedAt, trigger, job,
            missingSnapshot(capturedAt, collectionSource, 'No job was attached to this incident.'),
            missingSnapshot(capturedAt, collectionSource, 'No job was attached to this incident.'),
            missingSnapshot(capturedAt, collectionSource, 'No job was attached to this incident.'),
            missingSnapshot(capturedAt, collectionSource, 'No job was attached to this incident.'));
    }

    const [contextResult, logResult, messagesResult] = await Promise.all([
        collectWithinBudget(() => input.collectors.getJobContext(jobName), deadline),
        collectWithinBudget(() => input.collectors.getJobLog(jobName), deadline),
        collectWithinBudget(() => input.collectors.getJobMessages(jobName), deadline)
    ]);

    const context = contextResult.ok ? contextResult.value : null;
    const contextFailureDetail = contextResult.ok ? undefined : contextResult.detail;
    const queue = context
        ? buildSnapshot(
            context.jobQueue ? [context.jobQueue] : [],
            capturedAt,
            collectionSource,
            context.jobQueue ? 'captured' : 'missing',
            context.jobQueue ? undefined : 'The job queue definition was not returned.'
        )
        : failedSnapshot(capturedAt, collectionSource, contextFailureDetail);
    const subsystem = context
        ? buildSnapshot(
            context.subsystem ? [context.subsystem] : [],
            capturedAt,
            collectionSource,
            context.subsystem ? 'captured' : 'missing',
            context.subsystem ? undefined : 'The subsystem definition was not returned.'
        )
        : failedSnapshot(capturedAt, collectionSource, contextFailureDetail);
    const jobSnapshot = context?.jobInfo
        ? buildSnapshot([context.jobInfo], capturedAt, collectionSource, 'captured')
        : job;
    const jobLog = logResult.ok
        ? buildSnapshot(logResult.value, capturedAt, collectionSource)
        : failedSnapshot(capturedAt, collectionSource, logResult.detail);
    const messages = messagesResult.ok
        ? buildSnapshot(messagesResult.value, capturedAt, collectionSource)
        : failedSnapshot(capturedAt, collectionSource, messagesResult.detail);

    return buildEvidence(input, capturedAt, trigger, jobSnapshot, jobLog, messages, queue, subsystem);
}

/** Normalizes persisted evidence so one malformed source cannot break a ledger. */
export function normalizeIncidentEvidence(candidate: unknown): IncidentEvidence | undefined {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        return undefined;
    }

    const value = candidate as Partial<IncidentEvidence>;
    if (typeof value.capturedAt !== 'string' || typeof value.source !== 'string') {
        return undefined;
    }
    const capturedAt = value.capturedAt;

    const snapshot = (item: unknown): IncidentEvidenceSnapshot => {
        const record = item && typeof item === 'object' && !Array.isArray(item)
            ? item as Partial<IncidentEvidenceSnapshot>
            : {};
        const status = isEvidenceStatus(record.status) ? record.status : 'unavailable';
        const records = Array.isArray(record.records)
            ? record.records.slice(0, MAX_RECORDS).map(toEvidenceRecord)
            : [];
        return {
            status,
            collectedAt: typeof record.collectedAt === 'string' ? record.collectedAt : capturedAt,
            source: record.source === 'demo' || record.source === 'monitoring-poll' ? record.source : 'ibmi',
            recordCount: records.length,
            records,
            detail: typeof record.detail === 'string' ? record.detail : undefined
        };
    };

    return {
        version: Number.isInteger(value.version) ? Number(value.version) : INCIDENT_EVIDENCE_VERSION,
        capturedAt: value.capturedAt,
        source: value.source === 'demo' ? 'demo' : 'ibmi',
        systemId: typeof value.systemId === 'string' ? value.systemId : undefined,
        systemLabel: typeof value.systemLabel === 'string' ? value.systemLabel : undefined,
        trigger: snapshot(value.trigger),
        job: snapshot(value.job),
        jobLog: snapshot(value.jobLog),
        messages: snapshot(value.messages),
        queue: snapshot(value.queue),
        subsystem: snapshot(value.subsystem)
    };
}

function buildEvidence(
    input: CaptureIncidentEvidenceInput,
    capturedAt: string,
    trigger: IncidentEvidenceSnapshot,
    job: IncidentEvidenceSnapshot,
    jobLog: IncidentEvidenceSnapshot,
    messages: IncidentEvidenceSnapshot,
    queue: IncidentEvidenceSnapshot,
    subsystem: IncidentEvidenceSnapshot
): IncidentEvidence {
    return {
        version: INCIDENT_EVIDENCE_VERSION,
        capturedAt,
        source: input.source,
        systemId: input.systemId,
        systemLabel: input.systemLabel,
        trigger,
        job,
        jobLog,
        messages,
        queue,
        subsystem
    };
}

function buildSnapshot(
    records: unknown[],
    capturedAt: string,
    source: IncidentEvidenceSnapshot['source'],
    status?: IncidentEvidenceStatus,
    detail?: string
): IncidentEvidenceSnapshot {
    const safeRecords = records.slice(0, MAX_RECORDS).map(toEvidenceRecord);
    const freshness = status || getFreshnessStatus(safeRecords, capturedAt);
    return {
        status: freshness,
        collectedAt: capturedAt,
        source,
        recordCount: safeRecords.length,
        records: safeRecords,
        detail: detail || (freshness === 'missing' ? 'No records were returned.' : undefined)
    };
}

function missingSnapshot(capturedAt: string, source: IncidentEvidenceSnapshot['source'], detail: string) {
    return buildSnapshot([], capturedAt, source, 'missing', detail);
}

function failedSnapshot(capturedAt: string, source: IncidentEvidenceSnapshot['source'], detail?: string) {
    return buildSnapshot([], capturedAt, source, classifyFailure(detail), detail || 'Evidence source was unavailable.');
}

async function collectWithinBudget<T>(collector: () => Promise<T>, deadline: number): Promise<{
    ok: true;
    value: T;
} | {
    ok: false;
    detail: string;
}> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
        return { ok: false, detail: 'Evidence collection budget was exceeded.' };
    }

    try {
        const value = await Promise.race([
            collector(),
            new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error('Evidence collection timed out.')), remaining);
            })
        ]);
        return { ok: true, value };
    } catch (error) {
        return {
            ok: false,
            detail: error instanceof Error ? error.message : 'Evidence source failed.'
        };
    }
}

function toEvidenceRecord(value: unknown): EvidenceRecord {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { value: redactValue(value) };
    }

    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
            key,
            SECRET_KEY.test(key) ? REDACTED : redactValue(entry)
        ])
    );
}

function redactValue(value: unknown): unknown {
    if (typeof value === 'string') {
        return value.replace(SECRET_VALUE, '$1=[REDACTED]');
    }
    if (Array.isArray(value)) {
        return value.slice(0, MAX_RECORDS).map(redactValue);
    }
    if (value && typeof value === 'object') {
        return toEvidenceRecord(value);
    }
    return value;
}

function getFreshnessStatus(records: EvidenceRecord[], capturedAt: string): IncidentEvidenceStatus {
    if (!records.length) {
        return 'missing';
    }

    const capturedTime = new Date(capturedAt).getTime();
    const timestamps = records.flatMap((record) => Object.entries(record)
        .filter(([key, value]) => TIMESTAMP_KEY.test(key) && typeof value === 'string')
        .map(([, value]) => new Date(String(value)).getTime())
        .filter(Number.isFinite));
    if (timestamps.length && capturedTime - Math.max(...timestamps) > INCIDENT_EVIDENCE_STALE_AFTER_MS) {
        return 'stale';
    }

    return 'captured';
}

function classifyFailure(detail?: string): IncidentEvidenceStatus {
    const message = String(detail || '').toLowerCase();
    if (/authority|authorized|authorised|permission|not allowed|forbidden|privilege/.test(message)) {
        return 'permission-denied';
    }
    return 'unavailable';
}

function isEvidenceStatus(value: unknown): value is IncidentEvidenceStatus {
    return ['captured', 'missing', 'stale', 'permission-denied', 'unavailable'].includes(String(value));
}
