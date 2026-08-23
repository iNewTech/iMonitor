import type { ActiveJobRecord } from '../../services/ibmi';

/**
 * Summarizes one monitoring poll for charts and operator history.
 */
export interface MonitoringSnapshot {
    timestamp: string;
    totalJobs: number;
    peakCpu: number;
    runningJobs: number;
    waitingJobs: number;
    messageWaitJobs: number;
    lockWaitJobs: number;
    highCpuJobs: number;
}

/**
 * Captures one alert-relevant job state transition.
 */
export interface JobStatusHistoryEntry {
    timestamp: string;
    status: string;
    label: string;
}

/**
 * Job states treated as waiting conditions in the operator UI.
 */
export const WAITING_STATUSES = new Set(['MSGW', 'LCKW', 'DEQW', 'DLYW']);

/**
 * Normalizes IBM i numeric values that may arrive as strings.
 */
export function toNumber(value: number | string | null | undefined) {
    if (typeof value === 'number') {
        return value;
    }

    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    return 0;
}

/**
 * Builds a stable job key that survives UI refreshes.
 */
export function getJobKey(job: ActiveJobRecord) {
    if (job.JOB_NAME) {
        return job.JOB_NAME;
    }

    const jobNumber = job.JOB_NUMBER ?? '------';
    const jobUser = job.JOB_USER ?? 'UNKNOWN';
    const jobName = job.JOB_NAME_SHORT ?? 'UNKNOWN';
    return `${jobNumber}/${jobUser}/${jobName}`;
}

/**
 * Returns the display title used in alerts and details.
 */
export function getJobTitle(job: ActiveJobRecord) {
    return job.SUBSYSTEM_JOB || getJobKey(job);
}

/**
 * Converts IBM i status codes into operator-readable labels.
 */
export function describeStatus(status: string | null | undefined) {
    switch (status) {
        case 'RUN':
            return 'Running';
        case 'MSGW':
            return 'Waiting for a message reply';
        case 'LCKW':
            return 'Waiting for a lock';
        case 'DEQW':
            return 'Waiting for a dequeue operation';
        case 'DLYW':
            return 'Delayed by DLYJOB';
        case 'EOJ':
            return 'Ending';
        case 'END':
            return 'Ended immediately';
        default:
            return status || 'Unknown';
    }
}

/**
 * Explains the current wait condition for a job.
 */
export function buildWaitReason(job: ActiveJobRecord) {
    if (job.STATUS === 'MSGW') {
        return job.MESSAGE_REPLY === 'YES'
            ? 'Waiting for a reply to a specific message in the job message queue.'
            : 'Waiting for a message from a message queue.';
    }

    if (job.STATUS === 'LCKW') {
        const databaseWaits = toNumber(job.DATABASE_LOCK_WAITS);
        const databaseWaitTime = toNumber(job.DATABASE_LOCK_WAIT_TIME);
        const nonDatabaseWaits = toNumber(job.NON_DATABASE_LOCK_WAITS);
        const nonDatabaseWaitTime = toNumber(job.NON_DATABASE_LOCK_WAIT_TIME);
        const internalWaits = toNumber(job.INTERNAL_MACHINE_LOCK_WAITS);
        const internalWaitTime = toNumber(job.INTERNAL_MACHINE_LOCK_WAIT_TIME);

        return [
            'Waiting for a lock.',
            `Database waits: ${databaseWaits} (${databaseWaitTime} ms).`,
            `Non-database waits: ${nonDatabaseWaits} (${nonDatabaseWaitTime} ms).`,
            `Internal machine waits: ${internalWaits} (${internalWaitTime} ms).`
        ].join(' ');
    }

    if (job.STATUS === 'DEQW') {
        return 'Waiting for completion of a dequeue operation.';
    }

    if (job.STATUS === 'DLYW') {
        return 'Delayed by DLYJOB or a scheduled delay end time.';
    }

    if (job.STATUS === 'RUN') {
        return 'Job is currently running.';
    }

    return describeStatus(job.STATUS);
}

/**
 * Creates one chart-ready monitoring snapshot from a poll result.
 */
export function createMonitoringSnapshot(
    jobs: ActiveJobRecord[],
    timestamp: string,
    highCpuThreshold: number
): MonitoringSnapshot {
    const peakCpu = jobs.reduce((highest, job) => Math.max(highest, toNumber(job.CPU)), 0);
    const runningJobs = jobs.filter((job) => job.STATUS === 'RUN').length;
    const waitingJobs = jobs.filter((job) => WAITING_STATUSES.has(job.STATUS || '')).length;
    const messageWaitJobs = jobs.filter((job) => job.STATUS === 'MSGW').length;
    const lockWaitJobs = jobs.filter((job) => job.STATUS === 'LCKW').length;
    const highCpuJobs = jobs.filter((job) => toNumber(job.CPU) >= highCpuThreshold).length;

    return {
        timestamp,
        totalJobs: jobs.length,
        peakCpu,
        runningJobs,
        waitingJobs,
        messageWaitJobs,
        lockWaitJobs,
        highCpuJobs
    };
}

/**
 * Rebuilds the latest job index and status history from a fresh poll.
 */
export function refreshTrackedJobs(
    jobs: ActiveJobRecord[],
    timestamp: string,
    previousHistory: Map<string, JobStatusHistoryEntry[]>,
    maxHistoryEntries: number
) {
    const latestJobIndex = new Map<string, ActiveJobRecord>();
    const nextStatusHistory = new Map<string, JobStatusHistoryEntry[]>();

    jobs.forEach((job) => {
        const jobKey = getJobKey(job);
        const history = [...(previousHistory.get(jobKey) ?? [])];
        const nextStatus = job.STATUS || 'UNKNOWN';
        const previousStatus = history[history.length - 1]?.status;

        if (previousStatus !== nextStatus) {
            history.push({
                timestamp,
                status: nextStatus,
                label: describeStatus(nextStatus)
            });
        }

        nextStatusHistory.set(jobKey, history.slice(-maxHistoryEntries));
        latestJobIndex.set(jobKey, job);
    });

    return {
        latestJobIndex,
        jobStatusHistory: nextStatusHistory
    };
}
