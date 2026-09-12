import type { ActiveJobRecord } from '../../services/ibmi';
import { describeStatus, getJobTitle, toNumber } from '../monitoring/monitoring-model';
import type { JobStatusHistoryEntry } from '../monitoring/monitoring-model';
import type { MonitorAlert } from './alert-model';

export type IncidentResponseStep = 'respond' | 'investigate' | 'resolve';

export interface IncidentResponseEvidence {
    label: string;
    status: string;
    recordCount: number;
}

export interface IncidentResponseSnapshot {
    schema: 'imonitor-incident-response';
    version: 1;
    generatedAt: string;
    incidentKey: string;
    jobName: string;
    incidentTitle: string;
    step: IncidentResponseStep;
    impactLabel: 'Critical' | 'High' | 'Normal';
    impactSummary: string;
    owner: string;
    status: string;
    nextCheck: string;
    evidence: IncidentResponseEvidence[];
    completedChecks: string[];
    unsuccessfulAttempts: string[];
    unresolvedQuestions: string[];
    escalationReason: string;
}

interface IncidentResponseInput {
    job: ActiveJobRecord;
    alert?: MonitorAlert | null;
    statusHistory: JobStatusHistoryEntry[];
    operatorName?: string;
}

const EVIDENCE_SOURCES = [
    ['Trigger', 'trigger'],
    ['Job log', 'jobLog'],
    ['Messages', 'messages'],
    ['Queue', 'queue'],
    ['Subsystem', 'subsystem']
] as const;

/** Builds the compact response state and editable handoff defaults for one job. */
export function buildIncidentResponseSnapshot(input: IncidentResponseInput): IncidentResponseSnapshot {
    const { job, alert } = input;
    const jobName = String(job.JOB_NAME || job.SUBSYSTEM_JOB || 'Selected job').trim();
    const activeAlert = alert ?? null;
    const status = String(activeAlert?.workflowStatus || 'new');
    const step = getResponseStep(status);
    const impactLabel = getImpactLabel(activeAlert, job);
    const evidence = EVIDENCE_SOURCES.map(([label, source]) => ({
        label,
        status: activeAlert?.evidence?.[source]?.status || 'unavailable',
        recordCount: activeAlert?.evidence?.[source]?.recordCount || 0
    }));

    return {
        schema: 'imonitor-incident-response',
        version: 1,
        generatedAt: new Date().toISOString(),
        incidentKey: activeAlert?.incidentId || activeAlert?.id || `job:${jobName}`,
        jobName,
        incidentTitle: activeAlert?.title || 'No linked incident',
        step,
        impactLabel,
        impactSummary: getImpactSummary(activeAlert, job, impactLabel),
        owner: activeAlert?.owner || 'Unassigned',
        status: activeAlert?.workflowStatus || 'clear',
        nextCheck: getNextCheck(activeAlert, job),
        evidence,
        completedChecks: getCompletedChecks(activeAlert, input.statusHistory),
        unsuccessfulAttempts: getUnsuccessfulAttempts(activeAlert),
        unresolvedQuestions: getUnresolvedQuestions(activeAlert, job),
        escalationReason: getEscalationReason(activeAlert, job, input.operatorName)
    };
}

function getResponseStep(status: string): IncidentResponseStep {
    if (status === 'claimed' || status === 'work_done') return status === 'work_done' ? 'resolve' : 'investigate';
    if (status === 'system_cleared') return 'resolve';
    return 'respond';
}

function getImpactLabel(alert: MonitorAlert | null, job: ActiveJobRecord): IncidentResponseSnapshot['impactLabel'] {
    if (alert?.severity === 'critical' || ['MSGW', 'LCKW', 'DEQW'].includes(String(job.STATUS))) return 'Critical';
    if (alert || toNumber(job.CPU) >= 80) return 'High';
    return 'Normal';
}

function getImpactSummary(
    alert: MonitorAlert | null,
    job: ActiveJobRecord,
    impactLabel: IncidentResponseSnapshot['impactLabel']
) {
    if (alert?.message) return alert.message;
    if (impactLabel === 'Normal') return `${getJobTitle(job)} is visible for monitoring with no linked incident.`;
    return `${getJobTitle(job)} is currently ${describeStatus(job.STATUS).toLowerCase()}.`;
}

function getNextCheck(alert: MonitorAlert | null, job: ActiveJobRecord) {
    switch (alert?.kind) {
        case 'messageWait':
            return 'Inspect the waiting message and confirm the approved reply before responding.';
        case 'lockWait':
            return 'Identify the blocking job and confirm whether its work is expected before acting.';
        case 'dequeueWait':
            return 'Confirm which dequeue operation is pending and whether the queue owner is still active.';
        case 'delayWait':
            return 'Confirm the scheduled delay and whether the business deadline is at risk.';
        case 'highCpu':
            return 'Compare CPU usage with the expected workload and inspect the current function or SQL.';
        case 'pollFailure':
            return 'Confirm the monitoring connection and establish whether the displayed job state is current.';
        default:
            return `Confirm the current ${describeStatus(job.STATUS).toLowerCase()} state on the next poll.`;
    }
}

function getCompletedChecks(alert: MonitorAlert | null, statusHistory: JobStatusHistoryEntry[]) {
    const checks = (alert?.timeline || [])
        .filter((entry) => ['acknowledged', 'claimed', 'rechecked', 'note_added'].includes(entry.action))
        .slice(-6)
        .map((entry) => `${entry.label}${entry.actor ? ` by ${entry.actor}` : ''}`);
    const latestStatus = statusHistory[statusHistory.length - 1];
    if (latestStatus) checks.unshift(`Latest job state observed: ${latestStatus.label}`);
    return checks.length ? checks : ['No operator checks recorded yet.'];
}

function getUnsuccessfulAttempts(alert: MonitorAlert | null) {
    const attempts = (alert?.timeline || [])
        .filter((entry) => /fail|denied|error|unsuccessful/i.test(`${entry.label} ${entry.detail || ''}`))
        .slice(-6)
        .map((entry) => `${entry.label}${entry.detail ? `: ${entry.detail}` : ''}`);
    return attempts.length ? attempts : ['No unsuccessful attempts recorded.'];
}

function getUnresolvedQuestions(alert: MonitorAlert | null, job: ActiveJobRecord) {
    if (!alert) return ['Is there an operator-impacting condition outside the current alert rules?'];
    if (alert.workflowStatus === 'work_done') return ['Did the next monitoring poll confirm recovery?'];
    return [
        `Is the ${describeStatus(job.STATUS).toLowerCase()} condition expected for this workload?`,
        'Has the business owner approved the next production action?'
    ];
}

function getEscalationReason(alert: MonitorAlert | null, job: ActiveJobRecord, operatorName?: string) {
    if (!alert) return 'Escalation is optional; continue monitoring this job until an incident is linked.';
    if (alert.severity === 'critical') {
        return `Escalate if the ${describeStatus(job.STATUS).toLowerCase()} condition remains after the next check or requires specialist authority.`;
    }
    return `Keep ${operatorName || 'the assigned operator'} on the response unless the condition worsens, recurs, or needs specialist authority.`;
}
