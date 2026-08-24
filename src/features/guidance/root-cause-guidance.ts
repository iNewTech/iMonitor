import type { ActiveJobRecord } from '../../services/ibmi';
import { toNumber } from '../monitoring/monitoring-model';

export interface RootCauseGuidance {
    severity: 'info' | 'warning' | 'critical';
    headline: string;
    impact: string;
    likelyCause: string;
    nextSteps: string[];
    technicalSummary: string;
}

/**
 * Builds operator-facing guidance for one monitored job.
 */
export function buildJobRootCauseGuidance(job: ActiveJobRecord, highCpuThreshold: number): RootCauseGuidance {
    const cpu = toNumber(job.CPU);

    if (job.STATUS === 'MSGW') {
        return {
            severity: 'critical',
            headline: 'Job is blocked waiting for a message reply.',
            impact: 'The job cannot continue until the required message is answered.',
            likelyCause: job.MESSAGE_REPLY === 'YES'
                ? 'An operator or automation reply is expected for the current message.'
                : 'The job is waiting on a message queue event before work can continue.',
            nextSteps: [
                'Inspect the pending message details before replying.',
                'Confirm whether the reply should continue, cancel, or retry the job path.',
                'Record the chosen response in the alert workflow notes.'
            ],
            technicalSummary: `${job.SUBSYSTEM_JOB || job.JOB_NAME || 'Job'} status=MSGW function=${job.FUNCTION_NAME || 'Unknown'}`
        };
    }

    if (job.STATUS === 'LCKW') {
        return {
            severity: 'critical',
            headline: 'Job is stalled on a lock wait.',
            impact: 'Progress is blocked until the lock owner commits, rolls back, or releases the resource.',
            likelyCause: 'Blocking database work or another resource owner is holding a lock needed by this job.',
            nextSteps: [
                'Identify the blocking job and compare its SQL or current function.',
                'Check whether the blocking work is expected or abandoned.',
                'If needed, hold, release, or end the blocking path with operator approval.'
            ],
            technicalSummary: `dbWaits=${toNumber(job.DATABASE_LOCK_WAITS)} dbWaitMs=${toNumber(job.DATABASE_LOCK_WAIT_TIME)} sqlStatus=${job.SQL_STATEMENT_STATUS || 'UNKNOWN'}`
        };
    }

    if (cpu >= highCpuThreshold) {
        return {
            severity: cpu >= highCpuThreshold + 10 ? 'critical' : 'warning',
            headline: 'Job is consuming high CPU.',
            impact: 'This job may be the current performance hotspot for the system or subsystem.',
            likelyCause: job.SQL_STATEMENT_TEXT
                ? 'The active SQL or current function is using sustained CPU.'
                : 'The job workload is CPU-heavy or looping through expensive work.',
            nextSteps: [
                'Inspect the current SQL statement and function name.',
                'Compare the job against normal workload expectations.',
                'Consider slowing, holding, or ending the job if it is runaway work.'
            ],
            technicalSummary: `cpu=${cpu.toFixed(2)} threshold=${highCpuThreshold} function=${job.FUNCTION_NAME || 'Unknown'}`
        };
    }

    return {
        severity: 'info',
        headline: 'Job is not in a known incident state.',
        impact: 'The job is visible for monitoring but no special operator guidance is needed yet.',
        likelyCause: 'No blocking wait, message wait, or high-CPU threshold breach is active.',
        nextSteps: [
            'Review SQL and status history if the job still looks suspicious.',
            'Keep monitoring for status changes.'
        ],
        technicalSummary: `status=${job.STATUS || 'UNKNOWN'} cpu=${cpu.toFixed(2)}`
    };
}

/**
 * Builds guidance for failed polls or disconnect-style monitoring issues.
 */
export function buildConnectionGuidance(kind: 'pollFailure' | 'disconnect', rawError: string): RootCauseGuidance {
    const normalized = rawError.toLowerCase();

    if (normalized.includes('timed out') || normalized.includes('etimedout')) {
        return {
            severity: 'critical',
            headline: 'Monitoring lost contact with the remote service.',
            impact: 'Polls are failing, so the dashboard may be stale until connectivity is restored.',
            likelyCause: 'Network reachability, firewall, VPN, or port access is preventing the service response.',
            nextSteps: [
                'Verify host reachability and the configured Mapepire port.',
                'Confirm VPN and firewall state.',
                'Retry once connectivity is restored.'
            ],
            technicalSummary: rawError
        };
    }

    if (normalized.includes('certificate') || normalized.includes('self signed')) {
        return {
            severity: 'warning',
            headline: 'TLS validation blocked monitoring.',
            impact: 'The app could not trust the remote endpoint for a secure poll.',
            likelyCause: 'Certificate trust or hostname validation does not match the target service.',
            nextSteps: [
                'Verify the hostname matches the remote certificate.',
                'Confirm whether the environment is expected to use a self-signed certificate.',
                'Retry after trust settings or endpoint details are corrected.'
            ],
            technicalSummary: rawError
        };
    }

    return {
        severity: kind === 'disconnect' ? 'warning' : 'critical',
        headline: kind === 'disconnect'
            ? 'The monitoring session disconnected.'
            : 'A monitoring poll failed.',
        impact: 'Current job and alert data may be out of date until the next successful poll.',
        likelyCause: 'The remote service rejected or interrupted the current monitoring request.',
        nextSteps: [
            'Check the latest connection and SQL log entries.',
            'Confirm the Mapepire service is still available.',
            'Retry the connection or monitoring cycle.'
        ],
        technicalSummary: rawError
    };
}
