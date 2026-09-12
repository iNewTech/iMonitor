import type { OpenDialogOptions, OpenDialogReturnValue, SaveDialogOptions, SaveDialogReturnValue } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { DemoObjectAnalysisService } from '../../services/object-analysis';
import { IbmiObjectAnalysisService, type IbmiObjectAnalysisClient } from '../../services/object-analysis-live';
import { getDemoObjectAnalysisPath } from '../../utils/demo-system';
import { buildObjectAnalysisAiContext, buildObjectAnalysisAiQuestion } from '../../features/object-analysis/ai-prompt';
import {
    formatObjectAnalysisReport,
    type AnalyzeObjectRequest,
    type ObjectAnalysisResult,
    type ObjectAnalysisSettings
} from '../../features/object-analysis/model';
import { buildDetailedProgramAnalysis } from '../../features/object-analysis/program-analysis';
import { persistObjectAnalysisReport } from '../../features/object-analysis/report-storage';
import { persistObjectAnalysisCompilePlan } from '../../features/object-analysis/compile-plan';
import type { ActivityLogEntry } from '../types';
import type { createAiRuntime } from './ai-runtime';

interface ObjectAnalysisRuntimeDependencies {
    getSettings: () => Promise<ObjectAnalysisSettings>;
    setSettings: (candidate: Partial<ObjectAnalysisSettings>) => Promise<ObjectAnalysisSettings>;
    isDemoSession: () => boolean;
    isConnected: () => boolean;
    getCurrentService: () => IbmiObjectAnalysisClient | null;
    getAppPath: (name: 'userData' | 'downloads') => string;
    getCurrentOperatorName: () => string;
    showOpenDialog: (options: OpenDialogOptions) => Promise<OpenDialogReturnValue>;
    showSaveDialog: (options: SaveDialogOptions) => Promise<SaveDialogReturnValue>;
    askAssistant: ReturnType<typeof createAiRuntime>['askAssistant'];
    recordActivity: (entry: Omit<ActivityLogEntry, 'id' | 'timestamp'>) => void;
}

export function createObjectAnalysisRuntime(dependencies: ObjectAnalysisRuntimeDependencies) {
    function getLocalObjectAnalysisService(settings: ObjectAnalysisSettings) {
        return new DemoObjectAnalysisService(settings.localDirectory || getDemoObjectAnalysisPath());
    }

    async function getObjectAnalysisLibraryList(options?: {
        source?: ObjectAnalysisSettings['source'];
        localDirectory?: string;
    }) {
        const currentSettings = await dependencies.getSettings();
        const source = options?.source || currentSettings.source;
        if (source === 'local') {
            const settings = {
                ...currentSettings,
                source: 'local' as const,
                localDirectory: options?.localDirectory ?? currentSettings.localDirectory
            };
            return getLocalObjectAnalysisService(settings).getLibraryListInfo();
        }

        if (dependencies.isDemoSession() || !dependencies.isConnected()) {
            throw new Error('Connect to a live IBM i system before loading the IBM i library list.');
        }

        const service = dependencies.getCurrentService();
        if (!service) {
            throw new Error('The IBM i session is not ready. Reconnect and try again.');
        }
        return {
            libraries: await new IbmiObjectAnalysisService(service).getEnvironmentLibraryList(),
            source: 'environment' as const
        };
    }

    async function getObjectAnalysisWorkspace(settings: ObjectAnalysisSettings) {
        if (settings.source === 'local') {
            return getLocalObjectAnalysisService(settings).getWorkspace(settings);
        }

        if (dependencies.isDemoSession() || !dependencies.isConnected()) {
            throw new Error('Connect to a live IBM i system before loading IBM i libraries.');
        }

        const service = dependencies.getCurrentService();
        if (!service) {
            throw new Error('The IBM i session is not ready. Reconnect and try again.');
        }
        return new IbmiObjectAnalysisService(service).getWorkspace(settings);
    }

    async function persistDetailedObjectAnalysis(
        result: ObjectAnalysisResult,
        sourceText: string,
        settings: ObjectAnalysisSettings
    ) {
        const appStorageRoot = path.join(dependencies.getAppPath('userData'), 'object-analysis');
        if (settings.source === 'local') {
            const sourceRoot = settings.localDirectory || getDemoObjectAnalysisPath();
            const artifact = await persistObjectAnalysisReport(sourceRoot, result, sourceText, 'source-directory');
            if (artifact.mode !== 'error') return artifact;
        }
        return persistObjectAnalysisReport(appStorageRoot, result, sourceText, 'app-storage');
    }

    async function analyzeObject(request: AnalyzeObjectRequest, settings: ObjectAnalysisSettings) {
        let result: ObjectAnalysisResult;
        if (settings.source === 'local') {
            result = await getLocalObjectAnalysisService(settings).analyzeObject(request, settings);
        } else {
            if (dependencies.isDemoSession() || !dependencies.isConnected()) {
                throw new Error('Connect to a live IBM i system before analyzing IBM i source.');
            }

            const service = dependencies.getCurrentService();
            if (!service) {
                throw new Error('The IBM i session is not ready. Reconnect and try again.');
            }
            result = await new IbmiObjectAnalysisService(service).analyzeObject(request, settings);
        }

        const sourceText = await getObjectAnalysisSourceContent(request, settings);
        const detailed = buildDetailedProgramAnalysis(result, sourceText);
        detailed.approval = { status: 'draft' };
        delete detailed.reportArtifact;
        return detailed;
    }

    async function getObjectAnalysisSourceContent(request: AnalyzeObjectRequest, settings: ObjectAnalysisSettings) {
        if (settings.source === 'local') {
            return getLocalObjectAnalysisService(settings).getSourceContent(request, settings);
        }

        if (dependencies.isDemoSession() || !dependencies.isConnected()) {
            throw new Error('Connect to a live IBM i system before loading IBM i source.');
        }

        const service = dependencies.getCurrentService();
        if (!service) {
            throw new Error('The IBM i session is not ready. Reconnect and try again.');
        }
        return new IbmiObjectAnalysisService(service).getSourceContent(request, settings);
    }

    async function analyzeObjectWithAi(request: AnalyzeObjectRequest, existingResult?: ObjectAnalysisResult) {
        const settings = await dependencies.getSettings();
        const result = existingResult || await analyzeObject(request, settings);
        const sourceText = await getObjectAnalysisSourceContent(request, settings);
        const response = await dependencies.askAssistant({
            message: buildObjectAnalysisAiQuestion(result),
            additionalContext: buildObjectAnalysisAiContext(result, sourceText)
        });
        if (response.success && response.reply) {
            result.approval = { status: 'draft' };
            delete result.reportArtifact;
            result.aiReport = {
                content: response.reply,
                providerLabel: response.availability.providerLabel,
                model: response.availability.selectedModel || 'configured model',
                generatedAt: new Date().toISOString()
            };
            return { ...response, result };
        }
        return response;
    }

    async function approveObjectAnalysis(request: AnalyzeObjectRequest, result: ObjectAnalysisResult) {
        const settings = await dependencies.getSettings();
        const sourceText = await getObjectAnalysisSourceContent(request, settings);
        result.approval = {
            status: 'approved',
            approvedAt: new Date().toISOString(),
            approvedBy: dependencies.getCurrentOperatorName()
        };
        delete result.reportArtifact;
        const artifact = await persistDetailedObjectAnalysis(result, sourceText, settings);
        if (artifact.mode === 'error') {
            result.approval = { status: 'draft' };
            return { success: false, result, error: artifact.error || artifact.message };
        }
        return { success: true, result, artifact };
    }

    async function saveObjectAnalysisLibraryList(value: string[]) {
        const settings = await dependencies.getSettings();
        if (settings.source !== 'local') {
            throw new Error('Permanent setup-file saves are available when a local source directory is selected.');
        }

        const saved = await getLocalObjectAnalysisService(settings).saveLibraryList(value);
        const nextSettings = await dependencies.setSettings({
            libraryList: saved.libraries,
            libraries: saved.libraries
        });
        return { ...saved, settings: nextSettings };
    }

    async function selectObjectAnalysisDirectory() {
        const selection = await dependencies.showOpenDialog({
            title: 'Choose local IBM i source directory',
            properties: ['openDirectory', 'createDirectory']
        });
        return selection.canceled ? null : (selection.filePaths[0] || null);
    }

    async function generateObjectAnalysisCompilePlan(request: AnalyzeObjectRequest, result: ObjectAnalysisResult) {
        const settings = await dependencies.getSettings();
        // Ensure the selected source is still readable in the active scope before writing build artifacts.
        await getObjectAnalysisSourceContent(request, settings);
        const appStorageRoot = path.join(dependencies.getAppPath('userData'), 'object-analysis');
        const sourceRoot = settings.source === 'local' ? (settings.localDirectory || getDemoObjectAnalysisPath()) : appStorageRoot;
        const mode = settings.source === 'local' ? 'source-directory' as const : 'app-storage' as const;
        if (settings.source !== 'local') await mkdir(appStorageRoot, { recursive: true });
        const compilePlan = await persistObjectAnalysisCompilePlan(sourceRoot, result, mode);
        result.compilePlan = compilePlan;
        if (compilePlan.artifact?.mode === 'error') {
            return { success: false, result, compilePlan, error: compilePlan.artifact.error || compilePlan.artifact.message };
        }
        return { success: true, result, compilePlan };
    }

    async function saveObjectAnalysisReport(result: ObjectAnalysisResult) {
        const suggestedName = `${result.root.library}-${result.root.name}-analysis.md`.toLowerCase();
        const selection = await dependencies.showSaveDialog({
            title: 'Save object analysis report',
            defaultPath: path.join(dependencies.getAppPath('downloads'), suggestedName),
            filters: [{ name: 'Markdown report', extensions: ['md'] }, { name: 'All files', extensions: ['*'] }]
        });

        if (selection.canceled || !selection.filePath) {
            return { success: false, error: 'Report save canceled.' };
        }

        try {
            await writeFile(selection.filePath, formatObjectAnalysisReport(result), 'utf8');
            dependencies.recordActivity({
                area: 'monitoring',
                level: 'success',
                message: 'Object analysis report saved.',
                detail: selection.filePath
            });
            return { success: true, filePath: selection.filePath };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unable to save the analysis report.'
            };
        }
    }

    return {
        getLocalObjectAnalysisService,
        getObjectAnalysisLibraryList,
        getObjectAnalysisWorkspace,
        getObjectAnalysisSourceContent,
        analyzeObject,
        analyzeObjectWithAi,
        approveObjectAnalysis,
        saveObjectAnalysisLibraryList,
        selectObjectAnalysisDirectory,
        generateObjectAnalysisCompilePlan,
        saveObjectAnalysisReport
    };
}
