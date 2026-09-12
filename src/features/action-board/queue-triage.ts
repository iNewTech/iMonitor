import type { JobQueueRecord } from '../../services/ibmi';

export const QUEUE_TRIAGE_VERSION = 1;
export const QUEUE_TRIAGE_CHECKS = ['queue-state', 'waiting-jobs', 'subsystem'] as const;

export type QueueTriageCheckId = typeof QUEUE_TRIAGE_CHECKS[number];
export type QueueTriageCheckStatus = 'passed' | 'blocked' | 'unavailable' | 'skipped';
export type QueueTriageStatus = 'running' | 'completed' | 'partial' | 'failed' | 'interrupted' | 'clear';

export interface QueueTriageCheck {
    id: QueueTriageCheckId;
    label: string;
    status: QueueTriageCheckStatus;
    summary: string;
    recordCount: number;
    observedAt: string;
}

export interface QueueTriageResult {
    schema: 'imonitor-queue-triage';
    version: number;
    queueKey: string;
    queueName: string;
    queueLibrary: string;
    status: QueueTriageStatus;
    startedAt: string;
    completedAt: string | null;
    updatedAt: string;
    nextCheck: QueueTriageCheckId | null;
    evidenceSignature: string;
    waitingJobs: number;
    subsystemName: string | null;
    subsystemLibrary: string | null;
    checks: QueueTriageCheck[];
    expectedOutcome: string;
    stopReason: string;
    proposedNextSteps: string[];
}

function text(value: unknown, fallback = '') {
    return value === null || value === undefined ? fallback : String(value).trim();
}

function number(value: unknown, fallback = 0) {
    const result = Number(value);
    return Number.isFinite(result) ? result : fallback;
}

export function queueKey(queue: Pick<JobQueueRecord, 'JOB_QUEUE_NAME' | 'JOB_QUEUE_LIBRARY'>) {
    return `${queue.JOB_QUEUE_LIBRARY}/${queue.JOB_QUEUE_NAME}`;
}

export function queueEvidenceSignature(queue: JobQueueRecord) {
    return [
        queue.JOB_QUEUE_STATUS,
        queue.WAITING_JOBS,
        queue.HELD_JOBS,
        queue.SUBSYSTEM_NAME,
        queue.SUBSYSTEM_LIBRARY_NAME,
        queue.OLDEST_WAIT_TIME
    ].map((value) => text(value, '—')).join('|');
}

export function createQueueTriageResult(queue: JobQueueRecord, timestamp: string): QueueTriageResult {
    return {
        schema: 'imonitor-queue-triage',
        version: QUEUE_TRIAGE_VERSION,
        queueKey: queueKey(queue),
        queueName: queue.JOB_QUEUE_NAME,
        queueLibrary: queue.JOB_QUEUE_LIBRARY,
        status: 'running',
        startedAt: timestamp,
        completedAt: null,
        updatedAt: timestamp,
        nextCheck: 'queue-state',
        evidenceSignature: queueEvidenceSignature(queue),
        waitingJobs: Math.max(0, number(queue.WAITING_JOBS)),
        subsystemName: queue.SUBSYSTEM_NAME || null,
        subsystemLibrary: queue.SUBSYSTEM_LIBRARY_NAME || null,
        checks: [],
        expectedOutcome: 'Read-only evidence is collected before any corrective action is considered.',
        stopReason: 'Triage stops before queue or job mutation.',
        proposedNextSteps: []
    };
}

export function recordQueueTriageCheck(
    result: QueueTriageResult,
    check: QueueTriageCheck,
    timestamp: string
) {
    const checks = result.checks.filter((candidate) => candidate.id !== check.id).concat(check);
    const nextIndex = QUEUE_TRIAGE_CHECKS.findIndex((id) => id === check.id) + 1;
    return {
        ...result,
        checks,
        updatedAt: timestamp,
        nextCheck: QUEUE_TRIAGE_CHECKS[nextIndex] || null
    };
}

export function completeQueueTriage(
    result: QueueTriageResult,
    status: Extract<QueueTriageStatus, 'completed' | 'partial' | 'failed' | 'clear'>,
    timestamp: string,
    details: Pick<QueueTriageResult, 'expectedOutcome' | 'stopReason' | 'proposedNextSteps'>
) {
    return {
        ...result,
        ...details,
        status,
        completedAt: timestamp,
        updatedAt: timestamp,
        nextCheck: null
    };
}

export function normalizeQueueTriageResults(candidate: unknown): Record<string, QueueTriageResult> {
    if (!candidate || typeof candidate !== 'object') {
        return {};
    }

    const entries = Object.entries(candidate as Record<string, unknown>).slice(-100);
    const results: Record<string, QueueTriageResult> = {};
    for (const [key, value] of entries) {
        if (!value || typeof value !== 'object') {
            continue;
        }
        const item = value as Partial<QueueTriageResult>;
        const checks = Array.isArray(item.checks)
            ? item.checks.filter((check): check is QueueTriageCheck => Boolean(check && typeof check === 'object'))
            : [];
        const status = item.status === 'completed' || item.status === 'partial' || item.status === 'failed' || item.status === 'clear'
            ? item.status
            : item.status === 'interrupted' ? 'interrupted' : 'interrupted';
        results[key] = {
            schema: 'imonitor-queue-triage',
            version: QUEUE_TRIAGE_VERSION,
            queueKey: text(item.queueKey, key),
            queueName: text(item.queueName, 'UNKNOWN'),
            queueLibrary: text(item.queueLibrary, 'QGPL'),
            status,
            startedAt: text(item.startedAt, text(item.updatedAt, new Date(0).toISOString())),
            completedAt: item.completedAt ? text(item.completedAt) : null,
            updatedAt: text(item.updatedAt, new Date(0).toISOString()),
            nextCheck: QUEUE_TRIAGE_CHECKS.includes(item.nextCheck as QueueTriageCheckId)
                ? item.nextCheck as QueueTriageCheckId
                : status === 'interrupted' ? 'queue-state' : null,
            evidenceSignature: text(item.evidenceSignature),
            waitingJobs: Math.max(0, number(item.waitingJobs)),
            subsystemName: item.subsystemName ? text(item.subsystemName) : null,
            subsystemLibrary: item.subsystemLibrary ? text(item.subsystemLibrary) : null,
            checks,
            expectedOutcome: text(item.expectedOutcome, 'Read-only evidence is available for operator review.'),
            stopReason: text(item.stopReason, 'Triage stops before queue or job mutation.'),
            proposedNextSteps: Array.isArray(item.proposedNextSteps)
                ? item.proposedNextSteps.filter((step): step is string => typeof step === 'string').slice(0, 8)
                : []
        };
    }
    return results;
}
