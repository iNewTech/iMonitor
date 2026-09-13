import type { ActiveJobRecord } from '../../services/ibmi';
import type { ResolutionMemoryEntry } from './resolution-memory';
import type { RunbookPolicy } from './runbook-policy';
import type { OperatorActionAvailability, OperatorActionKind } from './operator-actions';

export type ActionProposalSource = 'operator' | 'runbook' | 'rag' | 'mcp';
export type ActionProposalState = 'ready' | 'advisory' | 'blocked';
export type ActionRiskClass = 'low' | 'medium' | 'high' | 'critical' | 'unknown';

export interface ActionProposal {
    schema: 'imonitor-action-proposal';
    version: 1;
    id: string;
    sources: ActionProposalSource[];
    actionKind?: OperatorActionKind;
    capabilityId?: string;
    tool?: string;
    label: string;
    jobName: string;
    state: ActionProposalState;
    reason?: string;
    rationale: string;
    effect: string;
    riskClass: ActionRiskClass;
    requiredPermissions: string[];
    evidenceRequirements: string[];
    verificationRule: string;
    citations: string[];
}

export interface McpActionProposalInput {
    capabilityId: string;
    capabilityName: string;
    skillVersion: string;
    tool: string;
    label: string;
    jobName: string;
    effect: string;
    riskClass: ActionRiskClass;
    requiredPermissions: string[];
    evidenceRequirements: string[];
    verificationRule: string;
    available: boolean;
    reason?: string;
}

export interface ActionPlannerPrimary {
    kind: 'claim' | 'action' | 'review' | 'escalate';
    label: string;
    reason: string;
    proposalId?: string;
}

export interface ActionPlannerSnapshot {
    schema: 'imonitor-action-planner';
    version: 1;
    jobName: string;
    primary: ActionPlannerPrimary | null;
    proposals: ActionProposal[];
    escalationReasons: string[];
}

interface PlannerIncident {
    id: string;
    title: string;
    status: string;
    owner: string;
}

const ACTION_META: Record<OperatorActionKind, { label: string; effect: string; riskClass: ActionRiskClass; evidence: string[]; verification: string }> = {
    replyMessage: {
        label: 'Reply to MSGW', effect: 'Send the approved reply to the current IBM i message wait.', riskClass: 'high',
        evidence: ['current job identity', 'current inquiry message'], verification: 'The next monitoring poll must show that the message wait changed.'
    },
    holdJob: {
        label: 'Hold Job', effect: 'Hold the selected IBM i job.', riskClass: 'medium',
        evidence: ['current job identity', 'current job status'], verification: 'The next monitoring poll must show the requested hold state.'
    },
    releaseJob: {
        label: 'Release Job', effect: 'Release the selected IBM i job.', riskClass: 'medium',
        evidence: ['current job identity', 'current job status'], verification: 'The next monitoring poll must show the requested running state.'
    },
    endJob: {
        label: 'End Job', effect: 'End the selected IBM i job with a controlled end by default.', riskClass: 'high',
        evidence: ['current job identity', 'current job status', 'approved business impact'], verification: 'The next monitoring poll must confirm that the job ended.'
    },
    inspectLocks: {
        label: 'Inspect Locks', effect: 'Inspect the current lock-owner and waiting-job evidence.', riskClass: 'low',
        evidence: ['current job identity', 'lock-owner evidence'], verification: 'The next read must return current lock relationships.'
    }
};

function unique(values: string[]) {
    return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function actionKey(action?: OperatorActionKind, capabilityId?: string, tool?: string) {
    return capabilityId && tool ? `mcp:${capabilityId}:${tool}` : `operator:${action || 'review'}`;
}

function actionKind(value: string): OperatorActionKind | undefined {
    const normalized = value.toLowerCase().replace(/[\s_-]+/g, '');
    const values: Record<string, OperatorActionKind> = {
        replymessage: 'replyMessage', replytomsgw: 'replyMessage',
        holdjob: 'holdJob', releasejob: 'releaseJob', endjob: 'endJob', inspectlocks: 'inspectLocks'
    };
    return values[normalized];
}

function proposalForOperator(action: OperatorActionAvailability, jobName: string): ActionProposal {
    const meta = ACTION_META[action.kind];
    return {
        schema: 'imonitor-action-proposal', version: 1, id: actionKey(action.kind), sources: ['operator'], actionKind: action.kind,
        label: action.label, jobName, state: action.enabled ? 'ready' : 'blocked', reason: action.reason,
        rationale: action.enabled ? 'Available from the current job state.' : 'The current job state does not support this operation.',
        effect: meta.effect, riskClass: meta.riskClass, requiredPermissions: ['execute'], evidenceRequirements: meta.evidence,
        verificationRule: meta.verification, citations: []
    };
}

function mergeProposal(proposals: Map<string, ActionProposal>, proposal: ActionProposal) {
    const key = actionKey(proposal.actionKind, proposal.capabilityId, proposal.tool);
    const previous = proposals.get(key);
    if (!previous) {
        proposals.set(key, proposal);
        return;
    }
    proposals.set(key, {
        ...previous,
        sources: unique([...previous.sources, ...proposal.sources]) as ActionProposalSource[],
        state: previous.state === 'ready' || proposal.state === 'ready' ? 'ready' : previous.state === 'advisory' || proposal.state === 'advisory' ? 'advisory' : 'blocked',
        reason: previous.state === 'ready' ? undefined : proposal.reason || previous.reason,
        rationale: unique([previous.rationale, proposal.rationale]).join(' '),
        requiredPermissions: unique([...previous.requiredPermissions, ...proposal.requiredPermissions]),
        evidenceRequirements: unique([...previous.evidenceRequirements, ...proposal.evidenceRequirements]),
        citations: unique([...previous.citations, ...proposal.citations]),
        verificationRule: proposal.verificationRule || previous.verificationRule,
        effect: proposal.effect || previous.effect,
        riskClass: previous.riskClass === 'critical' || proposal.riskClass === 'critical' ? 'critical' : previous.riskClass === 'high' || proposal.riskClass === 'high' ? 'high' : previous.riskClass
    });
}

export function buildMcpActionProposal(input: McpActionProposalInput): ActionProposal {
    return {
        schema: 'imonitor-action-proposal', version: 1, id: actionKey(undefined, input.capabilityId, input.tool),
        sources: ['mcp'], capabilityId: input.capabilityId, tool: input.tool, label: input.label, jobName: input.jobName,
        state: input.available ? 'ready' : 'blocked', reason: input.reason,
        rationale: input.available ? `Declared by ${input.capabilityName} v${input.skillVersion}.` : input.reason || 'The MCP action is unavailable.',
        effect: input.effect, riskClass: input.riskClass, requiredPermissions: unique(input.requiredPermissions),
        evidenceRequirements: unique(input.evidenceRequirements), verificationRule: input.verificationRule, citations: []
    };
}

function buildRagProposal(entry: ResolutionMemoryEntry, jobName: string): ActionProposal {
    const action = actionKind(entry.successfulAction);
    const meta = action ? ACTION_META[action] : undefined;
    return {
        schema: 'imonitor-action-proposal', version: 1, id: `rag:${entry.id}:v${entry.version}`, sources: ['rag'], actionKind: action,
        label: action && meta ? `Review ${meta.label}` : 'Review approved resolution', jobName, state: 'advisory',
        rationale: `Approved memory matched this job: ${entry.title}.`, effect: action && meta ? meta.effect : 'Review the approved resolution before choosing an action.',
        riskClass: meta?.riskClass || 'unknown', requiredPermissions: action ? ['execute'] : ['investigate'],
        evidenceRequirements: unique(['current job evidence', ...entry.evidenceRefs.slice(0, 3)]),
        verificationRule: entry.verifiedOutcome || 'Verify the current job state after any approved action.', citations: [`runbook:${entry.id}:v${entry.version}`]
    };
}

function primaryFor(input: { incident?: PlannerIncident; runbook?: RunbookPolicy; proposals: ActionProposal[] }): ActionPlannerPrimary | null {
    const runbookTitle = input.runbook?.title || 'verified runbook';
    if (input.incident && input.incident.status !== 'clear' && !input.incident.owner) {
        return { kind: 'claim', label: 'Claim work', reason: 'Assign this incident to the logged-in operator before changing the job.' };
    }
    const runbookAction = input.runbook?.safeActions
        .map((kind) => input.proposals.find((proposal) => proposal.actionKind === kind && proposal.state === 'ready'))
        .find(Boolean);
    if (runbookAction) return { kind: 'action', label: runbookAction.label, reason: `Next step from ${runbookTitle}.`, proposalId: runbookAction.id };
    const ready = input.proposals.find((proposal) => proposal.state === 'ready');
    if (ready) return { kind: 'action', label: ready.label, reason: 'Available from the current job state.', proposalId: ready.id };
    const advisory = input.proposals.find((proposal) => proposal.state === 'advisory');
    if (advisory) return { kind: 'review', label: advisory.label, reason: advisory.rationale, proposalId: advisory.id };
    return input.proposals.length ? { kind: 'escalate', label: 'Review and escalate', reason: 'No supported action is currently available.' } : null;
}

/** Combines live actions, verified runbooks, RAG memories, and MCP tools into one advisory planner. */
export function buildActionPlannerSnapshot(input: {
    job: ActiveJobRecord;
    operatorActions: OperatorActionAvailability[];
    incident?: PlannerIncident;
    runbook?: RunbookPolicy;
    ragResolutions?: ResolutionMemoryEntry[];
    mcpActions?: McpActionProposalInput[];
}): ActionPlannerSnapshot {
    const jobName = String(input.job.JOB_NAME || input.job.SUBSYSTEM_JOB || 'selected job').trim();
    const proposals = new Map<string, ActionProposal>();
    input.operatorActions.forEach((action) => mergeProposal(proposals, proposalForOperator(action, jobName)));
    if (input.runbook) {
        const runbook = input.runbook;
        runbook.safeActions.forEach((kind) => {
            const meta = ACTION_META[kind];
            mergeProposal(proposals, {
                schema: 'imonitor-action-proposal', version: 1, id: actionKey(kind), sources: ['runbook'], actionKind: kind,
                label: meta.label, jobName, state: 'advisory', rationale: `The ${runbook.title} recommends this step.`, effect: meta.effect,
                riskClass: meta.riskClass, requiredPermissions: ['job-action'], evidenceRequirements: runbook.requiredEvidence || meta.evidence,
                verificationRule: runbook.verification || meta.verification, citations: [`runbook:${runbook.id}:v${runbook.version}`]
            });
        });
    }
    (input.ragResolutions || []).filter((entry) => entry.status === 'approved').forEach((entry) => mergeProposal(proposals, buildRagProposal(entry, jobName)));
    (input.mcpActions || []).forEach((action) => mergeProposal(proposals, buildMcpActionProposal(action)));
    const values = Array.from(proposals.values());
    const blocked = values.filter((proposal) => proposal.state === 'blocked').map((proposal) => `${proposal.label}: ${proposal.reason || 'unavailable'}`);
    return {
        schema: 'imonitor-action-planner', version: 1, jobName,
        primary: primaryFor({ incident: input.incident, runbook: input.runbook, proposals: values }),
        proposals: values, escalationReasons: blocked
    };
}
