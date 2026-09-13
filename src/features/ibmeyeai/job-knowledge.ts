import type { MonitorAlert } from '../alerts/alert-model';
import {
    filterContextPack,
    type KnowledgeAccessContext,
    type KnowledgeExclusion
} from '../knowledge/knowledge-access';
import { buildKnowledgeContextPack } from '../knowledge/knowledge-context-pack';
import type { ContextPack, SupportContext } from '../knowledge/knowledge-contract';
import type { KnowledgeIndexGateway, KnowledgeIndexHealth } from '../knowledge/knowledge-index';
import { buildKnowledgeRetrievalQuery, rankKnowledgeRecords } from '../knowledge/knowledge-retrieval';
import type { ActiveJobRecord } from '../../services/ibmi';

export interface JobKnowledgeContextResult {
    supportContext: SupportContext;
    contextPack: ContextPack;
    retrievalHealth: KnowledgeIndexHealth;
}

interface JobKnowledgeContextInput {
    job: ActiveJobRecord;
    alert?: MonitorAlert | null;
    access: KnowledgeAccessContext;
    index: Pick<KnowledgeIndexGateway, 'search' | 'health'>;
    now?: string;
}

const SIGNALS: Partial<Record<MonitorAlert['kind'], string>> = {
    highCpu: 'HIGHCPU',
    messageWait: 'MSGW',
    lockWait: 'LCKW',
    delayWait: 'DLYW',
    dequeueWait: 'DEQW',
    pollFailure: 'POLL'
};

function text(value: unknown, max = 240) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function selectedJobName(job: ActiveJobRecord) {
    return text(job.JOB_NAME || job.SUBSYSTEM_JOB, 240);
}

function supportContextFor(input: JobKnowledgeContextInput): SupportContext {
    const qualifiedName = selectedJobName(input.job);
    const alert = input.alert;
    return {
        customerScope: input.access.customerScope,
        systemScope: input.access.systemScope,
        selectedJob: {
            qualifiedName,
            subsystem: text(input.job.SUBSYSTEM || input.job.SUBSYSTEM_JOB, 160) || undefined,
            user: text(input.job.CURRENT_USER || input.job.JOB_USER, 160) || undefined
        },
        incident: alert
            ? {
                id: text(alert.incidentId || alert.id, 240),
                kind: text(alert.kind, 80) || undefined,
                fingerprint: text(alert.correlation?.fingerprint, 240) || undefined
            }
            : undefined,
        signal: alert ? SIGNALS[alert.kind] : text(input.job.STATUS, 80) || undefined,
        operatorPermissions: input.access.operatorPermissions.slice(0, 20),
        requestedTask: text([alert?.title, alert?.message, alert?.detail].filter(Boolean).join(' '), 500)
            || `Explain the current condition for ${qualifiedName}.`
    };
}

function missingEvidence(noMatchReason: string | undefined, health: KnowledgeIndexHealth): string[] {
    const missing: string[] = [];
    if (noMatchReason === 'no-fresh-match') missing.push('No current matching knowledge was found for this job and incident.');
    else if (noMatchReason === 'no-match') missing.push('No matching knowledge was found for this job and incident.');
    if (health.state !== 'ready') missing.push(`Knowledge retrieval is ${health.state}; verify evidence before relying on it.`);
    return missing;
}

function emptyPack(supportContext: SupportContext, now: string, excluded: KnowledgeExclusion[], health: KnowledgeIndexHealth, reason?: string) {
    return {
        supportContext,
        contextPack: buildKnowledgeContextPack({
            scope: {
                customerScope: supportContext.customerScope,
                systemScope: supportContext.systemScope,
                qualifiedJob: supportContext.selectedJob?.qualifiedName,
                incidentId: supportContext.incident?.id
            },
            matches: [],
            excluded,
            missingEvidence: [reason || 'Knowledge retrieval failed safely; no matching support evidence is available.'],
            now
        }),
        retrievalHealth: health
    } satisfies JobKnowledgeContextResult;
}

/** Retrieves only scoped knowledge for the selected job and returns a bounded support context. */
export async function retrieveJobKnowledgeContext(input: JobKnowledgeContextInput): Promise<JobKnowledgeContextResult> {
    const now = text(input.now || input.access.now, 40) || new Date().toISOString();
    const supportContext = supportContextFor(input);
    const jobName = supportContext.selectedJob?.qualifiedName || 'selected job';
    const alert = input.alert;
    const query = buildKnowledgeRetrievalQuery({
        customerScope: input.access.customerScope,
        systemScope: input.access.systemScope,
        operatorId: input.access.operatorId,
        operatorPermissions: input.access.operatorPermissions,
        query: supportContext.requestedTask,
        qualifiedJob: jobName,
        incidentKind: alert?.kind,
        signal: supportContext.signal,
        objectIdentifiers: [input.job.SUBSYSTEM, input.job.FUNCTION_NAME, input.job.SQL_STATEMENT_TEXT]
            .map((value) => text(value, 240))
            .filter(Boolean),
        runtimeFingerprint: supportContext.incident?.fingerprint,
        limit: 20
    });

    try {
        const result = await input.index.search(query.indexRequest, input.access);
        const health = result.health;
        const retrieval = rankKnowledgeRecords(
            result.records,
            query,
            result.fallbackUsed ? 'lexical' : health.backend === 'local' ? 'lexical' : 'hybrid',
            now
        );
        const pack = buildKnowledgeContextPack({
            scope: {
                customerScope: supportContext.customerScope,
                systemScope: supportContext.systemScope,
                operatorId: input.access.operatorId,
                qualifiedJob: jobName,
                incidentId: supportContext.incident?.id
            },
            matches: retrieval.matches,
            excluded: result.excluded,
            missingEvidence: missingEvidence(retrieval.noMatchReason, health),
            now
        });
        return {
            supportContext,
            contextPack: filterContextPack(pack, input.access, 'read'),
            retrievalHealth: health
        };
    } catch {
        const health = await input.index.health().catch(() => ({
            backend: 'local' as const,
            state: 'unavailable' as const,
            message: 'Knowledge retrieval is unavailable.',
            checkedAt: now,
            fallbackUsed: true
        }));
        return emptyPack(supportContext, now, [], health);
    }
}
