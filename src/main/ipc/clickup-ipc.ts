import { ipcMain } from 'electron/main';
import type { MonitorAlert, StoredAlertWorkflowState } from '../../features/alerts/alert-model';
import type {
    ClickUpSettings,
    ClickUpTargetOptions,
    ClickUpTaskReference
} from '../../features/integrations/clickup/clickup-model';

interface RegisterClickUpIpcDependencies {
    requirePremium: () => void;
    getClickUpSettings: () => ClickUpSettings;
    saveClickUpSettings: (settings: Partial<ClickUpSettings> | undefined) => ClickUpSettings;
    loadClickUpTargetOptions: () => Promise<ClickUpTargetOptions>;
    resolveConfiguredAssignee: () => Promise<{ memberId: string; userEmail: string } | undefined>;
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
    ipcMain.handle('save-clickup-settings', (_event, settings) => { dependencies.requirePremium(); return dependencies.saveClickUpSettings(settings); });
    ipcMain.handle('load-clickup-target-options', () => { dependencies.requirePremium(); return dependencies.loadClickUpTargetOptions(); });
    ipcMain.handle('resolve-clickup-assignee', async () => {
        dependencies.requirePremium();
        try {
            const assignee = await dependencies.resolveConfiguredAssignee();
            return {
                success: true,
                ...assignee
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    });

    ipcMain.handle('create-clickup-task-for-alert', async (_event, alertId: string) => {
        dependencies.requirePremium();
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
