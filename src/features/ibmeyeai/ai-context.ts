import type { ActiveJobRecord } from '../../services/ibmi';
import type { MonitorAlert } from '../alerts/alert-model';
import type { MonitoringSnapshot } from '../monitoring/monitoring-model';
import {
    buildWaitReason,
    describeStatus,
    getJobTitle,
    toNumber
} from '../monitoring/monitoring-model';
import type { AiAssistantSettings } from './ai-model';

interface ActivityLogLike {
    timestamp: string;
    area: string;
    level: string;
    message: string;
    detail?: string;
    sql?: string;
}

interface ConnectionContext {
    name?: string | null;
    host?: string | null;
    user?: string | null;
    port?: number | null;
}

export interface BuildAiAssistantContextInput {
    appName: string;
    connection: ConnectionContext | null;
    monitorMode: 'live' | 'dummy';
    settings: AiAssistantSettings;
    latestJobs: ActiveJobRecord[];
    alerts: MonitorAlert[];
    monitoringHistory: MonitoringSnapshot[];
    activityLog: ActivityLogLike[];
    selectedJob?: ActiveJobRecord | null;
}

/**
 * Builds a compact, operator-focused context block for LLM analysis.
 */
export function buildAiAssistantContext(input: BuildAiAssistantContextInput) {
    const connectionLabel = formatConnection(input.connection);
    const selectedJob = input.selectedJob ?? null;
    const alerts = input.alerts.slice(0, input.settings.alertLimit).map((alert) => (
        `${alert.severity.toUpperCase()} ${alert.kind} ${alert.jobName ? `job=${alert.jobName} ` : ''}${alert.title} :: ${alert.message}`
    ));
    const jobs = input.latestJobs.slice(0, input.settings.jobLimit).map((job) => (
        `${getJobTitle(job)} status=${job.STATUS || 'UNKNOWN'} cpu=${toNumber(job.CPU).toFixed(2)} user=${job.CURRENT_USER || job.JOB_USER || 'UNKNOWN'} function=${job.FUNCTION_NAME || 'Unknown'}`
    ));
    const history = input.monitoringHistory.slice(-input.settings.historyLimit).map((snapshot) => (
        `${snapshot.timestamp} totalJobs=${snapshot.totalJobs} peakCpu=${snapshot.peakCpu.toFixed(2)} waiting=${snapshot.waitingJobs} msgw=${snapshot.messageWaitJobs} lckw=${snapshot.lockWaitJobs}`
    ));
    const activity = input.activityLog.slice(0, input.settings.activityLimit).map((entry) => (
        `${entry.timestamp} [${entry.level.toUpperCase()}] [${entry.area.toUpperCase()}] ${entry.message}${entry.detail ? ` :: ${entry.detail}` : ''}${entry.sql ? ` :: SQL=${collapseWhitespace(entry.sql).slice(0, 240)}` : ''}`
    ));

    const selectedJobSummary = selectedJob
        ? [
            `Selected job: ${getJobTitle(selectedJob)}`,
            `Selected job status: ${describeStatus(selectedJob.STATUS)}`,
            `Selected job wait: ${buildWaitReason(selectedJob)}`,
            `Selected job SQL: ${selectedJob.SQL_STATEMENT_TEXT ? collapseWhitespace(selectedJob.SQL_STATEMENT_TEXT).slice(0, 320) : 'No SQL captured.'}`
        ]
        : ['Selected job: none'];

    return [
        `${input.appName} AI context`,
        `Monitor mode: ${input.monitorMode}`,
        ...(input.monitorMode === 'dummy'
            ? ['Demo-only instruction: treat these synthetic records as if they were production IBM i evidence. Explain impact and recommended actions as you would for a real system; do not dismiss issues because this is demo data.']
            : []),
        `Connection: ${connectionLabel}`,
        `Timestamp: ${new Date().toISOString()}`,
        '',
        'Active alerts:',
        ...(alerts.length ? alerts : ['None']),
        '',
        'Top jobs from latest poll:',
        ...(jobs.length ? jobs : ['None']),
        '',
        'Recent monitoring history:',
        ...(history.length ? history : ['None']),
        '',
        'Recent operator log entries:',
        ...(activity.length ? activity : ['None']),
        '',
        ...selectedJobSummary
    ].join('\n');
}

function collapseWhitespace(value: string) {
    return value.replace(/\s+/g, ' ').trim();
}

function formatConnection(connection: ConnectionContext | null) {
    if (!connection?.host || !connection?.user) {
        return connection?.name || 'No active connection';
    }

    const namePrefix = connection.name ? `${connection.name} ` : '';
    const port = connection.port ? `:${connection.port}` : '';
    return `${namePrefix}(${connection.user}@${connection.host}${port})`;
}
