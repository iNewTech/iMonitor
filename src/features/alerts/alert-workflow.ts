import type { ActiveJobRecord } from '../../services/ibmi';
import {
    applyWorkflowStateToAlert,
    createAlertWorkflowState,
    markAlertConditionSeen,
    normalizeAlertWorkflowState,
    reopenAlertWorkflow,
    resolveAlertWorkflow
} from './alert-operator-workflow';
import {
    buildWaitReason,
    getJobKey,
    getJobTitle,
    toNumber
} from '../monitoring/monitoring-model';
import type { AlertSettings, MonitorAlert, StoredAlertWorkflowState } from './alert-model';

export interface AlertWorkflowDependencies {
    activeAlerts: MonitorAlert[];
    dismissedAlertIds: Set<string>;
    workflowStateByAlertId: Record<string, StoredAlertWorkflowState>;
    settings: AlertSettings;
    timestamp: string;
    notify: (key: string, title: string, body: string) => void;
}

interface AlertWorkflowEvaluationResult {
    alerts: MonitorAlert[];
    workflowStateByAlertId: Record<string, StoredAlertWorkflowState>;
}

/**
 * Builds the detailed body used for high CPU alerts.
 */
export function buildAlertDetail(job: ActiveJobRecord) {
    const cpu = toNumber(job.CPU).toFixed(2);
    const sqlStatus = job.SQL_STATEMENT_STATUS ? ` SQL: ${job.SQL_STATEMENT_STATUS}.` : '';
    return `${getJobTitle(job)} is in ${job.STATUS || 'UNKNOWN'} at ${cpu}% CPU.${sqlStatus}`;
}

/**
 * Recomputes the operator alert queue from the latest jobs poll.
 */
export function evaluateAlertRules(
    jobs: ActiveJobRecord[],
    dependencies: AlertWorkflowDependencies
): AlertWorkflowEvaluationResult {
    const {
        activeAlerts,
        dismissedAlertIds,
        workflowStateByAlertId,
        settings,
        timestamp,
        notify
    } = dependencies;
    const existingAlerts = new Map(activeAlerts.map((alert) => [alert.id, alert]));
    const nextAlerts = new Map<string, MonitorAlert>();
    const nextWorkflowStateByAlertId = { ...workflowStateByAlertId };

    jobs.forEach((job) => {
        const jobKey = getJobKey(job);
        const cpu = toNumber(job.CPU);

        if (settings.watchMessageWait && job.STATUS === 'MSGW') {
            const alertId = `msgw:${jobKey}`;
            if (!dismissedAlertIds.has(alertId)) {
                const existingAlert = existingAlerts.get(alertId);
                const nextWorkflowState = buildNextWorkflowState({
                    alertId,
                    timestamp,
                    detail: buildWaitReason(job),
                    existingAlert,
                    workflowStateByAlertId: nextWorkflowStateByAlertId
                });
                const alert = applyWorkflowStateToAlert({
                    id: alertId,
                    kind: 'messageWait',
                    severity: 'critical',
                    timestamp: existingAlert?.timestamp ?? timestamp,
                    lastSeenAt: timestamp,
                    resolvedAt: undefined,
                    isActive: true,
                    title: 'MSGW detected',
                    message: `${getJobTitle(job)} entered message wait.`,
                    detail: buildWaitReason(job),
                    jobName: jobKey
                }, nextWorkflowState);

                if (!existingAlert) {
                    notify(alertId, alert.title, `${alert.message} ${alert.detail || ''}`);
                }

                nextWorkflowStateByAlertId[alertId] = nextWorkflowState;
                nextAlerts.set(alertId, alert);
            }
        }

        if (settings.watchLockWait && job.STATUS === 'LCKW') {
            const alertId = `lckw:${jobKey}`;
            if (!dismissedAlertIds.has(alertId)) {
                const existingAlert = existingAlerts.get(alertId);
                const nextWorkflowState = buildNextWorkflowState({
                    alertId,
                    timestamp,
                    detail: buildWaitReason(job),
                    existingAlert,
                    workflowStateByAlertId: nextWorkflowStateByAlertId
                });
                const alert = applyWorkflowStateToAlert({
                    id: alertId,
                    kind: 'lockWait',
                    severity: 'critical',
                    timestamp: existingAlert?.timestamp ?? timestamp,
                    lastSeenAt: timestamp,
                    resolvedAt: undefined,
                    isActive: true,
                    title: 'LCKW detected',
                    message: `${getJobTitle(job)} is waiting on a lock.`,
                    detail: buildWaitReason(job),
                    jobName: jobKey
                }, nextWorkflowState);

                if (!existingAlert) {
                    notify(alertId, alert.title, `${alert.message} ${alert.detail || ''}`);
                }

                nextWorkflowStateByAlertId[alertId] = nextWorkflowState;
                nextAlerts.set(alertId, alert);
            }
        }

        if (settings.watchHighCpu && cpu >= settings.highCpuThreshold) {
            const alertId = `cpu:${jobKey}`;
            if (!dismissedAlertIds.has(alertId)) {
                const existingAlert = existingAlerts.get(alertId);
                const nextWorkflowState = buildNextWorkflowState({
                    alertId,
                    timestamp,
                    detail: buildAlertDetail(job),
                    existingAlert,
                    workflowStateByAlertId: nextWorkflowStateByAlertId
                });
                const alert = applyWorkflowStateToAlert({
                    id: alertId,
                    kind: 'highCpu',
                    severity: cpu >= settings.highCpuThreshold + 10 ? 'critical' : 'warning',
                    timestamp: existingAlert?.timestamp ?? timestamp,
                    lastSeenAt: timestamp,
                    resolvedAt: undefined,
                    isActive: true,
                    title: 'High CPU job detected',
                    message: `${getJobTitle(job)} reached ${cpu.toFixed(2)}% CPU.`,
                    detail: buildAlertDetail(job),
                    jobName: jobKey
                }, nextWorkflowState);

                if (!existingAlert) {
                    notify(alertId, alert.title, `${alert.message} ${job.CURRENT_USER || ''}`.trim());
                }

                nextWorkflowStateByAlertId[alertId] = nextWorkflowState;
                nextAlerts.set(alertId, alert);
            }
        }
    });

    existingAlerts.forEach((alert, alertId) => {
        if (nextAlerts.has(alertId)) {
            return;
        }

        dismissedAlertIds.delete(alertId);
        const resolvedWorkflowState = resolveAlertWorkflow(
            normalizeAlertWorkflowState(nextWorkflowStateByAlertId[alertId], timestamp),
            {
                timestamp,
                detail: 'Condition cleared in a later poll.'
            }
        );
        nextWorkflowStateByAlertId[alertId] = resolvedWorkflowState;

        nextAlerts.set(alertId, applyWorkflowStateToAlert({
            ...alert,
            isActive: false,
            resolvedAt: alert.resolvedAt ?? timestamp,
            detail: alert.detail || 'Condition cleared in a later poll.'
        }, resolvedWorkflowState));
    });

    return {
        alerts: Array.from(nextAlerts.values()).filter((alert) => !dismissedAlertIds.has(alert.id)),
        workflowStateByAlertId: nextWorkflowStateByAlertId
    };
}

/**
 * Builds or refreshes the failed poll alert entry.
 */
export function createPollFailureAlert(
    errorMessage: string,
    activeAlerts: MonitorAlert[],
    dismissedAlertIds: Set<string>,
    workflowStateByAlertId: Record<string, StoredAlertWorkflowState>
) {
    const alertId = 'poll-failure';
    if (dismissedAlertIds.has(alertId)) {
        return null;
    }

    const existingAlert = activeAlerts.find((alert) => alert.id === alertId);
    const timestamp = new Date().toISOString();
    const nextWorkflowState = buildNextWorkflowState({
        alertId,
        timestamp,
        detail: errorMessage,
        existingAlert,
        workflowStateByAlertId
    });
    return {
        alert: applyWorkflowStateToAlert({
            id: alertId,
            kind: 'pollFailure',
            severity: 'critical',
            timestamp: existingAlert?.timestamp ?? timestamp,
            lastSeenAt: timestamp,
            resolvedAt: undefined,
            isActive: true,
            title: 'Monitoring poll failed',
            message: 'IBMEye could not refresh active jobs.',
            detail: errorMessage
        }, nextWorkflowState),
        isNew: !existingAlert,
        workflowState: nextWorkflowState
    };
}

/**
 * Marks an alert resolved when a later system event proves it recovered.
 */
export function resolveAlertById(
    alertId: string,
    activeAlerts: MonitorAlert[],
    dismissedAlertIds: Set<string>,
    timestamp: string,
    detail?: string
) {
    const existingAlert = activeAlerts.find((alert) => alert.id === alertId);
    if (!existingAlert || existingAlert.isActive === false) {
        return activeAlerts;
    }

    dismissedAlertIds.delete(alertId);

    return activeAlerts.map((alert) => (
        alert.id === alertId
            ? applyWorkflowStateToAlert({
                ...alert,
                isActive: false,
                resolvedAt: timestamp,
                detail: detail ?? alert.detail
            }, resolveAlertWorkflow(normalizeAlertWorkflowState({
                status: alert.workflowStatus,
                owner: alert.owner,
                notes: alert.notes,
                timeline: alert.timeline,
                updatedAt: alert.workflowUpdatedAt,
                lastActionSummary: alert.lastActionSummary
            }, timestamp), { timestamp, detail }))
            : alert
    ));
}

/**
 * Removes an alert from the visible queue until the condition clears and reoccurs.
 */
export function clearAlertById(alertId: string, activeAlerts: MonitorAlert[], dismissedAlertIds: Set<string>) {
    dismissedAlertIds.add(alertId);
    return activeAlerts.filter((alert) => alert.id !== alertId);
}

function buildNextWorkflowState(params: {
    alertId: string;
    timestamp: string;
    detail?: string;
    existingAlert?: MonitorAlert;
    workflowStateByAlertId: Record<string, StoredAlertWorkflowState>;
}) {
    const { alertId, timestamp, detail, existingAlert, workflowStateByAlertId } = params;
    const storedState = workflowStateByAlertId[alertId];

    if (!storedState) {
        return createAlertWorkflowState(timestamp, detail);
    }

    if (!existingAlert || existingAlert.isActive === false || storedState.status === 'resolved' || storedState.status === 'cleared') {
        return reopenAlertWorkflow(storedState, timestamp, detail);
    }

    return markAlertConditionSeen(normalizeAlertWorkflowState(storedState, timestamp), timestamp);
}
