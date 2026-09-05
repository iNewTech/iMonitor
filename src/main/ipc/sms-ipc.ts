import { ipcMain } from 'electron/main';
import type { SmsNotificationSettings } from '../../features/notifications/sms-notification';

interface RegisterSmsIpcDependencies {
    requirePremium: () => void;
    getSmsSettings: () => SmsNotificationSettings;
    saveSmsSettings: (settings: Partial<SmsNotificationSettings> | undefined) => SmsNotificationSettings;
    sendTestSms: () => Promise<{ success: boolean; error?: string; message?: string; }>;
}

/** Registers the provider-neutral SMS configuration and test handlers. */
export function registerSmsIpc(dependencies: RegisterSmsIpcDependencies) {
    ipcMain.handle('get-sms-settings', () => dependencies.getSmsSettings());
    ipcMain.handle('save-sms-settings', (_event, settings) => {
        dependencies.requirePremium();
        return dependencies.saveSmsSettings(settings);
    });
    ipcMain.handle('send-test-sms', async () => {
        dependencies.requirePremium();
        try {
            return await dependencies.sendTestSms();
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    });
}
