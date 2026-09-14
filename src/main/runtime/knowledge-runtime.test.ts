import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { acceptSupportAccessGrant, createSupportAccessGrant } from '../../features/action-board/support-access';
import { normalizeAiAssistantSettings, type AiAssistantAvailability } from '../../features/ibmeyeai/ai-model';
import { authorizeKnowledgeRead } from '../../features/knowledge/knowledge-access';
import { DEFAULT_MCP_REGISTRY, setMcpCapabilityEnabled } from '../../features/mcp/mcp-registry';
import type { AppStore } from '../store';
import { createKnowledgeRuntime } from './knowledge-runtime';

const handlers = vi.hoisted(() => new Map<string, (...args: any[]) => any>());
const telemetry = vi.hoisted(() => ({
    recordAudit: vi.fn(), recordMetric: vi.fn(), flush: vi.fn(async () => {}),
    getSnapshot: vi.fn(async () => ({ state: 'degraded', degradedReasons: ['Persistence unavailable'] }))
}));
vi.mock('electron/main', () => ({ ipcMain: { handle: (channel: string, callback: (...args: any[]) => any) => handlers.set(channel, callback) } }));
vi.mock('electron-store', () => ({ default: class {} }));
// Persistence has its own runtime tests; this suite exercises composition through real IPC handlers.
vi.mock('./aiab-observability-runtime', () => ({ createAiabObservabilityRuntime: () => telemetry }));

const directories: string[] = [];
beforeEach(() => { handlers.clear(); vi.clearAllMocks(); });
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))); });

async function setup() {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'imonitor-knowledge-runtime-'));
    directories.push(directory);
    const values: Record<string, unknown> = { mcpRegistry: DEFAULT_MCP_REGISTRY };
    const store = {
        get: (key: string) => values[key],
        set: (key: string, value: unknown) => { values[key] = value; }
    } as unknown as AppStore;
    const session = { operator: 'owner', system: 'system-a' as string | undefined };
    const settings = normalizeAiAssistantSettings({ enabled: false, provider: 'ollama', model: 'configured-model' });
    const availability: AiAssistantAvailability = {
        enabled: true, provider: 'ollama', providerLabel: 'Ollama', providerFamily: 'ollama', endpoint: '',
        selectedModel: null, availableModels: [], healthy: false, featureAccess: 'included', message: 'Provider unavailable'
    };
    const recordActivity = vi.fn();
    const runtime = createKnowledgeRuntime({
        store, getAppPath: () => directory,
        getCurrentOperatorName: () => session.operator, getClientOwnerName: () => 'owner',
        getCurrentSystemId: () => session.system, protectSecret: (value) => `protected:${value}`,
        recordActivity, showSaveDialog: async () => ({ canceled: true, filePath: '' }),
        getAiAssistantSettings: () => settings, getAiAvailability: async () => availability
    });
    runtime.registerIpc();
    const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)!(undefined, ...args);
    return { runtime, values, session, settings, availability, recordActivity, invoke };
}

describe('knowledge runtime composition', () => {
    it('preserves local-owner scope and re-evaluates delegated grants after revocation or a system change', async () => {
        const { runtime, session, values } = await setup();
        expect(runtime.getAccessContext()).toMatchObject({
            customerScope: 'local', systemScope: 'system-a', operatorId: 'owner',
            identity: 'local-owner', operatorPermissions: ['read', 'investigate', 'execute']
        });
        const grant = createSupportAccessGrant({
            id: 'grant-1', organizationId: 'customer-a', operatorId: 'support', displayName: 'Support', systemIds: ['system-a'],
            permissions: ['read', 'investigate'], createdBy: 'owner', expiresAt: '2099-01-01T00:00:00.000Z'
        });
        const grants = { [grant.id]: grant };
        acceptSupportAccessGrant(grants, grant.id, 'support');
        values.supportAccessGrants = grants;
        session.operator = 'support';
        expect(runtime.getAccessContext()).toMatchObject({ customerScope: 'customer-a', identity: 'delegated', grant: { status: 'active' } });
        expect(authorizeKnowledgeRead(runtime.getAccessContext()).allowed).toBe(true);
        session.system = 'system-b';
        expect(authorizeKnowledgeRead(runtime.getAccessContext()).allowed).toBe(false);
        session.system = 'system-a';
        grants[grant.id].status = 'revoked';
        expect(authorizeKnowledgeRead(runtime.getAccessContext()).allowed).toBe(false);
        session.operator = 'owner';
        session.system = undefined;
        expect(runtime.getAccessContext().customerScope).toBe('local');
        expect(authorizeKnowledgeRead(runtime.getAccessContext()).allowed).toBe(false);
    });

    it('keeps stored knowledge searchable after replacing the index settings for all consumers', async () => {
        const { runtime, invoke } = await setup();
        const added = await invoke('add-knowledge-source', {
            sourceName: 'Night batch', sourceType: 'runbook', fileName: 'night.md', content: 'Check MSGW before releasing the night job.'
        });
        expect(added.success).toBe(true);
        const saved = await invoke('save-knowledge-index-settings', { backend: 'local', collection: 'updated-index' });
        expect(saved.success).toBe(true);
        expect(runtime.getIndexGateway().settings.collection).toBe('updated-index');
        const direct = await runtime.getIndexGateway().search({ customerScope: 'local', systemScope: 'system-a', query: 'MSGW' }, runtime.getAccessContext());
        expect(direct.records).toHaveLength(1);
        expect((await invoke('search-knowledge', 'MSGW')).records).toHaveLength(1);
        expect((await invoke('get-aiab-observability')).knowledge.local.recordCount).toBe(1);
    });

    it('protects saved keys, retains them on a masked save, and rejects unavailable backends without replacing the gateway', async () => {
        const { runtime, values, invoke } = await setup();
        const saved = await invoke('save-knowledge-index-settings', { backend: 'local', collection: 'local-index', apiKey: 'provider-secret' });
        expect(saved.settings.apiKeyConfigured).toBe(true);
        expect(JSON.stringify(saved)).not.toContain('provider-secret');
        expect(values.knowledgeIndexSettings).toMatchObject({ encryptedApiKey: 'protected:provider-secret' });
        await invoke('save-knowledge-index-settings', { backend: 'local', collection: 'local-index' });
        expect(values.knowledgeIndexSettings).toMatchObject({ encryptedApiKey: 'protected:provider-secret' });
        const gateway = runtime.getIndexGateway();
        const rejected = await invoke('save-knowledge-index-settings', { backend: 'qdrant', collection: 'external-index' });
        expect(rejected).toMatchObject({ success: false, settings: { backend: 'local', collection: 'local-index' } });
        expect(runtime.getIndexGateway()).toBe(gateway);
        expect((await invoke('test-knowledge-index-connection')).success).toBe(true);
    });

    it('reports current provider and MCP settings and preserves degraded telemetry from the runtime', async () => {
        const { invoke, values, settings, availability } = await setup();
        const disabled = await invoke('get-aiab-observability');
        expect(disabled.model).toMatchObject({ state: 'disabled', model: 'configured-model' });
        expect(disabled.snapshot).toEqual({ state: 'degraded', degradedReasons: ['Persistence unavailable'] });
        settings.enabled = true;
        expect((await invoke('get-aiab-observability')).model.state).toBe('unavailable');
        availability.healthy = true;
        availability.selectedModel = 'discovered-model';
        values.mcpRegistry = setMcpCapabilityEnabled(DEFAULT_MCP_REGISTRY, 'ibmi-monitoring', false, new Date().toISOString());
        const ready = await invoke('get-aiab-observability');
        expect(ready.model).toMatchObject({ state: 'ready', model: 'discovered-model' });
        expect(ready.mcp).toMatchObject({ installed: 1, enabled: 0, ready: 0, degraded: 0, reasons: [] });
    });

    it('retains activity logging while forwarding audit and metric events without activity detail', async () => {
        const { runtime, recordActivity } = await setup();
        const entry = { area: 'monitoring' as const, level: 'warning' as const, message: 'MCP read failed.', detail: 'operator-only detail' };
        runtime.recordActivity(entry);
        expect(recordActivity).toHaveBeenCalledWith(entry);
        expect(telemetry.recordAudit).toHaveBeenCalledWith('mcp', entry.message, 'warning', { area: 'monitoring' });
        runtime.recordMetric('mcp_latency_ms', 12, { operation: 'read' });
        expect(telemetry.recordMetric).toHaveBeenCalledWith('mcp_latency_ms', 12, { operation: 'read' });
    });
});
