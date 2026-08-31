import type { ActiveJobRecord } from '../../services/ibmi';

interface JobPollRecord {
    timestamp: string;
    payload: Record<string, unknown>;
}

/**
 * Builds a readable, job-scoped history from persisted monitoring poll records.
 */
export function buildJobHistoryLog(
    jobName: string,
    records: JobPollRecord[],
    getJobKey: (job: ActiveJobRecord) => string
): string {
    const requestedJobName = jobName.trim();
    const lines = [`iMonitor job history: ${requestedJobName}`, `Generated: ${new Date().toISOString()}`, ''];

    records.forEach((record) => {
        if (!Array.isArray(record.payload.jobs)) {
            return;
        }

        const job = (record.payload.jobs as ActiveJobRecord[]).find((candidate) => (
            getJobKey(candidate) === requestedJobName || String(candidate.SUBSYSTEM_JOB || '') === requestedJobName
        ));
        if (!job) {
            return;
        }

        const cpu = Number(job.CPU);
        const cpuLabel = Number.isFinite(cpu) ? cpu.toFixed(2) : '0.00';
        const fields = [
            `[${record.timestamp}] ${requestedJobName}`,
            `status=${job.STATUS || 'UNKNOWN'}`,
            `cpu=${cpuLabel}%`,
            `function=${job.FUNCTION_NAME || 'Unknown'}`
        ];
        if (job.SQL_STATEMENT_STATUS) fields.push(`sqlStatus=${job.SQL_STATEMENT_STATUS}`);
        if (job.SQL_STATEMENT_TEXT) fields.push(`sql=${job.SQL_STATEMENT_TEXT}`);
        if (job.DATABASE_LOCK_WAITS) fields.push(`dbLockWaits=${job.DATABASE_LOCK_WAITS}`);
        lines.push(fields.join(' '));
    });

    if (lines.length === 3) {
        lines.push('No captured poll snapshot matched this job yet.');
    }

    return `${lines.join('\n')}\n`;
}
