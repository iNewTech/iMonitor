import type { AlertKind } from '../alerts/alert-model';
import type { JobMessageRecord, ActiveJobRecord } from '../../services/ibmi';
import type { OperatorActionKind } from './operator-actions';

export interface RunbookPolicy {
    schema: 'imonitor-runbook-policy';
    version: 1;
    id: string;
    scenario: 'messageWait' | 'lockWait' | 'highCpu' | 'disconnect';
    title: string;
    requiredEvidence: string[];
    safeActions: OperatorActionKind[];
    verification: string;
    escalation: string;
}

const POLICIES: Record<RunbookPolicy['scenario'], RunbookPolicy> = {
    messageWait: {
        schema: 'imonitor-runbook-policy', version: 1, id: 'runbook-message-wait-v1', scenario: 'messageWait',
        title: 'Message wait response', requiredEvidence: ['job', 'messages'], safeActions: ['replyMessage'],
        verification: 'Confirm the same message identity is no longer waiting on the next poll.',
        escalation: 'Escalate when the message key, queue, or approved reply is unavailable.'
    },
    lockWait: {
        schema: 'imonitor-runbook-policy', version: 1, id: 'runbook-lock-wait-v1', scenario: 'lockWait',
        title: 'Lock wait investigation', requiredEvidence: ['job', 'queue', 'subsystem'], safeActions: ['inspectLocks'],
        verification: 'Confirm the lock wait clears and the affected job resumes expected work.',
        escalation: 'Escalate before ending or disrupting a job when the lock owner or business impact is uncertain.'
    },
    highCpu: {
        schema: 'imonitor-runbook-policy', version: 1, id: 'runbook-high-cpu-v1', scenario: 'highCpu',
        title: 'High CPU investigation', requiredEvidence: ['job', 'jobLog'], safeActions: [],
        verification: 'Compare the next polls with the expected workload and record whether CPU returns below the threshold.',
        escalation: 'Escalate when CPU remains high, workload impact is unclear, or a disruptive action is proposed.'
    },
    disconnect: {
        schema: 'imonitor-runbook-policy', version: 1, id: 'runbook-monitoring-disconnect-v1', scenario: 'disconnect',
        title: 'Monitoring disconnect recovery', requiredEvidence: ['trigger'], safeActions: [],
        verification: 'Confirm a fresh authenticated poll and separately verify the workload condition; reconnect alone is not recovery.',
        escalation: 'Escalate when monitoring cannot re-establish a trustworthy current state.'
    }
};

/** Returns the versioned scenario policy without marking it approved. */
export function getRunbookPolicy(kind?: AlertKind | null): RunbookPolicy | undefined {
    if (kind === 'messageWait') return POLICIES.messageWait;
    if (kind === 'lockWait') return POLICIES.lockWait;
    if (kind === 'highCpu') return POLICIES.highCpu;
    if (kind === 'pollFailure') return POLICIES.disconnect;
    return undefined;
}

/** Ensures a message reply still targets the current, allowed inquiry. */
export function validateMessageReplyContext(
    job: ActiveJobRecord,
    messages: JobMessageRecord[],
    input: { messageKey?: string; messageQueue?: string }
) {
    if (String(job.STATUS || '').toUpperCase() !== 'MSGW') {
        return { valid: false, reason: 'The job is no longer in MSGW; refresh before replying.' };
    }
    if (!['Y', 'YES', '1', 'TRUE'].includes(String(job.MESSAGE_REPLY || '').toUpperCase())) {
        return { valid: false, reason: 'IBM i does not report an allowed reply context for this job.' };
    }
    const messageKey = String(input.messageKey || '').trim().toUpperCase();
    const messageQueue = String(input.messageQueue || '').trim().toUpperCase();
    if (!messageKey || !messageQueue) {
        return { valid: false, reason: 'A current message key and queue are required before replying.' };
    }
    const current = messages.find((message) => (
        String(message.MESSAGE_KEY_HEX || '').trim().toUpperCase() === messageKey
        && `${String(message.MESSAGE_QUEUE_LIBRARY || '').trim()}/${String(message.MESSAGE_QUEUE_NAME || '').trim()}`.toUpperCase() === messageQueue
    ));
    if (!current) {
        return { valid: false, reason: 'The message changed or is no longer available; refresh before replying.' };
    }
    if (String(current.MESSAGE_TYPE || '').toUpperCase() !== 'INQUIRY') {
        return { valid: false, reason: 'The current message is not an inquiry that accepts a reply.' };
    }
    return { valid: true as const };
}
