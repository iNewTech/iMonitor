import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_MCP_REGISTRY, MCP_AVAILABLE_MANIFESTS, installMcpCapability, setMcpCapabilityEnabled } from './mcp-registry';
import { createMcpActionGateway } from './mcp-actions';

const now = '2026-09-14T10:00:00.000Z';
const context = {
    customerScope: 'customer-a', systemScope: 'system-a', operatorId: 'operator-a',
    operatorPermissions: ['read', 'investigate', 'execute'], identity: 'local-owner' as const, now
};

function enabledActionRegistry() {
    const manifest = MCP_AVAILABLE_MANIFESTS.find((item) => item.id === 'ibmi-job-control')!;
    const installed = installMcpCapability(DEFAULT_MCP_REGISTRY, manifest, 'operator-a', now);
    return setMcpCapabilityEnabled(installed, manifest.id, true, now);
}

function gateway(overrides: Partial<Parameters<typeof createMcpActionGateway>[0]> = {}) {
    return createMcpActionGateway({
        getAccessContext: () => context,
        getActionContext: () => ({ evidence: { capturedAt: now, current: true, summary: 'Current job evidence.' } }),
        execute: vi.fn(async () => ({ output: 'Executed safely.' })),
        verify: vi.fn(async () => ({ status: 'recovered' as const, summary: 'Recovery verified.', evidence: ['Status changed.'] })),
        ...overrides
    });
}

describe('controlled MCP action gateway', () => {
    it('lists disabled actions and makes them available only after explicit enablement', () => {
        const manifest = MCP_AVAILABLE_MANIFESTS.find((item) => item.id === 'ibmi-job-control')!;
        const readOnly = gateway();
        const disabled = readOnly.list(setMcpCapabilityEnabled(
            installMcpCapability(DEFAULT_MCP_REGISTRY, manifest, 'operator-a', now), manifest.id, false, now
        ), '123/USER/JOB');
        expect(disabled.find((item) => item.tool === 'hold-job')).toMatchObject({ available: false, reason: 'Enable in Settings' });
        const enabled = readOnly.list(enabledActionRegistry(), '123/USER/JOB');
        expect(enabled.find((item) => item.tool === 'hold-job')).toMatchObject({ available: true, capabilityId: manifest.id, riskClass: 'medium' });
    });

    it('creates a scoped preview without executing and requires explicit approval', async () => {
        const execute = vi.fn(async () => ({ output: 'should not run yet' }));
        const actions = gateway({ execute });
        const preview = await actions.preview(enabledActionRegistry(), { capabilityId: 'ibmi-job-control', tool: 'hold-job', jobName: '123/USER/JOB' });
        expect(preview).toMatchObject({ success: true, preview: { state: 'awaiting-approval', approval: { status: 'pending' }, jobName: '123/USER/JOB' } });
        expect(execute).not.toHaveBeenCalled();
        const denied = await actions.approveAndExecute(enabledActionRegistry(), preview.preview!.previewId, false);
        expect(denied.error).toContain('Explicit operator approval');
        expect(execute).not.toHaveBeenCalled();
    });

    it('rechecks scope and evidence, runs once, and verifies successful recovery', async () => {
        const execute = vi.fn(async () => ({ output: 'held' }));
        const verify = vi.fn(async () => ({ status: 'recovered' as const, summary: 'Hold verified.', evidence: ['Job status: HELD'] }));
        const actions = gateway({ execute, verify });
        const preview = await actions.preview(enabledActionRegistry(), { capabilityId: 'ibmi-job-control', tool: 'hold-job', jobName: '123/USER/JOB' });
        const result = await actions.approveAndExecute(enabledActionRegistry(), preview.preview!.previewId, true);
        expect(result).toMatchObject({ success: true, preview: { state: 'recovered', approval: { status: 'approved' } }, verification: { status: 'recovered' } });
        expect(execute).toHaveBeenCalledOnce();
        expect(verify).toHaveBeenCalledOnce();
        const replay = await actions.approveAndExecute(enabledActionRegistry(), preview.preview!.previewId, true);
        expect(replay.error).toContain('already submitted');
    });

    it('fails closed for stale evidence and a capability revoked after preview', async () => {
        const stale = gateway({ getActionContext: () => ({ evidence: { capturedAt: '2026-09-14T09:00:00.000Z', current: false, summary: 'Stale evidence.' } }) });
        const blocked = await stale.preview(enabledActionRegistry(), { capabilityId: 'ibmi-job-control', tool: 'hold-job', jobName: '123/USER/JOB' });
        expect(blocked).toMatchObject({ success: false, error: expect.stringContaining('stale') });

        const actions = gateway();
        const preview = await actions.preview(enabledActionRegistry(), { capabilityId: 'ibmi-job-control', tool: 'hold-job', jobName: '123/USER/JOB' });
        const revoked = { ...enabledActionRegistry(), records: enabledActionRegistry().records.map((record) => record.manifest.id === 'ibmi-job-control' ? { ...record, status: 'revoked' as const } : record) };
        const result = await actions.approveAndExecute(revoked, preview.preview!.previewId, true);
        expect(result).toMatchObject({ success: false, error: expect.stringContaining('revoked'), preview: { state: 'blocked' } });
    });

    it('blocks execution when the operator scope changes after preview', async () => {
        let current = context;
        const actions = createMcpActionGateway({
            getAccessContext: () => current,
            getActionContext: () => ({ evidence: { capturedAt: now, current: true, summary: 'Current job evidence.' } }),
            execute: vi.fn(async () => ({ output: 'should not run' })),
            verify: vi.fn(async () => ({ status: 'recovered' as const, summary: 'Recovered.', evidence: [] }))
        });
        const preview = await actions.preview(enabledActionRegistry(), { capabilityId: 'ibmi-job-control', tool: 'hold-job', jobName: '123/USER/JOB' });
        current = { ...context, operatorId: 'operator-b' };
        const result = await actions.approveAndExecute(enabledActionRegistry(), preview.preview!.previewId, true);
        expect(result).toMatchObject({ success: false, error: expect.stringContaining('scope changed'), preview: { state: 'blocked' } });
    });

    it('marks failed verification and timeout as visible non-success states', async () => {
        const failed = gateway({ verify: vi.fn(async () => ({ status: 'failed' as const, summary: 'Job remains blocked.', evidence: ['Status: MSGW'] })) });
        const failedPreview = await failed.preview(enabledActionRegistry(), { capabilityId: 'ibmi-job-control', tool: 'hold-job', jobName: '123/USER/JOB' });
        const failedResult = await failed.approveAndExecute(enabledActionRegistry(), failedPreview.preview!.previewId, true);
        expect(failedResult).toMatchObject({ success: false, preview: { state: 'failed' }, verification: { status: 'failed' } });

        const timeout = gateway({ execute: () => new Promise(() => undefined) });
        const timeoutPreview = await timeout.preview(enabledActionRegistry(), { capabilityId: 'ibmi-job-control', tool: 'hold-job', jobName: '123/USER/JOB', timeoutMs: 5 });
        const timeoutResult = await timeout.approveAndExecute(enabledActionRegistry(), timeoutPreview.preview!.previewId, true);
        expect(timeoutResult).toMatchObject({ success: false, preview: { state: 'unknown' }, verification: { status: 'unknown' } });
    });
});
