import { BrowserWindow } from 'electron/main';
import * as path from 'path';

interface WindowRuntimeDependencies {
    preloadPath: string;
    isDevelopment: boolean;
    onClosed: () => void;
}

/**
 * Owns the Electron browser window and page navigation helpers.
 */
export function createWindowRuntime(dependencies: WindowRuntimeDependencies) {
    let mainWindow: BrowserWindow | null = null;

    const loadConnectionPage = () => {
        mainWindow?.loadFile(path.join(__dirname, '../../../public/index.html'));
    };

    const loadMonitorPage = () => {
        mainWindow?.loadFile(path.join(__dirname, '../../../public/monitor.html'));
    };

    return {
        getWindow() {
            return mainWindow;
        },
        sendToWindow(channel: string, payload: unknown) {
            if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
                return;
            }

            mainWindow.webContents.send(channel, payload);
        },
        loadConnectionPage,
        loadMonitorPage,
        createWindow() {
            mainWindow = new BrowserWindow({
                width: 1280,
                height: 860,
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    preload: dependencies.preloadPath
                }
            });

            loadConnectionPage();

            mainWindow.on('closed', () => {
                dependencies.onClosed();
                mainWindow = null;
            });

            if (dependencies.isDevelopment) {
                mainWindow.webContents.openDevTools();
            }
        }
    };
}
