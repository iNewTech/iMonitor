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

type ObservabilityIdentity = Pick<KnowledgeAccessContext, 'customerScope' | 'systemScope' | 'operatorId' | 'identity'>;

function isExpectedContext(value: unknown): value is ObservabilityIdentity {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const candidate = value as Partial<ObservabilityIdentity>;
    return [candidate.customerScope, candidate.systemScope, candidate.operatorId].every((item) => typeof item === 'string' && item.trim())
        && (candidate.identity === 'local-owner' || candidate.identity === 'delegated');
}

/** Exposes redacted health, retention, and maintenance controls for the Storage screen. */
export function registerObservabilityIpc(dependencies: ObservabilityIpcDependencies) {
    function requireAccess(original: ObservabilityIdentity, permission = 'read') {
        const current = dependencies.getAccessContext();
        if (current.customerScope !== original.customerScope || current.systemScope !== original.systemScope
            || current.operatorId !== original.operatorId || current.identity !== original.identity) {
            throw new Error('The active connection changed. Retry from the current system.');
        }
        const access = authorizeKnowledgeRead(current, permission);
        if (!access.allowed) throw new Error(access.reason || 'Observability access is unavailable.');
    }

    ipcMain.handle('get-aiab-observability', async (): Promise<AiabObservabilityResponse> => {
        const context = { ...dependencies.getAccessContext() };
        try {
            requireAccess(context);
            const result = {
                success: true,
                snapshot: await dependencies.getRuntime().getSnapshot(),
                knowledge: await dependencies.getKnowledgeStats(),
                model: await dependencies.getModelStatus(),
                mcp: dependencies.getMcpStatus(),
                settings: dependencies.getSettings()
            };
            requireAccess(context);
            return result;
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : 'Unable to load AI + ActionBoard health.' };
        }
    });

    ipcMain.handle('save-aiab-observability-settings', async (_event, candidate: unknown) => {
        try {
            requireAccess(dependencies.getAccessContext(), 'investigate');
            const value = candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate as Partial<ObservabilitySettings> : {};
            const settings = dependencies.saveSettings(normalizeObservabilitySettings({ ...dependencies.getSettings(), ...value }));
            await dependencies.getRuntime().setSettings(settings);
            dependencies.getRuntime().recordAudit('system', 'retention-settings-saved', 'success');
            return { success: true, settings };
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : 'Unable to save telemetry retention.' };
        }
    });

    ipcMain.handle('purge-aiab-observability', async (_event, payload: unknown) => {
        const context = { ...dependencies.getAccessContext() };
        const access = authorizeKnowledgeRead(context, 'investigate');
        if (!access.allowed) return { success: false, error: access.reason || 'Observability purge requires investigation access.' };
        const input = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
        if (input.confirmed !== true) return { success: false, error: 'Observability purge requires explicit confirmation.' };
        try {
            // Standalone callers may omit this; a supplied context must be complete.
            if ('expectedContext' in input && !isExpectedContext(input.expectedContext)) {
                throw new Error('The confirmed purge context is missing or invalid. Retry from the current system.');
            }
            const before = typeof input.before === 'string' ? input.before : new Date(Date.now() - dependencies.getSettings().retentionDays * 86400000).toISOString();
            const runtime = dependencies.getRuntime();
            requireAccess((input.expectedContext as ObservabilityIdentity | undefined) || context, 'investigate');
            const result = await runtime.purge(before);
            dependencies.getRuntime().recordAudit('purge', 'observability', 'success', { deletedCount: result.deletedCount });
            return { success: true, ...result };
        } catch (error) {
            dependencies.getRuntime().recordAudit('failure', 'observability-purge', 'failure');
            return { success: false, error: error instanceof Error ? error.message : 'Unable to purge observability records.' };
        }
    });

    ipcMain.handle('export-aiab-observability', async () => {
        const context = { ...dependencies.getAccessContext() };
        if (!dependencies.showSaveDialog || !dependencies.getDownloadsPath) return { success: false, error: 'Export is unavailable in this environment.' };
        try {
            requireAccess(context);
            const selection = await dependencies.showSaveDialog({
                title: 'Export AI + ActionBoard observability',
                defaultPath: `${dependencies.getDownloadsPath()}/imonitor-observability.json`,
                filters: [{ name: 'JSON report', extensions: ['json'] }]
            });
            if (selection.canceled || !selection.filePath) return { success: false, canceled: true };
            requireAccess(context);
            const report = await dependencies.getRuntime().export();
            requireAccess(context);
            await writeFile(selection.filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
            dependencies.getRuntime().recordAudit('export', 'observability', 'success');
            return { success: true, filePath: selection.filePath };
        } catch (error) {
            dependencies.getRuntime().recordAudit('failure', 'observability-export', 'failure');
            return { success: false, error: error instanceof Error ? error.message : 'Unable to export observability records.' };
        }
    });
}
