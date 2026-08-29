import { ipcMain } from 'electron/main';
import type {
    AiProviderCatalogEntry,
    AiAssistantAvailability,
    AiAssistantMessage,
    AiAssistantSettings
} from '../../features/ibmeyeai/ai-model';

interface RegisterAiIpcDependencies {
    getAiProviderCatalog: () => AiProviderCatalogEntry[];
    getAiSettings: () => AiAssistantSettings;
    saveAiSettings: (settings: Partial<AiAssistantSettings> | undefined) => AiAssistantSettings;
    getAiAvailability: () => Promise<AiAssistantAvailability>;
    askAssistant: (payload: {
        message: string;
        selectedJobName?: string;
        conversation?: AiAssistantMessage[];
    }) => Promise<{
        success: boolean;
        reply?: string;
        availability?: AiAssistantAvailability;
        error?: string;
    }>;
}

/**
 * Registers Ollama-backed AI assistant handlers for the monitor UI.
 */
export function registerAiIpc(dependencies: RegisterAiIpcDependencies) {
    ipcMain.handle('get-ai-provider-catalog', () => dependencies.getAiProviderCatalog());
    ipcMain.handle('get-ai-settings', () => dependencies.getAiSettings());
    ipcMain.handle('save-ai-settings', (_event, settings) => dependencies.saveAiSettings(settings));
    ipcMain.handle('get-ai-availability', () => dependencies.getAiAvailability());
    ipcMain.handle('ask-ai-assistant', (_event, payload) => dependencies.askAssistant(payload));
}
