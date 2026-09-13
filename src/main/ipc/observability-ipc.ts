import { ipcMain, type SaveDialogOptions, type SaveDialogReturnValue } from 'electron/main';
import { writeFile } from 'node:fs/promises';
import { authorizeKnowledgeRead, type KnowledgeAccessContext } from '../../features/knowledge/knowledge-access';
import { type KnowledgeIndexStats } from '../../features/knowledge/knowledge-index';
import { normalizeObservabilitySettings, type ObservabilitySettings, type ObservabilitySnapshot } from '../../features/observability/observability-ledger';
import type { createAiabObservabilityRuntime } from '../runtime/aiab-observability-runtime';

export interface AiabObservabilityResponse {
    success: boolean;
    snapshot?: ObservabilitySnapshot;
    knowledge?: KnowledgeIndexStats;
    model?: { enabled: boolean; provider: string; model: string; state: 'ready' | 'unavailable' | 'disabled'; message: string };
    mcp?: { installed: number; enabled: number; ready: number; degraded: number; reasons: string[] };
    settings?: ObservabilitySettings;
    error?: string;
}

interface ObservabilityIpcDependencies {
    getAccessContext: () => KnowledgeAccessContext;
    getRuntime: () => ReturnType<typeof createAiabObservabilityRuntime>;
    getKnowledgeStats: () => Promise<KnowledgeIndexStats>;
    getModelStatus: () => Promise<AiabObservabilityResponse['model']> | AiabObservabilityResponse['model'];
    getMcpStatus: () => AiabObservabilityResponse['mcp'];
    getSettings: () => ObservabilitySettings;
    saveSettings: (candidate: Partial<ObservabilitySettings>) => ObservabilitySettings;
    showSaveDialog?: (options: SaveDialogOptions) => Promise<SaveDialogReturnValue>;
    getDownloadsPath?: () => string;
}

function canRead(dependencies: ObservabilityIpcDependencies) {
    return authorizeKnowledgeRead(dependencies.getAccessContext(), 'read');
}

function canInvestigate(dependencies: ObservabilityIpcDependencies) {
    return authorizeKnowledgeRead(dependencies.getAccessContext(), 'investigate');
}

/** Exposes redacted health, retention, and maintenance controls for the Storage screen. */
export function registerObservabilityIpc(dependencies: ObservabilityIpcDependencies) {
    ipcMain.handle('get-aiab-observability', async (): Promise<AiabObservabilityResponse> => {
        const access = canRead(dependencies);
        if (!access.allowed) return { success: false, error: access.reason || 'Observability access is unavailable.' };
        try {
            return {
                success: true,
                snapshot: await dependencies.getRuntime().getSnapshot(),
                knowledge: await dependencies.getKnowledgeStats(),
                model: await dependencies.getModelStatus(),
                mcp: dependencies.getMcpStatus(),
                settings: dependencies.getSettings()
            };
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : 'Unable to load AI + ActionBoard health.' };
        }
    });

    ipcMain.handle('save-aiab-observability-settings', async (_event, candidate: unknown) => {
        const access = canInvestigate(dependencies);
        if (!access.allowed) return { success: false, error: access.reason || 'Observability settings require investigation access.' };
        const value = candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate as Partial<ObservabilitySettings> : {};
        const settings = dependencies.saveSettings(normalizeObservabilitySettings(value));
        await dependencies.getRuntime().setSettings(settings);
        dependencies.getRuntime().recordAudit('system', 'retention-settings-saved', 'success');
        return { success: true, settings };
    });

    ipcMain.handle('purge-aiab-observability', async (_event, payload: unknown) => {
        const access = canInvestigate(dependencies);
        if (!access.allowed) return { success: false, error: access.reason || 'Observability purge requires investigation access.' };
        const input = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
        if (input.confirmed !== true) return { success: false, error: 'Observability purge requires explicit confirmation.' };
        try {
            const before = typeof input.before === 'string' ? input.before : new Date(Date.now() - dependencies.getSettings().retentionDays * 86400000).toISOString();
            const result = await dependencies.getRuntime().purge(before);
            dependencies.getRuntime().recordAudit('purge', 'observability', 'success', { deletedCount: result.deletedCount });
            return { success: true, ...result };
        } catch (error) {
            dependencies.getRuntime().recordAudit('failure', 'observability-purge', 'failure');
            return { success: false, error: error instanceof Error ? error.message : 'Unable to purge observability records.' };
        }
    });

    ipcMain.handle('export-aiab-observability', async () => {
        const access = canRead(dependencies);
        if (!access.allowed) return { success: false, error: access.reason || 'Observability export requires read access.' };
        if (!dependencies.showSaveDialog || !dependencies.getDownloadsPath) return { success: false, error: 'Export is unavailable in this environment.' };
        try {
            const selection = await dependencies.showSaveDialog({
                title: 'Export AI + ActionBoard observability',
                defaultPath: `${dependencies.getDownloadsPath()}/imonitor-observability.json`,
                filters: [{ name: 'JSON report', extensions: ['json'] }]
            });
            if (selection.canceled || !selection.filePath) return { success: false, canceled: true };
            await writeFile(selection.filePath, `${JSON.stringify(await dependencies.getRuntime().export(), null, 2)}\n`, 'utf8');
            dependencies.getRuntime().recordAudit('export', 'observability', 'success');
            return { success: true, filePath: selection.filePath };
        } catch (error) {
            dependencies.getRuntime().recordAudit('failure', 'observability-export', 'failure');
            return { success: false, error: error instanceof Error ? error.message : 'Unable to export observability records.' };
        }
    });
}
