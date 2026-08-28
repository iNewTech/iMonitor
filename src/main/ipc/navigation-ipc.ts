import { ipcMain } from 'electron/main';
import type { StoredConnection } from '../../utils/connections';

interface RegisterNavigationIpcDependencies {
    canOpenMonitor: () => boolean;
    loadMonitorPage: () => void;
    loadConnectionPage: () => void;
    recordActivity: (entry: {
        area: 'navigation';
        level: 'info';
        message: string;
        detail?: string;
    }) => void;
}

/**
 * Registers navigation-focused IPC handlers for the main process.
 */
export function registerNavigationIpc(dependencies: RegisterNavigationIpcDependencies) {
    ipcMain.handle('navigate-to-monitor', async () => {
        if (!dependencies.canOpenMonitor()) {
            throw new Error('Not connected to IBM i');
        }

        dependencies.loadMonitorPage();
        dependencies.recordActivity({
            area: 'navigation',
            level: 'info',
            message: 'Opened the iMonitor dashboard.'
        });
        return { success: true };
    });

    ipcMain.handle('navigate-to-connection', async () => {
        dependencies.loadConnectionPage();
        dependencies.recordActivity({
            area: 'navigation',
            level: 'info',
            message: 'Returned to the connection workspace.'
        });
        return { success: true };
    });
}
