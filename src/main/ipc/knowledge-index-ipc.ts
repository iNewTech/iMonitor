import { ipcMain } from 'electron/main';
import {
    getKnowledgeIndexCatalog,
    normalizeKnowledgeIndexSettings,
    type KnowledgeIndexHealth,
    type KnowledgeIndexSettings
} from '../../features/knowledge/knowledge-index';

export interface KnowledgeIndexSettingsResponse {
    success: boolean;
    settings?: KnowledgeIndexSettings;
    catalog?: ReturnType<typeof getKnowledgeIndexCatalog>;
    health?: KnowledgeIndexHealth;
    error?: string;
}

export interface KnowledgeIndexIpcDependencies {
    getSettings: () => Promise<KnowledgeIndexSettingsResponse> | KnowledgeIndexSettingsResponse;
    saveSettings: (candidate: unknown) => Promise<KnowledgeIndexSettingsResponse> | KnowledgeIndexSettingsResponse;
    testConnection: () => Promise<KnowledgeIndexHealth>;
}

/** Registers the small Settings surface for choosing and checking the knowledge index. */
export function registerKnowledgeIndexIpc(dependencies: KnowledgeIndexIpcDependencies) {
    ipcMain.handle('get-knowledge-index-settings', () => dependencies.getSettings());
    ipcMain.handle('save-knowledge-index-settings', (_event, candidate: unknown) => dependencies.saveSettings(candidate));
    ipcMain.handle('test-knowledge-index-connection', async () => {
        try {
            const health = await dependencies.testConnection();
            return { success: health.state === 'ready', health, error: health.state === 'ready' ? undefined : health.message } satisfies KnowledgeIndexSettingsResponse;
        } catch (error) {
            return {
                success: false,
                health: {
                    backend: normalizeKnowledgeIndexSettings({}).backend,
                    state: 'unavailable',
                    message: 'Knowledge index connection test failed.',
                    checkedAt: new Date().toISOString()
                },
                error: error instanceof Error ? error.message : 'Knowledge index connection test failed.'
            } satisfies KnowledgeIndexSettingsResponse;
        }
    });
}
