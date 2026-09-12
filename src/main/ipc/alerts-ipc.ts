import { ipcMain } from 'electron/main';
import type { AlertSettings, MonitorAlert, StoredAlertWorkflowState } from '../../features/alerts/alert-model';
import {
    acceptIncidentHandoff,
    createIncidentHandoff,
    type IncidentHandoff
} from '../../features/alerts/incident-handoff';
import { recordHandoffAccepted, recordHandoffRequested } from '../../features/alerts/alert-operator-workflow';
import type { EmailNotificationSettings } from '../../features/notifications/email-notification';
import { createActionLeaseStore } from '../../features/action-board/action-leases';
import type { AuthorizationResult, ProtectedAction } from '../../features/action-board/operator-access';

interface RegisterAlertsIpcDependencies {
    getActiveAlerts: () => unknown[];
    getAlertById?: (alertId: string) => MonitorAlert | undefined;
    recheckAlert: (alertId: string) => Promise<{
        status: 'active' | 'cleared' | 'unavailable';
        alert?: unknown;
    }>;
    getSystemMessages: () => Promise<unknown[]>;
    getAlertSettings: () => AlertSettings;
    setAlertSettings: (settings: AlertSettings) => void;
    emitAlertSettings: () => void;
    getEmailNotificationSettings: () => EmailNotificationSettings;
    saveEmailNotificationSettings: (
        settings: Partial<EmailNotificationSettings> | undefined
    ) => EmailNotificationSettings;
    sendTestEmailNotification: () => Promise<{ success: boolean; error?: string; }>;
    mutateAlertWorkflow: (
        alertId: string,
        mutation: (state: StoredAlertWorkflowState) => StoredAlertWorkflowState
    ) => StoredAlertWorkflowState;
    acknowledgeAlertWorkflow: (state: StoredAlertWorkflowState, payload: { timestamp: string; owner: string; }) => StoredAlertWorkflowState;
    claimAlertWorkflow: (state: StoredAlertWorkflowState, payload: { timestamp: string; owner: string; }) => StoredAlertWorkflowState;
    releaseAlertWorkflow: (state: StoredAlertWorkflowState, payload: { timestamp: string; owner: string; }) => StoredAlertWorkflowState;
    markAlertWorkDone: (
        state: StoredAlertWorkflowState,
        payload: { timestamp: string; owner: string; note?: string; }
    ) => StoredAlertWorkflowState;
    addAlertWorkflowNote: (
        state: StoredAlertWorkflowState,
        payload: { timestamp: string; owner: string; note?: string; }
    ) => StoredAlertWorkflowState;
    normalizeAlertSettings: (candidate?: Partial<AlertSettings>) => AlertSettings;
    getOperatorName: () => string;
    authorizeAction: (action: ProtectedAction, systemId: string | undefined) => AuthorizationResult;
    getCurrentSystemId: () => string | undefined;
    syncLinkedExternalWorkItem?: (payload: {
        alertId: string;
        action: 'acknowledge' | 'claim' | 'release' | 'workDone' | 'note' | 'handoff' | 'recovered';
        eventKey?: string;
        note?: string;
        nextState: StoredAlertWorkflowState;
    }) => Promise<void> | void;
    ensureClickUpTaskForAlert?: (alertId: string) => Promise<void>;
    ensureJiraIssueForAlert?: (alertId: string) => Promise<void>;
    assignClickUpTaskToOperator?: (
        taskId: string,
        operatorName: string,
        previousOperatorName?: string
    ) => Promise<void> | void;
    notifyIncidentHandoff?: (params: {
        alert: MonitorAlert;
        handoff: IncidentHandoff;
        event: 'requested' | 'accepted';
    }) => Promise<void> | void;
    recordActivity: (entry: {
        area: 'monitoring';
        level: 'info';
        message: string;
        detail?: string;
    }) => void;
    onSettingsSaved: () => void;
}

function workflowStateFromAlert(alert: MonitorAlert): StoredAlertWorkflowState {
    return {
        status: alert.workflowStatus,
        owner: alert.owner,
        notes: alert.notes,
        timeline: alert.timeline,
        updatedAt: alert.workflowUpdatedAt,
        lastActionSummary: alert.lastActionSummary,
        clickUpTask: alert.clickUpTask,
        jiraIssue: alert.jiraIssue,
        handoff: alert.handoff
    };
}

/**
 * Registers alert and alert-settings IPC handlers for the main process.
 */
export function registerAlertsIpc(dependencies: RegisterAlertsIpcDependencies) {
    const actionLeases = createActionLeaseStore();
    const authorizeRead = () => dependencies.authorizeAction('read', dependencies.getCurrentSystemId());
    ipcMain.handle('get-active-alerts', () => authorizeRead().allowed ? dependencies.getActiveAlerts() : []);

    ipcMain.handle('recheck-alert', async (_event, alertId: string) => {
        const authorization = authorizeRead();
        if (!authorization.allowed) {
            return { success: false, status: 'unavailable' as const, error: authorization.reason || 'The operator cannot inspect alerts.' };
        }
        try {
            const result = await dependencies.recheckAlert(alertId);
            return {
                success: true,
                status: result.status,
                alert: result.alert
            };
        } catch (error) {
            return {
                success: false,
                status: 'unavailable',
                error: error instanceof Error ? error.message : 'Unable to recheck this alert.'
            };
        }
    });

    ipcMain.handle('get-system-messages', async () => {
        const authorization = authorizeRead();
        if (!authorization.allowed) {
            return { success: false, records: [], error: authorization.reason || 'The operator cannot inspect system messages.' };
        }
        try {
            return { success: true, records: await dependencies.getSystemMessages() };
        } catch (error) {
            return {
                success: false,
                records: [],
                error: error instanceof Error ? error.message : 'Unable to load QSYSOPR messages.'
            };
        }
    });

    ipcMain.handle('update-alert-workflow', async (_event, payload: {
        alertId: string;
        action: 'acknowledge' | 'claim' | 'release' | 'workDone' | 'note';
        note?: string;
        owner?: string;
        executionId?: string;
        systemId?: string;
        expectedUpdatedAt?: string;
    }) => {
        const systemId = dependencies.getCurrentSystemId();
        if (payload.systemId && payload.systemId !== systemId) {
            return { success: false, error: 'This incident targets a different IBM i system.' };
        }
        const authorization = dependencies.authorizeAction('incident-workflow', systemId);
        if (!authorization.allowed) {
            return { success: false, error: authorization.reason || 'The operator is not allowed to update incidents.' };
        }

        const currentAlert = dependencies.getActiveAlerts().find((candidate) => (
            Boolean(candidate)
            && typeof candidate === 'object'
            && (candidate as { id?: unknown }).id === payload.alertId
        )) as {
            workflowUpdatedAt?: string;
            owner?: string;
        } | undefined;
        if (!currentAlert) {
            return { success: false, error: 'The selected incident is no longer available.' };
        }
        if (payload.expectedUpdatedAt && payload.expectedUpdatedAt !== currentAlert.workflowUpdatedAt) {
            return { success: false, error: 'This incident changed while you were working. Refresh before trying again.' };
        }

        const owner = dependencies.getOperatorName();
        const currentOwner = currentAlert.owner?.trim();
        if (payload.action === 'claim' && currentOwner && currentOwner !== owner) {
            return { success: false, error: `This incident is already claimed by ${currentOwner}.` };
        }
        if (['release', 'workDone', 'note'].includes(payload.action) && currentOwner && currentOwner !== owner) {
            return { success: false, error: `Only ${currentOwner} can update this claimed incident.` };
        }

        const actionKey = `incident:${systemId}:${payload.alertId}`;
        const executionId = payload.executionId?.trim() || `${actionKey}:${Date.now()}`;
        const leaseResult = actionLeases.acquire(actionKey, executionId, owner);
        if (!leaseResult.granted) {
            return {
                success: false,
                error: leaseResult.reason === 'replay'
                    ? 'This incident update was already submitted.'
                    : 'This incident update is already in progress.'
            };
        }
        const timestamp = new Date().toISOString();

        try {
            const nextState = dependencies.mutateAlertWorkflow(payload.alertId, (state) => {
                switch (payload.action) {
                    case 'acknowledge':
                        return dependencies.acknowledgeAlertWorkflow(state, { timestamp, owner });
                    case 'claim':
                        return dependencies.claimAlertWorkflow(state, { timestamp, owner });
                    case 'release':
                        return dependencies.releaseAlertWorkflow(state, { timestamp, owner });
                    case 'workDone':
                        return dependencies.markAlertWorkDone(state, { timestamp, owner, note: payload.note });
                    case 'note':
                        return dependencies.addAlertWorkflowNote(state, { timestamp, owner, note: payload.note });
                    default:
                        return state;
                }
            });

            dependencies.recordActivity({
                area: 'monitoring',
                level: 'info',
                message: `Alert workflow updated: ${payload.action}.`,
                detail: `${payload.alertId} | operator=${owner} | execution=${leaseResult.lease.executionId} | ${nextState.lastActionSummary ?? payload.action}${payload.note ? ` | ${payload.note}` : ''}`
            });

            await dependencies.syncLinkedExternalWorkItem?.({
                alertId: payload.alertId,
                action: payload.action,
                eventKey: `${payload.action}:${nextState.updatedAt}`,
                note: payload.note,
                nextState
            });

            if (payload.action === 'claim') {
                await dependencies.ensureClickUpTaskForAlert?.(payload.alertId);
            }

            return { success: true };
        } finally {
            actionLeases.complete(leaseResult.lease);
        }
    });

    ipcMain.handle('create-incident-handoff', async (_event, payload: {
        alertId: string;
        toOperator: string;
        reason?: string;
        pendingChecks?: string[];
        responseTargetAt?: string;
        executionId?: string;
        systemId?: string;
        expectedUpdatedAt?: string;
    }) => {
        const systemId = dependencies.getCurrentSystemId();
        if (payload.systemId && payload.systemId !== systemId) {
            return { success: false, error: 'This incident targets a different IBM i system.' };
        }
        const authorization = dependencies.authorizeAction('incident-handoff', systemId);
        if (!authorization.allowed) {
            return { success: false, error: authorization.reason || 'The operator is not allowed to hand off incidents.' };
        }

        const currentAlert = dependencies.getActiveAlerts().find((candidate) => (
            Boolean(candidate)
            && typeof candidate === 'object'
            && (candidate as { id?: unknown }).id === payload.alertId
        )) as MonitorAlert | undefined;
        if (!currentAlert) return { success: false, error: 'The selected incident is no longer available.' };
        if (payload.expectedUpdatedAt && payload.expectedUpdatedAt !== currentAlert.workflowUpdatedAt) {
            return { success: false, error: 'This incident changed while you were working. Refresh before handing it off.' };
        }

        const owner = dependencies.getOperatorName();
        if (currentAlert.owner && currentAlert.owner !== owner) {
            return { success: false, error: `Only ${currentAlert.owner} can hand off this incident.` };
        }
        if (currentAlert.handoff?.status === 'pending') {
            return { success: false, error: `A handoff to ${currentAlert.handoff.toOperator} is already pending.` };
        }

        const actionKey = `handoff:${systemId}:${payload.alertId}`;
        const executionId = payload.executionId?.trim() || `${actionKey}:${Date.now()}`;
        const leaseResult = actionLeases.acquire(actionKey, executionId, owner);
        if (!leaseResult.granted) {
            return {
                success: false,
                error: leaseResult.reason === 'replay'
                    ? 'This handoff was already submitted.'
                    : 'A handoff for this incident is already in progress.'
            };
        }
        const timestamp = new Date().toISOString();

        try {
            const handoffResult = createIncidentHandoff({
                incidentId: currentAlert.incidentId || currentAlert.id,
                fromOperator: owner,
                toOperator: payload.toOperator,
                reason: payload.reason,
                pendingChecks: payload.pendingChecks,
                responseTargetAt: payload.responseTargetAt,
                createdAt: timestamp
            });
            if (!handoffResult.success) return handoffResult;

            const nextState = dependencies.mutateAlertWorkflow(payload.alertId, (state) => (
                recordHandoffRequested(state, handoffResult.handoff, timestamp)
            ));
            dependencies.recordActivity({
                area: 'monitoring',
                level: 'info',
                message: 'Incident handoff requested.',
                detail: `${payload.alertId} | from=${owner} | to=${handoffResult.handoff.toOperator}`
            });
            await dependencies.syncLinkedExternalWorkItem?.({
                alertId: payload.alertId,
                action: 'handoff',
                eventKey: `handoff:${nextState.updatedAt}`,
                nextState
            });
            await dependencies.notifyIncidentHandoff?.({
                alert: currentAlert,
                handoff: handoffResult.handoff,
                event: 'requested'
            });
            return { success: true, handoff: handoffResult.handoff, updatedAt: nextState.updatedAt };
        } finally {
            actionLeases.complete(leaseResult.lease);
        }
    });

    ipcMain.handle('accept-incident-handoff', async (_event, payload: {
        alertId: string;
        executionId?: string;
        systemId?: string;
        expectedUpdatedAt?: string;
    }) => {
        const systemId = dependencies.getCurrentSystemId();
        if (payload.systemId && payload.systemId !== systemId) {
            return { success: false, error: 'This incident targets a different IBM i system.' };
        }
        const authorization = dependencies.authorizeAction('incident-handoff', systemId);
        if (!authorization.allowed) {
            return { success: false, error: authorization.reason || 'The operator is not allowed to accept incidents.' };
        }

        const currentAlert = dependencies.getActiveAlerts().find((candidate) => (
            Boolean(candidate)
            && typeof candidate === 'object'
            && (candidate as { id?: unknown }).id === payload.alertId
        )) as MonitorAlert | undefined;
        if (!currentAlert) return { success: false, error: 'The selected incident is no longer available.' };
        if (payload.expectedUpdatedAt && payload.expectedUpdatedAt !== currentAlert.workflowUpdatedAt) {
            return { success: false, error: 'This incident changed while you were working. Refresh before accepting it.' };
        }

        const owner = dependencies.getOperatorName();
        const actionKey = `handoff:${systemId}:${payload.alertId}`;
        const executionId = payload.executionId?.trim() || `${actionKey}:accept:${Date.now()}`;
        const leaseResult = actionLeases.acquire(actionKey, executionId, owner);
        if (!leaseResult.granted) {
            return {
                success: false,
                error: leaseResult.reason === 'replay'
                    ? 'This handoff acceptance was already submitted.'
                    : 'This handoff is already being updated.'
            };
        }
        const timestamp = new Date().toISOString();

        try {
            const acceptance = acceptIncidentHandoff(currentAlert.handoff, owner, timestamp);
            if (!acceptance.success) return acceptance;
            const nextState = dependencies.mutateAlertWorkflow(payload.alertId, (state) => (
                recordHandoffAccepted(state, acceptance.handoff, timestamp)
            ));
            await dependencies.ensureClickUpTaskForAlert?.(payload.alertId);
            await dependencies.ensureJiraIssueForAlert?.(payload.alertId);
            const linkedAlert = dependencies.getAlertById?.(payload.alertId);
            const linkedState = linkedAlert ? workflowStateFromAlert(linkedAlert) : nextState;
            dependencies.recordActivity({
                area: 'monitoring',
                level: 'info',
                message: 'Incident handoff accepted.',
                detail: `${payload.alertId} | operator=${owner}`
            });
            await dependencies.syncLinkedExternalWorkItem?.({
                alertId: payload.alertId,
                action: 'handoff',
                eventKey: `handoff-accepted:${nextState.updatedAt}`,
                nextState: linkedState
            });
            await dependencies.assignClickUpTaskToOperator?.(
                linkedState.clickUpTask?.id || '',
                acceptance.handoff.toOperator,
                acceptance.handoff.fromOperator
            );
            await dependencies.notifyIncidentHandoff?.({
                alert: linkedAlert || currentAlert,
                handoff: acceptance.handoff,
                event: 'accepted'
            });
            return { success: true, handoff: acceptance.handoff, updatedAt: nextState.updatedAt };
        } finally {
            actionLeases.complete(leaseResult.lease);
        }
    });

    ipcMain.handle('get-alert-settings', () => dependencies.getAlertSettings());
    ipcMain.handle('get-email-notification-settings', () => dependencies.getEmailNotificationSettings());

    ipcMain.handle('save-alert-settings', (_event, candidate: Partial<AlertSettings> | undefined) => {
        const normalized = dependencies.normalizeAlertSettings(candidate);
        dependencies.setAlertSettings(normalized);
        dependencies.emitAlertSettings();

        dependencies.recordActivity({
            area: 'monitoring',
            level: 'info',
            message: 'Alert rules updated.',
            detail: `High CPU threshold set to ${normalized.highCpuThreshold}%.`
        });

        dependencies.onSettingsSaved();
        return normalized;
    });

    ipcMain.handle(
        'save-email-notification-settings',
        (_event, candidate: Partial<EmailNotificationSettings> | undefined) => {
            const normalized = dependencies.saveEmailNotificationSettings(candidate);
            dependencies.recordActivity({
                area: 'monitoring',
                level: 'info',
                message: 'Email notification settings updated.',
                detail: normalized.enabled
                    ? `SMTP host ${normalized.smtpHost || 'not set'} with ${normalized.toAddresses || 'no recipients'}.`
                    : 'Email notifications disabled.'
            });
            return normalized;
        }
    );

    ipcMain.handle('send-test-email-notification', async () => {
        return dependencies.sendTestEmailNotification();
    });
}
