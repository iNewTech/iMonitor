import { contextBridge, ipcRenderer } from 'electron';

interface IBMiConfig {
    name: string;
    host: string;
    username: string;
    password: string;
    port: number;
}

interface SavedConnection {
    id: string;
    name: string;
    host: string;
    username: string;
    port?: number;
}

interface ConnectionState {
    isConnected: boolean;
    currentConnection: SavedConnection | null;
}

contextBridge.exposeInMainWorld('electronAPI', {
    // Navigation
    navigateToMonitor: () => ipcRenderer.invoke('navigate-to-monitor'),
    navigateToConnection: () => ipcRenderer.invoke('navigate-to-connection'),
    
    // Connection management
    getConnectionState: () => ipcRenderer.invoke('get-connection-state'),
    connectToSystem: (config: IBMiConfig) => ipcRenderer.invoke('connect-to-system', config),
    disconnect: () => ipcRenderer.invoke('disconnect'),
    saveConnection: (connection: IBMiConfig) => ipcRenderer.invoke('save-connection', connection),
    loadConnections: () => ipcRenderer.invoke('load-connections'),
    deleteConnection: (id: string) => ipcRenderer.invoke('delete-connection', id),
    
    // System monitoring functions
    getSystemStatus: () => ipcRenderer.invoke('get-system-status'),
    startMonitoring: (interval: number) => ipcRenderer.send('start-monitoring', interval),
    stopMonitoring: () => ipcRenderer.send('stop-monitoring'),
    
    // Event listeners
    onStatusUpdate: (callback: (data: any) => void) => {
        ipcRenderer.on('status-update', (_event, data) => callback(data));
    },
    onMonitoringError: (callback: (error: string) => void) => {
        ipcRenderer.on('monitoring-error', (_event, error) => callback(error));
    },
    onConnectionTestStatus: (callback: (status: { status: 'testing' | 'success' | 'failed', message: string }) => void) => {
        ipcRenderer.on('connection-test-status', (_event, status) => callback(status));
    },
    onConnectionsUpdated: (callback: (connections: SavedConnection[]) => void) => {
        ipcRenderer.on('connections-updated', (_event, connections) => callback(connections));
    }
});
