import { BrowserWindow } from 'electron/main';
import * as path from 'path';

interface WindowRuntimeDependencies {
    preloadPath: string;
    isDevelopment: boolean;
    onClosed: () => void;
    iconPath?: string;
    shouldShowWindow?: () => boolean;
}

/**
 * Owns the Electron browser window and page navigation helpers.
 */
export function createWindowRuntime(dependencies: WindowRuntimeDependencies) {
    let mainWindow: BrowserWindow | null = null;
    const jobTaskWindows = new Map<string, BrowserWindow>();

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

    const openJobTaskWindow = (jobName: string) => {
        const normalizedJobName = String(jobName || '').trim();
        if (!normalizedJobName) {
            return;
        }

        const existingWindow = jobTaskWindows.get(normalizedJobName);
        if (existingWindow && !existingWindow.isDestroyed()) {
            existingWindow.focus();
            return;
        }

        const taskWindow = new BrowserWindow({
            width: 820,
            height: 620,
            minWidth: 560,
            minHeight: 460,
            title: `Job Task - ${normalizedJobName}`,
            icon: dependencies.iconPath,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: dependencies.preloadPath
            }
        });

        taskWindow.loadFile(path.join(__dirname, '../../../public/job-task.html'), {
            query: { jobName: normalizedJobName }
        });

        taskWindow.on('closed', () => {
            jobTaskWindows.delete(normalizedJobName);
        });

        jobTaskWindows.set(normalizedJobName, taskWindow);
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
        openJobTaskWindow,
        createWindow() {
            mainWindow = new BrowserWindow({
                width: 1280,
                height: 860,
                show: dependencies.shouldShowWindow?.() !== false,
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
