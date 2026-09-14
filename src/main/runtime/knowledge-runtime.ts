import type { SaveDialogOptions, SaveDialogReturnValue } from 'electron/main';
import { getEffectiveSupportAccessGrant, isClientOwner } from '../../features/action-board/support-access';
import type { AiAssistantAvailability, AiAssistantSettings } from '../../features/ibmeyeai/ai-model';
import { toKnowledgeGrantSnapshot, type KnowledgeAccessContext } from '../../features/knowledge/knowledge-access';
import { createKnowledgeStore } from '../../features/knowledge/knowledge-store';
import {
    createKnowledgeIndexGateway,
    createLocalKnowledgeIndexAdapter,
    getKnowledgeIndexCatalog,
    normalizeKnowledgeIndexSettings,
    toStoredKnowledgeIndexSettings,
    type KnowledgeIndexSettings
} from '../../features/knowledge/knowledge-index';
import { registerKnowledgeIpc } from '../ipc/knowledge-ipc';
import { registerKnowledgeIndexIpc } from '../ipc/knowledge-index-ipc';
import { registerObservabilityIpc, type AiabObservabilityResponse } from '../ipc/observability-ipc';
import {
    getNormalizedKnowledgeIndexSettings,
    getNormalizedMcpRegistry,
    getNormalizedObservabilitySettings,
    getNormalizedSupportAccessGrants,
    saveObservabilitySettings,
    type AppStore
} from '../store';
import type { ActivityLogEntry } from '../types';
import { createAiabObservabilityRuntime } from './aiab-observability-runtime';

interface KnowledgeRuntimeDependencies {
    store: AppStore;
    getAppPath: (name: 'userData' | 'downloads') => string;
    getCurrentOperatorName: () => string;
    getClientOwnerName: () => string;
    getCurrentSystemId: () => string | undefined;
    protectSecret: (value: string) => string;
    recordActivity: (entry: Omit<ActivityLogEntry, 'id' | 'timestamp'>) => void;
    showSaveDialog: (options: SaveDialogOptions) => Promise<SaveDialogReturnValue>;
    getAiAssistantSettings: () => AiAssistantSettings;
    getAiAvailability: () => Promise<AiAssistantAvailability>;
}

function activityCategory(entry: Omit<ActivityLogEntry, 'id' | 'timestamp'>) {
    const message = entry.message.toLowerCase();
    if (message.includes('mcp')) return 'mcp';
    if (message.includes('knowledge') || message.includes('index')) return 'ingestion';
    if (message.includes('action') || message.includes('claim') || message.includes('handoff')) return 'action';
    if (message.includes('approval') || message.includes('approve')) return 'approval';
    if (message.includes('export')) return 'export';
    if (message.includes('purge') || message.includes('delete')) return 'purge';
    if (message.includes('failed') || entry.level === 'error') return 'failure';
    return 'system';
}

/** Owns the shared knowledge index, access context, telemetry, and their IPC wiring. */
export function createKnowledgeRuntime(dependencies: KnowledgeRuntimeDependencies) {
    const { store, getCurrentOperatorName, getClientOwnerName, getCurrentSystemId, protectSecret } = dependencies;
    const knowledgeStore = createKnowledgeStore(() => dependencies.getAppPath('userData'));
    const localKnowledgeIndex = createLocalKnowledgeIndexAdapter(knowledgeStore);
    let knowledgeIndexGateway = createKnowledgeIndexGateway({
        local: localKnowledgeIndex,
        config: getNormalizedKnowledgeIndexSettings(store)
    });

    async function getKnowledgeIndexSettings() {
        const stored = getNormalizedKnowledgeIndexSettings(store);
        return {
            success: true,
            settings: normalizeKnowledgeIndexSettings(stored),
            catalog: getKnowledgeIndexCatalog(),
            health: await knowledgeIndexGateway.health()
        };
    }

    async function saveKnowledgeIndexSettings(candidate: unknown) {
        const next = normalizeKnowledgeIndexSettings(candidate);
        if (next.backend !== 'local') {
            return {
                success: false,
                settings: normalizeKnowledgeIndexSettings(getNormalizedKnowledgeIndexSettings(store)),
                error: `${next.backend} is not installed yet. Keep Local lexical index selected until an approved adapter is available.`
            };
        }

        const previous = getNormalizedKnowledgeIndexSettings(store);
        const stored = toStoredKnowledgeIndexSettings(
            candidate as Partial<KnowledgeIndexSettings> & { apiKey?: string },
            previous,
            protectSecret
        );
        store.set('knowledgeIndexSettings', stored);
        knowledgeIndexGateway = createKnowledgeIndexGateway({ local: localKnowledgeIndex, config: stored });
        return getKnowledgeIndexSettings();
    }

    function getKnowledgeAccessContext(): KnowledgeAccessContext {
        const operatorId = getCurrentOperatorName();
        const systemScope = getCurrentSystemId() || '';
        const owner = isClientOwner(operatorId, getClientOwnerName());
        const grant = owner
            ? undefined
            : getEffectiveSupportAccessGrant(getNormalizedSupportAccessGrants(store), operatorId, systemScope);
        return {
            customerScope: owner ? 'local' : grant?.organizationId || '',
            systemScope,
            operatorId,
            operatorPermissions: owner ? ['read', 'investigate', 'execute'] : grant?.permissions || [],
            identity: owner ? 'local-owner' : 'delegated',
            grant: grant ? toKnowledgeGrantSnapshot(grant) : undefined
        };
    }

    const aiabObservabilityRuntime = createAiabObservabilityRuntime({
        userDataPath: dependencies.getAppPath('userData'),
        getSettings: () => getNormalizedObservabilitySettings(store),
        getScope: () => {
            const context = getKnowledgeAccessContext();
            return { customerScope: context.customerScope, systemScope: context.systemScope, operatorId: context.operatorId };
        }
    });

    function recordOperationalActivity(entry: Omit<ActivityLogEntry, 'id' | 'timestamp'>) {
        dependencies.recordActivity(entry);
        const outcome = entry.level === 'error' ? 'failure' : entry.level === 'warning' ? 'warning' : 'success';
        aiabObservabilityRuntime.recordAudit(activityCategory(entry), entry.message, outcome, { area: entry.area });
    }

    async function getModelStatus(): Promise<AiabObservabilityResponse['model']> {
        const settings = dependencies.getAiAssistantSettings();
        const availability = await dependencies.getAiAvailability();
        return {
            enabled: settings.enabled,
            provider: availability.providerLabel,
            model: availability.selectedModel || settings.model || 'None selected',
            state: !settings.enabled ? 'disabled' : availability.healthy ? 'ready' : 'unavailable',
            message: availability.message
        };
    }

    function getMcpStatus(): AiabObservabilityResponse['mcp'] {
        const records = getNormalizedMcpRegistry(store).records;
        const enabled = records.filter((record) => record.status === 'enabled');
        const degraded = enabled.filter((record) => record.health.state !== 'ready');
        return {
            installed: records.length,
            enabled: enabled.length,
            ready: enabled.length - degraded.length,
            degraded: degraded.length,
            reasons: degraded.slice(0, 8).map((record) => `${record.manifest.name}: ${record.health.message}`)
        };
    }

    function registerIpc() {
        registerKnowledgeIpc({
            getStore: () => knowledgeStore,
            getIndexGateway: () => knowledgeIndexGateway,
            getAccessContext: getKnowledgeAccessContext,
            recordActivity: recordOperationalActivity,
            recordObservability: {
                audit: aiabObservabilityRuntime.recordAudit
            },
            showSaveDialog: dependencies.showSaveDialog,
            getDownloadsPath: () => dependencies.getAppPath('downloads')
        });

        registerKnowledgeIndexIpc({
            getSettings: getKnowledgeIndexSettings,
            saveSettings: saveKnowledgeIndexSettings,
            testConnection: () => knowledgeIndexGateway.health()
        });

        registerObservabilityIpc({
            getAccessContext: getKnowledgeAccessContext,
            getRuntime: () => aiabObservabilityRuntime,
            getKnowledgeStats: () => {
                const { customerScope, systemScope } = getKnowledgeAccessContext();
                return knowledgeIndexGateway.stats({ customerScope, systemScope });
            },
            getModelStatus,
            getMcpStatus,
            getSettings: () => getNormalizedObservabilitySettings(store),
            saveSettings: (candidate) => saveObservabilitySettings(store, candidate),
            showSaveDialog: dependencies.showSaveDialog,
            getDownloadsPath: () => dependencies.getAppPath('downloads')
        });
    }

    return {
        getAccessContext: getKnowledgeAccessContext,
        // Resolve the current gateway at call time so saved settings reach every consumer.
        getIndexGateway: () => knowledgeIndexGateway,
        recordActivity: recordOperationalActivity,
        recordMetric: aiabObservabilityRuntime.recordMetric,
        recordAudit: aiabObservabilityRuntime.recordAudit,
        flush: aiabObservabilityRuntime.flush,
        registerIpc
    };
}
