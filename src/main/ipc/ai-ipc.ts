import { ipcMain } from 'electron/main';
import type {
    AiProviderCatalogEntry,
    AiAssistantAvailability,
    AiAssistantMessage,
    AiAssistantSettings
} from '../../features/ibmeyeai/ai-model';
import type { AuthorizationResult } from '../../features/action-board/operator-access';

interface RegisterAiIpcDependencies {
    requireProviderAccess: (provider?: string) => void;
    getAiProviderCatalog: () => AiProviderCatalogEntry[];
    getAiSettings: () => AiAssistantSettings;
    saveAiSettings: (settings: Partial<AiAssistantSettings> | undefined) => AiAssistantSettings;
    getAiAvailability: () => Promise<AiAssistantAvailability>;
    askAssistant: (payload: {
        message: string;
        selectedJobName?: string;
        conversation?: AiAssistantMessage[];
        additionalContext?: string;
        scope?: 'monitor' | 'job';
    }) => Promise<{
        success: boolean;
        reply?: string;
        availability?: AiAssistantAvailability;
        error?: string;
    }>;
    authorizeAction: (action: 'read', systemId: string | undefined) => AuthorizationResult;
    getCurrentSystemId: () => string | undefined;
}

/**
 * Registers Ollama-backed AI assistant handlers for the monitor UI.
 */
export function registerAiIpc(dependencies: RegisterAiIpcDependencies) {
    ipcMain.handle('get-ai-provider-catalog', () => dependencies.getAiProviderCatalog());
    ipcMain.handle('get-ai-settings', () => dependencies.getAiSettings());
    ipcMain.handle('save-ai-settings', (_event, settings) => {
        dependencies.requireProviderAccess(settings?.provider);
        return dependencies.saveAiSettings(settings);
    });
    ipcMain.handle('get-ai-availability', () => dependencies.getAiAvailability());
    ipcMain.handle('ask-ai-assistant', (_event, payload) => {
        dependencies.requireProviderAccess();
        const authorization = dependencies.authorizeAction('read', dependencies.getCurrentSystemId());
        if (!authorization.allowed) {
            return {
                success: false,
                error: authorization.reason || 'The operator is not allowed to use this AI context.'
            };
        }
        return dependencies.askAssistant(payload);
    });
}
