import { describe, expect, it } from 'vitest';
import { createActionAuditEntry } from './action-audit';

describe('action-board audit', () => {
    it('normalizes the operator action fields for an auditable record', () => {
        expect(createActionAuditEntry({
            timestamp: '2026-08-31T10:00:00.000Z',
            operator: '  GajenderT ',
            jobName: '  QBATCH/DEMO ',
            action: ' holdJob ',
            result: 'success',
            detail: ' HLDJOB completed ',
            incidentId: ' alert-1 '
        })).toEqual({
            timestamp: '2026-08-31T10:00:00.000Z',
            operator: 'GajenderT',
            jobName: 'QBATCH/DEMO',
            action: 'holdJob',
            result: 'success',
            detail: 'HLDJOB completed',
            incidentId: 'alert-1'
        });
    });

    it('uses safe defaults when the operator or optional fields are empty', () => {
        expect(createActionAuditEntry({
            operator: ' ',
            jobName: ' QINTER/MSGW ',
            action: ' replyMessage ',
            result: 'failure',
            detail: ' ',
            incidentId: ' '
        })).toMatchObject({
            operator: 'local-operator',
            jobName: 'QINTER/MSGW',
            action: 'replyMessage',
            result: 'failure',
            detail: undefined,
            incidentId: undefined
        });
    });
});
