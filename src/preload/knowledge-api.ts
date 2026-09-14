// Type-only contracts: the unbundled, sandboxed preload cannot require local modules.
type Result<Payload> = Promise<{ success: boolean; error?: string } & Payload>;
type Records = Array<Record<string, unknown>>;
type KnowledgeRecords = { records: Records; excluded: Array<{ recordId: string; reason: string }> };
type KnowledgeStats = { stats?: Record<string, unknown> };
type KnowledgeDeletion = KnowledgeStats & { deletedCount?: number };
type ExportResult = { canceled?: boolean; filePath?: string };
type ConfirmedPurge = { before: string; confirmed: boolean };
type PurgeContext = { customerScope: string; systemScope: string; operatorId: string; identity: 'local-owner' | 'delegated' };

export interface KnowledgeApi {
    getKnowledgeLibrary: () => Result<KnowledgeRecords & KnowledgeStats>;
    searchKnowledge: (query: string, limit?: number) => Result<KnowledgeRecords>;
    getKnowledgeRecord: (recordId: string) => Result<{ record?: Record<string, unknown>; history?: Records }>;
    addKnowledgeSource: (payload: {
        sourceName: string;
        sourceType?: 'incident' | 'evidence' | 'job' | 'runbook' | 'resolution' | 'object-analysis' | 'operator-guide' | 'integration-history';
        fileName?: string;
        content: string;
    }) => Result<KnowledgeStats & { result?: Record<string, unknown> }>;
    deleteKnowledgeRecord: (recordId: string) => Result<KnowledgeDeletion>;
    reindexKnowledge: () => Result<KnowledgeStats>;
    getKnowledgeStats: () => Result<KnowledgeStats>;
    purgeKnowledge: (payload: ConfirmedPurge) => Result<KnowledgeDeletion & { expectedContext?: PurgeContext }>;
    exportKnowledge: () => Result<ExportResult & { recordCount?: number }>;
}

type ObservabilitySettings = { retentionDays: number; maxEvents: number };

export interface AiabObservabilityApi {
    getAiabObservability: () => Result<{
        snapshot?: Record<string, unknown>;
        knowledge?: Record<string, unknown>;
        model?: Record<string, unknown>;
        mcp?: Record<string, unknown>;
        settings?: ObservabilitySettings;
    }>;
    saveAiabObservabilitySettings: (settings: { retentionDays: number }) => Result<{ settings?: ObservabilitySettings }>;
    purgeAiabObservability: (payload: ConfirmedPurge & { expectedContext?: PurgeContext }) => Result<{ deletedCount?: number }>;
    exportAiabObservability: () => Result<ExportResult>;
}

type KnowledgeIndexHealth = {
    backend: string;
    state: string;
    message: string;
    checkedAt: string;
    fallbackUsed?: boolean;
};
type KnowledgeIndexSettingsResult = Result<{
    settings?: { backend: string; endpoint: string; collection: string; apiKeyConfigured: boolean };
    catalog?: Array<{ backend: string; label: string; description: string; available: boolean }>;
    health?: KnowledgeIndexHealth;
}>;

export interface KnowledgeIndexApi {
    getKnowledgeIndexSettings: () => KnowledgeIndexSettingsResult;
    saveKnowledgeIndexSettings: (settings: { backend: string; endpoint: string; collection: string; apiKey?: string }) => KnowledgeIndexSettingsResult;
    testKnowledgeIndexConnection: () => Result<{ health?: KnowledgeIndexHealth }>;
}

type McpRegistryResult = Result<{ installed?: Records; available?: Records }>;

export interface McpApi {
    getMcpRegistry: () => McpRegistryResult;
    installMcpCapability: (manifest: Record<string, unknown>) => McpRegistryResult;
    configureMcpCapability: (payload: { id: string; endpoint: string }) => McpRegistryResult;
    setMcpCapabilityEnabled: (payload: { id: string; enabled: boolean }) => McpRegistryResult;
    testMcpCapability: (id: string) => McpRegistryResult;
    revokeMcpCapability: (id: string) => McpRegistryResult;
    readMcpResource: (payload: {
        capabilityId: string;
        kind: 'resource' | 'prompt';
        name: string;
        input?: string;
        jobName?: string;
        timeoutMs?: number;
    }) => Result<{
        requestId: string;
        kind?: 'resource' | 'prompt';
        name?: string;
        items: Records;
        scope?: { customerScope: string; systemScope: string; jobName?: string };
        truncated?: boolean;
    }>;
    getMcpActionCatalog: (jobName: string) => Result<{ actions: Records }>;
    previewMcpAction: (payload: {
        capabilityId: string;
        tool: string;
        jobName: string;
        input?: Record<string, unknown>;
        timeoutMs?: number;
    }) => Result<{ preview?: Record<string, unknown> }>;
    runMcpAction: (payload: { previewId: string; approved: boolean }) => Result<{
        preview?: Record<string, unknown>;
        verification?: Record<string, unknown>;
    }>;
}
