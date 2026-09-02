import {
    createPollFailureAlert,
    evaluateAlertRules as evaluateAlertQueue,
    clearAlertById as dismissAlertById,
    resolveAlertById
} from '../../features/alerts/alert-workflow';
import {
    type AlertSettings,
    type MonitorAlert,
    type StoredAlertWorkflowState
} from '../../features/alerts/alert-model';
import { normalizeAlertWorkflowState } from '../../features/alerts/alert-operator-workflow';
import {
    recordAlertRecheckWorkflow,
    systemClearAlertWorkflow
} from '../../features/alerts/alert-operator-workflow';
import type { AlertRecheckResult } from '../../features/alerts/alert-recheck';
import { sortAlerts } from '../../features/alerts/alert-model';
import type { ActiveJobRecord } from '../../services/ibmi';

interface AlertStateDependencies {
    initialWorkflowStateByAlertId: Record<string, StoredAlertWorkflowState>;
    persistWorkflowState: (workflowStateByAlertId: Record<string, StoredAlertWorkflowState>) => void;
    onAlertsChanged: (alerts: MonitorAlert[]) => void;
    onAlertCreated?: (alert: MonitorAlert) => void | Promise<void>;
}

/**
 * Stores runtime alerts, dismissals, and per-alert workflow progress.
 */
export function createAlertStateStore(dependencies: AlertStateDependencies) {
    let activeAlerts: MonitorAlert[] = [];
    let workflowStateByAlertId = dependencies.initialWorkflowStateByAlertId;
    const dismissedAlertIds = new Set<string>();
    const notificationLedger = new Map<string, number>();

    const persistWorkflowState = () => {
        dependencies.persistWorkflowState(workflowStateByAlertId);
    };

    const setActiveAlerts = (nextAlerts: MonitorAlert[]) => {
        activeAlerts = sortAlerts([...nextAlerts]);
        dependencies.onAlertsChanged(activeAlerts.slice());
    };

    return {
        getActiveAlerts() {
            return activeAlerts;
        },
        getDismissedAlertIds() {
            return dismissedAlertIds;
        },
        getNotificationLedger() {
            return notificationLedger;
        },
        getWorkflowStateByAlertId() {
            return workflowStateByAlertId;
        },
        clearDemoWorkflowLinks() {
            workflowStateByAlertId = {};
            persistWorkflowState();
        },
        setActiveAlerts,
        persistWorkflowState,
        resolveAlert(alertId: string, timestamp: string, detail?: string) {
            const nextAlerts = resolveAlertById(alertId, activeAlerts, dismissedAlertIds, timestamp, detail);
            const resolvedAlert = nextAlerts.find((alert) => alert.id === alertId);
            if (resolvedAlert) {
                workflowStateByAlertId = {
                    ...workflowStateByAlertId,
                    [alertId]: {
                        status: resolvedAlert.workflowStatus,
                        owner: resolvedAlert.owner,
                        notes: resolvedAlert.notes,
                        timeline: resolvedAlert.timeline,
                        updatedAt: resolvedAlert.workflowUpdatedAt,
                        lastActionSummary: resolvedAlert.lastActionSummary,
                        clickUpTask: resolvedAlert.clickUpTask
                    }
                };
                persistWorkflowState();
            }
            setActiveAlerts(nextAlerts);
        },
        recordAlertRecheck(
            alertId: string,
            result: AlertRecheckResult,
            timestamp: string,
            owner?: string
        ) {
            const alert = activeAlerts.find((candidate) => candidate.id === alertId);
            if (!alert || result === 'unavailable') {
                return alert;
            }

            const currentState = normalizeAlertWorkflowState(workflowStateByAlertId[alertId] ?? {
                status: alert.workflowStatus,
                owner: alert.owner,
                notes: alert.notes,
                timeline: alert.timeline,
                updatedAt: alert.workflowUpdatedAt,
                lastActionSummary: alert.lastActionSummary,
                clickUpTask: alert.clickUpTask
            }, timestamp);
            const cleared = result === 'cleared';
            const resolutionDetail = cleared
                ? 'Manual recheck confirmed that the condition is no longer present.'
                : 'Manual recheck confirmed that the condition is still present.';
            const clearedState = cleared && currentState.status !== 'system_cleared'
                ? systemClearAlertWorkflow(currentState, {
                    timestamp,
                    owner,
                    detail: resolutionDetail
                })
                : currentState;
            const nextState = recordAlertRecheckWorkflow(clearedState, {
                timestamp,
                owner,
                detail: resolutionDetail,
                cleared
            });

            workflowStateByAlertId = {
                ...workflowStateByAlertId,
                [alertId]: nextState
            };
            persistWorkflowState();

            setActiveAlerts(activeAlerts.map((candidate) => candidate.id === alertId
                ? {
                    ...candidate,
                    isActive: cleared ? false : true,
                    resolvedAt: cleared ? timestamp : undefined,
                    resolutionSource: cleared ? 'manual_recheck' : undefined,
                    recoveryPollCount: cleared ? candidate.recoveryPollCount : 0,
                    lastSeenAt: cleared ? candidate.lastSeenAt : timestamp,
                    workflowStatus: nextState.status,
                    owner: nextState.owner,
                    notes: nextState.notes,
                    timeline: nextState.timeline,
                    workflowUpdatedAt: nextState.updatedAt,
                    lastActionSummary: nextState.lastActionSummary,
                    clickUpTask: nextState.clickUpTask
                }
                : candidate));

            return activeAlerts.find((candidate) => candidate.id === alertId);
        },
        clearAlertById(alertId: string) {
            setActiveAlerts(dismissAlertById(alertId, activeAlerts, dismissedAlertIds));
        },
        mutateAlertWorkflow(
            alertId: string,
            mutation: (state: StoredAlertWorkflowState) => StoredAlertWorkflowState
        ) {
            const timestamp = new Date().toISOString();
            const currentState = normalizeAlertWorkflowState(workflowStateByAlertId[alertId], timestamp);
            const nextState = mutation(currentState);
            workflowStateByAlertId = {
                ...workflowStateByAlertId,
                [alertId]: nextState
            };
            persistWorkflowState();

            setActiveAlerts(activeAlerts.map((alert) => (
                alert.id === alertId
                    ? {
                        ...alert,
                        workflowStatus: nextState.status,
                        owner: nextState.owner,
                        notes: nextState.notes,
                        timeline: nextState.timeline,
                        workflowUpdatedAt: nextState.updatedAt,
                        lastActionSummary: nextState.lastActionSummary,
                        clickUpTask: nextState.clickUpTask
                    }
                    : alert
            )));

            return nextState;
        },
        evaluateAlertRules(
            jobs: ActiveJobRecord[],
            timestamp: string,
            settings: AlertSettings,
            notify: (key: string, title: string, body: string) => void
        ) {
            const previousAlertIds = new Set(activeAlerts.map((alert) => alert.id));
            const result = evaluateAlertQueue(jobs, {
                activeAlerts,
                dismissedAlertIds,
                workflowStateByAlertId,
                settings,
                timestamp,
                notify
            });

            workflowStateByAlertId = result.workflowStateByAlertId;
            persistWorkflowState();
            setActiveAlerts(result.alerts);

            result.alerts.forEach((alert) => {
                if (!previousAlertIds.has(alert.id)) {
                    void dependencies.onAlertCreated?.(alert);
                }
            });
        },
        setPollFailureAlert(
            errorMessage: string,
            settings: AlertSettings,
            notify: (key: string, title: string, body: string) => void
        ) {
            const nextFailureAlert = createPollFailureAlert(
                errorMessage,
                activeAlerts,
                dismissedAlertIds,
                workflowStateByAlertId
            );
            if (!nextFailureAlert) {
                return;
            }

            const { alert: nextAlert, isNew, workflowState } = nextFailureAlert;
            const remainingAlerts = activeAlerts.filter((alert) => alert.id !== nextAlert.id);
            workflowStateByAlertId = {
                ...workflowStateByAlertId,
                [nextAlert.id]: workflowState
            };
            persistWorkflowState();
            setActiveAlerts([nextAlert, ...remainingAlerts]);

            if (isNew) {
                void dependencies.onAlertCreated?.(nextAlert);
                if (settings.watchFailedPolls) {
                    notify(nextAlert.id, nextAlert.title, `${nextAlert.message} ${errorMessage}`);
                }
            }
        },
        clearRuntimeState() {
            activeAlerts = [];
            notificationLedger.clear();
            dependencies.onAlertsChanged([]);
        }
    };
}
