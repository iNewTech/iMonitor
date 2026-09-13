import { describe, expect, it } from 'vitest';
import { DEFAULT_MCP_REGISTRY, MCP_AVAILABLE_MANIFESTS, installMcpCapability, setMcpCapabilityEnabled } from './mcp-registry';
import { MCP_RESOURCE_LIMITS, readMcpResource, type McpResourceItem } from './mcp-resources';

const now = new Date('2026-09-14T10:00:00.000Z');
const context = { customerScope: 'customer-a', systemScope: 'system-a', operatorId: 'operator-a', operatorPermissions: ['read', 'investigate'], identity: 'local-owner' as const };
const item = (overrides: Partial<McpResourceItem> = {}): McpResourceItem => ({
    id: 'job-1', title: 'Current job', content: 'QBATCH/ORDER is running.', observedAt: now.toISOString(),
    sourceRef: { kind: 'job', id: 'job-1', locator: 'ibmi://system-a/job-1' }, ...overrides
});

describe('scoped MCP resources', () => {
    it('returns bounded provenance and scope for an enabled local resource', async () => {
        const result = await readMcpResource(DEFAULT_MCP_REGISTRY, context, { capabilityId: 'ibmi-monitoring', kind: 'resource', name: 'ibmi://jobs/current', jobName: 'QBATCH/ORDER' }, { getItems: () => [item()] }, now);
        expect(result).toMatchObject({ success: true, name: 'ibmi://jobs/current', scope: { customerScope: context.customerScope, systemScope: context.systemScope, jobName: 'QBATCH/ORDER' } });
        expect(result.items[0]).toMatchObject({ id: 'job-1', provenance: { freshness: 'current', redactionState: 'verified-clean', sourceRef: item().sourceRef } });
    });

    it('uses the investigation policy and denies cross-scope operators', async () => {
        const denied = await readMcpResource(DEFAULT_MCP_REGISTRY, { ...context, systemScope: 'system-b', identity: 'delegated', grant: { organizationId: context.customerScope, operatorId: context.operatorId, systemIds: ['system-a'], permissions: ['read', 'investigate'], status: 'active', expiresAt: '2026-09-15T10:00:00.000Z' } }, { capabilityId: 'ibmi-monitoring', kind: 'resource', name: 'ibmi://jobs/current' }, { getItems: () => [item()] }, now);
        expect(denied.success).toBe(false);
        expect(denied.items).toEqual([]);
    });

    it('marks stale evidence and redacts credential-shaped content', async () => {
        const result = await readMcpResource(DEFAULT_MCP_REGISTRY, context, { capabilityId: 'ibmi-monitoring', kind: 'resource', name: 'ibmi://jobs/current' }, { getItems: () => [item({ observedAt: '2026-09-13T10:00:00.000Z', content: 'token=abc123 CPU=80%' })] }, now);
        expect(result.items[0]).toMatchObject({ content: 'token=[REDACTED] CPU=80%', provenance: { freshness: 'stale', redactionState: 'redacted' } });
    });

    it('rejects oversized input and limits oversized output', async () => {
        const tooLarge = await readMcpResource(DEFAULT_MCP_REGISTRY, context, { capabilityId: 'ibmi-monitoring', kind: 'resource', name: 'ibmi://jobs/current', input: 'x'.repeat(MCP_RESOURCE_LIMITS.maxInputCharacters + 1) }, { getItems: () => [item()] }, now);
        expect(tooLarge.error).toContain('limited');
        const bounded = await readMcpResource(DEFAULT_MCP_REGISTRY, context, { capabilityId: 'ibmi-monitoring', kind: 'resource', name: 'ibmi://jobs/current' }, { getItems: () => Array.from({ length: 60 }, (_, index) => item({ id: `job-${index}`, content: 'x'.repeat(2_000) })) }, now);
        expect(bounded.success).toBe(true);
        expect(bounded.truncated).toBe(true);
        expect(JSON.stringify(bounded.items).length).toBeLessThanOrEqual(MCP_RESOURCE_LIMITS.maxOutputCharacters);
    });

    it('handles timeout, cancellation, malformed data, and disabled or remote capabilities safely', async () => {
        const slow = readMcpResource(DEFAULT_MCP_REGISTRY, context, { capabilityId: 'ibmi-monitoring', kind: 'resource', name: 'ibmi://jobs/current', timeoutMs: 100 }, { getItems: async () => new Promise<McpResourceItem[]>((resolve) => setTimeout(() => resolve([item()]), 250)) }, now);
        expect((await slow).error).toContain('timed out');
        const controller = new AbortController();
        controller.abort();
        const cancelled = await readMcpResource(DEFAULT_MCP_REGISTRY, context, { capabilityId: 'ibmi-monitoring', kind: 'resource', name: 'ibmi://jobs/current', signal: controller.signal }, { getItems: () => [item()] }, now);
        expect(cancelled.error).toContain('cancelled');
        const malformed = await readMcpResource(DEFAULT_MCP_REGISTRY, context, { capabilityId: 'ibmi-monitoring', kind: 'resource', name: 'ibmi://jobs/current' }, { getItems: () => 'bad' as unknown as McpResourceItem[] }, now);
        expect(malformed.success).toBe(true);
        expect(malformed.items).toEqual([]);
        const disabledState = setMcpCapabilityEnabled(DEFAULT_MCP_REGISTRY, 'ibmi-monitoring', false, now.toISOString());
        expect((await readMcpResource(disabledState, context, { capabilityId: 'ibmi-monitoring', kind: 'resource', name: 'ibmi://jobs/current' }, { getItems: () => [item()] }, now)).error).toContain('Enable');
        const remoteManifest = { ...MCP_AVAILABLE_MANIFESTS[2], id: 'remote-mcp', transport: 'sse' as const };
        const remoteState = setMcpCapabilityEnabled(installMcpCapability(DEFAULT_MCP_REGISTRY, remoteManifest, 'operator-a', now.toISOString()), 'remote-mcp', true, now.toISOString());
        expect((await readMcpResource(remoteState, context, { capabilityId: 'remote-mcp', kind: 'resource', name: 'imonitor://knowledge' }, { getItems: () => [item()] }, now)).error).toContain('Remote');
    });
});
