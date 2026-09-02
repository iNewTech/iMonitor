import { ipcMain } from 'electron/main';
import type { AlertSettings, StoredAlertWorkflowState } from '../../features/alerts/alert-model';
import type { EmailNotificationSettings } from '../../features/notifications/email-notification';

interface RegisterAlertsIpcDependencies {
    getActiveAlerts: () => unknown[];
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
    syncLinkedExternalWorkItem?: (payload: {
        alertId: string;
        action: 'acknowledge' | 'claim' | 'release' | 'workDone' | 'note';
        note?: string;
        nextState: StoredAlertWorkflowState;
    }) => Promise<void> | void;
    createClickUpTaskForClaimedAlert?: (alertId: string) => Promise<void>;
    recordActivity: (entry: {
        area: 'monitoring';
        level: 'info';
        message: string;
        detail?: string;
    }) => void;
    onSettingsSaved: () => void;
}

/**
 * Registers alert and alert-settings IPC handlers for the main process.
 */
export function registerAlertsIpc(dependencies: RegisterAlertsIpcDependencies) {
    ipcMain.handle('get-active-alerts', () => dependencies.getActiveAlerts());

    ipcMain.handle('recheck-alert', async (_event, alertId: string) => {
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
    }) => {
        const owner = dependencies.getOperatorName();
        const timestamp = new Date().toISOString();

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
            detail: `${payload.alertId} | ${nextState.lastActionSummary ?? payload.action}${payload.note ? ` | ${payload.note}` : ''}`
        });

        await dependencies.syncLinkedExternalWorkItem?.({
            alertId: payload.alertId,
            action: payload.action,
            note: payload.note,
            nextState
        });

        if (payload.action === 'claim') {
            await dependencies.createClickUpTaskForClaimedAlert?.(payload.alertId);
        }

        return { success: true };
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
