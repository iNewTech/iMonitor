import { ipcMain } from 'electron/main';
import { authorizeKnowledgeRead, type KnowledgeAccessContext } from '../../features/knowledge/knowledge-access';
import {
    checkMcpCapability,
    configureMcpCapability,
    getMcpRegistryView,
    installMcpCapability,
    revokeMcpCapability,
    setMcpCapabilityEnabled,
    type McpRegistryState
} from '../../features/mcp/mcp-registry';

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
    recordActivity: (entry: ActivityEntry) => void;
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
}
