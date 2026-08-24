import { ipcMain } from 'electron/main';
import type { AlertSettings, StoredAlertWorkflowState } from '../../features/alerts/alert-model';
import type { EmailNotificationSettings } from '../../features/notifications/email-notification';

interface RegisterAlertsIpcDependencies {
    getActiveAlerts: () => unknown[];
    getAlertSettings: () => AlertSettings;
    setAlertSettings: (settings: AlertSettings) => void;
    emitAlertSettings: () => void;
    getEmailNotificationSettings: () => EmailNotificationSettings;
    saveEmailNotificationSettings: (
        settings: Partial<EmailNotificationSettings> | undefined
    ) => EmailNotificationSettings;
    sendTestEmailNotification: () => Promise<{ success: boolean; error?: string; }>;
    clearAlertById: (alertId: string) => void;
    mutateAlertWorkflow: (
        alertId: string,
        mutation: (state: StoredAlertWorkflowState) => StoredAlertWorkflowState
    ) => StoredAlertWorkflowState;
    acknowledgeAlertWorkflow: (state: StoredAlertWorkflowState, payload: { timestamp: string; owner: string; }) => StoredAlertWorkflowState;
    startAlertWorkflow: (state: StoredAlertWorkflowState, payload: { timestamp: string; owner: string; }) => StoredAlertWorkflowState;
    resolveOperatorAlertWorkflow: (
        state: StoredAlertWorkflowState,
        payload: { timestamp: string; owner: string; note?: string; }
    ) => StoredAlertWorkflowState;
    clearAlertWorkflow: (state: StoredAlertWorkflowState, payload: { timestamp: string; owner: string; }) => StoredAlertWorkflowState;
    addAlertWorkflowNote: (
        state: StoredAlertWorkflowState,
        payload: { timestamp: string; owner: string; note?: string; }
    ) => StoredAlertWorkflowState;
    normalizeAlertSettings: (candidate?: Partial<AlertSettings>) => AlertSettings;
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

    ipcMain.handle('clear-alert', (_event, alertId: string) => {
        const timestamp = new Date().toISOString();
        const nextState = dependencies.mutateAlertWorkflow(alertId, (state) => dependencies.clearAlertWorkflow(state, {
            timestamp,
            owner: 'Local operator'
        }));
        dependencies.clearAlertById(alertId);
        dependencies.recordActivity({
            area: 'monitoring',
            level: 'info',
            message: 'Alert cleared by the operator.',
            detail: `${alertId} | ${nextState.lastActionSummary ?? 'Cleared'}`
        });
        return { success: true };
    });

    ipcMain.handle('update-alert-workflow', (_event, payload: {
        alertId: string;
        action: 'acknowledge' | 'start' | 'resolve' | 'clear' | 'note';
        note?: string;
        owner?: string;
    }) => {
        const owner = payload.owner?.trim() || 'Local operator';
        const timestamp = new Date().toISOString();

        const nextState = dependencies.mutateAlertWorkflow(payload.alertId, (state) => {
            switch (payload.action) {
                case 'acknowledge':
                    return dependencies.acknowledgeAlertWorkflow(state, { timestamp, owner });
                case 'start':
                    return dependencies.startAlertWorkflow(state, { timestamp, owner });
                case 'resolve':
                    return dependencies.resolveOperatorAlertWorkflow(state, { timestamp, owner, note: payload.note });
                case 'clear':
                    return dependencies.clearAlertWorkflow(state, { timestamp, owner });
                case 'note':
                    return dependencies.addAlertWorkflowNote(state, { timestamp, owner, note: payload.note });
                default:
                    return state;
            }
        });

        if (payload.action === 'clear') {
            dependencies.clearAlertById(payload.alertId);
        }

        dependencies.recordActivity({
            area: 'monitoring',
            level: 'info',
            message: `Alert workflow updated: ${payload.action}.`,
            detail: `${payload.alertId} | ${nextState.lastActionSummary ?? payload.action}${payload.note ? ` | ${payload.note}` : ''}`
        });

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

    ipcMain.handle('send-test-email-notification', async () => dependencies.sendTestEmailNotification());
}
