import { ipcMain } from 'electron/main';
import type { JiraSettings } from '../../features/integrations/jira/jira-model';

interface RegisterJiraIpcDependencies {
    requirePremium: () => void;
    getJiraSettings: () => JiraSettings;
    saveJiraSettings: (settings: Partial<JiraSettings> | undefined) => JiraSettings;
    sendTestJiraMessage: () => Promise<{ id: string; key: string; url: string }>;
}

/** Registers Jira settings and alert delivery test handlers. */
export function registerJiraIpc(dependencies: RegisterJiraIpcDependencies) {
    ipcMain.handle('get-jira-settings', () => dependencies.getJiraSettings());
    ipcMain.handle('save-jira-settings', (_event, settings) => {
        dependencies.requirePremium();
        return dependencies.saveJiraSettings(settings);
    });
    ipcMain.handle('send-test-jira-message', async () => {
        dependencies.requirePremium();
        try {
            const issue = await dependencies.sendTestJiraMessage();
            return { success: true, issue };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    });
}
