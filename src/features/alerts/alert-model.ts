/**
 * Alert severities shown in the operator queue.
 */
export type AlertSeverity = 'critical' | 'warning';

/**
 * Supported alert categories in the IBMEye module.
 */
export type AlertKind = 'highCpu' | 'messageWait' | 'lockWait' | 'pollFailure';

/**
 * Operator workflow states for tracked alerts.
 */
export type AlertWorkflowStatus = 'new' | 'acknowledged' | 'in_progress' | 'resolved' | 'cleared';

/**
 * Supported operator actions on an alert.
 */
export type AlertWorkflowAction =
    | 'created'
    | 'condition_seen'
    | 'acknowledged'
    | 'started'
    | 'note_added'
    | 'resolved'
    | 'cleared'
    | 'reopened';

/**
 * User-configurable alert toggles and thresholds.
 */
export interface AlertSettings {
    desktopNotifications: boolean;
    watchHighCpu: boolean;
    highCpuThreshold: number;
    watchMessageWait: boolean;
    watchLockWait: boolean;
    watchFailedPolls: boolean;
    watchDisconnects: boolean;
}

/**
 * One operator-facing alert item in the queue.
 */
export interface MonitorAlert {
    id: string;
    kind: AlertKind;
    severity: AlertSeverity;
    timestamp: string;
    lastSeenAt?: string;
    resolvedAt?: string;
    isActive?: boolean;
    title: string;
    message: string;
    detail?: string;
    jobName?: string;
    workflowStatus: AlertWorkflowStatus;
    owner?: string;
    notes: AlertNote[];
    timeline: AlertTimelineEntry[];
    workflowUpdatedAt: string;
    lastActionSummary?: string;
}

/**
 * Free-form operator note attached to an alert.
 */
export interface AlertNote {
    id: string;
    timestamp: string;
    text: string;
}

/**
 * Immutable workflow timeline entry displayed in the alert queue.
 */
export interface AlertTimelineEntry {
    id: string;
    timestamp: string;
    action: AlertWorkflowAction;
    label: string;
    detail?: string;
}

/**
 * Persisted operator workflow state stored independently from live poll results.
 */
export interface StoredAlertWorkflowState {
    status: AlertWorkflowStatus;
    owner?: string;
    notes: AlertNote[];
    timeline: AlertTimelineEntry[];
    updatedAt: string;
    lastActionSummary?: string;
}

/**
 * Default alert settings used for first launch and validation fallback.
 */
export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
    desktopNotifications: true,
    watchHighCpu: true,
    highCpuThreshold: 80,
    watchMessageWait: true,
    watchLockWait: true,
    watchFailedPolls: true,
    watchDisconnects: true
};

/**
 * Clamps and fills alert settings so the store always contains a valid shape.
 */
export function normalizeAlertSettings(candidate: Partial<AlertSettings> | undefined) {
    const nextThreshold = Number(candidate?.highCpuThreshold);

    return {
        desktopNotifications: candidate?.desktopNotifications ?? DEFAULT_ALERT_SETTINGS.desktopNotifications,
        watchHighCpu: candidate?.watchHighCpu ?? DEFAULT_ALERT_SETTINGS.watchHighCpu,
        highCpuThreshold: Number.isFinite(nextThreshold)
            ? Math.max(1, Math.min(100, nextThreshold))
            : DEFAULT_ALERT_SETTINGS.highCpuThreshold,
        watchMessageWait: candidate?.watchMessageWait ?? DEFAULT_ALERT_SETTINGS.watchMessageWait,
        watchLockWait: candidate?.watchLockWait ?? DEFAULT_ALERT_SETTINGS.watchLockWait,
        watchFailedPolls: candidate?.watchFailedPolls ?? DEFAULT_ALERT_SETTINGS.watchFailedPolls,
        watchDisconnects: candidate?.watchDisconnects ?? DEFAULT_ALERT_SETTINGS.watchDisconnects
    };
}

function severityRank(severity: AlertSeverity) {
    return severity === 'critical' ? 0 : 1;
}

/**
 * Keeps active alerts at the top, then sorts from oldest to newest so the
 * operator queue grows downward without shifting the item currently in view.
 */
export function sortAlerts(alerts: MonitorAlert[]) {
    return alerts.sort((left, right) => {
        const activeOrder = Number(Boolean(right.isActive)) - Number(Boolean(left.isActive));
        if (activeOrder !== 0) {
            return activeOrder;
        }

        const leftTime = new Date(left.lastSeenAt ?? left.resolvedAt ?? left.timestamp).getTime();
        const rightTime = new Date(right.lastSeenAt ?? right.resolvedAt ?? right.timestamp).getTime();
        const timeOrder = leftTime - rightTime;
        if (timeOrder !== 0) {
            return timeOrder;
        }

        return severityRank(left.severity) - severityRank(right.severity);
    });
}
