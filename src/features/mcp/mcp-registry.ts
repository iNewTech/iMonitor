/** Customer-controlled registry for reusable AI skills and MCP connections. */

export type McpCapabilityKind = 'skill' | 'mcp-connection';
export type McpTransport = 'local' | 'stdio' | 'sse' | 'streamable-http';
export type McpCapabilityClass = 'read-only' | 'action';
export type McpApprovalClass = 'client' | 'operator' | 'system';
export type McpCapabilityStatus = 'enabled' | 'disabled' | 'revoked';
export type McpHealthState = 'unknown' | 'ready' | 'failed' | 'revoked';

export interface McpManifest {
    kind: McpCapabilityKind;
    id: string;
    name: string;
    version: string;
    owner: string;
    provider: string;
    transport: McpTransport;
    scopes: string[];
    capabilityClass: McpCapabilityClass;
    requiredPermissions: string[];
    approvalClass: McpApprovalClass;
    tools: string[];
    resources: string[];
    prompts: string[];
    schemas: Record<string, string>;
    evidenceRequirements: string[];
    limits: { maxCallsPerMinute: number; maxResults: number };
    enabled: boolean;
}

export interface McpCapabilityRecord {
    manifest: McpManifest;
    status: McpCapabilityStatus;
    configuration: { endpoint?: string; configuredAt?: string };
    health: { state: McpHealthState; message: string; checkedAt?: string };
    activity: { action: string; at: string };
    installedAt: string;
    installedBy: string;
}

export interface McpRegistryState {
    schemaVersion: 1;
    records: McpCapabilityRecord[];
}

export interface McpRegistryView {
    installed: McpCapabilityRecord[];
    available: McpManifest[];
}

export interface McpValidationResult<T> {
    valid: boolean;
    errors: string[];
    value?: T;
}

const ID = /^[a-z][a-z0-9._-]{2,80}$/;
const VERSION = /^\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?$/i;
const SECRET = /(password|passphrase|secret|token|api[_-]?key|authorization|credential)/i;
const PERMISSIONS = ['read', 'investigate', 'execute'];
const KINDS: McpCapabilityKind[] = ['skill', 'mcp-connection'];
const TRANSPORTS: McpTransport[] = ['local', 'stdio', 'sse', 'streamable-http'];
const CAPABILITY_CLASSES: McpCapabilityClass[] = ['read-only', 'action'];
const APPROVAL_CLASSES: McpApprovalClass[] = ['client', 'operator', 'system'];
const STATUSES: McpCapabilityStatus[] = ['enabled', 'disabled', 'revoked'];

function text(value: unknown, name: string, max: number, errors: string[]) {
    if (typeof value !== 'string' || !value.trim()) {
        errors.push(`${name} is required.`);
        return '';
    }
    const normalized = value.trim();
    if (normalized.length > max) errors.push(`${name} exceeds ${max} characters.`);
    if (/[^\u0020-\u007e\n\t]/u.test(normalized)) errors.push(`${name} contains unsupported characters.`);
    return normalized;
}

function list(value: unknown, name: string, maxItems: number, errors: string[], required = false) {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
        errors.push(`${name} must be a list of names.`);
        return [];
    }
    const result = Array.from(new Set(value.map((item) => String(item).trim()).filter(Boolean))).slice(0, maxItems);
    if (required && !result.length) errors.push(`${name} must contain at least one item.`);
    if (value.length > maxItems) errors.push(`${name} exceeds ${maxItems} items.`);
    return result;
}

function schemas(value: unknown, errors: string[]) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        errors.push('schemas must be a name-to-schema map.');
        return {};
    }
    const result: Record<string, string> = {};
    Object.entries(value).slice(0, 50).forEach(([key, schema]) => {
        if (!ID.test(key) || typeof schema !== 'string' || !schema.trim() || schema.length > 2_000) {
            errors.push(`schemas.${key} is invalid.`);
            return;
        }
        result[key] = schema.trim();
    });
    return result;
}

/** Validates a complete manifest before it can be installed or enabled. */
export function validateMcpManifest(candidate: unknown): McpValidationResult<McpManifest> {
    const errors: string[] = [];
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return { valid: false, errors: ['MCP manifest must be an object.'] };
    const value = candidate as Record<string, unknown>;
    const kind = value.kind as McpCapabilityKind;
    const transport = value.transport as McpTransport;
    const capabilityClass = value.capabilityClass as McpCapabilityClass;
    const approvalClass = value.approvalClass as McpApprovalClass;
    if (!KINDS.includes(kind)) errors.push('kind is invalid.');
    if (!TRANSPORTS.includes(transport)) errors.push('transport is invalid.');
    if (!CAPABILITY_CLASSES.includes(capabilityClass)) errors.push('capabilityClass is invalid.');
    if (!APPROVAL_CLASSES.includes(approvalClass)) errors.push('approvalClass is invalid.');
    const id = text(value.id, 'id', 80, errors);
    if (id && !ID.test(id)) errors.push('id must be a lowercase identifier.');
    const version = text(value.version, 'version', 40, errors);
    if (version && !VERSION.test(version)) errors.push('version must use semantic versioning.');
    const name = text(value.name, 'name', 120, errors);
    const owner = text(value.owner, 'owner', 120, errors);
    const provider = text(value.provider, 'provider', 120, errors);
    const scopes = list(value.scopes, 'scopes', 20, errors, true);
    const requiredPermissions = list(value.requiredPermissions, 'requiredPermissions', 10, errors, true);
    if (requiredPermissions.some((permission) => !PERMISSIONS.includes(permission))) errors.push('requiredPermissions contains an unsupported permission.');
    const tools = list(value.tools, 'tools', 50, errors);
    const resources = list(value.resources, 'resources', 50, errors);
    const prompts = list(value.prompts, 'prompts', 50, errors);
    const evidenceRequirements = list(value.evidenceRequirements, 'evidenceRequirements', 50, errors);
    const schemaMap = schemas(value.schemas, errors);
    const rawLimits = value.limits && typeof value.limits === 'object' && !Array.isArray(value.limits) ? value.limits as Record<string, unknown> : {};
    const maxCallsPerMinute = Number(rawLimits.maxCallsPerMinute);
    const maxResults = Number(rawLimits.maxResults);
    if (!Number.isInteger(maxCallsPerMinute) || maxCallsPerMinute < 1 || maxCallsPerMinute > 10_000) errors.push('limits.maxCallsPerMinute must be between 1 and 10000.');
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 10_000) errors.push('limits.maxResults must be between 1 and 10000.');
    if (typeof value.enabled !== 'boolean') errors.push('enabled must be boolean.');
    if (SECRET.test(JSON.stringify(candidate))) errors.push('manifest must not contain credential markers.');
    if (errors.length) return { valid: false, errors };
    return {
        valid: true,
        errors: [],
        value: {
            kind, id, name, version, owner, provider, transport, scopes, capabilityClass,
            requiredPermissions, approvalClass, tools, resources, prompts, schemas: schemaMap,
            evidenceRequirements, limits: { maxCallsPerMinute, maxResults }, enabled: Boolean(value.enabled)
        }
    };
}

const BUILT_IN_MANIFESTS: McpManifest[] = [
    {
        kind: 'skill', id: 'ibmi-monitoring', name: 'IBM i Monitoring', version: '1.0.0', owner: 'iMonitor', provider: 'iMonitor', transport: 'local',
        scopes: ['customer', 'system', 'jobs'], capabilityClass: 'read-only', requiredPermissions: ['read'], approvalClass: 'system',
        tools: [], resources: ['ibmi://jobs', 'ibmi://alerts'], prompts: ['job-health-summary'], schemas: { 'job-query': 'qualified job and system scope' },
        evidenceRequirements: ['current polling snapshot'], limits: { maxCallsPerMinute: 120, maxResults: 100 }, enabled: true
    },
    {
        kind: 'skill', id: 'ibmi-runbook-review', name: 'IBM i Runbook Review', version: '1.0.0', owner: 'iMonitor', provider: 'iMonitor', transport: 'local',
        scopes: ['customer', 'system', 'job'], capabilityClass: 'read-only', requiredPermissions: ['read', 'investigate'], approvalClass: 'client',
        tools: [], resources: ['ibmi://runbooks', 'ibmi://resolutions'], prompts: ['incident-review'], schemas: { 'incident-query': 'job, incident, and system scope' },
        evidenceRequirements: ['selected job identity', 'current incident evidence'], limits: { maxCallsPerMinute: 60, maxResults: 50 }, enabled: false
    },
    {
        kind: 'mcp-connection', id: 'imonitor-local-mcp', name: 'iMonitor Local MCP', version: '1.0.0', owner: 'iMonitor', provider: 'iMonitor', transport: 'local',
        scopes: ['customer', 'system'], capabilityClass: 'read-only', requiredPermissions: ['read'], approvalClass: 'operator',
        tools: [], resources: ['imonitor://knowledge'], prompts: ['support-context'], schemas: { 'support-query': 'system and job scope' },
        evidenceRequirements: ['authenticated operator'], limits: { maxCallsPerMinute: 60, maxResults: 50 }, enabled: false
    }
];

export const MCP_AVAILABLE_MANIFESTS = BUILT_IN_MANIFESTS.map((manifest) => ({ ...manifest, scopes: [...manifest.scopes], requiredPermissions: [...manifest.requiredPermissions], tools: [...manifest.tools], resources: [...manifest.resources], prompts: [...manifest.prompts], evidenceRequirements: [...manifest.evidenceRequirements], schemas: { ...manifest.schemas }, limits: { ...manifest.limits } }));

export const DEFAULT_MCP_REGISTRY: McpRegistryState = {
    schemaVersion: 1,
    records: [{
        manifest: { ...MCP_AVAILABLE_MANIFESTS[0], enabled: true }, status: 'enabled', configuration: {},
        health: { state: 'ready', message: 'Built-in monitoring skill is ready.', checkedAt: '2026-01-01T00:00:00.000Z' },
        activity: { action: 'Installed by system.', at: '2026-01-01T00:00:00.000Z' },
        installedAt: '2026-01-01T00:00:00.000Z', installedBy: 'system'
    }]
};

export function normalizeMcpRegistryState(candidate: unknown): McpRegistryState {
    const value = candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate as Record<string, unknown> : {};
    const records = Array.isArray(value.records) ? value.records : [];
    const normalized: McpCapabilityRecord[] = [];
    const seen = new Set<string>();
    records.slice(0, 100).forEach((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return;
        const raw = item as Record<string, unknown>;
        const manifest = validateMcpManifest(raw.manifest);
        if (!manifest.valid || !manifest.value || seen.has(manifest.value.id)) return;
        const status = STATUSES.includes(raw.status as McpCapabilityStatus) ? raw.status as McpCapabilityStatus : 'disabled';
        const healthValue = raw.health && typeof raw.health === 'object' && !Array.isArray(raw.health) ? raw.health as Record<string, unknown> : {};
        const healthState = ['unknown', 'ready', 'failed', 'revoked'].includes(String(healthValue.state)) ? String(healthValue.state) as McpHealthState : 'unknown';
        seen.add(manifest.value.id);
        normalized.push({
            manifest: { ...manifest.value, enabled: status === 'enabled' }, status,
            configuration: { endpoint: typeof (raw.configuration as Record<string, unknown> | undefined)?.endpoint === 'string' ? String((raw.configuration as Record<string, unknown>).endpoint).trim().slice(0, 500) : undefined, configuredAt: typeof (raw.configuration as Record<string, unknown> | undefined)?.configuredAt === 'string' ? String((raw.configuration as Record<string, unknown>).configuredAt) : undefined },
            health: { state: healthState, message: typeof healthValue.message === 'string' ? healthValue.message.trim().slice(0, 240) : 'Health has not been checked.', checkedAt: typeof healthValue.checkedAt === 'string' ? healthValue.checkedAt : undefined },
            activity: { action: typeof (raw.activity as Record<string, unknown> | undefined)?.action === 'string' ? String((raw.activity as Record<string, unknown>).action).trim().slice(0, 160) : 'Loaded from the local registry.', at: typeof (raw.activity as Record<string, unknown> | undefined)?.at === 'string' ? String((raw.activity as Record<string, unknown>).at) : (typeof healthValue.checkedAt === 'string' ? healthValue.checkedAt : new Date(0).toISOString()) },
            installedAt: typeof raw.installedAt === 'string' ? raw.installedAt : new Date(0).toISOString(),
            installedBy: typeof raw.installedBy === 'string' ? raw.installedBy.trim().slice(0, 120) : 'unknown'
        });
    });
    return { schemaVersion: 1, records: normalized };
}

function recordFor(manifest: McpManifest, operatorId: string, now: string): McpCapabilityRecord {
    return {
        manifest: { ...manifest, enabled: false }, status: 'disabled', configuration: {},
        health: { state: 'unknown', message: 'Installed and awaiting operator setup.', checkedAt: now }, activity: { action: 'Installed by operator.', at: now }, installedAt: now, installedBy: operatorId
    };
}

function updateRecord(state: McpRegistryState, id: string, updater: (record: McpCapabilityRecord) => McpCapabilityRecord) {
    let found = false;
    const records = state.records.map((record) => {
        if (record.manifest.id !== id) return record;
        found = true;
        return updater(record);
    });
    if (!found) throw new Error('The selected skill or MCP connection was not found.');
    return { schemaVersion: 1 as const, records };
}

export function installMcpCapability(state: McpRegistryState, candidate: unknown, operatorId: string, now: string) {
    const validation = validateMcpManifest(candidate);
    if (!validation.valid || !validation.value) throw new Error(validation.errors.join(' '));
    if (state.records.some((record) => record.manifest.id === validation.value!.id)) throw new Error('This skill or MCP connection is already installed.');
    return { ...state, records: [...state.records, recordFor(validation.value, operatorId, now)].slice(-100) };
}

export function configureMcpCapability(state: McpRegistryState, id: string, endpoint: string, now: string) {
    const record = state.records.find((item) => item.manifest.id === id);
    if (!record) throw new Error('The selected skill or MCP connection was not found.');
    const value = endpoint.trim().slice(0, 500);
    if (record.manifest.transport !== 'local' && value && !/^https:\/\//i.test(value)) throw new Error('Remote MCP endpoints must use HTTPS.');
    return updateRecord(state, id, (current) => ({ ...current, configuration: { endpoint: value || undefined, configuredAt: now }, health: { state: 'unknown', message: 'Configuration changed; run a safe health check.', checkedAt: now }, activity: { action: 'Configuration saved by operator.', at: now } }));
}

export function setMcpCapabilityEnabled(state: McpRegistryState, id: string, enabled: boolean, now = new Date().toISOString()) {
    return updateRecord(state, id, (record) => {
        if (record.status === 'revoked') throw new Error('Revoked capabilities cannot be enabled again.');
        return { ...record, status: enabled ? 'enabled' : 'disabled', manifest: { ...record.manifest, enabled }, health: enabled ? record.health : { ...record.health, state: 'unknown', message: 'Disabled by the operator.' }, activity: { action: enabled ? 'Enabled by operator.' : 'Disabled by operator.', at: now } };
    });
}

export function revokeMcpCapability(state: McpRegistryState, id: string, now: string) {
    return updateRecord(state, id, (record) => ({ ...record, status: 'revoked', manifest: { ...record.manifest, enabled: false }, health: { state: 'revoked', message: 'Revoked by the operator.', checkedAt: now }, activity: { action: 'Revoked by operator.', at: now } }));
}

/** Checks only a read-only capability; it never invokes an MCP tool or IBM i action. */
export function checkMcpCapability(state: McpRegistryState, id: string, now: string) {
    const record = state.records.find((item) => item.manifest.id === id);
    if (!record) throw new Error('The selected skill or MCP connection was not found.');
    const result = record.status === 'revoked'
        ? { state: 'revoked' as const, message: 'This capability is revoked.' }
        : record.status !== 'enabled'
            ? { state: 'failed' as const, message: 'Enable the capability before running a safe test.' }
            : record.manifest.capabilityClass !== 'read-only'
                ? { state: 'failed' as const, message: 'Write-capable tools require the controlled action gateway.' }
                : record.manifest.transport !== 'local' && !record.configuration.endpoint
                    ? { state: 'failed' as const, message: 'Configure an HTTPS endpoint before testing this connection.' }
                    : { state: 'ready' as const, message: 'Safe read-only capability check passed.' };
    return { ...record, health: { ...result, checkedAt: now }, activity: { action: result.state === 'ready' ? 'Safe read-only test passed.' : 'Safe read-only test failed.', at: now } };
}

export function getMcpRegistryView(state: McpRegistryState): McpRegistryView {
    const installedIds = new Set(state.records.map((record) => record.manifest.id));
    return {
        installed: state.records.map((record) => ({ ...record, manifest: { ...record.manifest }, configuration: { ...record.configuration }, health: { ...record.health }, activity: { ...record.activity } })),
        available: MCP_AVAILABLE_MANIFESTS.filter((manifest) => !installedIds.has(manifest.id)).map((manifest) => ({ ...manifest, scopes: [...manifest.scopes], requiredPermissions: [...manifest.requiredPermissions], tools: [...manifest.tools], resources: [...manifest.resources], prompts: [...manifest.prompts], evidenceRequirements: [...manifest.evidenceRequirements], schemas: { ...manifest.schemas }, limits: { ...manifest.limits } }))
    };
}
