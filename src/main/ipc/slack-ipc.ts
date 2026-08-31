import { ipcMain } from 'electron/main';
import type { SlackSettings } from '../../features/integrations/slack/slack-model';

interface RegisterSlackIpcDependencies {
    getSlackSettings: () => SlackSettings;
    saveSlackSettings: (settings: Partial<SlackSettings> | undefined) => SlackSettings;
    sendTestSlackMessage: () => Promise<{ success: boolean; error?: string; }>;
}

/**
 * Registers Slack settings and delivery test handlers.
 */
export function registerSlackIpc(dependencies: RegisterSlackIpcDependencies) {
    ipcMain.handle('get-slack-settings', () => dependencies.getSlackSettings());
    ipcMain.handle('save-slack-settings', (_event, settings) => dependencies.saveSlackSettings(settings));
    ipcMain.handle('send-test-slack-message', async () => dependencies.sendTestSlackMessage());
}
