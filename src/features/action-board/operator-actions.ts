export type OperatorActionKind = 'replyMessage' | 'holdJob' | 'releaseJob' | 'endJob' | 'inspectLocks';
export type EndJobOption = 'controlled' | 'immediate';

export interface OperatorActionAvailability {
    kind: OperatorActionKind;
    label: string;
    enabled: boolean;
    dangerous?: boolean;
    reason?: string;
}

export interface OperatorActionRequest {
    kind: OperatorActionKind;
    jobName: string;
    replyText?: string;
    messageKey?: string;
    messageQueue?: string;
    confirmed?: boolean;
    endOption?: EndJobOption;
}

/**
 * Identifies actions that must be explicitly confirmed by an operator.
 */
export function requiresOperatorConfirmation(kind: OperatorActionKind) {
    return kind === 'holdJob' || kind === 'releaseJob' || kind === 'endJob' || kind === 'replyMessage';
}

export interface OperatorActionPlan {
    kind: OperatorActionKind;
    executionType: 'cl' | 'blocked';
    command?: string;
    reason?: string;
}

interface ActionableJobShape {
    STATUS?: string | null;
    MESSAGE_REPLY?: string | null;
    DATABASE_LOCK_WAITS?: number | string | null;
}

/**
 * Returns the currently supported job actions for one monitored job.
 */
export function getAvailableOperatorActions(job: ActionableJobShape): OperatorActionAvailability[] {
    const status = job.STATUS || 'UNKNOWN';
    const lockWaits = Number(job.DATABASE_LOCK_WAITS || 0);
    const isEnded = status === 'END' || status === 'EOJ';

    return [
        {
            kind: 'replyMessage',
            label: 'Reply to MSGW',
            enabled: false,
            reason: status === 'MSGW'
                ? 'Waiting for message context to be loaded before a safe reply can be sent.'
                : 'Only available when the job is in MSGW.'
        },
        { kind: 'holdJob', label: 'Hold Job', enabled: !isEnded },
        { kind: 'releaseJob', label: 'Release Job', enabled: !isEnded },
        { kind: 'endJob', label: 'End Job', enabled: !isEnded, dangerous: true },
        {
            kind: 'inspectLocks',
            label: 'Inspect Locks',
            enabled: status === 'LCKW' || lockWaits > 0,
            reason: status === 'LCKW' || lockWaits > 0 ? undefined : 'Only useful when a lock wait is present.'
        }
    ];
}

/**
 * Normalizes a user-requested operator action before execution planning.
 */
export function normalizeOperatorActionRequest(request: OperatorActionRequest): Required<Pick<OperatorActionRequest, 'kind' | 'jobName' | 'endOption'>> & OperatorActionRequest {
    return {
        ...request,
        jobName: request.jobName.trim(),
        endOption: request.endOption === 'immediate' ? 'immediate' : 'controlled'
    };
}

/**
 * Builds the current execution plan for a supported operator action.
 */
export function buildOperatorActionPlan(request: OperatorActionRequest): OperatorActionPlan {
    const normalized = normalizeOperatorActionRequest(request);

    switch (normalized.kind) {
        case 'holdJob':
            return { kind: normalized.kind, executionType: 'cl', command: `HLDJOB JOB(${normalized.jobName})` };
        case 'releaseJob':
            return { kind: normalized.kind, executionType: 'cl', command: `RLSJOB JOB(${normalized.jobName})` };
        case 'endJob':
            return {
                kind: normalized.kind,
                executionType: 'cl',
                command: `ENDJOB JOB(${normalized.jobName}) OPTION(${normalized.endOption === 'immediate' ? '*IMMED' : '*CNTRLD'})`
            };
        case 'inspectLocks':
            return { kind: normalized.kind, executionType: 'blocked', reason: 'Lock inspection needs a dedicated query path and is not wired yet.' };
        case 'replyMessage':
            if (!normalized.replyText?.trim() || !normalized.messageKey?.trim() || !normalized.messageQueue?.trim()) {
                return { kind: normalized.kind, executionType: 'blocked', reason: 'MSGW reply needs a message, queue, and reply value.' };
            }

            if (!/^[0-9a-f]{8}$/i.test(normalized.messageKey.trim())) {
                return { kind: normalized.kind, executionType: 'blocked', reason: 'The message key is not in a safe IBM i format.' };
            }

            if (!/^[A-Z0-9_$#./]+$/i.test(normalized.messageQueue.trim())) {
                return { kind: normalized.kind, executionType: 'blocked', reason: 'The message queue is not in a safe IBM i format.' };
            }

            return {
                kind: normalized.kind,
                executionType: 'cl',
                command: `SNDRPY MSGKEY(X'${normalized.messageKey.trim().toUpperCase()}') MSGQ(${normalized.messageQueue.trim()}) RPY('${normalized.replyText.trim().replace(/'/g, "''")}') RMV(*NO)`
            };
        default:
            return { kind: normalized.kind, executionType: 'blocked', reason: 'Unsupported operator action.' };
    }
}
