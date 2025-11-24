import { app, BrowserWindow, ipcMain } from 'electron/main';
import * as path from 'path';
import Store from 'electron-store';
import {DaemonServer} from "@ibm/mapepire-js/dist/src/types"
import dB from './services/ibmi';

interface StoredConnection {
    id: string;
    name: string;
    host: string;
    user: string;
    encryptedPassword: string;
    port?: number;
}

// Define the store schema
interface StoreSchema {
    connections: StoredConnection[];
}

const defaultPort = 3076; // Default SSH port for IBM i

// Create a typed store instance with different names for dev and prod
const storeName = app.isPackaged ? 'connections-prod' : 'connections-dev';

// Clear existing store in production
if (app.isPackaged) {
    const devStore = new Store<StoreSchema>({ 
        name: 'connections-dev',
        defaults: { connections: [] }
    }) as Store<StoreSchema> & {
        get<K extends keyof StoreSchema>(key: K): StoreSchema[K];
        set<K extends keyof StoreSchema>(key: K, value: StoreSchema[K]): void;
    };
    
    const prodStore = new Store<StoreSchema>({ 
        name: 'connections-prod',
        defaults: { connections: [] }
    }) as Store<StoreSchema> & {
        get<K extends keyof StoreSchema>(key: K): StoreSchema[K];
        set<K extends keyof StoreSchema>(key: K, value: StoreSchema[K]): void;
    };
    
    devStore.set('connections', []);
    prodStore.set('connections', []);
}

const store = new Store<StoreSchema>({
    name: storeName,
    defaults: {
        connections: []
    }
}) as Store<StoreSchema> & {
    get<K extends keyof StoreSchema>(key: K): StoreSchema[K];
    set<K extends keyof StoreSchema>(key: K, value: StoreSchema[K]): void;
};

interface ConnectionState {
    isConnected: boolean;
    currentConnection: StoredConnection | null;
}

let mainWindow: BrowserWindow | null = null;
let ibmiService: dB | null = null;
let monitoringInterval: NodeJS.Timeout | null = null;
let connectionState: ConnectionState = {
    isConnected: false,
    currentConnection: null
};

function loadConnectionPage() {
    mainWindow?.loadFile(path.join(__dirname, '../public/index.html'));
}

function loadMonitorPage() {
    mainWindow?.loadFile(path.join(__dirname, '../public/monitor.html'));
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    loadConnectionPage();

    // Handle window closing
    mainWindow.on('closed', () => {
        if (monitoringInterval) {
            clearInterval(monitoringInterval);
        }
        if (ibmiService) {
            // TODO: Implement disconnect in ibmiService
            ibmiService = null;
        }
        mainWindow = null;
    });

  // Open the DevTools in development mode.
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
}

app.on('ready', () => {
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Test connection before saving
async function testConnection(config: DaemonServer): Promise<boolean> {
    try {
        const testService = new dB();
        await testService.connect({
            host: config.host,
            user: config.user,
            password: config.password,
            port: config.port || defaultPort, // Default to SSH port defaultPort if not specified
            rejectUnauthorized: false,
        });
        
        // Try to execute a simple query to verify the connection
        await testService.query('SELECT CURRENT_TIMESTAMP FROM SYSIBM.SYSDUMMY1');
        if (testService) {
            testService?.close(); // Close the test connection pool
        }
        return true;
    } catch (error) {
        console.error('Connection test failed:', error);
        return false;
    }
}

// Connection management IPC handlers
ipcMain.handle('save-connection', async (_event, connection) => {
    try {
        const existingConnections = store.get('connections');

        // Check if connection name already exists
        const nameExists = existingConnections.some(
            (conn: StoredConnection) => conn.name.toLowerCase() === connection.name.toLowerCase()
        );
        if (nameExists) {
            throw new Error(`Connection name "${connection.name}" is already in use. Please choose a different name.`);
        }

        // Check if host and user combination already exists
        const existingConnection = existingConnections.find(
            (conn: StoredConnection) => 
                conn.host.toLowerCase() === connection.host.toLowerCase() && 
                conn.user.toLowerCase() === connection.user.toLowerCase()
        );
        if (existingConnection) {
            throw new Error(`A connection to ${connection.host} with user ${connection.user} already exists as "${existingConnection.name}".`);
        }

        // Notify renderer that connection test is in progress
        mainWindow?.webContents.send('connection-test-status', { 
            status: 'testing', 
            message: 'Testing connection...' 
        });

        // Test connection before saving
        const isConnectionValid = await testConnection({
            host: connection.host,
            user: connection.user,
            password: connection.password,
            port: connection.port
        });

        if (!isConnectionValid) {
            mainWindow?.webContents.send('connection-test-status', { 
                status: 'failed', 
                message: 'Connection test failed. Please check your credentials and try again.' 
            });
            throw new Error('Connection test failed. Please check your credentials and try again.');
        }

        // Notify renderer that connection test succeeded
        mainWindow?.webContents.send('connection-test-status', { 
            status: 'success', 
            message: 'Connection test successful. Saving connection...' 
        });

        const id = Date.now().toString();
        const storedConnection: StoredConnection = {
            id,
            name: `${connection.name}`,
            host: connection.host,
            user: connection.user,
            encryptedPassword: connection.password, // In production, use encryption
            port: connection.port || defaultPort // Default to SSH port defaultPort if not specified
        };

        const currentConnections = store.get('connections');
        const updatedConnections = [...currentConnections, storedConnection];
        store.set('connections', updatedConnections);

        // Notify renderer of updated connections
        const connectionList = updatedConnections.map((conn: StoredConnection) => ({
            id: conn.id,
            name: conn.name,
            host: conn.host,
            user: conn.user,
            port: conn.port
        }));
        mainWindow?.webContents.send('connections-updated', connectionList);

        return { success: true, id };
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        console.error('Error saving connection:', errorMessage);
        return { success: false, error: errorMessage };
    }
});

ipcMain.handle('load-connections', () => {
    const connections = store.get('connections');
    return connections.map((conn: StoredConnection) => ({
        id: conn.id,
        name: conn.name,
        host: conn.host,
        user: conn.user,
        password: conn.encryptedPassword,
        port: conn.port || defaultPort // Default to SSH port defaultPort if not specified
    }));
});

ipcMain.handle('delete-connection', (_event, id) => {
    try {
        const currentConnections = store.get('connections');
        const updatedConnections = currentConnections.filter((conn: StoredConnection) => conn.id !== id);
        store.set('connections', updatedConnections);
        
        // Notify renderer of updated connections
        const connectionList = updatedConnections.map((conn: StoredConnection) => ({
            id: conn.id,
            name: conn.name,
            host: conn.host,
            username: conn.user,
            port: conn.port
        }));
        mainWindow?.webContents.send('connections-updated', connectionList);

        return { success: true };
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        return { success: false, error: errorMessage };
    }
});

// IBM i connection handler
ipcMain.handle('connect-to-system', async (_event, config: DaemonServer) => {
    try {
        ibmiService = new dB();
        config.rejectUnauthorized = false; // Disable certificate validation for testing
        await ibmiService.connect(config);
        return { success: true };
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Connection failed';
        console.error('Connection error:', errorMessage);
        return { success: false, error: errorMessage };
    }
});

// System monitoring handlers
ipcMain.handle('get-system-status', async () => {
    try {
        if (!ibmiService) {
            throw new Error('Not connected to IBM i');
        }
        const result = await ibmiService.query(`
            SELECT 
                SUBSYSTEM || '/' || JOB_NAME_SHORT as SUBSYSTEM_JOB,
                AUTHORIZATION_NAME as CURRENT_USER,
                JOB_TYPE_ENHANCED as TYPE,
                ELAPSED_CPU_PERCENTAGE as CPU,
                FUNCTION as FUNCTION_NAME,
                JOB_STATUS as STATUS
            FROM TABLE(QSYS2.ACTIVE_JOB_INFO(
                RESET_STATISTICS => 'NO',
                DETAILED_INFO => 'FULL'))
            WHERE JOB_TYPE <> 'SYS'
            ORDER BY ELAPSED_CPU_PERCENTAGE DESC
        `);
        return result;
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to get system status';
        console.error('Error getting system status:', errorMessage);
        throw new Error(errorMessage);
    }
});

// Navigation and state management handlers
ipcMain.handle('disconnect', async () => {
    try {
        if (ibmiService) {
            await ibmiService.close();
            ibmiService = null;
        }
        if (monitoringInterval) {
            clearInterval(monitoringInterval);
            monitoringInterval = null;
        }
        connectionState.isConnected = false;
        connectionState.currentConnection = null;
        loadConnectionPage();
        return { success: true };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        console.error('Disconnect error:', errorMessage);
        return { success: false, error: errorMessage };
    }
});

ipcMain.handle('navigate-to-monitor', async () => {
    if (!connectionState.isConnected) {
        throw new Error('Not connected to IBM i');
    }
    loadMonitorPage();
    return { success: true };
});

ipcMain.handle('navigate-to-connection', async () => {
    loadConnectionPage();
    return { success: true };
});

ipcMain.handle('get-connection-state', () => {
    return connectionState;
});

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

ipcMain.on('start-monitoring', (_event, interval) => {
    if (monitoringInterval) {
        clearInterval(monitoringInterval);
    }

    monitoringInterval = setInterval(async () => {
        try {
            if (!ibmiService) {
                throw new Error('Not connected to IBM i');
            }
            const jobs = await ibmiService.getActiveJobs();
            mainWindow?.webContents.send('status-update', jobs);
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Monitoring failed';
            console.error('Monitoring error:', errorMessage);
            mainWindow?.webContents.send('monitoring-error', errorMessage);
        }
    }, interval);
});

ipcMain.on('stop-monitoring', () => {
    if (monitoringInterval) {
        clearInterval(monitoringInterval);
        monitoringInterval = null;
    }
});
