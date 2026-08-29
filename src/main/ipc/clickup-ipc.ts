import { ipcMain } from 'electron/main';
import type { MonitorAlert, StoredAlertWorkflowState } from '../../features/alerts/alert-model';
import type {
    ClickUpSettings,
    ClickUpTargetOptions,
    ClickUpTaskReference
} from '../../features/integrations/clickup/clickup-model';

interface RegisterClickUpIpcDependencies {
    getClickUpSettings: () => ClickUpSettings;
    saveClickUpSettings: (settings: Partial<ClickUpSettings> | undefined) => ClickUpSettings;
    loadClickUpTargetOptions: () => Promise<ClickUpTargetOptions>;
    getAlertById: (alertId: string) => MonitorAlert | undefined;
    mutateAlertWorkflow: (
        alertId: string,
        mutation: (state: StoredAlertWorkflowState) => StoredAlertWorkflowState
    ) => StoredAlertWorkflowState;
    attachClickUpTaskToWorkflow: (
        state: StoredAlertWorkflowState,
        task: ClickUpTaskReference,
        timestamp: string
    ) => StoredAlertWorkflowState;
    createTaskForAlert: (alert: MonitorAlert) => Promise<ClickUpTaskReference>;
}

/**
 * Registers ClickUp settings and alert ticket handlers.
 */
export function registerClickUpIpc(dependencies: RegisterClickUpIpcDependencies) {
    ipcMain.handle('get-clickup-settings', () => dependencies.getClickUpSettings());
    ipcMain.handle('save-clickup-settings', (_event, settings) => dependencies.saveClickUpSettings(settings));
    ipcMain.handle('load-clickup-target-options', () => dependencies.loadClickUpTargetOptions());

    ipcMain.handle('create-clickup-task-for-alert', async (_event, alertId: string) => {
        const alert = dependencies.getAlertById(alertId);
        if (!alert) {
            throw new Error('Alert not found.');
        }

        if (alert.clickUpTask?.id) {
            return {
                success: true,
                task: alert.clickUpTask,
                reused: true
            };
        }

        const task = await dependencies.createTaskForAlert(alert);
        const timestamp = new Date().toISOString();
        dependencies.mutateAlertWorkflow(alertId, (state) => (
            dependencies.attachClickUpTaskToWorkflow(state, task, timestamp)
        ));

        return {
            success: true,
            task,
            reused: false
        };
    });
}
