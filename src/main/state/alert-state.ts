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
import { getIncidentLifecyclePhase, normalizeAlertWorkflowState } from '../../features/alerts/alert-operator-workflow';
import {
    recordAlertRecheckWorkflow,
    systemClearAlertWorkflow
} from '../../features/alerts/alert-operator-workflow';
import type { AlertRecheckResult } from '../../features/alerts/alert-recheck';
import { sortAlerts } from '../../features/alerts/alert-model';
import type { ActiveJobRecord } from '../../services/ibmi';
import type { IncidentEvidence } from '../../features/alerts/incident-evidence';
import { attachIncidentCorrelations } from '../../features/ibmeyeai/incident-correlation';
import {
    getIncidentsForSystem,
    normalizeIncidentLedger,
    mergeSystemIncidents,
    type IncidentLedger,
    type IncidentScope
} from '../../features/alerts/incident-ledger';

interface AlertStateDependencies {
    initialWorkflowStateByAlertId: Record<string, StoredAlertWorkflowState>;
    initialIncidentLedger?: IncidentLedger;
    persistWorkflowState: (workflowStateByAlertId: Record<string, StoredAlertWorkflowState>) => void;
    persistIncidentLedger?: (ledger: IncidentLedger) => void;
    getIncidentScope?: () => IncidentScope | undefined;
    onAlertsChanged: (alerts: MonitorAlert[]) => void;
    onAlertResolved?: (alert: MonitorAlert) => void | Promise<void>;
    captureIncidentEvidence?: (
        alert: MonitorAlert,
        triggerJob?: ActiveJobRecord
    ) => Promise<IncidentEvidence>;
    onAlertCreated?: (alert: MonitorAlert, triggerJob?: ActiveJobRecord) => void | Promise<void>;
}

/**
 * Stores runtime alerts, dismissals, and per-alert workflow progress.
 */
export function createAlertStateStore(dependencies: AlertStateDependencies) {
    let activeAlerts: MonitorAlert[] = [];
    let workflowStateByAlertId = dependencies.initialWorkflowStateByAlertId;
    let incidentLedger = normalizeIncidentLedger(dependencies.initialIncidentLedger);
    let activeSystemId: string | undefined;
    const dismissedAlertIds = new Set<string>();
    const notificationLedger = new Map<string, number>();
    const evidenceCaptureInFlight = new Set<string>();

    const persistWorkflowState = () => {
        dependencies.persistWorkflowState(workflowStateByAlertId);
    };

    const setActiveAlerts = (nextAlerts: MonitorAlert[]) => {
        activeAlerts = sortAlerts([...nextAlerts]);
        dependencies.onAlertsChanged(activeAlerts.slice());
    };

    const activateIncidentScope = () => {
        const scope = dependencies.getIncidentScope?.();
        if (!scope || scope.systemId === activeSystemId) {
            return scope;
        }

        activeSystemId = scope.systemId;
        setActiveAlerts(getIncidentsForSystem(incidentLedger, scope.systemId));
        return scope;
    };

    const persistCurrentIncidents = () => {
        if (!activeSystemId || !dependencies.persistIncidentLedger) {
            return;
        }
        incidentLedger = mergeSystemIncidents(incidentLedger, activeSystemId, activeAlerts);
        dependencies.persistIncidentLedger(incidentLedger);
    };

    const attachIncidentEvidence = (alertId: string, evidence: IncidentEvidence) => {
        const currentAlert = activeAlerts.find((alert) => alert.id === alertId);
        if (!currentAlert) {
            return;
        }

        setActiveAlerts(activeAlerts.map((alert) => alert.id === alertId
            ? { ...alert, evidence }
            : alert));
        persistCurrentIncidents();
    };

    const emitAlertCreated = (alert: MonitorAlert, triggerJob?: ActiveJobRecord) => {
        if (dependencies.captureIncidentEvidence && !evidenceCaptureInFlight.has(alert.id)) {
            evidenceCaptureInFlight.add(alert.id);
                void dependencies.captureIncidentEvidence(alert, triggerJob)
                    .then((evidence) => attachIncidentEvidence(alert.id, evidence))
                .catch(() => undefined)
                .finally(() => evidenceCaptureInFlight.delete(alert.id));
        }

        try {
            void Promise.resolve(dependencies.onAlertCreated?.(alert, triggerJob)).catch(() => undefined);
        } catch {
            // Local incident creation must not depend on an external delivery adapter.
        }
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
        getIncidentLedger() {
            return incidentLedger;
        },
        setActiveAlerts,
        persistWorkflowState,
        resolveAlert(alertId: string, timestamp: string, detail?: string) {
            const previousAlerts = activeAlerts;
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
                        clickUpTask: resolvedAlert.clickUpTask,
                        jiraIssue: resolvedAlert.jiraIssue,
                        handoff: resolvedAlert.handoff
                    }
                };
                persistWorkflowState();
            }
            setActiveAlerts(nextAlerts);
            persistCurrentIncidents();
            if (
                resolvedAlert
                && resolvedAlert.isActive === false
                && previousAlerts.find((alert) => alert.id === alertId)?.isActive !== false
            ) {
                void Promise.resolve(dependencies.onAlertResolved?.(resolvedAlert)).catch(() => undefined);
            }
        },
        recordAlertRecheck(
            alertId: string,
            result: AlertRecheckResult,
            timestamp: string,
            owner?: string
        ) {
            const previousAlerts = activeAlerts;
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
                clickUpTask: alert.clickUpTask,
                jiraIssue: alert.jiraIssue,
                handoff: alert.handoff
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

            const nextAlerts: MonitorAlert[] = activeAlerts.map((candidate) => candidate.id === alertId
                ? {
                    ...candidate,
                    isActive: cleared ? false : true,
                    resolvedAt: cleared ? timestamp : undefined,
                    resolutionSource: cleared ? 'manual_recheck' : undefined,
                    recoveryPollCount: cleared ? candidate.recoveryPollCount : 0,
                    lastSeenAt: cleared ? candidate.lastSeenAt : timestamp,
                    workflowStatus: nextState.status,
                    lifecyclePhase: getIncidentLifecyclePhase(nextState),
                    owner: nextState.owner,
                    notes: nextState.notes,
                    timeline: nextState.timeline,
                    workflowUpdatedAt: nextState.updatedAt,
                    lastActionSummary: nextState.lastActionSummary,
                    clickUpTask: nextState.clickUpTask,
                    jiraIssue: nextState.jiraIssue,
                    handoff: nextState.handoff
                }
                : candidate);
            setActiveAlerts(nextAlerts);
            persistCurrentIncidents();

            const resolvedAlert = nextAlerts.find((candidate) => (
                candidate.id === alertId
                && candidate.isActive === false
                && previousAlerts.find((previous) => previous.id === alertId)?.isActive !== false
            ));
            if (resolvedAlert) {
                void Promise.resolve(dependencies.onAlertResolved?.(resolvedAlert)).catch(() => undefined);
            }

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
                        lifecyclePhase: getIncidentLifecyclePhase(nextState),
                        owner: nextState.owner,
                        notes: nextState.notes,
                        timeline: nextState.timeline,
                        workflowUpdatedAt: nextState.updatedAt,
                        lastActionSummary: nextState.lastActionSummary,
                        clickUpTask: nextState.clickUpTask,
                        jiraIssue: nextState.jiraIssue,
                        handoff: nextState.handoff
                    }
                    : alert
            )));
            persistCurrentIncidents();

            return nextState;
        },
        evaluateAlertRules(
            jobs: ActiveJobRecord[],
            timestamp: string,
            settings: AlertSettings,
            notify: (key: string, title: string, body: string) => void
        ) {
            const previousAlerts = activeAlerts;
            const incidentScope = activateIncidentScope();
            const previousOccurrences = new Map(
                activeAlerts.map((alert) => [alert.id, alert.occurrence ?? 1])
            );
            const result = evaluateAlertQueue(jobs, {
                activeAlerts,
                dismissedAlertIds,
                workflowStateByAlertId,
                settings,
                timestamp,
                incidentScope,
                notify
            });

            workflowStateByAlertId = result.workflowStateByAlertId;
            persistWorkflowState();
            const correlatedAlerts = attachIncidentCorrelations(
                result.alerts,
                jobs,
                settings.highCpuThreshold,
                result.alerts.length
            );
            setActiveAlerts(correlatedAlerts);
            persistCurrentIncidents();

            correlatedAlerts
                .filter((alert) => (
                    alert.isActive === false
                    && previousAlerts.find((previous) => previous.id === alert.id)?.isActive !== false
                ))
                .forEach((alert) => {
                    void Promise.resolve(dependencies.onAlertResolved?.(alert)).catch(() => undefined);
                });

            correlatedAlerts.forEach((alert) => {
                const isNewOccurrence = !previousOccurrences.has(alert.id)
                    || (alert.occurrence ?? 1) > (previousOccurrences.get(alert.id) ?? 0);
                if (isNewOccurrence || !alert.evidence) {
                    const triggerJob = jobs.find((job) => (
                        String(job.JOB_NAME || job.SUBSYSTEM_JOB || '').trim() === String(alert.jobName || '').trim()
                    ));
                    emitAlertCreated(alert, triggerJob);
                }
            });
        },
        setPollFailureAlert(
            errorMessage: string,
            settings: AlertSettings,
            notify: (key: string, title: string, body: string) => void
        ) {
            const incidentScope = activateIncidentScope();
            const nextFailureAlert = createPollFailureAlert(
                errorMessage,
                activeAlerts,
                dismissedAlertIds,
                workflowStateByAlertId,
                incidentScope
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
            persistCurrentIncidents();

            if (isNew) {
                emitAlertCreated(nextAlert);
                if (settings.watchFailedPolls) {
                    notify(nextAlert.id, nextAlert.title, `${nextAlert.message} ${errorMessage}`);
                }
            }
        },
        clearRuntimeState() {
            activeAlerts = [];
            activeSystemId = undefined;
            notificationLedger.clear();
            dependencies.onAlertsChanged([]);
        }
    };
}
