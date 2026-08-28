import { ipcMain } from 'electron/main';

interface RegisterLogsIpcDependencies {
    getActivityLog: () => unknown[];
    getMonitoringHistory: () => unknown[];
    downloadActivityLog: () => Promise<{ success: boolean; canceled?: boolean; filePath?: string; }>;
    shareActivityLog: () => Promise<{ success: boolean; filePath?: string; method?: string; }>;
    openLogsFolder: () => Promise<{ success: boolean; directoryPath?: string; }>;
}

/**
 * Registers log and export-related IPC handlers for the main process.
 */
export function registerLogsIpc(dependencies: RegisterLogsIpcDependencies) {
    ipcMain.handle('get-activity-log', () => dependencies.getActivityLog());
    ipcMain.handle('get-monitoring-history', () => dependencies.getMonitoringHistory());
    ipcMain.handle('download-activity-log', () => dependencies.downloadActivityLog());
    ipcMain.handle('share-activity-log', () => dependencies.shareActivityLog());
    ipcMain.handle('open-logs-folder', () => dependencies.openLogsFolder());
}
