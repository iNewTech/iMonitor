import { ipcMain } from 'electron/main';

interface RegisterSupportIpcDependencies {
    getAppInfo: () => {
        appName: string;
        appVersion: string;
        supportEmail: string;
    };
    contactSupport: () => Promise<{ success: boolean; mailtoUrl?: string; error?: string; }>;
    sendSupportDiagnostics: () => Promise<{ success: boolean; filePath?: string; mailtoUrl?: string; error?: string; }>;
}

/**
 * Registers support and diagnostics handlers that are available on every app screen.
 */
export function registerSupportIpc(dependencies: RegisterSupportIpcDependencies) {
    ipcMain.handle('get-app-info', () => dependencies.getAppInfo());
    ipcMain.handle('contact-support', () => dependencies.contactSupport());
    ipcMain.handle('send-support-diagnostics', () => dependencies.sendSupportDiagnostics());
}
