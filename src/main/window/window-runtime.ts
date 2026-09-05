import { BrowserWindow } from 'electron/main';
import * as path from 'path';

interface WindowRuntimeDependencies {
    preloadPath: string;
    isDevelopment: boolean;
    onClosed: () => void;
    iconPath?: string;
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

    const loadSettingsPage = () => {
        mainWindow?.loadFile(path.join(__dirname, '../../../public/settings.html'));
    };

    const loadObjectAnalysisPage = () => {
        mainWindow?.loadFile(path.join(__dirname, '../../../public/object-analysis.html'));
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
        loadSettingsPage,
        loadObjectAnalysisPage,
        createWindow() {
            mainWindow = new BrowserWindow({
                width: 1280,
                height: 860,
                icon: dependencies.iconPath,
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
