import { ipcMain } from 'electron/main';
import type {
    CollectionQuery,
    CollectorSettings
} from '../../features/collector/collector-model';
import type { createBackgroundCollectorRuntime } from '../runtime/background-collector-runtime';
import type { createCollectionRuntime } from '../runtime/collection-runtime';

interface CollectorIpcDependencies {
    getSettings: () => CollectorSettings;
    applySettings: (settings: Partial<CollectorSettings>) => Promise<unknown>;
    getStatus: () => unknown;
    collectionRuntime: ReturnType<typeof createCollectionRuntime>;
}

export function registerCollectorIpc(dependencies: CollectorIpcDependencies) {
    ipcMain.handle('get-collector-settings', () => dependencies.getSettings());
    ipcMain.handle('save-collector-settings', (_event, settings: Partial<CollectorSettings>) => dependencies.applySettings(settings));
    ipcMain.handle('get-collector-status', () => dependencies.getStatus());
    ipcMain.handle('get-collection-inventory', (_event, query: CollectionQuery = {}) => dependencies.collectionRuntime.getInventory(query));
    ipcMain.handle('preview-collection-purge', (_event, query: CollectionQuery = {}) => dependencies.collectionRuntime.previewPurge(query));
    ipcMain.handle('purge-collection', async (_event, payload: { query: CollectionQuery; confirmed?: boolean }) => {
        if (!payload?.confirmed) {
            return { success: false, error: 'Collection purge requires explicit confirmation.' };
        }
        return { success: true, summary: await dependencies.collectionRuntime.purge(payload.query || {}) };
    });
}

export type BackgroundCollectorRuntime = ReturnType<typeof createBackgroundCollectorRuntime>;
