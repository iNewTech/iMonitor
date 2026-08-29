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
import { sortAlerts } from '../../features/alerts/alert-model';
import type { ActiveJobRecord } from '../../services/ibmi';

interface AlertStateDependencies {
    initialWorkflowStateByAlertId: Record<string, StoredAlertWorkflowState>;
    persistWorkflowState: (workflowStateByAlertId: Record<string, StoredAlertWorkflowState>) => void;
    onAlertsChanged: (alerts: MonitorAlert[]) => void;
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
        setActiveAlerts,
        persistWorkflowState,
        resolveAlert(alertId: string, timestamp: string, detail?: string) {
            setActiveAlerts(resolveAlertById(alertId, activeAlerts, dismissedAlertIds, timestamp, detail));
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

            if (isNew && settings.watchFailedPolls) {
                notify(nextAlert.id, nextAlert.title, `${nextAlert.message} ${errorMessage}`);
            }
        },
        clearRuntimeState() {
            activeAlerts = [];
            notificationLedger.clear();
            dependencies.onAlertsChanged([]);
        }
    };
}
