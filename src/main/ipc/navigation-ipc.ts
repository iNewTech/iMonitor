import { ipcMain } from 'electron/main';

interface RegisterNavigationIpcDependencies {
    canOpenMonitor: () => boolean;
    loadMonitorPage: () => void;
    loadConnectionPage: () => void;
    loadSettingsPage: () => void;
    loadKnowledgePage: () => void;
    loadObjectAnalysisPage: () => void;
    openJobTaskWindow: (jobName: string) => void;
    openExternalUrl: (target: string) => Promise<void> | void;
    recordActivity: (entry: {
        area: 'navigation';
        level: 'info';
        message: string;
        detail?: string;
    }) => void;
}

function isSafeExternalUrl(target: unknown): target is string {
    // URL accepts repaired URLs and strips some controls; the OS receives the
    // original string, so reject ambiguous syntax before parsing it.
    if (typeof target !== 'string' || !target
        || /[\s\\\u0000-\u001f\u007f]/u.test(target)
        || /%(?![\da-f]{2})/iu.test(target)) return false;

    try {
        const url = new URL(target);
        if (url.username || url.password) return false;

        if (url.protocol === 'http:' || url.protocol === 'https:') {
            const authority = /^https?:\/\/([^/?#]+)/iu.exec(target)?.[1];
            return Boolean(url.hostname && authority && !authority.includes('@'));
        }

        if (url.protocol === 'mailto:' && !url.host && !url.hash) {
            // Support encoded recipients and comma-separated addresses without
            // mistaking mailto authority/userinfo or local paths for mailboxes.
            const recipients = decodeURIComponent(url.pathname);
            if (/[\u0000-\u001f\u007f]/u.test(recipients)) return false;
            return recipients.split(',').every((recipient) => /^[^\s@,:/\\?#<>"]+@[^\s@,:/\\?#<>"]+$/u.test(recipient));
        }
    } catch {
        return false;
    }
    return false;
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

    ipcMain.handle('navigate-to-settings', async () => {
        if (!dependencies.canOpenMonitor()) {
            throw new Error('Not connected to IBM i');
        }
        dependencies.loadSettingsPage();
        dependencies.recordActivity({
            area: 'navigation',
            level: 'info',
            message: 'Opened the settings workspace.'
        });
        return { success: true };
    });

    ipcMain.handle('navigate-to-knowledge', async () => {
        if (!dependencies.canOpenMonitor()) {
            throw new Error('Not connected to IBM i');
        }
        dependencies.loadKnowledgePage();
        dependencies.recordActivity({ area: 'navigation', level: 'info', message: 'Opened the Knowledge workspace.' });
        return { success: true };
    });

    ipcMain.handle('navigate-to-object-analysis', async () => {
        dependencies.loadObjectAnalysisPage();
        dependencies.recordActivity({
            area: 'navigation',
            level: 'info',
            message: 'Opened the object analysis workspace.'
        });
        return { success: true };
    });

    ipcMain.handle('open-external-url', async (_event, target: unknown) => {
        if (!isSafeExternalUrl(target)) {
            throw new Error('External URL must be an absolute HTTP(S) or mailto URL without credentials.');
        }
        await dependencies.openExternalUrl(target);
        return { success: true };
    });

    ipcMain.handle('open-job-task-window', async (_event, jobName: string) => {
        dependencies.openJobTaskWindow(jobName);
        dependencies.recordActivity({
            area: 'navigation',
            level: 'info',
            message: 'Opened a job task window.',
            detail: jobName
        });
        return { success: true };
    });
}
