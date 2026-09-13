import { authorizeKnowledgeRead, type KnowledgeAccessContext } from '../knowledge/knowledge-access';
import { redactSensitiveText } from '../knowledge/knowledge-ingestion';
import type { McpCapabilityRecord, McpRegistryState } from './mcp-registry';

export const MCP_RESOURCE_LIMITS = {
    maxInputCharacters: 500,
    maxOutputCharacters: 16_000,
    maxItems: 50,
    defaultTimeoutMs: 1_200,
    maxTimeoutMs: 3_000
} as const;

export type McpRequestKind = 'resource' | 'prompt';
export type McpResourceFreshness = 'current' | 'stale' | 'unknown';

export interface McpResourceRequest {
    capabilityId: string;
    kind: McpRequestKind;
    name: string;
    input?: string;
    jobName?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
}

export interface McpResourceItem {
    id: string;
    title: string;
    content: string;
    observedAt: string;
    sourceRef: { kind: 'job' | 'incident' | 'record'; id: string; locator: string };
    freshness?: McpResourceFreshness;
}

export interface McpResourceOutputItem {
    id: string;
    title: string;
    content: string;
    provenance: {
        sourceRef: { kind: string; id: string; locator: string };
        observedAt: string;
        freshness: McpResourceFreshness;
        redactionState: 'redacted' | 'verified-clean';
    };
}

export interface McpResourceResponse {
    success: boolean;
    requestId: string;
    kind?: McpRequestKind;
    name?: string;
    items: McpResourceOutputItem[];
    scope?: { customerScope: string; systemScope: string; jobName?: string };
    truncated?: boolean;
    error?: string;
}

export interface McpResourceDependencies {
    getItems: (request: { name: string; kind: McpRequestKind; input: string; jobName?: string; scope: { customerScope: string; systemScope: string } }) => Promise<McpResourceItem[]> | McpResourceItem[];
}

function requestId() {
    return `mcp-read-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function safeText(value: unknown, max: number) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function safeError(value: unknown) {
    const message = value instanceof Error ? value.message : 'MCP read failed.';
    return redactSensitiveText(message).replace(/[\r\n]+/g, ' ').slice(0, 240);
}

function freshness(value: string | undefined, now: number) {
    if (!value || Number.isNaN(Date.parse(value))) return 'unknown' as const;
    return now - Date.parse(value) <= 5 * 60 * 1000 ? 'current' as const : 'stale' as const;
}

function capabilityFor(state: McpRegistryState, id: string) {
    return state.records.find((record) => record.manifest.id === id);
}

function denied(requestIdValue: string, error: string): McpResourceResponse {
    return { success: false, requestId: requestIdValue, items: [], error };
}

function hasName(capability: McpCapabilityRecord, request: McpResourceRequest) {
    const names = request.kind === 'resource' ? capability.manifest.resources : capability.manifest.prompts;
    return names.includes(request.name);
}

function boundedItems(items: McpResourceItem[], now: number) {
    let truncated = items.length > MCP_RESOURCE_LIMITS.maxItems;
    const output = items.slice(0, MCP_RESOURCE_LIMITS.maxItems).map((item) => {
        const content = redactSensitiveText(safeText(item.content, MCP_RESOURCE_LIMITS.maxOutputCharacters));
        return {
            id: safeText(item.id, 240),
            title: redactSensitiveText(safeText(item.title, 240)),
            content,
            provenance: {
                sourceRef: {
                    kind: safeText(item.sourceRef?.kind, 40),
                    id: safeText(item.sourceRef?.id, 240),
                    locator: safeText(item.sourceRef?.locator, 500)
                },
                observedAt: safeText(item.observedAt, 40),
                freshness: item.freshness || freshness(item.observedAt, now),
                redactionState: content !== safeText(item.content, MCP_RESOURCE_LIMITS.maxOutputCharacters) ? 'redacted' as const : 'verified-clean' as const
            }
        } satisfies McpResourceOutputItem;
    });
    while (JSON.stringify(output).length > MCP_RESOURCE_LIMITS.maxOutputCharacters && output.length) {
        output.pop();
        truncated = true;
    }
    return { output, truncated };
}

async function withDeadline<T>(operation: () => Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) throw new Error('MCP read cancelled.');
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abortHandler: (() => void) | undefined;
    const cancellation = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('MCP read timed out.')), timeoutMs);
        abortHandler = () => reject(new Error('MCP read cancelled.'));
        signal?.addEventListener('abort', abortHandler, { once: true });
    });
    try {
        return await Promise.race([operation(), cancellation]);
    } finally {
        if (timer) clearTimeout(timer);
        if (abortHandler) signal?.removeEventListener('abort', abortHandler);
    }
}

/** Reads only approved, local, read-only resources through the same access context as RAG. */
export async function readMcpResource(
    state: McpRegistryState,
    context: KnowledgeAccessContext,
    request: McpResourceRequest,
    dependencies: McpResourceDependencies,
    now = new Date()
): Promise<McpResourceResponse> {
    const id = requestId();
    const capability = capabilityFor(state, safeText(request.capabilityId, 80));
    if (!capability) return denied(id, 'The selected MCP capability is not installed.');
    if (capability.status === 'revoked') return denied(id, 'This MCP capability is revoked.');
    if (capability.status !== 'enabled' || !capability.manifest.enabled) return denied(id, 'Enable this capability before reading its resources.');
    if (capability.manifest.capabilityClass !== 'read-only') return denied(id, 'Only read-only capabilities can be tested here.');
    if (capability.manifest.transport !== 'local') return denied(id, 'Remote MCP transport is unavailable until customer authentication is configured.');
    const kind = request.kind === 'prompt' ? 'prompt' : 'resource';
    const name = safeText(request.name, 240);
    if (!name || !hasName(capability, { ...request, kind, name })) return denied(id, 'This capability does not expose the requested resource or prompt.');
    const input = safeText(request.input, MCP_RESOURCE_LIMITS.maxInputCharacters);
    if (typeof request.input === 'string' && request.input.length > MCP_RESOURCE_LIMITS.maxInputCharacters) return denied(id, `Read input is limited to ${MCP_RESOURCE_LIMITS.maxInputCharacters} characters.`);
    if (/(password|passphrase|secret|token|api[_-]?key|authorization|credential)\s*[:=]/i.test(input)) return denied(id, 'Read input cannot contain credential values.');
    const requiredPermission = capability.manifest.requiredPermissions.includes('investigate') ? 'investigate' : 'read';
    const access = authorizeKnowledgeRead(context, requiredPermission, now.toISOString());
    if (!access.allowed) return denied(id, access.reason || 'MCP resource access is denied.');
    const timeoutMs = Math.min(Math.max(Number(request.timeoutMs) || MCP_RESOURCE_LIMITS.defaultTimeoutMs, 100), MCP_RESOURCE_LIMITS.maxTimeoutMs);
    try {
        const items = await withDeadline(() => Promise.resolve(dependencies.getItems({ name, kind, input, jobName: safeText(request.jobName, 240) || undefined, scope: { customerScope: context.customerScope, systemScope: context.systemScope } })), timeoutMs, request.signal);
        const bounded = boundedItems(Array.isArray(items) ? items : [], now.getTime());
        return {
            success: true, requestId: id, kind, name, items: bounded.output, truncated: bounded.truncated,
            scope: { customerScope: context.customerScope, systemScope: context.systemScope, jobName: safeText(request.jobName, 240) || undefined }
        };
    } catch (error) {
        return denied(id, safeError(error));
    }
}
