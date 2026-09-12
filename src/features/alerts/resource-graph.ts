import type { ActiveJobRecord } from '../../services/ibmi';
import { getJobKey, getJobTitle } from '../monitoring/monitoring-model';
import type { MonitorAlert } from './alert-model';

export type ResourceNodeKind = 'incident' | 'job' | 'queue' | 'subsystem' | 'message' | 'lock-owner';
export type ResourceRelationship = 'raises' | 'runs-in' | 'uses-queue' | 'waits-on' | 'blocked-by';
export type ResourceEvidenceKind = 'alert' | 'job-poll' | 'job-context';

export interface ResourceGraphEvidence {
    kind: ResourceEvidenceKind;
    label: string;
    observedAt: string;
}

export interface ResourceGraphNode {
    id: string;
    label: string;
    kind: ResourceNodeKind;
    detail?: string;
    evidence: ResourceGraphEvidence[];
}

export interface ResourceGraphEdge {
    id: string;
    from: string;
    to: string;
    relationship: ResourceRelationship;
    confidence: 'observed';
    evidence: ResourceGraphEvidence[];
}

export interface ResourceGraph {
    schema: 'imonitor-resource-graph';
    version: 1;
    observedAt: string;
    stale: boolean;
    nodes: ResourceGraphNode[];
    edges: ResourceGraphEdge[];
    notes: string[];
}

export interface BuildResourceGraphInput {
    job: ActiveJobRecord;
    alert?: MonitorAlert | null;
    context?: {
        jobInfo?: Record<string, unknown> | null;
        jobQueue?: Record<string, unknown> | null;
        subsystem?: Record<string, unknown> | null;
    };
    observedAt: string;
    now?: string;
    staleAfterMs?: number;
    maxNodes?: number;
}

const DEFAULT_STALE_AFTER_MS = 90_000;
const DEFAULT_MAX_NODES = 100;

/** Builds bounded, evidence-backed resource links for one selected job. */
export function buildResourceGraph(input: BuildResourceGraphInput): ResourceGraph {
    const observedAt = validDate(input.observedAt) ? input.observedAt : new Date().toISOString();
    const now = validDate(input.now || observedAt) ? input.now || observedAt : observedAt;
    const maxNodes = Math.max(1, Math.floor(input.maxNodes || DEFAULT_MAX_NODES));
    const nodes: ResourceGraphNode[] = [];
    const edges: ResourceGraphEdge[] = [];
    const notes: string[] = [];

    const addNode = (node: ResourceGraphNode) => {
        if (nodes.some((candidate) => candidate.id === node.id) || nodes.length >= maxNodes) return;
        nodes.push(node);
    };
    const evidence = (kind: ResourceEvidenceKind, label: string): ResourceGraphEvidence => ({ kind, label, observedAt });
    const addEdge = (from: string, to: string, relationship: ResourceRelationship, detail: ResourceGraphEvidence) => {
        if (!nodes.some((node) => node.id === from) || !nodes.some((node) => node.id === to)) return;
        const id = `${from}|${to}|${relationship}`;
        if (edges.some((edge) => edge.id === id)) return;
        edges.push({ id, from, to, relationship, confidence: 'observed', evidence: [detail] });
    };

    const jobId = `job:${getJobKey(input.job)}`;
    const jobEvidence = evidence('job-poll', `Job state ${String(input.job.STATUS || 'unknown')}`);
    addNode({ id: jobId, label: getJobTitle(input.job), kind: 'job', detail: String(input.job.STATUS || 'unknown'), evidence: [jobEvidence] });

    if (input.alert) {
        const incidentId = `incident:${input.alert.incidentId || input.alert.id}`;
        const alertEvidence = evidence('alert', input.alert.title || input.alert.kind);
        addNode({ id: incidentId, label: input.alert.title || 'Incident', kind: 'incident', detail: input.alert.message, evidence: [alertEvidence] });
        addEdge(incidentId, jobId, 'raises', alertEvidence);
    }

    const context = input.context || {};
    const jobRecord = input.job as unknown as Record<string, unknown>;
    const queueName = firstValue(context.jobInfo?.JOB_QUEUE_NAME, jobRecord.JOB_QUEUE_NAME);
    const queueLibrary = firstValue(context.jobInfo?.JOB_QUEUE_LIBRARY, jobRecord.JOB_QUEUE_LIBRARY) || 'QGPL';
    if (queueName) {
        const queueId = `queue:${queueLibrary}/${queueName}`;
        const queueEvidence = evidence('job-context', `Job queue ${queueLibrary}/${queueName}`);
        addNode({ id: queueId, label: `${queueLibrary}/${queueName}`, kind: 'queue', evidence: [queueEvidence] });
        addEdge(jobId, queueId, 'uses-queue', queueEvidence);
    }

    const subsystemName = firstValue(context.jobInfo?.JOB_SUBSYSTEM, input.job.SUBSYSTEM);
    const subsystemLibrary = firstValue(context.jobInfo?.SUBSYSTEM_DESCRIPTION_LIBRARY, input.job.SUBSYSTEM_LIBRARY_NAME) || 'QSYS';
    if (subsystemName) {
        const subsystemId = `subsystem:${subsystemLibrary}/${subsystemName}`;
        const subsystemEvidence = evidence('job-context', `Subsystem ${subsystemLibrary}/${subsystemName}`);
        addNode({ id: subsystemId, label: `${subsystemLibrary}/${subsystemName}`, kind: 'subsystem', evidence: [subsystemEvidence] });
        addEdge(jobId, subsystemId, 'runs-in', subsystemEvidence);
    }

    if (input.job.STATUS === 'MSGW') {
        const messageId = `message:${getJobKey(input.job)}`;
        const messageEvidence = evidence('job-poll', 'Job status MSGW');
        addNode({ id: messageId, label: 'Message reply required', kind: 'message', evidence: [messageEvidence] });
        addEdge(jobId, messageId, 'waits-on', messageEvidence);
    }

    if (input.job.STATUS === 'LCKW') {
        const lockOwner = findLockOwner(input.job, context.jobInfo);
        if (lockOwner) {
            const lockOwnerId = `lock-owner:${lockOwner}`;
            const lockEvidence = evidence('job-context', `Lock owner ${lockOwner}`);
            addNode({ id: lockOwnerId, label: lockOwner, kind: 'lock-owner', evidence: [lockEvidence] });
            addEdge(jobId, lockOwnerId, 'blocked-by', lockEvidence);
        } else {
            notes.push('Lock wait detected, but IBM i did not return a lock-owner job in the available context.');
        }
    }

    const staleAfterMs = Math.max(0, input.staleAfterMs ?? DEFAULT_STALE_AFTER_MS);
    const stale = Date.parse(now) - Date.parse(observedAt) > staleAfterMs;
    if (stale) notes.push('The relationship evidence is older than the current freshness window. Refresh before acting.');
    if (!edges.length) notes.push('No observed resource relationship was returned for this job.');

    return { schema: 'imonitor-resource-graph', version: 1, observedAt, stale, nodes, edges, notes };
}

function firstValue(...values: unknown[]) {
    return values.map((value) => String(value ?? '').trim()).find(Boolean) || '';
}

function findLockOwner(job: ActiveJobRecord, context?: Record<string, unknown> | null) {
    const value = firstValue(
        context?.LOCK_OWNER_JOB,
        context?.LOCK_OWNER_JOB_NAME,
        context?.BLOCKING_JOB,
        context?.BLOCKED_BY_JOB,
        (job as unknown as Record<string, unknown>).LOCK_OWNER_JOB,
        (job as unknown as Record<string, unknown>).LOCK_OWNER_JOB_NAME,
        (job as unknown as Record<string, unknown>).BLOCKING_JOB
    );
    return value && value !== getJobKey(job) ? value : '';
}

function validDate(value: string | undefined): value is string {
    if (!value) return false;
    return !Number.isNaN(Date.parse(value));
}
