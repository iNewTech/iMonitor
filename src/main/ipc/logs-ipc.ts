import { ipcMain } from 'electron/main';

interface RegisterLogsIpcDependencies {
    getMonitoringHistory: () => unknown[];
}

/**
 * Registers the operator-safe monitoring history IPC handler.
 *
 * Detailed developer logs intentionally have no renderer bridge.
 */
export function registerLogsIpc(dependencies: RegisterLogsIpcDependencies) {
    ipcMain.handle('get-monitoring-history', () => dependencies.getMonitoringHistory());
}
