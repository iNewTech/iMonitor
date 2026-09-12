import type { ActiveJobRecord } from '../../services/ibmi';
import type {
    AlertSeverity,
    IncidentCorrelationMetadata,
    IncidentPriority,
    MonitorAlert
} from '../alerts/alert-model';
import { buildJobRootCauseGuidance } from '../guidance/root-cause-guidance';
import { getJobKey, getJobTitle, toNumber } from '../monitoring/monitoring-model';

export const INCIDENT_CORRELATION_WINDOW_MS = 5 * 60 * 1000;

export interface IncidentCorrelation {
    key: string;
    fingerprint: string;
    title: string;
    severity: AlertSeverity;
    alertIds: string[];
    affectedJobs: string[];
    evidence: string[];
    nextAction: string;
    groupReason: string;
    suggested: boolean;
    relatedSignals: string[];
    priority: IncidentPriority;
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
    const groups = new Map<string, MonitorAlert[][]>();

    alerts
        .filter((alert) => alert.isActive !== false)
        .slice(0, 50)
        .forEach((alert) => {
            const scopeKey = alert.jobName ? `job:${alert.jobName}` : `system:${alert.kind}`;
            const scopedGroups = groups.get(scopeKey) ?? [];
            const timestamp = getAlertTimestamp(alert);
            const matchingGroup = scopedGroups.find((group) => (
                Math.abs(timestamp - getAlertTimestamp(group[group.length - 1])) <= INCIDENT_CORRELATION_WINDOW_MS
            ));
            if (matchingGroup) {
                matchingGroup.push(alert);
            } else {
                scopedGroups.push([alert]);
            }
            groups.set(scopeKey, scopedGroups);
        });

    return Array.from(groups.entries())
        .flatMap(([key, scopedGroups]) => scopedGroups.map((group) => (
            buildIncidentCorrelation(key, group, jobIndex, highCpuThreshold)
        )))
        .sort(compareIncidentPriority)
        .slice(0, maxIncidents);
}

/** Adds the latest explainable correlation snapshot to alerts sent to the UI. */
export function attachIncidentCorrelations(
    alerts: MonitorAlert[],
    jobs: ActiveJobRecord[],
    highCpuThreshold: number,
    maxIncidents = 12
) {
    const correlations = buildIncidentCorrelations(alerts, jobs, highCpuThreshold, maxIncidents);
    const metadataByAlertId = new Map<string, IncidentCorrelationMetadata>();

    correlations.forEach((correlation) => {
        const metadata: IncidentCorrelationMetadata = {
            fingerprint: correlation.fingerprint,
            groupReason: correlation.groupReason,
            suggested: correlation.suggested,
            relatedSignals: correlation.relatedSignals,
            priority: correlation.priority
        };
        correlation.alertIds.forEach((alertId) => metadataByAlertId.set(alertId, metadata));
    });

    return alerts.map((alert) => {
        const metadata = metadataByAlertId.get(alert.id);
        return metadata ? { ...alert, correlation: metadata } : alert;
    });
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
    const relatedSignals = Array.from(new Set(alerts.map((alert) => KIND_LABELS[alert.kind])));
    const groupReason = affectedJobs.length
        ? alerts.length > 1
            ? `Signals for the same IBM i job were captured within ${INCIDENT_CORRELATION_WINDOW_MS / 60000} minutes.`
            : 'One active signal is linked to this IBM i job.'
        : 'System-level signal has no job identity; operator review is recommended.';
    const suggested = affectedJobs.length === 0;
    const priority = buildIncidentPriority(alerts, affectedJobs, job);
    const fingerprint = buildIncidentFingerprint(key, alerts);
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
            `likelyCause=${guidance.likelyCause}`,
            `groupReason=${groupReason}`
        );

        return {
            key,
            fingerprint,
            title,
            severity,
            alertIds: alerts.map((alert) => alert.id),
            affectedJobs,
            evidence,
            nextAction: guidance.nextSteps[0] || 'Review the current job details before acting.',
            groupReason,
            suggested,
            relatedSignals,
            priority
        };
    }

    evidence.push(`groupReason=${groupReason}`);
    return {
        key,
        fingerprint,
        title,
        severity,
        alertIds: alerts.map((alert) => alert.id),
        affectedJobs,
        evidence,
        nextAction: firstAlert.kind === 'pollFailure'
            ? 'Verify the monitoring connection and obtain a fresh poll before diagnosing jobs.'
            : 'Review the alert evidence and confirm the affected system condition before acting.',
        groupReason,
        suggested,
        relatedSignals,
        priority
    };
}

function getAlertTimestamp(alert: MonitorAlert) {
    const value = new Date(alert.lastSeenAt ?? alert.timestamp).getTime();
    return Number.isFinite(value) ? value : 0;
}

function buildIncidentFingerprint(key: string, alerts: MonitorAlert[]) {
    return `${key}|${alerts.map((alert) => alert.incidentId || alert.id).sort().join('|')}`;
}

function buildIncidentPriority(
    alerts: MonitorAlert[],
    affectedJobs: string[],
    job?: ActiveJobRecord
): IncidentPriority {
    const technicalSeverity = alerts.some((alert) => alert.severity === 'critical') ? 45 : 25;
    const affectedJobFactor = Math.min(20, affectedJobs.length * 10);
    const uniqueKinds = new Set(alerts.map((alert) => alert.kind));
    const kindImpact = Array.from(uniqueKinds).reduce((total, kind) => total + ({
        messageWait: 16,
        lockWait: 16,
        highCpu: 12,
        dequeueWait: 10,
        delayWait: 7,
        pollFailure: 5
    }[kind] || 0), 0);
    const jobImpact = job?.STATUS === 'MSGW' || job?.STATUS === 'LCKW'
        ? 5
        : toNumber(job?.CPU) >= 80
            ? 4
            : 0;
    const workloadImpact = Math.min(25, kindImpact + jobImpact);
    const maxOccurrence = Math.max(...alerts.map((alert) => alert.occurrence ?? 1), 1);
    const recurrence = Math.min(10, Math.max(0, maxOccurrence - 1) * 2);
    const workflow = Math.max(...alerts.map((alert) => ({
        new: 10,
        acknowledged: 6,
        claimed: 3,
        work_done: 1,
        system_cleared: 0
    }[alert.workflowStatus] || 0)), 0);
    const factors = {
        technicalSeverity,
        affectedJobs: affectedJobFactor,
        workloadImpact,
        recurrence,
        workflow,
        businessImpact: 0
    };
    const score = Math.min(100, Object.values(factors).reduce((total, factor) => total + factor, 0));
    const band = score >= 75 ? 'critical' : score >= 50 ? 'high' : 'normal';
    const reasons = [
        technicalSeverity >= 45 ? 'Critical technical signal present.' : 'Warning technical signal.',
        affectedJobs.length > 1
            ? `${affectedJobs.length} jobs are affected.`
            : affectedJobs.length === 1
                ? 'One job is affected.'
                : 'No job identity is available.',
        workloadImpact >= 16 ? 'The condition can block or materially delay work.' : 'Limited workload impact from the available evidence.',
        recurrence > 0 ? `Recurring condition (${maxOccurrence} occurrences).` : 'No recurrence recorded yet.',
        workflow >= 10 ? 'Unassigned work is ready for operator review.' : 'Work is already in the operator workflow.',
        'Business impact is provisional until a business service is mapped.'
    ];

    return {
        score,
        band,
        reasons,
        factors,
        businessImpactMapped: false
    };
}

function compareIncidentPriority(left: IncidentCorrelation, right: IncidentCorrelation) {
    const scoreOrder = right.priority.score - left.priority.score;
    if (scoreOrder !== 0) {
        return scoreOrder;
    }
    return left.fingerprint.localeCompare(right.fingerprint);
}
