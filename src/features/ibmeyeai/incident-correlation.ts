import type { ActiveJobRecord } from '../../services/ibmi';
import type { AlertSeverity, MonitorAlert } from '../alerts/alert-model';
import { buildJobRootCauseGuidance } from '../guidance/root-cause-guidance';
import { getJobKey, getJobTitle, toNumber } from '../monitoring/monitoring-model';

export interface IncidentCorrelation {
    key: string;
    title: string;
    severity: AlertSeverity;
    alertIds: string[];
    affectedJobs: string[];
    evidence: string[];
    nextAction: string;
}

const KIND_LABELS: Record<MonitorAlert['kind'], string> = {
    highCpu: 'high CPU',
    messageWait: 'message wait',
    lockWait: 'lock wait',
    delayWait: 'delay wait',
    dequeueWait: 'dequeue wait',
    pollFailure: 'poll failure'
};

/**
 * Correlates the bounded set of active alerts with the latest job evidence.
 * This is deliberately deterministic so AI receives useful structure without
 * another network request or a second monitoring pass.
 */
export function buildIncidentCorrelations(
    alerts: MonitorAlert[],
    jobs: ActiveJobRecord[],
    highCpuThreshold: number,
    maxIncidents = 12
): IncidentCorrelation[] {
    const jobIndex = new Map(jobs.map((job) => [getJobKey(job), job]));
    const groups = new Map<string, MonitorAlert[]>();

    alerts
        .filter((alert) => alert.isActive !== false)
        .slice(0, 50)
        .forEach((alert) => {
            const key = alert.jobName ? `job:${alert.jobName}` : `system:${alert.kind}`;
            const group = groups.get(key) ?? [];
            group.push(alert);
            groups.set(key, group);
        });

    return Array.from(groups.entries())
        .slice(0, maxIncidents)
        .map(([key, group]) => buildIncidentCorrelation(key, group, jobIndex, highCpuThreshold));
}

function buildIncidentCorrelation(
    key: string,
    alerts: MonitorAlert[],
    jobIndex: Map<string, ActiveJobRecord>,
    highCpuThreshold: number
): IncidentCorrelation {
    const firstAlert = alerts[0];
    const severity = alerts.some((alert) => alert.severity === 'critical') ? 'critical' : 'warning';
    const affectedJobs = Array.from(new Set(alerts.map((alert) => alert.jobName).filter(Boolean))) as string[];
    const job = affectedJobs
        .map((jobName) => jobIndex.get(jobName))
        .find(Boolean);
    const kindSummary = Array.from(new Set(alerts.map((alert) => KIND_LABELS[alert.kind]))).join(' + ');
    const title = job
        ? `${getJobTitle(job)}: ${kindSummary} incident`
        : `System: ${kindSummary} incident`;
    const evidence = alerts.map((alert) => (
        `${KIND_LABELS[alert.kind]} alert=${alert.id}${alert.message ? ` :: ${alert.message}` : ''}`
    ));

    if (job) {
        const guidance = buildJobRootCauseGuidance(job, highCpuThreshold);
        evidence.push(
            `job=${getJobTitle(job)} status=${job.STATUS || 'UNKNOWN'} cpu=${toNumber(job.CPU).toFixed(2)}%`,
            `likelyCause=${guidance.likelyCause}`
        );

        return {
            key,
            title,
            severity,
            alertIds: alerts.map((alert) => alert.id),
            affectedJobs,
            evidence,
            nextAction: guidance.nextSteps[0] || 'Review the current job details before acting.'
        };
    }

    return {
        key,
        title,
        severity,
        alertIds: alerts.map((alert) => alert.id),
        affectedJobs,
        evidence,
        nextAction: firstAlert.kind === 'pollFailure'
            ? 'Verify the monitoring connection and obtain a fresh poll before diagnosing jobs.'
            : 'Review the alert evidence and confirm the affected system condition before acting.'
    };
}
