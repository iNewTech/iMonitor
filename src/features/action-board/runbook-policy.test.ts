import { describe, expect, it } from 'vitest';
import { getRunbookPolicy, validateMessageReplyContext } from './runbook-policy';
import type { ActiveJobRecord, JobMessageRecord } from '../../services/ibmi';

describe('runbook policy', () => {
    it('provides versioned policies for the common L1/L2 scenarios', () => {
        expect(getRunbookPolicy('messageWait')).toMatchObject({ id: 'runbook-message-wait-v1', version: 1, requiredEvidence: ['job', 'messages'] });
        expect(getRunbookPolicy('lockWait')).toMatchObject({ id: 'runbook-lock-wait-v1', version: 1 });
        expect(getRunbookPolicy('highCpu')).toMatchObject({ id: 'runbook-high-cpu-v1', version: 1 });
        expect(getRunbookPolicy('pollFailure')).toMatchObject({ id: 'runbook-monitoring-disconnect-v1', scenario: 'disconnect' });
        expect(getRunbookPolicy('delayWait')).toBeUndefined();
    });

    it('rejects stale, wrong, and unsupported message replies', () => {
        const job = { STATUS: 'MSGW', MESSAGE_REPLY: 'YES' } as ActiveJobRecord;
        const messages = [{
            MESSAGE_KEY_HEX: 'DEADBEEF',
            MESSAGE_QUEUE_LIBRARY: 'QSYS',
            MESSAGE_QUEUE_NAME: 'QSYSOPR',
            MESSAGE_TYPE: 'INQUIRY'
        }] as JobMessageRecord[];
        expect(validateMessageReplyContext(job, messages, { messageKey: 'DEADBEEF', messageQueue: 'QSYS/QSYSOPR' })).toEqual({ valid: true });
        expect(validateMessageReplyContext(job, messages, { messageKey: 'STALE001', messageQueue: 'QSYS/QSYSOPR' }).valid).toBe(false);
        expect(validateMessageReplyContext(job, messages, { messageKey: 'DEADBEEF', messageQueue: 'QSYS/QSYSOPR' }).reason).toBeUndefined();
        expect(validateMessageReplyContext({ ...job, STATUS: 'RUN' }, messages, { messageKey: 'DEADBEEF', messageQueue: 'QSYS/QSYSOPR' }).reason).toContain('no longer in MSGW');
    });
});
