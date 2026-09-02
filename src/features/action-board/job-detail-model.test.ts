import { describe, expect, it } from 'vitest';
import { formatJobDetailMessage, getJobContextSections } from './job-detail-model';

describe('job detail model', () => {
    it('formats job log and message records with useful detail', () => {
        expect(formatJobDetailMessage({
            MESSAGE_TIMESTAMP: '2026-09-02T10:00:00.000Z',
            MESSAGE_TYPE: 'INQUIRY',
            MESSAGE_ID: 'CPF1234',
            MESSAGE_TEXT: 'Reply required',
            MESSAGE_SECOND_LEVEL_TEXT: 'The operation is waiting.'
        })).toBe('[2026-09-02T10:00:00.000Z] INQUIRY CPF1234: Reply required | The operation is waiting.');
    });

    it('keeps job, queue, and subsystem context as separate sections', () => {
        expect(getJobContextSections({
            jobInfo: { JOB_NAME: '123/USER/JOB' },
            jobQueue: null,
            subsystem: { STATUS: 'ACTIVE' }
        }).map((section) => section.label)).toEqual([
            'Job properties',
            'Job queue properties',
            'Subsystem properties'
        ]);
    });
});
