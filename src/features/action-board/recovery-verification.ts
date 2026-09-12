import type { JobQueueRecord, QueuedJobRecord } from '../../services/ibmi';
import type { JobQueueActionKind } from './job-queue-actions';

export type RecoveryVerificationStatus = 'recovered' | 'still-blocked' | 'failed' | 'unknown';

export interface RecoveryVerificationResult {
    status: RecoveryVerificationStatus;
    summary: string;
    observedAt: string;
    evidence: string[];
}

interface QueueActionTarget {
    kind: JobQueueActionKind;
    queueName: string;
    queueLibrary: string;
    jobName?: string;
}

function queueStatus(queue: JobQueueRecord | null | undefined) {
    return String(queue?.JOB_QUEUE_STATUS || '').trim().toUpperCase();
}

function jobStatus(job: QueuedJobRecord | null | undefined) {
    return String(job?.JOB_STATUS || job?.JOB_QUEUE_STATUS || '').trim().toUpperCase();
}

function result(status: RecoveryVerificationStatus, summary: string, evidence: string[], observedAt: string): RecoveryVerificationResult {
    return { status, summary, evidence, observedAt };
}

/** Builds an outcome from fresh IBM i evidence after an authorised queue action. */
export function buildQueueRecoveryVerification(
    target: QueueActionTarget,
    queue: JobQueueRecord | null | undefined,
    queuedJob: QueuedJobRecord | null | undefined,
    waitingJobs: number,
    observedAt = new Date().toISOString()
): RecoveryVerificationResult {
    if (target.jobName) {
        if (!queuedJob) {
            return result('unknown', 'The queued job was not returned by the verification read.', ['Queued job: unavailable'], observedAt);
        }
        const status = jobStatus(queuedJob);
        const expected = target.kind === 'holdQueuedJob' ? 'HELD' : 'JOBQ';
        return status === expected
            ? result('recovered', `Queued job verified in ${status} state.`, [`Queued job status: ${status}`], observedAt)
            : result('still-blocked', `Queued job remains in ${status || 'unknown'} state.`, [`Queued job status: ${status || 'unknown'}`, `Expected: ${expected}`], observedAt);
    }

    if (!queue) {
        return result('unknown', 'The job queue was not returned by the verification read.', ['Queue: unavailable'], observedAt);
    }
    const status = queueStatus(queue);
    if (target.kind === 'holdQueue') {
        return status === 'HELD'
            ? result('recovered', 'Queue hold verified.', [`Queue status: ${status}`], observedAt)
            : result('failed', `Queue is ${status || 'unknown'} after the hold request.`, [`Queue status: ${status || 'unknown'}`, 'Expected: HELD'], observedAt);
    }
    if (status !== 'RELEASED') {
        return result('failed', `Queue is ${status || 'unknown'} after the release request.`, [`Queue status: ${status || 'unknown'}`, 'Expected: RELEASED'], observedAt);
    }
    if (waitingJobs > 0) {
        return result('still-blocked', `Queue is released but ${waitingJobs} waiting job${waitingJobs === 1 ? '' : 's'} remain.`, [`Queue status: RELEASED`, `Waiting jobs: ${waitingJobs}`], observedAt);
    }
    return result('recovered', 'Queue is released and no waiting jobs remain.', ['Queue status: RELEASED', 'Waiting jobs: 0'], observedAt);
}
