import { describe, expect, it } from 'vitest';
import {
    DEFAULT_MCP_REGISTRY,
    MCP_AVAILABLE_MANIFESTS,
    checkMcpCapability,
    configureMcpCapability,
    getMcpRegistryView,
    installMcpCapability,
    normalizeMcpRegistryState,
    revokeMcpCapability,
    setMcpCapabilityEnabled,
    validateMcpManifest
} from './mcp-registry';

const now = '2026-09-14T10:00:00.000Z';

describe('MCP skills registry', () => {
    it('rejects malformed, incompatible, or credential-bearing manifests', () => {
        expect(validateMcpManifest({ ...MCP_AVAILABLE_MANIFESTS[1], version: 'v1' }).valid).toBe(false);
        expect(validateMcpManifest({ ...MCP_AVAILABLE_MANIFESTS[1], requiredPermissions: ['admin'] }).valid).toBe(false);
        expect(validateMcpManifest({ ...MCP_AVAILABLE_MANIFESTS[1], apiKey: 'secret' }).valid).toBe(false);
    });

    it('shows installed and available capabilities with their scope and health metadata', () => {
        const view = getMcpRegistryView(DEFAULT_MCP_REGISTRY);
        expect(view.installed[0]).toMatchObject({ manifest: { id: 'ibmi-monitoring', scopes: ['customer', 'system', 'jobs'] }, status: 'enabled' });
        expect(view.available.map((manifest) => manifest.id)).toEqual(['ibmi-runbook-review', 'imonitor-local-mcp']);
    });

    it('requires an explicit enable before a safe read-only check succeeds', () => {
        const installed = installMcpCapability(DEFAULT_MCP_REGISTRY, MCP_AVAILABLE_MANIFESTS[1], 'operator-a', now);
        expect(installed.records[installed.records.length - 1]?.status).toBe('disabled');
        const disabledCheck = checkMcpCapability(installed, 'ibmi-runbook-review', now);
        expect(disabledCheck.health.state).toBe('failed');
        const enabled = setMcpCapabilityEnabled(installed, 'ibmi-runbook-review', true);
        expect(checkMcpCapability(enabled, 'ibmi-runbook-review', now).health.state).toBe('ready');
    });

    it('validates configuration and makes revoked capabilities irreversible', () => {
        const installed = installMcpCapability(DEFAULT_MCP_REGISTRY, MCP_AVAILABLE_MANIFESTS[2], 'operator-a', now);
        expect(() => configureMcpCapability(installed, 'imonitor-local-mcp', 'http://unsafe.local', now)).not.toThrow();
        const revoked = revokeMcpCapability(installed, 'imonitor-local-mcp', now);
        expect(revoked.records[revoked.records.length - 1]).toMatchObject({ status: 'revoked', health: { state: 'revoked' } });
        expect(() => setMcpCapabilityEnabled(revoked, 'imonitor-local-mcp', true)).toThrow('Revoked');
    });

    it('drops invalid persisted records during normalization', () => {
        const normalized = normalizeMcpRegistryState({ records: [{ manifest: { bad: true }, status: 'enabled' }] });
        expect(normalized.records).toEqual([]);
    });
});
