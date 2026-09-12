import type { MonitorAlert } from '../alerts/alert-model';
import type { ActiveJobRecord } from '../../services/ibmi';
import { getJobKey, toNumber, WAITING_STATUSES } from '../monitoring/monitoring-model';

export interface WidgetSummary {
    schemaVersion: 1;
    app: 'iMonitor';
    generatedAt: string;
    connection: {
        name: string | null;
        host: string | null;
        user: string | null;
        port: number | null;
    };
    status: {
        label: 'Live' | 'Idle';
        healthy: boolean;
        detail: string;
    };
    metrics: {
        totalJobs: number;
        runningJobs: number;
        waitingJobs: number;
        messageWaitJobs: number;
        lockWaitJobs: number;
        peakCpu: number;
    };
    topIssue: {
        title: string;
        subtitle: string;
        severity: 'critical' | 'warning' | 'info';
        jobName: string | null;
        owner: string | null;
    } | null;
}

interface BuildWidgetSummaryInput {
    jobs: ActiveJobRecord[];
    alerts: MonitorAlert[];
    generatedAt: string;
    connection: WidgetSummary['connection'];
    active: boolean;
}

export function buildWidgetSummary(input: BuildWidgetSummaryInput): WidgetSummary {
    const jobs = Array.isArray(input.jobs) ? input.jobs : [];
    const alerts = Array.isArray(input.alerts) ? input.alerts.filter((alert) => alert.isActive !== false) : [];
    const peakCpu = jobs.reduce((highest, job) => Math.max(highest, toNumber(job.CPU)), 0);
    const runningJobs = jobs.filter((job) => job.STATUS === 'RUN').length;
    const waitingJobs = jobs.filter((job) => WAITING_STATUSES.has(job.STATUS || '')).length;
    const messageWaitJobs = jobs.filter((job) => job.STATUS === 'MSGW').length;
    const lockWaitJobs = jobs.filter((job) => job.STATUS === 'LCKW').length;
    const highestCpuJob = jobs.slice().sort((left, right) => toNumber(right.CPU) - toNumber(left.CPU))[0];
    const topAlert = alerts[0];

    return {
        schemaVersion: 1,
        app: 'iMonitor',
        generatedAt: input.generatedAt,
        connection: input.connection,
        status: {
            label: input.active ? 'Live' : 'Idle',
            healthy: alerts.length === 0 && waitingJobs === 0,
            detail: alerts.length
                ? `${alerts.length} active issue${alerts.length === 1 ? '' : 's'}`
                : waitingJobs
                    ? `${waitingJobs} waiting job${waitingJobs === 1 ? '' : 's'}`
                    : 'Monitoring healthy'
        },
        metrics: {
            totalJobs: jobs.length,
            runningJobs,
            waitingJobs,
            messageWaitJobs,
            lockWaitJobs,
            peakCpu
        },
        topIssue: topAlert
            ? {
                title: topAlert.title,
                subtitle: topAlert.message,
                severity: topAlert.severity,
                jobName: topAlert.jobName || null,
                owner: topAlert.owner || null
            }
            : highestCpuJob
                ? {
                    title: highestCpuJob.SUBSYSTEM_JOB || getJobKey(highestCpuJob),
                    subtitle: highestCpuJob.FUNCTION_NAME || 'Top CPU job',
                    severity: peakCpu >= 80 ? 'warning' : 'info',
                    jobName: getJobKey(highestCpuJob),
                    owner: null
                }
                : null
    };
}
