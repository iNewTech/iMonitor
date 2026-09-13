import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = vi.hoisted(() => new Map<string, (...args: any[]) => any>());
vi.mock('electron/main', () => ({ ipcMain: { handle: (channel: string, callback: (...args: any[]) => any) => handlers.set(channel, callback) } }));

import { DEFAULT_MCP_REGISTRY, MCP_AVAILABLE_MANIFESTS, installMcpCapability, setMcpCapabilityEnabled } from '../../features/mcp/mcp-registry';
import type { ActionAuditEntry } from '../../features/action-board/action-audit';
import { registerMcpIpc } from './mcp-ipc';

const now = '2026-09-14T10:00:00.000Z';
const context = {
    customerScope: 'customer-a', systemScope: 'system-a', operatorId: 'operator-a',
    operatorPermissions: ['read', 'investigate', 'execute'], identity: 'local-owner' as const, now
};

function registry() {
    const manifest = MCP_AVAILABLE_MANIFESTS.find((item) => item.id === 'ibmi-job-control')!;
    return setMcpCapabilityEnabled(installMcpCapability(DEFAULT_MCP_REGISTRY, manifest, 'operator-a', now), manifest.id, true, now);
}

let state = registry();
let activity: Array<Record<string, unknown>> = [];
let audit: ActionAuditEntry[] = [];

beforeEach(() => {
    handlers.clear();
    state = registry();
    activity = [];
    audit = [];
    registerMcpIpc({
        getRegistry: () => state,
        saveRegistry: (candidate) => state = candidate as typeof state,
        getAccessContext: () => context,
        getResourceItems: () => [],
        getActionContext: () => ({ evidence: { capturedAt: now, current: true, summary: 'Current job evidence.' } }),
        executeMcpAction: vi.fn(async () => ({ output: 'executed' })),
        verifyMcpAction: vi.fn(async () => ({ status: 'recovered' as const, summary: 'Recovered.', evidence: ['Current state verified.'] })),
        recordActivity: (entry) => activity.push(entry),
        recordActionAudit: (entry) => audit.push(entry)
    });
});

describe('MCP action IPC', () => {
    it('returns a job-scoped preview and blocks missing approval without running a command', async () => {
        const preview = await handlers.get('preview-mcp-action')!(null, { capabilityId: 'ibmi-job-control', tool: 'hold-job', jobName: '123/USER/JOB' });
        expect(preview).toMatchObject({ success: true, preview: { state: 'awaiting-approval', approval: { status: 'pending' }, scope: { systemScope: 'system-a' } } });
        const result = await handlers.get('run-mcp-action')!(null, { previewId: preview.preview.previewId, approved: false });
        expect(result.success).toBe(false);
        expect(result.error).toContain('approval');
        expect(audit).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'mcp:hold-job', result: 'failure' })]));
    });

    it('executes only after approval and records a sanitized audit trail', async () => {
        const preview = await handlers.get('preview-mcp-action')!(null, { capabilityId: 'ibmi-job-control', tool: 'end-job', jobName: '123/USER/JOB', input: { endOption: 'controlled' } });
        const result = await handlers.get('run-mcp-action')!(null, { previewId: preview.preview.previewId, approved: true });
        expect(result).toMatchObject({ success: true, preview: { state: 'recovered', approval: { status: 'approved' } }, verification: { status: 'recovered' } });
        expect(audit).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'mcp:end-job', result: 'success', detail: expect.stringContaining('inputHash=') })]));
        expect(audit[1]?.detail).not.toContain('controlled');
    });

    it('rejects credential shaped input before the action gateway is reached', async () => {
        const result = await handlers.get('preview-mcp-action')!(null, { capabilityId: 'ibmi-job-control', tool: 'hold-job', jobName: '123/USER/JOB', input: { token: 'secret' } });
        expect(result).toMatchObject({ success: false, error: expect.stringContaining('Credentials') });
    });
});
