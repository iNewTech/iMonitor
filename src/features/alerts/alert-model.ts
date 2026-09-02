import type { ClickUpTaskReference } from '../integrations/clickup/clickup-model';

/**
 * Alert severities shown in the operator queue.
 */
export type AlertSeverity = 'critical' | 'warning';

/** Identifies how a tracked condition was confirmed as resolved. */
export type AlertResolutionSource = 'automatic' | 'manual_recheck';

/**
 * Supported alert categories in the IBMEye module.
 */
export type AlertKind = 'highCpu' | 'messageWait' | 'lockWait' | 'delayWait' | 'dequeueWait' | 'pollFailure';

/**
 * Operator workflow states for tracked alerts.
 */
export type AlertWorkflowStatus = 'new' | 'acknowledged' | 'claimed' | 'work_done' | 'system_cleared';

/**
 * Supported operator actions on an alert.
 */
export type AlertWorkflowAction =
    | 'created'
    | 'condition_seen'
    | 'acknowledged'
    | 'claimed'
    | 'released'
    | 'note_added'
    | 'work_marked_done'
    | 'system_cleared'
    | 'rechecked'
    | 'reopened';

/**
 * User-configurable alert toggles and thresholds.
 */
export interface AlertSettings {
    desktopNotifications: boolean;
    watchHighCpu: boolean;
    highCpuThreshold: number;
    highCpuRecoveryPolls: number;
    watchMessageWait: boolean;
    watchLockWait: boolean;
    watchDelayWait: boolean;
    watchDequeueWait: boolean;
    watchFailedPolls: boolean;
    watchDisconnects: boolean;
    createClickUpForHighCpu: boolean;
    createClickUpForMessageWait: boolean;
    createClickUpForLockWait: boolean;
    createClickUpForDelayWait: boolean;
    createClickUpForDequeueWait: boolean;
    createClickUpForPollFailure: boolean;
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
    resolutionSource?: AlertResolutionSource;
    recoveryPollCount?: number;
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
    clickUpTask?: ClickUpTaskReference;
}

/**
 * Free-form operator note attached to an alert.
 */
export interface AlertNote {
    id: string;
    timestamp: string;
    author?: string;
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
    actor?: string;
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
    clickUpTask?: ClickUpTaskReference;
}

/**
 * Default alert settings used for first launch and validation fallback.
 */
export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
    desktopNotifications: true,
    watchHighCpu: true,
    highCpuThreshold: 80,
    highCpuRecoveryPolls: 3,
    watchMessageWait: true,
    watchLockWait: true,
    watchDelayWait: true,
    watchDequeueWait: true,
    watchFailedPolls: true,
    watchDisconnects: true,
    createClickUpForHighCpu: true,
    createClickUpForMessageWait: true,
    createClickUpForLockWait: true,
    createClickUpForDelayWait: false,
    createClickUpForDequeueWait: false,
    createClickUpForPollFailure: false
};

/**
 * Clamps and fills alert settings so the store always contains a valid shape.
 */
export function normalizeAlertSettings(candidate: Partial<AlertSettings> | undefined) {
    const nextThreshold = Number(candidate?.highCpuThreshold);
    const nextRecoveryPolls = Number(candidate?.highCpuRecoveryPolls);

    return {
        desktopNotifications: candidate?.desktopNotifications ?? DEFAULT_ALERT_SETTINGS.desktopNotifications,
        watchHighCpu: candidate?.watchHighCpu ?? DEFAULT_ALERT_SETTINGS.watchHighCpu,
        highCpuThreshold: Number.isFinite(nextThreshold)
            ? Math.max(1, Math.min(100, nextThreshold))
            : DEFAULT_ALERT_SETTINGS.highCpuThreshold,
        highCpuRecoveryPolls: Number.isFinite(nextRecoveryPolls)
            ? Math.max(1, Math.min(10, Math.round(nextRecoveryPolls)))
            : DEFAULT_ALERT_SETTINGS.highCpuRecoveryPolls,
        watchMessageWait: candidate?.watchMessageWait ?? DEFAULT_ALERT_SETTINGS.watchMessageWait,
        watchLockWait: candidate?.watchLockWait ?? DEFAULT_ALERT_SETTINGS.watchLockWait,
        watchDelayWait: candidate?.watchDelayWait ?? DEFAULT_ALERT_SETTINGS.watchDelayWait,
        watchDequeueWait: candidate?.watchDequeueWait ?? DEFAULT_ALERT_SETTINGS.watchDequeueWait,
        watchFailedPolls: candidate?.watchFailedPolls ?? DEFAULT_ALERT_SETTINGS.watchFailedPolls,
        watchDisconnects: candidate?.watchDisconnects ?? DEFAULT_ALERT_SETTINGS.watchDisconnects,
        createClickUpForHighCpu: candidate?.createClickUpForHighCpu ?? DEFAULT_ALERT_SETTINGS.createClickUpForHighCpu,
        createClickUpForMessageWait: candidate?.createClickUpForMessageWait ?? DEFAULT_ALERT_SETTINGS.createClickUpForMessageWait,
        createClickUpForLockWait: candidate?.createClickUpForLockWait ?? DEFAULT_ALERT_SETTINGS.createClickUpForLockWait,
        createClickUpForDelayWait: candidate?.createClickUpForDelayWait ?? DEFAULT_ALERT_SETTINGS.createClickUpForDelayWait,
        createClickUpForDequeueWait: candidate?.createClickUpForDequeueWait ?? DEFAULT_ALERT_SETTINGS.createClickUpForDequeueWait,
        createClickUpForPollFailure: candidate?.createClickUpForPollFailure ?? DEFAULT_ALERT_SETTINGS.createClickUpForPollFailure
    };
}

/**
 * Returns whether the shared IBMEye Alerts watch rule allows this alert kind.
 * Notification channels consume alerts after this decision, so they do not
 * maintain a second per-channel copy of the same condition rules.
 */
export function shouldWatchAlert(settings: AlertSettings, kind: AlertKind) {
    switch (kind) {
        case 'highCpu':
            return settings.watchHighCpu;
        case 'messageWait':
            return settings.watchMessageWait;
        case 'lockWait':
            return settings.watchLockWait;
        case 'delayWait':
            return settings.watchDelayWait;
        case 'dequeueWait':
            return settings.watchDequeueWait;
        case 'pollFailure':
            return settings.watchFailedPolls;
        default:
            return false;
    }
}

/**
 * Returns whether a new alert kind should create a ClickUp task.
 */
export function shouldCreateClickUpTask(settings: AlertSettings, kind: AlertKind) {
    switch (kind) {
        case 'highCpu':
            return settings.createClickUpForHighCpu;
        case 'messageWait':
            return settings.createClickUpForMessageWait;
        case 'lockWait':
            return settings.createClickUpForLockWait;
        case 'delayWait':
            return settings.createClickUpForDelayWait;
        case 'dequeueWait':
            return settings.createClickUpForDequeueWait;
        case 'pollFailure':
            return settings.createClickUpForPollFailure;
        default:
            return false;
    }
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
