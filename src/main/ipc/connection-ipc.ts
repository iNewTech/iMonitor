import { ipcMain } from 'electron/main';
import type { DaemonServer } from '@ibm/mapepire-js';
import type { QueryResult, ActiveJobRecord } from '../../services/ibmi';
import type { MonitorMode } from '../types';

interface RegisterConnectionIpcDependencies {
    getConnectionState: () => {
        isConnected: boolean;
        currentConnection: unknown | null;
    };
    getMonitoringState: () => {
        active: boolean;
        interval: number;
    };
    getAppFlags: () => {
        demoModeEnabled: boolean;
        demoModeReason?: string;
        operatorName?: string;
        themeId: string;
        themes: unknown[];
    };
    getThemeSettings: () => {
        themeId: string;
        themes: unknown[];
    };
    saveThemeSettings: (themeId: string | undefined) => {
        themeId: string;
        themes: unknown[];
    };
    saveConnection: (connection: {
        name: string;
        host: string;
        port?: number;
        user: string;
        password: string;
    }) => Promise<{ success: boolean; id?: string; error?: string; detail?: string; }>;
    loadConnections: () => unknown[];
    deleteConnection: (id: string) => { success: boolean; error?: string; };
    deployMapepire: (payload: {
        host: string;
        user: string;
        password: string;
        sshPort: number;
        preferredPort: number;
        mode: 'rpm' | 'manual';
    }) => Promise<Record<string, unknown>>;
    connectToSystem: (config: DaemonServer & { name?: string; mode?: MonitorMode }) => Promise<Record<string, unknown>>;
    getSystemStatus: () => Promise<QueryResult<ActiveJobRecord>>;
    disconnect: () => Promise<{ success: boolean; error?: string; }>;
}

/**
 * Registers connection, session, and theme IPC handlers for the main process.
 */
export function registerConnectionIpc(dependencies: RegisterConnectionIpcDependencies) {
    ipcMain.handle('save-connection', (_event, connection) => dependencies.saveConnection(connection));
    ipcMain.handle('load-connections', () => dependencies.loadConnections());
    ipcMain.handle('delete-connection', (_event, id) => dependencies.deleteConnection(id));
    ipcMain.handle('deploy-mapepire', (_event, payload) => dependencies.deployMapepire(payload));
    ipcMain.handle('connect-to-system', (_event, config) => dependencies.connectToSystem(config));
    ipcMain.handle('get-app-flags', () => dependencies.getAppFlags());
    ipcMain.handle('get-system-status', () => dependencies.getSystemStatus());
    ipcMain.handle('disconnect', () => dependencies.disconnect());
    ipcMain.handle('get-connection-state', () => dependencies.getConnectionState());
    ipcMain.handle('get-monitoring-state', () => dependencies.getMonitoringState());
    ipcMain.handle('get-theme-settings', () => dependencies.getThemeSettings());
    ipcMain.handle('save-theme-settings', (_event, candidateThemeId: string | undefined) => {
        return dependencies.saveThemeSettings(candidateThemeId);
    });
}
