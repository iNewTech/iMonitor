export type JobQueueActionKind = 'holdQueue' | 'releaseQueue' | 'holdQueuedJob' | 'releaseQueuedJob';

export interface JobQueueActionRequest {
    kind: JobQueueActionKind;
    queueName: string;
    queueLibrary: string;
    jobName?: string;
}

export interface JobQueueActionPlan {
    kind: JobQueueActionKind;
    executionType: 'cl' | 'blocked';
    command?: string;
    reason?: string;
}

function normalizePart(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function isSafeObjectName(value: string) {
    return /^[A-Z0-9_$#./]+$/i.test(value);
}

export function buildJobQueueActionPlan(request: JobQueueActionRequest): JobQueueActionPlan {
    const queueName = normalizePart(request.queueName);
    const queueLibrary = normalizePart(request.queueLibrary);
    const jobName = normalizePart(request.jobName);

    if (!queueName || !queueLibrary || !isSafeObjectName(queueName) || !isSafeObjectName(queueLibrary)) {
        return {
            kind: request.kind,
            executionType: 'blocked',
            reason: 'A valid IBM i job queue and library are required.'
        };
    }

    const queue = `${queueLibrary}/${queueName}`;
    if (request.kind === 'holdQueue') {
        return { kind: request.kind, executionType: 'cl', command: `HLDJOBQ JOBQ(${queue})` };
    }
    if (request.kind === 'releaseQueue') {
        return { kind: request.kind, executionType: 'cl', command: `RLSJOBQ JOBQ(${queue})` };
    }

    if (!jobName || !isSafeObjectName(jobName)) {
        return {
            kind: request.kind,
            executionType: 'blocked',
            reason: 'A valid qualified IBM i job name is required.'
        };
    }

    return {
        kind: request.kind,
        executionType: 'cl',
        command: `${request.kind === 'holdQueuedJob' ? 'HLDJOB' : 'RLSJOB'} JOB(${jobName})`
    };
}

export function requiresJobQueueConfirmation(kind: JobQueueActionKind) {
    return kind === 'holdQueue'
        || kind === 'releaseQueue'
        || kind === 'holdQueuedJob'
        || kind === 'releaseQueuedJob';
}
