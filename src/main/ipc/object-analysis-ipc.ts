import { ipcMain } from 'electron/main';
import type {
    AnalyzeObjectRequest,
    ObjectAnalysisResult,
    ObjectAnalysisSettings,
    ObjectAnalysisWorkspace
} from '../../features/object-analysis/model';

interface RegisterObjectAnalysisIpcDependencies {
    getSettings: () => Promise<ObjectAnalysisSettings> | ObjectAnalysisSettings;
    saveSettings: (candidate: Partial<ObjectAnalysisSettings> | undefined) => Promise<ObjectAnalysisSettings> | ObjectAnalysisSettings;
    selectLocalDirectory: () => Promise<string | null>;
    getLibraryList: (options?: {
        source?: ObjectAnalysisSettings['source'];
        localDirectory?: string;
    }) => Promise<{ libraries: string[]; masterLibrary?: string; source?: string; fileName?: string }>;
    saveLibraryList: (libraries: string[]) => Promise<{
        fileName: string;
        libraries: string[];
        settings: ObjectAnalysisSettings;
    }>;
    getWorkspace: (settings: ObjectAnalysisSettings) => Promise<ObjectAnalysisWorkspace>;
    loadSource: (
        request: AnalyzeObjectRequest,
        settings: ObjectAnalysisSettings
    ) => Promise<string>;
    analyzeObject: (
        request: AnalyzeObjectRequest,
        settings: ObjectAnalysisSettings
    ) => Promise<ObjectAnalysisResult>;
    analyzeWithAi: (
        request: AnalyzeObjectRequest,
        result?: ObjectAnalysisResult
    ) => Promise<{
        success: boolean;
        reply?: string;
        availability?: {
            providerLabel: string;
            selectedModel: string | null;
            message: string;
        };
        result?: ObjectAnalysisResult;
        error?: string;
    }>;
    approveAnalysis: (
        request: AnalyzeObjectRequest,
        result: ObjectAnalysisResult
    ) => Promise<{
        success: boolean;
        result: ObjectAnalysisResult;
        artifact?: ObjectAnalysisResult['reportArtifact'];
        error?: string;
    }>;
    saveReport: (result: ObjectAnalysisResult) => Promise<{
        success: boolean;
        filePath?: string;
        error?: string;
    }>;
    recordActivity: (entry: {
        area: 'navigation' | 'monitoring';
        level: 'info' | 'success' | 'warning' | 'error';
        message: string;
        detail?: string;
    }) => void;
}

function isSafeAnalysisRequest(value: unknown): value is AnalyzeObjectRequest {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const request = value as Partial<AnalyzeObjectRequest>;
    return typeof request.library === 'string'
        && typeof request.relativePath === 'string'
        && request.library.length > 0
        && request.relativePath.length > 0
        && !request.library.includes('..')
        && !request.relativePath.split('/').includes('..');
}

/** Registers the object-analysis bridge used by the demo and future live providers. */
export function registerObjectAnalysisIpc(dependencies: RegisterObjectAnalysisIpcDependencies) {
    ipcMain.handle('get-object-analysis-settings', async () => dependencies.getSettings());

    ipcMain.handle('save-object-analysis-settings', async (_event, candidate?: Partial<ObjectAnalysisSettings>) => {
        const settings = await dependencies.saveSettings(candidate);
        dependencies.recordActivity({
            area: 'monitoring',
            level: 'success',
            message: 'Object analysis scan scope saved.',
            detail: settings.libraries.join(', ')
        });
        return settings;
    });

    ipcMain.handle('save-object-analysis-library-list', async (_event, value?: unknown) => {
        if (!Array.isArray(value) || value.some((library) => typeof library !== 'string')) {
            return { success: false, error: 'Enter a valid library list before saving the setup file.' };
        }

        try {
            const saved = await dependencies.saveLibraryList(value);
            dependencies.recordActivity({
                area: 'monitoring',
                level: 'success',
                message: 'Object analysis setup file saved.',
                detail: saved.libraries.join(', ')
            });
            return { success: true, ...saved };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to save the object analysis setup file.';
            dependencies.recordActivity({ area: 'monitoring', level: 'error', message: 'Object analysis setup save failed.', detail: message });
            return { success: false, error: message };
        }
    });

    ipcMain.handle('select-object-analysis-directory', async () => {
        return dependencies.selectLocalDirectory();
    });

    ipcMain.handle('get-object-analysis-library-list', async (_event, options?: {
        source?: ObjectAnalysisSettings['source'];
        localDirectory?: string;
    }) => {
        try {
            return { success: true, ...(await dependencies.getLibraryList(options)) };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to load the environment library list.';
            dependencies.recordActivity({ area: 'monitoring', level: 'error', message: 'Object analysis library list failed.', detail: message });
            return { success: false, error: message };
        }
    });

    ipcMain.handle('get-object-analysis-workspace', async () => {
        try {
            return { success: true, ...(await dependencies.getWorkspace(await dependencies.getSettings())) };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to load the analysis workspace.';
            dependencies.recordActivity({ area: 'monitoring', level: 'error', message: 'Object analysis workspace failed.', detail: message });
            return { success: false, error: message };
        }
    });

    ipcMain.handle('load-object-analysis-source', async (_event, request: unknown) => {
        if (!isSafeAnalysisRequest(request)) {
            return { success: false, error: 'Choose a valid source file to load.' };
        }

        try {
            const content = await dependencies.loadSource(request, await dependencies.getSettings());
            dependencies.recordActivity({
                area: 'monitoring',
                level: 'success',
                message: `Loaded source ${request.library}/${request.relativePath}.`,
                detail: `${content.split(/\r?\n/).length} lines`
            });
            return { success: true, content, lineCount: content.split(/\r?\n/).length };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to load the selected source file.';
            dependencies.recordActivity({ area: 'monitoring', level: 'error', message: 'Source file load failed.', detail: message });
            return { success: false, error: message };
        }
    });

    ipcMain.handle('analyze-object', async (_event, request: unknown) => {
        if (!isSafeAnalysisRequest(request)) {
            return { success: false, error: 'Choose a valid source file to analyze.' };
        }

        try {
            const result = await dependencies.analyzeObject(request, await dependencies.getSettings());
            dependencies.recordActivity({
                area: 'monitoring',
                level: 'success',
                message: `Analyzed ${result.root.library}/${result.root.name}.`,
                detail: `${result.nodes.length} objects, ${result.edges.length} relationships`
            });
            return { success: true, result };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to analyze the selected object.';
            dependencies.recordActivity({ area: 'monitoring', level: 'error', message: 'Object analysis failed.', detail: message });
            return { success: false, error: message };
        }
    });

    ipcMain.handle('analyze-object-with-ai', async (_event, request: unknown, result?: ObjectAnalysisResult) => {
        if (!isSafeAnalysisRequest(request)) {
            return { success: false, error: 'Choose a valid source file before asking IBMEye AI.' };
        }

        try {
            return await dependencies.analyzeWithAi(request, result);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to prepare the AI analysis.';
            dependencies.recordActivity({ area: 'monitoring', level: 'error', message: 'Object analysis AI preparation failed.', detail: message });
            return { success: false, error: message };
        }
    });

    ipcMain.handle('approve-object-analysis', async (_event, request: unknown, result?: ObjectAnalysisResult) => {
        if (!isSafeAnalysisRequest(request) || !result?.root?.name || !Array.isArray(result.nodes) || !Array.isArray(result.edges)) {
            return { success: false, error: 'Run a valid analysis before approving its report.' };
        }

        try {
            const response = await dependencies.approveAnalysis(request, result);
            dependencies.recordActivity({
                area: 'monitoring',
                level: response.success ? 'success' : 'error',
                message: response.success
                    ? `Approved analysis for ${result.root.library}/${result.root.name}.`
                    : `Could not approve analysis for ${result.root.library}/${result.root.name}.`,
                detail: response.artifact?.relativePath || response.error
            });
            return response;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to approve and map the analysis report.';
            dependencies.recordActivity({ area: 'monitoring', level: 'error', message: 'Object analysis approval failed.', detail: message });
            return { success: false, error: message };
        }
    });

    ipcMain.handle('save-object-analysis-report', async (_event, result: ObjectAnalysisResult) => {
        if (!result?.root?.name || !Array.isArray(result.nodes) || !Array.isArray(result.edges)) {
            return { success: false, error: 'There is no analysis report to save.' };
        }

        return dependencies.saveReport(result);
    });

}
