import { describe, expect, it } from 'vitest';

const {
    buildAlertExplanationPrompt,
    buildAlertNextActionsPrompt,
    buildIncidentSummaryPrompt,
    buildSelectedJobHealthPrompt,
    buildWaitAnalysisPrompt,
    buildShiftHandoffPrompt,
    buildSqlActivityPrompt
} = require('../../../public/monitor/ibmeyeai/action-prompts.js') as {
    buildAlertExplanationPrompt: (alert: Record<string, unknown> | null) => string;
    buildAlertNextActionsPrompt: (alert: Record<string, unknown> | null) => string;
    buildIncidentSummaryPrompt: () => string;
    buildSelectedJobHealthPrompt: (selectedJobName?: string | null) => string;
    buildWaitAnalysisPrompt: (input?: { jobName?: string; waitReason?: string }) => string;
    buildShiftHandoffPrompt: () => string;
    buildSqlActivityPrompt: () => string;
};

describe('ibmeyeai action prompts', () => {
    it('builds the shared top-level prompts', () => {
        expect(buildIncidentSummaryPrompt()).toContain('current incident picture');
        expect(buildShiftHandoffPrompt()).toContain('shift handoff summary');
        expect(buildSqlActivityPrompt()).toContain('recent SQL activity');
    });

    it('builds a selected job health prompt with the selected job name', () => {
        expect(buildSelectedJobHealthPrompt('552901/BATCHNGT/NIGHTBCH')).toContain('552901/BATCHNGT/NIGHTBCH');
        expect(buildSelectedJobHealthPrompt()).toContain('the selected job');
    });

    it('builds an inline wait analysis prompt for the job drawer', () => {
        const prompt = buildWaitAnalysisPrompt({
            jobName: '610040/QUSER/QZDASOINIT',
            waitReason: 'Waiting for a reply to a specific message.'
        });

        expect(prompt).toContain('610040/QUSER/QZDASOINIT');
        expect(prompt).toContain('Waiting for a reply to a specific message.');
        expect(prompt).toContain('What is happening, Evidence, Likely cause');
        expect(prompt).toContain('Do not expose raw SQL');
    });

    it('builds alert-specific prompts for explanation and next actions', () => {
        const alert = {
            title: 'LCKW detected',
            kind: 'lockWait',
            jobName: '441210/APPUSR/LOCKJOB',
            message: 'QHTTPSVR/LOCKJOB is waiting on a lock.',
            detail: 'Database waits: 5'
        };

        expect(buildAlertExplanationPrompt(alert)).toContain('LCKW detected');
        expect(buildAlertExplanationPrompt(alert)).toContain('lockWait');
        expect(buildAlertNextActionsPrompt(alert)).toContain('441210/APPUSR/LOCKJOB');
        expect(buildAlertNextActionsPrompt(alert)).toContain('Database waits: 5');
    });
});
