import { ipcMain } from 'electron/main';
import { createActionAuditEntry } from '../../features/action-board/action-audit';
import { authorizeKnowledgeRead, type KnowledgeAccessContext } from '../../features/knowledge/knowledge-access';
import { createMcpActionGateway, type McpActionContext, type McpActionExecutionRequest, type McpActionRequest, type McpActionResult, type McpActionVerification } from '../../features/mcp/mcp-actions';
import { readMcpResource, type McpResourceDependencies, type McpResourceRequest, type McpResourceResponse } from '../../features/mcp/mcp-resources';
import {
    checkMcpCapability,
    configureMcpCapability,
    getMcpRegistryView,
    installMcpCapability,
    revokeMcpCapability,
    setMcpCapabilityEnabled,
    type McpRegistryState
} from '../../features/mcp/mcp-registry';
import type { ObservabilityMetricName } from '../../features/observability/observability-ledger';

type ActivityEntry = {
    area: 'monitoring';
    level: 'info' | 'success' | 'warning' | 'error';
    message: string;
    detail?: string;
};

export interface McpIpcDependencies {
    getRegistry: () => McpRegistryState;
    saveRegistry: (candidate: unknown) => McpRegistryState;
    getAccessContext: () => KnowledgeAccessContext;
    getResourceItems: McpResourceDependencies['getItems'];
    getActionContext: (jobName: string) => Promise<McpActionContext> | McpActionContext;
    executeMcpAction: (request: McpActionExecutionRequest) => Promise<{ output?: string }>;
    verifyMcpAction: (request: McpActionExecutionRequest) => Promise<McpActionVerification>;
    recordActivity: (entry: ActivityEntry) => void;
    recordMetric?: (name: ObservabilityMetricName, value: number, attributes?: Record<string, string | number | boolean>) => void;
    recordActionAudit?: (entry: ReturnType<typeof createActionAuditEntry>) => void;
}

type RegistryResponse = ReturnType<typeof getMcpRegistryView> & { success: boolean; error?: string };

function denied(dependencies: McpIpcDependencies): RegistryResponse | undefined {
    const decision = authorizeKnowledgeRead(dependencies.getAccessContext(), 'investigate');
    if (decision.allowed) return undefined;
    dependencies.recordActivity({ area: 'monitoring', level: 'warning', message: 'Skills and MCP access denied.', detail: decision.reason });
    return { success: false, installed: [], available: [], error: decision.reason || 'Skills and MCP access is not available.' };
}

function success(dependencies: McpIpcDependencies): RegistryResponse {
    return { success: true, ...getMcpRegistryView(dependencies.getRegistry()) };
}

function failure(dependencies: McpIpcDependencies, error: unknown): RegistryResponse {
    const message = error instanceof Error ? error.message : 'Skills and MCP operation failed.';
    dependencies.recordActivity({ area: 'monitoring', level: 'error', message: 'Skills and MCP operation failed.', detail: message });
    return { success: false, installed: [], available: [], error: message };
}

function operatorId(dependencies: McpIpcDependencies) {
    return dependencies.getAccessContext().operatorId || 'operator';
}

/** Registers operator-only registry management; AI IPC never calls these handlers. */
export function registerMcpIpc(dependencies: McpIpcDependencies) {
    const actionGateway = createMcpActionGateway({
        getAccessContext: dependencies.getAccessContext,
        getActionContext: dependencies.getActionContext,
        execute: dependencies.executeMcpAction,
        verify: dependencies.verifyMcpAction
    });

    const recordAction = (result: McpActionResult, phase: string, jobName: string, tool: string) => {
        const preview = result.preview;
        const verification = result.verification;
        const detail = [
            `phase=${phase}`,
            preview ? `skill=${preview.capabilityId}@${preview.skillVersion}` : undefined,
            `tool=${tool}`,
            preview ? `scope=${preview.scope.customerScope}/${preview.scope.systemScope}` : undefined,
            preview ? `inputHash=${preview.inputHash}` : undefined,
            preview ? `approval=${preview.approval.status}` : 'approval=pending',
            preview ? `state=${preview.state}` : undefined,
            verification ? `verification=${verification.status}` : undefined,
            result.error ? `error=${result.error}` : undefined
        ].filter(Boolean).join(' | ');
        dependencies.recordActionAudit?.(createActionAuditEntry({
            operator: preview?.scope.operatorId || dependencies.getAccessContext().operatorId,
            jobName: preview?.jobName || jobName || 'MCP action',
            action: `mcp:${tool}`,
            result: result.success ? 'success' : 'failure',
            detail
        }));
    };

    ipcMain.handle('get-mcp-registry', () => {
        const access = denied(dependencies);
        return access || success(dependencies);
    });

    ipcMain.handle('install-mcp-capability', (_event, manifest: unknown) => {
        const access = denied(dependencies);
        if (access) return access;
        try {
            const registry = installMcpCapability(dependencies.getRegistry(), manifest, operatorId(dependencies), new Date().toISOString());
            dependencies.saveRegistry(registry);
            dependencies.recordActivity({ area: 'monitoring', level: 'success', message: 'Skill or MCP connection installed.' });
            return success(dependencies);
        } catch (error) {
            return failure(dependencies, error);
        }
    });

    ipcMain.handle('configure-mcp-capability', (_event, payload: unknown) => {
        const access = denied(dependencies);
        if (access) return access;
        try {
            const input = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
            const registry = configureMcpCapability(dependencies.getRegistry(), String(input.id || ''), String(input.endpoint || ''), new Date().toISOString());
            dependencies.saveRegistry(registry);
            dependencies.recordActivity({ area: 'monitoring', level: 'success', message: 'Skill or MCP configuration saved.' });
            return success(dependencies);
        } catch (error) {
            return failure(dependencies, error);
        }
    });

    ipcMain.handle('set-mcp-capability-enabled', (_event, payload: unknown) => {
        const access = denied(dependencies);
        if (access) return access;
        try {
            const input = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
            const registry = setMcpCapabilityEnabled(dependencies.getRegistry(), String(input.id || ''), Boolean(input.enabled), new Date().toISOString());
            dependencies.saveRegistry(registry);
            dependencies.recordActivity({ area: 'monitoring', level: 'success', message: Boolean(input.enabled) ? 'Skill or MCP connection enabled.' : 'Skill or MCP connection disabled.' });
            return success(dependencies);
        } catch (error) {
            return failure(dependencies, error);
        }
    });

    ipcMain.handle('test-mcp-capability', (_event, id: unknown) => {
        const access = denied(dependencies);
        if (access) return access;
        try {
            const checked = checkMcpCapability(dependencies.getRegistry(), String(id || ''), new Date().toISOString());
            const registry = dependencies.getRegistry();
            dependencies.saveRegistry({ ...registry, records: registry.records.map((record) => record.manifest.id === checked.manifest.id ? checked : record) });
            dependencies.recordActivity({ area: 'monitoring', level: checked.health.state === 'ready' ? 'success' : 'warning', message: 'Skill or MCP health checked.', detail: checked.health.message });
            return success(dependencies);
        } catch (error) {
            return failure(dependencies, error);
        }
    });

    ipcMain.handle('revoke-mcp-capability', (_event, id: unknown) => {
        const access = denied(dependencies);
        if (access) return access;
        try {
            const registry = revokeMcpCapability(dependencies.getRegistry(), String(id || ''), new Date().toISOString());
            dependencies.saveRegistry(registry);
            dependencies.recordActivity({ area: 'monitoring', level: 'warning', message: 'Skill or MCP connection revoked.' });
            return success(dependencies);
        } catch (error) {
            return failure(dependencies, error);
        }
    });

    ipcMain.handle('read-mcp-resource', async (_event, payload: unknown): Promise<McpResourceResponse> => {
        const startedAt = Date.now();
        const input = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
        const request: McpResourceRequest = {
            capabilityId: String(input.capabilityId || ''),
            kind: input.kind === 'prompt' ? 'prompt' : 'resource',
            name: String(input.name || ''),
            input: typeof input.input === 'string' ? input.input : undefined,
            jobName: typeof input.jobName === 'string' ? input.jobName : undefined,
            timeoutMs: Number(input.timeoutMs) || undefined
        };
        const access = denied(dependencies);
        if (access) return { success: false, requestId: 'mcp-read-denied', items: [], error: access.error };
        const result = await readMcpResource(dependencies.getRegistry(), dependencies.getAccessContext(), request, { getItems: dependencies.getResourceItems });
        dependencies.recordMetric?.('mcp_latency_ms', Date.now() - startedAt, { operation: request.kind, success: result.success });
        dependencies.recordActivity({ area: 'monitoring', level: result.success ? 'info' : 'warning', message: result.success ? 'MCP read-only resource tested.' : 'MCP read-only resource test failed.', detail: result.success ? `${request.kind}=${request.name}` : result.error });
        return result;
    });

    ipcMain.handle('get-mcp-action-catalog', async (_event, jobName: unknown) => {
        const name = typeof jobName === 'string' ? jobName.trim() : '';
        const access = authorizeKnowledgeRead(dependencies.getAccessContext(), 'read');
        if (!access.allowed) return { success: false, actions: [], error: access.reason || 'The operator cannot inspect MCP actions.' };
        try {
            await dependencies.getActionContext(name);
            return { success: true, actions: actionGateway.list(dependencies.getRegistry(), name) };
        } catch (error) {
            return { success: false, actions: [], error: error instanceof Error ? error.message : 'Unable to load MCP actions.' };
        }
    });

    ipcMain.handle('preview-mcp-action', async (_event, payload: unknown) => {
        const startedAt = Date.now();
        const input = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
        const request: McpActionRequest = {
            capabilityId: String(input.capabilityId || ''),
            tool: String(input.tool || ''),
            jobName: String(input.jobName || ''),
            input: input.input && typeof input.input === 'object' && !Array.isArray(input.input) ? input.input as Record<string, unknown> : {},
            timeoutMs: Number(input.timeoutMs) || undefined
        };
        const access = authorizeKnowledgeRead(dependencies.getAccessContext(), 'execute');
        if (!access.allowed) return { success: false, error: access.reason || 'The operator cannot request MCP actions.' };
        const result = await actionGateway.preview(dependencies.getRegistry(), request);
        dependencies.recordMetric?.('mcp_latency_ms', Date.now() - startedAt, { operation: 'preview', success: result.success });
        recordAction(result, 'preview', request.jobName, request.tool);
        return result;
    });

    ipcMain.handle('run-mcp-action', async (_event, payload: unknown) => {
        const startedAt = Date.now();
        const input = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
        const previewId = typeof input.previewId === 'string' ? input.previewId : '';
        const approved = input.approved === true;
        const access = authorizeKnowledgeRead(dependencies.getAccessContext(), 'execute');
        if (!access.allowed) return { success: false, error: access.reason || 'The operator cannot execute MCP actions.' };
        const result = await actionGateway.approveAndExecute(dependencies.getRegistry(), previewId, approved);
        dependencies.recordMetric?.('mcp_latency_ms', Date.now() - startedAt, { operation: 'execute', success: result.success });
        recordAction(result, 'execute', result.preview?.jobName || '', result.preview?.tool || 'unknown');
        return result;
    });
}
