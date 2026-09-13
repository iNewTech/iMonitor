import { createHash } from 'node:crypto';
import { authorizeKnowledgeRead, type KnowledgeAccessContext } from '../knowledge/knowledge-access';
import { createActionLeaseStore } from '../action-board/action-leases';
import { buildMcpActionProposal } from '../action-board/action-planner';
import type { McpActionDefinition, McpCapabilityRecord, McpOperatorActionKind, McpRegistryState } from './mcp-registry';

export const MCP_ACTION_LIMITS = {
    maxInputCharacters: 2_000,
    maxPreviewAgeMs: 2 * 60_000,
    defaultTimeoutMs: 5_000,
    maxTimeoutMs: 10_000
} as const;

export type McpActionState = 'blocked' | 'awaiting-approval' | 'executing' | 'verification-pending' | 'recovered' | 'failed' | 'unknown' | 'expired';

export interface McpActionEvidence {
    capturedAt: string;
    current: boolean;
    summary: string;
}

export interface McpActionExecutionRequest {
    capabilityId: string;
    tool: string;
    jobName: string;
    input: Record<string, unknown>;
    operatorAction: McpOperatorActionKind;
    signal?: AbortSignal;
}

export interface McpActionVerification {
    status: 'recovered' | 'failed' | 'unknown';
    summary: string;
    evidence: string[];
}

export interface McpActionContext {
    evidence: McpActionEvidence;
}

export interface McpActionRequest {
    capabilityId: string;
    tool: string;
    jobName: string;
    input?: Record<string, unknown>;
    timeoutMs?: number;
    signal?: AbortSignal;
}

export interface McpActionPreview {
    schema: 'imonitor-mcp-action-preview';
    version: 1;
    previewId: string;
    capabilityId: string;
    capabilityName: string;
    skillVersion: string;
    tool: string;
    operatorAction: McpOperatorActionKind;
    jobName: string;
    scope: { customerScope: string; systemScope: string; operatorId: string };
    effect: string;
    riskClass: McpActionDefinition['riskClass'];
    requiredPermissions: string[];
    evidenceRequirements: string[];
    evidence: McpActionEvidence;
    inputHash: string;
    verificationRule: string;
    outputSchema: string;
    state: McpActionState;
    createdAt: string;
    expiresAt: string;
    approval: { required: true; status: 'pending' | 'approved' };
    verification?: McpActionVerification;
    output?: string;
}

export interface McpActionResult {
    success: boolean;
    preview?: McpActionPreview;
    verification?: McpActionVerification;
    error?: string;
}

interface GatewayDependencies {
    getAccessContext: () => KnowledgeAccessContext;
    getActionContext: (jobName: string) => Promise<McpActionContext> | McpActionContext;
    execute: (request: McpActionExecutionRequest) => Promise<{ output?: string }>;
    verify: (request: McpActionExecutionRequest) => Promise<McpActionVerification>;
    now?: () => string;
}

interface StoredPreview {
    preview: McpActionPreview;
    request: McpActionRequest & { input: Record<string, unknown> };
    definition: McpActionDefinition;
}

function nowFor(dependencies: GatewayDependencies) {
    return dependencies.now?.() || new Date().toISOString();
}

function safeText(value: unknown, max: number) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function safeError(error: unknown) {
    return safeText(error instanceof Error ? error.message : 'MCP action failed.', 240);
}

function inputValue(input: unknown) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
    return input as Record<string, unknown>;
}

function normalizedInput(input: unknown) {
    const value = inputValue(input);
    const serialized = JSON.stringify(value);
    if (serialized.length > MCP_ACTION_LIMITS.maxInputCharacters) throw new Error('Action input exceeds the safe limit.');
    if (/(password|passphrase|secret|token|api[_-]?key|authorization|credential)/i.test(serialized)) throw new Error('Credentials are not accepted as action input.');
    return value;
}

function hashInput(input: Record<string, unknown>) {
    return createHash('sha256').update(JSON.stringify(input, Object.keys(input).sort())).digest('hex');
}

function capabilityFor(state: McpRegistryState, id: string): McpCapabilityRecord | undefined {
    return state.records.find((record) => record.manifest.id === id);
}

function actionFor(record: McpCapabilityRecord, tool: string) {
    return record.manifest.actionTools.find((action) => action.tool === tool);
}

function actionAccess(context: KnowledgeAccessContext, definition: McpActionDefinition) {
    const required = definition.requiredPermissions.includes('execute') ? 'execute' : definition.requiredPermissions[0] || 'execute';
    return authorizeKnowledgeRead(context, required);
}

function staleEvidence(evidence: McpActionEvidence, now: string) {
    const capturedAt = Date.parse(evidence.capturedAt);
    return !evidence.current || Number.isNaN(capturedAt) || Date.parse(now) - capturedAt > MCP_ACTION_LIMITS.maxPreviewAgeMs;
}

function withDeadline<T>(work: (signal: AbortSignal) => Promise<T>, timeoutMs: number, signal?: AbortSignal) {
    const controller = new AbortController();
    const timeout = Math.max(1, Math.min(timeoutMs || MCP_ACTION_LIMITS.defaultTimeoutMs, MCP_ACTION_LIMITS.maxTimeoutMs));
    if (signal?.aborted) return Promise.reject(new Error('Action cancelled before execution.'));
    return new Promise<T>((resolve, reject) => {
        let settled = false;
        const finish = (callback: typeof resolve | typeof reject, value: T | unknown) => {
            if (settled) return;
            settled = true;
            callback(value as never);
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
        };
        const onAbort = () => {
            controller.abort();
            finish(reject, new Error('Action cancelled during execution.'));
        };
        const timer = setTimeout(() => {
            controller.abort();
            finish(reject, new Error('Action timed out before verification completed.'));
        }, timeout);
        signal?.addEventListener('abort', onAbort, { once: true });
        work(controller.signal).then(
            (value) => finish(resolve, value),
            (error) => finish(reject, error)
        );
    });
}

function buildPreview(
    record: McpCapabilityRecord,
    definition: McpActionDefinition,
    request: McpActionRequest & { input: Record<string, unknown> },
    context: KnowledgeAccessContext,
    evidence: McpActionEvidence,
    now: string
): McpActionPreview {
    const previewId = `mcp-action-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return {
        schema: 'imonitor-mcp-action-preview', version: 1, previewId,
        capabilityId: record.manifest.id, capabilityName: record.manifest.name, skillVersion: record.manifest.version,
        tool: definition.tool, operatorAction: definition.operatorAction, jobName: request.jobName,
        scope: { customerScope: context.customerScope, systemScope: context.systemScope, operatorId: context.operatorId },
        effect: definition.effect, riskClass: definition.riskClass,
        requiredPermissions: definition.requiredPermissions.slice(), evidenceRequirements: definition.evidenceRequirements.slice(),
        evidence: { ...evidence }, inputHash: hashInput(request.input), verificationRule: definition.verificationRule,
        outputSchema: definition.outputSchema, state: 'awaiting-approval', createdAt: now,
        expiresAt: new Date(Date.parse(now) + MCP_ACTION_LIMITS.maxPreviewAgeMs).toISOString(),
        approval: { required: true, status: 'pending' }
    };
}

function updateState(stored: StoredPreview, state: McpActionState, verification?: McpActionVerification, output?: string) {
    stored.preview = { ...stored.preview, state, verification, output: output ? safeText(output, 2_000) : undefined };
    return stored.preview;
}

function blocked(error: string): McpActionResult {
    return { success: false, error };
}

/** Creates a job-scoped preview and keeps the action private until explicit approval. */
export function createMcpActionGateway(dependencies: GatewayDependencies) {
    const previews = new Map<string, StoredPreview>();
    const leases = createActionLeaseStore({ ttlMs: MCP_ACTION_LIMITS.maxTimeoutMs + 1_000 });

    function currentPreview(previewId: string) {
        const stored = previews.get(previewId.trim());
        if (!stored) throw new Error('The action preview is no longer available.');
        const now = nowFor(dependencies);
        if (Date.parse(stored.preview.expiresAt) <= Date.parse(now)) {
            updateState(stored, 'expired');
            throw new Error('The action preview has expired. Refresh the job before approving it.');
        }
        return stored;
    }

    function preflight(state: McpRegistryState, request: McpActionRequest & { input: Record<string, unknown> }, expectedHash?: string) {
        const context = dependencies.getAccessContext();
        const record = capabilityFor(state, request.capabilityId);
        if (!record) return { error: 'The selected MCP capability is not installed.' } as const;
        if (record.status === 'revoked') return { error: 'This MCP capability is revoked.' } as const;
        if (record.status !== 'enabled' || !record.manifest.enabled) return { error: 'Enable this MCP capability before requesting an action.' } as const;
        if (record.manifest.capabilityClass !== 'action' || record.manifest.transport !== 'local') return { error: 'Only enabled local action capabilities may use the controlled gateway.' } as const;
        const definition = actionFor(record, request.tool);
        if (!definition) return { error: 'The requested action tool is not declared by this capability.' } as const;
        const access = actionAccess(context, definition);
        if (!access.allowed) return { error: access.reason || 'The operator is not allowed to run this action.' } as const;
        const actionContext = dependencies.getActionContext(request.jobName);
        return Promise.resolve(actionContext).then((current) => {
            if (!current?.evidence || staleEvidence(current.evidence, nowFor(dependencies))) return { error: 'Current job evidence is stale. Refresh before approving the action.' } as const;
            if (expectedHash && expectedHash !== hashInput(request.input)) return { error: 'The action input changed. Create a new preview.' } as const;
            return { context, record, definition, actionContext: current } as const;
        });
    }

    return {
        list(state: McpRegistryState, jobName: string) {
            const context = dependencies.getAccessContext();
            return state.records.flatMap((record) => record.manifest.actionTools.map((definition) => {
                let reason = '';
                if (record.status === 'revoked') reason = 'Revoked';
                else if (record.status !== 'enabled' || !record.manifest.enabled) reason = 'Enable in Settings';
                else if (record.manifest.transport !== 'local') reason = 'Local gateway required';
                else {
                    const access = actionAccess(context, definition);
                    if (!access.allowed) reason = access.reason || 'Permission required';
                }
                return {
                    capabilityId: record.manifest.id, capabilityName: record.manifest.name, skillVersion: record.manifest.version,
                    tool: definition.tool, label: definition.label, jobName, effect: definition.effect,
                    riskClass: definition.riskClass, requiredPermissions: definition.requiredPermissions.slice(),
                    evidenceRequirements: definition.evidenceRequirements.slice(), verificationRule: definition.verificationRule,
                    available: !reason, reason: reason || undefined,
                    proposal: buildMcpActionProposal({
                        capabilityId: record.manifest.id, capabilityName: record.manifest.name, skillVersion: record.manifest.version,
                        tool: definition.tool, label: definition.label, jobName, effect: definition.effect, riskClass: definition.riskClass,
                        requiredPermissions: definition.requiredPermissions, evidenceRequirements: definition.evidenceRequirements,
                        verificationRule: definition.verificationRule, available: !reason, reason: reason || undefined
                    })
                };
            }));
        },

        async preview(state: McpRegistryState, request: McpActionRequest): Promise<McpActionResult> {
            try {
                const jobName = safeText(request.jobName, 240);
                if (!jobName) return blocked('A current job is required for an MCP action.');
                const input = normalizedInput(request.input);
                const prepared = { ...request, capabilityId: safeText(request.capabilityId, 100), tool: safeText(request.tool, 120), jobName, input };
                const checked = await preflight(state, prepared);
                if ('error' in checked) return blocked(checked.error || 'The action preview was blocked.');
                const now = nowFor(dependencies);
                const preview = buildPreview(checked.record, checked.definition, prepared, checked.context, checked.actionContext.evidence, now);
                previews.set(preview.previewId, { preview, request: prepared, definition: checked.definition });
                return { success: true, preview };
            } catch (error) {
                return blocked(safeError(error));
            }
        },

        async approveAndExecute(state: McpRegistryState, previewId: string, approved: boolean, signal?: AbortSignal): Promise<McpActionResult> {
            let stored: StoredPreview;
            try {
                stored = currentPreview(previewId);
            } catch (error) {
                return blocked(safeError(error));
            }
            if (!approved) return { success: false, preview: stored.preview, error: 'Explicit operator approval is required before execution.' };
            if (stored.preview.state === 'executing' || stored.preview.state === 'verification-pending') return blocked('This action is already in progress.');
            if (stored.preview.state === 'recovered' || stored.preview.state === 'failed' || stored.preview.state === 'unknown') return blocked('This action preview was already submitted. Create a new preview.');

            const checked = await preflight(state, stored.request, stored.preview.inputHash);
            if ('error' in checked) {
                updateState(stored, 'blocked');
                return { success: false, preview: stored.preview, error: checked.error || 'The action was blocked during preflight.' };
            }
            if (checked.context.customerScope !== stored.preview.scope.customerScope
                || checked.context.systemScope !== stored.preview.scope.systemScope
                || checked.context.operatorId !== stored.preview.scope.operatorId) {
                updateState(stored, 'blocked');
                return { success: false, preview: stored.preview, error: 'The operator scope changed. Create a new action preview.' };
            }
            const actionKey = `mcp:${checked.context.systemScope}:${stored.request.jobName}:${stored.definition.tool}`;
            const lease = leases.acquire(actionKey, stored.preview.previewId, checked.context.operatorId);
            if (!lease.granted) return blocked(lease.reason === 'replay' ? 'This MCP action preview was already submitted.' : 'This MCP action is already in progress.');
            const executionRequest: McpActionExecutionRequest = { ...stored.request, operatorAction: stored.definition.operatorAction, signal };
            updateState(stored, 'executing');
            try {
                const result = await withDeadline((deadlineSignal) => dependencies.execute({ ...executionRequest, signal: deadlineSignal }), stored.request.timeoutMs || MCP_ACTION_LIMITS.defaultTimeoutMs, signal);
                updateState(stored, 'verification-pending', undefined, result?.output);
                const verification = await withDeadline((deadlineSignal) => dependencies.verify({ ...executionRequest, signal: deadlineSignal }), stored.request.timeoutMs || MCP_ACTION_LIMITS.defaultTimeoutMs, signal);
                stored.preview.approval = { required: true, status: 'approved' };
                updateState(stored, verification.status, verification, result?.output);
                return { success: verification.status === 'recovered', preview: stored.preview, verification, error: verification.status === 'recovered' ? undefined : verification.summary };
            } catch (error) {
                const message = safeError(error);
                const unknown = /cancel|abort|timed out|timeout/i.test(message) || (signal?.aborted ?? false);
                const verification = { status: unknown ? 'unknown' as const : 'failed' as const, summary: unknown ? 'The action may still be running; verify from the next monitoring poll.' : message, evidence: ['Gateway execution did not produce a verified recovery result.'] };
                stored.preview.approval = { required: true, status: 'approved' };
                updateState(stored, verification.status, verification);
                return { success: false, preview: stored.preview, verification, error: verification.summary };
            } finally {
                leases.complete(lease.lease);
            }
        }
    };
}
