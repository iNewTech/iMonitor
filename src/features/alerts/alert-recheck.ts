import type { ActiveJobRecord } from '../../services/ibmi';
import type { AlertKind, MonitorAlert } from './alert-model';

export type AlertRecheckResult = 'active' | 'cleared' | 'unavailable';

function sameJob(left: string | undefined, right: ActiveJobRecord) {
    if (!left) {
        return false;
    }

    return left === right.JOB_NAME || left === right.SUBSYSTEM_JOB;
}

function conditionIsPresent(kind: AlertKind, job: ActiveJobRecord, highCpuThreshold: number) {
    switch (kind) {
        case 'messageWait':
            return job.STATUS === 'MSGW';
        case 'lockWait':
            return job.STATUS === 'LCKW';
        case 'delayWait':
            return job.STATUS === 'DLYW';
        case 'dequeueWait':
            return job.STATUS === 'DEQW';
        case 'highCpu':
            return Number(job.CPU || 0) >= highCpuThreshold;
        case 'pollFailure':
            return false;
        default:
            return false;
    }
}

/**
 * Determines whether the condition behind an alert is still present in a fresh poll.
 */
export function recheckAlertCondition(
    alert: MonitorAlert,
    jobs: ActiveJobRecord[],
    highCpuThreshold: number
): AlertRecheckResult {
    if (alert.kind === 'pollFailure' || !alert.jobName) {
        return 'unavailable';
    }

    const job = jobs.find((candidate) => sameJob(alert.jobName, candidate));
    if (!job) {
        return 'cleared';
    }

    return conditionIsPresent(alert.kind, job, highCpuThreshold) ? 'active' : 'cleared';
}
